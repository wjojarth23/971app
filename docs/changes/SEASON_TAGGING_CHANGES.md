# FRC Season/Offseason Tagging & Filtering - Implementation Summary

## Overview
Added an FRC season/offseason tag to every part (Manufacturing), purchase (Purchasing), and build (CAD Build Center), plus a "Season" filter dropdown to browse items by year-bucket. Buckets are computed automatically from `created_at` with no stored per-year config, so new buckets appear on their own as time passes.

## Motivation
Parts and purchases accumulate across build seasons and offseasons with no way to tell which era an item belongs to, or to browse just one era (e.g. "show me only 2026 Offseason purchases"). This was a plain UI/filtering feature request — no underlying bug.

## Season Boundary Rule

FRC kickoff always lands in early-to-mid January but the exact Saturday moves year to year (Jan 4 2025, Jan 10 2026, Jan 9 2027 — FIRST sets it by hand, no fixed formula). The World Championship always concludes by the first week of May (Apr 29–May 2, 2026). Rather than hardcode real per-year dates (which would need manual upkeep every year), a fixed calendar-day boundary is used that stays close to reality forever with zero maintenance:

- **Season**: Jan 1 – May 15
- **Offseason**: May 16 – Dec 31

Labeled by calendar year, e.g. `"2026 Season"`, `"2026 Offseason"`. Computed in Pacific time (same zone already used for the "Created" date columns) so the tag always agrees with the displayed date.

## New Files

### `src/lib/frcSeason.js`
Shared helper module (mirrors the existing `src/lib/frcTeams.js` pattern used for team filtering):
- `getSeasonBucket(date)` → `{ year, isOffseason, value, label }` for a given date.
- `getSeasonLabel(date)` → convenience label string.
- `getCurrentSeasonBucket()` → bucket for "now"; used as each filter's default value.
- `getAllSeasonBuckets(items, dateField)` → sorted (newest-first) list of `{value, label}` options, spanning from the earliest `created_at` found in the passed-in data (or the current year if there's no data yet) through the current bucket. Grows a new entry automatically every time the Jan 1 / May 16 boundary is crossed.
- `passesSeasonFilter(date, selectedValue)` → boolean predicate, same shape as `passesTeamFilter` in `frcTeams.js`.

### `src/lib/components/SeasonFilter.svelte`
Reusable `<select class="form-select">` dropdown (not checkboxes, unlike `TeamFilter.svelte`) taking `options` and two-way `bind:value`, styled to match the existing Workflow/Status/Project/Vendor filter dropdowns.

## Modified Files

### `src/app.css`
Added two new tag color variants alongside the existing `.tag-971` / `.tag-9584` / `.tag-warning` system:
- `.tag-season` — purple, for in-season items.
- `.tag-offseason` — muted gray, for offseason items.
- `.season-tag` — small margin/no-wrap utility for placement next to date text.

### `src/routes/manufacture/+page.svelte` (ToDo list)
- Added `filterSeason` state, defaulting to `getCurrentSeasonBucket().value` (e.g. `2026-offseason`).
- Added `seasonOptions` reactive derivation via `getAllSeasonBuckets(parts)`.
- Extended the `filteredParts` predicate with `passesSeasonFilter(part.created_at, filterSeason)`.
- Added `<SeasonFilter>` to the filters bar (grid widened from 4 to 5 columns).
- Added the season tag next to the "Created" value in both card view and table view.

### `src/routes/manufacture/completed/+page.svelte`
Same pattern as above: `filterSeason` state, `seasonOptions`, predicate extension, `<SeasonFilter>` added to the filters bar (grid widened from 2 to 3 columns), and the season tag added next to the "Completed" date in both the table row and the mobile card view. The tag is computed from `created_at` specifically (not the `updated_at` fallback used for the displayed date), since the tag represents when the item was *created*.

### `src/routes/cad/purchasing/+page.svelte`
Same pattern: `seasonFilter` state, `seasonOptions`, predicate extension inside the existing `filteredParts` filter function, `<SeasonFilter>` added to the filters bar, and the season tag added next to the Created date cell in the main (non-order-mode) table view.

### `src/routes/cad/build/+page.svelte` (Build Center)
This page is a drag-and-drop Kanban board (builds grouped into project containers, draggable between groups), not a flat filterable table like the other three, so the integration differs slightly:
- Added `filterSeason` state (defaults to the current bucket) and `seasonOptions` via `getAllSeasonBuckets(builds)`.
- Added a `<SeasonFilter>` dropdown in its own filter card above the "All Builds" board.
- The per-project `projectBuilds` array (used both for rendering build cards and for the project header's build-count/parts-count/cost totals) is now derived as `groupedBuilds[pid].filter(b => passesSeasonFilter(b.created_at, filterSeason))` — filtering happens at render time only, so the underlying `groupedBuilds`/drag-and-drop state (`onDragStart`, `dropOnBuild`, `dropOnProject`) is untouched and still operates on full data. Project header totals (build count, parts count, total cost) update to reflect only the visible/filtered builds, matching how filters behave elsewhere in the app. The top-level stat cards (Total/Pending/Manufacturing/Ready/Assembled) intentionally stay unfiltered, same as before.
- Added the season tag next to each build card's "Created {date}" line.
- Note: a project group with builds that all fall outside the selected season still renders as an empty container ("0 builds") rather than disappearing — left this way deliberately so the drag-and-drop drop targets for that project remain available.

## No Database Changes
Everything is derived client-side from the existing `created_at` column already present on both the `parts` and `purchasing` tables — no migration was needed.

## Verification Performed
- Ran the dev server locally (`npm run dev`) and confirmed all four routes (`/manufacture`, `/manufacture/completed`, `/cad/purchasing`, `/cad/build`) compile with no new Svelte errors/warnings.
- Validated the date-boundary logic with a standalone script mirroring `frcSeason.js`:
  - Today (Aug 11, 2026) → `2026 Offseason` ✓ (matches expected real-world state)
  - Kickoff (Jan 10, 2026) → `2026 Season` ✓
  - Championship (May 2, 2026) → `2026 Season` ✓
  - May 15/16 Pacific-time boundary splits correctly ✓
  - `getAllSeasonBuckets` correctly grows from the oldest data year through the current bucket, newest-first ✓
- Full interactive/visual verification (the actual dropdown + tags rendering in-browser) was left to the user, since the app is entirely gated behind a live Supabase session check with no server-rendered content and no test credentials available in this environment.

## Scope Notes

### Included
Manufacturing ToDo, Manufacturing Completed, Purchasing, and CAD Build Center — all four are browsable, standing lists/boards of dated records a user returns to over time.

### Surveyed and deliberately excluded (round 2: CAD + rest of the app)
- `/manufacture/router`, `/manufacture/kitting`, `/manufacture/bins`, `/manufacture/post-processing`, `/manufacture/autocam`, `/manufacture/portal`, top-level `/kitting` — active work-queue views (current in-progress jobs / pending-only queues). None display `created_at` to the user or have an existing filter bar; tagging a queue that's cleared out day-to-day isn't useful.
- `/cad` (CAD Subsystems hub) and `/cad/bom` (per-build BOM editor) — a subsystem dashboard and a single-build detail/edit form respectively, not lists of dated records to filter.
- `/cots-stocking` — a live inventory-quantity snapshot (current stock levels/locations), no created-date dimension shown to users.
- `/discover` — a people/role directory, not date-based.
- `/tasks`, `/planner` — project-management tools scoped to current/upcoming work, not a season-spanning archive.
- Scouting suite (`/datascout`, `/pitscout`, `/notescout`, `/teamview`, `/scouting-admin`) — already scoped to a specific competition **event** (itself tied to a season), a more precise existing mechanism; a generic season/offseason tag would be redundant there.
- `/admin` — its Purchasing analytics sub-tab already has its own bespoke time-period filter (7/30/90/365 days + custom range, see `PURCHASING_ADMIN_README.md`); didn't layer a second, different date filter on top of it.

The logic in `frcSeason.js` and `SeasonFilter.svelte` is centralized and reusable, so any of the above can get the same treatment later if it turns out to be useful.

## Deployment
- Manufacturing/Purchasing portion: committed on `main` (commit `0187b23`) and pushed to both remotes this repo tracks (`origin` → wjojarth23/971app, `stormcoded` → stormcoded/971APP).
- CAD Build Center portion: implemented and running locally; not yet committed/pushed pending review.
