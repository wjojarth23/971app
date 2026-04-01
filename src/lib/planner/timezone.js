import { PLANNER_TIME_ZONE } from './constants.js';

const plannerDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: PLANNER_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23'
});

function normalizeDate(value) {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

export function getPlannerDateTimeParts(value) {
  const date = normalizeDate(value);
  if (!date) return null;

  const parts = {};
  for (const part of plannerDateTimeFormatter.formatToParts(date)) {
    if (part.type === 'literal') continue;
    parts[part.type] = part.value;
  }

  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second)
  };
}

export function buildPlannerDateFromParts(parts = {}) {
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour || 0);
  const minute = Number(parts.minute || 0);
  const second = Number(parts.second || 0);
  const millisecond = Number(parts.millisecond || 0);

  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) {
    return null;
  }

  let guess = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);
  const desired = Date.UTC(year, month - 1, day, hour, minute, second, millisecond);

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const currentParts = getPlannerDateTimeParts(new Date(guess));
    if (!currentParts) break;

    const actual = Date.UTC(
      currentParts.year,
      currentParts.month - 1,
      currentParts.day,
      currentParts.hour,
      currentParts.minute,
      currentParts.second,
      millisecond
    );
    const diff = desired - actual;
    if (diff === 0) return new Date(guess);
    guess += diff;
  }

  return normalizeDate(guess);
}

export function parsePlannerDateTimeInput(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === '') return null;
  if (rawValue instanceof Date || typeof rawValue === 'number') {
    return normalizeDate(rawValue);
  }

  const value = String(rawValue).trim();
  if (!value) return null;

  if (/(?:[zZ]|[+-]\d{2}:\d{2})$/.test(value)) {
    return normalizeDate(value);
  }

  const dateTimeMatch = value.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T\s](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?)?$/
  );
  if (dateTimeMatch) {
    const [
      ,
      year,
      month,
      day,
      hour = '00',
      minute = '00',
      second = '00',
      millisecond = '0'
    ] = dateTimeMatch;

    return buildPlannerDateFromParts({
      year: Number(year),
      month: Number(month),
      day: Number(day),
      hour: Number(hour),
      minute: Number(minute),
      second: Number(second),
      millisecond: Number(String(millisecond).padEnd(3, '0'))
    });
  }

  return normalizeDate(value);
}

export function getPlannerWeekday(value) {
  const parts = getPlannerDateTimeParts(value);
  if (!parts) return null;
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

export function startOfPlannerDay(value) {
  const parts = getPlannerDateTimeParts(value);
  if (!parts) return null;
  return buildPlannerDateFromParts({
    year: parts.year,
    month: parts.month,
    day: parts.day
  });
}

export function addPlannerDays(value, days) {
  const parts = getPlannerDateTimeParts(value);
  if (!parts) return null;

  const shifted = new Date(Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day + Number(days || 0),
    parts.hour,
    parts.minute,
    parts.second
  ));

  return buildPlannerDateFromParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: parts.hour,
    minute: parts.minute,
    second: parts.second
  });
}

export function endOfPlannerDay(value) {
  const start = startOfPlannerDay(value);
  const next = addPlannerDays(start, 1);
  if (!start || !next) return null;
  return new Date(next.getTime() - 1);
}

export function buildPlannerDateAtMinutes(baseDate, minutes) {
  const parts = getPlannerDateTimeParts(baseDate);
  if (!parts) return null;

  const shifted = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, 0, Number(minutes || 0), 0, 0));
  return buildPlannerDateFromParts({
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    hour: shifted.getUTCHours(),
    minute: shifted.getUTCMinutes(),
    second: shifted.getUTCSeconds(),
    millisecond: shifted.getUTCMilliseconds()
  });
}

export function getPlannerDateKey(value) {
  const parts = getPlannerDateTimeParts(value);
  if (!parts) return '';
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`;
}

export function formatPlannerDateTimeInputValue(value) {
  const parts = getPlannerDateTimeParts(value);
  if (!parts) return '';
  return `${String(parts.year).padStart(4, '0')}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}T${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`;
}
