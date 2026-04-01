import { PLANNER_TIME_ZONE } from '$lib/planner/constants.js';
import {
  formatPlannerDateTimeInputValue,
  parsePlannerDateTimeInput
} from '$lib/planner/timezone.js';

export const PACIFIC_TIME_ZONE = PLANNER_TIME_ZONE;

const formatterCache = new Map();

function normalizeDate(value, { preserveDateOnly = false } = {}) {
  if (preserveDateOnly && typeof value === 'string') {
    const match = value.trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      const [, year, month, day] = match;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), 12, 0, 0, 0));
    }
  }
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

function formatterKey(timeZone, options) {
  const entries = Object.entries(options || {}).sort(([left], [right]) => left.localeCompare(right));
  return `${timeZone}:${JSON.stringify(entries)}`;
}

function getFormatter(timeZone, options = {}) {
  const key = formatterKey(timeZone, options);
  if (!formatterCache.has(key)) {
    formatterCache.set(key, new Intl.DateTimeFormat('en-US', {
      timeZone,
      ...options
    }));
  }
  return formatterCache.get(key);
}

export function formatInTimeZone(value, timeZone = PACIFIC_TIME_ZONE, options = {}) {
  const date = normalizeDate(value);
  if (!date) return '';
  try {
    return getFormatter(timeZone, options).format(date);
  } catch {
    return '';
  }
}

export function formatPacific(value, options = {}) {
  return formatInTimeZone(value, PACIFIC_TIME_ZONE, options);
}

export function formatPacificDate(value, options = {}) {
  const date = normalizeDate(value, { preserveDateOnly: true });
  if (!date) return '';
  try {
    return getFormatter(PACIFIC_TIME_ZONE, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      ...options
    }).format(date);
  } catch {
    return '';
  }
}

export function formatPacificTime(value, options = {}) {
  return formatPacific(value, {
    hour: 'numeric',
    minute: '2-digit',
    ...options
  });
}

export function formatPacificDateTime(value, options = {}) {
  return formatPacific(value, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    ...options
  });
}

export function formatPacificDateWithZone(value, options = {}) {
  const formatted = formatPacificDate(value, options);
  return formatted ? `${formatted} PT` : '';
}

export function formatPacificTimeWithZone(value, options = {}) {
  const formatted = formatPacificTime(value, options);
  return formatted ? `${formatted} PT` : '';
}

export function formatPacificDateTimeWithZone(value, options = {}) {
  const formatted = formatPacificDateTime(value, options);
  return formatted ? `${formatted} PT` : '';
}

export const parsePacificDateTimeInput = parsePlannerDateTimeInput;
export const formatPacificDateTimeInputValue = formatPlannerDateTimeInputValue;
