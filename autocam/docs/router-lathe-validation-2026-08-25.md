# AutoCAM production-grade validation (2026-08-25)

Follow-up to `router-lathe-validation-2026-08-20.md`, extended to cover **all 13** real STEP
fixtures in `autocam/__fixtures__/` (the prior pass covered 5 + the sprocket rejection). Same
method: every fixture run through the exact generator functions the live app calls
(`extractRoutingContoursFromMeshes`/`extractTurningProfileFromMeshes` +
`generateRoutingGcode`/`generateTurningGcode`), full G-code captured and reviewed, findings
re-verified against real source and real fixture geometry before deciding what to fix.

Full raw G-code for all 13 runs (not just excerpts) was written to a one-off report for this
pass; ask if you want it regenerated - not committed here since it's a ~400KB raw dump, not
narrative documentation.

## Result

11 of 13 fixtures produce clean G-code (no NaN/undefined tokens, sane bounding boxes matching
part dimensions, valid program-end markers, plausible feed rates). 2 are *correctly rejected*
rather than silently producing wrong output - one by a pre-existing check (`sprocket-32t.step`),
one by a new fix from this pass (`mounting-bracket-bent.step`).

| Fixture | Kind | Result |
|---|---|---|
| hex-shaft.step | turning | OK - 609 moves, 1 roughing pass |
| vortex-shaft.step | turning | OK - 1217 moves, 3 roughing passes |
| hex-adapter.step | turning | OK - 2129 moves, 6 roughing passes |
| lead-screw.step | turning | OK - 913 moves, 2 roughing passes |
| set-screw-hub.step | turning | OK - 609 moves, 1 roughing pass |
| v-belt-pulley.step | turning | OK - 609 moves, 1 roughing pass |
| flat-plate.step | routing | OK - 1 contour, 1 tool |
| toughbox-motor-plate.step | routing | OK - 19 contours, 4 tools |
| multibody-bracket.step | routing | OK - 14 contours, 3 tools |
| maxspline-bracket.step | routing | OK - 14 contours, 2 tools |
| mounting-bracket-flat.step | routing | OK - 15 contours, 4 tools |
| mounting-bracket-bent.step | routing | **Rejected (new fix, see below)** |
| sprocket-32t.step | routing | Rejected (pre-existing silhouette-overrun check) |

## The real bug found and fixed

`mounting-bracket-bent.step` (REV-41-1623, already bent/formed sheet metal - not a flat pattern)
used to measure "thickness" as **0.591"**: the full height of a bent-up wall, not the actual
~0.118" sheet gauge. Confirmed against its unbent sibling `mounting-bracket-flat.step`, which
reads 0.118" for the same part before forming - a near-exact match once the wall's contribution
is excluded. Fed into `generateRoutingGcode`, the old value would have commanded a router to cut
roughly **5x deeper than the real material** - very likely plunging through the stock into the
spoilboard or fixture.

Root cause: `extractRoutingContoursFromMeshes`'s thickness measurement (`autocam/stepProfile.js`)
scanned every vertex of the winning face's own mesh body for the min/max distance along the face
normal, on the assumption that the far extreme is always a genuine, parallel "bottom" face. For a
part that's already bent, a perpendicular wall's own vertices can reach further along that normal
than the real bottom face does, with nothing geometrically "opposite" backing that reading.

Fix: before trusting a measured thickness, the code now looks for a real B-rep face - not just any
vertex - sitting near the far extreme, roughly **anti-parallel** to the traced face (a genuine
opposite/bottom face, not a perpendicular wall). If none is found, the part is rejected with a
clear message instead of silently generating a wrong-depth program.

### How the fix's own findings held up under a second pass

The first version of this check used raw vertex population (what fraction of vertices sit away
from the two extremes) rather than real B-rep face structure. That version **false-positived on
every multi-hole plate on hand**, including `flat-plate.step` and `multibody-bracket.step`: a
genuinely flat part's own hole walls and outer perimeter are thin strips that, by construction,
span the *entire* depth range too, and enough small holes tessellate into enough vertices to
trip a population-based threshold just as easily as a real bent wall does. Re-verified with a
second synthetic test (empirical histogram of vertex depths, per-fixture) before concluding
vertex population wasn't a reliable signal on its own, and moving to real per-face area + normal
orientation instead - which cleanly separates all 13 fixtures with no false positives.

New regression test in `autocam/stepProfile.test.js` asserts `mounting-bracket-bent.step` throws
with this message; the existing synthetic multi-mesh thickness test also needed its mocked
"bottom face" turned into a real declared B-rep face (it previously only had loose vertices in
the raw position array, which the new check correctly no longer accepts as a face).

## Test-coverage gaps closed

`hex-shaft.step` and `flat-plate.step` are the app's primary/simplest example fixtures for
turning and routing respectively, but neither had ever actually been run through
`generateTurningGcode`/`generateRoutingGcode` in a test before this pass - only geometry
extraction was covered. Both now have a real end-to-end generation test, matching the pattern
already used for the other 11 fixtures.

## An external G-code critique that didn't hold up

A separate review of `hex-shaft.ngc` and `flat-plate.ngc` claimed several "critical" errors.
Checked each against the actual source and generated output - none were real:

- **"11:1 cantilever executed with no warning/tailstock"** - the file already contains an
  explicit warning block for exactly this, and `turning.js` documents it as deliberate: an 8:1
  L:D ratio triggers a non-blocking warning (not an automatic mode change) so the operator can
  choose `setupMode: 'tailstock'` or `'flip'` - both already implemented and tested. The specific
  test run just didn't pass a safer `setupMode`.
- **"Rapid entry directly into workpiece material"** - misreads standard diameter-programmed
  lathe roughing: the rapid to a pass's target diameter happens while still at `Z0.1` (clear of
  the stock's face), not inside material.
- **"Missing T01 M06 / G43 H01 tool length offset"** - assumes a machining center with an
  automatic tool changer. This targets a manually-tooled CNC router (matching this app's
  `linuxcnc`/`wincnc` controller dialects, no ATC). `routing.js` already pauses on every real
  tool change (`M00`, or a WinCNC-compatible `G4` dwell) with an explicit re-touch-off prompt -
  arguably safer than trusting a stored offset table.
- **"Faulty ramping / vertical gouging"** - misreads intentional tab-bridge logic: cut depth is
  clamped to `targetDepth - tabHeight` at tab zones so the part stays attached to stock. The
  observed `Z-0.25 -> Z-0.19 -> Z-0.25` is exactly `0.25 - 0.06`, matching the default
  `tabHeight` precisely.
- **"Incomplete final retract, should use G28/G53"** - the ending retract uses the same safe-Z
  value as every other rapid traverse in the program, including the first move; not weaker at
  the end than anywhere else. A machine-absolute G28/G53 retract wasn't added since correctly
  doing so needs confirming exact dialect support on the real WinCNC/LinuxCNC targets, which
  can't be verified in this environment - unverified new G-code risks a real new bug in the name
  of fixing an imagined one.

Every generated file already carries its own header warning: **"NOT VERIFIED ON REAL HARDWARE OR
A SIMULATOR. Run this through a G-code simulator ... and do a supervised air-cut before running
on material."**
