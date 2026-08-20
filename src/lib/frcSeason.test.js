import { describe, it, expect } from 'vitest';
import { getSeasonBucket, getSeasonLabel, getAllSeasonBuckets, passesSeasonFilter } from './frcSeason.js';

describe('getSeasonBucket', () => {
  it('returns null for an unparseable date', () => {
    expect(getSeasonBucket('not a date')).toBeNull();
    expect(getSeasonBucket(undefined)).toBeNull();
  });

  it('treats Jan 1 through May 15 (Pacific) as in-season', () => {
    const bucket = getSeasonBucket('2026-05-15T12:00:00-07:00');
    expect(bucket.isOffseason).toBe(false);
    expect(bucket.year).toBe(2026);
    expect(bucket.value).toBe('2026-season');
    expect(bucket.label).toBe('2026 Season');
  });

  it('treats May 16 onward (Pacific) as offseason', () => {
    const bucket = getSeasonBucket('2026-05-16T12:00:00-07:00');
    expect(bucket.isOffseason).toBe(true);
    expect(bucket.value).toBe('2026-offseason');
    expect(bucket.label).toBe('2026 Offseason');
  });

  it('treats Dec 31 as offseason and Jan 1 of the next year as in-season', () => {
    expect(getSeasonBucket('2025-12-31T12:00:00-08:00').isOffseason).toBe(true);
    expect(getSeasonBucket('2026-01-01T12:00:00-08:00').isOffseason).toBe(false);
  });

  it('buckets by the Pacific calendar day, not the UTC day, near the boundary', () => {
    // 2026-05-15 23:30 Pacific (PDT, UTC-7) is 2026-05-16 06:30 UTC - a UTC-only
    // check would wrongly call this offseason (May 16).
    const bucket = getSeasonBucket('2026-05-16T06:30:00Z');
    expect(bucket.isOffseason).toBe(false);
    expect(bucket.value).toBe('2026-season');
  });
});

describe('getSeasonLabel', () => {
  it('returns the label for a valid date', () => {
    expect(getSeasonLabel('2026-03-01T00:00:00-08:00')).toBe('2026 Season');
  });

  it('returns an empty string for an invalid date', () => {
    expect(getSeasonLabel('garbage')).toBe('');
  });
});

describe('passesSeasonFilter', () => {
  it('passes everything when no filter is selected', () => {
    expect(passesSeasonFilter('2026-03-01T00:00:00-08:00', '')).toBe(true);
    expect(passesSeasonFilter('2026-03-01T00:00:00-08:00', null)).toBe(true);
  });

  it('matches a date against its own season bucket value', () => {
    expect(passesSeasonFilter('2026-03-01T00:00:00-08:00', '2026-season')).toBe(true);
    expect(passesSeasonFilter('2026-06-01T00:00:00-08:00', '2026-season')).toBe(false);
    expect(passesSeasonFilter('2026-06-01T00:00:00-08:00', '2026-offseason')).toBe(true);
  });

  it('rejects an unparseable date against any filter', () => {
    expect(passesSeasonFilter('garbage', '2026-season')).toBe(false);
  });
});

describe('getAllSeasonBuckets', () => {
  it('spans from the earliest item year through the current bucket, newest first', () => {
    const items = [{ created_at: '2024-02-01T00:00:00-08:00' }];
    // "Now" is whatever the real current date is - just check structural
    // invariants instead of hardcoding "today".
    const buckets = getAllSeasonBuckets(items);
    expect(buckets.length).toBeGreaterThan(0);
    expect(buckets[buckets.length - 1].year).toBe(2024);
    expect(buckets[buckets.length - 1].isOffseason).toBe(false);
    // Strictly non-increasing by (year, then season-before-offseason) walking newest to oldest.
    for (let i = 1; i < buckets.length; i += 1) {
      const prev = buckets[i - 1];
      const cur = buckets[i];
      expect(prev.year > cur.year || (prev.year === cur.year && (prev.isOffseason || !cur.isOffseason))).toBe(true);
    }
  });

  it('defaults to just the current year when items is empty', () => {
    const buckets = getAllSeasonBuckets([]);
    const years = new Set(buckets.map((b) => b.year));
    expect(years.size).toBe(1);
  });

  it('ignores items with an unparseable date field', () => {
    const buckets = getAllSeasonBuckets([{ created_at: 'garbage' }]);
    const years = new Set(buckets.map((b) => b.year));
    expect(years.size).toBe(1);
  });
});
