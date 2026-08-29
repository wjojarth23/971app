#!/usr/bin/env python3
"""Train and evaluate a versioned baseline detector for the Vision runner."""
from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
from pathlib import Path

from ultralytics import YOLO


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", required=True, help="YOLO dataset YAML")
    parser.add_argument("--base", default="yolo11n.pt", help="Base weights")
    parser.add_argument("--version", required=True, help="Immutable model version")
    parser.add_argument("--epochs", type=int, default=100)
    parser.add_argument("--imgsz", type=int, default=1280)
    parser.add_argument("--batch", type=int, default=-1)
    parser.add_argument("--output", default="vision-models")
    args = parser.parse_args()

    project = Path(args.output).resolve()
    model = YOLO(args.base)
    result = model.train(
        data=args.data, epochs=args.epochs, imgsz=args.imgsz, batch=args.batch,
        project=str(project), name=args.version, exist_ok=False
    )
    weights = Path(result.save_dir) / "weights" / "best.pt"
    evaluated = YOLO(str(weights)).val(data=args.data, split="test", imgsz=args.imgsz)
    manifest = {
        "model_name": "frc-vision-yolo",
        "model_version": args.version,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "base_weights": args.base,
        "dataset": str(Path(args.data).resolve()),
        "weights": str(weights),
        "metrics": {
            "map50": float(evaluated.box.map50),
            "map50_95": float(evaluated.box.map),
            "precision": float(evaluated.box.mp),
            "recall": float(evaluated.box.mr),
        },
        "acceptance": {
            "requires_match_level_holdout": True,
            "requires_manual_discrepancy_review": True,
            "approved_for_rankings": False,
        },
    }
    manifest_path = weights.parent.parent / "model-manifest.json"
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(manifest_path)


if __name__ == "__main__":
    main()
