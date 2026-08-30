import { describe, expect, it } from 'vitest';
import { continueAutoPath, parseAutoPointsEstimate } from './matchScouting.js';

describe('parseAutoPointsEstimate', () => {
  it('keeps an exact count exact', () => {
    expect(parseAutoPointsEstimate('84')).toEqual({
      input: '84', min: 84, max: 84, average: 84, kind: 'exact'
    });
  });

  it('derives the midpoint of a general range', () => {
    expect(parseAutoPointsEstimate(' 80 to 100 ')).toEqual({
      input: '80-100', min: 80, max: 100, average: 90, kind: 'range'
    });
  });

  it('accepts typographic dashes and decimal estimates', () => {
    expect(parseAutoPointsEstimate('12.5–17.5')?.average).toBe(15);
  });

  it('uses an open-ended value as a conservative lower-bound estimate', () => {
    expect(parseAutoPointsEstimate('100+')).toEqual({
      input: '100+', min: 100, max: null, average: 100, kind: 'lower-bound'
    });
  });

  it('accepts approximate notation and commas', () => {
    expect(parseAutoPointsEstimate('~1,000')?.average).toBe(1000);
  });

  it('rejects reversed, negative, excessive, and nonsensical input', () => {
    for (const invalid of ['100-50', '-5', '1001', 'lots', '50ish']) {
      expect(parseAutoPointsEstimate(invalid)).toBeNull();
    }
  });

  it('treats a blank field as an intentionally skipped estimate', () => {
    expect(parseAutoPointsEstimate('')).toBeNull();
    expect(parseAutoPointsEstimate(null)).toBeNull();
  });
});

describe('continueAutoPath', () => {
  it('keeps points from earlier pointer gestures', () => {
    const existingPath = [
      [12, 24],
      [18, 30]
    ];

    expect(continueAutoPath(existingPath, [25, 36])).toEqual([
      [12, 24],
      [18, 30],
      [25, 36]
    ]);
  });

  it('starts a path when no earlier gesture exists', () => {
    expect(continueAutoPath(undefined, [5, 10])).toEqual([[5, 10]]);
  });
});
