export const PLANNER_ROUTE = '/planner';
export const PLANNER_SLOT_MINUTES = 30;
export const PLANNER_DEFAULT_TASK_DURATION_MINUTES = 120;
export const PLANNER_DEFAULT_MIN_DURATION_MINUTES = 30;
export const PLANNER_TIME_FORMAT_STEP = '1800';
export const PLANNER_DRIVE_PRACTICE_CATEGORY = 'drive_practice';
export const PLANNER_STANDARD_TASK_MODE = 'standard';
export const PLANNER_FIXING_TASK_MODE = 'fixing';
export const PLANNER_AUTO_FIXING_TASK_DAYS = 3;

export const PLANNER_ITEM_KINDS = ['task', 'milestone'];
export const PLANNER_CATEGORIES = ['assembly', 'electrical', 'software', 'manufacturing', 'cad', PLANNER_DRIVE_PRACTICE_CATEGORY];
export const PLANNER_STATUSES = ['green', 'yellow', 'red'];
export const PLANNER_CRITICAL_LEVELS = [1, 2, 3, 4];
export const PLANNER_OWNER_TYPES = ['owner', 'accountable'];
export const PLANNER_RULE_TYPES = ['work_window', 'blocked'];
export const PLANNER_TASK_MODES = [PLANNER_STANDARD_TASK_MODE, PLANNER_FIXING_TASK_MODE];

export const PLANNER_STATUS_META = {
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
  yellow_circle: 'yellow',
  green_circle: 'green'
};

export const PLANNER_STATUS_TO_REACTION = {
  red: 'red_circle',
  yellow: 'yellow_circle',
  green: 'green_circle'
};

export const DEFAULT_PLANNER_CALENDAR_RULES = [
  { weekday: 3, starts_at: '16:00', ends_at: '21:30', label: 'Wednesday Work Window', rule_type: 'work_window', enabled: true, is_default: true },
  { weekday: 4, starts_at: '16:00', ends_at: '21:30', label: 'Thursday Work Window', rule_type: 'work_window', enabled: true, is_default: true },
  { weekday: 5, starts_at: '15:00', ends_at: '23:00', label: 'Friday Work Window', rule_type: 'work_window', enabled: true, is_default: true },
  { weekday: 6, starts_at: '12:00', ends_at: '23:00', label: 'Saturday Work Window', rule_type: 'work_window', enabled: true, is_default: true },
  { weekday: 0, starts_at: '12:00', ends_at: '21:30', label: 'Sunday Work Window', rule_type: 'work_window', enabled: true, is_default: true }
];

export function isPlannerDrivePracticeTask(item) {
  return item?.kind === 'task' && item?.category === PLANNER_DRIVE_PRACTICE_CATEGORY;
}

export function isPlannerFixingTask(item) {
  return item?.kind === 'task' && item?.task_mode === PLANNER_FIXING_TASK_MODE;
}
