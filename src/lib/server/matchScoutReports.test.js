import { describe, expect, it } from 'vitest';
import { normalizeMatchScoutReport } from './matchScoutReports.js';

describe('normalizeMatchScoutReport', () => {
  it('requires event, match, team, and starting position', () => {
    expect(normalizeMatchScoutReport({ event_key: '2026casf', match_number: 1 })).toBeNull();
  });

  it('normalizes a complete report', () => {
    const report = normalizeMatchScoutReport({
      event_key: '2026casf', match_number: 12, team_key: 'FRC971', alliance_color: 'blue', starting_position: 'center',
      auto_moved: 'ran', auto_points_band: '3-4', ratings: { 'Shot accuracy': 5, Reliability: 4 }, driver_skill: 5,
      auto_path: [[10, 20], ['bad', 3]]
    });
    expect(report).toMatchObject({ match_key: '2026casf_qm12', team_key: 'frc971', alliance_color: 'blue', auto_moved: true, shot_accuracy: 5, reliability: 4 });
    expect(report.auto_path).toEqual([[10, 20]]);
  });

  it('rejects out-of-range ratings', () => {
    const report = normalizeMatchScoutReport({ event_key: 'e', match_number: 1, team_key: '1', starting_position: 'left', ratings: { Defense: 9 } });
    expect(report.defense).toBeNull();
  });
});
