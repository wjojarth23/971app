import { describe, expect, it } from 'vitest';
import {
  buildPlannerOptimisticItem,
  buildPlannerTaskUpdatePayload,
  reorderPlannerItems
} from './interaction.js';
import { DEFAULT_PLANNER_CALENDAR_RULES } from './constants.js';

describe('planner gantt interaction payloads', () => {
  const start = new Date(2026, 3, 1, 16, 0, 0, 0);
  const end = new Date(2026, 3, 1, 18, 0, 0, 0);

  it('updates requested duration when a task is only resized from the end', () => {
    const payload = buildPlannerTaskUpdatePayload(
      {
        id: 'task-1',
        kind: 'task',
        scheduled_start_at: start.toISOString(),
        scheduled_end_at: new Date(2026, 3, 1, 17, 0, 0, 0).toISOString()
      },
      { start, end },
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
      {
        id: 'task-2b',
        kind: 'task',
        duration_minutes: 120,
        scheduled_start_at: start.toISOString(),
        scheduled_end_at: end.toISOString()
      },
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
    const movedStart = new Date(2026, 3, 1, 16, 30, 0, 0);
    const movedEnd = new Date(2026, 3, 1, 18, 30, 0, 0);
    const payload = buildPlannerTaskUpdatePayload(
      {
        id: 'task-3',
        kind: 'task',
        duration_minutes: 120,
        scheduled_start_at: start.toISOString(),
        scheduled_end_at: end.toISOString()
      },
      { start: movedStart, end: movedEnd },
      { start: movedStart, end: movedEnd },
      DEFAULT_PLANNER_CALENDAR_RULES
    );

    expect(payload).toEqual({
      action: 'update-item',
      item_id: 'task-3',
      manual_start_at: movedStart
    });
  });

  it('does not lock in a compressed duration when a task is only moved', () => {
    const movedStart = new Date(2026, 3, 1, 16, 30, 0, 0);
    const movedEnd = new Date(2026, 3, 1, 17, 30, 0, 0);
    const payload = buildPlannerTaskUpdatePayload(
      {
        id: 'task-4',
        kind: 'task',
        duration_minutes: 60,
        requested_duration_minutes: 120,
        scheduled_start_at: start.toISOString(),
        scheduled_end_at: new Date(2026, 3, 1, 17, 0, 0, 0).toISOString()
      },
      { start: movedStart, end: movedEnd },
      { start: movedStart, end: movedEnd },
      DEFAULT_PLANNER_CALENDAR_RULES
    );

    expect(payload).toEqual({
      action: 'update-item',
      item_id: 'task-4',
      manual_start_at: movedStart
    });
  });

  it('treats full-task event payloads from the gantt library as an end-only resize when only the end changed', () => {
    const payload = buildPlannerTaskUpdatePayload(
      {
        id: 'task-5',
        kind: 'task',
        duration_minutes: 120,
        scheduled_start_at: start.toISOString(),
        scheduled_end_at: end.toISOString()
      },
      { start, end: new Date(2026, 3, 1, 18, 30, 0, 0) },
      { start, end: new Date(2026, 3, 1, 18, 30, 0, 0) },
      DEFAULT_PLANNER_CALENDAR_RULES
    );

    expect(payload).toEqual({
      action: 'update-item',
      item_id: 'task-5',
      duration_minutes: 150
    });
  });

  it('builds an optimistic task update that keeps the dragged timing visible', () => {
    const movedStart = new Date(2026, 3, 1, 16, 30, 0, 0);
    const movedEnd = new Date(2026, 3, 1, 19, 0, 0, 0);
    const optimistic = buildPlannerOptimisticItem(
      {
        id: 'task-6',
        kind: 'task',
        manual_start_at: null,
        scheduled_start_at: start.toISOString(),
        scheduled_end_at: end.toISOString(),
        duration_minutes: 120,
        requested_duration_minutes: 120
      },
      { start: movedStart, end: movedEnd },
      {
        action: 'update-item',
        item_id: 'task-6',
        manual_start_at: movedStart,
        duration_minutes: 150
      }
    );

    expect(optimistic).toMatchObject({
      id: 'task-6',
      manual_start_at: movedStart.toISOString(),
      scheduled_start_at: movedStart.toISOString(),
      scheduled_end_at: movedEnd.toISOString(),
      duration_minutes: 150,
      requested_duration_minutes: 150
    });
  });

  it('builds an optimistic milestone update from the dragged date', () => {
    const movedStart = new Date(2026, 3, 2, 12, 0, 0, 0);
    const optimistic = buildPlannerOptimisticItem(
      {
        id: 'milestone-1',
        kind: 'milestone',
        manual_start_at: start.toISOString(),
        scheduled_start_at: start.toISOString(),
        scheduled_end_at: start.toISOString()
      },
      { start: movedStart },
      {
        action: 'update-item',
        item_id: 'milestone-1',
        manual_start_at: movedStart
      }
    );

    expect(optimistic).toMatchObject({
      id: 'milestone-1',
      manual_start_at: movedStart.toISOString(),
      scheduled_start_at: movedStart.toISOString(),
      scheduled_end_at: movedStart.toISOString()
    });
  });

  it('reorders planner items while rewriting sort order locally', () => {
    const reordered = reorderPlannerItems(
      [
        { id: 'task-a', sort_order: 0 },
        { id: 'task-b', sort_order: 1000 },
        { id: 'task-c', sort_order: 2000 }
      ],
      ['task-c', 'task-a', 'task-b']
    );

    expect(reordered.map((item) => item.id)).toEqual(['task-c', 'task-a', 'task-b']);
    expect(reordered.map((item) => item.sort_order)).toEqual([0, 1000, 2000]);
  });
});
