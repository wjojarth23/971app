import { describe, it, expect } from 'vitest';
import { generateTurningGcode } from './turning.js';

// Synthetic profile: a 2" long round shaft, 0.5" radius through the middle,
// with a small step down to 0.4" at each end - enough geometry variation to
// exercise both roughing and finishing without needing a real STEP file.
//
// Ascending Z in arbitrary native/raw coordinates, matching what
// extractTurningProfileFromMeshes actually hands generateTurningGcode (it
// does NOT pre-normalize) - generateTurningGcode does its own face-at-Z0,
// increasingly-negative normalization internally. A pre-normalized fixture
// here would get normalized a second time and end up mirrored.
function shaftProfile() {
  return [
    { z: 0, x: 0.4 },
    { z: 0.1, x: 0.5 },
    { z: 1.9, x: 0.5 },
    { z: 2.0, x: 0.4 }
  ];
}

const baseParams = { stockDiameter: 1.1, stepDown: 0.05, finishAllowance: 0.02, feedRough: 0.008, feedFinish: 0.004 };

describe('generateTurningGcode - single setup (default)', () => {
  it('generates valid G-code with header/footer/roughing/finishing', () => {
    const result = generateTurningGcode(shaftProfile(), baseParams);
    expect(result.gcode).toContain('G20 (inch)');
    expect(result.gcode).toContain('M30 (program end)');
    expect(result.gcode).toContain('(--- ROUGHING PASSES ---)');
    expect(result.gcode).toContain('(--- FINISHING PASS ---)');
    expect(result.stats.setupMode).toBe('single');
    expect(result.stats.roughingPasses).toBeGreaterThan(0);
  });

  it('throws if the profile has fewer than 2 points', () => {
    expect(() => generateTurningGcode([{ z: 0, x: 0.5 }], baseParams)).toThrow(/at least 2 points/);
  });

  it('throws if stockDiameter is missing', () => {
    expect(() => generateTurningGcode(shaftProfile(), { stepDown: 0.05 })).toThrow(/stockDiameter is required/);
  });

  it('throws if stepDown is not positive', () => {
    expect(() => generateTurningGcode(shaftProfile(), { ...baseParams, stepDown: 0 })).toThrow(/stepDown must be > 0/);
  });

  it('throws if stock is smaller than the profile\'s max radius', () => {
    expect(() => generateTurningGcode(shaftProfile(), { ...baseParams, stockDiameter: 0.5 })).toThrow(/stock too small/);
  });

  it('normalizes Z so the profile always starts at the face, regardless of the STEP file\'s native origin', () => {
    const shifted = shaftProfile().map((p) => ({ x: p.x, z: p.z + 37.5 }));
    const result = generateTurningGcode(shifted, baseParams);
    expect(result.gcode).toMatch(/G00 X[\d.]+ Z0\.1000 \(rapid to start clearance\)/);
  });

  it('caps roughing passes at the safety limit for a pathological stepDown', () => {
    expect(() => generateTurningGcode(shaftProfile(), { ...baseParams, stepDown: 0.0000001 })).toThrow(/safety limit/);
  });
});

describe('generateTurningGcode - tailstock mode', () => {
  it('produces the same cut geometry as single mode, plus a tailstock note', () => {
    const single = generateTurningGcode(shaftProfile(), baseParams);
    const tailstock = generateTurningGcode(shaftProfile(), { ...baseParams, setupMode: 'tailstock' });
    expect(tailstock.gcode).toContain('TAILSTOCK REQUIRED');
    expect(tailstock.stats.setupMode).toBe('tailstock');
    expect(tailstock.stats.roughingPasses).toBe(single.stats.roughingPasses);
  });
});

describe('generateTurningGcode - flip-turning mode', () => {
  it('requires flipAt', () => {
    expect(() => generateTurningGcode(shaftProfile(), { ...baseParams, setupMode: 'flip' })).toThrow(/flipAt.*is required/);
  });

  it('rejects a flip point past the part length', () => {
    expect(() => generateTurningGcode(shaftProfile(), { ...baseParams, setupMode: 'flip', flipAt: 5 })).toThrow(/must be less than the part's total length/);
  });

  it('rejects a flip point too close to the face to safely re-grip', () => {
    expect(() => generateTurningGcode(shaftProfile(), { ...baseParams, setupMode: 'flip', flipAt: 0.1 })).toThrow(/too short to safely re-chuck/);
  });

  it('rejects a flip point that leaves too little material past it', () => {
    expect(() => generateTurningGcode(shaftProfile(), { ...baseParams, setupMode: 'flip', flipAt: 1.95 })).toThrow(/too little material left/);
  });

  it('respects a custom minGripLength', () => {
    // 0.3" would normally pass (> default 0.25" floor) but should fail against a stricter custom floor.
    expect(() => generateTurningGcode(shaftProfile(), { ...baseParams, setupMode: 'flip', flipAt: 0.3, minGripLength: 0.5 })).toThrow(/too short to safely re-chuck/);
  });

  it('generates two setups with a real re-chuck pause between them', () => {
    const result = generateTurningGcode(shaftProfile(), { ...baseParams, setupMode: 'flip', flipAt: 1.0 });
    expect(result.gcode).toContain('RE-CHUCK REQUIRED');
    expect(result.gcode).toContain('M00 (program pause');
    expect(result.gcode).toContain('FLIP SETUP 1 OF 2');
    expect(result.stats.setupMode).toBe('flip');
    expect(result.stats.flipAt).toBe(1.0);
    expect(result.stats.setup1Length).toBeCloseTo(1.0, 5);
    expect(result.stats.setup2Length).toBeCloseTo(1.0, 5);
  });

  it('matches the finishing-pass diameter exactly across the flip boundary (same physical location, two reference frames)', () => {
    const result = generateTurningGcode(shaftProfile(), { ...baseParams, setupMode: 'flip', flipAt: 1.0 });
    const lines = result.gcode.split('\n');

    const finishSections = [];
    let collecting = false;
    for (const line of lines) {
      if (line.includes('FINISHING PASS')) { collecting = true; finishSections.push([]); continue; }
      if (collecting && line.startsWith('G01 X')) finishSections[finishSections.length - 1].push(line);
      if (collecting && line.includes('retract clear of stock')) collecting = false;
    }
    expect(finishSections).toHaveLength(2);

    const setup1FinishEnd = finishSections[0][finishSections[0].length - 1];
    const setup2FinishStart = finishSections[1][0];
    const dia1 = setup1FinishEnd.match(/X([\d.]+)/)[1];
    const dia2 = setup2FinishStart.match(/X([\d.]+)/)[1];
    expect(dia1).toBe(dia2);
  });

  it('does not affect single-setup mode output (no flip-related text leaks in)', () => {
    const result = generateTurningGcode(shaftProfile(), baseParams);
    expect(result.stats.setupMode).toBe('single');
    expect(result.gcode).not.toContain('RE-CHUCK');
    expect(result.gcode).not.toContain('FLIP SETUP');
  });
});
