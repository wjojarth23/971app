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
  // 'SPARTAN_PREDICT_ADMIN' removed — predict admin role is no longer used
  'VIEW_ADMIN_PANEL'
];

export function hasPermission(user, perm) {
  if (!user) return false;
  // role === 'admin' is a superuser
  if (user.role === 'admin') return true;
  return Array.isArray(user.permissions) && user.permissions.includes(perm);
}

export function normalizePermissions(arr) {
  if (!arr) return [];
  if (Array.isArray(arr)) return arr.map(String);
  return [String(arr)];
}
