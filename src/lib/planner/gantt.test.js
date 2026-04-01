import { describe, expect, it } from 'vitest';
import { writable } from 'svelte/store';
import { DataStore } from '@svar-ui/gantt-store';
import { DEFAULT_PLANNER_CALENDAR_RULES } from './constants.js';
import { createPlannerGanttScales, setPlannerGanttCalendarRules } from './gantt.js';

function buildScaleState({ start, end, cellWidth = 48 } = {}) {
  setPlannerGanttCalendarRules(DEFAULT_PLANNER_CALENDAR_RULES);

  const store = new DataStore(writable);
  store.init({
    tasks: [],
    links: [],
    start,
    end,
    scales: createPlannerGanttScales(),
    lengthUnit: 'workslot',
    durationUnit: 'hour',
    cellWidth,
    cellHeight: 42,
    scaleHeight: 36,
    taskTypes: [],
    markers: [],
    autoScale: false,
    selected: [],
    activeTask: null,
    zoom: false,
    baselines: false,
    rollups: false,
    unscheduledTasks: false,
    projectStart: null,
    projectEnd: null,
    calendar: null,
    slack: false,
    undo: false,
    _weekStart: 0,
    splitTasks: false,
    summary: {}
  });

  return store.getState()._scales;
}

describe('planner gantt scales', () => {
  it('keeps day headers aligned with the visible workslots', () => {
    const scales = buildScaleState({
      start: new Date('2026-04-01T16:00:00'),
      end: new Date('2026-04-03T23:00:00')
    });

    const widths = scales.rows[0].cells
      .map((cell) => cell.width)
      .filter((width) => width > 0);

    expect(widths).toEqual([
      11 * 48,
      11 * 48,
      16 * 48
    ]);
  });
});
