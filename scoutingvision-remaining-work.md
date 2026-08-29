# Vision Scouting — what's left before this actually works

Everything in `scoutingvision.md` is built, merged, and the schema is live
in production. This doc tracks the gap between "the code and tables exist"
and "this produces a trustworthy scouting number for a real match." Updated
after doing as much of the groundwork as is actually possible from a repo
checkout alone — the remaining items genuinely need a human with GCP
console access, physical hardware, or real match footage; nothing left here
is something more code could resolve on its own.

## 1. Done in this pass

- **`VISION_RUNNER_TOKEN` deploy wiring is ready, not yet live.**
  `cloudbuild.yaml` now has a `!!! REMINDER !!!` block (mirroring the
  existing `CRON_NOTIFICATION_TOKEN` one) with the exact `gcloud secrets
  create` + IAM-binding commands, deliberately **not** wired into
  `--set-secrets` yet — adding the reference before the secret exists would
  break the next deploy the same way the cron gap already did once. Someone
  with `spartanshub` GCP project access needs to actually run those two
  `gcloud` commands (verified this session's own `gcloud` auth points at an
  unrelated project, `geminiapi-469220` — not something to run blind
  against), then move the one line from the comment into `--set-secrets`.
- **`vision/runner/.env.example`** — a ready-to-copy local config template
  (all four required vars, one generated example token for illustration
  only — not a real secret, must be regenerated with `openssl rand -hex 32`).
- **A real deployment target for the runner now exists**, three ways,
  because it wasn't clear which hardware this will end up on:
  - `vision/runner/Dockerfile` + `vision/runner/docker-compose.yml`, for a
    host with Docker + the NVIDIA Container Toolkit.
  - `vision/runner/vision-runner.service`, a systemd unit for running
    directly on a bare-metal/VM GPU host (e.g. a repurposed gaming PC).
  - Manual `venv` + `python vision_runner.py`, already documented, now with
    an actual `.env.example` to copy instead of hand-assembling four vars.
  None of these are *running* anywhere yet — there's still no actual
  provisioned host — but the "how would we even deploy this" question now
  has three concrete, ready-to-use answers instead of zero.
- **A working placeholder-model script**, `vision/training/create_placeholder_model.py`
  — and this was actually run, not just written. It builds a real 6-class
  YOLO checkpoint (`robot_red`/`robot_blue`/`climb_attempt_red`/
  `climb_attempt_blue`/`climb_success_red`/`climb_success_blue`) from a
  stock `yolo11n.pt` base via one throwaway epoch on synthetic data purely
  to force the detection head to reshape — confirmed the output actually
  loads with `ultralytics.YOLO()` and survives a real `model.track(source=...,
  stream=True, ...)` call the exact way `vision_runner.py`'s `process_view()`
  calls it. Its detections are meaningless noise (never trained on anything
  real) — it exists solely to test `claim`/`heartbeat`/`complete` plumbing
  before investing in real data.
- **That test run surfaced a real, separate bug**: `model.track()` needs the
  `lap` package, which wasn't in `vision/runner/requirements.txt` — it
  silently auto-installed itself mid-run in testing, which would mean an
  unexpected network dependency and a slower first inference on a real
  deploy host, or an outright failure on a host without open internet
  access. Now pinned (`lap==0.5.13`) so a plain `pip install -r
  requirements.txt` is actually sufficient.
- `*.pt` files and `vision/**/models/` are now gitignored — placeholder or
  real, model weights were never meant to be committed (already stated in
  `scoutingvision.md`); now actually enforced.

## 2. Still blocked on something only a human can do

### Run the two `gcloud` commands (5 minutes, needs GCP console access)

```bash
openssl rand -hex 32 | gcloud secrets create VISION_RUNNER_TOKEN --project=spartanshub --data-file=-
gcloud secrets add-iam-policy-binding VISION_RUNNER_TOKEN --project=spartanshub \
  --member="serviceAccount:819718873862-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Then move `VISION_RUNNER_TOKEN=VISION_RUNNER_TOKEN:latest` from the comment
block into `cloudbuild.yaml`'s `--set-secrets` line, and put the same secret
value into whichever host ends up running the runner. Until this happens,
`api/vision-runner` rejects every request — this is still the single
hardest blocker, just now fully spelled out with the exact commands.

### Provision an actual runner host

The Dockerfile/compose file/systemd unit all exist now, but none of them
are running anywhere — there's no GPU machine actually provisioned and
network-reachable from this app yet. This is a hardware/ops decision
(buy/repurpose a machine, decide who's responsible for keeping it on),
not something further code changes here can resolve.

### Real training data and a real trained model

`create_placeholder_model.py` proves the plumbing works; it does not
produce anything that detects a real robot or game piece. Getting a real
model still needs, in order: actual match recordings from a fixed elevated
camera (no camera is procured yet either), frame extraction + manual
labeling (CVAT or similar — no labeled dataset exists), a real
`train_model.py` run, and evaluation against the acceptance gates already
documented in `implementations/vision-scouting-system.md`. None of this is
skippable by more scripting — it's real data collection and human labeling
time.

### No visual calibration tool

Field mask, goal zones, homography, and HSV thresholds are still hand-typed
JSON/numbers on the upload and run-queue forms — nothing built this pass
changes that. Someone has to compute a homography matrix and polygon
coordinates by hand per venue. Flagged again because it compounds with "no
camera yet" — even once a camera exists, calibrating it will be a manual,
somewhat expert-only step until a click-to-draw tool exists.

### The hybrid pipeline has still never touched real footage

Everything new (`detect_game_pieces`, `PieceTracker`, `attribute_scores`,
`RobotReId`) is verified correct in isolation (synthetic fixtures, and now
also confirmed to survive real `ultralytics` calls, not just pass in a
mocked test) — but zero of it has processed an actual robot or an actual
game piece yet. Expect the default HSV range and every threshold constant
to need retuning once real footage exists.

### Model acceptance gates are still a human process, not a code gate

Unchanged from before: nothing in `release-run` checks model quality before
allowing a release. Still worth a decision — keep it a documented,
trust-based process, or add an actual `approved_for_release` check.

## Suggested order (unchanged, still the right sequence)

1. Run the two `gcloud` commands above — the fastest remaining unblock.
2. Stand up *any* runner host (a laptop is fine for this step) using
   whichever of the three new deployment options fits, point it at the
   placeholder model, and confirm a full `queue-run` → `claim` → `complete`
   cycle actually happens end to end against the real deployed app.
3. Get one real recording (any camera, even a phone) through the pipeline
   by hand to see what the hybrid detection actually produces before
   investing in labeling/training.
4. Only then: real camera hardware, a labeled dataset, an actual trained
   model, and a visual calibration tool if hand-typed JSON proves too
   painful in practice.
