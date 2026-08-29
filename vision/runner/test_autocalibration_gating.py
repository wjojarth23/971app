"""Tests for when the runner will and will not calibrate a view automatically.

The precedence rule is the important part: a human who measured this camera
outranks anything solved from tags, and automatic calibration only runs when
somebody explicitly turned it on. Silently substituting slightly-wrong metres
for pixels would be worse than leaving a view uncalibrated, because every
downstream distance would look plausible and be wrong.
"""
import json
import os
import sys
import tempfile
import types
import unittest
from pathlib import Path

RUNNER_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(RUNNER_DIR))

os.environ.setdefault("VISION_API_URL", "https://example.invalid")
os.environ.setdefault("VISION_RUNNER_TOKEN", "test-token")
os.environ.setdefault("VISION_MODEL_PATH", "/dev/null")
os.environ.setdefault("VISION_QWEN_URL", "http://qwen.invalid:8000")
os.environ.setdefault("VISION_QWEN_TOKEN", "test-token")

# The runner imports ultralytics at module scope; these tests never touch the
# detector, so a stub keeps them runnable without model weights installed.
if "ultralytics" not in sys.modules:
    stub = types.ModuleType("ultralytics")
    stub.YOLO = lambda *args, **kwargs: None
    sys.modules["ultralytics"] = stub

import vision_runner  # noqa: E402


def write_layout(tags=True):
    payload = {"field": {"length": 16.54, "width": 8.21}, "tags": []}
    if tags:
        payload["tags"] = [{
            "ID": 1,
            "pose": {"translation": {"x": 16.0, "y": 4.0, "z": 1.5},
                     "rotation": {"quaternion": {"W": 0, "X": 0, "Y": 0, "Z": 1}}},
        }]
    handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
    json.dump(payload, handle)
    handle.close()
    return handle.name


class EnablementTest(unittest.TestCase):
    """Automatic calibration is opt-in twice over: a flag AND a layout."""

    def test_disabled_by_default(self):
        homography, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1"}, {"apriltag_layout_path": write_layout()}, "/tmp/missing.mp4")
        self.assertIsNone(homography)
        self.assertFalse(diagnostics["attempted"])
        self.assertIn("not enabled", diagnostics["reason"])

    def test_enabled_but_no_layout_is_refused(self):
        homography, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1"}, {"apriltag_autocalibrate": True}, "/tmp/missing.mp4")
        self.assertIsNone(homography)
        self.assertFalse(diagnostics["attempted"])
        self.assertIn("no apriltag_layout_path", diagnostics["reason"])

    def test_a_layout_with_no_tags_is_refused(self):
        homography, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1"},
            {"apriltag_autocalibrate": True, "apriltag_layout_path": write_layout(tags=False),
             "camera_horizontal_fov_deg": 70},
            "/tmp/missing.mp4")
        self.assertIsNone(homography)
        self.assertIn("no tags in layout", diagnostics["reason"])

    def test_missing_fov_is_refused_rather_than_guessed(self):
        # Intrinsics estimated from nothing would produce a confidently wrong
        # homography, which is worse than no calibration at all.
        homography, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1"},
            {"apriltag_autocalibrate": True, "apriltag_layout_path": write_layout()},
            "/tmp/missing.mp4")
        self.assertIsNone(homography)
        self.assertIn("camera_horizontal_fov_deg", diagnostics["reason"])

    def test_an_unknown_tag_family_is_reported(self):
        homography, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1"},
            {"apriltag_autocalibrate": True, "apriltag_layout_path": write_layout(),
             "camera_horizontal_fov_deg": 70, "apriltag_family": "not-real"},
            "/tmp/missing.mp4")
        self.assertIsNone(homography)
        self.assertIn("unknown tag family", diagnostics["reason"])

    def test_a_view_level_fov_is_accepted(self):
        homography, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1", "camera_horizontal_fov_deg": 70},
            {"apriltag_autocalibrate": True, "apriltag_layout_path": write_layout()},
            "/tmp/definitely-not-a-video.mp4")
        # No readable video, so it still fails - but past the config checks,
        # which is what this asserts.
        self.assertIsNone(homography)
        self.assertTrue(diagnostics["attempted"])
        self.assertNotIn("camera_horizontal_fov_deg", diagnostics["reason"])


class FailSafeTest(unittest.TestCase):
    def test_an_unreadable_recording_fails_without_raising(self):
        homography, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1"},
            {"apriltag_autocalibrate": True, "apriltag_layout_path": write_layout(),
             "camera_horizontal_fov_deg": 70},
            "/tmp/does-not-exist-at-all.mp4")
        self.assertIsNone(homography)
        self.assertIn("reason", diagnostics)

    def test_a_missing_layout_file_fails_without_raising(self):
        homography, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1"},
            {"apriltag_autocalibrate": True, "apriltag_layout_path": "/tmp/no-such-layout.json",
             "camera_horizontal_fov_deg": 70},
            "/tmp/missing.mp4")
        self.assertIsNone(homography)
        self.assertIn("failed", diagnostics["reason"])

    def test_diagnostics_are_always_json_serializable(self):
        # They travel to the API with the run results, so anything that isn't
        # serializable would fail the whole completion call.
        _, diagnostics = vision_runner.autocalibrate_view(
            {"id": "v1"}, {}, "/tmp/missing.mp4")
        json.dumps(diagnostics)



class ManualPrecedenceTest(unittest.TestCase):
    """A human who measured this camera outranks anything solved from tags."""

    def setUp(self):
        self.calls = []

        def recording_solver(view, config, video_path):
            self.calls.append(view.get("id"))
            return [[9, 9, 9], [9, 9, 9], [9, 9, 9]], {"attempted": True, "reason": "ok"}

        self.solver = recording_solver

    def test_a_manual_homography_is_kept_and_the_solver_is_never_consulted(self):
        manual = [[1, 0, 0], [0, 1, 0], [0, 0, 1]]
        homography, diagnostics = vision_runner.resolve_view_calibration(
            {"id": "v1", "homography": manual},
            {"apriltag_autocalibrate": True, "apriltag_layout_path": write_layout(),
             "camera_horizontal_fov_deg": 70},
            "/tmp/whatever.mp4", solver=self.solver)
        self.assertEqual(homography, manual)
        self.assertEqual(self.calls, [], "solver must not run when a manual homography exists")
        self.assertFalse(diagnostics["attempted"])
        self.assertIn("manual homography", diagnostics["reason"])

    def test_precedence_holds_even_with_automatic_calibration_enabled(self):
        manual = [[2, 0, 1], [0, 2, 1], [0, 0, 1]]
        homography, _ = vision_runner.resolve_view_calibration(
            {"id": "v1", "homography": manual},
            {"apriltag_autocalibrate": True}, "/tmp/whatever.mp4", solver=self.solver)
        self.assertEqual(homography, manual)
        self.assertEqual(self.calls, [])

    def test_the_solver_runs_only_when_no_manual_homography_exists(self):
        homography, diagnostics = vision_runner.resolve_view_calibration(
            {"id": "v2"}, {"apriltag_autocalibrate": True}, "/tmp/whatever.mp4", solver=self.solver)
        self.assertEqual(self.calls, ["v2"])
        self.assertIsNotNone(homography)
        self.assertTrue(diagnostics["attempted"])

    def test_an_empty_homography_is_treated_as_absent(self):
        for empty in (None, [], {}):
            self.calls.clear()
            vision_runner.resolve_view_calibration(
                {"id": "v3", "homography": empty}, {"apriltag_autocalibrate": True},
                "/tmp/whatever.mp4", solver=self.solver)
            self.assertEqual(self.calls, ["v3"], f"{empty!r} should not count as calibrated")

if __name__ == "__main__":
    unittest.main()
