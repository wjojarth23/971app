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

// Shuttle/Hub fuel counts: a tap ('shuttle_fuel'/'hub_fuel') increments by
// one; a '..._fuel_override' event sets a new baseline and resets the tap
// count, so a correction doesn't require deleting/replaying prior taps.
// Single source of truth for this derivation - datascout/+page.svelte's
// live counters and the Google Sheets export (deriveMatchTeamRow below)
// both call this instead of each re-implementing the merge logic.
export function fuelCountFromEvents(events, location) {
  const tapType = `${location}_fuel`;
  const overrideType = `${location}_fuel_override`;
  let baseline = 0;
  let taps = 0;
  for (const e of events || []) {
    if (e?.event_type === overrideType) {
      // A non-numeric/negative override is rejected, not coerced to 0 -
      // Math.max(0, NaN || 0) would silently evaluate to 0 and wipe out a
      // real count on garbage input. The live datascout UI already
      // validates before ever recording this event type, but this
      // aggregation reads whatever's actually in the DB, so it can't just
      // assume that held - same defensive-parsing stance as parseNumeric
      // above.
      const parsed = parseNumeric(e.event_value);
      if (parsed != null && parsed >= 0) {
        baseline = Math.round(parsed);
        taps = 0;
      }
    } else if (e?.event_type === tapType) {
      taps += 1;
    }
  }
  return baseline + taps;
}

// One flat summary row for a SINGLE (match_key, team_key) pair - distinct
// from summarizeTeamEvents above, which aggregates across every match a
// team's been scouted in. Caller must already filter `events` down to one
// match+team pair. Built for the Google Sheets export (one row per scouted
// robot per match), not currently used for in-app display.
export function deriveMatchTeamRow(events) {
  const list = events || [];
  const latestValue = (type) => {
    for (let i = list.length - 1; i >= 0; i -= 1) {
      if (list[i]?.event_type === type) return list[i].event_value;
    }
    return null;
  };
  return {
    autoStartPosition: latestValue('auto_start_position') || '',
    deadAuto: latestValue('dead_auto') === 'true',
    autoClimbPos: latestValue('auto_climb_pos') || 'N/A',
    finalClimbPos: latestValue('climb_pos') || 'N/A',
    drivingRank: parseNumeric(latestValue('rank_driving')),
    accuracy: parseNumeric(latestValue('rank_accuracy')),
    speed: parseNumeric(latestValue('rank_speed')),
    shuttleFuel: fuelCountFromEvents(list, 'shuttle'),
    hubFuel: fuelCountFromEvents(list, 'hub')
  };
}

const CLIMB_LEVEL = { 'N/A': 0, Failed: 0, L1: 1, L2: 2, L3: 3 };

// Builds the local-scouting inputs used by the rankings page. Match-level
// values are derived first so a match with fifty fuel taps does not count as
// fifty independent observations while one subjective rating counts once.
export function summarizeTeamPerformance(events) {
  const byMatch = new Map();
  for (const row of events || []) {
    if (!row?.match_key) continue;
    if (!byMatch.has(row.match_key)) byMatch.set(row.match_key, []);
    byMatch.get(row.match_key).push(row);
  }

  const matches = [...byMatch.values()].map(deriveMatchTeamRow);
  const average = (values) => {
    const usable = values.filter((value) => Number.isFinite(value));
    return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
  };

  return {
    ...summarizeTeamEvents(events),
    avgFuel: matches.length ? average(matches.map((match) => match.shuttleFuel + match.hubFuel)) : null,
    avgClimbLevel: average(matches.map((match) => CLIMB_LEVEL[match.finalClimbPos]).filter((level) => level != null)),
    climbSuccessRate: matches.length
      ? matches.filter((match) => (CLIMB_LEVEL[match.finalClimbPos] || 0) > 0).length / matches.length
      : null
  };
}

function normalize(value, values) {
  if (!Number.isFinite(value)) return null;
  const usable = values.filter(Number.isFinite);
  if (!usable.length) return null;
  const min = Math.min(...usable);
  const max = Math.max(...usable);
  // A tied field contains no evidence that anyone is above or below the
  // event field, so it is neutral rather than a free perfect score.
  if (max === min) return 50;
  return ((value - min) / (max - min)) * 100;
}

function weightedScore(parts) {
  const usable = parts.filter((part) => Number.isFinite(part.value));
  const weight = usable.reduce((sum, part) => sum + part.weight, 0);
  if (!weight) return null;
  return usable.reduce((sum, part) => sum + part.value * part.weight, 0) / weight;
}

const AUTO_POINTS_SCORE = { '0': 0, '1-2': 30, '3-4': 70, '5+': 100 };
const STATUS_SCORE = { active: 100, disabled: 35, died: 0 };
const PIT_CLIMB_SCORE = { 'No Climb': 0, L1: 35, 'L1 Auto': 45, L2: 70, L3: 100 };
const PROBLEM_PENALTY = { low: 5, medium: 10, high: 20, critical: 30 };

export function summarizeDecisionInputs(matchReports = [], pitEntry = null, problemReports = []) {
  const reports = matchReports || [];
  const matchValues = [];
  const reliabilityValues = [];
  let noteCount = (pitEntry?.additional_notes ? 1 : 0) + (pitEntry?.profile_notes ? 1 : 0);

  for (const report of reports) {
    for (const field of ['shot_accuracy', 'driver_awareness', 'cycle_speed', 'defense', 'driver_skill']) {
      const value = Number(report?.[field]);
      if (value >= 1 && value <= 5) matchValues.push(value * 20);
    }
    if (AUTO_POINTS_SCORE[report?.auto_points_band] != null) matchValues.push(AUTO_POINTS_SCORE[report.auto_points_band]);
    if (typeof report?.auto_moved === 'boolean') matchValues.push(report.auto_moved ? 100 : 0);
    const reliability = Number(report?.reliability);
    if (reliability >= 1 && reliability <= 5) reliabilityValues.push(reliability * 20);
    if (STATUS_SCORE[report?.robot_status] != null) reliabilityValues.push(STATUS_SCORE[report.robot_status]);
    if (typeof report?.crash_or_break === 'boolean') reliabilityValues.push(report.crash_or_break ? 0 : 100);
    if (report?.teleop_notes) noteCount += 1;
    if (report?.post_notes) noteCount += 1;
  }

  const average = (values) => values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
  const pitClimbs = Array.isArray(pitEntry?.climb_options) ? pitEntry.climb_options : [];
  const pitCapabilityScore = pitClimbs.length ? Math.max(...pitClimbs.map((value) => PIT_CLIMB_SCORE[value] ?? 0)) : null;
  const activeProblems = (problemReports || []).filter((problem) => ['open', 'acknowledged'].includes(problem?.status));
  const baseReliability = average(reliabilityValues);
  const penalty = activeProblems.reduce((sum, problem) => sum + (PROBLEM_PENALTY[problem?.severity] || 10), 0);
  const reliabilityScore = baseReliability == null && !activeProblems.length ? null : Math.max(0, (baseReliability ?? 100) - Math.min(60, penalty));
  const structuredMatchScore = average(matchValues);
  const matchEvaluationScore = weightedScore([
    { value: structuredMatchScore, weight: 0.85 },
    { value: pitCapabilityScore, weight: 0.15 }
  ]);

  return {
    matchReports: reports.length,
    structuredMatchScore,
    pitCapabilityScore,
    matchEvaluationScore,
    reliabilityScore,
    openProblemCount: activeProblems.length,
    noteCount,
    robotArchetype: pitEntry?.robot_archetype || null
  };
}

// Produces event-relative rankings from the team's own scouting observations.
// Missing dimensions are omitted and the remaining weights are normalized,
// never converted to fake zeroes.
export function buildPowerRankings(teams, events, decisionInputs = {}) {
  const eventsByTeam = new Map();
  for (const row of events || []) {
    if (!row?.team_key) continue;
    if (!eventsByTeam.has(row.team_key)) eventsByTeam.set(row.team_key, []);
    eventsByTeam.get(row.team_key).push(row);
  }

  const rows = (teams || []).map((team) => ({
    ...team,
    scoutSummary: summarizeTeamPerformance(eventsByTeam.get(team.key) || [])
  }));
  const metricValues = (key) => rows.map((row) => row.scoutSummary[key]);
  const matchByTeam = new Map();
  for (const report of decisionInputs.matchReports || []) {
    if (!matchByTeam.has(report.team_key)) matchByTeam.set(report.team_key, []);
    matchByTeam.get(report.team_key).push(report);
  }
  const pitByTeam = new Map((decisionInputs.pitEntries || []).map((entry) => [entry.team_key, entry]));
  const problemsByTeam = new Map();
  for (const problem of decisionInputs.problemReports || []) {
    if (!problemsByTeam.has(problem.team_key)) problemsByTeam.set(problem.team_key, []);
    problemsByTeam.get(problem.team_key).push(problem);
  }

  const ranked = rows.map((row) => {
    const summary = row.scoutSummary;
    const legacyPerformanceScore = weightedScore([
      { value: normalize(summary.avgFuel, metricValues('avgFuel')), weight: 0.4 },
      { value: normalize(summary.avgDrivingRank, metricValues('avgDrivingRank')), weight: 0.2 },
      { value: normalize(summary.avgAccuracy, metricValues('avgAccuracy')), weight: 0.15 },
      { value: normalize(summary.avgSpeed, metricValues('avgSpeed')), weight: 0.1 },
      { value: normalize(summary.avgClimbLevel, metricValues('avgClimbLevel')), weight: 0.15 }
    ]);
    const decisionSummary = summarizeDecisionInputs(matchByTeam.get(row.key), pitByTeam.get(row.key), problemsByTeam.get(row.key));
    const scoutPower = weightedScore([
      { value: legacyPerformanceScore, weight: 0.6 },
      { value: decisionSummary.matchEvaluationScore, weight: 0.3 },
      { value: decisionSummary.reliabilityScore, weight: 0.1 }
    ]);
    return {
      ...row,
      scoutPower,
      decisionSummary,
      scoreBreakdown: { legacyPerformanceScore, matchEvaluationScore: decisionSummary.matchEvaluationScore, reliabilityScore: decisionSummary.reliabilityScore }
    };
  });

  const order = [...ranked]
    .sort((a, b) => (b.scoutPower ?? -1) - (a.scoutPower ?? -1))
    .map((row, index) => [row.key, row.scoutPower == null ? null : index + 1]);
  const rankByKey = new Map(order);
  return ranked.map((row) => ({ ...row, powerRank: rankByKey.get(row.key) }));
}
