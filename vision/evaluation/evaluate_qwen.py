#!/usr/bin/env python3
"""Evaluate reviewed Qwen event exports against human ground truth."""
from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path


def load_events(path):
    payload = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(payload, list):
        return payload
    if isinstance(payload.get("events"), list):
        return payload["events"]
    events = []
    for clip in payload.get("clips", []):
        for event in (clip.get("result") or {}).get("events", []):
            events.append({
                **event,
                "match_key": clip.get("match_key") or payload.get("match_key"),
                "view_name": clip.get("view_name"),
            })
    return events


def event_key(event):
    return event.get("match_key"), event.get("alliance", "unknown"), event.get("type") or event.get("observation_type")


def timestamp(event):
    return int(event.get("timestamp_ms", event.get("started_ms", 0)))


def box_iou(left, right):
    if not left or not right or len(left) != 4 or len(right) != 4:
        return None
    ax1, ay1, ax2, ay2 = map(float, left)
    bx1, by1, bx2, by2 = map(float, right)
    intersection = max(0, min(ax2, bx2) - max(ax1, bx1)) * max(0, min(ay2, by2) - max(ay1, by1))
    union = max(0, ax2 - ax1) * max(0, ay2 - ay1) + max(0, bx2 - bx1) * max(0, by2 - by1) - intersection
    return intersection / union if union else 0


def greedy_matches(truth, predicted, tolerance_ms):
    remaining = set(range(len(predicted)))
    matches = []
    missed = []
    for actual in truth:
        candidates = [index for index in remaining if event_key(predicted[index]) == event_key(actual)]
        candidates = [index for index in candidates if abs(timestamp(predicted[index]) - timestamp(actual)) <= tolerance_ms]
        if not candidates:
            missed.append(actual)
            continue
        best = min(candidates, key=lambda index: abs(timestamp(predicted[index]) - timestamp(actual)))
        remaining.remove(best)
        matches.append((actual, predicted[best]))
    return matches, missed, [predicted[index] for index in sorted(remaining)]


def cluster_events(events, tolerance_ms):
    ordered = sorted(events, key=timestamp)
    clusters = []
    for event in ordered:
        view_name = event.get("view_name")
        cluster = next((item for item in reversed(clusters)
                        if view_name
                        and all(existing.get("view_name") and existing.get("view_name") != view_name for existing in item)
                        and event_key(item[0]) == event_key(event)
                        and abs(timestamp(item[0]) - timestamp(event)) <= tolerance_ms), None)
        if cluster is None:
            clusters.append([event])
        else:
            cluster.append(event)
    return clusters


def camera_agreement(events, tolerance_ms):
    clusters = cluster_events(events, tolerance_ms)
    supported = sum(1 for cluster in clusters if len({event.get("view_name") for event in cluster if event.get("view_name")}) >= 2)
    return {"clusters": len(clusters), "multi_camera_clusters": supported, "agreement_rate": supported / len(clusters) if clusters else None}


def evaluate(truth, predicted, tolerance_ms=1000):
    prediction_clusters = cluster_events(predicted, tolerance_ms)
    fused_predicted = [max(cluster, key=lambda event: float(event.get("confidence", 0))) for cluster in prediction_clusters]
    matches, missed, false_positives = greedy_matches(truth, fused_predicted, tolerance_ms)
    types = sorted({event_key(event)[2] for event in truth + fused_predicted if event_key(event)[2]})
    per_type = {}
    for event_type in types:
        tp = sum(1 for actual, _ in matches if event_key(actual)[2] == event_type)
        fp = sum(1 for event in false_positives if event_key(event)[2] == event_type)
        fn = sum(1 for event in missed if event_key(event)[2] == event_type)
        per_type[event_type] = {
            "tp": tp, "fp": fp, "fn": fn,
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
        }
    timestamp_errors = [abs(timestamp(actual) - timestamp(prediction)) for actual, prediction in matches]
    ious = [value for actual, prediction in matches if (value := box_iou(actual.get("box_0_1000") or actual.get("box"), prediction.get("box_0_1000") or prediction.get("box"))) is not None]
    fuel_truth = Counter((event.get("match_key"), event.get("alliance")) for event in truth if event_key(event)[2] == "fuel_scored")
    fuel_predicted = Counter((event.get("match_key"), event.get("alliance")) for event in fused_predicted if event_key(event)[2] == "fuel_scored")
    fuel_keys = set(fuel_truth) | set(fuel_predicted)
    fuel_errors = {f"{match}:{alliance}": abs(fuel_truth[(match, alliance)] - fuel_predicted[(match, alliance)]) for match, alliance in fuel_keys}
    climb_confusion = defaultdict(Counter)
    truth_climbs = [event for event in truth if event_key(event)[2] in {"climb_attempt", "climb_success"}]
    predicted_climbs = [event for event in fused_predicted if event_key(event)[2] in {"climb_attempt", "climb_success"}]
    remaining_climbs = set(range(len(predicted_climbs)))
    for actual in truth_climbs:
        candidates = [index for index in remaining_climbs
                      if event_key(predicted_climbs[index])[:2] == event_key(actual)[:2]
                      and abs(timestamp(predicted_climbs[index]) - timestamp(actual)) <= tolerance_ms]
        if not candidates:
            climb_confusion[event_key(actual)[2]]["missed"] += 1
            continue
        best = min(candidates, key=lambda index: abs(timestamp(predicted_climbs[index]) - timestamp(actual)))
        remaining_climbs.remove(best)
        climb_confusion[event_key(actual)[2]][event_key(predicted_climbs[best])[2]] += 1
    total_predictions = len(fused_predicted)
    return {
        "truth_events": len(truth), "raw_predicted_events": len(predicted), "predicted_event_clusters": total_predictions,
        "matched_events": len(matches), "false_positives": len(false_positives), "missed_events": len(missed),
        "hallucination_rate": len(false_positives) / total_predictions if total_predictions else 0,
        "timestamp_mae_ms": sum(timestamp_errors) / len(timestamp_errors) if timestamp_errors else None,
        "mean_box_iou": sum(ious) / len(ious) if ious else None,
        "per_type": per_type, "fuel_absolute_error": fuel_errors,
        "mean_fuel_absolute_error": sum(fuel_errors.values()) / len(fuel_errors) if fuel_errors else None,
        "climb_confusion": {actual: dict(predictions) for actual, predictions in climb_confusion.items()},
        "multi_camera": camera_agreement(predicted, tolerance_ms),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--truth", required=True)
    parser.add_argument("--predictions", required=True)
    parser.add_argument("--output")
    parser.add_argument("--tolerance-ms", type=int, default=1000)
    parser.add_argument("--max-hallucination-rate", type=float, default=0.10)
    parser.add_argument("--max-timestamp-mae-ms", type=float, default=750)
    parser.add_argument("--max-fuel-mae", type=float, default=3)
    parser.add_argument("--fail-on-thresholds", action="store_true")
    args = parser.parse_args()
    metrics = evaluate(load_events(args.truth), load_events(args.predictions), args.tolerance_ms)
    failures = []
    if metrics["hallucination_rate"] > args.max_hallucination_rate:
        failures.append("hallucination_rate")
    if metrics["timestamp_mae_ms"] is not None and metrics["timestamp_mae_ms"] > args.max_timestamp_mae_ms:
        failures.append("timestamp_mae_ms")
    if metrics["mean_fuel_absolute_error"] is not None and metrics["mean_fuel_absolute_error"] > args.max_fuel_mae:
        failures.append("mean_fuel_absolute_error")
    metrics["acceptance_failures"] = failures
    text = json.dumps(metrics, indent=2) + "\n"
    if args.output:
        Path(args.output).write_text(text, encoding="utf-8")
    else:
        print(text, end="")
    if failures and args.fail_on_thresholds:
        raise SystemExit(f"Acceptance thresholds failed: {', '.join(failures)}")


if __name__ == "__main__":
    main()
