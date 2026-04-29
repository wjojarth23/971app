import {
  PLANNER_DEFAULT_MIN_DURATION_MINUTES,
  PLANNER_DEFAULT_TASK_DURATION_MINUTES,
  PLANNER_SLOT_MINUTES,
  isPlannerDrivePracticeTask,
  plannerItemKind
} from './constants.js';
import {
  addPlannerDays,
  buildPlannerDateAtMinutes,
  endOfPlannerDay,
  getPlannerDateKey,
  getPlannerWeekday,
  startOfPlannerDay
} from './timezone.js';

function pad(value) {
  return String(value).padStart(2, '0');
}

export function minutesToClock(minutes) {
  const safe = Math.max(0, Number(minutes) || 0);
  const hours = Math.floor(safe / 60);
  const mins = safe % 60;
  return `${pad(hours)}:${pad(mins)}`;
}

export function parseClockToMinutes(rawValue) {
  const value = String(rawValue || '').trim();
  const match = value.match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (!Number.isInteger(hours) || !Number.isInteger(minutes) || hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }
  return hours * 60 + minutes;
}

export function roundUpToSlot(minutes, slotMinutes = PLANNER_SLOT_MINUTES) {
  const safe = Math.max(0, Number(minutes) || 0);
  return Math.ceil(safe / slotMinutes) * slotMinutes;
}

export function roundDownToSlot(minutes, slotMinutes = PLANNER_SLOT_MINUTES) {
  const safe = Math.max(0, Number(minutes) || 0);
  return Math.floor(safe / slotMinutes) * slotMinutes;
}

function cloneDate(value) {
  return new Date(value instanceof Date ? value.getTime() : value);
}

function startOfDay(date) {
  return startOfPlannerDay(date) || cloneDate(date);
}

function endOfDay(date) {
  return endOfPlannerDay(date) || cloneDate(date);
}

function addDays(date, days) {
  return addPlannerDays(date, days) || cloneDate(date);
}

function buildDateAtMinutes(baseDate, minutes) {
  return buildPlannerDateAtMinutes(baseDate, minutes) || cloneDate(baseDate);
}

function toDateKey(date) {
  return getPlannerDateKey(date);
}

function isFiniteDate(value) {
  return value instanceof Date && Number.isFinite(value.getTime());
}

export function toDateOrNull(value) {
  if (!value) return null;
  const date = cloneDate(value);
  return isFiniteDate(date) ? date : null;
}

function wallClockAdd(date, minutes) {
  return new Date(cloneDate(date).getTime() + (minutes * 60000));
}

function wallClockDiffMinutes(a, b) {
  return Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000));
}

function mergeIntervals(intervals) {
  if (!intervals.length) return [];
  const sorted = [...intervals].sort((a, b) => a.start.getTime() - b.start.getTime());
  const merged = [sorted[0]];

  for (let index = 1; index < sorted.length; index += 1) {
    const current = sorted[index];
    const previous = merged[merged.length - 1];
    if (current.start.getTime() <= previous.end.getTime()) {
      previous.end = new Date(Math.max(previous.end.getTime(), current.end.getTime()));
    } else {
      merged.push(current);
    }
  }

  return merged;
}

function subtractIntervals(workIntervals, blockedIntervals) {
  if (!blockedIntervals.length) return workIntervals;
  const result = [];

  for (const workInterval of workIntervals) {
    let segments = [{ start: cloneDate(workInterval.start), end: cloneDate(workInterval.end) }];

    for (const blocked of blockedIntervals) {
      const nextSegments = [];
      for (const segment of segments) {
        if (blocked.end <= segment.start || blocked.start >= segment.end) {
          nextSegments.push(segment);
          continue;
        }
        if (blocked.start > segment.start) {
          nextSegments.push({
            start: cloneDate(segment.start),
            end: cloneDate(blocked.start)
          });
        }
        if (blocked.end < segment.end) {
          nextSegments.push({
            start: cloneDate(blocked.end),
            end: cloneDate(segment.end)
          });
        }
      }
      segments = nextSegments.filter((segment) => segment.end > segment.start);
      if (!segments.length) break;
    }

    result.push(...segments);
  }

  return result;
}

export function normalizeCalendarRules(rules = []) {
  return (Array.isArray(rules) ? rules : [])
    .map((rule) => {
      const startsAtMinutes = parseClockToMinutes(rule?.starts_at);
      const endsAtMinutes = parseClockToMinutes(rule?.ends_at);
      const weekday = rule?.weekday === null || rule?.weekday === undefined || rule?.weekday === ''
        ? null
        : Number(rule.weekday);
      const specificDate = String(rule?.specific_date || '').trim() || null;
      const enabled = rule?.enabled !== false;
      if (startsAtMinutes === null || endsAtMinutes === null || startsAtMinutes >= endsAtMinutes) {
        return null;
      }
      if (weekday === null && !specificDate) return null;
      return {
        ...rule,
        weekday,
        specific_date: specificDate,
        starts_at: minutesToClock(startsAtMinutes),
        ends_at: minutesToClock(endsAtMinutes),
        starts_at_minutes: startsAtMinutes,
        ends_at_minutes: endsAtMinutes,
        enabled,
        rule_type:
          rule?.rule_type === 'blocked'
            ? 'blocked'
            : rule?.rule_type === 'drive_practice'
              ? 'drive_practice'
              : 'work_window'
      };
    })
    .filter(Boolean)
    .sort((a, b) => {
      const dateA = a.specific_date || '';
      const dateB = b.specific_date || '';
      if (dateA !== dateB) return dateA.localeCompare(dateB);
      const weekdayA = a.weekday ?? -1;
      const weekdayB = b.weekday ?? -1;
      if (weekdayA !== weekdayB) return weekdayA - weekdayB;
      if (a.starts_at_minutes !== b.starts_at_minutes) return a.starts_at_minutes - b.starts_at_minutes;
      return a.ends_at_minutes - b.ends_at_minutes;
    });
}

function ruleAppliesToDate(rule, date) {
  if (!rule?.enabled) return false;
  if (rule.specific_date) {
    return rule.specific_date === toDateKey(date);
  }
  return rule.weekday === getPlannerWeekday(date);
}

function hasExplicitWorkRules(rules) {
  return rules.some((rule) => rule.enabled && rule.rule_type === 'work_window');
}

export function getWorkIntervalsForDate(date, rawRules = []) {
  const rules = normalizeCalendarRules(rawRules);
  const baseDate = startOfDay(date);
  const hasWorkRules = hasExplicitWorkRules(rules);
  const workIntervals = [];
  const blockedIntervals = [];

  if (!hasWorkRules) {
    workIntervals.push({
      start: cloneDate(baseDate),
      end: endOfDay(baseDate)
    });
  }

  for (const rule of rules) {
    if (!ruleAppliesToDate(rule, baseDate)) continue;
    const interval = {
      start: buildDateAtMinutes(baseDate, rule.starts_at_minutes),
      end: buildDateAtMinutes(baseDate, rule.ends_at_minutes)
    };
    if (rule.rule_type === 'work_window') {
      workIntervals.push(interval);
    } else {
      blockedIntervals.push(interval);
    }
  }

  return subtractIntervals(mergeIntervals(workIntervals), mergeIntervals(blockedIntervals));
}

export function nextWorkMoment(value, rawRules = []) {
  const rules = normalizeCalendarRules(rawRules);
  const cursor = toDateOrNull(value) || new Date();
  const hasWorkRules = hasExplicitWorkRules(rules);
  if (!hasWorkRules && !rules.some((rule) => rule.rule_type !== 'work_window' && rule.enabled)) {
    return cursor;
  }

  let dayCursor = cloneDate(cursor);
  for (let offset = 0; offset < 35; offset += 1) {
    const date = offset === 0 ? dayCursor : addDays(startOfDay(cursor), offset);
    const intervals = getWorkIntervalsForDate(date, rules);
    for (const interval of intervals) {
      if (cursor <= interval.start) return cloneDate(interval.start);
      if (cursor > interval.start && cursor < interval.end) return cloneDate(cursor);
    }
    dayCursor = addDays(startOfDay(date), 1);
  }

  return cursor;
}

export function addWorkingMinutes(value, minutes, rawRules = []) {
  const start = toDateOrNull(value) || new Date();
  const totalMinutes = roundUpToSlot(minutes);
  if (totalMinutes <= 0) return start;

  const rules = normalizeCalendarRules(rawRules);
  const hasWorkRules = hasExplicitWorkRules(rules);
  if (!hasWorkRules && !rules.some((rule) => rule.rule_type !== 'work_window' && rule.enabled)) {
    return wallClockAdd(start, totalMinutes);
  }

  let remaining = totalMinutes;
  let cursor = nextWorkMoment(start, rules);

  for (let guard = 0; guard < 500 && remaining > 0; guard += 1) {
    const intervals = getWorkIntervalsForDate(cursor, rules);
    let progressed = false;

    for (const interval of intervals) {
      if (interval.end <= cursor) continue;
      const segmentStart = cursor > interval.start ? cursor : interval.start;
      const available = wallClockDiffMinutes(segmentStart, interval.end);
      if (available <= 0) continue;
      progressed = true;
      if (remaining <= available) {
        return wallClockAdd(segmentStart, remaining);
      }
      remaining -= available;
      cursor = nextWorkMoment(addDays(startOfDay(segmentStart), 1), rules);
      break;
    }

    if (!progressed) {
      cursor = nextWorkMoment(addDays(startOfDay(cursor), 1), rules);
    }
  }

  return wallClockAdd(start, totalMinutes);
}

export function workingMinutesBetween(startValue, endValue, rawRules = []) {
  const start = toDateOrNull(startValue);
  const end = toDateOrNull(endValue);
  if (!start || !end || end <= start) return 0;

  const rules = normalizeCalendarRules(rawRules);
  const hasWorkRules = hasExplicitWorkRules(rules);
  if (!hasWorkRules && !rules.some((rule) => rule.rule_type !== 'work_window' && rule.enabled)) {
    return wallClockDiffMinutes(start, end);
  }

  let total = 0;
  let cursor = cloneDate(start);

  for (let guard = 0; guard < 500 && cursor < end; guard += 1) {
    const intervals = getWorkIntervalsForDate(cursor, rules);
    let progressed = false;

    for (const interval of intervals) {
      if (interval.end <= cursor || interval.start >= end) continue;
      const segmentStart = cursor > interval.start ? cursor : interval.start;
      const segmentEnd = end < interval.end ? end : interval.end;
      if (segmentEnd > segmentStart) {
        total += wallClockDiffMinutes(segmentStart, segmentEnd);
        progressed = true;
      }
      if (segmentEnd >= end) return total;
    }

    cursor = nextWorkMoment(addDays(startOfDay(cursor), 1), rules);
    if (!progressed && cursor <= startOfDay(addDays(cursor, -1))) {
      break;
    }
  }

  return total;
}

function normalizeItem(item, fallbackSort = 0) {
  const kind = plannerItemKind(item);
  const criticalLevel = Math.min(4, Math.max(1, Number(item?.critical_level) || 3));
  const requestedDurationMinutes = kind === 'milestone'
    ? null
    : roundUpToSlot(Number(item?.requested_duration_minutes) || Number(item?.duration_minutes) || PLANNER_DEFAULT_TASK_DURATION_MINUTES);
  const minDurationMinutes = kind === 'milestone'
    ? 0
    : roundUpToSlot(Math.min(
      requestedDurationMinutes,
      Math.max(PLANNER_DEFAULT_MIN_DURATION_MINUTES, Number(item?.min_duration_minutes) || PLANNER_DEFAULT_MIN_DURATION_MINUTES)
    ));
  return {
    ...item,
    kind,
    critical_level: criticalLevel,
    requested_duration_minutes: requestedDurationMinutes,
    duration_minutes: requestedDurationMinutes || 0,
    min_duration_minutes: minDurationMinutes,
    manual_start_at: item?.manual_start_at || null,
    sort_order: Number.isFinite(Number(item?.sort_order)) ? Number(item.sort_order) : fallbackSort,
    scheduled_start_at: item?.scheduled_start_at || null,
    scheduled_end_at: item?.scheduled_end_at || null
  };
}

export function buildDependencyMaps(items = [], dependencies = []) {
  const predecessorMap = new Map(items.map((item) => [item.id, []]));
  const successorMap = new Map(items.map((item) => [item.id, []]));

  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    const predecessorId = dependency?.predecessor_item_id || dependency?.source;
    const successorId = dependency?.successor_item_id || dependency?.target;
    if (!predecessorMap.has(successorId) || !successorMap.has(predecessorId)) continue;
    predecessorMap.get(successorId).push(predecessorId);
    successorMap.get(predecessorId).push(successorId);
  }

  return { predecessorMap, successorMap };
}

export function topologicalSort(items = [], dependencies = []) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const { successorMap, predecessorMap } = buildDependencyMaps(items, dependencies);
  const inDegree = new Map(items.map((item) => [item.id, predecessorMap.get(item.id)?.length || 0]));
  const queue = items
    .filter((item) => (inDegree.get(item.id) || 0) === 0)
    .sort((a, b) => {
      if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
      return String(a.title || '').localeCompare(String(b.title || ''), undefined, { sensitivity: 'base' });
    })
    .map((item) => item.id);

  const order = [];
  while (queue.length) {
    const currentId = queue.shift();
    order.push(currentId);
    for (const successorId of successorMap.get(currentId) || []) {
      const nextDegree = (inDegree.get(successorId) || 0) - 1;
      inDegree.set(successorId, nextDegree);
      if (nextDegree === 0) {
        queue.push(successorId);
      }
    }
    queue.sort((leftId, rightId) => {
      const left = itemMap.get(leftId);
      const right = itemMap.get(rightId);
      if ((left?.sort_order || 0) !== (right?.sort_order || 0)) {
        return (left?.sort_order || 0) - (right?.sort_order || 0);
      }
      return String(left?.title || '').localeCompare(String(right?.title || ''), undefined, { sensitivity: 'base' });
    });
  }

  return {
    order,
    hasCycle: order.length !== items.length
  };
}

function scheduleItem(item, predecessorMap, scheduledMap, rules, defaultStartAt) {
  const predecessorIds = predecessorMap.get(item.id) || [];
  const predecessorFinish = predecessorIds
    .map((predecessorId) => scheduledMap.get(predecessorId))
    .filter(Boolean)
    .reduce((latest, predecessor) => {
      const candidate = predecessor.kind === 'milestone'
        ? toDateOrNull(predecessor.scheduled_start_at)
        : toDateOrNull(predecessor.scheduled_end_at);
      if (!candidate) return latest;
      if (!latest || candidate > latest) return candidate;
      return latest;
    }, null);

  if (item.kind === 'milestone') {
    const target = toDateOrNull(item.manual_start_at) || predecessorFinish || defaultStartAt;
    const dependencyReadyAt = predecessorFinish || target;
    const scheduledStart = isPinnedMilestone(item)
      ? target
      : dependencyReadyAt;
    return {
      ...item,
      dependency_ready_at: dependencyReadyAt?.toISOString() || null,
      scheduled_start_at: scheduledStart?.toISOString() || null,
      scheduled_end_at: scheduledStart?.toISOString() || null
    };
  }

  let requestedStart = toDateOrNull(item.manual_start_at);
  if (!requestedStart && predecessorFinish) requestedStart = predecessorFinish;
  if (!requestedStart) requestedStart = defaultStartAt;

  if (predecessorFinish && predecessorFinish > requestedStart) {
    requestedStart = predecessorFinish;
  }

  const scheduledStart = nextWorkMoment(requestedStart, rules);
  const scheduledEnd = addWorkingMinutes(scheduledStart, item.duration_minutes, rules);

  return {
    ...item,
    scheduled_start_at: scheduledStart.toISOString(),
    scheduled_end_at: scheduledEnd.toISOString()
  };
}

function getScheduledFinish(item) {
  if (!item) return null;
  return item.kind === 'milestone'
    ? toDateOrNull(item.scheduled_start_at)
    : toDateOrNull(item.scheduled_end_at);
}

function isPinnedMilestone(item) {
  return item?.kind === 'milestone' && !!item?.manual_start_at && Number(item?.critical_level) === 1;
}

function findCriticalPath(anchorId, predecessorMap, scheduledMap) {
  const path = [];
  const seen = new Set();
  let cursorId = anchorId;

  while (cursorId && !seen.has(cursorId)) {
    seen.add(cursorId);
    const predecessors = predecessorMap.get(cursorId) || [];
    if (!predecessors.length) break;

    let latest = null;
    for (const predecessorId of predecessors) {
      const predecessor = scheduledMap.get(predecessorId);
      if (!predecessor) continue;
      const finish = predecessor.kind === 'milestone'
        ? toDateOrNull(predecessor.scheduled_start_at)
        : toDateOrNull(predecessor.scheduled_end_at);
      if (!finish) continue;
      if (!latest || finish > latest.finish) {
        latest = {
          finish,
          item: predecessor
        };
      }
    }

    if (!latest?.item) break;
    path.push(latest.item);
    cursorId = latest.item.id;
  }

  return path;
}

function getPathSegmentUntilPinnedBoundary(pathItems = []) {
  const segment = [];

  for (const item of pathItems) {
    if (isPinnedMilestone(item)) break;
    segment.push(item);
  }

  return segment;
}

function allocateOverflowSlots(candidates, overflowSlots) {
  const allocations = Object.fromEntries(candidates.map((candidate) => [candidate.key, 0]));
  let remaining = overflowSlots;
  let active = candidates.map((candidate) => ({ ...candidate, used: 0 }));

  while (remaining > 0 && active.length) {
    const totalWeight = active.reduce((sum, candidate) => sum + candidate.weight, 0);
    if (!totalWeight) break;

    let changed = false;
    const ranked = active
      .map((candidate) => {
        const remainingCapacity = Number.isFinite(candidate.capacitySlots)
          ? Math.max(0, candidate.capacitySlots - candidate.used)
          : Number.POSITIVE_INFINITY;
        const ideal = (remaining * candidate.weight) / totalWeight;
        const base = Number.isFinite(remainingCapacity)
          ? Math.min(remainingCapacity, Math.floor(ideal))
          : Math.floor(ideal);
        return {
          ...candidate,
          remainingCapacity,
          fractional: ideal - Math.floor(ideal),
          base
        };
      })
      .sort((left, right) => {
        if (right.fractional !== left.fractional) return right.fractional - left.fractional;
        return right.weight - left.weight;
      });

    for (const candidate of ranked) {
      if (remaining <= 0) break;
      if (candidate.base <= 0) continue;
      allocations[candidate.key] += candidate.base;
      const activeCandidate = active.find((entry) => entry.key === candidate.key);
      if (activeCandidate) activeCandidate.used += candidate.base;
      remaining -= candidate.base;
      changed = true;
    }

    for (const candidate of ranked) {
      if (remaining <= 0) break;
      const activeCandidate = active.find((entry) => entry.key === candidate.key);
      const remainingCapacity = activeCandidate
        ? (Number.isFinite(activeCandidate.capacitySlots)
          ? activeCandidate.capacitySlots - activeCandidate.used
          : Number.POSITIVE_INFINITY)
        : 0;
      if (remainingCapacity <= 0) continue;
      allocations[candidate.key] += 1;
      if (activeCandidate) activeCandidate.used += 1;
      remaining -= 1;
      changed = true;
    }

    active = active.filter((candidate) => {
      if (!Number.isFinite(candidate.capacitySlots)) return true;
      return candidate.used < candidate.capacitySlots;
    });

    if (!changed) break;
  }

  return { allocations, remaining };
}

function allocateCompressionSlots(candidates, overflowSlots) {
  const allocations = Object.fromEntries(candidates.map((candidate) => [candidate.key, 0]));
  let remaining = overflowSlots;
  const grouped = new Map([
    [4, []],
    [3, []],
    [2, []]
  ]);
  const cursors = new Map([
    [4, 0],
    [3, 0],
    [2, 0]
  ]);
  const levelPattern = [3, 3, 2];
  let patternIndex = 0;

  for (const candidate of candidates) {
    const level = Number(candidate.critical_level);
    if (!grouped.has(level)) continue;
    grouped.get(level).push({ ...candidate, used: 0 });
  }

  function hasCapacity(level) {
    return (grouped.get(level) || []).some((candidate) => candidate.used < candidate.capacitySlots);
  }

  function takeOne(level) {
    const entries = grouped.get(level) || [];
    if (!entries.length) return false;

    const startIndex = cursors.get(level) || 0;
    for (let offset = 0; offset < entries.length; offset += 1) {
      const index = (startIndex + offset) % entries.length;
      const candidate = entries[index];
      if (candidate.used >= candidate.capacitySlots) continue;

      candidate.used += 1;
      allocations[candidate.key] += 1;
      cursors.set(level, (index + 1) % entries.length);
      remaining -= 1;
      return true;
    }

    return false;
  }

  while (remaining > 0) {
    if (hasCapacity(4)) {
      takeOne(4);
      continue;
    }

    if (!hasCapacity(3) && !hasCapacity(2)) break;

    let progressed = false;
    for (let attempts = 0; attempts < levelPattern.length; attempts += 1) {
      const level = levelPattern[patternIndex % levelPattern.length];
      patternIndex += 1;
      if (takeOne(level)) {
        progressed = true;
        break;
      }
    }

    if (!progressed) break;
  }

  return { allocations, remaining };
}

function buildCompressionCandidates(pathItems) {
  const candidates = [];

  for (const item of pathItems) {
    if (item.kind !== 'task') continue;
    if (item.critical_level === 1) continue;
    const capacityMinutes = Math.max(0, item.duration_minutes - item.min_duration_minutes);
    const capacitySlots = Math.floor(capacityMinutes / PLANNER_SLOT_MINUTES);
    if (capacitySlots <= 0) continue;
    candidates.push({
      key: `task:${item.id}`,
      type: 'task',
      itemId: item.id,
      critical_level: item.critical_level,
      capacitySlots
    });
  }

  return candidates;
}

function buildExpansionCandidates(pathItems) {
  const candidates = [];

  for (const item of pathItems) {
    if (item.kind !== 'task') continue;
    candidates.push({
      key: `task:${item.id}`,
      type: 'task',
      itemId: item.id,
      weight: item.critical_level
    });
  }

  return candidates;
}

function applyScheduleAdjustment(items, adjustment, rawRules = []) {
  return items.map((item) => {
    const shrinkMinutes = (adjustment.taskShrinks?.[item.id] || 0) * PLANNER_SLOT_MINUTES;
    const expandMinutes = (adjustment.taskExpands?.[item.id] || 0) * PLANNER_SLOT_MINUTES;
    const milestoneShiftMinutes = (adjustment.milestoneMoves[item.id] || 0) * PLANNER_SLOT_MINUTES;
    if (!shrinkMinutes && !expandMinutes && !milestoneShiftMinutes) return item;

    if ((shrinkMinutes || expandMinutes) && item.kind === 'task') {
      return {
        ...item,
        duration_minutes: Math.max(
          item.min_duration_minutes,
          item.duration_minutes - shrinkMinutes + expandMinutes
        )
      };
    }

    if (milestoneShiftMinutes && item.kind === 'milestone') {
      const currentTarget = toDateOrNull(item.manual_start_at) || new Date();
      return {
        ...item,
        manual_start_at: addWorkingMinutes(currentTarget, milestoneShiftMinutes, rawRules).toISOString()
      };
    }

    return item;
  });
}

function findFirstPinnedMilestoneExpansion(items, predecessorMap, scheduledMap, rawRules = []) {
  const milestoneAnchors = items
    .filter((item) => isPinnedMilestone(item))
    .sort((left, right) => String(left.manual_start_at).localeCompare(String(right.manual_start_at)));

  for (const anchor of milestoneAnchors) {
    const targetStart = toDateOrNull(anchor.manual_start_at);
    if (!targetStart) continue;

    const pathItems = getPathSegmentUntilPinnedBoundary(findCriticalPath(anchor.id, predecessorMap, scheduledMap));
    const latestPredecessor = pathItems[0];
    const predecessorFinish = getScheduledFinish(latestPredecessor);
    if (!predecessorFinish || predecessorFinish >= targetStart) continue;

    const slackMinutes = workingMinutesBetween(predecessorFinish, targetStart, rawRules);
    const slackSlots = Math.floor(slackMinutes / PLANNER_SLOT_MINUTES);
    if (slackSlots <= 0) continue;

    const candidates = buildExpansionCandidates(pathItems);
    if (!candidates.length) continue;

    const allocation = allocateOverflowSlots(candidates, slackSlots);
    const taskExpands = {};

    for (const [key, slots] of Object.entries(allocation.allocations)) {
      if (!slots || !key.startsWith('task:')) continue;
      const [, itemId] = key.split(':');
      taskExpands[itemId] = (taskExpands[itemId] || 0) + slots;
    }

    if (Object.keys(taskExpands).length) {
      return {
        taskExpands,
        taskShrinks: {},
        milestoneMoves: {},
        warnings: []
      };
    }
  }

  return null;
}

function findFirstCompression(items, predecessorMap, scheduledMap, rawRules = []) {
  const milestoneAnchors = items
    .filter((item) => isPinnedMilestone(item))
    .sort((left, right) => String(left.manual_start_at).localeCompare(String(right.manual_start_at)));

  for (const anchor of milestoneAnchors) {
    const scheduledStart = toDateOrNull(anchor.scheduled_start_at);
    const targetStart = toDateOrNull(anchor.manual_start_at);
    if (!scheduledStart || !targetStart || scheduledStart <= targetStart) continue;

    const overflowMinutes = workingMinutesBetween(targetStart, scheduledStart, rawRules);
    const overflowSlots = Math.ceil(overflowMinutes / PLANNER_SLOT_MINUTES);
    if (overflowSlots <= 0) continue;

    const pathItems = getPathSegmentUntilPinnedBoundary(findCriticalPath(anchor.id, predecessorMap, scheduledMap));
    const warnings = [];
    const taskShrinks = {};
    const milestoneMoves = {};

    let remainingSlots = overflowSlots;
    const primaryCandidates = buildCompressionCandidates(pathItems);
    const primaryAllocation = allocateCompressionSlots(primaryCandidates, remainingSlots);
    remainingSlots = primaryAllocation.remaining;

    for (const [key, slots] of Object.entries(primaryAllocation.allocations)) {
      if (!slots) continue;
      const [, itemId] = key.split(':');
      if (key.startsWith('task:')) taskShrinks[itemId] = (taskShrinks[itemId] || 0) + slots;
    }

    if (remainingSlots > 0) {
      milestoneMoves[anchor.id] = (milestoneMoves[anchor.id] || 0) + remainingSlots;
      warnings.push(`"${anchor.title}" still had to move because every level 2-4 task on its path hit minimum duration, and level 1 tasks cannot shrink.`);
      remainingSlots = 0;
    }

    if (Object.keys(taskShrinks).length || Object.keys(milestoneMoves).length) {
      return {
        taskShrinks,
        milestoneMoves,
        warnings
      };
    }
  }

  return null;
}

function formatDurationHours(minutes) {
  const hours = Math.max(0, Number(minutes) || 0) / 60;
  return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)}h`;
}

function buildPinnedMilestoneWarnings(items, rawRules = []) {
  return items
    .filter((item) => isPinnedMilestone(item))
    .sort((left, right) => String(left.manual_start_at).localeCompare(String(right.manual_start_at)))
    .flatMap((anchor) => {
      const scheduledStart = toDateOrNull(anchor.dependency_ready_at || anchor.scheduled_start_at);
      const targetStart = toDateOrNull(anchor.manual_start_at);
      if (!scheduledStart || !targetStart || scheduledStart <= targetStart) return [];

      const slipMinutes = workingMinutesBetween(targetStart, scheduledStart, rawRules);
      return [
        `Critical path warning: "${anchor.title}" is ${formatDurationHours(slipMinutes)} late. Pinned milestones do not move automatically, and critical-path tasks stay at their requested duration.`
      ];
    });
}

function scheduleOrderedItems(items, order, predecessorMap, rawRules = [], defaultStartAt) {
  const itemMap = new Map(items.map((item) => [item.id, item]));
  const scheduledMap = new Map();
  const orderedItems = [];

  for (const itemId of order) {
    const item = itemMap.get(itemId);
    if (!item) continue;
    const scheduled = scheduleItem(item, predecessorMap, scheduledMap, rawRules, defaultStartAt);
    scheduledMap.set(item.id, scheduled);
    orderedItems.push(scheduled);
  }

  return {
    items: orderedItems,
    scheduledMap
  };
}

export function recomputePlannerSchedule(rawItems = [], dependencies = [], rawRules = [], options = {}) {
  const now = toDateOrNull(options.now) || new Date();
  const defaultStartAt = nextWorkMoment(now, rawRules);
  const items = rawItems.map((item, index) => normalizeItem(item, index * 1000));
  const { order, hasCycle } = topologicalSort(items, dependencies);
  if (hasCycle) {
    return {
      items,
      warnings: ['Planner dependencies contain a cycle.'],
      hasCycle: true
    };
  }

  const { predecessorMap } = buildDependencyMaps(items, dependencies);
  const scheduled = scheduleOrderedItems(items, order, predecessorMap, rawRules, defaultStartAt);

  return {
    items: scheduled.items,
    warnings: buildPinnedMilestoneWarnings(scheduled.items, rawRules),
    hasCycle: false
  };
}

export function detectCycleIfDependencyAdded(items = [], dependencies = [], predecessorId, successorId) {
  const graph = new Map(items.map((item) => [item.id, []]));
  for (const dependency of dependencies) {
    const source = dependency?.predecessor_item_id || dependency?.source;
    const target = dependency?.successor_item_id || dependency?.target;
    if (graph.has(source)) graph.get(source).push(target);
  }
  if (graph.has(predecessorId)) graph.get(predecessorId).push(successorId);

  const visiting = new Set();
  const visited = new Set();

  function walk(nodeId) {
    if (visiting.has(nodeId)) return true;
    if (visited.has(nodeId)) return false;
    visiting.add(nodeId);
    for (const nextId of graph.get(nodeId) || []) {
      if (walk(nextId)) return true;
    }
    visiting.delete(nodeId);
    visited.add(nodeId);
    return false;
  }

  return walk(predecessorId);
}

export function buildCheckpointTimes(item, rawRules = []) {
  if (item?.kind !== 'task') return null;
  const startAt = toDateOrNull(item.scheduled_start_at);
  const endAt = toDateOrNull(item.scheduled_end_at);
  if (!startAt || !endAt) return null;

  const durationMinutes = roundUpToSlot(Number(item.duration_minutes) || 0);
  const midpoint = addWorkingMinutes(startAt, Math.max(PLANNER_SLOT_MINUTES, durationMinutes / 2), rawRules);

  return {
    start: startAt,
    midpoint,
    end: endAt
  };
}

export function getTaskWorkSessions(startValue, endValue, rawRules = []) {
  const startAt = toDateOrNull(startValue);
  const endAt = toDateOrNull(endValue);
  if (!startAt || !endAt || endAt <= startAt) return [];

  const rules = normalizeCalendarRules(rawRules);
  const hasWorkRules = hasExplicitWorkRules(rules);
  if (!hasWorkRules && !rules.some((rule) => rule.rule_type !== 'work_window' && rule.enabled)) {
    return [{
      start: cloneDate(startAt),
      end: cloneDate(endAt)
    }];
  }

  const sessions = [];
  let dayCursor = startOfDay(startAt);

  for (let guard = 0; guard < 120 && dayCursor <= endAt; guard += 1) {
    const intervals = getWorkIntervalsForDate(dayCursor, rules);
    for (const interval of intervals) {
      const sessionStart = interval.start > startAt ? interval.start : startAt;
      const sessionEnd = interval.end < endAt ? interval.end : endAt;
      if (sessionEnd <= sessionStart) continue;
      sessions.push({
        start: cloneDate(sessionStart),
        end: cloneDate(sessionEnd)
      });
    }
    dayCursor = addDays(dayCursor, 1);
  }

  return sessions.length
    ? sessions
    : [{
      start: cloneDate(startAt),
      end: cloneDate(endAt)
    }];
}

function getSessionMidpoint(session) {
  const durationMinutes = wallClockDiffMinutes(session.start, session.end);
  const midpointMinutes = Math.max(1, Math.round(durationMinutes / 2));
  return wallClockAdd(session.start, midpointMinutes);
}

export function buildTaskPromptSchedule(item, rawRules = []) {
  if (item?.kind !== 'task') return [];
  const startAt = toDateOrNull(item.scheduled_start_at);
  const endAt = toDateOrNull(item.scheduled_end_at);
  if (!startAt || !endAt || endAt <= startAt) return [];

  if (isPlannerDrivePracticeTask(item)) {
    return [{
      checkpoint: 'task_end',
      scheduled_for: cloneDate(endAt)
    }];
  }

  const sessions = getTaskWorkSessions(startAt, endAt, rawRules);
  const prompts = [];

  sessions.forEach((session, index) => {
    prompts.push({
      checkpoint: index === 0 ? 'task_start' : 'session_start',
      scheduled_for: cloneDate(session.start)
    });

    const midpoint = getSessionMidpoint(session);
    if (midpoint > session.start && midpoint < session.end) {
      prompts.push({
        checkpoint: 'session_midpoint',
        scheduled_for: midpoint
      });
    }

    prompts.push({
      checkpoint: index === sessions.length - 1 ? 'task_end' : 'session_end',
      scheduled_for: cloneDate(session.end)
    });
  });

  return prompts;
}
