# AutoCAM production-grade validation (2026-08-20)

End-to-end validation run against 5 real parts (3 router, 2 lathe) pulled from
`autocam/__fixtures__/` - the same real STEP files already used as regression
fixtures in `stepProfile.test.js`, `routing.test.js`, and `turning.test.js`.
Each part was run through the exact generator functions the live app calls
(`extractRoutingContoursFromMeshes`/`extractTurningProfileFromMeshes` +
`generateRoutingGcode`/`generateTurningGcode`), producing full G-code files,
not just the abbreviated first-15-lines the interactive CLI tool
(`autocam/scripts/test-cam-extraction.mjs`) prints.

An independent review of every line of all 5 outputs was done first, then
every finding was personally re-verified against the real source code and
real fixture geometry (precise numeric simulation, not just re-reading
G-code by eye) before deciding what to fix - two findings turned out to need
correction during that process (see "How the review findings held up"
below).

## Parts tested

| Part | Operation | Notable geometry |
|---|---|---|
| `toughbox-motor-plate.step` | Routing, multi-tool | Classic multi-hole gearbox motor plate - 19 contours, hole diameters from 0.622" down to ~0.13" |
| `mounting-bracket-flat.step` | Routing, multi-tool | Genuinely complex multi-hole bracket - 15 contours |
| `maxspline-bracket.step` | Routing, single-tool | Bracket with a real 175-point internal spline bore (non-circular, tight tolerances) |
| `vortex-shaft.step` | Turning | Real stepped motor shaft with a cross-drilled retention-pin hole |
| `lead-screw.step` | Turning | Real long, thin, stepped shaft |

(A 6th part, `sprocket-32t.step`, was tried first for routing and correctly
**rejected** by the existing silhouette-overrun safety check - its teeth are
non-planar surfaces a 2.5D router profile can't represent. That's intended,
already-tested behavior, not a bug, so it's noted here rather than counted
as one of the 5.)

## Results

**2 real bugs found and fixed, 1 gap closed with an automatic warning.** All
three live in the code, not in these specific test parts - they'll recur on
any real part with similar geometry. See the commit history / PR #22 on
`spartanshub` for the actual diffs; this doc is the validation record, not
the fix documentation (that lives in `routing.js`/`turning.js`'s own comments
next to each fix).

### 1. Tab zones could be silently dropped entirely (routing.js)

`emitContourPass` decided whether a cutting move was inside a tab zone by
checking whether the **segment's own midpoint** fell inside that zone. On a
segment much longer than the zone itself - exactly the case for a large,
simple plate with long straight edges - the zone can be fully contained
inside the segment without ever containing that segment's specific
midpoint, so the tab silently never gets cut.

Confirmed with a precise simulation of the real algorithm against real
fixture geometry (not just eyeballing G-code):

| Part | Zones expected | Zones that actually rendered (before fix) |
|---|---|---|
| `toughbox-motor-plate.step` | 3 | 1 (zones at ~6.8" and ~13.8" around the perimeter missing) |
| `mounting-bracket-flat.step` | 1 | 1 (happened to work - short first segment) |
| `maxspline-bracket.step` | 2 | 1 (zone at the path seam missing) |

**Real-world consequence**: the `toughbox-motor-plate` case means a 20"+
plate would have been held down by tab material in only one small corner
after its final cut - a genuine risk of the part shifting or coming loose
mid-operation.

**Fix**: `emitContourPass` now splits each segment at every overlapping tab
zone's boundaries before emitting G01 moves, so a sub-move's own midpoint is
always fully inside or fully outside a zone - the same check is correct
again once the segment is actually subdivided at the right places. Verified
against the real fixtures after the fix: all 3/1/2 expected zones now
produce an actual depth clamp at 3 physically distinct XY locations (spot-
checked directly in the regenerated G-code, not just via the stats count).

### 2. Degenerate near-zero-radius "helical" entry (routing.js)

A circular hole only marginally bigger than its assigned tool produces a
toolpath radius of a few thousandths of an inch. `emitHelicalCircularContour`'s
turn-count formula (`turns = ceil(zDrop / (radius * MAX_RAMP_SLOPE))`) then
explodes without bound as radius shrinks - a real case on
`toughbox-motor-plate.step` (a ~0.264"-diameter hole cut with a 0.25" tool,
leaving 0.007" of toolpath radius) needed **167 turns** to drop just 0.1" of
Z, with the tool moving essentially nowhere in XY the whole time.

It's technically a G02/G03 command, not a G01 plunge, but at that radius the
tool is at close to full radial engagement, spinning nearly stationary -
functionally the same loaded-plunge risk the "ENTRY SAFETY" design principle
in `routing.js`'s header exists to prevent, just wearing an arc-command
costume.

**Fix**: added `MIN_HELIX_RADIUS_FRACTION` (15% of tool radius) - a circular
hole that doesn't leave that much toolpath clearance now throws the same
kind of actionable error `offsetPolygon` already uses for "this tool doesn't
fit at all" ("use a smaller tool for this hole"), and multi-tool sequences
now automatically fall through to a smaller tool instead of erroring, since
that's exactly the scenario they exist for. Verified: with a properly broad
tool sequence (`[0.25", 0.1875", 0.125", 0.0625"]`), `toughbox-motor-plate`
and `mounting-bracket-flat` both now generate cleanly, correctly using the
smaller tools only where the primary bit doesn't leave safe clearance.

### 3. No warning for an unsupported long/thin turning setup (turning.js)

`lead-screw.step` is a real ~15"-long shaft that necks down to ~0.31"
diameter - an unsupported (cantilevered-from-the-chuck) length-to-diameter
ratio of **47.9:1**. `setupMode` defaults to `'single'` (no tailstock, no
split setup) with no automatic check of whether that's actually safe for the
part's real proportions - `'tailstock'` mode exists specifically for this
case, but nothing suggests or requires it based on geometry. The generator
happily produced a full cantilevered program with zero warning.

**Fix**: added an automatic warning (not a hard block - the operator may
have a deliberate, informed reason) above an 8:1 length-to-diameter ratio
(checked against the part's smallest working diameter, its most vulnerable
point, not its average), firing whenever `setupMode` is `'single'` (the
default). Mirrors the wording/prominence of `'tailstock'` mode's own
existing note. Verified against the real fixture: fires correctly, reporting
"14.967" long and necks down to 0.312" diameter... ratio of 47.9:1."

### Everything else: correct, by design

- **Cut order** (holes before outer profile) was correct on every router
  part checked.
- **Ramped/helical entry** (no straight plunges) held on every non-degenerate
  case.
- **Nose-radius compensation** on both lathe parts consistently offset every
  finishing-pass diameter by the programmed nose radius.
- **Multi-tool tool changes** only fired where the tool plan said they
  should, always preceded by a retract + spindle-off.
- Always retracting to safe-Z between contours (rather than a more
  cycle-time-optimized "only retract if a straight link would cross
  material," the way PenguinCAM does it) is a deliberate conservative
  choice, not a bug - flagged as a legitimate future efficiency opportunity,
  not something fixed here.

## How the review findings held up under independent re-verification

Per instruction, the independent review agent's findings were not accepted
at face value - each one was re-derived from the real source/geometry
directly:

- The tab-zone finding was **confirmed exactly** via a from-scratch numeric
  simulation of the real zone-overlap math against the real fixture
  contours (see table above) - the agent's counts matched.
- A first attempt at manually re-reading the raw `toughbox-motor-plate.ngc`
  G-code by eye produced a **wrong** conclusion (mistook a real tab-depth
  clamp for a ramp-interpolation transient, because both can produce a
  Z value between the previous and target depth). The precise simulation
  caught and corrected this - a useful reminder that even "verify it
  yourself" needs a rigorous method, not just a second glance.
- The degenerate-helix finding was independently confirmed and precisely
  quantified (167 turns for a single 0.1" pass, computed directly from
  `emitHelicalCircularContour`'s actual formula) - more severe than needed
  to just take the agent's word for it, but the underlying claim held.
- The lead-screw length-to-diameter finding was confirmed and the real
  ratio recomputed directly from the fixture's actual profile data
  (47.9:1, matching the agent's estimate of "~25:1 or worse").

## Verification

- Full vitest suite: 402/402 passing (17 new/updated tests covering all
  three fixes, plus one pre-existing real-fixture test whose tool sequence
  needed a genuinely small-enough tool added now that the helical-clearance
  check correctly rejects what it used to silently accept).
- `svelte-check`: 0 errors.
- Production build (`npm run build`, adapter-node): succeeds.
- All 5 real parts regenerate successfully end-to-end after the fixes.

## Not done in this pass (flagged, not fixed)

- **Cut-order/travel optimization** (nearest-neighbor ordering between
  same-tool contours, or PenguinCAM-style "only retract if the straight
  link isn't safe") - a real cycle-time efficiency opportunity, observed on
  `toughbox-motor-plate` (holes cut in extraction order, not travel-optimized
  order), but not a safety issue and out of scope for this pass.
- **Robustness of the hand-rolled polygon offset** on very tight concave
  routing profiles - a pre-existing, already-documented limitation in
  `routing.js`'s own header, not something this validation pass newly found
  or attempted to fix.
