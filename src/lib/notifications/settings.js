import { DEFAULT_NOTIFICATION_SETTINGS } from './constants.js';

export function mergeNotificationSettings(rawSettings) {
  const safe = rawSettings && typeof rawSettings === 'object' && !Array.isArray(rawSettings)
    ? rawSettings
    : {};
  return {
    ...DEFAULT_NOTIFICATION_SETTINGS,
    ...safe
  };
}

export function isNotificationEnabled(rawSettings, key) {
  const merged = mergeNotificationSettings(rawSettings);
  return merged[key] !== false;
}
