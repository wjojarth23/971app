# Scouting Vision — implementation reference

A restricted, post-match computer-vision pipeline that watches match video,
detects robot positions and scoring events with a custom YOLO model, and
cross-checks the result against The Blue Alliance's official match
breakdown. It's a real tab now — **Vision Scouting** in the Competition nav
folder — but still gated behind a `VISION_REVIEW` permission at both the nav
layer and RLS, so anyone without it never sees it exists. Its output never
*silently* feeds `scout_data_events` or power rankings: a separate,
higher-tier `VISION_RELEASE` permission is required to explicitly push a
completed run's results into real scouting data (see **Reviewed-result
release bridge** below). This doc is a file-by-file map of what's actually
implemented, for anyone picking the feature up. For the design rationale and
contracts (capture requirements, review states, model acceptance gates), see
`implementations/vision-scouting-system.md` — this file focuses on "where is
the code and what does it do."

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

## Database

Three SQL files, none yet applied to production (see **Setup checklist**
below).

### `migrations/20260828_vision_system.sql`

Seven tables, all with RLS enabled:

| Table | Purpose |
|---|---|
| `vision_matches` | One row per event+match being reviewed. `status`: `draft → queued → processing → review → complete/failed`. |
| `vision_views` | One row per uploaded camera recording for a match: storage path, camera position, frame rate/dimensions, sync offset, homography + calibration points. |
| `vision_runs` | One row per model-processing attempt on a match. Immutable `model_name`/`model_version`/`config`; `status`: `queued → claimed → processing → complete/failed/cancelled`. |
| `vision_tracks` | Per-robot trajectory output from one run: alliance, start/end ms, identity + tracking confidence, raw `trajectory` points, derived `metrics` (see analytics below), `needs_review` flag. |
| `vision_observations` | Discrete detected events (`fuel_attempt`, `fuel_scored`, `climb_attempt`, `climb_success`, `mobility`, `disabled`, `identity`) with a JSON `value`, confidence, and `evidence` for audit. `climb_*` evidence is a YOLO frame/box; `fuel_scored` evidence is the classical-CV goal zone label + trajectory length (see **Hybrid game-piece detection** below - fuel isn't a YOLO detection). |
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

### `migrations/20260829_vision_notifications_release_fleet.sql`

Three additions on top of the above:

- **`user_profiles.vision_notify` boolean** (default `false`) — the Slack
  alert opt-in list (see **Slack alerting** below). Seeded `true` for Yuvan
  Shankar and Arin Rao by a best-effort `full_name ILIKE` match (free text,
  not a real FK — same "skip gracefully if it doesn't match" stance already
  used for `parts.requester` elsewhere in this codebase).
- **`vision_runs.released_at` / `released_by`** plus a new
  **`vision_release_log`** table (`vision_run_id`, `released_by`,
  `scout_data_event_ids uuid[]`, `team_count`) — the audit trail for the
  release bridge. Original vision evidence is never mutated by a release;
  this just records what was produced and by whom.
- **`vision_runners`** table (`runner_id` primary key, `last_seen_at`,
  `model_path`, `current_run_id`, `last_error`) — runner fleet heartbeats.

Both new tables are SELECT-only for `authenticated` + `VISION_REVIEW` (read
for the dashboard); all writes go through `service_role` (the runner's own
heartbeat call, and the release bridge's privileged insert — see below).

### `migrations/20260829_vision_field_mask_goal_zones.sql`

Two more columns on `vision_views` (no new tables, no new RLS - already
covered by the table's existing policy from the first migration):

- **`field_mask` jsonb** — a normalized (0-1) ROI polygon; detections
  outside it (audience, pit area) are discarded before either detector runs.
- **`goal_zones` jsonb** (default `[]`) — array of `{label, alliance,
  polygon}`; where a scored game piece's trajectory is expected to end. See
  **Hybrid game-piece detection** under the runner section below.

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
`VISION_REVIEW` enforcement lives entirely in the RLS policies above (the one
exception is `release-run`, below, which adds its own explicit check).

- `GET` (no `id`): lists all `vision_matches` with view/run counts.
- `GET ?id=`: full detail for one match — views (with freshly
  signed 15-minute playback URLs), runs, and (for the latest or a specified
  `run_id`) tracks/observations/discrepancies.
- `GET ?dashboard=<event_key>`: event-level rollup — matches
  total/complete, run counts by status (+ how many are released), open vs.
  resolved discrepancy counts (with an `open_critical` breakout), the
  current queue depth, and the runner fleet (see **Runner fleet visibility**
  below). Powers `src/routes/scouting/vision/dashboard/+page.svelte`.
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
  - `release-run` — the reviewed-result release bridge; see its own section
    below.

### Runner-facing API — `src/routes/api/vision-runner/+server.js`

Separate endpoint, separate auth: a shared-secret bearer token
(`VISION_RUNNER_TOKEN`) checked with a constant-time comparison
(`checkToken`, XOR-accumulate over `TextEncoder` bytes) rather than `===`, to
avoid a timing side-channel on the token value. Uses a `service_role`
Supabase client (`serviceClient`), bypassing RLS — this is the only code path
allowed to bypass `VISION_REVIEW`.

- `heartbeat` — upserts `vision_runners` with the runner's id, current run
  (if any), model path, and last error. See **Runner fleet visibility**.
- `claim` — atomically claims the oldest of up to 5 queued runs
  (`update ... eq('status','queued')` as the compare-and-swap so two runners
  can't double-claim), returns the run plus every view with a freshly signed
  1-hour download URL.
- `processing` — marks a claimed run as started; 409s if it wasn't in
  `claimed` state.
- `complete` — accepts tracks/observations from the runner, inserts them,
  runs the same `summarizeVision` → `fetchTbaMatchReference` →
  `reconcileWithReference` pipeline the analytics module exposes, persists
  any discrepancies and a reference snapshot, flips the match to `review`
  (if discrepancies exist) or `complete`, and fires a Slack alert (see
  below) for every newly inserted `critical` discrepancy.
- `fail` — marks a claimed/processing run `failed` with an error message
  (only if a row actually transitioned - a no-op CAS never alerts) and fires
  a Slack alert. Every claimed run must terminate through `complete` or
  `fail` — same invariant the AutoCAM Fusion runner uses.

## Slack alerting

`src/lib/server/slack_notifications.js` adds `notifyVisionRunFailed(runId)`
and `notifyVisionCriticalDiscrepancy(discrepancyId)`, both following the same
`dispatchNotification` pattern every other Slack DM in this app uses
(per-notification-type opt-out via `user_profiles.notification_settings`,
automatic dedup via `user_notification_logs`). What's different from every
other notification category here: the recipient list isn't role-derived
(there's no "Vision Lead" role) - it's an explicit, admin-managed opt-in list
(`user_profiles.vision_notify`), because this is a small, deliberately
restricted project and the point is a short, chosen set of people, not
"everyone with some role." `NOTIFICATION_KEYS.VISION_ALERT` covers both
trigger conditions (run failure, new critical discrepancy) under one
category rather than splitting them - to a recipient, both mean the same
thing: "go look at Vision Scouting."

**Admin UI** (`src/routes/admin/+page.svelte`): a "Vision Alerts" checkbox
sits next to the existing manufacturing-workflow notify checkboxes in the
Notifications column, writing `vision_notify` through the same
`update-roles` API path `manufacturing_lead_workflows` already uses. Yuvan
Shankar and Arin Rao are seeded in via the migration (see above); anyone else
needs an admin to check the box.

**Vision access itself** (`VISION_REVIEW`, `VISION_RELEASE`) is a separate
concept from alerting and is granted via its own two checkboxes in the same
admin page's Permissions column - real entries in `src/lib/permissions.js`'s
`PERMISSIONS` array (not role-derived), written through the generic
`permissions[]` update path `api/admin/+server.js` already exposed. This
closes the gap the first version of this doc flagged: there was previously
no way to grant `VISION_REVIEW` through the app at all.

## Reviewed-result release bridge

`POST api/vision { action: 'release-run', run_id }` is the "actual payoff"
path: it turns one completed run's advisory output into real
`scout_data_events` rows, so a released match's vision-derived fuel/climb
counts count toward power rankings like any human-scouted match would.

Guardrails, in order:
1. Requires `VISION_RELEASE` specifically (checked against the caller's own
   `user_profiles.permissions`/`role`, via the caller's own RLS-scoped
   client) - holding `VISION_REVIEW` alone is not enough.
2. The run must be `status: 'complete'` and not already released
   (`released_at IS NULL`) - a release is a one-time, explicit action, not
   re-runnable.
3. Once authorized, the actual write uses a `service_role` client
   (`getSupabase()`), because `scout_data_events` INSERT is RLS-gated on
   `DATA_SCOUT_ADMIN`/`DATA_SCOUT_MEMBER` - permissions a vision releaser
   has no reason to also hold. The `VISION_RELEASE` check above is the real
   gate; the service client is just how the already-authorized write
   actually lands, the same "app-level permission check, then a privileged
   write" shape `notifyManufacturingRequestById` and friends already use.
4. Per team in the run's fused `summarizeVision()` output:
   - Fuel count (if any observation resolved fuel for that team) becomes one
     `hub_fuel_override` event - a single authoritative count rather than
     emulating individual taps, matching what that event type already means
     in `src/lib/scoutingStats.js`.
   - Climb (`team.climb`) becomes a `climb_pos` event **only** if it's
     exactly one of the real enum values (`N/A`/`Failed`/`L1`/`L2`/`L3`) -
     vision's climb value is otherwise free-form (frequently the literal
     string `'success'`, since `vision_runner.py` currently just echoes
     `config.default_climb_level` rather than detecting a real level), and
     anything that doesn't match is silently skipped rather than written as
     garbage into a column power-ranking aggregation depends on.
   - Alliance-only observations (no resolved `team_key`) are never released
     as a specific team's data.
   - Every released row is tagged `role: 'vision'`, so released rows stay
     identifiable/filterable in `scout_data_events` after the fact, on top
     of the `vision_release_log` audit row.
5. If nothing is attributable yet (no track/observation has a resolved team
   identity), the release is rejected outright rather than silently doing
   nothing.

UI: a "Release to scouting data" button appears per run on
`/scouting/vision` once it's complete and unreleased, gated client-side on
`hasPermission(user, 'VISION_RELEASE')` (the server enforces this
regardless - the client check is purely to not show a button that would
just 403). A confirm dialog warns it can't be undone before the request
fires.

## Runner fleet visibility

`vision_runner.py`'s poll loop now calls a `heartbeat` action every
iteration - whether or not it actually claims a job - reporting its
`runner_id`, `model_path`, current `run_id` (if any), and last error.
Heartbeat failures are swallowed (`except Exception: pass`): a status ping
must never be able to take down the actual processing loop.

The dashboard (`GET ?dashboard=`) reads `vision_runners` and marks a runner
"online" if its last heartbeat is within `RUNNER_ONLINE_THRESHOLD_MS`
(60s - a generous multiple of the runner's own 10s default poll interval,
so one slow iteration - a big download, a busy GPU - doesn't flap a healthy
runner offline). This makes a dead runner visible directly instead of only
inferable from "the queue stopped draining."

## Frontend — `src/routes/scouting/vision/+page.svelte`

Single-page app, not code-split into sub-routes. Left sidebar: create a new
match, pick from the list of existing ones (status + view count shown
inline). Right pane, once a match is selected:

1. **Camera views** — inline `<video>` playback per uploaded view (signed
   URL from the detail fetch), plus an upload form (label, position, sync
   offset, optional homography JSON, field mask JSON, goal zones JSON, file
   picker). Upload flow calls `add-view` for a signed upload URL, then
   uploads directly to Supabase Storage via
   `supabase.storage...uploadToSignedUrl` — the raw video never transits the
   SvelteKit server. Field mask/goal zones are plain JSON textareas for now
   (no visual polygon-drawing tuner - see the runner section's calibration
   note).
2. **ML processing** — queue a run by name/version/confidence floor, plus a
   collapsed "Hybrid game-piece detection tuning" section (HSV lower/upper,
   min area, min circularity - all optional, fall back to the runner's
   defaults if left blank); lists past runs with status (and error, if
   failed).
3. **Robot tracks & mobility** (once a run has tracks) — editable team-key
   field per track (writes back via `update-track`), plus derived distance /
   P90 speed / turn rate.
4. **Detected actions** (once a run has observations) — raw event list with
   type, attribution, timestamp, confidence, and the raw `value` JSON.
5. **Human review** — the discrepancy queue: metric, severity badge, vision
   vs. TBA values, a notes field, and one-click resolution buttons for each
   of the 5 outcomes.

Each run in the "ML processing" list also shows a **Release to scouting
data** button (complete + unreleased + `VISION_RELEASE` only) or a
`released` tag once it's been pushed - see **Reviewed-result release
bridge** above.

The page's own header renders a `ShieldAlert` "Restricted project" label as a
constant visual reminder of the permission gate, plus a link to the event
dashboard (below).

### Event dashboard — `src/routes/scouting/vision/dashboard/+page.svelte`

A separate page (linked from the main Vision Scouting header) that answers
"how's this event going" without clicking through matches one at a time:
stat tiles for matches complete/total, runs by status (+ released count),
open discrepancies (with a critical count called out), and current queue
depth, plus a runner fleet table (online/offline, last-seen age, current run,
model path, last error). Takes an `event_key` via `?event_key=` or a manual
input; defaults to the active scouting event.

## External ML runner — `vision/runner/`

`vision_runner.py`: a standalone Python polling loop (no web framework) —
`heartbeat` (every iteration) → `claim` → `processing` → `process_view` per
camera → `complete`/`fail`, using `requests` against `api/vision-runner`.

The pipeline is **hybrid**, adapted from community R&D shared on Chief
Delphi ("Computer Vision Scouting",
chiefdelphi.com/t/computer-vision-scouting/511642 - see
`implementations/vision-scouting-system.md` for the full rationale). Two
different detectors run per frame, because the best tool differs by problem:

- **Robots** — Ultralytics `YOLO(...).track(..., persist=True)` (detection +
  ByteTrack-style cross-frame tracking). `robot_red`/`robot_blue` boxes with
  a tracker id become trajectory points (`field_point` applies the view's
  homography via `cv2.perspectiveTransform` if one was calibrated, otherwise
  passes through raw pixel coordinates and marks them `calibrated: false`).
  `climb_attempt`/`climb_success` boxes become `vision_observations`
  directly, same as before.
- **Game pieces (fuel)** — classical CV, *not* a YOLO class:
  `detect_game_pieces` (HSV threshold → contour → area/circularity filter,
  masked to the view's field mask if calibrated) finds piece candidates each
  frame; `PieceTracker` associates them into trajectories via gated
  nearest-neighbor matching; `attribute_scores` treats a trajectory ending
  inside a calibrated goal zone as scored, and attributes it to whichever
  robot track was closest to the trajectory's *origin* point (where the
  piece left the shooter), not whichever robot is nearest the goal itself.
  Any `fuel_scored` boxes from legacy weights are explicitly ignored rather
  than double-counted alongside this pipeline.
- **`RobotReId`** — recovers a robot's tracked identity across a brief
  occlusion (blocked by a game piece or another robot) instead of minting a
  new track id for the same physical robot. A candidate recovery needs both
  signals to agree: the lost track's last known velocity projects to
  roughly where the new detection is, *and* the new detection's bumper-
  region color histogram (`bumper_histogram` - HSV hue+saturation of the
  box's bottom third, ignoring brightness) is similar enough to the lost
  track's. Position alone is ambiguous with several same-alliance robots
  nearby; this file's own smoke tests (see below) confirm a same-position,
  different-looking robot is correctly rejected rather than merged.

Team identity is never inferred from alliance color — a track only gets a
`team_key` if the run's `config.identity_map` (an audited
`"<view id>:<tracker id>": "frcNNNN"` mapping, presumably built by a human
during review) contains an entry for it; otherwise `needs_review: true`. No
model weights are committed to the repo — `VISION_MODEL_PATH` must point to
a locally trained/versioned `.pt` file (see training pipeline below).

### Calibration & tuning

- **Field mask** (`vision_views.field_mask`) and **goal zones**
  (`vision_views.goal_zones`) — normalized (0-1) polygons, set per view via
  a JSON textarea on the upload form (matching the existing homography JSON
  field). A field mask excludes audience/background from *both* detectors; a
  goal zone is where a scored piece's trajectory is expected to end. Without
  a goal zone calibrated, no fuel can ever be attributed - `attribute_scores`
  only fires for trajectories that actually end inside one.
- **HSV range / min area / min circularity** (`vision_runs.config.hsv_lower`,
  `hsv_upper`, `min_piece_area`, `min_circularity`) — per-run, since per the
  source community's own experience, lighting varies enough by venue that a
  single hardcoded threshold doesn't survive multiple events. Exposed as a
  collapsed "Hybrid game-piece detection tuning" section on the run-queue
  form; falls back to `DEFAULT_HSV_LOWER`/`DEFAULT_HSV_UPPER`/etc. in
  `vision_runner.py` if left blank.

No visual polygon-drawing/HSV-preview tuner tool exists yet (the source
community post describes building one) - calibration today is hand-written
JSON/numbers. A natural follow-up, not built here.

### Verifying the pure-logic pieces without a GPU or real footage

`PieceTracker`, `detect_game_pieces`, `build_mask`, `point_in_zone`,
`attribute_scores`, and `RobotReId` are all plain Python/OpenCV/NumPy with
no YOLO dependency, so they can be exercised directly against synthetic
frames and fixtures - stub `sys.modules['ultralytics']` before import (the
module only touches `ultralytics.YOLO` at call time, not import time) since
`vision_runner.py` otherwise requires the real package. There's no
pytest/CI wiring for this yet (no Python tests exist anywhere else in this
repo either) - this was run ad hoc during development to confirm, concretely:
a moving piece stays one trajectory; two simultaneous distant pieces don't
merge; a non-circular blob is rejected by the circularity filter; a piece
that never enters a goal zone produces no observation; a piece is attributed
to the robot closest to its *origin*, not the robot closest to the goal; an
occluded robot is recovered under its original id when both position and
appearance match; and a same-position, different-colored robot is correctly
*not* merged.

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
- `src/routes/api/vision-runner/server.test.js` — token auth (missing/wrong/
  wrong-length all reject before the constant-time compare even runs), the
  claim compare-and-swap loop (a lost race on the first candidate correctly
  falls through to the next one), heartbeat validation, and that `fail`
  only fires a Slack alert when a row actually transitioned (not on a no-op
  CAS). **Note the file name**: `server.test.js`, not `+server.test.js` -
  SvelteKit reserves the `+` prefix for real route files
  (`+page.svelte`/`+server.js`/etc.); a test file starting with `+` trips a
  "Files prefixed with + are reserved" warning (surfaced as a Vite HMR
  overlay in dev, and would very likely break `npm run build` too).
- `src/routes/api/vision/server.test.js` — auth guard, dashboard aggregation
  math (run/discrepancy counts, runner online/offline threshold), and the
  full `release-run` guardrail chain (missing `run_id`, missing permission,
  wrong run status, already-released, no-attributable-results, and the
  happy path asserting the *exact* rows handed to `scout_data_events.insert`
  - including that an unrecognized climb value is dropped rather than
  written through).

All four vision test files mock `@supabase/supabase-js`'s `createClient`
(and `$lib/server/971bot.js`'s `getSupabase` for the two API-route files)
with a small reusable chain-object mock: every query-builder method returns
the same chain, and the chain itself is awaitable, resolving to a per-table
queued `{data, error}` - because every code path in these routes builds one
full chain and awaits it exactly once, never branching mid-chain. There was
no prior precedent for testing a SvelteKit `+server.js` route in this repo;
this establishes one.

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

1. Run **all three** migration files against the real Supabase project, in
   order — **none are applied yet** as of this doc; production currently has
   no `vision_*` tables, no `vision-recordings` bucket, no `vision_notify`
   column, and no field-mask/goal-zone columns:
   - `migrations/20260828_vision_system.sql`
   - `migrations/20260829_vision_notifications_release_fleet.sql`
   - `migrations/20260829_vision_field_mask_goal_zones.sql`
2. Grant `VISION_REVIEW` (and `VISION_RELEASE`, for whoever should be able to
   release results) from the admin panel's Permissions column - this is now
   possible through the app (see **Slack alerting** above for how the
   checkbox UI works); it no longer requires a raw SQL edit. It still
   assumes `public.has_permission()` already exists in the DB (it does -
   confirmed against a real schema dump, `schema.sql`, which predates the
   vision tables but already has this function).
3. Set `VISION_RUNNER_TOKEN` (shared secret) and `TBA_API_KEY` in the web
   service's environment.
4. Deploy `vision/runner/vision_runner.py` separately (GPU host), with
   `VISION_API_URL`, `VISION_RUNNER_TOKEN`, `VISION_RUNNER_ID`, and
   `VISION_MODEL_PATH` pointing at a locally trained model — no weights are
   committed to this repo.

`/scouting/vision` **is** now linked - a real "Vision Scouting" tab in the
Competition nav folder (`src/routes/+layout.svelte`, `navigation.json`,
`defaultTabs.js`) - but `canRenderTabKey('vision')` hides it from anyone
without `VISION_REVIEW` (or `VIEW_ADMIN_PANEL`), so step 2 above is still
what actually determines who can see it, not the nav wiring itself.
