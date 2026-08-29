# Vision scouting system

Restricted post-match ML analysis at `/scouting/vision`. This route is not
linked from public navigation and requires the `VISION_REVIEW` permission.
Raw recordings use the private `vision-recordings` Supabase bucket.

## Capture contract

- Fixed, elevated, landscape camera; full field remains visible.
- Prefer 4K60, locked focus/exposure/white balance, no digital zoom.
- Multiple synchronized views are supported. Each view records a signed
  storage path, camera position, millisecond offset, calibration points, and
  optional 3×3 image-to-field homography.
- A homography is required for real-unit mobility metrics. Without one, the
  runner preserves pixel trajectories but they must not be interpreted as
  meters or meters/second.

## Processing boundary

The SvelteKit service queues metadata only. A separate GPU-capable runner in
`vision/runner/` claims jobs with `VISION_RUNNER_TOKEN`, receives one-hour
signed URLs, runs custom versioned Ultralytics YOLO weights, and submits robot
tracks and action observations. The runner must always complete or fail a
claimed run, following the same terminal-state invariant used by AutoCAM.

Required model class vocabulary is documented in the runner README. Custom
trained weights are deliberately not committed: recordings must be labeled,
split by match/event (never random adjacent frames), trained, evaluated, and
versioned before deployment. Unknown team identity is review-required, never
guessed from alliance color.

`vision/training/bootstrap_annotate.py` uses 4-bit Qwen3-VL-4B-Instruct to
analyze bounded, timestamped clips from one or more camera views and propose
grounded robot, fuel, climb, and immobility evidence. Every proposal and raw
response remains explicitly unreviewed until corrected by a human. Once
reviewed seed detector weights exist, `bootstrap_yolo_annotate.py` supplies a
faster dense pseudo-labeling pass. Qwen performs semantic event reasoning;
YOLO/ByteTrack remains responsible for repeatable boxes and mobility tracks.
Neither model output flows directly into a released model or scouting result.

## Data flow

1. A reviewer creates a `vision_matches` row and uploads one or more
   `vision_views` using signed upload URLs.
2. A `vision_runs` job records immutable model name/version/config.
3. The runner emits `vision_tracks` (trajectories + mobility metrics) and
   `vision_observations` (fuel, climb, mobility, disabled, identity evidence).
4. Multi-view action observations within the deduplication window are fused.
5. Robot results aggregate to alliance totals and compare with a TBA match
   snapshot where compatible official breakdown fields exist.
6. Material differences become `vision_discrepancies`; raw results remain
   immutable while reviewers record a separate resolution and notes.

## Metrics and review

Mobility derives from calibrated field-coordinate trajectories: distance,
median/P90/max speed, mean acceleration, P90 turn rate, moving/stationary time,
and coverage. Gaps over one second and low-confidence points are excluded.

Default discrepancy thresholds require both more than three fuel and more
than 15% alliance-level difference. Climb-count disagreement is critical.
TBA is authoritative for official alliance results, but cannot normally
attribute an alliance total to an individual robot; robot attribution remains
Vision/human-scouter evidence and requires human review when uncertain.

Review resolutions are `accepted_vision`, `accepted_reference`, `corrected`,
`unobservable`, or `dismissed`. Evidence and original model output are never
overwritten.

## Deployment configuration

Web service:

```text
VISION_RUNNER_TOKEN=<high-entropy shared secret>
TBA_API_KEY=<existing server-side TBA key>
```

Runner:

```text
VISION_API_URL=https://spartanshub.example
VISION_RUNNER_TOKEN=<same secret>
VISION_RUNNER_ID=vision-runner-gpu-1
VISION_MODEL_PATH=/models/frc-vision-v1.pt
```

Run `migrations/20260828_vision_system.sql`, grant `VISION_REVIEW` only to the
small project group, then deploy the worker separately. No Vision route or
bucket is useful—or intentionally accessible—before those steps.

## Model acceptance gates

Before a model version can affect scouting rankings:

- Evaluate on held-out whole matches from unseen events/camera positions.
- Report per-class precision, recall, and identity-switch rate.
- Report trajectory error in meters after calibration.
- Report alliance fuel absolute error and climb confusion matrix.
- Review every critical discrepancy for the initial event.
- Keep model output advisory until the project owner explicitly enables a
  reviewed-result consumer. This implementation does not silently write Vision
  results into `scout_data_events` or power rankings.
