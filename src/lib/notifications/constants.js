export const NOTIFICATION_KEYS = {
  SHIFT_ASSIGNMENTS: 'shift_assignments',
  PART_ASSIGNMENTS: 'part_assignments',
  MATCH_REMINDERS: 'match_reminders',
  SUBSYSTEM_PARTS_COMPLETE: 'subsystem_parts_complete',
  PURCHASE_APPROVED: 'purchase_approved',
  TASK_ASSIGNED: 'task_assigned',
  TASK_REVIEW_REQUESTED: 'task_review_requested',
  TASK_STATUS_CHANGED: 'task_status_changed',
  TASK_DEADLINE: 'task_deadline'
};

export const DEFAULT_NOTIFICATION_SETTINGS = {
  [NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS]: true,
  [NOTIFICATION_KEYS.PART_ASSIGNMENTS]: true,
  [NOTIFICATION_KEYS.MATCH_REMINDERS]: true,
  [NOTIFICATION_KEYS.SUBSYSTEM_PARTS_COMPLETE]: true,
  [NOTIFICATION_KEYS.PURCHASE_APPROVED]: true,
  [NOTIFICATION_KEYS.TASK_ASSIGNED]: true,
  [NOTIFICATION_KEYS.TASK_REVIEW_REQUESTED]: true,
  [NOTIFICATION_KEYS.TASK_STATUS_CHANGED]: true,
  [NOTIFICATION_KEYS.TASK_DEADLINE]: true
};

export const NOTIFICATION_UI_OPTIONS = [
  {
    key: NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS,
    label: 'Scouting assignments',
    description: 'Direct DM when you are assigned to a data or note scouting shift.'
  },
  {
    key: NOTIFICATION_KEYS.MATCH_REMINDERS,
    label: 'Match reminders',
    description: 'Reminder DM two minutes before a match you are scheduled to scout.'
  },
  {
    key: NOTIFICATION_KEYS.PART_ASSIGNMENTS,
    label: 'Manufacturing part assignments',
    description: 'Get pinged whenever a manufacturing lead assigns you to a part.'
  },
  {
    key: NOTIFICATION_KEYS.SUBSYSTEM_PARTS_COMPLETE,
    label: 'Subsystem part completed',
    description: 'Notify your subsystem when one of its manufacturing parts is marked complete.'
  },
  {
    key: NOTIFICATION_KEYS.PURCHASE_APPROVED,
    label: 'Purchasing approvals',
    description: 'Alert when a COTS purchase you submitted is approved.'
  },
  {
    key: NOTIFICATION_KEYS.TASK_ASSIGNED,
    label: 'Task assignments',
    description: 'Direct DM when you are assigned a new task.'
  },
  {
    key: NOTIFICATION_KEYS.TASK_REVIEW_REQUESTED,
    label: 'Task review requests',
    description: 'Alert when a task upload is ready for your review.'
  },
  {
    key: NOTIFICATION_KEYS.TASK_STATUS_CHANGED,
    label: 'Task status changes',
    description: 'Notify you when your task status is changed.'
  },
  {
    key: NOTIFICATION_KEYS.TASK_DEADLINE,
    label: 'Task deadline alerts',
    description: 'Remind you when a task deadline has passed and the task is not finished.'
  }
];
