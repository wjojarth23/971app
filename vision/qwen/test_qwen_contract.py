import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from qwen_contract import normalize_result, parse_json_response


class QwenContractTest(unittest.TestCase):
    def test_parses_fenced_json(self):
        parsed, error = parse_json_response('```json\n{"events": []}\n```')
        self.assertIsNone(error)
        self.assertEqual(parsed, {"events": []})

    def test_normalizes_and_clamps_untrusted_output(self):
        result, error = normalize_result({"events": [{
            "type": "climb_success", "timestamp_ms": 99999,
            "alliance": "purple", "box": [-5, 20, 1100, 900],
            "confidence": 4, "evidence": "visible latch", "climb_level": "L3",
        }], "clip_quality": "great"}, 1000, 6000)
        self.assertIsNone(error)
        self.assertEqual(result["events"][0]["timestamp_ms"], 6000)
        self.assertEqual(result["events"][0]["alliance"], "unknown")
        self.assertEqual(result["events"][0]["box_0_1000"], [0, 20, 1000, 900])
        self.assertEqual(result["events"][0]["confidence"], 1)
        self.assertEqual(result["events"][0]["review_status"], "unreviewed")
        self.assertEqual(result["clip_quality"], "limited")

    def test_keeps_a_climb_level_from_the_real_vocabulary(self):
        for level in ("L1", "L2", "L3", "Failed", "N/A"):
            result, _ = normalize_result({"events": [{
                "type": "climb_success", "timestamp_ms": 2000,
                "confidence": 0.9, "climb_level": level,
            }]}, 0, 5000)
            self.assertEqual(result["events"][0]["climb_level"], level)

    def test_drops_a_climb_level_outside_the_vocabulary(self):
        # Anything else would be carried to release-run and silently refused
        # there, so it is better to fall back to the run's configured default.
        for level in ("level 3", "deep", "success", "3", ""):
            result, _ = normalize_result({"events": [{
                "type": "climb_success", "timestamp_ms": 2000,
                "confidence": 0.9, "climb_level": level,
            }]}, 0, 5000)
            self.assertIsNone(result["events"][0]["climb_level"], msg=level)


if __name__ == "__main__":
    unittest.main()
