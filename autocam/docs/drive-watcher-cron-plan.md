# AutoCAM auto-trigger from Google Drive — implementation plan (not built)

**Superseded by `drive-watcher-implementation.md`** - this is now built (both the input watcher this plan describes, and an output-delivery direction this plan didn't originally cover). Kept as-is for the original design reasoning/tradeoffs; see the other doc for the as-built architecture, setup steps, and what's still genuinely pending (the cron trigger for the input side).

## Goal

Right now every AutoCAM job starts with a human opening `/autocam`, choosing an operation, uploading a STEP file, and picking parameters. This plan covers watching a Google Drive folder and automatically creating + generating a job the moment a CAD file lands in it, with no human click needed to kick it off.

## Build this on the automation pattern this app already has - don't invent a new one

This app already runs a real, working scheduled background job today: planner Slack reminders, firing every 15 minutes. Traced the whole path directly against the live database rather than assuming:

1. **`pg_cron`** (a Postgres extension, already installed) has one active job:
   ```
   jobid=1, schedule='*/15 * * * *', command='SELECT public.invoke_planner_notification_cron();'
   ```
2. That Postgres function reads two secrets from **Supabase Vault** (`planner_notifications_app_url`, `planner_notifications_cron_token`), then uses **`pg_net`** (also already installed) to fire an HTTP POST straight from Postgres to `{app_url}/api/planner/notifications` with `Authorization: Bearer {cron_token}`.
3. That SvelteKit route (`src/routes/api/planner/notifications/+server.js`) checks the bearer token via `src/lib/server/cron_auth.js`'s `isAuthorizedCronRequest()` (accepts `NOTIFICATION_CRON_TOKEN` / `CRON_NOTIFICATION_TOKEN` / `CRON_SECRET` env vars, or a `?token=` query param), then calls `runPlannerPromptSweep()`.
4. That function claims a lease first - `public.claim_runtime_lease(lease_key, lease_seconds, min_interval_seconds)`, an atomic `INSERT ... ON CONFLICT` against a tiny `runtime_leases` table (`key`, `lease_expires_at`, `last_started_at`, `last_finished_at`) that only succeeds if no other invocation currently holds that lease - does the work, then `release_runtime_lease()` in a `finally` block. This is what makes it safe for `pg_cron` to fire on a fixed schedule even if a previous run is still going or the endpoint is slow to respond.

There's no Vercel Cron config anywhere in this repo (no `vercel.json`, no cron-tagged routes) - this Postgres-driven approach is the actual established mechanism, and the Drive watcher should be built the same way: a new `pg_cron` schedule, a new `invoke_drive_watcher_cron()` Postgres function reading its own Vault secrets, a new authenticated SvelteKit endpoint, and its own lease key reusing the same `claim_runtime_lease`/`release_runtime_lease` RPCs (no new database functions needed for that part - just a new `lease_key` value, e.g. `'drive_watcher_sweep'`).

## Google Drive side

- **Auth**: a Google Cloud project with the Drive API v3 enabled, and a **Service Account** (not a per-person OAuth login - nobody's individual Drive session should be a dependency for a background job). Share the target Drive folder(s) with the service account's email address (Viewer access is enough to read + download files). Store the service account's JSON key as a Vercel environment variable (`GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`) - this only needs to be readable by the SvelteKit endpoint itself (Node/Vercel side), unlike the Vault secrets above which `pg_net` needs *from inside Postgres* to make the initial call.
- **Detecting new files**: use Drive's **Changes API** (`changes.list`), not naive `modifiedTime` polling. Changes API gives a resumable `pageToken` cursor that reliably captures adds/renames/moves between polls without missing or double-processing files; `modifiedTime` comparisons can race or get bumped by unrelated metadata edits. Store the current `pageToken` in a new small table (e.g. `drive_watcher_state(folder_id text primary key, page_token text, updated_at timestamptz)`) so each sweep resumes exactly where the last one stopped.
- **Idempotency / audit trail**: a new `drive_watcher_files` table (`drive_file_id text primary key, cam_job_id uuid references cam_jobs(id), processed_at timestamptz, status text, error text`) so a file is never queued twice even if the cursor ever gets reset, and so failures are visible and reprocessable later.
- **Batch size cap**: process a bounded number of new files per sweep (e.g. 10) rather than everything the Changes API returns at once - protects against a folder someone bulk-uploads 200 files into all spawning simultaneous generation jobs in one sweep. The next sweep just continues from the saved cursor.

## The genuinely hard part: what parameters does an auto-triggered job use?

Nobody's there to fill out the New Job form. This needs a real answer, not a guess - the same principle this project has followed all along for physically consequential choices (tool changes, flip-turning, etc.).

**Proposed approach - one Drive folder per Machine Profile**, extending the data model that already exists for exactly this purpose:
- Add `drive_folder_id text` (nullable) to `cam_machines`. Only machines that should auto-trigger get one set (via the existing Machine Profile editor UI, once this ships).
- A file appearing in a folder mapped to a machine creates a `cam_jobs` row using **that machine's `operation_type` and `default_params`** - the exact same mechanism the manual "select a Machine Profile" dropdown already uses today. The watcher's only job is: detect file → upload it → create the job with the machine's defaults → call the *existing* `/api/cam-generate` logic. It must not reimplement any generation logic itself - all of that stays exactly as-is, already tested, already hardened through this whole project.

**Routing can fully automate today, no new convention needed**: `targetDepth` already self-derives from the STEP file's own material thickness when not explicitly set (`+server.js`: `if (params.targetDepth === undefined && thickness) params.targetDepth = thickness`) - a routing job dropped into a mapped folder has everything it needs already.

**Turning cannot** - `stockDiameter` has no automatic source; it's a real stock-selection decision, not something derivable from the part geometry alone (the part's own max radius is a lower bound, not the actual stock size someone will chuck up). Options, in order of preference:
1. **Land as a draft, not an auto-fired job** - create the `cam_jobs` row from the file, but leave it `status = 'queued'` without ever calling `/api/cam-generate` until a human opens it, sets stock diameter, and clicks "Save & Regenerate". Safest - never guesses on a physical setup parameter. Costs the automation its "fully hands-off" property for turning specifically.
2. A filename convention (e.g. `PartName_0.625dia.step`) parsed with a regex to extract stock diameter automatically - only worth it if there's real appetite for remembering a naming convention every time; fragile if someone forgets or gets the format slightly wrong, and a wrong stock size is a real crash/scrap risk, not just a cosmetic error.

Recommendation: option 1 for turning, full automation for routing, revisit a filename convention later only if manually confirming stock diameter turns out to be the actual bottleneck in practice.

## Error visibility

This app already has a working Slack bot (`src/lib/server/971bot.js`, used for planner reminders). Reuse it: post a Slack message to a designated channel/DM when a Drive-triggered job fails to generate (bad/corrupt STEP file, no machine mapped to that folder, Drive API error, etc.) - otherwise a background failure could sit invisible in the jobs list until someone happens to check.

## Security notes

- Service account only ever sees folders explicitly shared with it - don't grant it broader Drive access than the specific watched folders.
- Validate the downloaded bytes are actually a readable STEP file (the existing `readStepMeshes` error path already covers this) before ever creating a `cam_jobs` row for it - don't queue garbage.
- The new cron endpoint needs the same bearer-token gate as the planner one (`isAuthorizedCronRequest`) - trivially reusable as-is, just add a `DRIVE_WATCHER_CRON_TOKEN` (or reuse `CRON_SECRET`, which the helper already checks generically) and a matching Vault secret pair (`drive_watcher_app_url`, `drive_watcher_cron_token`) for the new Postgres function to read.

## Phased implementation order

1. **Google Cloud setup** (manual, outside this repo): create the project, enable Drive API, create the service account, share the target folder(s) with it, get the JSON key into a `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` env var.
2. **Data model**: `drive_folder_id` on `cam_machines`; new `drive_watcher_state` and `drive_watcher_files` tables; RLS matching the existing `cam_*` table pattern (service-role bypass + `approved_user()` read).
3. **`src/routes/api/drive-watcher/+server.js`**: bearer-token gated (reuse `isAuthorizedCronRequest`), claims the `drive_watcher_sweep` lease, calls the Changes API from the stored cursor, for each new file in a mapped folder: downloads it, uploads to the `manufacturing-files` bucket, inserts a `cam_jobs` row with that machine's defaults, and (routing only, for now) calls the existing generation logic - same call this route's planner counterpart already makes to its own work function.
4. **Postgres side**: `invoke_drive_watcher_cron()` function (near-identical to `invoke_planner_notification_cron()`, different Vault keys/target path) + a new `pg_cron` schedule. Interval is a judgment call - probably more frequent than the 15-minute planner sweep, since someone dropping a file in probably wants it picked up faster; open question, not assumed here.
5. **UI**: add the "Drive folder" field to the Machine Profile editor (`/autocam` → Manage Profiles), a way to see/retry `drive_watcher_files` entries that failed.
6. **Slack failure notifications**, reusing `971bot.js`.
7. **Verification**: drop a real test STEP file into a real mapped test folder, confirm a job appears and (for routing) completes within one sweep interval; confirm a second drop of the same unchanged file doesn't double-process; confirm a corrupt/non-STEP file fails cleanly and doesn't crash the sweep for the other files in the same batch.

## Open questions to resolve before starting

1. Does whoever manages the team's Google Workspace have (or can get) permission to create a service account and share specific folders with it? This needs Workspace admin involvement, not just app-level configuration.
2. Sweep interval - how fast does a dropped file need to be picked up in practice?
3. Confirm the "draft, needs a human to set stock diameter" behavior for turning is acceptable, versus wanting a filename convention from day one.
4. Should there be one shared "AutoCAM Drop" folder with subfolders per machine, or entirely separate top-level folders per machine? Affects the Google Drive folder-sharing setup, not the app logic either way.
