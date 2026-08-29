# Vision ML Runner

Private post-match worker for `/scouting/vision`. It downloads every camera
view through one-hour signed URLs, runs versioned custom Ultralytics YOLO
weights, tracks robots, emits trajectory/action evidence, and reports results
to the authenticated runner API. The web app never receives model weights or
the runner token.

This dense tracking worker complements the offline Qwen3-VL bootstrap in
`vision/training/bootstrap_annotate.py`. Qwen proposes semantic events for
human review; this worker provides deterministic per-frame tracks and mobility
metrics. Qwen does not replace the tracker or write production observations
directly.

Required environment:

```text
VISION_API_URL=https://your-spartans-hub-origin
VISION_RUNNER_TOKEN=shared-secret
VISION_RUNNER_ID=vision-runner-gpu-1
VISION_MODEL_PATH=/models/frc-vision-v1.pt
```

Install and run:

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python vision_runner.py
```

The supplied weights must define `robot_red`, `robot_blue`, `fuel_scored`,
`climb_attempt`, and `climb_success` classes (alliance suffixes are supported
for action classes). A model cannot identify a specific FRC team from alliance
color alone. Queue configuration may provide an audited `identity_map` from
`<view id>:<tracker id>` to `frcNNNN`; unidentified tracks are marked for human
review instead of guessed.
