# Vision ML Runner

Private post-match worker for `/scouting/vision`. It downloads every camera
view through one-hour signed URLs, runs a hybrid detection pipeline, tracks
robots, emits trajectory/action/scoring evidence, and reports results to the
authenticated runner API. The web app never receives model weights or the
runner token.

**Hybrid pipeline** (adapted from community R&D shared on Chief Delphi,
"Computer Vision Scouting" - see `scoutingvision.md` for the full writeup):

- **Robots**: versioned custom Ultralytics YOLO weights + built-in
  cross-frame tracking, plus a velocity+color-histogram re-identification
  pass (`RobotReId`) that recovers a robot's tracked identity across a brief
  occlusion instead of splitting it into two unrelated tracks.
- **Game pieces (fuel)**: *not* a YOLO class - classical HSV color
  thresholding + contour/circularity filtering (`detect_game_pieces`),
  tracked frame-to-frame (`PieceTracker`), and attributed to a scoring robot
  by tracing a piece's trajectory back to its origin and finding the closest
  robot track at that moment (`attribute_scores`) - not whichever robot is
  nearest the goal when the piece lands.

Requires a per-view **field mask** (audience/background exclusion) and
**goal zone** calibration (where a scored piece's trajectory should end) to
get useful output - see the upload form on `/scouting/vision`.

This worker complements the offline Qwen3-VL bootstrap in
`vision/training/bootstrap_annotate.py`. Qwen proposes semantic events for
human review; this worker provides deterministic per-frame tracks, mobility
metrics, and piece attribution. Qwen does not replace the tracker or write
production observations directly.

Required environment:

```text
VISION_API_URL=https://your-spartans-hub-origin
VISION_RUNNER_TOKEN=shared-secret
VISION_RUNNER_ID=vision-runner-gpu-1
VISION_MODEL_PATH=/models/frc-vision-v1.pt
```

Manual install and run (quickest way to test on a machine you already have
a shell on):

```bash
cp .env.example .env   # then fill in real values
set -a; source .env; set +a
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python vision_runner.py
```

## Deployment (long-running - pick one)

This has to run continuously on a real machine somewhere, not on Cloud Run
(no GPU support there, and this polls for work rather than serving inbound
requests). No such host is provisioned yet as of this doc - see
`../../scoutingvision-remaining-work.md`. Three ready-to-use options,
depending on what hardware ends up hosting this:

- **`Dockerfile`** + **`docker-compose.yml`** - if the host has Docker and
  the NVIDIA Container Toolkit set up. `cp .env.example .env`, fill it in,
  `mkdir models` and drop a `.pt` file in it, then `docker compose up -d
  --build`.
- **`vision-runner.service`** - a systemd unit for running directly on a
  bare-metal/VM GPU host without Docker (e.g. a repurposed gaming PC).
  Install steps are in the file's own header comment.

Either way, `VISION_RUNNER_TOKEN` must be set to the *same* value as the web
service's `VISION_RUNNER_TOKEN` secret (not yet created in Secret Manager -
see the reminder block in `../../cloudbuild.yaml`), and `VISION_MODEL_PATH`
must point at real trained weights (also not built yet - see
`../training/create_placeholder_model.py` for a non-functional stand-in
that at least exercises the claim/heartbeat/complete plumbing).

The supplied weights must define `robot_red`, `robot_blue`, `climb_attempt`,
and `climb_success` classes (alliance suffixes supported for action classes).
**Do not train a `fuel_scored` class** - fuel detection is the classical CV
pipeline above, tuned via `vision_runs.config` (`hsv_lower`/`hsv_upper`/
`min_piece_area`/`min_circularity`), not trained weights; any `fuel_scored`
box a legacy model still emits is explicitly ignored rather than
double-counted. A model cannot identify a specific FRC team from alliance
color alone. Queue configuration may provide an audited `identity_map` from
`<view id>:<tracker id>` to `frcNNNN`; unidentified tracks are marked for human
review instead of guessed.

Every poll iteration - whether or not it claims a job - also sends a
`heartbeat` (runner id, model path, current run, last error) so the event
dashboard can show this runner as online/offline instead of that only being
inferable from "jobs stopped moving." A heartbeat failure never blocks or
crashes the actual processing loop.
