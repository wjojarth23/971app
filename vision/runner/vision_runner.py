#!/usr/bin/env python3
"""Post-match multi-view ML runner.

Requires custom YOLO weights whose class names use this vocabulary:
robot_red, robot_blue, fuel_scored, climb_attempt, climb_success.
Robot tracks are never assigned a team unless the queued run config contains
identity_map entries of the form "<view uuid>:<tracker id>": "frc971".
"""
from __future__ import annotations

import json
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


def process_view(model, view, config, video_path):
    tracks = {}
    observations = []
    identity_map = config.get("identity_map", {})
    confidence_floor = float(config.get("confidence_floor", 0.35))
    capture = cv2.VideoCapture(str(video_path))
    fps = float(view.get("frame_rate") or capture.get(cv2.CAP_PROP_FPS) or 30)
    capture.release()
    names = model.names

    for frame_index, result in enumerate(model.track(source=str(video_path), stream=True, persist=True, verbose=False, conf=confidence_floor)):
        timestamp_ms = round(frame_index * 1000 / fps) + int(view.get("sync_offset_ms") or 0)
        if result.boxes is None:
            continue
        for box in result.boxes:
            class_name = str(names[int(box.cls.item())]).lower()
            confidence = float(box.conf.item())
            coords = box.xyxy[0].tolist()
            center = ((coords[0] + coords[2]) / 2, (coords[1] + coords[3]) / 2)
            if class_name in ("robot_red", "robot_blue") and box.id is not None:
                tracker_id = int(box.id.item())
                key = f"{view['id']}:{tracker_id}"
                x, y, calibrated = field_point(center, view.get("homography"))
                track = tracks.setdefault(key, {
                    "view_id": view["id"], "team_key": identity_map.get(key),
                    "alliance": class_name.removeprefix("robot_"), "started_ms": timestamp_ms,
                    "ended_ms": timestamp_ms, "identity_confidence": 1 if identity_map.get(key) else 0,
                    "tracking_confidence": confidence, "trajectory": [], "needs_review": not bool(identity_map.get(key))
                })
                track["ended_ms"] = timestamp_ms
                track["tracking_confidence"] = min(track["tracking_confidence"], confidence)
                track["trajectory"].append({"t": timestamp_ms, "x": x, "y": y, "confidence": confidence, "calibrated": calibrated})
            elif class_name.startswith(("fuel_scored", "climb_attempt", "climb_success")):
                event_type = "fuel_scored" if class_name.startswith("fuel_scored") else ("climb_success" if class_name.startswith("climb_success") else "climb_attempt")
                alliance = "red" if class_name.endswith("_red") else "blue" if class_name.endswith("_blue") else None
                observations.append({
                    "view_id": view["id"], "team_key": None, "alliance": alliance,
                    "phase": None, "observation_type": event_type,
                    "value": {"count": 1} if event_type == "fuel_scored" else {"level": config.get("default_climb_level")},
                    "started_ms": timestamp_ms, "ended_ms": timestamp_ms,
                    "confidence": confidence,
                    "evidence": {"frame": frame_index, "box": coords, "class_name": class_name}
                })
    return list(tracks.values()), observations


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


def main():
    model = YOLO(WEIGHTS)
    while True:
        claimed = api("claim", runner_id=RUNNER_ID).get("run")
        if not claimed:
            time.sleep(POLL_SECONDS)
            continue
        try:
            run_job(model, claimed)
        except Exception as exc:  # runner must always terminate the claimed job
            api("fail", run_id=claimed["id"], error=str(exc))


if __name__ == "__main__":
    main()
