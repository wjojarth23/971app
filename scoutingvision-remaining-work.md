# Vision Scouting — what's left before this actually works

This doc tracks the gap between "the code exists" and "this produces a
trustworthy scouting number for a real match." Updated after doing as much of
the groundwork as is actually possible from a repo checkout alone — the
remaining items genuinely need a human with GCP console access, physical
hardware, or real match footage; nothing left here is something more code
could resolve on its own.

## DGX Spark / Qwen3-VL-30B addition

The repository now has a concrete DGX Spark stack for the full BF16
`Qwen/Qwen3-VL-30B-A3B-Instruct` checkpoint:

- `vision/qwen/` is an authenticated, single-concurrency inference service
  using the MoE-specific Transformers class and BF16 weights with no
  BitsAndBytes quantization.
- `vision/runner/docker-compose.yml` starts Qwen and the dense tracking
  runner together from configurable NVIDIA NGC PyTorch ARM64/CUDA images,
  persists the Hugging Face cache, and blocks the runner until Qwen is ready.
- The dense runner sends bounded timestamped JPEG sequences, stores Qwen
  source/model/latency evidence, and reports Qwen health on its fleet
  heartbeat.
- `20260829_vision_qwen30b_dgx.sql` (**applied**) makes every model
  observation explicitly reviewable. The release bridge now excludes anything
  not human-accepted or corrected.

Note there is no LM Studio anywhere in this design, and no inbound path from
the internet to anyone's personal machine: Qwen and the runner are two
containers on the same DGX host talking over a private Compose network
(`http://qwen:8000`). So there is no inbound rate limiting to add, and no
Qwen API key that needs to reach GCP Secret Manager — `VISION_QWEN_TOKEN`
only ever exists on the DGX box. `VISION_RUNNER_TOKEN` remains the one secret
the deployed web app actually needs.

Still requiring operator action: provision the DGX Spark, replace both
example secrets, pin `VISION_QWEN_REVISION`, authenticate Docker to NVIDIA
NGC, download the 60+ GB model cache, and run a real-video acceptance pass.
Code cannot truthfully certify hardware it cannot access.

## Fixed since the Qwen pipeline landed

Four defects found by reading the merged Qwen work, all fixed and verified
against synthetic fixtures (see `scoutingvision.md` for the design detail):

- **One malformed clip no longer discards an entire run.** `/analyze` returns
  422 whenever the model emits unparseable JSON; the per-clip request had no
  error handling, so a single bad response threw away every YOLO track and
  classical-CV observation for all views and failed the run. Failed clips are
  now recorded `clip_quality='unusable'` with the error body and skipped —
  but an all-clips-failed run still fails loudly, so an outage can't
  masquerade as Qwen agreeing with the pipeline.
- **Qwen climb/disabled events are now team-attributable.** Every Qwen
  observation was hardcoded `team_key: None`, and the release bridge skips
  team-less rows — so "Accept" contributed nothing and a human had to retype a
  team on every event. Robot-centric events now match against the YOLO tracks
  that already carry `team_key`. `fuel_scored` is deliberately still excluded
  (its box is at the goal, not the shooter).
- **A busy runner no longer reads as offline.** The runner never heartbeated
  during `run_job`, which runs for many minutes, while the dashboard's online
  cutoff is 60s — so a runner was shown Offline for exactly as long as it was
  working. It now heartbeats per view and per Qwen clip.
- **Runner outages now alert.** A runner that loses Qwen stops claiming work
  and reported it nowhere but its own row. `api/notifications/vision-stale-runners`
  plus a 5-minute `pg_cron` sweep now DMs the `vision_notify` list.

Also swapped several hardcoded hex colours on the vision pages for real
design tokens — `var(--red, #c33)` never resolved, because no `--red` token
exists, so those elements silently ignored dark theme.

## Fixed since: the review-to-release path

The pipeline could run without producing anything releasable. Three further
defects, all fixed:

- **Naming a robot did nothing.** `identity_map` is keyed by tracker IDs that
  don't exist until a run finishes, so a first run attributes nothing, and the
  identity editor was the intended recovery. But `update-track` wrote only to
  `vision_tracks`, `vision_observations.track_id` was a designed-but-never-
  populated column, and `summarizeVision` reads team identity solely off
  observations — so a carefully identified track released nothing, and the
  only working path was correcting every observation by hand. Observations now
  carry the `track_key` of the robot they were attributed to, `complete`
  resolves those into real `track_id` FKs, and `update-track` cascades the team
  to that track's unreviewed observations. Naming one robot now attributes all
  of its events.
- **YOLO climbs were never attributed at all.** They fire on the climbing
  structure rather than a tracked robot and were hardcoded `team_key: None`.
  `attribute_climbs` now resolves each to the nearest same-alliance robot
  track, deferred until after the frame loop so the tracks are complete.
- **Every climb was silently dropped at release.** `release-run` only accepts
  a real `climb_pos` value, but nothing could produce one: no UI field set
  `default_climb_level`, so the value fell back to the literal `'success'`,
  which is refused. There is now a Default climb level select on the run form,
  Qwen is told the real vocabulary and has invented values clamped away, and
  refusals are reported in the response and the UI instead of vanishing.

Plus a bulk review path (`review-observations`, up to 500 ids) with source /
status / confidence filters, since clearing a match's proposals one click at a
time was slower than scouting the match by hand.

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
  (runner, Qwen, memory-bound, and model-revision vars; one generated example token for illustration
  only — not a real secret, must be regenerated with `openssl rand -hex 32`).
- **A real deployment target for the runner now exists**, three ways,
  because it wasn't clear which hardware this will end up on:
  - `vision/runner/Dockerfile` + `vision/runner/docker-compose.yml`, for a
    host with Docker + the NVIDIA Container Toolkit.
  - `vision/runner/vision-runner.service`, a fallback systemd unit for
    running the dense tracker directly on the DGX host.
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

### Measure Qwen throughput before trusting the clip schedule

Nothing here can be settled without the actual Spark, and it may force a
design change rather than a tuning tweak. Clips are analyzed strictly
serially: roughly 30 per view for a 150-second match at the default 5-second
clip length, each a blocking HTTP call carrying 8 images at 1280x720, and the
service holds a single inference lock so nothing overlaps. At a plausible
30-60s per clip that is 15-30 minutes per view, multiplied by the number of
camera views per match. A qualification day running a match every ~7 minutes
would fall behind immediately.

Time one real clip on the Spark first, then decide. The cheap levers, roughly
in order of what they cost you:

- `VISION_QWEN_FRAMES_PER_CLIP` (8 -> 4) and `VISION_QWEN_JPEG_WIDTH`
  (1280 -> 960) — straight latency reduction, some loss of small-object
  detail.
- `VISION_QWEN_CLIP_SECONDS` (5 -> 10) — halves the request count, at the
  cost of coarser event timestamps.
- Only send clips where the deterministic pipeline already saw activity. This
  is the big one — most of a match is not a scoring or climbing moment — and
  it would cut hallucination surface as well as time. It is a real behaviour
  change, so it wants real footage to validate against, not a guess.

`sample_qwen_clip` also reopens and re-seeks the video file for every clip,
which is wasteful but irrelevant next to inference time; don't bother
optimizing it until the numbers above say it matters.

### Provision the DGX Spark runner host

The Docker/Compose and systemd units exist, but they are not running on the
planned DGX Spark yet. Install current DGX OS updates, NVIDIA Container
Toolkit/NGC credentials, copy the runner `.env`, pin the model revision, and
decide who owns uptime and model-cache maintenance.

### Real training data and a real YOLO tracker model

The Qwen checkpoint is pretrained and does not need local training to begin
reviewed trials. `create_placeholder_model.py` proves the dense tracker
plumbing works; it does not
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

## Suggested order

1. Run the two `gcloud` commands above. (The Qwen/DGX migration is already
   applied; `20260829_vision_runner_health_cron.sql` is the one to hold until
   this branch merges.)
2. Stand up the DGX Spark Compose stack, pin the Qwen revision, point the
   dense runner at the placeholder model, and confirm a full `queue-run` →
   `claim` → Qwen analysis → `complete` cycle against the deployed app.
3. Time a single Qwen clip on that stack before anything else — the answer
   decides whether the current clip schedule is viable at a competition or
   needs the activity-gating change described above.
4. Get one real recording (any camera, even a phone) through the pipeline
   by hand to see what the hybrid detection actually produces before
   investing in labeling/training.
5. Only then: real camera hardware, a labeled dataset, an actual trained
   model, and a visual calibration tool if hand-typed JSON proves too
   painful in practice.
