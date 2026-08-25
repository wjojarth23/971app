import { describe, it, expect } from 'vitest';
import { summarizeTeamEvents, fuelCountFromEvents, deriveMatchTeamRow } from './scoutingStats.js';

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

describe('fuelCountFromEvents', () => {
  it('counts taps', () => {
    const events = [
      event({ event_type: 'shuttle_fuel', event_value: '1' }),
      event({ event_type: 'shuttle_fuel', event_value: '1' }),
      event({ event_type: 'hub_fuel', event_value: '1' })
    ];
    expect(fuelCountFromEvents(events, 'shuttle')).toBe(2);
    expect(fuelCountFromEvents(events, 'hub')).toBe(1);
  });

  it('an override resets the baseline and drops prior taps from the count, without deleting them from the log', () => {
    const events = [
      event({ event_type: 'shuttle_fuel', event_value: '1' }),
      event({ event_type: 'shuttle_fuel', event_value: '1' }),
      event({ event_type: 'shuttle_fuel_override', event_value: '10' })
    ];
    expect(fuelCountFromEvents(events, 'shuttle')).toBe(10);
  });

  it('taps after an override add on top of the new baseline', () => {
    const events = [
      event({ event_type: 'shuttle_fuel_override', event_value: '10' }),
      event({ event_type: 'shuttle_fuel', event_value: '1' })
    ];
    expect(fuelCountFromEvents(events, 'shuttle')).toBe(11);
  });

  it('rejects a negative or non-numeric override rather than corrupting the count', () => {
    const events = [
      event({ event_type: 'shuttle_fuel', event_value: '1' }),
      event({ event_type: 'shuttle_fuel_override', event_value: 'garbage' })
    ];
    expect(fuelCountFromEvents(events, 'shuttle')).toBe(1);
  });

  it('returns 0 for an empty or missing event list', () => {
    expect(fuelCountFromEvents([], 'shuttle')).toBe(0);
    expect(fuelCountFromEvents(null, 'shuttle')).toBe(0);
  });
});

describe('deriveMatchTeamRow', () => {
  it('derives the latest value of each field, not the first', () => {
    const events = [
      event({ event_type: 'climb_pos', event_value: 'L1' }),
      event({ event_type: 'climb_pos', event_value: 'L2' }),
      event({ event_type: 'rank_driving', event_value: '2' }),
      event({ event_type: 'rank_driving', event_value: '3' })
    ];
    const row = deriveMatchTeamRow(events);
    expect(row.finalClimbPos).toBe('L2');
    expect(row.drivingRank).toBe(3);
  });

  it('defaults climb positions to N/A and leaves numeric fields null when never recorded', () => {
    const row = deriveMatchTeamRow([]);
    expect(row.autoClimbPos).toBe('N/A');
    expect(row.finalClimbPos).toBe('N/A');
    expect(row.drivingRank).toBeNull();
    expect(row.accuracy).toBeNull();
    expect(row.speed).toBeNull();
    expect(row.shuttleFuel).toBe(0);
    expect(row.hubFuel).toBe(0);
  });

  it('includes real fuel counts, honoring an override in the middle of the match', () => {
    const events = [
      event({ event_type: 'hub_fuel', event_value: '1' }),
      event({ event_type: 'hub_fuel', event_value: '1' }),
      event({ event_type: 'hub_fuel_override', event_value: '5' }),
      event({ event_type: 'hub_fuel', event_value: '1' })
    ];
    expect(deriveMatchTeamRow(events).hubFuel).toBe(6);
  });

  it('reads dead_auto as a real boolean, not the string "false"', () => {
    expect(deriveMatchTeamRow([event({ event_type: 'dead_auto', event_value: 'true' })]).deadAuto).toBe(true);
    expect(deriveMatchTeamRow([event({ event_type: 'dead_auto', event_value: 'false' })]).deadAuto).toBe(false);
    expect(deriveMatchTeamRow([]).deadAuto).toBe(false);
  });
});
