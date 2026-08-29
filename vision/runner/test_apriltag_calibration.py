"""Tests for AprilTag-assisted field calibration.

Everything here is checked against synthetic ground truth: a camera is placed
at a known pose, tags at known field positions are projected through it, and
the solver has to recover a floor homography that maps those projections back
to the coordinates they started from. That exercises the pose solve, the
floor-plane derivation and the inversion without needing a real field.

The one assumption synthetic tests cannot confirm is the tag corner ordering
convention against real WPILib data; the reprojection gate is what would catch
that being wrong.
"""
import json
import math
import sys
import tempfile
import unittest
from pathlib import Path

import cv2
import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

from apriltag_calibration import (  # noqa: E402
    DEFAULT_TAG_SIZE_M, aruco_unavailable, calibrate_from_frame, camera_matrix_from_fov,
    detect_field_tags, implausible_camera_pose, load_field_layout, points_are_coplanar,
    probe_recording, quaternion_to_matrix, solve_field_homography, tag_corner_field_points,
    tag_dictionary,
)

WIDTH, HEIGHT, FOV = 1920, 1080, 70.0
CAMERA_MATRIX = camera_matrix_from_fov(WIDTH, HEIGHT, FOV)
CAMERA_POSITION = np.array([2.0, 4.0, 5.0])


def yaw(degrees):
    half = math.radians(degrees) / 2
    return (math.cos(half), 0.0, 0.0, math.sin(half))


def look_at(position, target):
    forward = np.array(target, dtype=float) - np.array(position, dtype=float)
    forward /= np.linalg.norm(forward)
    right = np.cross(forward, [0.0, 0.0, 1.0])
    right /= np.linalg.norm(right)
    return np.vstack([right, np.cross(forward, right), forward])


ROTATION = look_at(CAMERA_POSITION, [12.0, 4.0, 0.0])
TRANSLATION = -ROTATION @ CAMERA_POSITION
RVEC = cv2.Rodrigues(ROTATION)[0]


def project(points):
    output, _ = cv2.projectPoints(
        np.asarray(points, dtype=np.float64), RVEC, TRANSLATION.reshape(3, 1),
        CAMERA_MATRIX, np.zeros((5, 1)))
    return output.reshape(-1, 2)


def build_layout(spread=True):
    """Tags on the far wall, plus a side wall when `spread`, which is what
    makes the pose well conditioned in depth."""
    layout = {"tags": {}, "field": {"length": 16.54, "width": 8.21}}
    for index, y in enumerate([2.0, 4.0, 6.0]):
        layout["tags"][index + 1] = {"translation": (16.0, y, 1.5), "quaternion": yaw(180)}
    if spread:
        layout["tags"][4] = {"translation": (10.0, 0.2, 1.2), "quaternion": yaw(90)}
    return layout


def detections_for(layout, tag_size=DEFAULT_TAG_SIZE_M):
    return [
        {"id": tag_id, "corners": project(tag_corner_field_points(tag, tag_size))}
        for tag_id, tag in layout["tags"].items()
    ]


def image_to_field(homography, pixel):
    vector = homography @ np.array([pixel[0], pixel[1], 1.0])
    return vector[:2] / vector[2]


class LayoutParsingTest(unittest.TestCase):
    def test_parses_a_wpilib_layout(self):
        payload = {
            "tags": [{"ID": 7, "pose": {
                "translation": {"x": 1.5, "y": 2.5, "z": 0.3},
                "rotation": {"quaternion": {"W": 1, "X": 0, "Y": 0, "Z": 0}},
            }}],
            "field": {"length": 16.54, "width": 8.21},
        }
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(payload, handle)
            path = handle.name
        layout = load_field_layout(path)
        self.assertEqual(layout["tags"][7]["translation"], (1.5, 2.5, 0.3))
        self.assertEqual(layout["field"]["length"], 16.54)

    def test_a_malformed_tag_does_not_discard_the_whole_layout(self):
        payload = {"tags": [
            {"ID": 1, "pose": {"translation": {"x": 1, "y": 2, "z": 3},
                               "rotation": {"quaternion": {"W": 1, "X": 0, "Y": 0, "Z": 0}}}},
            {"ID": 2, "pose": {"translation": {"x": "nope"}}},
            {"no_id": True},
        ], "field": {}}
        with tempfile.NamedTemporaryFile("w", suffix=".json", delete=False) as handle:
            json.dump(payload, handle)
            path = handle.name
        self.assertEqual(list(load_field_layout(path)["tags"]), [1])


class QuaternionTest(unittest.TestCase):
    def test_identity(self):
        self.assertTrue(np.allclose(quaternion_to_matrix(1, 0, 0, 0), np.eye(3)))

    def test_ninety_degree_yaw_sends_x_to_y(self):
        rotated = quaternion_to_matrix(*yaw(90)) @ np.array([1.0, 0.0, 0.0])
        self.assertTrue(np.allclose(rotated, [0, 1, 0], atol=1e-9))

    def test_an_unnormalized_quaternion_is_normalized(self):
        self.assertTrue(np.allclose(quaternion_to_matrix(2, 0, 0, 0), np.eye(3)))


class SolveTest(unittest.TestCase):
    def setUp(self):
        self.layout = build_layout()
        self.detections = detections_for(self.layout)

    def test_recovers_the_camera_pose_and_a_usable_homography(self):
        homography, diagnostics = solve_field_homography(self.detections, self.layout, CAMERA_MATRIX)
        self.assertIsNotNone(homography, diagnostics.get("reason"))
        self.assertEqual(diagnostics["reason"], "ok")
        self.assertLess(diagnostics["reprojection_error_px"], 0.01)
        self.assertTrue(np.allclose(diagnostics["camera_position_m"], CAMERA_POSITION, atol=0.01))

    def test_floor_points_round_trip_to_the_field_coordinates_they_came_from(self):
        homography, _ = solve_field_homography(self.detections, self.layout, CAMERA_MATRIX)
        for x, y in [(6.0, 3.0), (10.0, 4.0), (12.0, 6.0)]:
            recovered = image_to_field(homography, project([[x, y, 0.0]])[0])
            self.assertLess(float(np.linalg.norm(recovered - np.array([x, y]))), 0.001)

    def test_distances_come_out_in_real_metres(self):
        homography, _ = solve_field_homography(self.detections, self.layout, CAMERA_MATRIX)
        first, second = project([[6.0, 3.0, 0.0]])[0], project([[9.0, 3.0, 0.0]])[0]
        measured = float(np.linalg.norm(image_to_field(homography, first) - image_to_field(homography, second)))
        self.assertAlmostEqual(measured, 3.0, places=2)

    def test_survives_sub_pixel_corner_noise(self):
        rng = np.random.default_rng(1)
        noisy = [dict(d, corners=d["corners"] + rng.normal(0, 0.5, (4, 2))) for d in self.detections]
        homography, diagnostics = solve_field_homography(noisy, self.layout, CAMERA_MATRIX)
        self.assertIsNotNone(homography, diagnostics.get("reason"))


class RefusalTest(unittest.TestCase):
    def setUp(self):
        self.layout = build_layout()
        self.detections = detections_for(self.layout)

    def test_insufficient_tags(self):
        homography, diagnostics = solve_field_homography(self.detections[:1], self.layout, CAMERA_MATRIX)
        self.assertIsNone(homography)
        self.assertIn("at least 2", diagnostics["reason"])

    def test_tags_outside_the_layout_are_ignored(self):
        foreign = [{"id": 404, "corners": self.detections[0]["corners"]}]
        homography, diagnostics = solve_field_homography(foreign, self.layout, CAMERA_MATRIX)
        self.assertIsNone(homography)
        self.assertEqual(diagnostics["tags_matched"], 0)

    def test_missing_intrinsics_is_refused_rather_than_guessed(self):
        homography, diagnostics = solve_field_homography(self.detections, self.layout, None)
        self.assertIsNone(homography)
        self.assertIn("intrinsics", diagnostics["reason"])

    def test_excessive_reprojection_error_from_a_wrong_tag_size(self):
        homography, diagnostics = solve_field_homography(
            self.detections, self.layout, CAMERA_MATRIX, tag_size_m=DEFAULT_TAG_SIZE_M * 2)
        self.assertIsNone(homography)
        self.assertTrue(diagnostics["reason"].startswith("reprojection error"))

    def test_grossly_corrupted_corners(self):
        rng = np.random.default_rng(0)
        noisy = [dict(d, corners=d["corners"] + rng.normal(0, 25, (4, 2))) for d in self.detections]
        homography, diagnostics = solve_field_homography(noisy, self.layout, CAMERA_MATRIX)
        self.assertIsNone(homography)
        self.assertTrue(diagnostics["reason"].startswith("reprojection error"))

    def test_understated_fov_is_caught_by_the_pose_check_not_reprojection(self):
        # The reason the plausibility gate exists: a too-narrow FOV reprojects
        # well within tolerance while putting the camera outside the venue.
        narrow = camera_matrix_from_fov(WIDTH, HEIGHT, 20.0)
        homography, diagnostics = solve_field_homography(self.detections, self.layout, narrow)
        self.assertIsNone(homography)
        self.assertLess(diagnostics["reprojection_error_px"], 6.0)
        self.assertIn("probably wrong", diagnostics["reason"])


class GeometryTest(unittest.TestCase):
    def test_coplanar_tags_are_reported(self):
        layout = build_layout(spread=False)  # one wall only
        _, diagnostics = solve_field_homography(detections_for(layout), layout, CAMERA_MATRIX)
        self.assertTrue(diagnostics["coplanar_tags"])
        self.assertIn("accuracy_note", diagnostics)

    def test_spread_tags_are_not_reported_as_coplanar(self):
        layout = build_layout(spread=True)
        _, diagnostics = solve_field_homography(detections_for(layout), layout, CAMERA_MATRIX)
        self.assertFalse(diagnostics["coplanar_tags"])

    def test_a_one_wall_view_still_solves_despite_the_planar_ambiguity(self):
        # Coplanar PnP has two solutions - the true pose and its mirror. The
        # plausibility check has to pick the one above the floor.
        layout = build_layout(spread=False)
        homography, diagnostics = solve_field_homography(detections_for(layout), layout, CAMERA_MATRIX)
        self.assertIsNotNone(homography, diagnostics.get("reason"))
        self.assertGreater(diagnostics["camera_height_m"], 0)

    def test_coplanarity_helper(self):
        flat = np.array([[0, 0, 1.0], [1, 0, 1.0], [1, 1, 1.0], [0, 1, 1.0]])
        self.assertTrue(points_are_coplanar(flat))
        self.assertFalse(points_are_coplanar(np.vstack([flat, [[0.5, 0.5, 3.0]]])))

    def test_implausible_camera_poses(self):
        field = {"length": 16.54, "width": 8.21}
        self.assertIsNone(implausible_camera_pose([8.0, 4.0, 5.0], field))
        self.assertIsNotNone(implausible_camera_pose([8.0, 4.0, -1.0], field))
        self.assertIsNotNone(implausible_camera_pose([8.0, 4.0, 40.0], field))
        self.assertIsNotNone(implausible_camera_pose([-40.0, 4.0, 5.0], field))
        # With no field dimensions only the height can be judged.
        self.assertIsNone(implausible_camera_pose([-99.0, 99.0, 5.0], {}))


class TagFamilyTest(unittest.TestCase):
    def test_known_family_resolves(self):
        dictionary, reason = tag_dictionary("36h11")
        if aruco_unavailable():
            self.skipTest("this OpenCV build has no aruco")
        self.assertIsNotNone(dictionary)
        self.assertIsNone(reason)

    def test_unknown_family_reports_a_clear_reason(self):
        dictionary, reason = tag_dictionary("not-a-family")
        self.assertIsNone(dictionary)
        self.assertIn("unknown tag family", reason)

    def test_detection_returns_nothing_rather_than_raising_on_a_bad_family(self):
        self.assertEqual(detect_field_tags(np.zeros((64, 64, 3), np.uint8), family="nope"), [])

    def test_calibrate_from_frame_reports_the_family_problem(self):
        homography, diagnostics = calibrate_from_frame(
            np.zeros((64, 64, 3), np.uint8), build_layout(), horizontal_fov_deg=70, family="nope")
        self.assertIsNone(homography)
        self.assertIn("unknown tag family", diagnostics["reason"])


class RenderedDetectionTest(unittest.TestCase):
    """The one test that exercises the real detector rather than synthetic corners."""

    def test_detects_and_solves_from_rendered_markers(self):
        if aruco_unavailable():
            self.skipTest("this OpenCV build has no aruco")
        width, height, fov = 1600, 900, 65.0
        camera_matrix = camera_matrix_from_fov(width, height, fov)
        position = np.array([9.5, 4.1, 3.2])
        rotation = look_at(position, [14.5, 4.1, 1.0])
        translation = -rotation @ position
        rvec = cv2.Rodrigues(rotation)[0]

        layout = {"tags": {}, "field": {"length": 16.54, "width": 8.21}}
        for index, y in enumerate([1.5, 3.0, 4.5, 6.0]):
            layout["tags"][index + 1] = {"translation": (15.5, y, 1.45), "quaternion": yaw(180)}

        def project_local(points):
            output, _ = cv2.projectPoints(
                np.asarray(points, dtype=np.float64), rvec, translation.reshape(3, 1),
                camera_matrix, np.zeros((5, 1)))
            return output.reshape(-1, 2)

        scene = np.full((height, width, 3), 120, dtype=np.uint8)
        dictionary, _ = tag_dictionary("36h11")
        for tag_id, tag in layout["tags"].items():
            corners = project_local(tag_corner_field_points(tag, DEFAULT_TAG_SIZE_M)).astype(np.float32)
            size = 400
            marker = cv2.aruco.generateImageMarker(dictionary, tag_id, size)
            card = np.full((size * 2, size * 2), 255, dtype=np.uint8)
            card[size // 2:size // 2 + size, size // 2:size // 2 + size] = marker
            centre = corners.mean(axis=0)
            card_corners = (centre + (corners - centre) * 2.0).astype(np.float32)
            source = np.array([[0, 0], [card.shape[1], 0], [card.shape[1], card.shape[0]], [0, card.shape[0]]],
                              dtype=np.float32)
            warp = cv2.getPerspectiveTransform(source, card_corners)
            warped = cv2.warpPerspective(cv2.cvtColor(card, cv2.COLOR_GRAY2BGR), warp, (width, height))
            mask = cv2.warpPerspective(np.full(card.shape, 255, dtype=np.uint8), warp, (width, height))
            scene[mask > 0] = warped[mask > 0]

        self.assertEqual(len(detect_field_tags(scene)), 4)
        homography, diagnostics = calibrate_from_frame(scene, layout, horizontal_fov_deg=fov)
        self.assertIsNotNone(homography, diagnostics.get("reason"))
        self.assertLess(float(np.linalg.norm(np.array(diagnostics["camera_position_m"]) - position)), 0.15)

    def test_a_blank_frame_does_not_invent_a_calibration(self):
        blank = np.full((480, 640, 3), 120, dtype=np.uint8)
        self.assertEqual(detect_field_tags(blank), [])
        homography, diagnostics = calibrate_from_frame(blank, build_layout(), horizontal_fov_deg=70)
        self.assertIsNone(homography)
        self.assertEqual(diagnostics["tags_matched"], 0)


class ProbeRecordingTest(unittest.TestCase):
    class FakeCapture:
        def __init__(self, values, opened=True):
            self.values = values
            self.opened = opened

        def isOpened(self):
            return self.opened

        def get(self, prop):
            return self.values.get(prop, 0)

        def release(self):
            pass

    def probe(self, values, opened=True):
        return probe_recording("x.mp4", capture_factory=lambda _p: self.FakeCapture(values, opened))

    def test_reports_resolution_fps_and_duration(self):
        report = self.probe({
            cv2.CAP_PROP_FRAME_WIDTH: 1920, cv2.CAP_PROP_FRAME_HEIGHT: 1080,
            cv2.CAP_PROP_FPS: 30.0, cv2.CAP_PROP_FRAME_COUNT: 4500,
        })
        self.assertTrue(report["readable"])
        self.assertEqual((report["width"], report["height"]), (1920, 1080))
        self.assertAlmostEqual(report["duration_seconds"], 150.0)
        self.assertEqual(report["warnings"], [])

    def test_warns_about_an_unopenable_recording(self):
        report = self.probe({}, opened=False)
        self.assertFalse(report["readable"])
        self.assertTrue(any("could not be opened" in w for w in report["warnings"]))

    def test_warns_about_low_resolution_and_frame_rate(self):
        report = self.probe({
            cv2.CAP_PROP_FRAME_WIDTH: 640, cv2.CAP_PROP_FRAME_HEIGHT: 480,
            cv2.CAP_PROP_FPS: 10.0, cv2.CAP_PROP_FRAME_COUNT: 1500,
        })
        self.assertTrue(any("low resolution" in w for w in report["warnings"]))
        self.assertTrue(any("low frame rate" in w for w in report["warnings"]))

    def test_warns_about_a_recording_shorter_than_a_match(self):
        report = self.probe({
            cv2.CAP_PROP_FRAME_WIDTH: 1920, cv2.CAP_PROP_FRAME_HEIGHT: 1080,
            cv2.CAP_PROP_FPS: 30.0, cv2.CAP_PROP_FRAME_COUNT: 300,
        })
        self.assertTrue(any("probably partial" in w for w in report["warnings"]))

    def test_a_capture_that_raises_is_reported_not_propagated(self):
        def explode(_path):
            raise OSError("no such codec")
        report = probe_recording("x.mp4", capture_factory=explode)
        self.assertFalse(report["readable"])
        self.assertTrue(any("could not open" in w for w in report["warnings"]))


if __name__ == "__main__":
    unittest.main()
