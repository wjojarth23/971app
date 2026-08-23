# August 2026: Nav reorg into Purchasing / Manufacturing / Competition / CAD

Point-in-time summary. Not kept up to date after the fact — see
`src/lib/defaultTabs.js` and `src/routes/+layout.svelte` for current behavior.

## What changed

**Default top-level nav** (`src/lib/defaultTabs.js`) was regrouped from a
flat list of ~10 tabs into folders, in response to direct feedback that the
home screen felt cluttered with tools most people don't touch day to day.
Order (left to right): Home, Manufacturing, CAD, Competition, Purchasing,
Docs, Admin (admin-only, always last).

- **Manufacturing** (folder): Manufacture, AutoCAM, Kitting, COTS Stocking.
- **CAD** (folder): CAD, Build — combined since Build is really a CAD
  sub-concern (already lives at `/cad/build`).
- **Competition** (folder): Scouting, Pit Scouting, Data Scouting, Note
  Scouting, Team View, Scouting Admin. Several of these (Pit/Data/Note
  Scouting, Team View, Scouting Admin) were previously opt-in only via the
  profile page's "Add tab" UI — the whole point of the reorg was making them
  discoverable as one coherent section instead of requiring someone to
  already know they exist. Scouting Admin's own visibility is still gated by
  `canRenderTabKey` (Competition Lead / admin only) regardless of nesting.
- **Purchasing** and **Docs** stand alone.

This only changes what a user with **no saved `header_tabs`** sees. Anyone
who already customized their nav keeps their own saved layout — there's no
automatic re-migration of existing customizations (same limitation noted in
the Docs tab's own history).

## Two real bugs found and fixed along the way

Folders existed as a nav concept before this change (`buildNavItems` /
`toLinkItem` in `+layout.svelte`) but were never exercised by the default
nav, since only flat tabs existed previously. Turning them on for real
exposed two latent bugs:

**1. Dropdown menus didn't open at all** (`src/routes/+layout.svelte`)

`.desktop-nav` sets `overflow-x: auto` (to let a long tab list scroll
horizontally) but never explicitly sets `overflow-y`. Per the CSS overflow
spec, setting either axis to a non-`visible` value forces the *other* axis
to also compute as non-`visible` — you cannot mix `visible`/`auto` across
x and y. That silently clipped `.dropdown-menu`, an absolutely-positioned
child, even though its own `display`/`opacity`/`position` all looked correct
in isolation. Setting `overflow-y: visible` explicitly does **not** fix
this — it's still forced non-visible by the spec rule above (verified via
computed-style inspection, not just guessed).

Fix: `.dropdown-menu` switched from `position: absolute` to `position:
fixed`, with real viewport coordinates computed in `toggleDesktopFolder()`
via `getBoundingClientRect()` and passed down as an inline style. `position:
fixed` escapes *all* ancestor overflow clipping, not just the nearest one.
The resize handler also now closes open folders, since fixed-position
coordinates go stale on viewport resize.

**2. AutoCAM 500/403 in local dev** (`vite.config.js`)

Once dropdowns worked, clicking Manufacturing → AutoCAM 500'd. Root cause:
SvelteKit's own Vite plugin replaces `server.fs.allow` with a curated list
(`src/`, `node_modules/`, the `.svelte-kit` outDir) — it has no idea the
`$autocam` alias (`svelte.config.js`) points at a sibling top-level
`autocam/` folder. Vite's dev-server file-serving check runs against that
allowlist independently of whether the alias itself resolves correctly, so
every `$autocam/*` import (`CamParamFields.svelte`,
`RoutingToolSequence.svelte`, `TurningFinishTool.svelte`,
`ToolpathViewer.svelte`, `camJobs.js`) 403'd, which surfaced to the page as
a 500. This only affected local dev — production builds bundle everything
regardless of source folder, so it was never live-broken.

Fix: added `autocam/` to `server.fs.allow` explicitly in `vite.config.js`.

## Verification

Both bugs were confirmed fixed via real logged-in click-through (Playwright,
throwaway test accounts created/deleted directly in Supabase for the
session, since email rate limits blocked registering through the UI) —
not just code inspection:

- Manufacturing, CAD, and Competition dropdowns all render and their links
  navigate correctly.
- Competition dropdown correctly hides Scouting Admin for a non-Competition-
  Lead test user, confirming permission gating still works for tabs nested
  inside folders.
- AutoCAM loads its full job list/stats/filters with no console errors.
- Final nav order confirmed live: Home, Manufacturing, CAD, Competition,
  Purchasing, Docs, Admin.
- Full test suite (470 tests) and `npm run build` pass.
