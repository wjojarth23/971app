import { formatInTimeZone, PACIFIC_TIME_ZONE } from '$lib/timezone.js';

// FRC kickoff always lands in early-to-mid January and the World Championship
// always concludes by the first week of May, but FIRST sets the exact dates
// by hand each year (no fixed formula). Rather than hardcode dates that would
// need yearly upkeep, we use a fixed calendar-day boundary that stays close
// to reality forever with zero maintenance:
//   Season:    Jan 1 - May 15
//   Offseason: May 16 - Dec 31
const SEASON_END_MONTH = 5; // May
const SEASON_END_DAY = 15;

function getPacificParts(date) {
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return null;
  const year = Number(formatInTimeZone(value, PACIFIC_TIME_ZONE, { year: 'numeric' }));
  const month = Number(formatInTimeZone(value, PACIFIC_TIME_ZONE, { month: 'numeric' }));
  const day = Number(formatInTimeZone(value, PACIFIC_TIME_ZONE, { day: 'numeric' }));
  if (!year || !month || !day) return null;
  return { year, month, day };
}

// Returns { year, isOffseason, value, label } for a given date, or null if
// the date can't be parsed.
export function getSeasonBucket(date) {
  const parts = getPacificParts(date);
  if (!parts) return null;
  const { year, month, day } = parts;
  const isOffseason = month > SEASON_END_MONTH || (month === SEASON_END_MONTH && day > SEASON_END_DAY);
  return {
    year,
    isOffseason,
    value: `${year}-${isOffseason ? 'offseason' : 'season'}`,
    label: `${year} ${isOffseason ? 'Offseason' : 'Season'}`
  };
}

export function getSeasonLabel(date) {
  return getSeasonBucket(date)?.label || '';
}

export function getCurrentSeasonBucket() {
  return getSeasonBucket(new Date());
}

// Sorted (newest-first) list of { value, label } spanning from the earliest
// created_at found in `items` (or the current year if there's no data yet)
// through the current bucket. Naturally grows a new entry every time the
// season/offseason boundary is crossed - nothing to update by hand.
export function getAllSeasonBuckets(items = [], dateField = 'created_at') {
  const current = getCurrentSeasonBucket();
  let earliestYear = current.year;
  for (const item of items) {
    const bucket = getSeasonBucket(item?.[dateField]);
    if (bucket && bucket.year < earliestYear) earliestYear = bucket.year;
  }

  const buckets = [];
  for (let year = current.year; year >= earliestYear; year -= 1) {
    // A year's Offseason bucket comes after its Season bucket. For the
    // current year, only include the Offseason bucket once we're actually
    // past May 15 - otherwise it's a future bucket that hasn't happened yet.
    const includeOffseason = year < current.year || current.isOffseason;
    if (includeOffseason) {
      buckets.push({ value: `${year}-offseason`, label: `${year} Offseason`, year, isOffseason: true });
    }
    buckets.push({ value: `${year}-season`, label: `${year} Season`, year, isOffseason: false });
  }
  return buckets;
}

export function passesSeasonFilter(date, selectedValue) {
  if (!selectedValue) return true;
  const bucket = getSeasonBucket(date);
  if (!bucket) return false;
  return bucket.value === selectedValue;
}
