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
overview - scope/features, stack, module map, data layer, deployment,
contribution workflow. It's also the **only** file allowed to be named
`architecture.md`/`ARCHITECTURE.md` in this repo - a feature-specific doc
that would otherwise want that name (see `autocam/docs/` for an example)
needs a different, more specific name instead. Whenever a change adds or
removes a user-facing feature, a new top-level route, a new major `src/lib`
module, a new external integration, or changes how the app is deployed,
update that file as part of the same change - not as a separate follow-up.
See its own header for the same instruction and for how it relates to
feature-specific docs (`autocam/docs/` for AutoCAM specifically,
`implementations/` for everything else).

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

**Testing the manufacturing-request Slack notification pipeline**: don't
trigger `notifyManufacturingRequestById` (or `POST /api/notifications`
with `type: 'manufacturing-request'`) end-to-end using a real workflow
value (`3d-print`, `router`, `lathe`, `mill`, `laser-cut`) - those have
real subscribed leads (currently Sahil Rajput and Anton Strougo on
`3d-print`) who should never receive test traffic. Use `workflow: 'test'`
for any test part instead - it's a reserved value no real creation form
ever produces, and only Yuvan Shankar (`yuvan262626@gmail.com`) is
subscribed to it in `user_profiles.manufacturing_lead_workflows`. For
testing message *wording* specifically (not the DB-driven recipient
resolution), prefer `scripts/send-slack-test.mjs` instead - it hits an
already-deployed admin-only endpoint with an arbitrary recipient/text pair
and needs no local build or the reserved test workflow at all:
```
node --env-file=.env scripts/send-slack-test.mjs <email> "<message text>"
```
Requires `DEV_TOOLS_EMAIL`/`DEV_TOOLS_PASSWORD` in `.env` (a persistent
admin test account - gitignored, not committed; see the comment above
those vars in `.env`).