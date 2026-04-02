import { PLANNER_NOT_STARTED_STATUS, PLANNER_ROLLUP_STATUSES, PLANNER_STATUSES } from './constants.js';

const PLANNER_STATUS_SEVERITY = Object.fromEntries(
  PLANNER_ROLLUP_STATUSES.map((status, index) => [status, index])
);
const PLANNER_KNOWN_STATUS_SET = new Set(PLANNER_STATUSES);
const PLANNER_ROLLUP_STATUS_SET = new Set(PLANNER_ROLLUP_STATUSES);

export function normalizePlannerStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return PLANNER_KNOWN_STATUS_SET.has(normalized) ? normalized : 'green';
}

export function isPlannerStatusRollupEligible(value) {
  return PLANNER_ROLLUP_STATUS_SET.has(normalizePlannerStatus(value));
}

function getPlannerStatusSeverity(value) {
  const normalized = normalizePlannerStatus(value);
  return Object.hasOwn(PLANNER_STATUS_SEVERITY, normalized)
    ? PLANNER_STATUS_SEVERITY[normalized]
    : Number.NEGATIVE_INFINITY;
}

function getPlannerStatusTone(value) {
  const normalized = normalizePlannerStatus(value);
  return PLANNER_ROLLUP_STATUS_SET.has(normalized) ? normalized : 'green';
}

export function comparePlannerStatusSeverity(left, right) {
  return getPlannerStatusSeverity(left) - getPlannerStatusSeverity(right);
}

export function canPlannerReactionUpdateStatus(currentStatus, checkpoint) {
  const normalizedStatus = normalizePlannerStatus(currentStatus);
  const normalizedCheckpoint = String(checkpoint || '').trim().toLowerCase();
  return normalizedStatus !== PLANNER_NOT_STARTED_STATUS
    || normalizedCheckpoint === 'task_start'
    || normalizedCheckpoint === 'start';
}

export function rollupPlannerStatuses(items = [], dependencies = []) {
  const normalizedItems = Array.isArray(items)
    ? items.map((item) => ({
      ...item,
      raw_status: normalizePlannerStatus(item?.raw_status ?? item?.status)
    }))
    : [];

  const itemMap = new Map(normalizedItems.map((item) => [item.id, item]));
  const predecessorsByItem = new Map(normalizedItems.map((item) => [item.id, []]));

  for (const dependency of Array.isArray(dependencies) ? dependencies : []) {
    const predecessorId = dependency?.predecessor_item_id || dependency?.source;
    const successorId = dependency?.successor_item_id || dependency?.target;
    if (!itemMap.has(predecessorId) || !predecessorsByItem.has(successorId)) continue;
    predecessorsByItem.get(successorId).push(predecessorId);
  }

  const memo = new Map();
  const visiting = new Set();

  function resolveStatus(itemId) {
    if (memo.has(itemId)) return memo.get(itemId);

    const item = itemMap.get(itemId);
    const ownStatus = normalizePlannerStatus(item?.raw_status ?? item?.status);
    if (!item?.id) {
      const ownTone = getPlannerStatusTone(ownStatus);
      const fallback = {
        status: ownStatus,
        raw_status: ownStatus,
        rolled_up_status: ownTone,
        status_tone: ownTone,
        status_is_rolled_up: false
      };
      memo.set(itemId, fallback);
      return fallback;
    }

    if (visiting.has(itemId)) {
      const ownTone = getPlannerStatusTone(ownStatus);
      const cycleFallback = {
        status: ownStatus,
        raw_status: ownStatus,
        rolled_up_status: ownTone,
        status_tone: ownTone,
        status_is_rolled_up: false
      };
      memo.set(itemId, cycleFallback);
      return cycleFallback;
    }

    visiting.add(itemId);

    const ownTone = getPlannerStatusTone(ownStatus);
    let effectiveTone = ownTone;
    for (const predecessorId of predecessorsByItem.get(itemId) || []) {
      const predecessor = resolveStatus(predecessorId);
      if (comparePlannerStatusSeverity(predecessor.status_tone, effectiveTone) > 0) {
        effectiveTone = predecessor.status_tone;
      }
    }

    let effectiveStatus = ownStatus;
    if (isPlannerStatusRollupEligible(ownStatus)) {
      effectiveStatus = effectiveTone;
    } else if (ownStatus === 'completed') {
      effectiveTone = 'completed';
    }

    visiting.delete(itemId);

    const resolved = {
      status: effectiveStatus,
      raw_status: ownStatus,
      rolled_up_status: effectiveTone,
      status_tone: effectiveTone,
      status_is_rolled_up: effectiveStatus !== ownStatus || (ownStatus !== 'completed' && effectiveTone !== ownTone)
    };
    memo.set(itemId, resolved);
    return resolved;
  }

  return normalizedItems.map((item) => ({
    ...item,
    ...resolveStatus(item.id)
  }));
}
