import { describe, expect, it } from 'vitest';
import { fetchTbaMatchRoster, referenceFromTbaMatch, rosterFromTbaMatch } from './vision_reference.js';

describe('Vision TBA reference parsing', () => {
  it('preserves alliances and extracts compatible fuel/climb fields', () => {
    const reference = referenceFromTbaMatch({
      key: '2026test_qm1',
      alliances: {
        red: { team_keys: ['frc971'], score: 42 },
        blue: { team_keys: ['frc254'], score: 30 }
      },
      score_breakdown: {
        red: { totalFuelPoints: 20, endGameRobot1: 'Level2' },
        blue: { totalFuelPoints: 12, endGameRobot1: 'None' }
      }
    });
    expect(reference.alliances.red.teamKeys).toEqual(['frc971']);
    expect(reference.alliances.red.fuel).toBe(20);
    expect(reference.alliances.red.climbs).toBe(1);
    expect(reference.alliances.blue.climbs).toBe(0);
  });

  it('does not mistake total score for fuel when no compatible field exists', () => {
    const reference = referenceFromTbaMatch({ alliances: { red: {}, blue: {} }, score_breakdown: { red: { totalPoints: 100 }, blue: {} } });
    expect(reference.alliances.red.fuel).toBeNull();
  });
});

describe('rosterFromTbaMatch', () => {
  it('reads both alliances in driver station order', () => {
    const roster = rosterFromTbaMatch({
      alliances: { red: { team_keys: ['frc971', 'frc254', 'frc1678'] }, blue: { team_keys: ['frc118', 'frc148', 'frc217'] } }
    });
    expect(roster.red).toEqual(['frc971', 'frc254', 'frc1678']);
    expect(roster.blue).toEqual(['frc118', 'frc148', 'frc217']);
    expect(typeof roster.fetched_at).toBe('string');
  });

  it('returns null when TBA knows no teams, so the UI falls back to free text', () => {
    expect(rosterFromTbaMatch({})).toBeNull();
    expect(rosterFromTbaMatch({ alliances: { red: {}, blue: {} } })).toBeNull();
    expect(rosterFromTbaMatch(null)).toBeNull();
  });

  it('drops malformed entries rather than offering them as choices', () => {
    const roster = rosterFromTbaMatch({
      alliances: { red: { team_keys: ['frc971', null, '', 42] }, blue: { team_keys: 'nope' } }
    });
    expect(roster.red).toEqual(['frc971']);
    expect(roster.blue).toEqual([]);
  });
});

describe('fetchTbaMatchRoster', () => {
  it('returns null without a match key or auth key rather than calling out', async () => {
    const never = () => { throw new Error('should not fetch'); };
    expect(await fetchTbaMatchRoster('', 'key', never)).toBeNull();
    expect(await fetchTbaMatchRoster('2026casj_qm1', '', never)).toBeNull();
  });

  it('swallows a network failure so creating a match is never blocked', async () => {
    const failing = async () => { throw new Error('offline venue'); };
    expect(await fetchTbaMatchRoster('2026casj_qm1', 'key', failing)).toBeNull();
  });

  it('returns null on a non-ok response', async () => {
    const notFound = async () => ({ ok: false });
    expect(await fetchTbaMatchRoster('2026casj_qm1', 'key', notFound)).toBeNull();
  });

  it('parses a successful response', async () => {
    const ok = async () => ({ ok: true, json: async () => ({ alliances: { red: { team_keys: ['frc971'] }, blue: { team_keys: ['frc254'] } } }) });
    const roster = await fetchTbaMatchRoster('2026casj_qm1', 'key', ok);
    expect(roster.red).toEqual(['frc971']);
  });
});
