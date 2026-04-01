import { describe, expect, it } from 'vitest';
import { rollupPlannerStatuses } from './status.js';

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
});
