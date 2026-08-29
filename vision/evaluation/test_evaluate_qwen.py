import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from evaluate_qwen import evaluate


class EvaluateQwenTest(unittest.TestCase):
    def test_reports_matches_hallucinations_timing_and_camera_agreement(self):
        truth = [{"match_key": "qm1", "alliance": "red", "type": "fuel_scored", "timestamp_ms": 1000, "box": [0, 0, 100, 100]}]
        predictions = [
            {"match_key": "qm1", "view_name": "wide", "alliance": "red", "type": "fuel_scored", "timestamp_ms": 1100, "box": [0, 0, 100, 100]},
            {"match_key": "qm1", "view_name": "goal", "alliance": "red", "type": "fuel_scored", "timestamp_ms": 1200, "box": [0, 0, 100, 100]},
        ]
        metrics = evaluate(truth, predictions, tolerance_ms=500)
        self.assertEqual(metrics["matched_events"], 1)
        self.assertEqual(metrics["false_positives"], 0)
        self.assertEqual(metrics["timestamp_mae_ms"], 100)
        self.assertEqual(metrics["mean_box_iou"], 1)
        self.assertEqual(metrics["multi_camera"]["multi_camera_clusters"], 1)

    def test_climb_confusion_records_attempt_vs_success(self):
        truth = [{"match_key": "qm1", "alliance": "blue", "type": "climb_success", "timestamp_ms": 140000}]
        predictions = [{"match_key": "qm1", "alliance": "blue", "type": "climb_attempt", "timestamp_ms": 140200}]
        metrics = evaluate(truth, predictions, tolerance_ms=500)
        self.assertEqual(metrics["climb_confusion"]["climb_success"]["climb_attempt"], 1)

    def test_nearby_events_from_the_same_camera_are_not_deduplicated(self):
        truth = [
            {"match_key": "qm1", "alliance": "red", "type": "fuel_scored", "timestamp_ms": 1000},
            {"match_key": "qm1", "alliance": "red", "type": "fuel_scored", "timestamp_ms": 1300},
        ]
        predictions = [
            {**event, "view_name": "wide", "confidence": 0.9}
            for event in truth
        ]
        metrics = evaluate(truth, predictions, tolerance_ms=500)
        self.assertEqual(metrics["predicted_event_clusters"], 2)
        self.assertEqual(metrics["matched_events"], 2)


if __name__ == "__main__":
    unittest.main()
