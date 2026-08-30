// Validation and normalization for match scouting and the pit-problem
// handoff. Kept pure and separate from the route so the rules are directly
// testable, and because this is the only thing standing between a scout's
// phone and the database - the client is a form anyone can edit.
//
// The vocabularies below mirror what the match scouting workspace collects.
// Anything outside them is dropped rather than stored, so a renamed option in
// the UI shows up as missing data instead of quietly widening the schema.

export const START_POSITIONS = ['left trench', 'left mound', 'center', 'right mound', 'right trench'];
export const AUTO_ZONES = ['source', 'wing', 'neutral', 'opponent wing'];
export const POINT_BANDS = ['0', '1-2', '3-4', '5+'];
export const RATING_FIELDS = ['Shot accuracy', 'Driver awareness', 'Cycle speed', 'Defense', 'Reliability'];
export const BALL_SOURCES = ['source', 'wing', 'neutral', 'opponent wing', 'human player', 'floor'];
export const CARDS = ['', 'yellow', 'red'];
export const DISABLED_STATES = ['', 'no', 'tipped', 'died', 'disabled'];
export const SEVERITIES = ['urgent', 'watch'];

// A freehand path can emit a point per pointermove event, which is thousands
// over a 15-second auto. The drawing is only ever read back as a shape, so
// cap it and drop the middle rather than storing every sample.
const MAX_PATH_POINTS = 400;
const MAX_NOTE_LENGTH = 4000;
const MAX_SUMMARY_LENGTH = 300;

function trimmed(value, max = MAX_NOTE_LENGTH) {
  if (value == null) return null;
  const text = String(value).trim();
  return text ? text.slice(0, max) : null;
}

function oneOf(value, allowed) {
  if (value == null) return null;
  const text = String(value).trim();
  return allowed.includes(text) ? text : null;
}

/** Team keys arrive as "971", "frc971" or " frc971 " depending on the caller. */
export function normalizeTeamKey(value) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return null;
  const digits = text.replace(/^frc/, '');
  return /^\d{1,5}$/.test(digits) ? `frc${digits}` : null;
}

export function normalizeAutoPath(value) {
  if (!Array.isArray(value)) return [];
  const points = [];
  for (const point of value) {
    if (!Array.isArray(point) || point.length < 2) continue;
    const x = Number(point[0]);
    const y = Number(point[1]);
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    // Percentages of the field diagram, so they stay meaningful at any size.
    points.push([
      Math.round(Math.min(100, Math.max(0, x)) * 100) / 100,
      Math.round(Math.min(100, Math.max(0, y)) * 100) / 100
    ]);
  }
  if (points.length <= MAX_PATH_POINTS) return points;
  // Keep the endpoints - where a robot started and finished is the part
  // anyone actually reads - and evenly sample between them.
  const step = (points.length - 1) / (MAX_PATH_POINTS - 1);
  const sampled = [];
  for (let index = 0; index < MAX_PATH_POINTS; index += 1) {
    sampled.push(points[Math.round(index * step)]);
  }
  return sampled;
}

export function normalizeRatings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const ratings = {};
  for (const field of RATING_FIELDS) {
    const raw = Number(value[field]);
    if (!Number.isFinite(raw)) continue;
    const clamped = Math.min(5, Math.max(0, Math.round(raw)));
    // 0 means "not rated" in the UI, so there is nothing to record.
    if (clamped > 0) ratings[field] = clamped;
  }
  return ratings;
}

function normalizeStringList(value, allowed) {
  if (!Array.isArray(value)) return [];
  const seen = new Set();
  for (const entry of value) {
    const match = oneOf(entry, allowed);
    if (match) seen.add(match);
  }
  return [...seen];
}

/**
 * @returns {{ value: object|null, error: string|null }}
 */
export function normalizeMatchScoutEntry(body, actorId = null) {
  const event_key = trimmed(body?.event_key, 60);
  const match_key = trimmed(body?.match_key, 60);
  const team_key = normalizeTeamKey(body?.team_key);
  if (!event_key) return { value: null, error: 'event_key is required' };
  if (!match_key) return { value: null, error: 'match_key is required' };
  if (!team_key) return { value: null, error: 'A valid team_key is required (e.g. frc971)' };

  const driverSkillRaw = Number(body?.driver_skill);
  return {
    value: {
      event_key,
      match_key,
      team_key,
      alliance: oneOf(body?.alliance, ['red', 'blue']),
      starting_position: oneOf(body?.starting_position, START_POSITIONS),
      auto_start_zone: oneOf(body?.auto_start_zone, AUTO_ZONES),
      auto_points_band: oneOf(body?.auto_points_band, POINT_BANDS),
      auto_finish: trimmed(body?.auto_finish, 120),
      auto_moved: trimmed(body?.auto_moved, 40),
      ball_sources: normalizeStringList(body?.ball_sources, BALL_SOURCES),
      auto_path: normalizeAutoPath(body?.auto_path),
      ratings: normalizeRatings(body?.ratings),
      teleop_notes: trimmed(body?.teleop_notes),
      crash_or_break: body?.crash_or_break === true,
      robot_disabled: oneOf(body?.robot_disabled, DISABLED_STATES),
      card: oneOf(body?.card, CARDS),
      driver_skill: Number.isFinite(driverSkillRaw)
        ? Math.min(5, Math.max(0, Math.round(driverSkillRaw)))
        : null,
      post_notes: trimmed(body?.post_notes),
      created_by: actorId,
      updated_at: new Date().toISOString()
    },
    error: null
  };
}

/**
 * A match scout flagging a mechanical problem for the pit crew. Severity is
 * derived from what was observed rather than trusted from the client: a robot
 * that died or was disabled is urgent regardless of what the form sent.
 */
export function normalizePitProblemReport(body, actorId = null) {
  const event_key = trimmed(body?.event_key, 60);
  const team_key = normalizeTeamKey(body?.team_key);
  if (!event_key) return { value: null, error: 'event_key is required' };
  if (!team_key) return { value: null, error: 'A valid team_key is required (e.g. frc971)' };

  const summary = trimmed(body?.summary, MAX_SUMMARY_LENGTH)
    || 'Mechanical issue flagged after match';
  const observedUrgent = ['died', 'disabled'].includes(String(body?.robot_disabled || '').trim());
  const requested = oneOf(body?.severity, SEVERITIES);

  return {
    value: {
      event_key,
      team_key,
      match_key: trimmed(body?.match_key, 60),
      source: trimmed(body?.source, 60) || 'Match scout',
      summary,
      detail: trimmed(body?.detail),
      severity: observedUrgent ? 'urgent' : (requested || 'watch'),
      resolved: false,
      created_by: actorId
    },
    error: null
  };
}
