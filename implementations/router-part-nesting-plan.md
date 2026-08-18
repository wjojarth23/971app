# Nesting multiple router parts onto one sheet — implementation plan (not built)

## Why this is a genuinely different problem than what exists today

Every router job in this app, from `extractRoutingContoursFromMeshes` (`src/lib/cam/stepProfile.js:326`) through `generateRoutingGcode` (`src/lib/cam/routing.js`), assumes **one STEP file → one part → one program**. The extractor finds the single largest flat face on one mesh and traces its outline; there is no concept of "here are N separate parts, find where they all fit on a shared sheet of stock." Nesting needs:
1. A **2D bin-packing / nesting algorithm** - genuinely different math than anything in this file (offset-polygon and step-down passes don't help here at all).
2. A way to run generation **across several parts' worth of geometry at once**, when today's whole pipeline (`cam_jobs` → one `step_file_name` → one result) is built around exactly one file per job.
3. A **UI concept of a "sheet"/"batch nesting job"** that doesn't exist anywhere in `/autocam` today - the closest existing thing is this session's new **batch job creation** (queue N *separate* jobs from N parts, each producing its own independent program) - nesting is a different, harder ask: **one combined program**, sharing one sheet of stock, with parts positioned relative to each other.

## The nesting algorithm itself

Real 2D nesting (irregular-polygon bin packing) is a hard problem - production nesting software (SigmaNEST, DXF-based CAM nesting tools) uses genetic algorithms / no-fit-polygon techniques refined over years. Building a good one from scratch is out of scope here. Realistic options, in order of effort:

1. **Rectangular bounding-box packing only** (simplest, buildable without a new dependency): treat each part's bounding box as the unit to pack, using a straightforward shelf/guillotine packing algorithm (sort by height, pack left-to-right in rows, wrap to a new row when a part doesn't fit). Wastes material on non-rectangular parts (a round or L-shaped part still reserves its full bounding rectangle) but is honest, predictable, and easy to verify by eye before cutting - consistent with this project's whole approach to CAM math (`routing.js`'s hand-rolled polygon offset over a real clipping library, same tradeoff of "simpler and inspectable" over "optimal").
2. **True irregular nesting** (no-fit-polygon or similar): dramatically better material usage, but this is its own multi-week project, likely needs either a real geometry library (Clipper2 or similar polygon-boolean library - this repo has avoided npm dependencies so far only because of past network-install issues, worth re-checking whether `npm install` actually works in this environment before ruling it out) or a hand-rolled NFP implementation, which is a serious undertaking to get right and to trust with real material.

**Recommendation: start with option 1.** It's honest about being suboptimal (some wasted stock on non-rectangular parts) rather than silently wrong, and it's actually buildable and testable in the time this kind of feature usually gets. Revisit option 2 only if wasted material actually becomes a real cost problem in practice.

## Data model

- New concept: a **nesting job**, distinct from a regular `cam_jobs` row - either:
  (a) a new `cam_nesting_jobs` table (`id, machine_id, sheet_width, sheet_height, spacing, status, gcode, ...`) with a child table `cam_nesting_job_parts (nesting_job_id, part_id or step_file_name, quantity, rotation_allowed boolean)`, or
  (b) reuse `cam_jobs` with a new `source_type = 'nested'` and a `params.parts = [...]` array referencing multiple STEP files.
  (a) is cleaner - a nesting job's output is fundamentally "one program for N parts," which doesn't fit `cam_jobs`'s existing one-`step_file_name`-in, one-program-out shape without stretching it. Extending `cam_jobs` risks confusing the (already-batch-job-capable) single-part flow with this different one.
- `sheet_width`/`sheet_height`: the stock sheet's usable cutting area (not raw material size - needs a margin, likely from the same "safe boundary" thinking `offsetPolygon`'s throat-distance check already does for a single part).
- `spacing`: minimum gap kept between nested parts (real value - needs a kerf/tool-diameter-aware minimum, not just a cosmetic margin, or two parts could nest close enough that cutting one damages its neighbor).

## Generation pipeline changes

1. Extract each part's contours individually (reuse `extractRoutingContoursFromMeshes` per STEP file, unchanged - it's already correct for a single part, nesting doesn't change single-part extraction).
2. Run the packing algorithm on the set of parts' bounding boxes (or full polygons, for option 2) to get each part's placement `{offsetX, offsetY, rotation}` on the shared sheet.
3. Translate (and, if rotation is supported, rotate) each part's contour points by its placement before handing the combined contour list to `generateRoutingGcode` - this is the one part of `routing.js` that's actually reusable as-is: it already accepts an array of `{points, isHole}` contours and doesn't care whether they all came from one STEP file or were assembled from several, as long as coordinates are already in one shared sheet-space by the time they arrive. **No changes needed inside `routing.js` itself** for the single-tool case - nesting is entirely a pre-processing step that produces its input.
4. Tool-change / multi-tool sequencing (already built this session) composes fine on top - a nested sheet with mixed part sizes could still reasonably use a multi-tool sequence across the whole sheet.

## UI

- A new "Nest Parts" flow (separate from both the single New Job and the new Batch mode) - part multi-select (reuse this session's batch-mode checkbox picker), sheet size input, spacing input, a packing **preview** (2D layout of where each part lands - this needs a real preview, not just trusting the numbers, given the physical stakes of a program that positions material relative to itself) before ever generating G-code.
- `ToolpathViewer.svelte` already renders a 2D toolpath - reusable as-is for previewing the packed layout, since a nested program's toolpath IS the layout preview once generated; worth checking whether a pre-generation preview (from the packer's raw placement output, before G-code exists) is worth building separately, or whether "generate, then look at the toolpath viewer before running" is enough given the same "verify in a simulator before cutting" discipline this app already leans on everywhere else.

## Real open questions

1. **Is bounding-box packing (option 1) actually good enough**, or does the team cut small/oddly-shaped parts often enough that wasted stock from box-packing would be a real cost? Worth a genuine gut-check before picking option 1 vs. 2 - this changes the whole scope of the project.
2. **Sheet size(s)** - is stock always one fixed size (e.g. a standard 4'x8' sheet, or whatever offcuts happen to be on hand)? Fixed-size sheets are much easier to build for than "arbitrary offcut, entered per job."
3. **Is part rotation allowed** in nesting (can a part be rotated 90°/arbitrary angle to pack tighter), or must every part keep its modeled orientation (e.g. grain direction matters for wood, or a labeled/etched face must stay a specific way)? This materially changes both the packing algorithm's complexity and the UI.
4. **Kerf/spacing minimum** - what's a real, safe minimum gap between two nested parts for this router's actual bit sizes, so cutting one part's contour can't touch/damage its neighbor?

## Phased implementation order

1. Confirm open questions above with whoever runs the router - especially #1, since it decides the entire algorithm approach.
2. Data model: `cam_nesting_jobs` + child table, migration.
3. Bounding-box packing algorithm (`src/lib/cam/nesting.js`, pure geometry, unit-testable the same way `routing.js`/`turning.js` already are - synthetic part shapes, assert on packed positions/no-overlap).
4. Wire packed placements into `generateRoutingGcode`'s existing contour-array input - no changes to `routing.js` itself needed per the analysis above.
5. UI: Nest Parts flow, layout preview, generation + review via the existing `ToolpathViewer`.
6. Real verification: nest a handful of real test parts, eyeball the packed layout and the resulting toolpath in a simulator, confirm no part's contour overlaps another's before ever trusting this on real stock.
