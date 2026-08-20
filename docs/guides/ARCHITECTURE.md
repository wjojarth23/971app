# Architecture

Whole-project overview: tech stack, module map, data layer, deployment, and
contribution workflow. This is a **living reference** (see `docs/README.md`'s
own rule for this folder) - **update it whenever a new feature or subsystem
is added**, not just when someone happens to read it. If a change adds a new
top-level route, a new major `src/lib` module, a new external integration, or
changes how the app is deployed, that change isn't done until this file
reflects it.

For a specific feature's own deep-dive architecture, see `implementations/`
(e.g. `implementations/architecture.md` for the Google Drive AutoCAM/
manufacturing-folder integration) - this file stays at the whole-project
level and links out rather than duplicating that detail.

## Stack

- **Framework**: SvelteKit (Svelte 5), plain JS (no TypeScript) with
  `jsconfig.json` for editor type-checking.
- **Hosting**: dual right now - Google Cloud Run (`adapter-node`, primary
  going forward) and Vercel (`adapter-auto`, being phased out). See
  `docs/deployment/google-cloud-run.md` and the repo-root `README.md` (Drive
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
  rolled, no `googleapis` dependency - see `implementations/architecture.md`).

## Module map (`src/routes`, by domain)

- **`manufacture/`, `cad/`, `autocam/`** - the CAD-to-manufacturing pipeline:
  part tracking, STEP viewing, and AutoCAM (STEP → G-code generation for
  turning/routing, pure JS geometry math in `src/lib/cam/*.js` - no external
  CAM software, no DXF). `src/lib/cam/stepProfile.js` extracts 2D profiles
  directly from a STEP file's triangulated mesh; `turning.js`/`routing.js`
  generate the actual G-code. Heavily fixture-tested against real STEP files
  in `src/lib/cam/__fixtures__/` - each fixture there was chosen because it
  caught a real bug, not arbitrarily.
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

- **`cam/`** - AutoCAM geometry/G-code engine, see above. Extensively unit-
  and fixture-tested (`*.test.js` next to each module).
- **`server/`** - server-only modules (`$lib/server/...`, never bundled to
  the client): `971bot.js` (Slack), `drive_watcher.js` (Google Drive),
  `cron_auth.js` (shared auth check for cron-triggered endpoints - see
  **Known gaps**), `planner_notifications.js`.
- **`planner/`** - planner domain logic (scheduling, interaction rules,
  timezone handling - Pacific time throughout, see `PACIFIC_TIME_ZONE` in
  `src/lib/timezone.js`).
- **`components/`** - shared Svelte components (`CadViewer.svelte`,
  `ToolpathViewer.svelte`, nav/layout pieces, etc.).
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

- **Remotes**: this repo pushes to three - `origin`, `stormcoded`, and
  `spartanshub` (`frc971/spartanshub`, the team's org repo). `spartanshub`
  is the **primary** remote and the source of truth for day-to-day feature
  work; `origin`/`stormcoded` are kept in sync afterward. `spartanshub`
  requires PRs (branch protection) - the other two accept direct pushes to
  `main`.
- **New feature work starts on a branch**, not direct commits to `main`:
  branch off `main`, do the work, push the branch to `spartanshub`, open a
  PR against `frc971/spartanshub`, merge it there, then sync
  `origin`/`stormcoded` with the merged result. Small fixes/doc tweaks can
  still go straight to `main` on all three.
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
