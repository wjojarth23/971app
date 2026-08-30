#!/usr/bin/env python3
"""Fail when frames from one source match leak across dataset splits."""
from __future__ import annotations

import argparse
from collections import defaultdict
from pathlib import Path


def source_id(path: Path):
    return path.stem.split("__", 1)[0]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", help="Dataset root containing images/train|val|test")
    args = parser.parse_args()
    root = Path(args.dataset).resolve()
    membership = defaultdict(set)
    counts = {}
    for split in ("train", "val", "test"):
        images = [path for path in (root / "images" / split).glob("*") if path.suffix.lower() in {".jpg", ".jpeg", ".png"}]
        counts[split] = len(images)
        for image in images:
            membership[source_id(image)].add(split)
            label = root / "labels" / split / f"{image.stem}.txt"
            if not label.exists():
                raise SystemExit(f"Missing label: {label}")
    leaked = {source: sorted(splits) for source, splits in membership.items() if len(splits) > 1}
    if leaked:
        for source, splits in leaked.items():
            print(f"LEAK: {source} appears in {', '.join(splits)}")
        raise SystemExit("Dataset split leakage detected")
    if not counts.get("test"):
        raise SystemExit("A held-out test split is required")
    print(f"Valid match-level splits: {counts}")


if __name__ == "__main__":
    main()
