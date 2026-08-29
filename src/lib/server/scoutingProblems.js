export const PROBLEM_STATUSES = Object.freeze(['open', 'acknowledged', 'resolved', 'dismissed']);
export const PROBLEM_SEVERITIES = Object.freeze(['low', 'medium', 'high', 'critical']);
export const PROBLEM_SOURCES = Object.freeze(['pit_scout', 'match_scout', 'manual']);

export function cleanProblemText(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

export function normalizeProblemTeamKey(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  return digits ? `frc${digits}` : '';
}

export function normalizeProblemCreate(input = {}) {
  const summary = cleanProblemText(input.summary, 160);
  const eventKey = cleanProblemText(input.event_key, 40);
  const teamKey = normalizeProblemTeamKey(input.team_key);
  if (!eventKey || !teamKey || !summary) return null;

  const matchNumber = Number(input.match_number);
  const alliance = String(input.alliance_color || '').toLowerCase();
  const severity = PROBLEM_SEVERITIES.includes(input.severity) ? input.severity : 'medium';
  const source = PROBLEM_SOURCES.includes(input.source) ? input.source : 'pit_scout';

  return {
    event_key: eventKey,
    match_key: cleanProblemText(input.match_key, 80) || null,
    match_number: Number.isInteger(matchNumber) && matchNumber > 0 ? matchNumber : null,
    team_key: teamKey,
    alliance_color: ['red', 'blue'].includes(alliance) ? alliance : null,
    source,
    severity,
    summary,
    details: cleanProblemText(input.details, 1200) || null
  };
}

export function normalizeProblemStatus(input = {}) {
  const status = String(input.status || '').toLowerCase();
  if (!PROBLEM_STATUSES.includes(status)) return null;
  return {
    status,
    resolution_notes: cleanProblemText(input.resolution_notes, 800) || null
  };
}
