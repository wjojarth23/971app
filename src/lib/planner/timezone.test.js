import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parsePlannerDateTimeInput } from './timezone.js';

const testDir = path.dirname(fileURLToPath(import.meta.url));
const scheduleModuleUrl = pathToFileURL(path.join(testDir, 'schedule.js')).href;
const constantsModuleUrl = pathToFileURL(path.join(testDir, 'constants.js')).href;

function runPlannerScheduleInTimeZone(timeZone) {
  const script = `
    const { recomputePlannerSchedule } = await import(${JSON.stringify(scheduleModuleUrl)});
    const { DEFAULT_PLANNER_CALENDAR_RULES } = await import(${JSON.stringify(constantsModuleUrl)});

    const items = [{
      id: 'task-1',
      kind: 'task',
      title: 'DP',
      critical_level: 3,
      duration_minutes: 180,
      requested_duration_minutes: 180,
      min_duration_minutes: 30,
      manual_start_at: '2026-04-03T08:30:00.000Z',
      sort_order: 0
    }];

    const result = recomputePlannerSchedule(items, [], DEFAULT_PLANNER_CALENDAR_RULES, {
      now: '2026-04-01T19:00:00.000Z'
    });
    const task = result.items[0];
    console.log(JSON.stringify({
      scheduled_start_at: task.scheduled_start_at,
      scheduled_end_at: task.scheduled_end_at
    }));
  `;

  return JSON.parse(execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
    env: {
      ...process.env,
      TZ: timeZone
    }
  }));
}

describe('planner timezone handling', () => {
  it('parses planner datetime-local values as Pacific time', () => {
    const parsed = parsePlannerDateTimeInput('2026-04-03T15:00');
    expect(parsed?.toISOString()).toBe('2026-04-03T22:00:00.000Z');
  });

  it('keeps scheduling stable across host timezones', () => {
    const utc = runPlannerScheduleInTimeZone('UTC');
    const pacific = runPlannerScheduleInTimeZone('America/Los_Angeles');

    expect(utc).toEqual(pacific);
    expect(utc).toEqual({
      scheduled_start_at: '2026-04-03T22:00:00.000Z',
      scheduled_end_at: '2026-04-04T01:00:00.000Z'
    });
  });
});
