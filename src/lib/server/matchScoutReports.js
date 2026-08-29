const text = (value, limit) => String(value || '').trim().slice(0, limit) || null;
const rating = (value) => {
  const number = Number(value);
  return Number.isInteger(number) && number >= 1 && number <= 5 ? number : null;
};

export function normalizeMatchScoutReport(input = {}) {
  const eventKey = text(input.event_key, 40);
  const matchNumber = Number(input.match_number);
  const digits = String(input.team_key || '').replace(/\D/g, '');
  const startingPosition = text(input.starting_position, 60);
  if (!eventKey || !Number.isInteger(matchNumber) || matchNumber < 1 || !digits || !startingPosition) return null;
  const alliance = input.alliance_color === 'blue' ? 'blue' : 'red';
  const path = Array.isArray(input.auto_path)
    ? input.auto_path.slice(0, 500).filter((point) => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite))
    : [];
  return {
    event_key: eventKey,
    match_key: `${eventKey}_qm${matchNumber}`,
    match_number: matchNumber,
    team_key: `frc${digits}`,
    alliance_color: alliance,
    starting_position: startingPosition,
    auto_start_zone: text(input.auto_start_zone, 60),
    auto_points_band: ['0', '1-2', '3-4', '5+'].includes(input.auto_points_band) ? input.auto_points_band : null,
    auto_end_action: ['shoot', 'climb', 'none'].includes(input.auto_end_action) ? input.auto_end_action : null,
    ball_sources: Array.isArray(input.ball_sources) ? input.ball_sources.map((item) => text(item, 40)).filter(Boolean).slice(0, 8) : [],
    auto_moved: input.auto_moved === 'ran' ? true : input.auto_moved === 'did-not-run' ? false : null,
    auto_path: path,
    shot_accuracy: rating(input.ratings?.['Shot accuracy']),
    driver_awareness: rating(input.ratings?.['Driver awareness']),
    cycle_speed: rating(input.ratings?.['Cycle speed']),
    defense: rating(input.ratings?.Defense),
    reliability: rating(input.ratings?.Reliability),
    teleop_notes: text(input.teleop_notes, 2000),
    crash_or_break: Boolean(input.crash_or_break),
    robot_status: ['active', 'disabled', 'died'].includes(input.robot_status) ? input.robot_status : null,
    card: ['none', 'yellow', 'red'].includes(input.card) ? input.card : null,
    driver_skill: rating(input.driver_skill),
    pit_problem: Boolean(input.pit_problem),
    pit_problem_details: text(input.pit_problem_details, 1200),
    post_notes: text(input.post_notes, 2000)
  };
}
