import { describe, expect, it } from 'vitest';
import {
  buildFullCycleTaskSteps,
  formatFullCycleTaskTitle,
  normalizePlannerTaskTemplate,
  PLANNER_FULL_CYCLE_TASK_TEMPLATE,
  PLANNER_SINGLE_STEP_TASK_TEMPLATE
} from './multi_step.js';

describe('planner multi-step task helpers', () => {
  it('keeps the default 8-hour full-cycle split at 3/3/2 hours', () => {
    const steps = buildFullCycleTaskSteps(480);

    expect(steps.map((step) => [step.category, step.duration_minutes])).toEqual([
      ['cad', 180],
      ['manufacturing', 180],
      ['assembly', 120]
    ]);
  });

  it('adds any extra time above 8 hours onto CAD', () => {
    const steps = buildFullCycleTaskSteps(600);

    expect(steps.map((step) => [step.category, step.duration_minutes])).toEqual([
      ['cad', 300],
      ['manufacturing', 180],
      ['assembly', 120]
    ]);
  });

  it('scales the three full-cycle steps proportionally below 8 hours', () => {
    const steps = buildFullCycleTaskSteps(300);

    expect(steps.map((step) => [step.category, step.duration_minutes])).toEqual([
      ['cad', 120],
      ['manufacturing', 120],
      ['assembly', 60]
    ]);
  });

  it('rejects totals that cannot give each step at least one slot', () => {
    expect(() => buildFullCycleTaskSteps(60)).toThrow('Full-cycle tasks need at least 1.5 hours total.');
  });

  it('normalizes task templates and formats linked task titles', () => {
    expect(normalizePlannerTaskTemplate('full_cycle')).toBe(PLANNER_FULL_CYCLE_TASK_TEMPLATE);
    expect(normalizePlannerTaskTemplate('FULL CYCLE')).toBe(PLANNER_FULL_CYCLE_TASK_TEMPLATE);
    expect(normalizePlannerTaskTemplate('anything-else')).toBe(PLANNER_SINGLE_STEP_TASK_TEMPLATE);
    expect(formatFullCycleTaskTitle('Shooter rebuild', 'CAD')).toBe('Shooter rebuild - CAD');
  });
});
