import { PLANNER_DEFAULT_MIN_DURATION_MINUTES, PLANNER_SLOT_MINUTES } from './constants.js';

export const PLANNER_SINGLE_STEP_TASK_TEMPLATE = 'single_step';
export const PLANNER_FULL_CYCLE_TASK_TEMPLATE = 'full_cycle';
export const PLANNER_TASK_TEMPLATES = [
  PLANNER_SINGLE_STEP_TASK_TEMPLATE,
  PLANNER_FULL_CYCLE_TASK_TEMPLATE
];

export const PLANNER_FULL_CYCLE_STEPS = [
  { key: 'cad', label: 'CAD', category: 'cad', default_duration_minutes: 180 },
  { key: 'manufacturing', label: 'Manufacturing', category: 'manufacturing', default_duration_minutes: 180 },
  { key: 'assembly', label: 'Assembly', category: 'assembly', default_duration_minutes: 120 }
];

export const PLANNER_FULL_CYCLE_DEFAULT_TOTAL_MINUTES = PLANNER_FULL_CYCLE_STEPS
  .reduce((sum, step) => sum + step.default_duration_minutes, 0);
export const PLANNER_FULL_CYCLE_MIN_TOTAL_MINUTES = PLANNER_FULL_CYCLE_STEPS.length * PLANNER_SLOT_MINUTES;

function allocateScaledSlots(totalSlots) {
  const weightedSteps = PLANNER_FULL_CYCLE_STEPS.map((step, index) => ({
    ...step,
    index,
    default_slots: step.default_duration_minutes / PLANNER_SLOT_MINUTES
  }));

  const provisional = weightedSteps.map((step) => {
    const exactSlots = totalSlots * (step.default_slots / (PLANNER_FULL_CYCLE_DEFAULT_TOTAL_MINUTES / PLANNER_SLOT_MINUTES));
    return {
      ...step,
      exact_slots: exactSlots,
      allocated_slots: Math.floor(exactSlots),
      remainder: exactSlots - Math.floor(exactSlots)
    };
  });

  let remainingSlots = totalSlots - provisional.reduce((sum, step) => sum + step.allocated_slots, 0);

  while (remainingSlots > 0) {
    provisional
      .slice()
      .sort((left, right) => {
        if (right.remainder !== left.remainder) return right.remainder - left.remainder;
        if (right.default_slots !== left.default_slots) return right.default_slots - left.default_slots;
        return left.index - right.index;
      })
      .slice(0, remainingSlots)
      .forEach((step) => {
        step.allocated_slots += 1;
        remainingSlots -= 1;
      });
  }

  return provisional.map((step) => ({
    key: step.key,
    label: step.label,
    category: step.category,
    duration_minutes: step.allocated_slots * PLANNER_SLOT_MINUTES,
    min_duration_minutes: Math.min(
      step.allocated_slots * PLANNER_SLOT_MINUTES,
      PLANNER_DEFAULT_MIN_DURATION_MINUTES
    )
  }));
}

export function normalizePlannerTaskTemplate(rawValue) {
  const value = String(rawValue || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_');
  return value === PLANNER_FULL_CYCLE_TASK_TEMPLATE
    ? PLANNER_FULL_CYCLE_TASK_TEMPLATE
    : PLANNER_SINGLE_STEP_TASK_TEMPLATE;
}

export function buildFullCycleTaskSteps(totalMinutes) {
  const totalSlots = Math.ceil(Number(totalMinutes || 0) / PLANNER_SLOT_MINUTES);
  if (!Number.isFinite(totalSlots) || totalSlots < PLANNER_FULL_CYCLE_STEPS.length) {
    throw new Error('Full-cycle tasks need at least 1.5 hours total.');
  }

  if (totalSlots < PLANNER_FULL_CYCLE_DEFAULT_TOTAL_MINUTES / PLANNER_SLOT_MINUTES) {
    return allocateScaledSlots(totalSlots);
  }

  const extraMinutes = (totalSlots * PLANNER_SLOT_MINUTES) - PLANNER_FULL_CYCLE_DEFAULT_TOTAL_MINUTES;
  return PLANNER_FULL_CYCLE_STEPS.map((step) => ({
    key: step.key,
    label: step.label,
    category: step.category,
    duration_minutes: step.default_duration_minutes + (step.key === 'cad' ? extraMinutes : 0),
    min_duration_minutes: Math.min(
      step.default_duration_minutes + (step.key === 'cad' ? extraMinutes : 0),
      PLANNER_DEFAULT_MIN_DURATION_MINUTES
    )
  }));
}

export function formatFullCycleTaskTitle(baseTitle, stepLabel) {
  return `${String(baseTitle || '').trim()} - ${stepLabel}`.trim();
}
