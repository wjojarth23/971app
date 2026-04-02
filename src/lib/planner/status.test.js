import { describe, expect, it } from 'vitest';
import { canPlannerReactionUpdateStatus, rollupPlannerStatuses } from './status.js';

describe('planner status rollup', () => {
  it('propagates the worst upstream status recursively', () => {
    const items = [
      { id: 'A', title: 'Prep', status: 'red' },
      { id: 'B', title: 'Assembly', status: 'green' },
      { id: 'M', title: 'Milestone', status: 'green' }
    ];
    const dependencies = [
      { predecessor_item_id: 'A', successor_item_id: 'B' },
      { predecessor_item_id: 'B', successor_item_id: 'M' }
    ];

    const result = rollupPlannerStatuses(items, dependencies);
    const taskB = result.find((item) => item.id === 'B');
    const milestone = result.find((item) => item.id === 'M');

    expect(taskB.raw_status).toBe('green');
    expect(taskB.status).toBe('red');
    expect(taskB.status_is_rolled_up).toBe(true);
    expect(milestone.raw_status).toBe('green');
    expect(milestone.status).toBe('red');
    expect(milestone.status_is_rolled_up).toBe(true);
  });

  it('uses the worst status across multiple dependencies while preserving a worse local status', () => {
    const items = [
      { id: 'A', title: 'Incoming yellow', status: 'yellow' },
      { id: 'B', title: 'Incoming green', status: 'green' },
      { id: 'C', title: 'Local red', status: 'red' },
      { id: 'D', title: 'Downstream', status: 'green' }
    ];
    const dependencies = [
      { predecessor_item_id: 'A', successor_item_id: 'D' },
      { predecessor_item_id: 'B', successor_item_id: 'D' },
      { predecessor_item_id: 'C', successor_item_id: 'D' }
    ];

    const result = rollupPlannerStatuses(items, dependencies);
    const downstream = result.find((item) => item.id === 'D');

    expect(downstream.raw_status).toBe('green');
    expect(downstream.status).toBe('red');
    expect(downstream.status_is_rolled_up).toBe(true);
  });

  it('keeps not started items visibly not started while borrowing the rolled-up tone', () => {
    const items = [
      { id: 'A', title: 'Blocked upstream', status: 'red' },
      { id: 'B', title: 'Has not started', status: 'not_started' }
    ];
    const dependencies = [
      { predecessor_item_id: 'A', successor_item_id: 'B' }
    ];

    const result = rollupPlannerStatuses(items, dependencies);
    const notStarted = result.find((item) => item.id === 'B');

    expect(notStarted.raw_status).toBe('not_started');
    expect(notStarted.status).toBe('not_started');
    expect(notStarted.rolled_up_status).toBe('red');
    expect(notStarted.status_tone).toBe('red');
    expect(notStarted.status_is_rolled_up).toBe(true);
  });

  it('only allows task-start reactions to move items out of not started', () => {
    expect(canPlannerReactionUpdateStatus('not_started', 'task_start')).toBe(true);
    expect(canPlannerReactionUpdateStatus('not_started', 'start')).toBe(true);
    expect(canPlannerReactionUpdateStatus('not_started', 'session_midpoint')).toBe(false);
    expect(canPlannerReactionUpdateStatus('not_started', 'task_end')).toBe(false);
    expect(canPlannerReactionUpdateStatus('green', 'task_end')).toBe(true);
    expect(canPlannerReactionUpdateStatus('completed', 'task_end')).toBe(true);
  });
});
