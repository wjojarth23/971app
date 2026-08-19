import { describe, it, expect } from 'vitest';
import { generateRoutingGcode, offsetPolygon } from './routing.js';

function square(cx, cy, size) {
  const h = size / 2;
  return [{ x: cx - h, y: cy - h }, { x: cx + h, y: cy - h }, { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h }, { x: cx - h, y: cy - h }];
}

// A many-sided polygon approximating a circle - exactly what stepProfile.js
// actually hands this generator for a real round hole/boss (a STEP mesh's
// triangulated boundary, not a true parametric circle) - see fitCircle.
function circle(cx, cy, r, segments = 64) {
  const pts = [];
  for (let i = 0; i <= segments; i += 1) {
    const a = (i / segments) * 2 * Math.PI;
    pts.push({ x: cx + r * Math.cos(a), y: cy + r * Math.sin(a) });
  }
  return pts;
}

// 4"x4" outer square, a 1" hole (fits a 1/4" bit fine), and a 0.15" hole
// (too small for a 1/4" bit's 0.125" radius against its ~0.075" throat -
// only reachable with the 1/8" bit).
function partWithHoles() {
  return [
    { points: square(0, 0, 4), isHole: false },
    { points: square(1, 1, 1), isHole: true },
    { points: square(-1, -1, 0.15), isHole: true }
  ];
}

describe('offsetPolygon', () => {
  it('grows a CCW square outward for a positive distance', () => {
    const sq = square(0, 0, 2); // -1..1
    const grown = offsetPolygon(sq, 0.5);
    const xs = grown.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(1.5, 3);
    expect(Math.min(...xs)).toBeCloseTo(-1.5, 3);
  });

  it('shrinks inward for a negative distance', () => {
    const sq = square(0, 0, 2);
    const shrunk = offsetPolygon(sq, -0.5);
    const xs = shrunk.map((p) => p.x);
    expect(Math.max(...xs)).toBeCloseTo(0.5, 3);
  });

  it('throws when the offset would collapse a too-small feature', () => {
    const tinyHole = square(0, 0, 0.1);
    expect(() => offsetPolygon(tinyHole, -0.125)).toThrow(/too small for this tool/);
  });

  it('throws for a degenerate polygon (< 3 vertices)', () => {
    expect(() => offsetPolygon([{ x: 0, y: 0 }, { x: 1, y: 1 }], 0.1)).toThrow(/at least 3 vertices/);
  });

  describe('over-offset detection (real bug: naive edge-offset-and-intersect does not fail gracefully past the collapse point, it can invert through the shape instead of shrinking to nothing - found against a real STEP file, not a hypothetical)', () => {
    it('a moderately-oversized offset (< 2x the collapse point) that still LOOKS like a valid smaller square must still be rejected', () => {
      // 0.15" square, offsetting inward by 0.125" (way past the 0.075"
      // half-width) - the naive miter math for this specific ratio produces
      // a smaller-but-real-looking square in the WRONG place (corners
      // swapped to their diagonal opposite) rather than an obviously
      // degenerate/negative-area result - the case that broke two earlier,
      // weaker versions of this check (plain area/winding sign, and
      // checking each point against only its own two source edges).
      const hole = square(-1, -1, 0.15);
      expect(() => offsetPolygon(hole, -0.125)).toThrow(/too small for this tool/);
    });

    it('a tool that genuinely fits (well under the real collapse point) still succeeds', () => {
      const hole = square(-1, -1, 0.15);
      const offset = offsetPolygon(hole, -0.0625);
      const xs = offset.map((p) => p.x);
      expect(Math.max(...xs) - Math.min(...xs)).toBeCloseTo(0.025, 3); // 0.15 - 2*0.0625
    });

    it('every offset edge points the same rotational direction as the original - the real invariant this check verifies', () => {
      const sq = square(0, 0, 2);
      const shrunk = offsetPolygon(sq, -0.5);
      for (let i = 0; i < shrunk.length - 1; i += 1) {
        const origDir = { x: sq[(i + 1) % (sq.length - 1)].x - sq[i].x, y: sq[(i + 1) % (sq.length - 1)].y - sq[i].y };
        const newDir = { x: shrunk[i + 1].x - shrunk[i].x, y: shrunk[i + 1].y - shrunk[i].y };
        expect(origDir.x * newDir.x + origDir.y * newDir.y).toBeGreaterThan(0);
      }
    });
  });
});

describe('generateRoutingGcode - single-tool (default)', () => {
  const contour = [{ points: square(0, 0, 4), isHole: false }];

  it('generates valid G-code with header/footer', () => {
    const result = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25 });
    expect(result.gcode).toContain('G17 (XY plane)');
    expect(result.gcode).toContain('M30 (program end)');
    expect(result.gcode).toContain('OUTER CONTOUR');
    expect(result.stats.toolChanges).toBe(0);
  });

  it('throws without contours', () => {
    expect(() => generateRoutingGcode([], { toolDiameter: 0.25, targetDepth: 0.25 })).toThrow(/at least one closed contour/);
  });

  it('throws without targetDepth', () => {
    expect(() => generateRoutingGcode(contour, { toolDiameter: 0.25 })).toThrow(/targetDepth is required/);
  });

  it('throws without toolDiameter in single-tool mode', () => {
    expect(() => generateRoutingGcode(contour, { targetDepth: 0.25 })).toThrow(/toolDiameter is required/);
  });

  it('generates tab zones when tabSpacing > 0, none when tabSpacing = 0', () => {
    const withTabs = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25, tabSpacing: 6 });
    const noTabs = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25, tabSpacing: 0 });
    expect(withTabs.stats.tabZones).toBeGreaterThan(0);
    expect(noTabs.stats.tabZones).toBe(0);
  });
});

describe('generateRoutingGcode - multi-tool (router only, see implementations/toolchange-gcode-plan.md)', () => {
  const toolSequence = [
    { toolDiameter: 0.25, toolNumber: 1, label: '1/4in roughing bit' },
    { toolDiameter: 0.125, toolNumber: 2, label: '1/8in detail bit' }
  ];

  it('assigns the outer contour and the reachable hole to tool 1, the tiny hole to tool 2', () => {
    const result = generateRoutingGcode(partWithHoles(), { targetDepth: 0.25, toolSequence });
    expect(result.stats.toolsUsed).toBe(2);
    expect(result.stats.toolChanges).toBe(1);
    expect(result.gcode).toContain('TOOL PLAN');
    expect(result.gcode).toContain('TOOL CHANGE: load 1/8in detail bit');
  });

  it('every cutting move actually appears (regression: targetDepth must propagate into each tool step)', () => {
    const result = generateRoutingGcode(partWithHoles(), { targetDepth: 0.25, toolSequence });
    const cutMoves = result.gcode.split('\n').filter((l) => l.startsWith('G01 X') && l.includes(' Z-0.2500'));
    expect(cutMoves.length).toBeGreaterThan(0); // this was a real bug once - zero full-depth moves when targetDepth didn't reach the per-tool body
  });

  it('skips a tool entirely (no tool-change block) if nothing needs it', () => {
    const noSmallHoles = [{ points: square(0, 0, 4), isHole: false }, { points: square(1, 1, 1), isHole: true }];
    const result = generateRoutingGcode(noSmallHoles, { targetDepth: 0.25, toolSequence });
    expect(result.stats.toolsUsed).toBe(1);
    expect(result.stats.toolChanges).toBe(0);
    expect(result.gcode).not.toContain('TOOL CHANGE:');
  });

  it('throws if no tool in the sequence can reach a hole', () => {
    const bigToolsOnly = [{ toolDiameter: 0.5, toolNumber: 1, label: '1/2in bit' }];
    expect(() => generateRoutingGcode(partWithHoles(), { targetDepth: 0.25, toolSequence: bigToolsOnly })).toThrow(/No tool in the sequence/);
  });

  it('falls back to single-tool mode when toolSequence is empty', () => {
    const result = generateRoutingGcode([{ points: square(0, 0, 4), isHole: false }], { toolDiameter: 0.25, targetDepth: 0.25, toolSequence: [] });
    expect(result.stats.toolChanges).toBe(0);
    expect(result.gcode).not.toContain('TOOL PLAN');
  });
});

describe('generateRoutingGcode - controller dialect (default linuxcnc vs wincnc for the ShopSabre Pro 408)', () => {
  const contour = [{ points: square(0, 0, 4), isHole: false }];

  it('defaults to linuxcnc and stays byte-identical whether or not controller is passed explicitly', () => {
    const implicit = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25 });
    const explicit = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25, controller: 'linuxcnc' });
    expect(implicit.gcode).toBe(explicit.gcode);
    expect(implicit.gcode).toContain('(');
    expect(implicit.gcode).not.toContain('[');
  });

  it('wincnc dialect uses square-bracket comments throughout, never round parens', () => {
    const result = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25, controller: 'wincnc' });
    expect(result.gcode).not.toContain('(');
    expect(result.gcode).not.toContain(')');
    expect(result.gcode).toContain('[inch]');
  });

  it('wincnc dialect omits G17, uses G22 (not G21) for metric, and drops the LinuxCNC G54 line', () => {
    const inch = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25, controller: 'wincnc' });
    expect(inch.gcode).not.toContain('G17');
    // Explanatory comment text is allowed to mention "G54" descriptively
    // (it does, to tell the operator why there isn't one) - what actually
    // matters is that no line emits it as a live command.
    expect(inch.gcode).not.toMatch(/^G54\b/m);

    const metric = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25, controller: 'wincnc', units: 'mm' });
    expect(metric.gcode).toContain('G22');
    // G21 means centimeters on WinCNC - must never be emitted as a live
    // command for a mm job (the explanatory comment is allowed to mention
    // "G21" descriptively, same reasoning as the G54 check above).
    expect(metric.gcode).not.toMatch(/^G21\b/m);

    const linuxcncMetric = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25, units: 'mm' });
    expect(linuxcncMetric.gcode).toContain('G21');
  });

  it('wincnc dialect uses a bare G4 (not M00) for the tool-change pause, still keeps M03/M05', () => {
    const toolSequence = [
      { toolDiameter: 0.25, toolNumber: 1, label: '1/4in roughing bit' },
      { toolDiameter: 0.125, toolNumber: 2, label: '1/8in detail bit' }
    ];
    const result = generateRoutingGcode(partWithHoles(), { targetDepth: 0.25, toolSequence, controller: 'wincnc' });
    expect(result.gcode).not.toContain('M00');
    expect(result.gcode).toContain('G4 [TOOL CHANGE');
    expect(result.gcode).toContain('M03');
    expect(result.gcode).toContain('M05');
  });

  it('wincnc dialect omits M30, linuxcnc keeps it', () => {
    const wincnc = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25, controller: 'wincnc' });
    const linuxcnc = generateRoutingGcode(contour, { toolDiameter: 0.25, targetDepth: 0.25 });
    expect(wincnc.gcode).not.toContain('M30');
    expect(wincnc.gcode).toContain('[PROGRAM END]');
    expect(linuxcnc.gcode).toContain('M30 (program end)');
  });
});

describe('generateRoutingGcode - no duplicate final pass (real bug found in a live-generated file: floating-point drift when stepDown does not evenly divide targetDepth could leave depth a hair under target, running one redundant extra pass at the same printed depth)', () => {
  const outer = [{ points: square(0, 0, 4), isHole: false }];

  it('stepDown that does not evenly divide targetDepth still produces exactly one pass per depth level', () => {
    const result = generateRoutingGcode(outer, { toolDiameter: 0.25, stepDown: 0.0333333, targetDepth: 0.1 });
    const passDepths = result.gcode.split('\n').filter((l) => l.includes('-- pass at')).map((l) => l.match(/Z(-[\d.]+)/)[1]);
    expect(passDepths).toEqual(['-0.0333', '-0.0667', '-0.1000']);
  });

  it('same fix applies to the circular/helical path', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }, { points: circle(0, 0, 0.5), isHole: true }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.125, stepDown: 0.0333333, targetDepth: 0.1 });
    const passDepths = result.gcode.split('\n').filter((l) => l.includes('-- pass at')).map((l) => l.match(/Z(-[\d.]+)/)[1]);
    expect(passDepths).toEqual(['-0.0333', '-0.0667', '-0.1000', '-0.0333', '-0.0667', '-0.1000']);
  });

  it('classic 0.1+0.1+0.1 float drift (0.30000000000000004) still yields exactly 3 passes, not 4', () => {
    const result = generateRoutingGcode(outer, { toolDiameter: 0.25, stepDown: 0.1, targetDepth: 0.1 + 0.1 + 0.1 });
    const passDepths = result.gcode.split('\n').filter((l) => l.includes('-- pass at'));
    expect(passDepths).toHaveLength(3);
  });
});

describe('generateRoutingGcode - tabs never apply to holes (real bug: a small hole could spend most of its final pass at targetDepth-tabHeight instead of cutting through)', () => {
  it('a hole never gets a tab zone, even with tabSpacing/tabWidth set', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }, { points: square(1, 1, 0.6), isHole: true }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.125, targetDepth: 0.25, tabSpacing: 6, tabWidth: 0.25, tabHeight: 0.06 });
    const lines = result.gcode.split('\n');
    const holeStart = lines.findIndex((l) => l.includes('HOLE CONTOUR'));
    const holeEnd = lines.findIndex((l, idx) => idx > holeStart && l.includes('(retract)'));
    const holeLines = lines.slice(holeStart, holeEnd);
    // Final pass = targetDepth (0.25"). No line in the hole's section should
    // ever show the tab-clamped depth (targetDepth - tabHeight = 0.19") -
    // every point on a hole's final pass must reach full depth.
    expect(holeLines.some((l) => l.includes('Z-0.1900'))).toBe(false);
    expect(holeLines.some((l) => l.includes('Z-0.2500'))).toBe(true);
  });

  it('the outer contour still gets real tabs (regression: the fix must not disable tabs everywhere)', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.25, targetDepth: 0.25, tabSpacing: 6, tabWidth: 0.25, tabHeight: 0.06 });
    expect(result.stats.tabZones).toBeGreaterThan(0);
  });
});

describe('generateRoutingGcode - ramped entry, no more straight plunges into solid material', () => {
  it('the first cutting moves of a pass show gradually increasing depth, not an instant jump to full depth', () => {
    // targetDepth deliberately large relative to the square's own edge
    // length so the ramp distance (zDrop/MAX_RAMP_SLOPE) genuinely spans
    // more than one edge - otherwise, correctly, the ramp can finish
    // within a single (long) first edge, which is real, intended behavior
    // now that the ramp is measured at each segment's endpoint instead of
    // its midpoint (see emitContourPass) - not something to test around.
    const part = [{ points: square(0, 0, 4), isHole: false }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.25, stepDown: 2, targetDepth: 2, feedRate: 40, plungeRate: 15 });
    const lines = result.gcode.split('\n');
    const passStart = lines.findIndex((l) => l.includes('ramped entry'));
    const cutLines = lines.slice(passStart + 1).filter((l) => l.startsWith('G01 X')).slice(0, 4);
    const depths = cutLines.map((l) => Number(l.match(/Z(-[\d.]+)/)[1]));
    // Strictly increasing magnitude (getting deeper) across the first few
    // moves, and the very first one must NOT already be at full depth.
    expect(Math.abs(depths[0])).toBeLessThan(2);
    for (let i = 1; i < depths.length; i += 1) expect(Math.abs(depths[i])).toBeGreaterThanOrEqual(Math.abs(depths[i - 1]));
  });

  it('the ramp actually completes by the declared rampDistance, not later (real bug: using segment midpoint instead of endpoint under-ramped past the stated distance whenever a single segment was longer than the ramp)', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.25, stepDown: 0.1, targetDepth: 0.1, feedRate: 40, plungeRate: 15 });
    // rampDistance = min(perimeter*0.5, 0.1/0.15) = 0.1/0.15 =~ 0.67", well
    // under one edge of this ~17"-perimeter square - the very first G01
    // move (covering the whole first edge, ~4.25") must already show full
    // depth, since by its endpoint the ramp distance has long passed.
    const lines = result.gcode.split('\n');
    const passStart = lines.findIndex((l) => l.includes('ramped entry'));
    const firstCut = lines.slice(passStart + 1).find((l) => l.startsWith('G01 X'));
    expect(firstCut).toContain('Z-0.1000');
  });

  it('no more standalone "(plunge)" line - descent is folded into the ramp', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.25, targetDepth: 0.25 });
    expect(result.gcode).not.toContain('(plunge)');
  });

  it('ramp uses plungeRate, the flat remainder of the pass uses feedRate', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.25, stepDown: 0.05, targetDepth: 0.05, feedRate: 40, plungeRate: 7 });
    expect(result.gcode).toContain('F7.00000');
    expect(result.gcode).toContain('F40.00000');
  });

  it('approaches Z0 with a feed move, not a rapid - defense-in-depth in case Z0/stock height is slightly off', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.25, targetDepth: 0.25, plungeRate: 12 });
    const lines = result.gcode.split('\n');
    expect(lines).not.toContain('G00 Z0.0000 (rapid to material surface)');
    const clearanceIdx = lines.findIndex((l) => l.startsWith('G00 Z0.02'));
    expect(clearanceIdx).toBeGreaterThan(-1);
    expect(lines[clearanceIdx + 1]).toBe('G01 Z0.0000 F12.00000 (feed down to material surface - not a rapid, in case Z0/stock height is slightly off)');
  });

  it('same feed-down approach applies to the circular/helical path', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }, { points: circle(0, 0, 0.5), isHole: true }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.125, targetDepth: 0.25, plungeRate: 12 });
    const lines = result.gcode.split('\n');
    const holeStart = lines.findIndex((l) => l.includes('true circle'));
    expect(lines[holeStart + 3]).toBe('G01 Z0.0000 F12.00000 (feed down to material surface - not a rapid, in case Z0/stock height is slightly off)');
  });
});

describe('generateRoutingGcode - true arcs for circular features (real hole/boss geometry, not a polygon approximation)', () => {
  it('a circular hole is cut with G02/G03 helical entry, not G01 polygon segments', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }, { points: circle(0, 0, 0.5), isHole: true }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.125, targetDepth: 0.25 });
    const lines = result.gcode.split('\n');
    const holeStart = lines.findIndex((l) => l.includes('true circle'));
    expect(holeStart).toBeGreaterThan(-1);
    const holeEnd = lines.findIndex((l, idx) => idx > holeStart && l.includes('(retract)'));
    const holeLines = lines.slice(holeStart, holeEnd);
    expect(holeLines.some((l) => l.startsWith('G02') || l.startsWith('G03'))).toBe(true);
    // No G01 CUTTING (XY) moves - a real G01 Z-only move is expected here
    // (the feed-down-to-surface approach move, see APPROACH_CLEARANCE),
    // that's not a polygon segment, just a vertical feed.
    expect(holeLines.some((l) => l.startsWith('G01 X'))).toBe(false);
    expect(holeLines.some((l) => l.startsWith('G01 Z'))).toBe(true);
    expect(holeLines.some((l) => l.includes('I') && l.includes('J'))).toBe(true);
  });

  it('the helical entry ramps Z down over multiple turns before the cleanup circle at full depth', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }, { points: circle(0, 0, 0.5), isHole: true }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.125, stepDown: 0.5, targetDepth: 0.5 });
    const arcLines = result.gcode.split('\n').filter((l) => l.startsWith('G02') || l.startsWith('G03'));
    const depths = arcLines.map((l) => Math.abs(Number(l.match(/Z(-[\d.]+)/)[1])));
    expect(depths.length).toBeGreaterThanOrEqual(3); // at least MIN_HELIX_TURNS (2) + the cleanup circle
    expect(depths[0]).toBeLessThan(0.5); // first turn doesn't already reach full depth
    expect(depths[depths.length - 1]).toBeCloseTo(0.5, 4); // cleanup circle reaches exact target depth
  });

  it('a non-circular hole (square) still uses the ordinary G01 polygon path', () => {
    const part = [{ points: square(0, 0, 4), isHole: false }, { points: square(0, 0, 0.6), isHole: true }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.125, targetDepth: 0.25 });
    expect(result.gcode).not.toContain('true circle');
    expect(result.gcode).toContain('HOLE CONTOUR');
  });

  it('a circular OUTER contour that also wants tabs falls back to the polygon path (documented scope limit)', () => {
    const part = [{ points: circle(0, 0, 2), isHole: false }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.25, targetDepth: 0.25, tabSpacing: 4, tabWidth: 0.25 });
    expect(result.gcode).not.toContain('true circle');
    expect(result.stats.tabZones).toBeGreaterThan(0);
  });

  it('a circular OUTER contour with no tabs wanted DOES use the helical arc path', () => {
    const part = [{ points: circle(0, 0, 2), isHole: false }];
    const result = generateRoutingGcode(part, { toolDiameter: 0.25, targetDepth: 0.25, tabSpacing: 0 });
    expect(result.gcode).toContain('true circle');
  });
});
