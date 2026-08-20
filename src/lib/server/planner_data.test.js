import { describe, it, expect } from 'vitest';
import { normalizeP0BugStatus, plannerTeamEnabled } from './planner_data.js';

describe('normalizeP0BugStatus', () => {
  it('passes through the canonical statuses unchanged', () => {
    expect(normalizeP0BugStatus('red')).toBe('red');
    expect(normalizeP0BugStatus('yellow')).toBe('yellow');
    expect(normalizeP0BugStatus('green')).toBe('green');
    expect(normalizeP0BugStatus('completed')).toBe('completed');
  });

  it('maps legacy "done"/"closed" to completed', () => {
    expect(normalizeP0BugStatus('done')).toBe('completed');
    expect(normalizeP0BugStatus('closed')).toBe('completed');
  });

  it('maps "approved" to green', () => {
    expect(normalizeP0BugStatus('approved')).toBe('green');
  });

  it('maps in-progress-ish legacy statuses to yellow', () => {
    expect(normalizeP0BugStatus('in_progress')).toBe('yellow');
    expect(normalizeP0BugStatus('file_uploaded')).toBe('yellow');
    expect(normalizeP0BugStatus('under_review')).toBe('yellow');
  });

  it('maps "open"/"changes_requested" to red', () => {
    expect(normalizeP0BugStatus('open')).toBe('red');
    expect(normalizeP0BugStatus('changes_requested')).toBe('red');
  });

  it('is case- and whitespace-insensitive', () => {
    expect(normalizeP0BugStatus('  DONE  ')).toBe('completed');
    expect(normalizeP0BugStatus('Open')).toBe('red');
  });

  it('falls back to the default ("red") for an unrecognized value', () => {
    expect(normalizeP0BugStatus('some_unknown_status')).toBe('red');
    expect(normalizeP0BugStatus(null)).toBe('red');
  });

  it('honors an explicit fallback override', () => {
    expect(normalizeP0BugStatus('unknown', 'green')).toBe('green');
  });
});

describe('plannerTeamEnabled', () => {
  it('enables the known FRC team numbers', () => {
    expect(plannerTeamEnabled('971')).toBe(true);
    expect(plannerTeamEnabled('9584')).toBe(true);
  });

  it('disables any other team', () => {
    expect(plannerTeamEnabled('254')).toBe(false);
    expect(plannerTeamEnabled(undefined)).toBe(false);
  });
});
