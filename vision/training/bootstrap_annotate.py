#!/usr/bin/env python3
"""Use Qwen3-VL to propose review-required annotations from match videos."""
from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import cv2
import torch
from PIL import Image
from transformers import AutoProcessor, BitsAndBytesConfig, Qwen3VLForConditionalGeneration

DEFAULT_MODEL = "Qwen/Qwen3-VL-4B-Instruct"
SYSTEM_PROMPT = """You are assisting human reviewers with FRC match-video annotation.
Never invent an event hidden by blur or occlusion. Return only valid JSON matching the
requested schema. Coordinates use [x1,y1,x2,y2] normalized to 0..1000. All output is
provisional and will be reviewed by a human."""
TASK_PROMPT = """Analyze this short chronological sequence of timestamped frames.
Identify only clearly visible evidence for:
- robots: alliance color red/blue/unknown and bounding box
- fuel_scored: a game piece visibly entering a scoring target, with alliance if clear
- climb_attempt and climb_success, with alliance and level if clear
- disabled_or_immobile robots

Do not infer a score merely because a robot shoots. Do not count the same event twice
across adjacent frames. Return exactly this JSON shape:
{"events":[{"type":"robot|fuel_scored|climb_attempt|climb_success|disabled_or_immobile",
"timestamp_ms":0,"alliance":"red|blue|unknown","box":[0,0,0,0],
"confidence":0.0,"evidence":"brief visible reason"}],
"clip_quality":"good|limited|unusable","review_notes":"brief text"}"""


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("videos", nargs="+", help="One or more synchronized camera recordings")
    parser.add_argument("--output", required=True, help="Output review-manifest path")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--match-key")
    parser.add_argument("--view-names", nargs="*", help="Optional camera name for each video")
    parser.add_argument("--clip-seconds", type=float, default=5)
    parser.add_argument("--frames-per-clip", type=int, default=8)
    parser.add_argument("--max-new-tokens", type=int, default=900)
    parser.add_argument("--no-4bit", action="store_true", help="Disable 4-bit loading")
    parser.add_argument("--start-seconds", type=float, default=0)
    parser.add_argument("--end-seconds", type=float)
    args = parser.parse_args()
    if args.clip_seconds <= 0 or args.frames_per_clip < 2:
        parser.error("clip duration must be positive and frames-per-clip must be at least 2")
    if args.view_names and len(args.view_names) != len(args.videos):
        parser.error("--view-names must contain exactly one name per video")
    return args


def load_model(model_name: str, use_4bit: bool):
    options = {"device_map": "auto", "dtype": torch.float16}
    if use_4bit:
        if not torch.cuda.is_available():
            raise SystemExit("4-bit Qwen inference requires CUDA; use --no-4bit for CPU/MPS")
        options["quantization_config"] = BitsAndBytesConfig(
            load_in_4bit=True,
            bnb_4bit_quant_type="nf4",
            bnb_4bit_compute_dtype=torch.float16,
            bnb_4bit_use_double_quant=True,
        )
    model = Qwen3VLForConditionalGeneration.from_pretrained(model_name, **options).eval()
    processor = AutoProcessor.from_pretrained(model_name)
    return model, processor


def video_metadata(path: Path):
    capture = cv2.VideoCapture(str(path))
    fps = float(capture.get(cv2.CAP_PROP_FPS) or 0)
    frames = int(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
    capture.release()
    if fps <= 0 or frames <= 0:
        raise SystemExit(f"Could not read video metadata: {path}")
    return fps, frames, frames / fps


def clip_frames(path: Path, start_s: float, end_s: float, count: int):
    capture = cv2.VideoCapture(str(path))
    timestamps = [start_s + (end_s - start_s) * index / (count - 1) for index in range(count)]
    output = []
    for timestamp in timestamps:
        capture.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
        ok, frame = capture.read()
        if not ok:
            continue
        rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        output.append((round(timestamp * 1000), Image.fromarray(rgb)))
    capture.release()
    return output


def parse_json_response(text: str):
    stripped = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip(), flags=re.I | re.S)
    try:
        return json.loads(stripped), None
    except json.JSONDecodeError as error:
        match = re.search(r"\{.*\}", stripped, flags=re.S)
        if match:
            try:
                return json.loads(match.group()), None
            except json.JSONDecodeError:
                pass
        return None, f"Invalid model JSON: {error}"


def normalize_result(parsed, clip_start_ms: int, clip_end_ms: int):
    if not isinstance(parsed, dict) or not isinstance(parsed.get("events"), list):
        return None, "Response lacks an events array"
    cleaned = []
    allowed_types = {"robot", "fuel_scored", "climb_attempt", "climb_success", "disabled_or_immobile"}
    for event in parsed["events"]:
        if not isinstance(event, dict) or event.get("type") not in allowed_types:
            continue
        try:
            timestamp = int(event.get("timestamp_ms"))
            confidence = max(0.0, min(1.0, float(event.get("confidence", 0))))
        except (TypeError, ValueError):
            continue
        box = event.get("box")
        if not isinstance(box, list) or len(box) != 4:
            box = None
        else:
            try:
                box = [max(0, min(1000, round(float(value)))) for value in box]
            except (TypeError, ValueError):
                box = None
        cleaned.append({
            "type": event["type"],
            "timestamp_ms": max(clip_start_ms, min(clip_end_ms, timestamp)),
            "alliance": event.get("alliance") if event.get("alliance") in {"red", "blue", "unknown"} else "unknown",
            "box_0_1000": box,
            "confidence": confidence,
            "evidence": str(event.get("evidence", ""))[:500],
            "review_status": "unreviewed",
        })
    return {
        "events": cleaned,
        "clip_quality": parsed.get("clip_quality", "limited"),
        "review_notes": str(parsed.get("review_notes", ""))[:1000],
    }, None


def analyze_clip(model, processor, frames, max_new_tokens: int):
    content = []
    for timestamp_ms, image in frames:
        content.extend([
            {"type": "text", "text": f"Frame timestamp_ms={timestamp_ms}"},
            {"type": "image", "image": image},
        ])
    content.append({"type": "text", "text": TASK_PROMPT})
    messages = [
        {"role": "system", "content": [{"type": "text", "text": SYSTEM_PROMPT}]},
        {"role": "user", "content": content},
    ]
    inputs = processor.apply_chat_template(
        messages, tokenize=True, add_generation_prompt=True,
        return_dict=True, return_tensors="pt",
    ).to(model.device)
    with torch.inference_mode():
        generated = model.generate(**inputs, max_new_tokens=max_new_tokens, do_sample=False)
    trimmed = generated[:, inputs["input_ids"].shape[-1]:]
    return processor.batch_decode(trimmed, skip_special_tokens=True, clean_up_tokenization_spaces=False)[0]


def main():
    args = parse_args()
    videos = [Path(raw).resolve() for raw in args.videos]
    for video in videos:
        if not video.is_file():
            raise SystemExit(f"Missing video: {video}")
    views = args.view_names or [video.stem for video in videos]
    model, processor = load_model(args.model, not args.no_4bit)
    clips = []

    for video, view_name in zip(videos, views):
        fps, frame_count, duration = video_metadata(video)
        stop = min(args.end_seconds or duration, duration)
        cursor = args.start_seconds
        while cursor < stop:
            clip_end = min(cursor + args.clip_seconds, stop)
            frames = clip_frames(video, cursor, clip_end, args.frames_per_clip)
            raw = analyze_clip(model, processor, frames, args.max_new_tokens)
            parsed, error = parse_json_response(raw)
            normalized = None
            if not error:
                normalized, error = normalize_result(parsed, round(cursor * 1000), round(clip_end * 1000))
            clips.append({
                "view_name": view_name, "source_video": str(video),
                "start_ms": round(cursor * 1000), "end_ms": round(clip_end * 1000),
                "sampled_timestamps_ms": [timestamp for timestamp, _ in frames],
                "result": normalized, "parse_error": error,
                "raw_response": raw, "review_status": "unreviewed",
            })
            print(f"{view_name} {cursor:.1f}-{clip_end:.1f}s: {len(normalized['events']) if normalized else 0} proposals")
            cursor = clip_end

    manifest = {
        "format_version": 2,
        "created_at": datetime.now(timezone.utc).isoformat(),
        "match_key": args.match_key,
        "model": args.model,
        "quantization": "4bit-nf4" if not args.no_4bit else "none",
        "policy": {"human_review_required": True, "approved_as_ground_truth": False},
        "clips": clips,
    }
    output = Path(args.output).resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(output)


if __name__ == "__main__":
    main()
