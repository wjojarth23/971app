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


if __name__ == "__main__":
    unittest.main()
