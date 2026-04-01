const PLANNER_STATUS_SEVERITY = {
  green: 0,
  yellow: 1,
  red: 2
};

export function normalizePlannerStatus(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return Object.hasOwn(PLANNER_STATUS_SEVERITY, normalized) ? normalized : 'green';
}

export function comparePlannerStatusSeverity(left, right) {
  return PLANNER_STATUS_SEVERITY[normalizePlannerStatus(left)] - PLANNER_STATUS_SEVERITY[normalizePlannerStatus(right)];
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
      const fallback = {
        status: ownStatus,
        raw_status: ownStatus,
        rolled_up_status: ownStatus,
        status_is_rolled_up: false
      };
      memo.set(itemId, fallback);
      return fallback;
    }

    if (visiting.has(itemId)) {
      const cycleFallback = {
        status: ownStatus,
        raw_status: ownStatus,
        rolled_up_status: ownStatus,
        status_is_rolled_up: false
      };
      memo.set(itemId, cycleFallback);
      return cycleFallback;
    }

    visiting.add(itemId);

    let effectiveStatus = ownStatus;
    for (const predecessorId of predecessorsByItem.get(itemId) || []) {
      const predecessor = resolveStatus(predecessorId);
      if (comparePlannerStatusSeverity(predecessor.status, effectiveStatus) > 0) {
        effectiveStatus = predecessor.status;
      }
    }

    visiting.delete(itemId);

    const resolved = {
      status: effectiveStatus,
      raw_status: ownStatus,
      rolled_up_status: effectiveStatus,
      status_is_rolled_up: effectiveStatus !== ownStatus
    };
    memo.set(itemId, resolved);
    return resolved;
  }

  return normalizedItems.map((item) => ({
    ...item,
    ...resolveStatus(item.id)
  }));
}
