export const NOTIFICATION_KEYS = {
  SHIFT_ASSIGNMENTS: 'shift_assignments',
  PART_ASSIGNMENTS: 'part_assignments',
  MATCH_REMINDERS: 'match_reminders',
  SUBSYSTEM_PARTS_COMPLETE: 'subsystem_parts_complete',
  PURCHASE_APPROVED: 'purchase_approved'
};

export const DEFAULT_NOTIFICATION_SETTINGS = {
  [NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS]: true,
  [NOTIFICATION_KEYS.PART_ASSIGNMENTS]: true,
  [NOTIFICATION_KEYS.MATCH_REMINDERS]: true,
  [NOTIFICATION_KEYS.SUBSYSTEM_PARTS_COMPLETE]: true,
  [NOTIFICATION_KEYS.PURCHASE_APPROVED]: true
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
  }
];
