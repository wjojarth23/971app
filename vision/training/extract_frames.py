#!/usr/bin/env python3
"""Extract deterministic labeling frames without creating leaky train splits."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

import cv2


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("videos", nargs="+", help="One or more match recordings")
    parser.add_argument("--output", required=True, help="Unsplit labeling-image directory")
    parser.add_argument("--sample-fps", type=float, default=2.0)
    parser.add_argument("--start-seconds", type=float, default=0)
    parser.add_argument("--end-seconds", type=float)
    args = parser.parse_args()
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    manifest = []

    for raw_path in args.videos:
        path = Path(raw_path).resolve()
        capture = cv2.VideoCapture(str(path))
        source_fps = capture.get(cv2.CAP_PROP_FPS)
        if not source_fps:
            raise RuntimeError(f"Could not read frame rate: {path}")
        step = max(1, round(source_fps / args.sample_fps))
        start_frame = round(args.start_seconds * source_fps)
        end_frame = round(args.end_seconds * source_fps) if args.end_seconds else None
        capture.set(cv2.CAP_PROP_POS_FRAMES, start_frame)
        frame_index = start_frame
        written = 0
        while True:
            ok, frame = capture.read()
            if not ok or (end_frame is not None and frame_index > end_frame):
                break
            if (frame_index - start_frame) % step == 0:
                timestamp_ms = round(frame_index * 1000 / source_fps)
                name = f"{path.stem}__{timestamp_ms:09d}ms.jpg"
                target = output / name
                if not cv2.imwrite(str(target), frame, [cv2.IMWRITE_JPEG_QUALITY, 92]):
                    raise RuntimeError(f"Could not write {target}")
                manifest.append({"image": name, "source_video": str(path), "source_frame": frame_index, "timestamp_ms": timestamp_ms})
                written += 1
            frame_index += 1
        capture.release()
        print(f"{path.name}: {written} frames")

    (output / "extraction-manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(manifest)} frames to {output}")


if __name__ == "__main__":
    main()
