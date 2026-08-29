# Vision Scouting — what's left before this actually works

Everything in `scoutingvision.md` is built and merged, and the schema is
live in production (all three migrations applied, verified). But "the code
exists and the tables exist" is not the same as "this produces a trustworthy
scouting number for a real match." This is the gap between those two, in
priority order — hard blockers first, then accuracy/trust gaps, then
tooling/operational gaps. Nothing here is guessed; each item was checked
against the actual repo/deploy config, not assumed.

## 1. Hard blockers — the pipeline cannot run at all yet

### No `VISION_RUNNER_TOKEN` anywhere

Checked `cloudbuild.yaml`, `.env`, and `.env.example` directly: **zero
mentions of `VISION_RUNNER_TOKEN`** in any of them, locally or in the deploy
config. `api/vision-runner`'s `authorized()` check is
`Boolean(expected && supplied && ...)` — with `expected` (the env var)
unset, this is always `false`, so the runner endpoint **rejects every
request, including from a legitimate runner with the right token
configured on its own side.** This isn't a "should probably do" — it's a
complete blocker; no run can ever be claimed, processed, or completed until
this exists.

Fix, following the exact pattern already used for `CRON_NOTIFICATION_TOKEN`
in this same file (see `cloudbuild.yaml`'s comment block and
`docs/deployment/google-cloud-run.md`):

```bash
openssl rand -hex 32 | gcloud secrets create VISION_RUNNER_TOKEN --project=spartanshub --data-file=-
gcloud secrets add-iam-policy-binding VISION_RUNNER_TOKEN --project=spartanshub \
  --member="serviceAccount:<cloud-run-runtime-service-account>" \
  --role="roles/secretmanager.secretAccessor"
```

Then add `VISION_RUNNER_TOKEN=VISION_RUNNER_TOKEN:latest` to
`cloudbuild.yaml`'s `--set-secrets` line (currently ends at
`...TBA_API_KEY=TBA_API_KEY:latest`), and put the *same* value in whatever
environment runs `vision_runner.py` (see next item).

`TBA_API_KEY` and `SUPABASE_SERVICE_KEY` — the other two secrets the vision
backend needs — are **already** in that `--set-secrets` line. Nothing to do
there.

### No runner is actually deployed anywhere

`vision/runner/vision_runner.py` is a script sitting in the repo. There is
**no Dockerfile, systemd unit, Cloud Run job, or any other deployment
target for it** — checked for one and found none; unlike the SvelteKit app
(`Dockerfile` at repo root) or the Fusion Runner (a Fusion 360 add-in, a
completely different "runner" that runs inside someone's CAD session, not a
standalone service), this is the first thing in the repo that needs a
*long-running Python process on a real machine*, and nothing establishes
how that's supposed to be hosted.

Needed:
- A host with a GPU (or at least enough CPU to run YOLO inference at a
  usable speed — the source community's numbers, ~100fps, were on an
  RTX 3060/3070; CPU-only will be far slower per match).
- `pip install -r vision/runner/requirements.txt` (`ultralytics`,
  `opencv-python-headless`, `requests`, `numpy`).
- The four required env vars set (`VISION_API_URL`, `VISION_RUNNER_TOKEN`,
  `VISION_RUNNER_ID`, `VISION_MODEL_PATH`).
- Something keeping it running and restarting it if it crashes/reboots
  (systemd `Restart=always`, a Docker container with a restart policy, a
  scheduled task — anything; currently nothing is committed).
- Outbound network access to `VISION_API_URL` (the deployed app) — no
  inbound port needed, it's a polling client, not a server.

### No trained model exists

`VISION_MODEL_PATH` must point to a real `.pt` file with classes
`robot_red`, `robot_blue`, `climb_attempt`, `climb_success` (alliance-
suffixed) — deliberately not committed to the repo. Right now there is no
model at all, trained or otherwise. The training pipeline
(`vision/training/`) is real, runnable code, but running it requires:

1. Actual match recordings from a fixed elevated camera (see **capture
   hardware**, below — this doesn't exist yet either).
2. Frame extraction (`extract_frames.py`) and manual labeling (the design
   doc says CVAT-style bounding-box annotation; no labeled dataset exists).
3. A `train_model.py` run producing versioned weights + a
   `model-manifest.json`.
4. Evaluation against the **Model acceptance gates** already documented in
   `implementations/vision-scouting-system.md` (per-class precision/recall,
   identity-switch rate, trajectory error in meters, alliance fuel/climb
   error) — this is a real evaluation step, not just "training finished."

Until this exists, `queue-run` can be clicked and a `vision_runs` row
created, but no runner can ever pick it up and produce real output.

## 2. Needed before results should be trusted for anything real

### The hybrid pipeline has never touched real match footage

Every piece of new logic added in this branch — `detect_game_pieces`,
`PieceTracker`, `attribute_scores`, `RobotReId` — was verified against
**synthetic frames and fixtures** (a drawn circle, fabricated trajectories),
with `ultralytics` stubbed out entirely so no real model or GPU was
involved. That confirms the *logic* is internally correct (attribution
picks the origin-closest robot, not the goal-closest one; ReID requires
both signals to agree; circularity filtering rejects non-circular blobs) —
it says nothing about whether these thresholds and heuristics actually work
against real robots, real game pieces, and real camera footage, which they
have never been run against. Expect the default HSV range, area/circularity
thresholds, `max_lost_frames`, and `max_position_error_px` to all need
retuning once real footage exists.

### No visual calibration tool — everything is hand-typed JSON

Field mask, goal zones, and homography are all plain JSON textareas on the
upload form; HSV range/area/circularity are plain number fields on the
run-queue form. Someone has to manually compute a homography matrix (e.g.
via `cv2.findHomography` against known field reference points) and hand-type
normalized polygon coordinates for the mask and goal zones — there is no
click-to-draw tool, no live HSV preview, nothing to make this practical to
do venue-side between matches. The source Chief Delphi post describes
building exactly this tool for themselves; it wasn't built here, and doing
this calibration by hand for every event is realistically not sustainable.

### Model acceptance gates are documented, not enforced

The evaluation checklist in `implementations/vision-scouting-system.md`
("Model acceptance gates") is a human process today — nothing in the code
stops someone from training a rough first-pass model and immediately
releasing its results into real `scout_data_events` via the
`VISION_RELEASE`-gated action. Worth deciding whether that should stay a
trust-based human process (document it, brief whoever gets `VISION_RELEASE`)
or become an actual code gate (e.g. a `model_manifest`/`approved_for_release`
flag checked by `release-run`) before this is used for anything that
actually affects a pick list.

## 3. Operational / hardware gaps

- **No camera has been procured or mounted.** The capture contract (fixed,
  elevated, landscape, full field visible, locked exposure, prefer a global
  shutter or at least a fast shutter speed to avoid motion blur on the game
  piece) is documented but describes hardware that doesn't exist yet for
  this team specifically.
- **No one has an operational role for this at competition** — someone
  needs to actually start/stop recording per match, and someone needs to
  upload the resulting files afterward (or a fully separate ingestion path
  needs to be built, which doesn't exist — today upload is a manual file
  picker on `/scouting/vision`).
- **No storage lifecycle policy** on the `vision-recordings` bucket. Raw
  4K match video accumulates fast; nothing currently prunes old recordings
  or caps bucket size/cost. Not urgent for a first event, but worth a plan
  before this runs for a full season.

## Suggested order

1. `VISION_RUNNER_TOKEN` secret + wire into `cloudbuild.yaml` (10 minutes,
   unblocks everything else being testable end-to-end).
2. Stand up *any* runner host (even a laptop under a desk) with the token
   set, and confirm `heartbeat`/`claim` work against a `queue-run`'d job
   with a placeholder/off-the-shelf YOLO model — this validates the whole
   plumbing without needing a real trained model yet.
3. Get one real recording (any camera, even a phone) through the full
   pipeline by hand, to see what the hybrid detection actually produces
   before investing in labeling/training a real model.
4. Only then invest in: real camera hardware, a labeled dataset, and an
   actual trained model — that's the expensive, slow part, and steps 1–3
   are what tell you whether the rest of the design holds up before
   committing to it.
