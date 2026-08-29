import { describe, expect, it } from 'vitest';
import {
  cleanProblemText,
  normalizeProblemCreate,
  normalizeProblemStatus,
  normalizeProblemTeamKey
} from './scoutingProblems.js';

describe('scouting problem normalization', () => {
  it('normalizes numeric team numbers', () => {
    expect(normalizeProblemTeamKey(' 971 ')).toBe('frc971');
  });

  it('keeps normalized FRC team keys', () => {
    expect(normalizeProblemTeamKey('FRC971')).toBe('frc971');
  });

  it('rejects team keys without a team number', () => {
    expect(normalizeProblemTeamKey('Ferrari')).toBe('');
  });

  it('requires an event, team, and summary', () => {
    expect(normalizeProblemCreate({ event_key: '2026casf', team_key: '971' })).toBeNull();
  });

  it('normalizes a valid report and defaults unsafe enum values', () => {
    expect(normalizeProblemCreate({
      event_key: ' 2026casf ', team_key: '971', summary: '  Intake jammed  ',
      alliance_color: 'PURPLE', severity: 'catastrophic', source: 'robot'
    })).toMatchObject({
      event_key: '2026casf', team_key: 'frc971', summary: 'Intake jammed',
      alliance_color: null, severity: 'medium', source: 'pit_scout'
    });
  });

  it('accepts match-scout provenance and a real match number', () => {
    expect(normalizeProblemCreate({
      event_key: '2026casf', team_key: 'frc971', summary: 'Disabled',
      source: 'match_scout', match_number: 12, alliance_color: 'red'
    })).toMatchObject({ source: 'match_scout', match_number: 12, alliance_color: 'red' });
  });

  it('rejects invalid status transitions at the input boundary', () => {
    expect(normalizeProblemStatus({ status: 'deleted' })).toBeNull();
  });

  it('accepts and trims a resolution', () => {
    expect(normalizeProblemStatus({ status: 'resolved', resolution_notes: '  Replaced belt  ' }))
      .toEqual({ status: 'resolved', resolution_notes: 'Replaced belt' });
  });

  it('caps untrusted text', () => {
    expect(cleanProblemText('x'.repeat(20), 8)).toHaveLength(8);
  });
});
