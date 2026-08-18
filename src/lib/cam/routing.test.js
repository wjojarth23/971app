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
