import { describe, expect, it } from 'vitest';
import { retentionDaysFrom, selectExpiredRecordings } from './vision_retention.js';

const NOW = Date.parse('2026-08-29T12:00:00Z');
const daysAgo = (days) => new Date(NOW - days * 24 * 60 * 60 * 1000).toISOString();

const view = (overrides = {}) => ({
  id: 'view-1',
  storage_path: 'evt/qm1/recording.mp4',
  recording_deleted_at: null,
  vision_matches: { vision_runs: [{ id: 'run-1', released_at: daysAgo(45) }] },
  ...overrides
});

describe('retentionDaysFrom', () => {
  it('is null unless a positive window is configured', () => {
    expect(retentionDaysFrom({})).toBeNull();
    expect(retentionDaysFrom({ VISION_RECORDING_RETENTION_DAYS: '' })).toBeNull();
    expect(retentionDaysFrom({ VISION_RECORDING_RETENTION_DAYS: '0' })).toBeNull();
    expect(retentionDaysFrom({ VISION_RECORDING_RETENTION_DAYS: '-5' })).toBeNull();
    expect(retentionDaysFrom({ VISION_RECORDING_RETENTION_DAYS: 'soon' })).toBeNull();
  });

  it('reads a configured window', () => {
    expect(retentionDaysFrom({ VISION_RECORDING_RETENTION_DAYS: '30' })).toBe(30);
  });
});

describe('selectExpiredRecordings', () => {
  it('deletes nothing at all when no window is configured', () => {
    expect(selectExpiredRecordings([view()], { retentionDays: null, now: NOW })).toEqual([]);
  });

  it('deletes a recording whose run was released longer ago than the window', () => {
    expect(selectExpiredRecordings([view()], { retentionDays: 30, now: NOW })).toHaveLength(1);
  });

  it('keeps a recording still inside the window', () => {
    const recent = view({ vision_matches: { vision_runs: [{ released_at: daysAgo(3) }] } });
    expect(selectExpiredRecordings([recent], { retentionDays: 30, now: NOW })).toEqual([]);
  });

  it('never deletes a recording whose run was never released', () => {
    // The video is the evidence behind review; an unreleased run means that
    // work is unfinished or was rejected, and either way it still matters.
    const unreleased = view({ vision_matches: { vision_runs: [{ released_at: null }] } });
    expect(selectExpiredRecordings([unreleased], { retentionDays: 1, now: NOW })).toEqual([]);
  });

  it('never deletes a recording for a match with no runs at all', () => {
    const noRuns = view({ vision_matches: { vision_runs: [] } });
    expect(selectExpiredRecordings([noRuns], { retentionDays: 1, now: NOW })).toEqual([]);
  });

  it('measures from the most recent release when a match was released twice', () => {
    const reReleased = view({
      vision_matches: { vision_runs: [{ released_at: daysAgo(90) }, { released_at: daysAgo(2) }] }
    });
    expect(selectExpiredRecordings([reReleased], { retentionDays: 30, now: NOW })).toEqual([]);
  });

  it('skips recordings already deleted, so a rerun is not a no-op loop', () => {
    const done = view({ recording_deleted_at: daysAgo(1) });
    expect(selectExpiredRecordings([done], { retentionDays: 30, now: NOW })).toEqual([]);
  });

  it('skips rows with no stored file', () => {
    expect(selectExpiredRecordings([view({ storage_path: null })], { retentionDays: 30, now: NOW })).toEqual([]);
  });

  it('tolerates missing and malformed input without throwing', () => {
    expect(selectExpiredRecordings(null, { retentionDays: 30, now: NOW })).toEqual([]);
    expect(selectExpiredRecordings([null], { retentionDays: 30, now: NOW })).toEqual([]);
    expect(selectExpiredRecordings([view({ vision_matches: null })], { retentionDays: 30, now: NOW })).toEqual([]);
    const badDate = view({ vision_matches: { vision_runs: [{ released_at: 'not-a-date' }] } });
    expect(selectExpiredRecordings([badDate], { retentionDays: 30, now: NOW })).toEqual([]);
  });
});
