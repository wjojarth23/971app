# Scouting Vision — implementation reference

A restricted, post-match computer-vision pipeline that watches match video,
detects robot positions and scoring events with a custom YOLO model, and
cross-checks the result against The Blue Alliance's official match
breakdown. It is a separate, secret project from the rest of scouting: not
linked from any nav tab, gated behind a `VISION_REVIEW` permission, and its
output never silently feeds `scout_data_events` or power rankings — a human
has to review and release it. This doc is a file-by-file map of what's
actually implemented, for anyone picking the feature up. For the design
rationale and contracts (capture requirements, review states, model
acceptance gates), see `implementations/vision-scouting-system.md` — this
file focuses on "where is the code and what does it do."

## End-to-end data flow

1. A reviewer opens `/scouting/vision`, creates a `vision_matches` row for an
   `event_key` + `match_key`, and uploads one or more synchronized camera
   recordings as `vision_views` (each with a label, camera position, ms sync
   offset, and optional 3×3 image→field homography).
2. The reviewer queues a `vision_runs` job naming a model name/version and
   config (confidence floor, optional `identity_map`).
3. A separate GPU worker (`vision/runner/vision_runner.py`) polls
   `api/vision-runner`, claims the run, downloads each view via a signed URL,
   runs YOLO detection + tracking, and reports back `vision_tracks`
   (per-robot trajectories) and `vision_observations` (fuel/climb/mobility
   events) to `complete`.
4. The server fuses multi-camera observations of the same event
   (`fuseObservations`), summarizes them per team/alliance
   (`summarizeVision`), fetches the official TBA match breakdown
   (`fetchTbaMatchReference`), and diffs the two (`reconcileWithReference`).
   Material differences become `vision_discrepancies`.
5. A reviewer works the discrepancy queue in the UI, resolving each as
   `accepted_vision`, `accepted_reference`, `corrected`, `unobservable`, or
   `dismissed`. Raw vision results are never overwritten by a review — only
   the resolution record is added alongside them.

## Database (`migrations/20260828_vision_system.sql`)

One SQL file, not yet applied to production (see **Setup checklist** below).
Seven tables, all with RLS enabled:

| Table | Purpose |
|---|---|
| `vision_matches` | One row per event+match being reviewed. `status`: `draft → queued → processing → review → complete/failed`. |
| `vision_views` | One row per uploaded camera recording for a match: storage path, camera position, frame rate/dimensions, sync offset, homography + calibration points. |
| `vision_runs` | One row per model-processing attempt on a match. Immutable `model_name`/`model_version`/`config`; `status`: `queued → claimed → processing → complete/failed/cancelled`. |
| `vision_tracks` | Per-robot trajectory output from one run: alliance, start/end ms, identity + tracking confidence, raw `trajectory` points, derived `metrics` (see analytics below), `needs_review` flag. |
| `vision_observations` | Discrete detected events (`fuel_attempt`, `fuel_scored`, `climb_attempt`, `climb_success`, `mobility`, `disabled`, `identity`) with a JSON `value`, confidence, and `evidence` (frame/box) for audit. |
| `vision_discrepancies` | Vision-vs-TBA mismatches queued for human review, with severity (`info`/`warning`/`critical`) and a resolution workflow. |
| `vision_reference_snapshots` | The TBA match breakdown captured at analysis time, so later re-review doesn't depend on TBA's API still returning the same shape. |

Also creates a private `vision-recordings` storage bucket (`public: false`).

Access control is entirely RLS-driven, applied via a `DO $$ ... FOREACH $$`
loop over all seven tables:
- `authenticated` role: full access gated by `public.has_permission('VISION_REVIEW')`
  (a Postgres function assumed to already exist in the DB — this migration
  doesn't define it).
- `service_role`: unrestricted (`USING (true)`) — this is what the runner's
  server-side Supabase client uses.
- The storage bucket gets a matching `authenticated` policy requiring the
  same permission.

## Backend

### Analytics engine — `src/lib/visionAnalytics.js`

Pure functions, framework-agnostic, unit-tested in `visionAnalytics.test.js`:

- `trajectoryMetrics(points, { minConfidence })` — turns a raw list of
  `{t, x, y, confidence}` points into distance traveled, median/P90/max
  speed, mean acceleration, P90 turn rate, and moving/stationary time. Drops
  low-confidence points and any gap > 1 second between samples (so a
  tracking dropout doesn't get counted as a teleport).
- `fuseObservations(observations, { dedupeWindowMs = 350 })` — merges the
  same real-world event seen by multiple camera views: two observations of
  the same type/team/alliance within 350ms are collapsed into one, keeping
  the higher-confidence detection and recording every contributing view.
  Deliberately does *not* merge simultaneous red and blue events, even if
  otherwise similar.
- `summarizeVision(observations, tracks)` — fuses observations, then rolls
  fuel/climb counts and best-coverage mobility metrics up per team and per
  alliance (for teams whose identity isn't resolved yet).
- `reconcileWithReference(summary, reference, thresholds)` — diffs a vision
  summary against a TBA reference. Fuel: flagged only if the difference is
  *both* > 3 (absolute, default) *and* > 15% (relative, default) — a
  deliberately conjunctive threshold so a single miscounted ball doesn't spam
  the review queue. Climb count: any disagreement is `critical`, since it's a
  binary and TBA's number is authoritative.

### TBA reference parsing — `src/lib/server/vision_reference.js`

`referenceFromTbaMatch(match)` reshapes a raw TBA `/match/{key}` API response
into `{ matchKey, alliances: { red, blue } }`, each with team keys, total
score, a best-effort extracted fuel count, and a climb count. Field names
aren't standardized across TBA game years, so fuel/climb extraction tries a
short list of known key names first (`fuelPoints`, `totalFuelPoints`, …),
then falls back to a regex scan of the breakdown object
(`firstMatchingFinite`) rather than hardcoding one season's schema.
`fetchTbaMatchReference(matchKey, authKey, fetchImpl)` wraps this with the
actual HTTP call; `fetchImpl` is injectable for testing.

### User-facing API — `src/routes/api/vision/+server.js`

Auth: per-request Supabase client built from the caller's own `Authorization`
header (`clientFor`), so every query goes through RLS as that user — the
route itself does no permission check beyond "is there a logged-in user";
`VISION_REVIEW` enforcement lives entirely in the RLS policies above.

- `GET` (no `id`): lists all `vision_matches` with view/run counts.
- `GET ?id=`: full detail for one match — views (with freshly
  signed 15-minute playback URLs), runs, and (for the latest or a specified
  `run_id`) tracks/observations/discrepancies.
- `POST` actions:
  - `create-match` — new `vision_matches` row.
  - `add-view` — inserts the `vision_views` row (storage path is
    `event_key/match_key/<uuid>-<sanitized filename>`) and returns a signed
    *upload* URL the client uploads the raw file to directly.
  - `queue-run` — requires at least one view already uploaded; inserts a
    `vision_runs` row and flips the match to `queued`.
  - `review` — resolves a discrepancy (one of the 5 allowed statuses),
    stamping reviewer id and timestamp.
  - `update-track` / `update-observation` — human correction of a track's
    team identity or an observation's team/value/confidence.

### Runner-facing API — `src/routes/api/vision-runner/+server.js`

Separate endpoint, separate auth: a shared-secret bearer token
(`VISION_RUNNER_TOKEN`) checked with a constant-time comparison
(`checkToken`, XOR-accumulate over `TextEncoder` bytes) rather than `===`, to
avoid a timing side-channel on the token value. Uses a `service_role`
Supabase client (`serviceClient`), bypassing RLS — this is the only code path
allowed to bypass `VISION_REVIEW`.

- `claim` — atomically claims the oldest of up to 5 queued runs
  (`update ... eq('status','queued')` as the compare-and-swap so two runners
  can't double-claim), returns the run plus every view with a freshly signed
  1-hour download URL.
- `processing` — marks a claimed run as started; 409s if it wasn't in
  `claimed` state.
- `complete` — accepts tracks/observations from the runner, inserts them,
  runs the same `summarizeVision` → `fetchTbaMatchReference` →
  `reconcileWithReference` pipeline the analytics module exposes, persists
  any discrepancies and a reference snapshot, and flips the match to
  `review` (if discrepancies exist) or `complete`.
- `fail` — marks a claimed/processing run `failed` with an error message.
  Every claimed run must terminate through `complete` or `fail` — same
  invariant the AutoCAM Fusion runner uses.

## Frontend — `src/routes/scouting/vision/+page.svelte`

Single-page app, not code-split into sub-routes. Left sidebar: create a new
match, pick from the list of existing ones (status + view count shown
inline). Right pane, once a match is selected:

1. **Camera views** — inline `<video>` playback per uploaded view (signed
   URL from the detail fetch), plus an upload form (label, position, sync
   offset, optional homography JSON, file picker). Upload flow calls
   `add-view` for a signed upload URL, then uploads directly to Supabase
   Storage via `supabase.storage...uploadToSignedUrl` — the raw video never
   transits the SvelteKit server.
2. **ML processing** — queue a run by name/version/confidence floor; lists
   past runs with status (and error, if failed).
3. **Robot tracks & mobility** (once a run has tracks) — editable team-key
   field per track (writes back via `update-track`), plus derived distance /
   P90 speed / turn rate.
4. **Detected actions** (once a run has observations) — raw event list with
   type, attribution, timestamp, confidence, and the raw `value` JSON.
5. **Human review** — the discrepancy queue: metric, severity badge, vision
   vs. TBA values, a notes field, and one-click resolution buttons for each
   of the 5 outcomes.

The page's own header renders a `ShieldAlert` "Restricted project" label as a
constant visual reminder of the permission gate.

## External ML runner — `vision/runner/`

`vision_runner.py`: a standalone Python polling loop (no web framework) —
`claim` → `processing` → `process_view` per camera → `complete`/`fail`, using
`requests` against `api/vision-runner`. Model inference is Ultralytics
`YOLO(...).track(..., persist=True)` for detection + cross-frame tracking.
Per frame:
- `robot_red` / `robot_blue` boxes with a tracker id become trajectory points
  (`field_point` applies the view's homography via `cv2.perspectiveTransform`
  if one was calibrated, otherwise passes through raw pixel coordinates and
  marks them `calibrated: false`).
- `fuel_scored` / `climb_attempt` / `climb_success` boxes (optionally
  alliance-suffixed, e.g. `fuel_scored_red`) become `vision_observations`
  directly, with the raw detection box kept as `evidence`.

Team identity is never inferred from alliance color — a track only gets a
`team_key` if the run's `config.identity_map` (an audited
`"<view id>:<tracker id>": "frcNNNN"` mapping, presumably built by a human
during review) contains an entry for it; otherwise `needs_review: true`. No
model weights are committed to the repo — `VISION_MODEL_PATH` must point to
a locally trained/versioned `.pt` file (see training pipeline below).

## Training pipeline — `vision/training/`

Not run by the app at all — a standalone offline toolchain for producing the
YOLO weights the runner needs:

- `extract_frames.py` — pulls frames from a recording at a fixed sample rate
  into a flat "unsplit" labeling directory (source filename encodes match key
  + view label, so provenance survives into the dataset).
- `validate_splits.py` — fails the build if frames from the same source video
  appear in more than one of `train`/`val`/`test` (a real, specific leakage
  bug this guards against: adjacent frames of the same match are nearly
  identical, so a naive random split would let the model "cheat" by
  memorizing rather than generalizing — inflating held-out accuracy).
- `bootstrap_annotate.py` — uses `Qwen/Qwen3-VL-4B-Instruct` (4-bit
  quantized) to analyze short (~5s) clips across one or more synced views and
  propose grounded robot/fuel/climb/immobility events as JSON. Purely a
  labeling accelerant — output is explicitly unreviewed and never becomes a
  training set or production result on its own.
- `bootstrap_yolo_annotate.py` — once reviewed seed YOLO weights exist, runs
  them densely across new recordings to generate a faster pseudo-labeling
  pass (dense box coverage; Qwen still owns semantic event judgment).
- `train_model.py` — trains a YOLO model from a declared base checkpoint
  against a `data.yaml`, evaluates on the held-out `test` split, and writes
  versioned best weights + a `model-manifest.json`. Detection mAP alone is
  treated as insufficient — the design doc requires separately evaluating
  tracker identity-switch rate, calibrated trajectory error, alliance fuel
  error, and climb confusion before a model can be marked
  `approved_for_rankings`.

## Tests

- `src/lib/visionAnalytics.test.js` — trajectory metrics from real-coordinate
  points, multi-camera dedup, red/blue non-merging, alliance-level
  reconciliation before identity is known, and full team fuel
  summarization + discrepancy flagging.
- `src/lib/server/vision_reference.test.js` — TBA breakdown parsing
  (alliance/fuel/climb extraction) and the negative case: total score must
  *not* be mistaken for a fuel count when no compatible breakdown field
  exists.

## Access control & security summary

- App-level auth: every `api/vision` call requires a signed-in Supabase user
  (401 otherwise); all authorization beyond that is RLS, gated on the
  `VISION_REVIEW` permission string.
- Runner auth: a separate bearer-token secret (`VISION_RUNNER_TOKEN`),
  constant-time compared, never exposed to the browser client.
- Raw recordings live in a private bucket; every playback/download URL is
  short-lived and signed per request (15 min for review playback, 1 hour for
  the runner's processing download).
- The runner's Supabase credentials (`SUPABASE_SERVICE_KEY`) and model
  weights never reach the web app or the browser — the boundary between
  "metadata queue" (SvelteKit) and "GPU processing" (external Python worker)
  is a deliberate design choice, not an accident of deployment.

## Setup checklist (nothing here works until these are done)

1. Run `migrations/20260828_vision_system.sql` against the real Supabase
   project — **not yet applied** as of this doc; the app currently has no
   `vision_*` tables or `vision-recordings` bucket in production.
2. **`VISION_REVIEW` is not wired into the app's own permission system** —
   `src/lib/permissions.js` (`PERMISSIONS`, `GENERAL_ROLE_PERMISSIONS`, etc.)
   has no `VISION_REVIEW` entry, and there's no admin-UI toggle for it. The
   RLS policies call `public.has_permission('VISION_REVIEW')`, which assumes
   that function and a way to grant the permission string already exist
   Postgres-side — granting it to specific users today means doing so
   directly against the database, not through this app.
3. Set `VISION_RUNNER_TOKEN` (shared secret) and `TBA_API_KEY` in the web
   service's environment.
4. Deploy `vision/runner/vision_runner.py` separately (GPU host), with
   `VISION_API_URL`, `VISION_RUNNER_TOKEN`, `VISION_RUNNER_ID`, and
   `VISION_MODEL_PATH` pointing at a locally trained model — no weights are
   committed to this repo.
5. `/scouting/vision` is intentionally unlinked from every nav tab
   (`src/routes/+layout.svelte`, `navigation.json`, `defaultTabs.js` all have
   zero references to it) — reaching it requires typing the URL directly,
   by design, on top of the permission gate.
