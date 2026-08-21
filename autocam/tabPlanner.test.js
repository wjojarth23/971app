import { describe, it, expect } from 'vitest';
import { recommendTabCount, MIN_TABS, MAX_TABS, DEFAULT_SPACING } from './tabPlanner.js';

describe('recommendTabCount - minimum floor (real bug: a single tab is a pivot point, not real holding)', () => {
  it('a perimeter that would naively give 1 tab (or 0) is bumped up to the minimum of 2', () => {
    // Matches the real case that surfaced this: perimeter ~10.5" (a ~3"x2.2"
    // plate), default 6" spacing -> old floor(10.5/6)=1.
    expect(recommendTabCount(10.5, { spacing: 6 })).toBe(MIN_TABS);
    // Even smaller relative to spacing (would floor to 0 under the old formula).
    expect(recommendTabCount(2, { spacing: 6 })).toBe(MIN_TABS);
  });

  it('minTabs is itself overridable, for callers that genuinely want fewer', () => {
    expect(recommendTabCount(6, { spacing: 6, minTabs: 1 })).toBe(1);
  });
});

describe('recommendTabCount - maximum cap (real requirement: "should not be too many tabs" - each one is manual cleanup)', () => {
  it('a very large perimeter relative to spacing is capped at the maximum, not left unbounded', () => {
    expect(recommendTabCount(1000, { spacing: 6 })).toBe(MAX_TABS);
  });

  it('maxTabs is itself overridable', () => {
    expect(recommendTabCount(1000, { spacing: 6, maxTabs: 10 })).toBe(10);
  });
});

describe('recommendTabCount - normal range is unaffected by the bounds', () => {
  it('a perimeter that lands comfortably between the min and max floor uses the real rounded count', () => {
    // perimeter 24" / spacing 6" = 4 - inside [2, 6], should pass through unchanged.
    expect(recommendTabCount(24, { spacing: 6 })).toBe(4);
  });

  it('defaults to a 6" spacing when none is given', () => {
    expect(recommendTabCount(24)).toBe(Math.round(24 / DEFAULT_SPACING));
  });
});

describe('recommendTabCount - thickness nudges spacing (coarse heuristic, not precise physics - see file header)', () => {
  it('thin stock (< 0.1") tightens spacing, producing more tabs than the same perimeter with no thickness given', () => {
    const withoutThickness = recommendTabCount(30, { spacing: 6 });
    const thin = recommendTabCount(30, { spacing: 6, thickness: 0.063 });
    expect(thin).toBeGreaterThanOrEqual(withoutThickness);
  });

  it('thick stock (> 0.375") loosens spacing, producing fewer or equal tabs vs. no thickness given', () => {
    const withoutThickness = recommendTabCount(30, { spacing: 6 });
    const thick = recommendTabCount(30, { spacing: 6, thickness: 0.5 });
    expect(thick).toBeLessThanOrEqual(withoutThickness);
  });

  it('mid-range thickness (between the two thresholds) leaves spacing unchanged', () => {
    const withoutThickness = recommendTabCount(30, { spacing: 6 });
    const midRange = recommendTabCount(30, { spacing: 6, thickness: 0.25 });
    expect(midRange).toBe(withoutThickness);
  });

  it('a thickness of 0 or null is ignored, not treated as "infinitely thin"', () => {
    const withoutThickness = recommendTabCount(30, { spacing: 6 });
    expect(recommendTabCount(30, { spacing: 6, thickness: 0 })).toBe(withoutThickness);
    expect(recommendTabCount(30, { spacing: 6, thickness: null })).toBe(withoutThickness);
  });
});

describe('recommendTabCount - invalid input', () => {
  it('returns 0 for a non-positive perimeter or spacing, instead of throwing or returning a bogus count', () => {
    expect(recommendTabCount(0)).toBe(0);
    expect(recommendTabCount(-5)).toBe(0);
    expect(recommendTabCount(10, { spacing: 0 })).toBe(0);
    expect(recommendTabCount(10, { spacing: -1 })).toBe(0);
  });
});
