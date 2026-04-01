import { describe, expect, it } from 'vitest';
import { buildPlannerTaskUpdatePayload } from './interaction.js';
import { DEFAULT_PLANNER_CALENDAR_RULES } from './constants.js';

describe('planner gantt interaction payloads', () => {
  const start = new Date(2026, 3, 1, 16, 0, 0, 0);
  const end = new Date(2026, 3, 1, 18, 0, 0, 0);

  it('updates requested duration when a task is only resized from the end', () => {
    const payload = buildPlannerTaskUpdatePayload(
      { id: 'task-1', kind: 'task' },
      { end },
      { start, end },
      DEFAULT_PLANNER_CALENDAR_RULES
    );

    expect(payload).toEqual({
      action: 'update-item',
      item_id: 'task-1',
      duration_minutes: 120
    });
  });

  it('updates requested duration when a task is resized from the start handle', () => {
    const payload = buildPlannerTaskUpdatePayload(
      { id: 'task-2b', kind: 'task', duration_minutes: 120 },
      { start: new Date(2026, 3, 1, 16, 30, 0, 0) },
      { start: new Date(2026, 3, 1, 16, 30, 0, 0), end },
      DEFAULT_PLANNER_CALENDAR_RULES
    );

    expect(payload).toEqual({
      action: 'update-item',
      item_id: 'task-2b',
      manual_start_at: new Date(2026, 3, 1, 16, 30, 0, 0),
      duration_minutes: 90
    });
  });

  it('saves a requested start when the task moves', () => {
    const payload = buildPlannerTaskUpdatePayload(
      { id: 'task-3', kind: 'task', duration_minutes: 120 },
      { start, end },
      { start, end },
      DEFAULT_PLANNER_CALENDAR_RULES
    );

    expect(payload).toEqual({
      action: 'update-item',
      item_id: 'task-3',
      manual_start_at: start
    });
  });

  it('does not lock in a compressed duration when a task is only moved', () => {
    const payload = buildPlannerTaskUpdatePayload(
      { id: 'task-4', kind: 'task', duration_minutes: 60, requested_duration_minutes: 120 },
      { start, end: new Date(2026, 3, 1, 17, 0, 0, 0) },
      { start, end: new Date(2026, 3, 1, 17, 0, 0, 0) },
      DEFAULT_PLANNER_CALENDAR_RULES
    );

    expect(payload).toEqual({
      action: 'update-item',
      item_id: 'task-4',
      manual_start_at: start
    });
  });
});
