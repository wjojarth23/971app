import { describe, it, expect } from 'vitest';
import { mergeNotificationSettings, isNotificationEnabled } from './settings.js';
import { DEFAULT_NOTIFICATION_SETTINGS, NOTIFICATION_KEYS } from './constants.js';

describe('notification settings helpers', () => {
  it('merges defaults when raw value missing', () => {
    const merged = mergeNotificationSettings(null);
    expect(merged).toStrictEqual(DEFAULT_NOTIFICATION_SETTINGS);
  });

  it('overrides specific keys while preserving others', () => {
    const merged = mergeNotificationSettings({ [NOTIFICATION_KEYS.PART_ASSIGNMENTS]: false });
    expect(merged[NOTIFICATION_KEYS.PART_ASSIGNMENTS]).toBe(false);
    expect(merged[NOTIFICATION_KEYS.MATCH_REMINDERS]).toBe(true);
  });

  it('isNotificationEnabled honors explicit false', () => {
    const enabled = isNotificationEnabled({ [NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS]: false }, NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS);
    expect(enabled).toBe(false);
  });
});
