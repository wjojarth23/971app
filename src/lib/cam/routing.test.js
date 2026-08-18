import { describe, it, expect } from 'vitest';
import { generateRoutingGcode, offsetPolygon } from './routing.js';

function square(cx, cy, size) {
  const h = size / 2;
  return [{ x: cx - h, y: cy - h }, { x: cx + h, y: cy - h }, { x: cx + h, y: cy + h }, { x: cx - h, y: cy + h }, { x: cx - h, y: cy - h }];
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
    const plungeMoves = result.gcode.split('\n').filter((l) => l.startsWith('G01 Z'));
    expect(plungeMoves.length).toBeGreaterThan(0); // this was a real bug once - zero plunge moves when targetDepth didn't reach the per-tool body
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
