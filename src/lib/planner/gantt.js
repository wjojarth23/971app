import { registerScaleUnit } from '@svar-ui/gantt-store';
import { PLANNER_SLOT_MINUTES, PLANNER_TIME_ZONE } from './constants.js';
import {
  getWorkIntervalsForDate,
  nextWorkMoment,
  toDateOrNull,
  workingMinutesBetween
} from './schedule.js';
import { addPlannerDays, startOfPlannerDay } from './timezone.js';

const SLOT_MINUTES = PLANNER_SLOT_MINUTES;
const SLOT_MS = SLOT_MINUTES * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const ALL_TIMES_WINDOW_START = '08:00';
const ALL_TIMES_WINDOW_END = '12:00';

const dayFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PLANNER_TIME_ZONE,
  weekday: 'short',
  month: 'short',
  day: 'numeric'
});

const slotFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PLANNER_TIME_ZONE,
  hour: 'numeric',
  minute: '2-digit'
});

let activeRules = [];
let workslotRegistered = false;

export const PLANNER_GANTT_TIMELINE_MODES = {
  MEETINGS_ONLY: 'meetings_only',
  ALL_TIMES: 'all_times'
};

export const PLANNER_GANTT_ALL_TIMES_RULES = Array.from({ length: 7 }, (_value, weekday) => ({
  weekday,
  starts_at: ALL_TIMES_WINDOW_START,
  ends_at: ALL_TIMES_WINDOW_END,
  label: 'All Times Window',
  rule_type: 'work_window',
  enabled: true,
  is_default: true
}));

function cloneDate(value) {
  return new Date(value instanceof Date ? value.getTime() : value);
}

function startOfDay(value) {
  return startOfPlannerDay(value) || cloneDate(value);
}

function addMinutes(value, minutes) {
  const date = cloneDate(value);
  date.setMinutes(date.getMinutes() + minutes);
  return date;
}

function addDays(value, days) {
  return addPlannerDays(value, days) || cloneDate(value);
}

function lastSlotStart(interval) {
  const durationMs = Math.max(0, interval.end.getTime() - interval.start.getTime());
  const slotCount = Math.max(1, Math.ceil(durationMs / SLOT_MS));
  return new Date(interval.start.getTime() + (slotCount - 1) * SLOT_MS);
}

function findContainingInterval(value, rules = activeRules) {
  const date = toDateOrNull(value);
  if (!date) return null;
  return getWorkIntervalsForDate(date, rules).find((interval) => date >= interval.start && date < interval.end) || null;
}

function isAlignedWorkslot(value, rules = activeRules) {
  const date = toDateOrNull(value);
  if (!date) return false;
  const interval = findContainingInterval(date, rules);
  if (!interval) return false;
  const diffMs = date.getTime() - interval.start.getTime();
  return diffMs >= 0 && diffMs % SLOT_MS === 0;
}

function nextWorkslotStart(value, rules = activeRules) {
  let cursor = toDateOrNull(value) || new Date();

  for (let guard = 0; guard < 120; guard += 1) {
    const next = nextWorkMoment(cursor, rules);
    const interval = findContainingInterval(next, rules);
    if (!interval) {
      cursor = addDays(startOfDay(cursor), 1);
      continue;
    }

    const diffMinutes = Math.max(0, Math.round((next.getTime() - interval.start.getTime()) / 60000));
    const slotOffset = Math.ceil(diffMinutes / SLOT_MINUTES);
    const candidate = new Date(interval.start.getTime() + slotOffset * SLOT_MS);
    if (candidate < interval.end) return candidate;
    cursor = addMinutes(interval.end, 1);
  }

  return cursor;
}

function previousWorkslotStart(value, rules = activeRules) {
  let cursor = toDateOrNull(value) || new Date();

  for (let guard = 0; guard < 120; guard += 1) {
    const intervals = getWorkIntervalsForDate(cursor, rules);
    for (let index = intervals.length - 1; index >= 0; index -= 1) {
      const interval = intervals[index];
      if (cursor < interval.start) continue;
      if (cursor >= interval.end) return lastSlotStart(interval);

      const diffMinutes = Math.max(0, Math.floor((cursor.getTime() - interval.start.getTime()) / 60000));
      const slotOffset = Math.floor(diffMinutes / SLOT_MINUTES);
      const candidate = new Date(interval.start.getTime() + slotOffset * SLOT_MS);
      if (candidate < interval.end) return candidate;
    }

    cursor = new Date(startOfDay(cursor).getTime() - 1);
  }

  return cursor;
}

function resolveWorkslotAnchor(value, rules = activeRules) {
  const date = toDateOrNull(value) || new Date();
  const interval = findContainingInterval(date, rules);

  if (interval) {
    const diffMinutes = Math.max(0, Math.floor((date.getTime() - interval.start.getTime()) / 60000));
    const slotOffset = Math.floor(diffMinutes / SLOT_MINUTES);
    return new Date(interval.start.getTime() + slotOffset * SLOT_MS);
  }

  return nextWorkslotStart(date, rules);
}

function addWorkslots(value, step) {
  const current = toDateOrNull(value) || new Date();
  if (!step) return current;
  if (!isAlignedWorkslot(current)) {
    return addMinutes(current, step * SLOT_MINUTES);
  }

  if (step > 0) {
    let cursor = previousWorkslotStart(current);
    for (let index = 0; index < step; index += 1) {
      cursor = nextWorkslotStart(addMinutes(cursor, SLOT_MINUTES));
    }
    return cursor;
  }

  let cursor = previousWorkslotStart(current);
  for (let index = 0; index < Math.abs(step); index += 1) {
    cursor = previousWorkslotStart(addMinutes(cursor, -1));
  }
  return cursor;
}

function diffWorkslots(leftValue, rightValue) {
  const left = toDateOrNull(leftValue);
  const right = toDateOrNull(rightValue);
  if (!left || !right) return 0;
  if (left.getTime() === right.getTime()) return 0;

  if (left > right) {
    return Math.round(workingMinutesBetween(right, left, activeRules) / SLOT_MINUTES);
  }

  return -Math.round(workingMinutesBetween(left, right, activeRules) / SLOT_MINUTES);
}

function startWorkslot(value) {
  return resolveWorkslotAnchor(value);
}

function endWorkslot(value) {
  return addWorkslots(resolveWorkslotAnchor(value), 1);
}

function isSameWorkslot(leftValue, rightValue) {
  const left = resolveWorkslotAnchor(leftValue);
  const right = resolveWorkslotAnchor(rightValue);
  return left.getTime() === right.getTime();
}

export function setPlannerGanttCalendarRules(rules = []) {
  activeRules = Array.isArray(rules) ? rules : [];

  if (workslotRegistered) return;

  registerScaleUnit('workslot', {
    start: startWorkslot,
    end: endWorkslot,
    add: addWorkslots,
    diff: diffWorkslots,
    isSame: isSameWorkslot,
    smallerCount: {
      hour: SLOT_MINUTES / 60
    },
    biggerCount: {
      hour: 60 / SLOT_MINUTES
    }
  });

  workslotRegistered = true;
}

export function createPlannerGanttScales(options = {}) {
  const timeScaleStep = Math.max(1, Math.round(Number(options?.timeScaleStep) || 1));

  return [
    {
      unit: 'day',
      step: 1,
      format: (start, end) => {
        const workHours = workingMinutesBetween(start, end, activeRules) / 60;
        const hoursLabel = workHours > 0 ? ` (${workHours % 1 === 0 ? workHours.toFixed(0) : workHours.toFixed(1)}h)` : '';
        return `${dayFormatter.format(start)}${hoursLabel}`;
      }
    },
    {
      unit: 'workslot',
      step: timeScaleStep,
      format: (start) => slotFormatter.format(start)
    }
  ];
}

export const PLANNER_GANTT_ZOOM_LEVELS = [
  { label: 'Close', cellWidth: 100, timeScaleStep: 1 },
  { label: 'Medium', cellWidth: 56, timeScaleStep: 1 },
  { label: 'Wide', cellWidth: 30, timeScaleStep: 2 },
  { label: 'Overview', cellWidth: 16, timeScaleStep: 4 },
  { label: 'Macro', cellWidth: 8, timeScaleStep: 8 }
];

export function getPlannerGanttBounds(items = [], referenceDate = new Date()) {
  const dates = [];

  for (const item of Array.isArray(items) ? items : []) {
    const start = toDateOrNull(item?.scheduled_start_at || item?.manual_start_at);
    const end = item?.kind === 'milestone'
      ? start
      : toDateOrNull(item?.scheduled_end_at || item?.scheduled_start_at || item?.manual_start_at);

    if (start) dates.push(start);
    if (end) dates.push(end);
  }

  const anchor = dates.length
    ? dates.sort((left, right) => left.getTime() - right.getTime())
    : [nextWorkslotStart(referenceDate)];

  const first = previousWorkslotStart(anchor[0]);
  const last = previousWorkslotStart(anchor[anchor.length - 1]);

  return {
    start: addWorkslots(first, -2),
    end: addWorkslots(last, 6)
  };
}

export function getPlannerGanttScaleSpan(startValue, endValue) {
  const start = toDateOrNull(startValue);
  const end = toDateOrNull(endValue);
  if (!start || !end) return 0;
  return Math.max(DAY_MS, Math.abs(end.getTime() - start.getTime()));
}
