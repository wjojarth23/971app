import { workingMinutesBetween } from './schedule.js';

function hasOwnValue(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

export function buildPlannerTaskUpdatePayload(source, eventTask, current, calendarRules = []) {
  if (!source || source.kind !== 'task' || !current?.start || !current?.end) {
    return null;
  }

  const changedStart = hasOwnValue(eventTask, 'start');
  const changedEnd = hasOwnValue(eventTask, 'end');
  const durationMinutes = Math.max(30, workingMinutesBetween(current.start, current.end, calendarRules));
  const currentDurationMinutes = Math.max(30, Number(source.duration_minutes) || 0);

  if (changedEnd && !changedStart) {
    return {
      action: 'update-item',
      item_id: source.id,
      duration_minutes: durationMinutes
    };
  }

  const payload = {
    action: 'update-item',
    item_id: source.id,
    manual_start_at: current.start
  };

  if (durationMinutes !== currentDurationMinutes) {
    payload.duration_minutes = durationMinutes;
  }

  return payload;
}
