// Central permission definitions and helpers
export const PERMISSIONS = [
  'CREATE_SUBSYSTEMS',
  'CREATE_BUILDS',
  'APPROVE_PURCHASES',
  'PLACE_ORDERS_MISC',
  'BAN_USERS',
  'PROMOTE_USERS',
  'APPROVE_USERS',
  'CAN_SEE_ROUTES',
  'EDIT_PERMISSIONS',
  'VIEW_ADMIN_PANEL',
  'VIEW_PURCHASING_ADMIN',
  'ADD_VENDORS',
  'EDIT_BUDGETS',
  // Scouting system permissions
  'NOTE_SCOUT_ADMIN', // can manage note scouting assignments
  'DATA_SCOUT_ADMIN', // can manage data scouting assignments
  'DATA_SCOUT_MEMBER', // eligible to be assigned to data scouting
  'VIDEO_SCOUT_MEMBER', // eligible for future video scouting workflows
  'MANAGE_ATTENDANCE'
];

export const GENERAL_ROLES = {
  NONE: 'none',
  MEMBER: 'member',
  SUBSYSTEM_LEAD: 'subsystem_lead',
  LEAD: 'lead'
};

export const PURCHASING_ROLES = {
  BASIC: 'basic',
  APPROVER: 'approver',
  LEAD: 'lead',
  BUDGETING: 'budgeting'
};

export const TEAM_ROLES = {
  COMPETITION_LEAD: 'Competition Lead',
  MECHANICAL_LEAD: 'Mechanical Lead',
  SOFTWARE_LEAD: 'Software Lead',
  MANUFACTURING_LEAD: 'Manufacturing Lead',
  MANUFACTURING_MEMBER: 'Manufacturing Member',
  CAD_MEMBER: 'CAD Member',
  SOFTWARE_MEMBER: 'Software Member',
  OTHER: 'Other'
};

const GENERAL_ROLE_PERMISSIONS = {
  [GENERAL_ROLES.NONE]: [],
  [GENERAL_ROLES.MEMBER]: ['CAN_SEE_ROUTES', 'PLACE_ORDERS_MISC'],
  [GENERAL_ROLES.SUBSYSTEM_LEAD]: ['CAN_SEE_ROUTES', 'PLACE_ORDERS_MISC', 'CREATE_BUILDS', 'CREATE_SUBSYSTEMS'],
  [GENERAL_ROLES.LEAD]: ['CAN_SEE_ROUTES', 'PLACE_ORDERS_MISC', 'CREATE_BUILDS', 'CREATE_SUBSYSTEMS', 'VIEW_ADMIN_PANEL', 'PROMOTE_USERS', 'APPROVE_USERS', 'EDIT_PERMISSIONS']
};

const PURCHASING_ROLE_PERMISSIONS = {
  [PURCHASING_ROLES.BASIC]: ['PLACE_ORDERS_MISC'],
  [PURCHASING_ROLES.APPROVER]: ['PLACE_ORDERS_MISC', 'APPROVE_PURCHASES'],
  [PURCHASING_ROLES.LEAD]: ['PLACE_ORDERS_MISC', 'APPROVE_PURCHASES', 'VIEW_PURCHASING_ADMIN', 'ADD_VENDORS'],
  [PURCHASING_ROLES.BUDGETING]: ['EDIT_BUDGETS']
};

const ROSTER_KEY_PERMISSIONS = {
  'Video Scout Member': ['VIDEO_SCOUT_MEMBER'],
  'Data Scout Member': ['DATA_SCOUT_MEMBER'],
  'Video Scout Lead': [], // Add if needed
  'Data Scout Lead': ['DATA_SCOUT_ADMIN', 'NOTE_SCOUT_ADMIN']
};

export function hasPermission(user, perm) {
  if (!user) return false;
  // role === 'admin' is a superuser (legacy support)
  if (user.role === 'admin') return true;

  // Check General Role
  const generalRole = user.general_role || GENERAL_ROLES.MEMBER; // Default to member if undefined? Or none?
  if (GENERAL_ROLE_PERMISSIONS[generalRole]?.includes(perm)) return true;

  // Check Purchasing Role
  const purchasingRole = user.purchasing_role || PURCHASING_ROLES.BASIC;
  if (PURCHASING_ROLE_PERMISSIONS[purchasingRole]?.includes(perm)) return true;

  // Check Roster Permissions (assuming user.roster_keys is an array of strings)
  if (user.roster_keys && Array.isArray(user.roster_keys)) {
    for (const key of user.roster_keys) {
      if (ROSTER_KEY_PERMISSIONS[key]?.includes(perm)) return true;
    }
  }

  // Legacy permissions array check
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

export function normalizePermissions(arr) {
  if (!arr) return [];
  if (Array.isArray(arr)) return arr.map(String);
  return [String(arr)];
}
