#!/usr/bin/env python3
"""Derive a view's field homography from the AprilTags already on the field.

Calibration is otherwise the most expert-only step in this pipeline: someone
clicks four landmarks and types their real field coordinates. FRC fields carry
AprilTags at surveyed positions, and WPILib publishes their exact poses, so a
camera that can see a few of them has everything it needs to calibrate itself.

Two things this buys beyond skipping the manual step:

  * Real units. Without a calibrated homography, field_point() passes pixel
    coordinates straight through, so every derived number - speed, distance,
    attribution thresholds - is in pixels and means nothing across venues.
    A tag-derived solve puts them in metres in the real FRC field frame.
  * Drift detection. Re-solving and comparing against the stored matrix
    catches a camera that got bumped mid-event, which currently invalidates a
    venue's calibration silently.

Why this is not a plain four-point homography: FRC tags are mounted upright on
walls, so their corners are NOT coplanar with the floor. Feeding them to
findHomography would fit a plane that is not the one robots drive on. Instead
solvePnP recovers the camera's pose from the tags' known 3D positions, and the
floor-plane homography falls out of that pose.

Coordinate conventions, from the WPILib field layout spec:
  * Field frame is NWU - X toward the opposing alliance, Y left, Z up - with
    the origin at the bottom-right corner of the blue alliance wall, in metres.
  * A tag pose is the centre of the tag. Zero rotation means upright and
    facing away from the blue alliance wall, so the tag lies in the Y-Z plane
    with its normal along +X.
"""
from __future__ import annotations

import json
import math
from pathlib import Path

import cv2
import numpy as np

# FRC has used the 36h11 family since 2023; 2022 and earlier used 16h5. Named
# rather than hardcoded so an older recording is still calibratable, and so a
# bad family name is a clear failure reason instead of an AttributeError.
TAG_FAMILIES = {
    "36h11": "DICT_APRILTAG_36h11",
    "36h10": "DICT_APRILTAG_36h10",
    "25h9": "DICT_APRILTAG_25h9",
    "16h5": "DICT_APRILTAG_16h5",
}
DEFAULT_TAG_FAMILY = "36h11"


def aruco_unavailable():
    """Why AprilTag detection can't run in this build, or None if it can.

    opencv-python-headless ships aruco, but a slimmed or older build may not,
    and that has to degrade to "no automatic calibration" rather than taking
    down ordinary vision processing.
    """
    if not hasattr(cv2, "aruco"):
        return "this OpenCV build has no cv2.aruco module"
    for required in ("getPredefinedDictionary", "ArucoDetector", "DetectorParameters"):
        if not hasattr(cv2.aruco, required):
            return f"this OpenCV build's cv2.aruco is missing {required}"
    return None


def tag_dictionary(family=DEFAULT_TAG_FAMILY):
    """Resolve a family name to an aruco dictionary. Returns (dictionary, reason);
    dictionary is None when unsupported and reason says why."""
    unavailable = aruco_unavailable()
    if unavailable:
        return None, unavailable
    attribute = TAG_FAMILIES.get(str(family or DEFAULT_TAG_FAMILY).lower())
    if not attribute:
        return None, f"unknown tag family {family!r} (known: {', '.join(sorted(TAG_FAMILIES))})"
    if not hasattr(cv2.aruco, attribute):
        return None, f"this OpenCV build has no {attribute}"
    return cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, attribute)), None

# Printed size of the black square, in metres. FRC's are 6.5in since 2024.
DEFAULT_TAG_SIZE_M = 0.1651

# A solve whose tags don't reproject onto where they were actually seen is
# wrong, however plausible its matrix looks. Refusing beats silently handing
# back coordinates that are confidently in the wrong place.
DEFAULT_MAX_REPROJECTION_PX = 6.0

# Reprojection error alone does NOT catch wrong intrinsics, which is the
# likeliest mistake when the focal length is estimated from a spec-sheet FOV.
# Understating the FOV lets solvePnP place the camera much further away and
# still reproject the tags almost perfectly - measured at 1.9px, well inside
# the gate above, while putting the camera 31 m behind the alliance wall. The
# error shows up in the recovered *pose*, not the residual, so it takes a
# physical plausibility check to catch: a scouting camera is above the floor,
# below the roof, and somewhere near the field.
DEFAULT_MIN_CAMERA_HEIGHT_M = 0.5
DEFAULT_MAX_CAMERA_HEIGHT_M = 15.0
DEFAULT_FIELD_MARGIN_M = 12.0


def probe_recording(video_path, capture_factory=None):
    """What we can learn about a recording before spending GPU time on it.

    Reports resolution, fps, frame count and duration where the container
    exposes them, plus warnings for the things that make a recording useless
    or the results untrustworthy. Purely advisory - it never refuses to
    process, because a container that under-reports its metadata is common and
    is not itself a reason to discard footage.
    """
    open_capture = capture_factory or (lambda path: cv2.VideoCapture(str(path)))
    report = {
        "path": str(video_path), "readable": False, "width": 0, "height": 0,
        "fps": 0.0, "frame_count": 0, "duration_seconds": None, "warnings": [],
    }
    try:
        capture = open_capture(video_path)
    except Exception as error:
        report["warnings"].append(f"could not open recording: {error}")
        return report
    try:
        report["readable"] = bool(capture.isOpened()) if hasattr(capture, "isOpened") else True
        report["width"] = int(capture.get(cv2.CAP_PROP_FRAME_WIDTH) or 0)
        report["height"] = int(capture.get(cv2.CAP_PROP_FRAME_HEIGHT) or 0)
        report["fps"] = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        report["frame_count"] = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    finally:
        try:
            capture.release()
        except Exception:
            pass

    if not report["readable"]:
        report["warnings"].append("recording could not be opened - wrong codec, or a truncated upload")
        return report
    if report["fps"] > 0 and report["frame_count"] > 0:
        report["duration_seconds"] = report["frame_count"] / report["fps"]

    if not report["width"] or not report["height"]:
        report["warnings"].append("no frame dimensions reported - AprilTag calibration will be skipped")
    elif report["width"] < 1280:
        # A 6.5in tag ~14m away spans roughly 15px at 1600px wide, which the
        # detector already misses about half the time. Below 720p it is
        # hopeless, and small robots downfield suffer for the same reason.
        report["warnings"].append(
            f"low resolution ({report['width']}x{report['height']}) - "
            "distant tags and robots may be too small to detect reliably"
        )
    if report["fps"] and report["fps"] < 15:
        report["warnings"].append(f"low frame rate ({report['fps']:.1f} fps) - tracking may break across gaps")
    if not report["frame_count"]:
        report["warnings"].append("container reports no frame count - duration and phase timing may be unreliable")
    elif report["duration_seconds"] is not None and report["duration_seconds"] < 30:
        report["warnings"].append(
            f"recording is only {report['duration_seconds']:.0f}s - shorter than a match, so it is probably partial"
        )
    return report


def quaternion_to_matrix(w, x, y, z):
    """Rotation matrix for a WPILib pose quaternion."""
    norm = math.sqrt(w * w + x * x + y * y + z * z)
    if not norm:
        return np.eye(3)
    w, x, y, z = w / norm, x / norm, y / norm, z / norm
    return np.array([
        [1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
        [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
        [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)],
    ])


def load_field_layout(path):
    """Read a WPILib AprilTagFieldLayout JSON into {tag id: pose}.

    Deliberately takes a path rather than embedding tag positions: the layout
    is game-year specific and ships with WPILib, so pinning a copy here would
    be one more thing to remember to update every season.
    """
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    tags = {}
    for tag in payload.get("tags", []):
        pose = tag.get("pose") or {}
        translation = pose.get("translation") or {}
        quaternion = (pose.get("rotation") or {}).get("quaternion") or {}
        try:
            tags[int(tag["ID"])] = {
                "translation": (
                    float(translation["x"]), float(translation["y"]), float(translation["z"]),
                ),
                "quaternion": (
                    float(quaternion.get("W", 1)), float(quaternion.get("X", 0)),
                    float(quaternion.get("Y", 0)), float(quaternion.get("Z", 0)),
                ),
            }
        except (KeyError, TypeError, ValueError):
            continue  # a malformed entry shouldn't discard the whole layout
    return {"tags": tags, "field": payload.get("field") or {}}


def tag_corner_field_points(tag, tag_size_m=DEFAULT_TAG_SIZE_M):
    """The tag's four corners in field metres, ordered to match the detector.

    cv2.aruco reports corners clockwise from the top-left as the tag appears in
    the image. Viewing an upright tag from in front (from its +X normal side),
    image-right is field +Y and image-up is field +Z, which fixes the ordering
    below. Getting this wrong yields a mirrored camera pose, which is exactly
    what the reprojection gate in solve_field_homography() is there to catch.
    """
    half = tag_size_m / 2.0
    local = np.array([
        [0.0, -half, +half],  # top-left
        [0.0, +half, +half],  # top-right
        [0.0, +half, -half],  # bottom-right
        [0.0, -half, -half],  # bottom-left
    ])
    rotation = quaternion_to_matrix(*tag["quaternion"])
    return np.array(tag["translation"]) + local @ rotation.T


def camera_matrix_from_fov(width, height, horizontal_fov_deg):
    """A pinhole intrinsic matrix estimated from the lens' horizontal FOV.

    Real calibration (a checkerboard, or WPILib's wpical) is better and can be
    supplied instead. This exists because a rough FOV is something anyone can
    read off a camera's spec sheet, and an approximate intrinsic beats having
    no field calibration at all.
    """
    if not width or not height or not horizontal_fov_deg:
        return None
    focal = (width / 2.0) / math.tan(math.radians(horizontal_fov_deg) / 2.0)
    return np.array([
        [focal, 0.0, width / 2.0],
        [0.0, focal, height / 2.0],
        [0.0, 0.0, 1.0],
    ])


def detect_field_tags(frame, family=DEFAULT_TAG_FAMILY):
    """Detect field tags, as [{"id", "corners"}] with corners in detector order.

    Returns an empty list when detection isn't possible at all - an
    unsupported family, or an OpenCV build without aruco - because "saw no
    tags" and "couldn't look" both mean the same thing to the caller, which
    reports the reason separately via tag_dictionary().
    """
    dictionary, _reason = tag_dictionary(family)
    if dictionary is None or frame is None:
        return []
    detector = cv2.aruco.ArucoDetector(dictionary, cv2.aruco.DetectorParameters())
    corners, ids, _rejected = detector.detectMarkers(frame)
    if ids is None:
        return []
    return [
        {"id": int(tag_id), "corners": np.asarray(corner_set, dtype=np.float64).reshape(4, 2)}
        for tag_id, corner_set in zip(ids.flatten(), corners)
    ]


def solve_field_homography(
    detections,
    layout,
    camera_matrix,
    tag_size_m=DEFAULT_TAG_SIZE_M,
    dist_coeffs=None,
    max_reprojection_px=DEFAULT_MAX_REPROJECTION_PX,
    **plausibility,
):
    """Recover the image->field homography for the floor plane.

    Returns (homography, diagnostics). The homography is None when the solve
    was refused, and diagnostics always explains why in "reason".
    """
    diagnostics = {"tags_detected": len(detections or []), "tags_matched": 0}
    if camera_matrix is None:
        diagnostics["reason"] = "no camera intrinsics supplied"
        return None, diagnostics

    known = layout.get("tags", {})
    object_points, image_points, matched = [], [], []
    for detection in detections or []:
        tag = known.get(int(detection["id"]))
        if tag is None:
            continue  # a tag from another field/year, or a misread
        object_points.append(tag_corner_field_points(tag, tag_size_m))
        image_points.append(np.asarray(detection["corners"], dtype=np.float64).reshape(4, 2))
        matched.append(int(detection["id"]))

    diagnostics["tags_matched"] = len(matched)
    diagnostics["tag_ids"] = sorted(matched)
    # Two tags give eight correspondences, comfortably over-determining the six
    # degrees of freedom of a camera pose. One tag technically solves but is
    # far too sensitive to a single bad corner to trust for a whole event.
    if len(matched) < 2:
        diagnostics["reason"] = "need at least 2 known tags in view"
        return None, diagnostics

    object_points = np.concatenate(object_points).astype(np.float64)
    image_points = np.concatenate(image_points).astype(np.float64)
    distortion = np.zeros((5, 1)) if dist_coeffs is None else np.asarray(dist_coeffs, dtype=np.float64)

    # solvePnPGeneric rather than solvePnP because a camera that can only see
    # one wall's worth of tags has a *coplanar* point set, and coplanar PnP has
    # a genuine two-fold ambiguity - the true pose and its mirror through the
    # tag plane both reproject perfectly. Taking whichever one the solver
    # happened to return puts the camera under the floor about half the time.
    # Ask for every solution and let the physical checks below pick.
    count, rvecs, tvecs, _errors = cv2.solvePnPGeneric(
        object_points, image_points, camera_matrix, distortion, flags=cv2.SOLVEPNP_SQPNP,
    )
    if not count:
        diagnostics["reason"] = "solvePnP found no camera pose"
        return None, diagnostics

    field = layout.get("field") or {}
    candidates = []
    for rvec, tvec in zip(rvecs, tvecs):
        projected, _ = cv2.projectPoints(object_points, rvec, tvec, camera_matrix, distortion)
        errors = np.linalg.norm(projected.reshape(-1, 2) - image_points, axis=1)
        rotation, _ = cv2.Rodrigues(rvec)
        position = -rotation.T @ tvec.flatten()
        candidates.append({
            "rotation": rotation, "tvec": tvec, "position": position,
            "mean_error": float(errors.mean()), "max_error": float(errors.max()),
            "implausible": implausible_camera_pose(position, field, **plausibility),
        })

    diagnostics["candidate_poses"] = len(candidates)
    diagnostics["coplanar_tags"] = points_are_coplanar(object_points)
    if diagnostics["coplanar_tags"]:
        # Measured on synthetic scenes at 0.3px corner noise: tags spread over
        # three walls put a 3 m ground distance within 1 mm, while the same
        # count on a single wall drifts ~6 cm. Both are exact with perfect
        # corners, so this is noise sensitivity rather than bias - depth is
        # weakly constrained when every tag sits on one plane. Usable, but
        # worth aiming the camera to catch a second wall if it can.
        diagnostics["accuracy_note"] = (
            "all visible tags are coplanar (one wall), which weakly constrains depth - "
            "expect a few cm of floor error, and prefer a view that also sees a side wall"
        )
    usable = [c for c in candidates if c["implausible"] is None and c["mean_error"] <= max_reprojection_px]
    best = min(usable or candidates, key=lambda c: c["mean_error"])

    diagnostics["reprojection_error_px"] = best["mean_error"]
    diagnostics["max_corner_error_px"] = best["max_error"]
    diagnostics["camera_position_m"] = [float(value) for value in best["position"]]
    diagnostics["camera_height_m"] = float(best["position"][2])

    if not usable:
        if best["mean_error"] > max_reprojection_px:
            diagnostics["reason"] = (
                f"reprojection error {best['mean_error']:.1f}px exceeds {max_reprojection_px}px - "
                "intrinsics, tag size, or the layout year is likely wrong"
            )
        else:
            diagnostics["reason"] = best["implausible"]
        return None, diagnostics

    rotation, tvec = best["rotation"], best["tvec"]
    # A point on the floor is (x, y, 0), so the third column of the rotation
    # drops out and what maps field to image is K [r1 r2 t] - an ordinary 3x3
    # homography. Invert it, because field_point() goes image -> field.
    field_to_image = camera_matrix @ np.column_stack((rotation[:, 0], rotation[:, 1], tvec.flatten()))
    if abs(np.linalg.det(field_to_image)) < 1e-12:
        diagnostics["reason"] = "degenerate camera pose (looking along the floor plane)"
        return None, diagnostics

    homography = np.linalg.inv(field_to_image)
    diagnostics["reason"] = "ok"
    return homography / homography[2, 2], diagnostics


def points_are_coplanar(points, tolerance_m=0.05):
    """Whether every tag corner lies in one plane, i.e. the camera only sees a
    single wall. The smallest singular value of the centred point cloud is the
    spread perpendicular to the best-fit plane."""
    points = np.asarray(points, dtype=np.float64)
    if len(points) < 4:
        return True
    singular_values = np.linalg.svd(points - points.mean(axis=0), compute_uv=False)
    return bool(singular_values[-1] < tolerance_m)


def implausible_camera_pose(
    position,
    field,
    min_height_m=DEFAULT_MIN_CAMERA_HEIGHT_M,
    max_height_m=DEFAULT_MAX_CAMERA_HEIGHT_M,
    field_margin_m=DEFAULT_FIELD_MARGIN_M,
):
    """Why this camera pose can't be real, or None if it's believable.

    This is the check that catches wrong intrinsics, which reprojection error
    cannot: an understated FOV reprojects beautifully while placing the camera
    tens of metres outside the venue.
    """
    x, y, z = (float(value) for value in position)
    if not (min_height_m <= z <= max_height_m):
        return (
            f"implausible camera height {z:.1f}m (expected {min_height_m}-{max_height_m}m) - "
            "the camera FOV or tag size is probably wrong"
        )
    length = float(field.get("length") or 0)
    width = float(field.get("width") or 0)
    if length and width:
        if not (-field_margin_m <= x <= length + field_margin_m and -field_margin_m <= y <= width + field_margin_m):
            return (
                f"camera solves to ({x:.1f}, {y:.1f})m, outside the field plus a "
                f"{field_margin_m}m margin - the camera FOV or tag size is probably wrong"
            )
    return None


def calibrate_from_frame(
    frame, layout, horizontal_fov_deg=None, camera_matrix=None,
    family=DEFAULT_TAG_FAMILY, **kwargs,
):
    """Convenience wrapper: detect tags in one frame and solve."""
    dictionary, family_reason = tag_dictionary(family)
    if dictionary is None:
        return None, {"reason": family_reason, "tags_detected": 0, "tags_matched": 0}
    if camera_matrix is None:
        height, width = frame.shape[:2]
        camera_matrix = camera_matrix_from_fov(width, height, horizontal_fov_deg)
    return solve_field_homography(detect_field_tags(frame, family), layout, camera_matrix, **kwargs)


def main():
    import argparse

    parser = argparse.ArgumentParser(description="Solve a view's field homography from AprilTags.")
    parser.add_argument("video", help="A recording from the camera to calibrate")
    parser.add_argument("--layout", required=True, help="WPILib AprilTagFieldLayout JSON")
    parser.add_argument("--fov", type=float, help="Horizontal field of view in degrees")
    parser.add_argument("--tag-size", type=float, default=DEFAULT_TAG_SIZE_M)
    parser.add_argument("--family", default=DEFAULT_TAG_FAMILY, choices=sorted(TAG_FAMILIES))
    parser.add_argument("--max-reprojection-px", type=float, default=DEFAULT_MAX_REPROJECTION_PX)
    parser.add_argument("--frames", type=int, default=30, help="How many frames to try")
    args = parser.parse_args()

    layout = load_field_layout(args.layout)
    capture = cv2.VideoCapture(args.video)
    best = (None, {"reason": "no frame produced a solve", "tags_matched": 0})
    for _ in range(max(1, args.frames)):
        ok, frame = capture.read()
        if not ok:
            break
        homography, diagnostics = calibrate_from_frame(
            frame, layout, horizontal_fov_deg=args.fov, tag_size_m=args.tag_size,
            family=args.family, max_reprojection_px=args.max_reprojection_px,
        )
        # Prefer the frame that matched the most tags; more spread means a
        # better-conditioned pose.
        if homography is not None and diagnostics["tags_matched"] > best[1].get("tags_matched", 0):
            best = (homography, diagnostics)
    capture.release()

    homography, diagnostics = best
    print(json.dumps({
        "homography": homography.tolist() if homography is not None else None,
        "diagnostics": diagnostics,
    }, indent=2))
    raise SystemExit(0 if homography is not None else 1)


if __name__ == "__main__":
    main()
