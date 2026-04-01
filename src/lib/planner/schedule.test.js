import { describe, expect, it } from 'vitest';
import {
  addWorkingMinutes,
  buildCheckpointTimes,
  buildTaskPromptSchedule,
  detectCycleIfDependencyAdded,
  nextWorkMoment,
  recomputePlannerSchedule,
  workingMinutesBetween
} from './schedule.js';
import { DEFAULT_PLANNER_CALENDAR_RULES } from './constants.js';

describe('planner schedule utilities', () => {
  it('moves work into the next default work window', () => {
    const mondayNoon = new Date(2026, 2, 30, 12, 0, 0, 0);
    const next = nextWorkMoment(mondayNoon, DEFAULT_PLANNER_CALENDAR_RULES);
    expect(next.getDay()).toBe(3);
    expect(next.getHours()).toBe(16);
    expect(next.getMinutes()).toBe(0);
  });

  it('adds working minutes across multiple work windows', () => {
    const wednesday = new Date(2026, 3, 1, 20, 0, 0, 0);
    const end = addWorkingMinutes(wednesday, 180, DEFAULT_PLANNER_CALENDAR_RULES);
    expect(end.getDay()).toBe(4);
    expect(end.getHours()).toBe(17);
    expect(end.getMinutes()).toBe(30);
  });

  it('counts working minutes across gaps correctly', () => {
    const start = new Date(2026, 3, 1, 20, 0, 0, 0);
    const end = new Date(2026, 3, 2, 17, 30, 0, 0);
    expect(workingMinutesBetween(start, end, DEFAULT_PLANNER_CALENDAR_RULES)).toBe(180);
  });

  it('treats drive practice like blocked time in the work calendar', () => {
    const rules = [
      { weekday: 3, starts_at: '16:00', ends_at: '21:00', label: 'Shop Hours', rule_type: 'work_window', enabled: true },
      { weekday: 3, starts_at: '18:00', ends_at: '19:00', label: 'Drive Practice', rule_type: 'drive_practice', enabled: true }
    ];
    const start = new Date(2026, 3, 1, 16, 0, 0, 0);
    const end = new Date(2026, 3, 1, 21, 0, 0, 0);
    expect(workingMinutesBetween(start, end, rules)).toBe(240);
  });

  it('keeps requested durations stable even when a pinned milestone has slack', () => {
    const items = [
      {
        id: 'A',
        kind: 'task',
        title: 'Prep',
        critical_level: 1,
        duration_minutes: 120,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 16, 0, 0, 0).toISOString(),
        sort_order: 0
      },
      {
        id: 'B',
        kind: 'task',
        title: 'Buffer',
        critical_level: 4,
        duration_minutes: 120,
        min_duration_minutes: 60,
        sort_order: 1000
      },
      {
        id: 'M',
        kind: 'milestone',
        title: 'Pinned milestone',
        critical_level: 1,
        manual_start_at: new Date(2026, 3, 1, 21, 0, 0, 0).toISOString(),
        sort_order: 2000
      }
    ];
    const dependencies = [
      { predecessor_item_id: 'A', successor_item_id: 'B' },
      { predecessor_item_id: 'B', successor_item_id: 'M' }
    ];

    const result = recomputePlannerSchedule(items, dependencies, [], {
      now: new Date(2026, 3, 1, 12, 0, 0, 0)
    });

    const taskA = result.items.find((item) => item.id === 'A');
    const taskB = result.items.find((item) => item.id === 'B');
    const milestone = result.items.find((item) => item.id === 'M');

    expect(taskA.duration_minutes).toBe(120);
    expect(taskB.requested_duration_minutes).toBe(120);
    expect(taskB.duration_minutes).toBe(120);
    expect(new Date(taskB.scheduled_end_at).getTime()).toBeLessThan(new Date(milestone.manual_start_at).getTime());
    expect(new Date(milestone.scheduled_start_at).toISOString()).toBe(new Date(milestone.manual_start_at).toISOString());
  });

  it('keeps requested durations stable between pinned milestones', () => {
    const items = [
      {
        id: 'X',
        kind: 'task',
        title: 'Earlier segment',
        critical_level: 4,
        duration_minutes: 60,
        min_duration_minutes: 30,
        manual_start_at: new Date(2026, 3, 1, 9, 0, 0, 0).toISOString(),
        sort_order: 0
      },
      {
        id: 'P',
        kind: 'milestone',
        title: 'Pinned boundary',
        critical_level: 1,
        manual_start_at: new Date(2026, 3, 1, 10, 0, 0, 0).toISOString(),
        sort_order: 1000
      },
      {
        id: 'A',
        kind: 'task',
        title: 'Segment task',
        critical_level: 1,
        duration_minutes: 60,
        min_duration_minutes: 30,
        sort_order: 2000
      },
      {
        id: 'B',
        kind: 'task',
        title: 'Expandable task',
        critical_level: 4,
        duration_minutes: 60,
        min_duration_minutes: 30,
        sort_order: 3000
      },
      {
        id: 'M',
        kind: 'milestone',
        title: 'Later pinned milestone',
        critical_level: 1,
        manual_start_at: new Date(2026, 3, 1, 14, 0, 0, 0).toISOString(),
        sort_order: 4000
      }
    ];
    const dependencies = [
      { predecessor_item_id: 'X', successor_item_id: 'P' },
      { predecessor_item_id: 'P', successor_item_id: 'A' },
      { predecessor_item_id: 'A', successor_item_id: 'B' },
      { predecessor_item_id: 'B', successor_item_id: 'M' }
    ];

    const result = recomputePlannerSchedule(items, dependencies, [], {
      now: new Date(2026, 3, 1, 8, 0, 0, 0)
    });

    const earlierTask = result.items.find((item) => item.id === 'X');
    const taskA = result.items.find((item) => item.id === 'A');
    const taskB = result.items.find((item) => item.id === 'B');
    const milestone = result.items.find((item) => item.id === 'M');

    expect(earlierTask.duration_minutes).toBe(60);
    expect(taskA.duration_minutes).toBe(60);
    expect(taskB.duration_minutes).toBe(60);
    expect(new Date(taskB.scheduled_end_at).getTime()).toBeLessThan(new Date(milestone.manual_start_at).getTime());
  });

  it('still pulls an unpinned milestone to the dependency finish when work gets shorter', () => {
    const baseItems = [
      {
        id: 'A',
        kind: 'task',
        title: 'A',
        duration_minutes: 240,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 16, 0, 0, 0).toISOString(),
        sort_order: 0
      },
      {
        id: 'M',
        kind: 'milestone',
        title: 'Standard milestone',
        critical_level: 3,
        manual_start_at: new Date(2026, 3, 1, 21, 0, 0, 0).toISOString(),
        sort_order: 1000
      }
    ];
    const dependencies = [{ predecessor_item_id: 'A', successor_item_id: 'M' }];
    const now = new Date(2026, 3, 1, 12, 0, 0, 0);

    const initial = recomputePlannerSchedule(baseItems, dependencies, [], { now });
    const shortened = recomputePlannerSchedule([
      { ...baseItems[0], duration_minutes: 120 },
      baseItems[1]
    ], dependencies, [], { now });

    const initialTask = initial.items.find((item) => item.id === 'A');
    const initialMilestone = initial.items.find((item) => item.id === 'M');
    const shortenedTask = shortened.items.find((item) => item.id === 'A');
    const shortenedMilestone = shortened.items.find((item) => item.id === 'M');

    expect(new Date(initialMilestone.scheduled_start_at).getTime()).toBe(new Date(initialTask.scheduled_end_at).getTime());
    expect(new Date(shortenedMilestone.scheduled_start_at).getTime()).toBe(new Date(shortenedTask.scheduled_end_at).getTime());
    expect(new Date(shortenedMilestone.scheduled_start_at).getTime()).toBeLessThan(new Date(baseItems[1].manual_start_at).getTime());
  });

  it('keeps task durations stable when a pinned milestone is late', () => {
    const items = [
      {
        id: 'A',
        kind: 'task',
        title: 'A',
        critical_level: 3,
        duration_minutes: 120,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 8, 0, 0, 0).toISOString(),
        sort_order: 0
      },
      {
        id: 'B',
        kind: 'task',
        title: 'B',
        critical_level: 4,
        duration_minutes: 120,
        min_duration_minutes: 60,
        sort_order: 1000
      },
      {
        id: 'M',
        kind: 'milestone',
        title: 'M',
        critical_level: 1,
        manual_start_at: new Date(2026, 3, 1, 11, 0, 0, 0).toISOString(),
        sort_order: 2000
      }
    ];
    const dependencies = [
      { predecessor_item_id: 'A', successor_item_id: 'B' },
      { predecessor_item_id: 'B', successor_item_id: 'M' }
    ];

    const result = recomputePlannerSchedule(items, dependencies, [], {
      now: new Date(2026, 3, 1, 7, 0, 0, 0)
    });

    const taskA = result.items.find((item) => item.id === 'A');
    const taskB = result.items.find((item) => item.id === 'B');
    const milestone = result.items.find((item) => item.id === 'M');

    expect(taskA.duration_minutes).toBe(120);
    expect(taskB.duration_minutes).toBe(120);
    expect(new Date(milestone.scheduled_start_at).toISOString()).toBe(new Date(milestone.manual_start_at).toISOString());
    expect(result.warnings.some((warning) => warning.includes('Critical path warning'))).toBe(true);
  });

  it('keeps requested durations stable for mixed-priority paths when a pinned milestone is late', () => {
    const items = [
      {
        id: 'A',
        kind: 'task',
        title: 'Level 2 task',
        critical_level: 2,
        duration_minutes: 120,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 8, 0, 0, 0).toISOString(),
        sort_order: 0
      },
      {
        id: 'B',
        kind: 'task',
        title: 'Level 3 task',
        critical_level: 3,
        duration_minutes: 120,
        min_duration_minutes: 60,
        sort_order: 1000
      },
      {
        id: 'M',
        kind: 'milestone',
        title: 'Mission critical milestone',
        critical_level: 1,
        manual_start_at: new Date(2026, 3, 1, 10, 30, 0, 0).toISOString(),
        sort_order: 2000
      }
    ];
    const dependencies = [
      { predecessor_item_id: 'A', successor_item_id: 'B' },
      { predecessor_item_id: 'B', successor_item_id: 'M' }
    ];

    const result = recomputePlannerSchedule(items, dependencies, [], {
      now: new Date(2026, 3, 1, 7, 0, 0, 0)
    });

    const taskA = result.items.find((item) => item.id === 'A');
    const taskB = result.items.find((item) => item.id === 'B');
    const milestone = result.items.find((item) => item.id === 'M');

    expect(taskA.duration_minutes).toBe(120);
    expect(taskB.duration_minutes).toBe(120);
    expect(new Date(milestone.scheduled_start_at).toISOString()).toBe(new Date(milestone.manual_start_at).toISOString());
    expect(result.warnings.some((warning) => warning.includes('Critical path warning'))).toBe(true);
  });

  it('restores previously compressed tasks back to their requested duration on recompute', () => {
    const items = [
      {
        id: 'A',
        kind: 'task',
        title: 'A',
        duration_minutes: 60,
        requested_duration_minutes: 300,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 16, 0, 0, 0).toISOString(),
        sort_order: 0
      }
    ];
    const now = new Date(2026, 3, 1, 12, 0, 0, 0);

    const expanded = recomputePlannerSchedule(items, [], DEFAULT_PLANNER_CALENDAR_RULES, { now });
    const expandedTask = expanded.items.find((item) => item.id === 'A');

    expect(expandedTask.requested_duration_minutes).toBe(300);
    expect(expandedTask.duration_minutes).toBe(300);
  });

  it('keeps requested starts dependency-aware', () => {
    const items = [
      {
        id: 'A',
        kind: 'task',
        title: 'A',
        duration_minutes: 120,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 16, 0, 0, 0).toISOString()
      },
      {
        id: 'B',
        kind: 'task',
        title: 'B',
        duration_minutes: 120,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 17, 0, 0, 0).toISOString()
      }
    ];
    const dependencies = [{ predecessor_item_id: 'A', successor_item_id: 'B' }];

    const result = recomputePlannerSchedule(items, dependencies, DEFAULT_PLANNER_CALENDAR_RULES, {
      now: new Date(2026, 3, 1, 12, 0, 0, 0)
    });

    const taskA = result.items.find((item) => item.id === 'A');
    const taskB = result.items.find((item) => item.id === 'B');

    expect(new Date(taskB.scheduled_start_at).getTime()).toBe(new Date(taskA.scheduled_end_at).getTime());
  });

  it('keeps requested-start tasks at their requested duration and warns when a pinned milestone slips', () => {
    const items = [
      {
        id: 'A',
        kind: 'task',
        title: 'Requested start task',
        critical_level: 2,
        duration_minutes: 120,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 16, 0, 0, 0).toISOString(),
        sort_order: 0
      },
      {
        id: 'M',
        kind: 'milestone',
        title: 'Anchor',
        critical_level: 1,
        manual_start_at: new Date(2026, 3, 1, 17, 0, 0, 0).toISOString(),
        sort_order: 1000
      }
    ];
    const dependencies = [{ predecessor_item_id: 'A', successor_item_id: 'M' }];

    const result = recomputePlannerSchedule(items, dependencies, DEFAULT_PLANNER_CALENDAR_RULES, {
      now: new Date(2026, 3, 1, 12, 0, 0, 0)
    });

    const task = result.items.find((item) => item.id === 'A');
    const milestone = result.items.find((item) => item.id === 'M');

    expect(task.duration_minutes).toBe(120);
    expect(new Date(task.scheduled_end_at).toISOString()).toBe(new Date(2026, 3, 1, 18, 0, 0, 0).toISOString());
    expect(new Date(milestone.scheduled_start_at).toISOString()).toBe(new Date(milestone.manual_start_at).toISOString());
    expect(result.warnings.some((warning) => warning.includes('Critical path warning'))).toBe(true);
  });

  it('never rewrites task durations or milestone targets when a pinned milestone is late', () => {
    const items = [
      {
        id: 'A',
        kind: 'task',
        title: 'Protected level 1 task',
        critical_level: 1,
        duration_minutes: 120,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 8, 0, 0, 0).toISOString(),
        sort_order: 0
      },
      {
        id: 'B',
        kind: 'task',
        title: 'Shrinkable level 4 task',
        critical_level: 4,
        duration_minutes: 120,
        min_duration_minutes: 60,
        sort_order: 1000
      },
      {
        id: 'M',
        kind: 'milestone',
        title: 'Pinned mission critical milestone',
        critical_level: 1,
        manual_start_at: new Date(2026, 3, 1, 10, 30, 0, 0).toISOString(),
        sort_order: 2000
      }
    ];
    const dependencies = [
      { predecessor_item_id: 'A', successor_item_id: 'B' },
      { predecessor_item_id: 'B', successor_item_id: 'M' }
    ];

    const result = recomputePlannerSchedule(items, dependencies, [], {
      now: new Date(2026, 3, 1, 7, 0, 0, 0)
    });

    const taskA = result.items.find((item) => item.id === 'A');
    const taskB = result.items.find((item) => item.id === 'B');
    const milestone = result.items.find((item) => item.id === 'M');

    expect(taskA.duration_minutes).toBe(120);
    expect(taskB.duration_minutes).toBe(120);
    expect(new Date(milestone.manual_start_at).toISOString()).toBe(new Date(2026, 3, 1, 10, 30, 0, 0).toISOString());
    expect(new Date(milestone.scheduled_start_at).toISOString()).toBe(new Date(milestone.manual_start_at).toISOString());
    expect(result.warnings.some((warning) => warning.includes('Critical path warning'))).toBe(true);
  });

  it('pulls an unanchored milestone earlier when its dependency gets shorter', () => {
    const baseItems = [
      {
        id: 'A',
        kind: 'task',
        title: 'A',
        duration_minutes: 240,
        min_duration_minutes: 60,
        manual_start_at: new Date(2026, 3, 1, 16, 0, 0, 0).toISOString(),
        sort_order: 0
      },
      {
        id: 'M',
        kind: 'milestone',
        title: 'Follow milestone',
        critical_level: 3,
        manual_start_at: null,
        sort_order: 1000
      }
    ];
    const dependencies = [{ predecessor_item_id: 'A', successor_item_id: 'M' }];
    const now = new Date(2026, 3, 1, 12, 0, 0, 0);

    const initial = recomputePlannerSchedule(baseItems, dependencies, DEFAULT_PLANNER_CALENDAR_RULES, { now });
    const shortened = recomputePlannerSchedule([
      { ...baseItems[0], duration_minutes: 120 },
      baseItems[1]
    ], dependencies, DEFAULT_PLANNER_CALENDAR_RULES, { now });

    const initialTask = initial.items.find((item) => item.id === 'A');
    const initialMilestone = initial.items.find((item) => item.id === 'M');
    const shortenedTask = shortened.items.find((item) => item.id === 'A');
    const shortenedMilestone = shortened.items.find((item) => item.id === 'M');

    expect(new Date(initialMilestone.scheduled_start_at).getTime()).toBe(new Date(initialTask.scheduled_end_at).getTime());
    expect(new Date(shortenedMilestone.scheduled_start_at).getTime()).toBe(new Date(shortenedTask.scheduled_end_at).getTime());
    expect(new Date(shortenedMilestone.scheduled_start_at).getTime()).toBeLessThan(new Date(initialMilestone.scheduled_start_at).getTime());
  });

  it('builds start midpoint and end checkpoints', () => {
    const item = {
      id: 'task-1',
      kind: 'task',
      duration_minutes: 240,
      scheduled_start_at: new Date(2026, 3, 1, 16, 0, 0, 0).toISOString(),
      scheduled_end_at: new Date(2026, 3, 1, 20, 0, 0, 0).toISOString()
    };
    const checkpoints = buildCheckpointTimes(item, DEFAULT_PLANNER_CALENDAR_RULES);
    expect(checkpoints).toBeTruthy();
    expect(checkpoints.start.getHours()).toBe(16);
    expect(checkpoints.midpoint.getHours()).toBe(18);
    expect(checkpoints.end.getHours()).toBe(20);
  });

  it('builds meeting-based prompt checkpoints for multi-day tasks', () => {
    const item = {
      id: 'task-2',
      kind: 'task',
      duration_minutes: 180,
      scheduled_start_at: new Date(2026, 3, 1, 20, 0, 0, 0).toISOString(),
      scheduled_end_at: new Date(2026, 3, 2, 17, 30, 0, 0).toISOString()
    };

    const prompts = buildTaskPromptSchedule(item, DEFAULT_PLANNER_CALENDAR_RULES);

    expect(prompts.map((prompt) => prompt.checkpoint)).toEqual([
      'task_start',
      'session_midpoint',
      'session_end',
      'session_start',
      'session_midpoint',
      'task_end'
    ]);
    expect(prompts[0].scheduled_for.toISOString()).toBe(new Date(2026, 3, 1, 20, 0, 0, 0).toISOString());
    expect(prompts[1].scheduled_for.toISOString()).toBe(new Date(2026, 3, 1, 20, 45, 0, 0).toISOString());
    expect(prompts[2].scheduled_for.toISOString()).toBe(new Date(2026, 3, 1, 21, 30, 0, 0).toISOString());
    expect(prompts[3].scheduled_for.toISOString()).toBe(new Date(2026, 3, 2, 16, 0, 0, 0).toISOString());
    expect(prompts[4].scheduled_for.toISOString()).toBe(new Date(2026, 3, 2, 16, 45, 0, 0).toISOString());
    expect(prompts[5].scheduled_for.toISOString()).toBe(new Date(2026, 3, 2, 17, 30, 0, 0).toISOString());
  });

  it('only pings at the end for drive practice tasks', () => {
    const item = {
      id: 'task-drive-practice',
      kind: 'task',
      category: 'drive_practice',
      duration_minutes: 180,
      scheduled_start_at: new Date(2026, 3, 1, 20, 0, 0, 0).toISOString(),
      scheduled_end_at: new Date(2026, 3, 2, 17, 30, 0, 0).toISOString()
    };

    const prompts = buildTaskPromptSchedule(item, DEFAULT_PLANNER_CALENDAR_RULES);

    expect(prompts).toHaveLength(1);
    expect(prompts[0].checkpoint).toBe('task_end');
    expect(prompts[0].scheduled_for.toISOString()).toBe(new Date(2026, 3, 2, 17, 30, 0, 0).toISOString());
  });

  it('detects cycles before inserting a dependency', () => {
    const items = [{ id: 'A' }, { id: 'B' }, { id: 'C' }];
    const dependencies = [
      { predecessor_item_id: 'A', successor_item_id: 'B' },
      { predecessor_item_id: 'B', successor_item_id: 'C' }
    ];
    expect(detectCycleIfDependencyAdded(items, dependencies, 'C', 'A')).toBe(true);
    expect(detectCycleIfDependencyAdded(items, dependencies, 'A', 'C')).toBe(false);
  });
});
