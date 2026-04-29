export const PLANNER_ROUTE = '/planner';
export const PLANNER_TIME_ZONE = 'America/Los_Angeles';
export const PLANNER_SLOT_MINUTES = 30;
export const PLANNER_DEFAULT_TASK_DURATION_MINUTES = 120;
export const PLANNER_DEFAULT_MIN_DURATION_MINUTES = 30;
export const PLANNER_TIME_FORMAT_STEP = '1800';
export const PLANNER_DRIVE_PRACTICE_CATEGORY = 'drive_practice';
export const PLANNER_STANDARD_TASK_MODE = 'standard';
export const PLANNER_FIXING_TASK_MODE = 'fixing';
export const PLANNER_AUTO_FIXING_TASK_DAYS = 3;
export const PLANNER_NOT_STARTED_STATUS = 'not_started';
export const PLANNER_DEFAULT_TASK_STATUS = PLANNER_NOT_STARTED_STATUS;
export const PLANNER_DEFAULT_MILESTONE_STATUS = 'green';
export const PLANNER_DEFAULT_P0_BUG_STATUS = 'red';

export const PLANNER_ITEM_KINDS = ['task', 'milestone'];
export const PLANNER_ITEM_TYPES = ['task', 'milestone', 'drive_practice_session', 'p0_bug', 'fixing_block'];
export const PLANNER_WORK_CATEGORIES = ['assembly', 'electrical', 'software', 'manufacturing', 'cad'];
export const PLANNER_CATEGORIES = [...PLANNER_WORK_CATEGORIES, PLANNER_DRIVE_PRACTICE_CATEGORY];
export const PLANNER_STATUSES = [PLANNER_NOT_STARTED_STATUS, 'green', 'yellow', 'red', 'completed'];
export const PLANNER_P0_BUG_STATUSES = ['red', 'yellow', 'green', 'completed'];
export const PLANNER_ROLLUP_STATUSES = ['green', 'yellow', 'red'];
export const PLANNER_CRITICAL_LEVELS = [1, 2, 3, 4];
export const PLANNER_RULE_TYPES = ['work_window', 'blocked'];
export const PLANNER_TASK_MODES = [PLANNER_STANDARD_TASK_MODE, PLANNER_FIXING_TASK_MODE];

export const PLANNER_STATUS_META = {
  [PLANNER_NOT_STARTED_STATUS]: {
    label: 'Not Started',
    tone: 'pending'
  },
  green: {
    label: 'Green',
    tone: 'healthy'
  },
  yellow: {
    label: 'Yellow',
    tone: 'watch'
  },
  red: {
    label: 'Red',
    tone: 'risk'
  },
  completed: {
    label: 'Completed',
    tone: 'done'
  }
};

export const PLANNER_CRITICAL_LABELS = {
  1: 'Mission critical',
  2: 'High priority',
  3: 'Standard priority',
  4: 'Additional'
};

export const PLANNER_CATEGORY_LABELS = {
  assembly: 'Assembly',
  electrical: 'Electrical',
  software: 'Software',
  manufacturing: 'Manufacturing',
  cad: 'CAD',
  [PLANNER_DRIVE_PRACTICE_CATEGORY]: 'Drive Practice'
};

export const PLANNER_TASK_MODE_LABELS = {
  [PLANNER_STANDARD_TASK_MODE]: 'Task',
  [PLANNER_FIXING_TASK_MODE]: 'Fixing'
};

export const PLANNER_REACTION_TO_STATUS = {
  red_circle: 'red',
  large_yellow_circle: 'yellow',
  yellow_circle: 'yellow',
  large_green_circle: 'green',
  green_circle: 'green',
  white_circle: 'not_started',
  white_check_mark: 'completed'
};

export const PLANNER_STATUS_TO_REACTION = {
  red: 'red_circle',
  yellow: 'large_yellow_circle',
  green: 'large_green_circle',
  not_started: 'white_circle',
  completed: 'white_check_mark'
};

export const DEFAULT_PLANNER_CALENDAR_RULES = [
  { weekday: 3, starts_at: '16:00', ends_at: '21:30', label: 'Wednesday Work Window', rule_type: 'work_window', enabled: true, is_default: true },
  { weekday: 4, starts_at: '16:00', ends_at: '21:30', label: 'Thursday Work Window', rule_type: 'work_window', enabled: true, is_default: true },
  { weekday: 5, starts_at: '15:00', ends_at: '23:00', label: 'Friday Work Window', rule_type: 'work_window', enabled: true, is_default: true },
  { weekday: 6, starts_at: '12:00', ends_at: '23:00', label: 'Saturday Work Window', rule_type: 'work_window', enabled: true, is_default: true },
  { weekday: 0, starts_at: '12:00', ends_at: '21:30', label: 'Sunday Work Window', rule_type: 'work_window', enabled: true, is_default: true }
];

export function plannerItemType(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PLANNER_ITEM_TYPES.includes(normalized) ? normalized : 'task';
}

export function plannerItemKind(item) {
  if (plannerItemType(item?.item_type) === 'milestone') return 'milestone';
  return String(item?.kind || '').trim().toLowerCase() === 'milestone' ? 'milestone' : 'task';
}

export function plannerItemTaskMode(item) {
  if (plannerItemType(item?.item_type) === 'fixing_block') return PLANNER_FIXING_TASK_MODE;
  return String(item?.task_mode || '').trim().toLowerCase() === PLANNER_FIXING_TASK_MODE
    ? PLANNER_FIXING_TASK_MODE
    : PLANNER_STANDARD_TASK_MODE;
}

export function plannerItemCategory(item) {
  if (plannerItemType(item?.item_type) === 'drive_practice_session') {
    return PLANNER_DRIVE_PRACTICE_CATEGORY;
  }
  return item?.work_category || item?.category || null;
}

export function isPlannerMilestone(item) {
  return plannerItemType(item?.item_type) === 'milestone';
}

export function isPlannerP0Bug(item) {
  return plannerItemType(item?.item_type) === 'p0_bug';
}

export function isPlannerDrivePracticeTask(item) {
  return plannerItemType(item?.item_type) === 'drive_practice_session'
    || (item?.kind === 'task' && item?.category === PLANNER_DRIVE_PRACTICE_CATEGORY);
}

export function isPlannerFixingTask(item) {
  return plannerItemType(item?.item_type) === 'fixing_block'
    || (item?.kind === 'task' && item?.task_mode === PLANNER_FIXING_TASK_MODE);
}

export function isPlannerSchedulableTask(item) {
  return !isPlannerMilestone(item) && !isPlannerP0Bug(item);
}
