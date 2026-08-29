# Vision Scouting — everything left before this is functional

Companion to `scoutingvision.md` (which is the file-by-file "where is the code
and what does it do" reference). This doc is the gap between *"the code
exists"* and *"this produces a scouting number someone would trust."*

It is organised by **who can actually do the thing**, because that is the only
distinction that matters for planning:

- **[Part A — human/hardware only](#part-a--only-a-human-can-do-these).**
  GCP console access, physical hardware, real match footage, labeling time.
  No amount of further code closes these.
- **[Part B — still doable in code](#part-b--still-doable-in-code).** Real
  work an agent or contributor can pick up today without any hardware.
- **[Part C — known gaps and risks](#part-c--known-gaps-and-risks)** worth a
  decision rather than a task.

Status key: **[BLOCKER]** nothing works until this is done · **[NEEDED]**
required before competition use · **[NICE]** improves it, not load-bearing.

---

## Where it stands today

The whole path exists in code and is unit-tested: create match → upload camera
views → queue a run → the DGX runner claims it → YOLO/ByteTrack tracking +
classical-CV game-piece detection + Qwen3-VL clip analysis → discrepancy
reconciliation against TBA → human review → release into `scout_data_events`.

**What is genuinely verified:** 565 JS tests, 0 `svelte-check` errors, Python
unit tests, and synthetic-fixture harnesses covering attribution, occlusion
re-identification, clip-failure handling, and the track→observation identity
chain. Four vision migrations are applied to the live Supabase project and all
9 `vision_*` tables exist.

**What is not:** *none of it has ever processed a real frame of match video.*
Every threshold, the HSV range, the attribution distances, and the entire
throughput model are educated guesses until footage exists. Treat every number
in the config as a starting point, not a tuned value.

---

## Part A — only a human can do these

### A1. Create `VISION_RUNNER_TOKEN` in Secret Manager **[BLOCKER]**

Nothing works at all until this exists. `api/vision-runner` is fail-closed, so
it rejects **every** runner request while the secret is missing — claim,
heartbeat, complete, all of it.

```bash
openssl rand -hex 32 | gcloud secrets create VISION_RUNNER_TOKEN --project=spartanshub --data-file=-
gcloud secrets add-iam-policy-binding VISION_RUNNER_TOKEN --project=spartanshub \
  --member="serviceAccount:819718873862-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

Then move `VISION_RUNNER_TOKEN=VISION_RUNNER_TOKEN:latest` from the
`!!! REMINDER !!!` comment block in `cloudbuild.yaml` into the `--set-secrets`
line, and put the **same value** into the runner host's `.env`.

The order matters: referencing a secret before it exists breaks every
subsequent deploy, which is exactly how the `CRON_NOTIFICATION_TOKEN` gap
(still open, see C1) started.

### A2. Provision the DGX Spark host **[BLOCKER]**

The Compose stack and systemd units are written and ready; no host is running
them. Needed: current DGX OS, NVIDIA Container Toolkit, `docker login` against
NVIDIA NGC (the base image is `nvcr.io/nvidia/pytorch`), the ~60+ GB
Qwen3-VL-30B checkpoint downloaded into the persistent cache, both example
secrets in `vision/runner/.env.example` replaced with real generated values,
and a decision about who owns uptime and cache maintenance.

### A3. Apply the cron migration **on merge** **[NEEDED]**

`migrations/20260829_vision_runner_health_cron.sql` is deliberately **not**
applied. Unlike the other four (additive schema deployed code ignores), it
schedules a `pg_cron` job that calls `/api/notifications/vision-stale-runners`
— a route that only exists on this branch. Applying it early just 404s against
production every 5 minutes. Apply it right after PR #84 merges and deploys.

### A4. Time one Qwen clip on the real hardware **[NEEDED]**

This is the highest-information cheap experiment available, and it may force a
design change rather than a tuning tweak — so do it before optimising
anything.

Clips run strictly serially: ~30 per view for a 150-second match at the
5-second default, each a blocking call carrying 8 images at 1280×720, with a
single inference lock on the service side. At a plausible 30–60s per clip
that is **15–30 minutes per view**, times the number of cameras. A qual day
running a match every ~7 minutes falls behind immediately.

Measure one clip, then pick from the levers in [B1](#b1-cut-qwen-throughput-cost-needed).

### A5. Camera hardware and a real recording **[BLOCKER for useful output]**

The pipeline assumes a fixed, elevated view of the field. Nothing in this repo
records what camera exists or where it would mount. The single most valuable
next step after A1/A2 is getting **one** real recording — a phone on a tripod
is genuinely enough — through the pipeline by hand, to see what the detection
actually produces before investing in labeling.

Hardware note from the source Chief Delphi work: prioritise **shutter speed
over frame rate**. Motion-blurred robots at 60fps are worse than sharp ones at
30fps.

### A6. A labeled dataset and a trained YOLO model **[BLOCKER for useful output]**

`create_placeholder_model.py` produces a real, loadable 6-class checkpoint that
exercises the claim/heartbeat/complete plumbing — its detections are
meaningless noise. A real model needs, in order: recordings (A5), frame
extraction, manual labeling in CVAT or similar (no labeled dataset exists),
a real `train_model.py` run, and evaluation against the acceptance gates in
`implementations/vision-scouting-system.md`. This is data-collection and
human-labeling time; no scripting shortcut exists.

Note the Qwen checkpoint is pretrained and needs **no** local training — Qwen
review trials can begin as soon as A1/A2 are done, before any YOLO model
exists.

### A7. Per-venue calibration **[NEEDED]**

Field mask, goal zones, homography matrix, and HSV thresholds are currently
hand-typed JSON. Someone has to work out polygon coordinates and a 3×3
homography per venue, per camera. B2 would make this dramatically less
painful, but the underlying "point at the four field corners" step is always
human.

### A8. Decide the model-acceptance policy **[NEEDED — a decision, not a task]**

Nothing in `release-run` checks model quality before allowing a release. Either
keep it a documented trust-based process, or say the word and B6 adds a real
`approved_for_release` gate.

---

## Part B — still doable in code

Ordered by value per unit of effort. None of these need hardware.

### B1. Cut Qwen throughput cost **[NEEDED]**

Depends on A4's measurement for validation, but the code can land first.
Cheapest first:

- `VISION_QWEN_FRAMES_PER_CLIP` 8→4, `VISION_QWEN_JPEG_WIDTH` 1280→960 —
  already env-tunable, no code needed.
- `VISION_QWEN_CLIP_SECONDS` 5→10 — halves request count, coarsens timestamps.
- **Activity-gated clips** — only send Qwen the clips where the deterministic
  pipeline already saw a robot near a goal or climbing structure. Most of a
  match is not a scoring moment, so this is potentially a 3–5× reduction *and*
  it cuts hallucination surface. This is the real fix and the one worth
  writing. It is a behaviour change, so it wants real footage to validate.
- `sample_qwen_clip` reopens and re-seeks the video for every clip; reuse one
  `VideoCapture`. Wasteful but trivial next to inference time — do it last.

### B2. A visual calibration tool **[NEEDED]**

Replace the hand-typed JSON in A7 with click-to-draw on a still frame from the
uploaded video: click the field outline for the mask, drag rectangles for goal
zones, click four known field points for the homography. Pure frontend plus
the existing `field_mask`/`goal_zones`/`homography` JSON columns — no schema
change, no new backend. This is the biggest usability win available in code.

### B3. Jump the video to an observation's timestamp **[NEEDED]**

Each camera view already renders a `<video>` player, but nothing connects a
review row to the moment it describes — so verifying a model claim means
scrubbing by hand. Wire each observation's `started_ms` (minus the view's
`sync_offset_ms`) to a seek on that view's player. Small change, and it is the
difference between review being possible and being practical.

### B4. Persist reviewed identities so a re-run starts attributed **[NEEDED]**

`identity_map` is still only ever empty. Reviewed track identities now cascade
to observations within a run (fixed), but re-running the same match throws all
of it away and starts from nothing. Write the reviewed `track_key → team_key`
mapping back onto the match so a subsequent run is pre-attributed. Matters as
soon as anyone re-runs a match with retuned thresholds — which, given every
threshold is currently a guess, will be constant early on.

### B5. Keyboard-driven review **[NICE]**

Bulk accept and filters exist now. A j/k/a/r keyboard loop over the filtered
list would make a match's worth of proposals genuinely fast to clear.

### B6. `approved_for_release` gate **[NICE — pending A8]**

If the answer to A8 is "enforce it": a flag on the model/run that
`release-run` checks, so an unvalidated model physically cannot reach
`scout_data_events`.

### B7. Storage retention **[NICE]**

Nothing ever deletes from the `vision-recordings` bucket. Match video is large
and accumulates forever. A retention sweep — or at minimum a documented manual
cleanup — before this runs at a multi-day event.

### B8. Test coverage for the release bridge **[NICE]**

`release-run` and the `update-track` cascade are the two paths that write real
scouting data, and neither has a route test yet. `track_linking.test.js` is the
pattern to copy.

---

## Part C — known gaps and risks

### C1. The cron trust boundary is currently fail-open

`cron_auth.js`'s `isAuthorizedCronRequest()` accepts **any** request when none
of `CRON_SECRET`/`CRON_TOKEN`/`CRON_NOTIFICATION_TOKEN` is configured — and
`CRON_NOTIFICATION_TOKEN` is currently commented out of `cloudbuild.yaml`'s
`--set-secrets` (tracked as frc971/spartanshub issue #5). The new
`/api/notifications/vision-stale-runners` endpoint inherits that gap.

Practical impact is low — the endpoint only sends alerts for genuinely stale
runners, and `dispatchNotification` dedups by entity key, so hammering it is a
no-op — but it is unauthenticated on the live service, and it is one more
reason to close issue #5.

### C2. Attribution is proximity-based and will need retuning

Every attribution path picks the nearest same-alliance robot track within a
500 ms window. That is sound for climbs (the box is on the robot) and for fuel
(the trajectory is traced back to its *origin*, deliberately not the goal).
But no distance ceiling is set by default, so a lone robot far from an event
can still win it. `qwen_attribution_max_distance` and
`climb_attribution_max_distance` exist for exactly this and are unset — they
want real footage to choose a value.

Mitigating this: every model observation lands `review_status=unreviewed`, and
only `accepted`/`corrected` rows can be released. Attribution is a suggestion
a human confirms, never a silent write.

### C3. Multi-camera fusion is time-based only

`fuseObservations` merges observations of the same type/team/alliance within
350 ms across views and keeps the highest-confidence one. It does not
geometrically verify that two cameras saw the *same physical event*. With
correct sync offsets this is fine; with drifting offsets it will silently
double-count. Worth revisiting once real multi-camera footage exists.

### C4. Everything downstream of the model is only as good as the sync offsets

`sync_offset_ms` per view is hand-entered and unverified. Phase assignment,
multi-camera fusion, and attribution windows all depend on it. There is no
tooling to check that two views are actually aligned.

---

## Suggested order

1. **A1** — the two `gcloud` commands. Nothing runs until this is done.
2. **A2** — stand up the Compose stack; confirm a full `queue-run` → `claim` →
   Qwen → `complete` cycle against the deployed app using the placeholder
   model. This proves the plumbing without needing a trained model.
3. **A4** — time one clip. The answer decides whether B1's activity-gating is
   urgent or optional.
4. **A5** — one real recording through the pipeline by hand. Expect the HSV
   range and every threshold to be wrong; this is where they get tuned.
5. **B2 + B3** — calibration tool and video seeking. Both become obviously
   necessary the moment a human sits down to review real footage.
6. **A6** — labeling and a real trained model, once you know from step 4 what
   the detector actually needs to handle.
7. Everything else in Part B as it earns its place.

`A3` happens whenever PR #84 merges, independently of this sequence.
