import { describe, expect, it } from 'vitest';
import { referenceFromTbaMatch } from './vision_reference.js';

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
