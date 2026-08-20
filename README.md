# Spartans Hub

Team management hub for FRC team 971 (Spartan Robotics) - manufacturing/CAM,
scouting, planning, and purchasing in one app.

## Architecture

Whole-project overview: tech stack, module map, data layer, deployment, and
contribution workflow. This is a **living reference** - **update it whenever
a new feature or subsystem is added**, not just when someone happens to read
it. If a change adds a new top-level route, a new major `src/lib` module, a
new external integration, or changes how the app is deployed, that change
isn't done until this file reflects it.

For a specific feature's own deep-dive architecture, see `autocam/docs/`
(AutoCAM specifically - e.g. `autocam/docs/architecture.md` for the Google
Drive/manufacturing-folder integration) or `implementations/` (everything
else) - this file stays at the whole-project level and links out rather
than duplicating that detail.

## Stack

- **Framework**: SvelteKit (Svelte 5), plain JS (no TypeScript) with
  `jsconfig.json` for editor type-checking.
- **Hosting**: dual right now - Google Cloud Run (`adapter-node`, primary
  going forward) and Vercel (`adapter-auto`, being phased out). See
  `docs/deployment/google-cloud-run.md` and `googledrivesetup.md` (Drive
  watcher setup) for the Cloud Run side. `cloudbuild.yaml`/`Dockerfile` are
  Cloud-Run-specific config - they may or may not be physically present on
  every remote's `main` depending on sync history, but they're only
  functionally active via `spartanshub`'s own Cloud Build trigger (see
  **Contribution workflow** below), regardless of which mirrors happen to
  carry the files.
- **Database/Auth/Storage**: Supabase (Postgres + RLS, Supabase Auth,
  Supabase Storage). `docs/guides/AUTH_PROTOCOL.md` covers the auth flow in
  detail (UUID-only local persistence, client-side only - no SSR session,
  `@supabase/ssr` is a declared but unused dependency).
- **3D/CAD**: `occt-import-js` (STEP file parsing, WASM) + `three.js`
  (client-side 3D viewing, `CadViewer.svelte`).
- **Other integrations**: Slack (`@slack/web-api`, bot notifications/DMs),
  Onshape API (CAD source of truth for parts - see the Onshape-key exposure
  note under **Known gaps** below), The Blue Alliance API (scouting), Sentry
  (error monitoring), Google Drive API (AutoCAM input/output watcher, hand-
  rolled, no `googleapis` dependency - see `autocam/docs/architecture.md`).

## AutoCAM (`autocam/`, top-level - not under `src/lib/`)

STEP → G-code generation for turning/routing: pure JS geometry math, no
external CAM software, no DXF. Deliberately lives outside `src/lib/` in its
own top-level folder, imported via the `$autocam` alias
(`svelte.config.js`) - the whole engine, the Google Drive watcher, shared
job-queue helpers, AutoCAM-specific components, its CLI test script, and its
own docs are all together in one place instead of scattered across
`src/lib/cam/`, `src/lib/server/`, `src/lib/components/`, and
`implementations/`.

- **`autocam/stepProfile.js`** - extracts 2D profiles directly from a STEP
  file's triangulated mesh (via `occt-import-js`).
- **`autocam/turning.js`** / **`autocam/routing.js`** - generate the actual
  G-code from that profile.
- **`autocam/toolpathPreview.js`** - parses generated G-code back into a
  toolpath for preview (`autocam/components/ToolpathViewer.svelte`).
- **`autocam/drive_watcher.js`** - Google Drive input-sweep (`cad` →
  auto-queue) and output-delivery (finished G-code → dated `cammed`
  subfolder) - see `autocam/docs/architecture.md` for the real folder
  layout this was built for.
- **`autocam/camJobs.js`** - shared job-queue helpers used by both
  `/autocam` and `/manufacture`.
- **`autocam/components/`** - `ToolpathViewer.svelte`, `CamParamFields.svelte`,
  `RoutingToolSequence.svelte`, `TurningFinishTool.svelte`,
  `AutocamReviewModal.svelte` (the last one currently unused anywhere - a
  known dead-code candidate, not yet removed).
- **`autocam/scripts/test-cam-extraction.mjs`** - standalone CLI to run a
  real STEP file through the pipeline without the web app - the main tool
  used to stress-test this system against real CAD files.
- **`autocam/__fixtures__/`** - real STEP files, committed as regression
  fixtures - each one was chosen because it caught a real bug (see the
  `*.test.js` files next to the engine modules for what each one covers),
  not arbitrarily.
- **`autocam/docs/`** - AutoCAM-specific planning/architecture docs
  (`architecture.md`, `drive-watcher-implementation.md`, etc.).
- **`autocam/runner/README.md`** - the still-deferred milling Runner concept
  (turning/routing are synchronous in-process math; milling would need an
  actual external Fusion 360 Runner, not built).
- **Route files stay in `src/routes/`** regardless (`src/routes/autocam/+page.svelte`,
  `src/routes/api/cam-generate/+server.js`, `src/routes/api/drive-watcher/+server.js`)
  - SvelteKit determines a route's URL from its file location under
    `src/routes/`, so these can't move into `autocam/` themselves; they just
    import the engine from `$autocam/...` instead of holding logic directly.
- **Legacy, NOT part of the above, NOT moved**: `src/lib/autocam.js` and
  `src/routes/manufacture/autocam/+page.svelte` are remnants of an older,
  disabled DXF/PenguinCAM-based system (`DISABLE_AUTOCAM` in
  `src/lib/config/autocam.js`), unreferenced from anywhere in the app's
  navigation. Left in place as a known dead-code finding, not yet removed.

## Module map (`src/routes`, by domain)

- **`manufacture/`, `cad/`, `autocam/`** - the CAD-to-manufacturing pipeline:
  part tracking, STEP viewing, and AutoCAM (see the **AutoCAM** section
  above for where its actual code lives).
- **`planner/`** - scheduling/task system with a Gantt view
  (`wx-svelte-gantt`), Slack-driven prompts/notifications
  (`src/lib/server/planner_notifications.js`, `971bot.js`), driven by a
  Supabase `pg_cron` job every 15 minutes.
- **`pitscout/`, `datascout/`, `notescout/`, `scouting-admin/`,
  `teamview/`, `discover/`** - FRC competition scouting: pit scouting forms,
  match data scouting, notes, and cross-team data discovery/analysis.
- **`cots-stocking/`, `kitting/`** - purchasing/inventory: COTS (commercial
  off-the-shelf) part stock tracking and kitting workflows.
- **`tasks/`** - general task tracking, separate from the planner's
  scheduling-focused tasks.
- **`admin/`, `profile/`** - user/permission administration, user profile
  settings.
- **`api/`** - server endpoints backing the above, plus integration
  webhooks/crons: `api/cam-generate` (synchronous G-code generation),
  `api/drive-watcher` (Drive input-sweep, cron-gated), `api/planner`
  (notification sweep, cron-gated), `api/onshape`, `api/tba`, `api/971bot`
  (Slack), `api/attendance`, `api/scout-assignments`, `api/scouting-admin`,
  `api/scouting-config`, `api/tasks`, `api/admin`, `api/notifications`.

## `src/lib` (shared code)

AutoCAM's own code (engine, Drive watcher, `camJobs.js`, its components) is
**not** here - see the dedicated **AutoCAM** section above for why.

- **`server/`** - server-only modules (`$lib/server/...`, never bundled to
  the client): `971bot.js` (Slack), `cron_auth.js` (shared auth check for
  cron-triggered endpoints - see **Known gaps**), `planner_notifications.js`.
- **`planner/`** - planner domain logic (scheduling, interaction rules,
  timezone handling - Pacific time throughout, see `PACIFIC_TIME_ZONE` in
  `src/lib/timezone.js`).
- **`components/`** - shared Svelte components: `CadViewer.svelte` (a
  generic STEP/3D viewer used outside AutoCAM too - `/manufacture`,
  `/manufacture/completed` - so it stayed here rather than moving into
  `autocam/` despite being CAD-adjacent), nav/layout pieces, etc.
- **`config/`** - feature flags (e.g. `DISABLE_AUTOCAM` - see **Known
  gaps**, the legacy autocam system this flag referred to has since been
  removed entirely).
- **`notifications/`, `stores/`** - notification settings, Svelte stores for
  cross-component state.

## Data layer

- **Migrations** live in `migrations/*.sql`, applied via the Supabase MCP
  tooling (`apply_migration`) - not a formal migration framework, just
  timestamped SQL files. Many migrations use `CREATE ... IF NOT EXISTS` /
  `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` throughout specifically so
  they're safe to re-run (see `migrations/20260817_cam_studio_system.sql`'s
  own header comment for the reasoning) - prefer that pattern for new
  migrations too.
- **RLS (Row Level Security)** is the real authorization boundary - not
  app-layer checks. Every table should have RLS enabled with real policies;
  see **Known gaps** for tables that currently don't.
- **Auth**: Supabase Auth, client-side only (no server session/SSR) - see
  `docs/guides/AUTH_PROTOCOL.md`.

## Deployment & CI

- **Cloud Run** (`geminiapi-469220` project, `spartanshub` service,
  `spartanshub.spartanrobotics.org`): builds via Cloud Build
  (`cloudbuild.yaml`), triggered on push to `main` on the `spartanshub`
  GitHub remote. See `docs/deployment/google-cloud-run.md` for the full
  setup/secrets checklist.
- **Vercel**: the original deployment target, being phased out per
  `implementations/vercel-and-supabase-to-google-plan.md` - not yet
  decommissioned as of this writing (see that plan doc's TODOs).
- **No GitHub Actions CI** - "the GitHub workflow" for this project is the
  branch/PR process below, not a `.github/workflows/*.yml` file (none
  exists). The closest thing to a CI check is the Cloud Build trigger
  itself, which runs on real pushes to `spartanshub`'s `main`.

## Contribution workflow

- **Remotes**: two - `stormcoded` and `spartanshub` (`frc971/spartanshub`,
  the team's org repo). `spartanshub` is the **primary** remote and the
  source of truth for day-to-day feature work; `stormcoded` is kept in sync
  afterward. `spartanshub` requires PRs (branch protection) - `stormcoded`
  accepts direct pushes to `main`. (A third remote, `origin`, existed
  earlier but was removed.)
- **New feature work starts on a branch**, not direct commits to `main` -
  and **the branch+PR dance is `spartanshub`-only**: branch off `main`, do
  the work, push the branch to `spartanshub`, open a PR against
  `frc971/spartanshub`, merge it there (don't delete the branch after
  merging), then sync `stormcoded` with a plain direct push to `main` - no
  branch/PR for `stormcoded`, ever. Small fixes/doc tweaks can still go
  straight to `main` on both.
- **Check sync before starting a new feature** - `git fetch spartanshub
  main` and compare against local `main`/the working branch before
  branching, so feature work doesn't start from a stale base.
- **Never add a Claude/AI co-author trailer** on commits in this repo - a
  standing, explicit, non-negotiable rule.

## Known gaps (check before assuming otherwise)

- **8 tables have RLS fully disabled**: `scouting_settings`,
  `attendance_locations`, `attendance_schedules`,
  `attendance_schedule_locations`, `user_attendance_logs`,
  `user_notification_logs`, `pit_scout_entries`, `runtime_leases`. Confirmed
  live via the Supabase security advisor - re-check before relying on this
  list being current, since it should shrink over time as these get fixed.
- **`PUBLIC_ONSHAPE_SECRET_KEY` ships in the public client bundle** - a
  pre-existing design choice (`src/lib/onshape.js` uses
  `$env/static/public`), not something introduced by any specific recent
  change. Worth a follow-up to proxy Onshape calls server-side and rotate
  the key once that's done.
- **Cron-auth (`cron_auth.js`) is fail-open by design** when no
  `CRON_SECRET`/`CRON_TOKEN`/`CRON_NOTIFICATION_TOKEN` is configured -
  intentional for frictionless local dev, but means the real secret must
  actually be set in production or `/api/planner/notifications` and
  `/api/drive-watcher` accept unauthenticated requests. Confirm this is
  configured before trusting either deployment target is fully locked down.
