import { workingMinutesBetween } from './schedule.js';

function hasOwnValue(object, key) {
  return !!object && Object.prototype.hasOwnProperty.call(object, key);
}

function toIsoStringOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function toNumberOrNull(value) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : null;
}

function roundToStep(value, step) {
  return Math.round(value / step) * step;
}

function floorToStep(value, step) {
  return Math.floor(value / step) * step;
}

function ceilToStep(value, step) {
  return Math.ceil(value / step) * step;
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function toDateOrNull(value) {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function snapToDirectionalStep(rawValue, baseValue, step) {
  if (!Number.isFinite(rawValue) || !Number.isFinite(baseValue) || !Number.isFinite(step) || step <= 0) {
    return rawValue;
  }
  if (Math.abs(rawValue - baseValue) <= 0.5) return baseValue;
  if (rawValue > baseValue) return ceilToStep(rawValue, step);
  if (rawValue < baseValue) return floorToStep(rawValue, step);
  return baseValue;
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

export function snapPlannerGanttDragDetail(detail, task, dragState = null, options = {}) {
  const gridSize = toNumberOrNull(options?.gridSize);
  if (!detail || !task || !gridSize || gridSize <= 0) {
    return {
      detail: detail ? { ...detail } : detail,
      dragState
    };
  }

  const chartWidth = toNumberOrNull(options?.chartWidth);
  const rawLeft = toNumberOrNull(detail.left);
  const rawWidth = toNumberOrNull(detail.width);
  const baseLeft = toNumberOrNull(dragState?.left) ?? toNumberOrNull(task?.$x) ?? rawLeft;
  const baseWidth = toNumberOrNull(dragState?.width) ?? toNumberOrNull(task?.$w) ?? rawWidth;
  const nextDetail = { ...detail };
  const nextDragState =
    baseLeft === null && baseWidth === null
      ? null
      : { left: baseLeft, width: baseWidth };

  const leftChanged =
    rawLeft !== null &&
    baseLeft !== null &&
    Math.abs(rawLeft - baseLeft) > 0.5;
  const widthChanged =
    rawWidth !== null &&
    baseWidth !== null &&
    Math.abs(rawWidth - baseWidth) > 0.5;

  if (!leftChanged && !widthChanged) {
    return {
      detail: nextDetail,
      dragState: nextDragState
    };
  }

  if (leftChanged && widthChanged && baseLeft !== null && baseWidth !== null) {
    const rightEdge = baseLeft + baseWidth;
    const maxLeft = Math.max(0, rightEdge - gridSize);
    const snappedLeft = clamp(snapToDirectionalStep(rawLeft, baseLeft, gridSize), 0, maxLeft);
    nextDetail.left = snappedLeft;
    nextDetail.width = Math.max(gridSize, rightEdge - snappedLeft);
    return {
      detail: nextDetail,
      dragState: nextDragState
    };
  }

  if (widthChanged && rawWidth !== null) {
    const anchorLeft = rawLeft ?? baseLeft ?? 0;
    const maxWidth =
      chartWidth !== null
        ? Math.max(gridSize, chartWidth - anchorLeft)
        : Number.POSITIVE_INFINITY;
    nextDetail.width = clamp(snapToDirectionalStep(rawWidth, baseWidth, gridSize), gridSize, maxWidth);
    return {
      detail: nextDetail,
      dragState: nextDragState
    };
  }

  if (leftChanged && rawLeft !== null) {
    const maxLeft =
      chartWidth !== null && baseWidth !== null
        ? Math.max(0, chartWidth - baseWidth)
        : Number.POSITIVE_INFINITY;
    nextDetail.left = clamp(snapToDirectionalStep(rawLeft, baseLeft, gridSize), 0, maxLeft);
  }

  return {
    detail: nextDetail,
    dragState: nextDragState
  };
}
