// Summarizes a flat list of scout_data_events rows (as returned by
// GET /datascout?team_key=...&event_key=...) for one team into simple,
// robust aggregates. Deliberately not a full analytics engine - just what's
// directly derivable from the real event vocabulary datascout/+page.svelte
// actually writes (verified against that file, not guessed):
//   rank_driving  - 1-3, subjective driving quality (Bad/Good/Great)
//   rank_accuracy - 1-5, subjective shooting accuracy
//   rank_speed    - a numeric rate (balls/sec)
//   climb_pos     - one of 'N/A' | 'L1' | 'L2' | 'L3' | 'Failed'
// event_value is always stored as text (scout_data_events.event_value is a
// text column), so numeric fields need parsing; non-numeric/missing values
// are skipped rather than corrupting the average.
//
// Number(null) is 0 in JS, not NaN - a plain `Number.isFinite(Number(v))`
// check silently counts a missing value as a real 0, dragging the average
// down every time an event happens to have no value recorded. Reject
// null/undefined/empty-string explicitly before the numeric conversion.
function parseNumeric(raw) {
  if (raw == null || raw === '') return null;
  const v = Number(raw);
  return Number.isFinite(v) ? v : null;
}

export function summarizeTeamEvents(events) {
  const matchKeys = new Set();
  const driving = [];
  const accuracy = [];
  const speed = [];
  const climbCounts = {};

  for (const e of events || []) {
    if (e?.match_key) matchKeys.add(e.match_key);
    if (e?.event_type === 'rank_driving') {
      const v = parseNumeric(e.event_value);
      if (v != null) driving.push(v);
    } else if (e?.event_type === 'rank_accuracy') {
      const v = parseNumeric(e.event_value);
      if (v != null) accuracy.push(v);
    } else if (e?.event_type === 'rank_speed') {
      const v = parseNumeric(e.event_value);
      if (v != null) speed.push(v);
    } else if (e?.event_type === 'climb_pos') {
      const v = String(e.event_value || 'N/A');
      climbCounts[v] = (climbCounts[v] || 0) + 1;
    }
  }

  const avg = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);

  let mostCommonClimb = null;
  let mostCommonClimbCount = 0;
  for (const [pos, count] of Object.entries(climbCounts)) {
    if (count > mostCommonClimbCount) {
      mostCommonClimb = pos;
      mostCommonClimbCount = count;
    }
  }

  return {
    matchesScouted: matchKeys.size,
    avgDrivingRank: avg(driving),
    avgAccuracy: avg(accuracy),
    avgSpeed: avg(speed),
    mostCommonClimb,
    climbCounts
  };
}
