<claude-mem-context>
# Memory Context

# claude-mem status

This project has no memory yet. The current session will seed it; subsequent sessions will receive auto-injected context for relevant past work.

Memory injection starts on your second session in a project.

`/learn-codebase` is available if the user wants to front-load the entire repo into memory in a single pass (~5 minutes on a typical repo, optional). Otherwise memory builds passively as work happens.

Live activity: http://localhost:37701
How it works: `/how-it-works`

This message disappears once the first observation lands.
</claude-mem-context>

# Project instructions

**Keep the repo-root `README.md` up to date.** It's a living whole-project
overview (stack, module map, data layer, deployment, contribution workflow).
Whenever a change adds a new top-level route, a new major `src/lib` module, a
new external integration, or changes how the app is deployed, update that
file as part of the same change - not as a separate follow-up. See its own
header for the same instruction and for how it relates to feature-specific
docs (`autocam/docs/` for AutoCAM specifically, `implementations/` for
everything else).

**AutoCAM code lives in a dedicated top-level `autocam/` folder**, not under
`src/lib/` - engine (`turning.js`/`routing.js`/`stepProfile.js`/
`toolpathPreview.js`), the Google Drive watcher (`drive_watcher.js`), shared
job-queue helpers (`camJobs.js`), AutoCAM-specific components
(`autocam/components/`), the CLI test script (`autocam/scripts/`), and its
own docs (`autocam/docs/`) all live there, imported via the `$autocam` alias
(configured in `svelte.config.js`) rather than `$lib`. The exception: any
`+page.svelte`/`+server.js` file stays under `src/routes/` regardless - a
route's location determines its URL in SvelteKit, so those can't move, they
just import from `$autocam/...` instead of holding the code directly.
`CadViewer.svelte` stays in `src/lib/components/` - it's a generic STEP
viewer used outside AutoCAM too (`/manufacture`, `/manufacture/completed`),
not AutoCAM-specific despite being CAD-adjacent.

**Contribution workflow**: two remotes, `stormcoded` and `spartanshub`
(`frc971/spartanshub`). `spartanshub` is the primary remote - feature work
branches off `main`, gets pushed to `spartanshub`, and goes through a PR
there before merging (branch is NOT deleted after merging); `stormcoded`
gets a plain direct push to `main` afterward, never a branch/PR. See
the repo-root `README.md`'s "Contribution workflow" section for the full
rule set (including: never add a Claude/AI co-author trailer on commits in
this repo).