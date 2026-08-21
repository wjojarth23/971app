# Fusion CAM

The Fusion-360-backed milling pipeline - a second, separate CAM path alongside `autocam/`'s existing pure-JS turning/routing generator (`turning.js`/`routing.js`/`stepProfile.js`). That system deliberately has no external dependency and stays exactly as-is; this one exists specifically because real 3-axis milling (contoured 3D surfaces) needs a real CAM engine, which pure JS geometry math can't reach - see `autocam/docs/millimplementations.md`'s "Option C."

Ported from FRC Team Valor 6800's open-source **AutoCAM** (MIT licensed):
- [`AutoCAM-FRC/Website`](https://github.com/AutoCAM-FRC/Website) - the original job-queue dashboard (Next.js/React/tRPC/Drizzle/Postgres/Better-Auth).
- [`AutoCAM-FRC/Runner`](https://github.com/AutoCAM-FRC/Runner) - the original Fusion 360 add-in.

## Structure

- **`_upstream/`** - the original `AutoCAM-FRC/Website` source, vendored in whole via `git subtree` (preserves upstream commit history; `git subtree pull` can bring in future upstream fixes). **Reference only - never built, never imported, not wired into `vite.config.js` or this app's SvelteKit routing.** It's here so the exact original is always available to diff/port from directly, not re-derived from memory.
- **`runner/_upstream/`** - same treatment for the original `AutoCAM-FRC/Runner` Fusion 360 add-in source.
- **`runner/`** (once ported) - our own forked/adapted copy of the Runner: same Fusion Python automation (template application, toolpath generation, G-code export), networking layer rewritten to poll *this app's* `/api/fusion-runner` endpoints instead of the original WebUI's API. Runs locally in Fusion 360, same install pattern as `../../valor6800-autocam-runner-setup.md` (repo root) documents for the unmodified original - that guide gets updated once this fork exists.
- **The actual, working feature** (once built) is native SvelteKit/Supabase code living under `src/routes/autocam/fusion/` and a new `src/lib/fusionCam.js` data-layer module - NOT inside this folder. `_upstream/`'s Next.js/React/tRPC/Drizzle source is the *reference the port is built from*, not code that runs in this app. See the architecture plan this was built from for the full data-model mapping (which of their tables got reused vs. replaced by existing `cam_jobs`/`cam_machines`/`cam_tools`/`cam_materials`, and which are genuinely new).

## Why vendor the whole original instead of just porting from memory

Explicit project decision: keeping the complete, unmodified original in the repo means anyone working on this feature can always diff against exactly what Valor 6800 actually built, instead of relying on notes or a possibly-incomplete port. It also means this repo doesn't depend on GitHub availability or upstream deletion to keep that reference around.
