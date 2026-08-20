import { describe, it, expect, vi, afterEach } from 'vitest';
import { todayDriveDateFolderName } from './drive_watcher.js';

describe('todayDriveDateFolderName', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('formats as YYYY-MM-DD', () => {
    expect(todayDriveDateFolderName()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('uses Pacific time, not server/UTC time - a moment that is already "tomorrow" in UTC can still be "today" in Pacific', () => {
    // 2026-08-21 03:00 UTC = 2026-08-20 20:00 PDT (UTC-7) - past midnight UTC,
    // but still Thursday evening on the west coast. If this ever used the
    // server's local/UTC date instead of PACIFIC_TIME_ZONE, a job delivered
    // in the evening would silently land in tomorrow's folder instead of
    // today's - the exact bug this test pins down.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T03:00:00Z'));
    expect(todayDriveDateFolderName()).toBe('2026-08-20');
  });

  it('rolls over correctly right after Pacific midnight', () => {
    // 2026-08-21 07:01 UTC = 2026-08-21 00:01 PDT - just past midnight Pacific.
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-21T07:01:00Z'));
    expect(todayDriveDateFolderName()).toBe('2026-08-21');
  });
});
