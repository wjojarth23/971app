import { workingMinutesBetween } from './schedule.js';

function hasOwnValue(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function buildPlannerTaskUpdatePayload(source, eventTask, current, calendarRules = []) {
  if (!source || source.kind !== 'task' || !current?.start || !current?.end) {
    return null;
  }

  const previousStart = toDateOrNull(source.scheduled_start_at || source.manual_start_at);
  const previousEnd = toDateOrNull(
    source.scheduled_end_at || source.scheduled_start_at || source.manual_start_at
  );
  const changedStart = previousStart
    ? previousStart.getTime() !== current.start.getTime()
    : hasOwnValue(eventTask, 'start');
  const changedEnd = previousEnd
    ? previousEnd.getTime() !== current.end.getTime()
    : hasOwnValue(eventTask, 'end');
  const durationMinutes = Math.max(30, workingMinutesBetween(current.start, current.end, calendarRules));
  const currentDurationMinutes = Math.max(30, Number(source.duration_minutes) || 0);

  if (!changedStart && !changedEnd && durationMinutes === currentDurationMinutes) {
    return null;
  }

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
