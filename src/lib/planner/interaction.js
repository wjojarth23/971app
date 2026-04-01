import { workingMinutesBetween } from './schedule.js';

function hasOwnValue(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function toIsoStringOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
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

export function buildPlannerOptimisticItem(source, current, payload = {}) {
  if (!source?.id) return null;

  const nextStart = toIsoStringOrNull(current?.start);
  const nextEnd = toIsoStringOrNull(current?.end);
  const nextItem = { ...source };

  if (source.kind === 'milestone') {
    const milestoneStart = toIsoStringOrNull(payload?.manual_start_at) || nextStart;
    if (!milestoneStart) return nextItem;
    nextItem.manual_start_at = milestoneStart;
    nextItem.scheduled_start_at = milestoneStart;
    nextItem.scheduled_end_at = milestoneStart;
    return nextItem;
  }

  if (nextStart) nextItem.scheduled_start_at = nextStart;
  if (nextEnd) nextItem.scheduled_end_at = nextEnd;

  if (hasOwnValue(payload, 'manual_start_at')) {
    nextItem.manual_start_at = toIsoStringOrNull(payload.manual_start_at);
  }

  if (hasOwnValue(payload, 'duration_minutes')) {
    const durationMinutes = Math.max(30, Number(payload.duration_minutes) || 0);
    nextItem.duration_minutes = durationMinutes;
    nextItem.requested_duration_minutes = durationMinutes;
  }

  return nextItem;
}

export function reorderPlannerItems(items = [], orderedIds = []) {
  const itemMap = new Map((items || []).map((item) => [item.id, item]));
  const seen = new Set();
  const reordered = [];

  for (const itemId of orderedIds || []) {
    if (!itemMap.has(itemId) || seen.has(itemId)) continue;
    reordered.push(itemMap.get(itemId));
    seen.add(itemId);
  }

  for (const item of items || []) {
    if (!item?.id || seen.has(item.id)) continue;
    reordered.push(item);
  }

  return reordered.map((item, index) => ({
    ...item,
    sort_order: index * 1000
  }));
}
