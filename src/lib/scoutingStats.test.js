import { describe, it, expect } from 'vitest';
import { summarizeTeamEvents } from './scoutingStats.js';

function event(overrides) {
  return { match_key: '2026casf_qm1', team_key: 'frc971', event_type: null, event_value: null, ...overrides };
}

describe('summarizeTeamEvents', () => {
  it('counts distinct matches, not events (many events per match)', () => {
    const events = [
      event({ match_key: '2026casf_qm1', event_type: 'phase', event_value: 'begin_auto' }),
      event({ match_key: '2026casf_qm1', event_type: 'phase', event_value: 'end_auto' }),
      event({ match_key: '2026casf_qm2', event_type: 'phase', event_value: 'begin_auto' })
    ];
    expect(summarizeTeamEvents(events).matchesScouted).toBe(2);
  });

  it('averages rank_driving, rank_accuracy, rank_speed independently', () => {
    const events = [
      event({ event_type: 'rank_driving', event_value: '2' }),
      event({ event_type: 'rank_driving', event_value: '3' }),
      event({ event_type: 'rank_accuracy', event_value: '5' }),
      event({ event_type: 'rank_speed', event_value: '1.5' })
    ];
    const s = summarizeTeamEvents(events);
    expect(s.avgDrivingRank).toBeCloseTo(2.5, 5);
    expect(s.avgAccuracy).toBeCloseTo(5, 5);
    expect(s.avgSpeed).toBeCloseTo(1.5, 5);
  });

  it('skips non-numeric event_value instead of corrupting the average (event_value is always stored as text)', () => {
    const events = [
      event({ event_type: 'rank_driving', event_value: '3' }),
      event({ event_type: 'rank_driving', event_value: 'not-a-number' }),
      event({ event_type: 'rank_driving', event_value: null })
    ];
    expect(summarizeTeamEvents(events).avgDrivingRank).toBeCloseTo(3, 5);
  });

  it('returns null (not 0 or NaN) for a metric with zero real observations', () => {
    const s = summarizeTeamEvents([event({ event_type: 'phase', event_value: 'begin_auto' })]);
    expect(s.avgDrivingRank).toBeNull();
    expect(s.avgAccuracy).toBeNull();
    expect(s.avgSpeed).toBeNull();
    expect(s.mostCommonClimb).toBeNull();
  });

  it('finds the most common climb_pos and reports full counts, real tie-break case included', () => {
    const events = [
      event({ event_type: 'climb_pos', event_value: 'L2' }),
      event({ event_type: 'climb_pos', event_value: 'L2' }),
      event({ event_type: 'climb_pos', event_value: 'Failed' })
    ];
    const s = summarizeTeamEvents(events);
    expect(s.mostCommonClimb).toBe('L2');
    expect(s.climbCounts).toEqual({ L2: 2, Failed: 1 });
  });

  it('handles an empty or missing event list without throwing', () => {
    expect(summarizeTeamEvents([])).toEqual({
      matchesScouted: 0,
      avgDrivingRank: null,
      avgAccuracy: null,
      avgSpeed: null,
      mostCommonClimb: null,
      climbCounts: {}
    });
    expect(summarizeTeamEvents(null).matchesScouted).toBe(0);
    expect(summarizeTeamEvents(undefined).matchesScouted).toBe(0);
  });

  it('ignores malformed event rows (null/missing fields) rather than throwing', () => {
    const events = [null, undefined, {}, event({ event_type: 'rank_driving', event_value: '2' })];
    const s = summarizeTeamEvents(events);
    expect(s.avgDrivingRank).toBeCloseTo(2, 5);
  });
});
