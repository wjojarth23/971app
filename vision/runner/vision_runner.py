#!/usr/bin/env python3
"""Post-match multi-view ML runner.

Requires custom YOLO weights whose class names use this vocabulary:
robot_red, robot_blue, climb_attempt, climb_success. (Fuel is intentionally
NOT a YOLO class - see "Hybrid game-piece detection" below.)
Robot tracks are never assigned a team unless the queued run config contains
identity_map entries of the form "<view uuid>:<tracker id>": "frc971".

Hybrid game-piece detection and scoring attribution, and the robot
occlusion-recovery (ReID) logic, are adapted from community R&D shared on
Chief Delphi ("Computer Vision Scouting",
chiefdelphi.com/t/computer-vision-scouting/511642) - see
scoutingvision.md for the full writeup of what changed and why.
"""
from __future__ import annotations

import json
import math
import os
import tempfile
import time
from pathlib import Path

import cv2
import numpy as np
import requests
from ultralytics import YOLO

API = os.environ["VISION_API_URL"].rstrip("/") + "/api/vision-runner"
TOKEN = os.environ["VISION_RUNNER_TOKEN"]
RUNNER_ID = os.environ.get("VISION_RUNNER_ID", "vision-runner-local")
WEIGHTS = os.environ["VISION_MODEL_PATH"]
POLL_SECONDS = int(os.environ.get("VISION_POLL_SECONDS", "10"))
HEADERS = {"Authorization": f"Bearer {TOKEN}", "Content-Type": "application/json"}

# Defaults for the hybrid game-piece pipeline. All overridable per run via
# vision_runs.config - a single hardcoded HSV range doesn't survive a venue
# with different lighting, which is exactly the calibration problem the
# source community post flags ("HSV thresholds tuned per venue").
DEFAULT_HSV_LOWER = (20, 100, 100)   # yellow/orange game piece, generic starting point
DEFAULT_HSV_UPPER = (35, 255, 255)
DEFAULT_MIN_PIECE_AREA = 40
DEFAULT_MIN_CIRCULARITY = 0.55


def api(action: str, **payload):
    response = requests.post(API, headers=HEADERS, json={"action": action, **payload}, timeout=120)
    response.raise_for_status()
    return response.json()


def download(url: str, target: Path):
    with requests.get(url, stream=True, timeout=3600) as response:
        response.raise_for_status()
        with target.open("wb") as output:
            for chunk in response.iter_content(1024 * 1024):
                output.write(chunk)


def field_point(center, homography):
    if not homography:
        return float(center[0]), float(center[1]), False
    matrix = np.asarray(homography, dtype=np.float64).reshape(3, 3)
    point = cv2.perspectiveTransform(np.asarray([[center]], dtype=np.float32), matrix)[0][0]
    return float(point[0]), float(point[1]), True


def build_mask(polygon_points, frame_shape):
    """polygon_points are normalized (0-1) [x, y] pairs - resolution-
    independent so the same calibration works regardless of capture
    resolution. Returns None (no masking) if no polygon was calibrated."""
    if not polygon_points:
        return None
    height, width = frame_shape[:2]
    pixels = np.array([[int(x * width), int(y * height)] for x, y in polygon_points], dtype=np.int32)
    mask = np.zeros((height, width), dtype=np.uint8)
    cv2.fillPoly(mask, [pixels], 255)
    return mask


def point_in_zone(point, polygon_points, frame_shape):
    if not polygon_points:
        return False
    height, width = frame_shape[:2]
    pixels = np.array([[px * width, py * height] for px, py in polygon_points], dtype=np.float32)
    return cv2.pointPolygonTest(pixels, (float(point[0]), float(point[1])), False) >= 0


def bumper_histogram(frame, box_xyxy):
    """Color histogram of a robot's bumper region (bottom third of its
    bounding box - the most consistent, least-occluded, alliance-colored
    surface), used to re-identify a robot across a brief occlusion. HSV
    hue+saturation only (ignores value/brightness), so it's stable across
    shadows and camera exposure drift within one recording."""
    x1, y1, x2, y2 = [int(v) for v in box_xyxy]
    x1, y1 = max(0, x1), max(0, y1)
    x2, y2 = min(frame.shape[1], x2), min(frame.shape[0], y2)
    if x2 <= x1 or y2 <= y1:
        return None
    bumper_top = y1 + int((y2 - y1) * 0.66)
    crop = frame[bumper_top:y2, x1:x2]
    if crop.size == 0:
        return None
    hsv_crop = cv2.cvtColor(crop, cv2.COLOR_BGR2HSV)
    histogram = cv2.calcHist([hsv_crop], [0, 1], None, [30, 32], [0, 180, 0, 256])
    cv2.normalize(histogram, histogram, 0, 1, cv2.NORM_MINMAX)
    return histogram


class RobotReId:
    """Recovers a robot's tracker identity across a brief occlusion instead
    of letting the tracker mint a brand-new id for the same physical robot
    (which would otherwise silently split one robot's real trajectory/
    identity_map entry into two unrelated tracks).

    Two independent signals must both agree before a recovery is accepted:
    1. Position: the lost track's last known velocity projects forward to
       roughly where the new detection actually is.
    2. Appearance: the new detection's bumper-color histogram is similar
       enough to the lost track's - position alone is ambiguous whenever
       multiple same-alliance robots are near each other.
    """

    def __init__(self, max_lost_frames=45, max_position_error_px=150, min_histogram_similarity=0.55):
        self.max_lost_frames = max_lost_frames
        self.max_position_error_px = max_position_error_px
        self.min_histogram_similarity = min_histogram_similarity
        self._lost = {}   # canonical_id -> {position, velocity, histogram, alliance, lost_at_frame}
        self._remap = {}  # this run's raw tracker_id -> canonical_id it was recovered as

    def resolve(self, raw_tracker_id, frame_index, position, histogram, alliance):
        """Call once per detection per frame. Returns the canonical id to
        track this detection under - either raw_tracker_id itself, or a
        recovered id from a track that had gone missing."""
        if raw_tracker_id in self._remap:
            return self._remap[raw_tracker_id]
        recovered = self._best_lost_match(frame_index, position, histogram, alliance)
        if recovered is not None:
            self._remap[raw_tracker_id] = recovered
            del self._lost[recovered]
            return recovered
        return raw_tracker_id

    def _best_lost_match(self, frame_index, position, histogram, alliance):
        if histogram is None:
            return None
        best_id, best_similarity = None, self.min_histogram_similarity
        for lost_id, lost in self._lost.items():
            if lost["alliance"] != alliance:
                continue
            frames_gone = frame_index - lost["lost_at_frame"]
            if not (0 < frames_gone <= self.max_lost_frames):
                continue
            predicted_x = lost["position"][0] + lost["velocity"][0] * frames_gone
            predicted_y = lost["position"][1] + lost["velocity"][1] * frames_gone
            position_error = math.hypot(position[0] - predicted_x, position[1] - predicted_y)
            if position_error > self.max_position_error_px:
                continue
            if lost["histogram"] is None:
                continue
            similarity = cv2.compareHist(histogram, lost["histogram"], cv2.HISTCMP_CORREL)
            if similarity > best_similarity:
                best_id, best_similarity = lost_id, similarity
        return best_id

    def mark_lost(self, canonical_id, frame_index, position, velocity, histogram, alliance):
        """Call for every canonical id that was tracked last frame but had
        no matching detection this frame - it may be occluded and about to
        reappear, or it may be genuinely gone (left the ROI, match ended).
        Either way it's cheap to remember for max_lost_frames and harmless
        if never reclaimed."""
        self._lost[canonical_id] = {
            "position": position, "velocity": velocity, "histogram": histogram,
            "alliance": alliance, "lost_at_frame": frame_index
        }


# --- Hybrid game-piece detection ------------------------------------------
# Chosen over a YOLO class for game pieces specifically: per the source
# community R&D, training a detector for small, fast-moving balls at a
# distance is difficult and expensive, while classical HSV color
# thresholding + contour filtering is both cheaper and more robust for this
# one narrow task. Robot detection stays a YOLO class - the best tool
# genuinely differs per problem here, not a blanket "avoid ML" stance.

def detect_game_pieces(frame, mask, hsv_lower, hsv_upper, min_area, min_circularity):
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    color_mask = cv2.inRange(hsv, np.array(hsv_lower, dtype=np.uint8), np.array(hsv_upper, dtype=np.uint8))
    if mask is not None:
        color_mask = cv2.bitwise_and(color_mask, mask)
    contours, _ = cv2.findContours(color_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    centers = []
    for contour in contours:
        area = cv2.contourArea(contour)
        if area < min_area:
            continue
        perimeter = cv2.arcLength(contour, True)
        if perimeter <= 0:
            continue
        # 1.0 is a perfect circle; this is a minimum-similarity filter, not
        # an equality check - real detections are never exact circles.
        circularity = 4 * math.pi * area / (perimeter ** 2)
        if circularity < min_circularity:
            continue
        moments = cv2.moments(contour)
        if moments["m00"] == 0:
            continue
        centers.append((moments["m10"] / moments["m00"], moments["m01"] / moments["m00"]))
    return centers


class PieceTracker:
    """Frame-to-frame nearest-neighbor association of game-piece detections
    into trajectories. Deliberately simple (no Kalman filter, no ML) to
    match the "classical CV, not ML" choice for the whole piece pipeline - a
    piece rarely jumps far between consecutive frames at typical capture
    frame rates, so a distance-gated nearest-neighbor match is sufficient
    and cheap."""

    def __init__(self, max_match_distance_px=80, max_missed_frames=5):
        self.max_match_distance_px = max_match_distance_px
        self.max_missed_frames = max_missed_frames
        self._next_id = 0
        self._active = {}   # id -> {"points": [(t_ms, x, y)], "missed": int}
        self.finished = []  # completed trajectories, each a list of (t_ms, x, y)

    def update(self, timestamp_ms, detections):
        unmatched = set(range(len(detections)))
        for piece_id, track in list(self._active.items()):
            last_x, last_y = track["points"][-1][1], track["points"][-1][2]
            best_index, best_distance = None, self.max_match_distance_px
            for index in unmatched:
                x, y = detections[index]
                distance = math.hypot(x - last_x, y - last_y)
                if distance < best_distance:
                    best_index, best_distance = index, distance
            if best_index is not None:
                x, y = detections[best_index]
                track["points"].append((timestamp_ms, x, y))
                track["missed"] = 0
                unmatched.discard(best_index)
            else:
                track["missed"] += 1
                if track["missed"] > self.max_missed_frames:
                    self.finished.append(track["points"])
                    del self._active[piece_id]
        for index in unmatched:
            x, y = detections[index]
            self._active[self._next_id] = {"points": [(timestamp_ms, x, y)], "missed": 0}
            self._next_id += 1

    def all_trajectories(self):
        return self.finished + [track["points"] for track in self._active.values()]


def attribute_scores(piece_trajectories, robot_tracks, goal_zones, frame_shape, view_id):
    """A piece is "scored" once its trajectory ends inside a goal zone.
    Attribution walks back to the trajectory's *origin* point (where the
    piece started, i.e. left the shooting robot) and finds whichever robot
    track was physically closest at that same moment - the shooter, not
    whichever robot happens to be nearest the goal when it lands."""
    observations = []
    for trajectory in piece_trajectories:
        if len(trajectory) < 2:
            continue
        end_t, end_x, end_y = trajectory[-1]
        scoring_zone = next((zone for zone in goal_zones if point_in_zone((end_x, end_y), zone.get("polygon"), frame_shape)), None)
        if not scoring_zone:
            continue
        start_t, start_x, start_y = trajectory[0]
        best_track, best_distance = None, None
        for track in robot_tracks:
            closest_point = min(track["trajectory"], key=lambda p: abs(p["t"] - start_t), default=None)
            if not closest_point or abs(closest_point["t"] - start_t) > 500:
                continue
            distance = math.hypot(closest_point["x"] - start_x, closest_point["y"] - start_y)
            if best_distance is None or distance < best_distance:
                best_track, best_distance = track, distance
        observations.append({
            "view_id": view_id,
            "team_key": best_track["team_key"] if best_track else None,
            "alliance": best_track["alliance"] if best_track else scoring_zone.get("alliance"),
            "phase": None,
            "observation_type": "fuel_scored",
            "value": {"count": 1, "attribution_distance_px": best_distance},
            "started_ms": start_t,
            "ended_ms": end_t,
            "confidence": 0.7 if best_track else 0.4,  # lower confidence when no robot track could be matched to the origin
            "evidence": {"zone": scoring_zone.get("label"), "trajectory_points": len(trajectory)}
        })
    return observations


def process_view(model, view, config, video_path):
    tracks = {}
    identity_map = config.get("identity_map", {})
    confidence_floor = float(config.get("confidence_floor", 0.35))
    hsv_lower = config.get("hsv_lower", DEFAULT_HSV_LOWER)
    hsv_upper = config.get("hsv_upper", DEFAULT_HSV_UPPER)
    min_piece_area = float(config.get("min_piece_area", DEFAULT_MIN_PIECE_AREA))
    min_circularity = float(config.get("min_circularity", DEFAULT_MIN_CIRCULARITY))
    goal_zones = view.get("goal_zones") or []
    field_mask_polygon = view.get("field_mask")

    capture = cv2.VideoCapture(str(video_path))
    fps = float(view.get("frame_rate") or capture.get(cv2.CAP_PROP_FPS) or 30)
    capture.release()
    names = model.names

    reid = RobotReId()
    piece_tracker = PieceTracker()
    climb_observations = []
    mask = None
    frame_shape = None
    # Per-canonical-id last-known snapshot, kept live regardless of whether
    # the id was actually seen this frame - RobotReId needs it at the exact
    # moment a track disappears (to record where/how fast it was moving and
    # what it looked like), not reconstructed later.
    robot_state = {}
    previously_seen_ids = set()

    for frame_index, result in enumerate(model.track(source=str(video_path), stream=True, persist=True, verbose=False, conf=confidence_floor)):
        timestamp_ms = round(frame_index * 1000 / fps) + int(view.get("sync_offset_ms") or 0)
        frame = result.orig_img
        if frame_shape is None:
            frame_shape = frame.shape
            mask = build_mask(field_mask_polygon, frame_shape)

        seen_ids_this_frame = set()
        if result.boxes is not None:
            for box in result.boxes:
                class_name = str(names[int(box.cls.item())]).lower()
                confidence = float(box.conf.item())
                coords = box.xyxy[0].tolist()
                center = ((coords[0] + coords[2]) / 2, (coords[1] + coords[3]) / 2)
                if mask is not None and mask[min(int(center[1]), mask.shape[0] - 1), min(int(center[0]), mask.shape[1] - 1)] == 0:
                    continue  # outside the calibrated field ROI - audience/background, discard

                if class_name in ("robot_red", "robot_blue") and box.id is not None:
                    alliance = class_name.removeprefix("robot_")
                    histogram = bumper_histogram(frame, coords)
                    raw_tracker_id = int(box.id.item())
                    canonical_id = reid.resolve(raw_tracker_id, frame_index, center, histogram, alliance)
                    seen_ids_this_frame.add(canonical_id)

                    key = f"{view['id']}:{canonical_id}"
                    x, y, calibrated = field_point(center, view.get("homography"))
                    track = tracks.setdefault(key, {
                        "view_id": view["id"], "team_key": identity_map.get(key),
                        "alliance": alliance, "started_ms": timestamp_ms,
                        "ended_ms": timestamp_ms, "identity_confidence": 1 if identity_map.get(key) else 0,
                        "tracking_confidence": confidence, "trajectory": []
                    })
                    track["needs_review"] = not bool(identity_map.get(key))
                    track["ended_ms"] = timestamp_ms
                    track["tracking_confidence"] = min(track["tracking_confidence"], confidence)
                    track["trajectory"].append({"t": timestamp_ms, "x": x, "y": y, "confidence": confidence, "calibrated": calibrated})

                    previous_state = robot_state.get(canonical_id)
                    velocity = (
                        (center[0] - previous_state["position"][0], center[1] - previous_state["position"][1])
                        if previous_state else (0.0, 0.0)
                    )
                    robot_state[canonical_id] = {"position": center, "velocity": velocity, "histogram": histogram, "alliance": alliance}
                elif class_name.startswith(("climb_attempt", "climb_success")):
                    event_type = "climb_success" if class_name.startswith("climb_success") else "climb_attempt"
                    alliance = "red" if class_name.endswith("_red") else "blue" if class_name.endswith("_blue") else None
                    climb_observations.append({
                        "view_id": view["id"], "team_key": None, "alliance": alliance,
                        "phase": None, "observation_type": event_type,
                        "value": {"level": config.get("default_climb_level")},
                        "started_ms": timestamp_ms, "ended_ms": timestamp_ms,
                        "confidence": confidence,
                        "evidence": {"frame": frame_index, "box": coords, "class_name": class_name}
                    })
                # fuel_scored is deliberately not handled here even if legacy
                # weights still emit it - the classical-CV pipeline below is
                # the sole source of truth for fuel, so an old-style YOLO
                # detection is silently ignored rather than double-counted.

        # Any id seen last frame but not this one just went into occlusion
        # (or left the ROI / match ended) - snapshot it as lost exactly once,
        # at the frame the gap starts, so RobotReId's frames-gone math for a
        # later reappearance is measured from the right origin.
        for lost_id in previously_seen_ids - seen_ids_this_frame:
            state = robot_state.get(lost_id)
            if state:
                reid.mark_lost(lost_id, frame_index, state["position"], state["velocity"], state["histogram"], state["alliance"])
        previously_seen_ids = seen_ids_this_frame

        pixel_pieces = detect_game_pieces(frame, mask, hsv_lower, hsv_upper, min_piece_area, min_circularity)
        piece_tracker.update(timestamp_ms, pixel_pieces)

    fuel_observations = attribute_scores(piece_tracker.all_trajectories(), list(tracks.values()), goal_zones, frame_shape or (1, 1), view["id"])
    return list(tracks.values()), climb_observations + fuel_observations


def run_job(model, run):
    api("processing", run_id=run["id"])
    all_tracks, all_observations = [], []
    with tempfile.TemporaryDirectory(prefix="spartans-vision-") as directory:
        directory = Path(directory)
        for index, view in enumerate(run.get("views", [])):
            if not view.get("signed_url"):
                raise RuntimeError(f"View {view['id']} has no signed download URL")
            path = directory / f"view-{index}.mp4"
            download(view["signed_url"], path)
            tracks, observations = process_view(model, view, run.get("config") or {}, path)
            all_tracks.extend(tracks)
            all_observations.extend(observations)
    api("complete", run_id=run["id"], tracks=all_tracks, observations=all_observations)


def heartbeat(current_run_id=None, last_error=None):
    # Fleet visibility only - a dashboard reads vision_runners to show
    # online/offline instead of inferring it from "jobs stopped moving."
    # Best-effort: a heartbeat failure (network blip, server restart) must
    # never take down the actual processing loop over a status ping.
    try:
        api("heartbeat", runner_id=RUNNER_ID, model_path=WEIGHTS, current_run_id=current_run_id, last_error=last_error)
    except Exception:
        pass


def main():
    model = YOLO(WEIGHTS)
    last_error = None
    while True:
        heartbeat(last_error=last_error)
        claimed = api("claim", runner_id=RUNNER_ID).get("run")
        if not claimed:
            time.sleep(POLL_SECONDS)
            continue
        heartbeat(current_run_id=claimed["id"])
        try:
            run_job(model, claimed)
            last_error = None
        except Exception as exc:  # runner must always terminate the claimed job
            last_error = str(exc)
            api("fail", run_id=claimed["id"], error=last_error)


if __name__ == "__main__":
    main()
