import { json } from '@sveltejs/kit';
import {
  ensurePlannerPartsOnTeam,
  ensurePlannerP0BugsOnTeam,
  fetchPlannerBundle,
  fetchPlannerSnapshot,
  getPlannerActor,
  getPlannerDbFromRequest,
  plannerTeamEnabled,
  recomputePlannerTeam,
  replacePlannerItemPartLinks,
  replacePlannerP0BugLinks,
  replacePlannerOwners,
  replacePlannerRuleRecipients,
  ensurePlannerUsersOnTeam
} from '$lib/server/planner_data.js';
import { detectCycleIfDependencyAdded, parseClockToMinutes, roundUpToSlot } from '$lib/planner/schedule.js';
import {
  PLANNER_CATEGORIES,
  PLANNER_DEFAULT_MILESTONE_STATUS,
  PLANNER_DEFAULT_TASK_STATUS,
  PLANNER_DEFAULT_MIN_DURATION_MINUTES,
  PLANNER_DEFAULT_TASK_DURATION_MINUTES,
  PLANNER_FIXING_TASK_MODE,
  PLANNER_WORK_CATEGORIES,
  PLANNER_STANDARD_TASK_MODE,
  PLANNER_STATUSES,
  plannerItemType
} from '$lib/planner/constants.js';
import {
  buildFullCycleTaskSteps,
  formatFullCycleTaskTitle,
  normalizePlannerTaskTemplate,
  PLANNER_FULL_CYCLE_TASK_TEMPLATE
} from '$lib/planner/multi_step.js';
import { parsePlannerDateTimeInput } from '$lib/planner/timezone.js';

function normalizeAction(rawValue) {
  return String(rawValue || '').trim().toLowerCase();
}

function normalizeKind(rawValue) {
  return String(rawValue || '').trim().toLowerCase() === 'milestone' ? 'milestone' : 'task';
}

function defaultStatusForItemType(itemType = 'task') {
  return itemType === 'milestone' ? PLANNER_DEFAULT_MILESTONE_STATUS : PLANNER_DEFAULT_TASK_STATUS;
}

function normalizeStatus(rawValue, fallback = PLANNER_DEFAULT_TASK_STATUS) {
  const value = String(rawValue || '').trim().toLowerCase();
  return PLANNER_STATUSES.includes(value) ? value : fallback;
}

function normalizeCategory(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  return PLANNER_CATEGORIES.includes(value) ? value : null;
}

function normalizeWorkCategory(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  return PLANNER_WORK_CATEGORIES.includes(value) ? value : null;
}

function normalizeCriticalLevel(rawValue) {
  const numeric = Number(rawValue);
  if (!Number.isFinite(numeric)) return 3;
  return Math.min(4, Math.max(1, Math.round(numeric)));
}

function normalizeDurationMinutes(body, fallback = PLANNER_DEFAULT_TASK_DURATION_MINUTES) {
  const directMinutes = Number(body?.duration_minutes);
  if (Number.isFinite(directMinutes) && directMinutes > 0) {
    return roundUpToSlot(directMinutes);
  }
  const hours = Number(body?.duration_hours);
  if (Number.isFinite(hours) && hours > 0) {
    return roundUpToSlot(hours * 60);
  }
  return roundUpToSlot(fallback);
}

function normalizeMinDurationMinutes(body, durationMinutes) {
  const directMinutes = Number(body?.min_duration_minutes);
  if (Number.isFinite(directMinutes) && directMinutes > 0) {
    return roundUpToSlot(Math.min(durationMinutes, directMinutes));
  }
  const hours = Number(body?.min_duration_hours);
  if (Number.isFinite(hours) && hours > 0) {
    return roundUpToSlot(Math.min(durationMinutes, hours * 60));
  }
  return Math.min(durationMinutes, PLANNER_DEFAULT_MIN_DURATION_MINUTES);
}

function normalizeOwnerIds(rawValue) {
  if (!Array.isArray(rawValue)) return [];
  return rawValue.map((value) => String(value || '').trim()).filter(Boolean);
}

function normalizeIdList(rawValue) {
  if (!Array.isArray(rawValue)) return [];
  return rawValue.map((value) => String(value || '').trim()).filter(Boolean);
}

function normalizeTaskMode(rawValue) {
  return String(rawValue || '').trim().toLowerCase() === PLANNER_FIXING_TASK_MODE
    ? PLANNER_FIXING_TASK_MODE
    : PLANNER_STANDARD_TASK_MODE;
}

function normalizeItemType(body, fallback = 'task') {
  const explicit = plannerItemType(body?.item_type || fallback);
  if (body?.item_type) return explicit;

  const kind = normalizeKind(body?.kind || fallback);
  if (kind === 'milestone') return 'milestone';

  const taskMode = normalizeTaskMode(body?.task_mode);
  if (taskMode === PLANNER_FIXING_TASK_MODE) return 'fixing_block';

  const category = normalizeCategory(body?.category || body?.work_category);
  if (category === 'drive_practice') return 'drive_practice_session';

  return 'task';
}

function legacyKindForItemType(itemType) {
  return itemType === 'milestone' ? 'milestone' : 'task';
}

function legacyTaskModeForItemType(itemType) {
  return itemType === 'fixing_block' ? PLANNER_FIXING_TASK_MODE : PLANNER_STANDARD_TASK_MODE;
}

function workCategoryForItemType(itemType, rawCategory) {
  if (itemType !== 'task') return null;
  return normalizeWorkCategory(rawCategory);
}

function ownerIdsForItemType(itemType, ownerIds = [], accountableUserId = null) {
  if (itemType === 'fixing_block') return [];
  if (itemType === 'milestone') {
    return Array.from(new Set([accountableUserId, ...ownerIds].filter(Boolean))).slice(0, 1);
  }
  return Array.from(new Set(ownerIds.filter(Boolean)));
}

function normalizeDateTime(rawValue) {
  const date = parsePlannerDateTimeInput(rawValue);
  if (!date || !Number.isFinite(date.getTime())) return null;
  return date.toISOString();
}

function normalizeRuleType(rawValue) {
  const value = String(rawValue || '').trim().toLowerCase();
  if (value === 'blocked') return 'blocked';
  if (value === 'drive_practice') return 'drive_practice';
  return 'work_window';
}

function normalizeRulePayload(body) {
  const ruleType = normalizeRuleType(body?.rule_type);
  const label = String(body?.label || '').trim();
  const specificDate = String(body?.specific_date || '').trim() || null;
  const weekday = body?.weekday === '' || body?.weekday === null || body?.weekday === undefined
    ? null
    : Number(body.weekday);
  const startsAt = String(body?.starts_at || '').trim();
  const endsAt = String(body?.ends_at || '').trim();
  const startsAtMinutes = parseClockToMinutes(startsAt);
  const endsAtMinutes = parseClockToMinutes(endsAt);

  if (!label) throw new Error('Calendar rule label is required.');
  if (weekday === null && !specificDate) throw new Error('Calendar rules need either a weekday or a specific date.');
  if (weekday !== null && (!Number.isInteger(weekday) || weekday < 0 || weekday > 6)) {
    throw new Error('Weekday must be between 0 and 6.');
  }
  if (startsAtMinutes === null || endsAtMinutes === null || startsAtMinutes >= endsAtMinutes) {
    throw new Error('Calendar rules need a valid start and end time.');
  }

  return {
    rule_type: ruleType,
    label,
    specific_date: specificDate,
    weekday,
    starts_at: startsAt,
    ends_at: endsAt,
    enabled: body?.enabled !== false
  };
}

function normalizePlannerActionError(error) {
  const message = String(error?.message || '').trim();

  return {
    status: 500,
    message: message || 'Planner action failed'
  };
}

async function requirePlannerActor(request) {
  const db = getPlannerDbFromRequest(request);
  const actor = await getPlannerActor(db);
  if (!actor) {
    return { db, actor: null, response: json({ error: 'Unauthorized' }, { status: 401 }) };
  }
  if (!plannerTeamEnabled(actor.frcTeam)) {
    return {
      db,
      actor,
      response: json({ error: 'Planner is only enabled for Team 971 and Team 9584 users.' }, { status: 403 })
    };
  }
  return { db, actor, response: null };
}

async function bundleResponse(db, team, warnings = []) {
  const bundle = await fetchPlannerBundle(db, team, { warnings });
  return json({ success: true, data: bundle });
}

export async function GET({ request }) {
  try {
    const { db, actor, response } = await requirePlannerActor(request);
    if (response) return response;
    return await bundleResponse(db, actor.frcTeam);
  } catch (error) {
    return json({ error: error?.message || 'Failed to load planner' }, { status: 500 });
  }
}

export async function POST({ request }) {
  const { db, actor, response } = await requirePlannerActor(request);
  if (response) return response;

  const body = await request.json().catch(() => ({}));
  const action = normalizeAction(body?.action);

  try {
    if (action === 'create-item') {
      const snapshot = await fetchPlannerSnapshot(db, actor.frcTeam);
      const itemType = normalizeItemType(body);
      const kind = legacyKindForItemType(itemType);
      const taskTemplate = itemType === 'task' ? normalizePlannerTaskTemplate(body?.task_template) : null;
      const taskMode = legacyTaskModeForItemType(itemType);
      const title = String(body?.title || '').trim();
      const details = itemType === 'fixing_block'
        ? null
        : (String(body?.details ?? body?.notes ?? '').trim() || null);
      const ownerIds = normalizeOwnerIds(body?.owner_ids);
      const p0BugIds = normalizeIdList(body?.p0_bug_ids);
      const partIds = Array.isArray(body?.part_ids) ? body.part_ids : [];
      const accountableUserId = String(body?.accountable_user_id || '').trim() || null;
      const nextOwnerIds = ownerIdsForItemType(itemType, ownerIds, accountableUserId);
      const normalizedStatus = normalizeStatus(body?.status, defaultStatusForItemType(itemType));
      const criticalLevel = normalizeCriticalLevel(body?.critical_level);

      if (!title) return json({ error: 'title required' }, { status: 400 });
      if ((itemType === 'task' || itemType === 'drive_practice_session') && nextOwnerIds.length === 0) {
        return json({ error: 'Tasks need at least one owner.' }, { status: 400 });
      }
      if (itemType === 'fixing_block' && p0BugIds.length === 0) {
        return json({ error: 'Fixing tasks need at least one linked P0 bug.' }, { status: 400 });
      }
      if (itemType === 'milestone' && nextOwnerIds.length !== 1) {
        return json({ error: 'Milestones need exactly one owner.' }, { status: 400 });
      }

      await ensurePlannerUsersOnTeam(
        db,
        actor.frcTeam,
        nextOwnerIds
      );
      if (itemType === 'task' && partIds.length) {
        await ensurePlannerPartsOnTeam(db, actor.frcTeam, partIds);
      }
      if (itemType === 'fixing_block') {
        await ensurePlannerP0BugsOnTeam(db, actor.frcTeam, p0BugIds);
      }

      const durationMinutes = kind === 'task'
        ? normalizeDurationMinutes(body, PLANNER_DEFAULT_TASK_DURATION_MINUTES)
        : null;
      const manualStartAt = normalizeDateTime(body?.manual_start_at);
      const sortOrder = snapshot.items.length
        ? Math.max(...snapshot.items.map((item) => Number(item.sort_order) || 0)) + 1000
        : 0;

      if (itemType === 'task' && taskTemplate === PLANNER_FULL_CYCLE_TASK_TEMPLATE) {
        const fullCycleSteps = buildFullCycleTaskSteps(durationMinutes);
        const createdItemIds = [];

        try {
          for (const [index, step] of fullCycleSteps.entries()) {
            const { data: created, error: createError } = await db
              .from('planner_items')
              .insert([{
                frc_team: actor.frcTeam,
                item_type: 'task',
                title: formatFullCycleTaskTitle(title, step.label),
                details,
                work_category: step.category,
                status: normalizedStatus,
                critical_level: criticalLevel,
                duration_minutes: step.duration_minutes,
                requested_duration_minutes: step.duration_minutes,
                min_duration_minutes: step.min_duration_minutes,
                manual_start_at: index === 0 ? manualStartAt : null,
                sort_order: sortOrder + (index * 1000),
                created_by: actor.id
              }])
              .select('id')
              .single();

            if (createError) throw createError;
            createdItemIds.push(created.id);
            await replacePlannerOwners(db, actor.frcTeam, created.id, nextOwnerIds, null);
          }

          const dependencyInserts = createdItemIds.slice(1).map((successorId, index) => ({
            frc_team: actor.frcTeam,
            predecessor_item_id: createdItemIds[index],
            successor_item_id: successorId,
            created_by: actor.id
          }));

          if (dependencyInserts.length) {
            const { error: dependencyError } = await db
              .from('planner_dependencies')
              .insert(dependencyInserts);
            if (dependencyError) throw dependencyError;
          }

          const recompute = await recomputePlannerTeam(db, actor.frcTeam);
          return await bundleResponse(db, actor.frcTeam, recompute.warnings);
        } catch (createError) {
          if (createdItemIds.length) {
            await db
              .from('planner_items')
              .delete()
              .eq('frc_team', actor.frcTeam)
              .in('id', createdItemIds);
          }
          throw createError;
        }
      }

      const minDurationMinutes = kind === 'task'
        ? normalizeMinDurationMinutes(body, durationMinutes)
        : PLANNER_DEFAULT_MIN_DURATION_MINUTES;

      const { data: created, error: createError } = await db
        .from('planner_items')
        .insert([{
          frc_team: actor.frcTeam,
          item_type: itemType,
          title,
          details,
          work_category: workCategoryForItemType(itemType, body?.work_category ?? body?.category),
          status: normalizedStatus,
          critical_level: criticalLevel,
          duration_minutes: durationMinutes,
          requested_duration_minutes: durationMinutes,
          min_duration_minutes: minDurationMinutes,
          manual_start_at: manualStartAt,
          sort_order: sortOrder,
          created_by: actor.id
        }])
        .select('id')
        .single();

      if (createError) throw createError;

      if (itemType === 'fixing_block') {
        await replacePlannerP0BugLinks(db, actor.frcTeam, created.id, p0BugIds, actor.id);
      }
      await replacePlannerOwners(db, actor.frcTeam, created.id, nextOwnerIds, null);
      if (itemType === 'task') {
        await replacePlannerItemPartLinks(db, actor.frcTeam, created.id, partIds);
      }
      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    if (action === 'update-item') {
      const itemId = String(body?.item_id || '').trim();
      if (!itemId) return json({ error: 'item_id required' }, { status: 400 });

      const { data: existing, error: existingError } = await db
        .from('planner_items')
        .select('id, frc_team, item_type, status, duration_minutes, requested_duration_minutes, min_duration_minutes')
        .eq('id', itemId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing?.id || existing.frc_team !== actor.frcTeam) {
        return json({ error: 'Planner item not found' }, { status: 404 });
      }

      const existingItemType = plannerItemType(existing.item_type);
      const itemType = body?.item_type !== undefined || body?.kind !== undefined || body?.task_mode !== undefined || body?.category !== undefined
        ? normalizeItemType(body, existingItemType)
        : existingItemType;
      const kind = legacyKindForItemType(itemType);
      const existingTaskMode = legacyTaskModeForItemType(existingItemType);
      const taskMode = legacyTaskModeForItemType(itemType);
      const updatePayload = {};
      if (body?.title !== undefined) {
        const title = String(body.title || '').trim();
        if (!title) return json({ error: 'title required' }, { status: 400 });
        updatePayload.title = title;
      }
      if (body?.details !== undefined || body?.notes !== undefined || itemType === 'fixing_block') {
        updatePayload.details = itemType === 'fixing_block'
          ? null
          : (String(body?.details ?? body?.notes ?? '').trim() || null);
      }
      if (body?.status !== undefined) {
        updatePayload.status = normalizeStatus(body.status, existing.status || defaultStatusForItemType(itemType));
      }
      if (body?.critical_level !== undefined) updatePayload.critical_level = normalizeCriticalLevel(body.critical_level);
      if (body?.item_type !== undefined || body?.kind !== undefined || body?.task_mode !== undefined || body?.category !== undefined || body?.work_category !== undefined) {
        updatePayload.item_type = itemType;
      }
      if (body?.category !== undefined || body?.work_category !== undefined || itemType !== 'task') {
        updatePayload.work_category = workCategoryForItemType(itemType, body?.work_category ?? body?.category);
      }

      if (kind === 'task') {
        if (body?.duration_minutes !== undefined || body?.duration_hours !== undefined) {
          const nextRequestedDuration = normalizeDurationMinutes(
            body,
            existing.requested_duration_minutes || existing.duration_minutes || PLANNER_DEFAULT_TASK_DURATION_MINUTES
          );
          updatePayload.duration_minutes = nextRequestedDuration;
          updatePayload.requested_duration_minutes = nextRequestedDuration;
        }
        if (body?.min_duration_minutes !== undefined || body?.min_duration_hours !== undefined) {
          const nextDuration =
            updatePayload.requested_duration_minutes ||
            existing.requested_duration_minutes ||
            existing.duration_minutes ||
            PLANNER_DEFAULT_TASK_DURATION_MINUTES;
          updatePayload.min_duration_minutes = normalizeMinDurationMinutes(body, nextDuration);
        }
        if (body?.manual_start_at !== undefined) {
          updatePayload.manual_start_at = normalizeDateTime(body.manual_start_at);
        }
      } else {
        if (body?.manual_start_at !== undefined) {
          updatePayload.manual_start_at = normalizeDateTime(body.manual_start_at);
        }
        updatePayload.work_category = null;
      }

      if (Object.keys(updatePayload).length) {
        const { error: updateError } = await db
          .from('planner_items')
          .update(updatePayload)
          .eq('id', itemId);
        if (updateError) throw updateError;
      }

      const ownerIds = body?.owner_ids !== undefined ? normalizeOwnerIds(body.owner_ids) : null;
      const p0BugIds = body?.p0_bug_ids !== undefined ? normalizeIdList(body.p0_bug_ids) : null;
      const accountableUserId = body?.accountable_user_id !== undefined
        ? (String(body.accountable_user_id || '').trim() || null)
        : undefined;

      if (itemType === 'fixing_block') {
        let nextP0BugIds = p0BugIds;
        if (nextP0BugIds === null) {
          const { data: existingLinks, error: linkError } = await db
            .from('planner_item_p0_bugs')
            .select('p0_bug_item_id')
            .eq('frc_team', actor.frcTeam)
            .eq('planner_item_id', itemId);
          if (linkError) throw linkError;
          nextP0BugIds = (existingLinks || []).map((row) => row.p0_bug_item_id).filter(Boolean);
        }
        if (!nextP0BugIds.length) {
          return json({ error: 'Fixing tasks need at least one linked P0 bug.' }, { status: 400 });
        }
        await ensurePlannerP0BugsOnTeam(db, actor.frcTeam, nextP0BugIds);
        await replacePlannerP0BugLinks(db, actor.frcTeam, itemId, nextP0BugIds, actor.id);
        await replacePlannerOwners(db, actor.frcTeam, itemId, [], null);
      } else if (existingItemType === 'fixing_block') {
        if (ownerIds === null) {
          return json({ error: 'Tasks need at least one owner.' }, { status: 400 });
        }
        await replacePlannerP0BugLinks(db, actor.frcTeam, itemId, [], actor.id);
      } else if (kind !== 'task' && p0BugIds !== null) {
        await replacePlannerP0BugLinks(db, actor.frcTeam, itemId, [], actor.id);
      }

      if (ownerIds !== null || accountableUserId !== undefined) {
        const nextOwnerIds = ownerIdsForItemType(
          itemType,
          ownerIds ?? [],
          accountableUserId === undefined ? null : accountableUserId
        );
        if ((itemType === 'task' || itemType === 'drive_practice_session') && nextOwnerIds.length === 0) {
          return json({ error: 'Tasks need at least one owner.' }, { status: 400 });
        }
        if (itemType === 'milestone' && nextOwnerIds.length !== 1) {
          return json({ error: 'Milestones need exactly one owner.' }, { status: 400 });
        }
        if (itemType === 'fixing_block') {
          // Fixing tasks deliberately keep ownership empty and only track linked P0 bugs.
        } else {
          await ensurePlannerUsersOnTeam(db, actor.frcTeam, nextOwnerIds);
          await replacePlannerOwners(db, actor.frcTeam, itemId, nextOwnerIds, null);
        }
      }

      if (body?.part_ids !== undefined) {
        if (itemType !== 'task') {
          return json({ error: 'Only standard tasks can link parts.' }, { status: 400 });
        }
        const partIds = Array.isArray(body.part_ids) ? body.part_ids : [];
        await ensurePlannerPartsOnTeam(db, actor.frcTeam, partIds);
        await replacePlannerItemPartLinks(db, actor.frcTeam, itemId, partIds);
      }

      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    if (action === 'delete-item') {
      const itemId = String(body?.item_id || '').trim();
      if (!itemId) return json({ error: 'item_id required' }, { status: 400 });
      const { error } = await db
        .from('planner_items')
        .delete()
        .eq('frc_team', actor.frcTeam)
        .eq('id', itemId);
      if (error) throw error;
      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    if (action === 'add-dependency') {
      const predecessorId = String(body?.predecessor_item_id || '').trim();
      const successorId = String(body?.successor_item_id || '').trim();
      if (!predecessorId || !successorId) {
        return json({ error: 'predecessor_item_id and successor_item_id required' }, { status: 400 });
      }
      if (predecessorId === successorId) {
        return json({ error: 'An item cannot depend on itself.' }, { status: 400 });
      }

      const snapshot = await fetchPlannerSnapshot(db, actor.frcTeam);
      const itemIds = new Set(snapshot.items.map((item) => item.id));
      if (!itemIds.has(predecessorId) || !itemIds.has(successorId)) {
        return json({ error: 'Both planner items must exist on your team.' }, { status: 400 });
      }
      if (detectCycleIfDependencyAdded(snapshot.items, snapshot.dependencies, predecessorId, successorId)) {
        return json({ error: 'That dependency would create a cycle.' }, { status: 400 });
      }

      const { error } = await db
        .from('planner_dependencies')
        .insert([{
          frc_team: actor.frcTeam,
          predecessor_item_id: predecessorId,
          successor_item_id: successorId,
          created_by: actor.id
        }]);
      if (error) throw error;
      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    if (action === 'delete-dependency') {
      const dependencyId = String(body?.dependency_id || '').trim();
      if (!dependencyId) return json({ error: 'dependency_id required' }, { status: 400 });
      const { error } = await db
        .from('planner_dependencies')
        .delete()
        .eq('frc_team', actor.frcTeam)
        .eq('id', dependencyId);
      if (error) throw error;
      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    if (action === 'create-calendar-rule') {
      const payload = normalizeRulePayload(body);
      const recipientIds = normalizeOwnerIds(body?.recipient_ids);
      if (payload.rule_type === 'drive_practice' && !recipientIds.length) {
        return json({ error: 'Drive practice rules need at least one recipient.' }, { status: 400 });
      }
      if (payload.rule_type === 'drive_practice') {
        await ensurePlannerUsersOnTeam(db, actor.frcTeam, recipientIds);
      }
      const { data: createdRule, error } = await db
        .from('planner_calendar_rules')
        .insert([{
          frc_team: actor.frcTeam,
          ...payload,
          is_default: false,
          created_by: actor.id
        }])
        .select('id')
        .single();
      if (error) throw error;
      if (payload.rule_type === 'drive_practice') {
        await replacePlannerRuleRecipients(db, actor.frcTeam, createdRule.id, recipientIds);
      }
      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    if (action === 'update-calendar-rule') {
      const ruleId = String(body?.rule_id || '').trim();
      if (!ruleId) return json({ error: 'rule_id required' }, { status: 400 });
      const payload = normalizeRulePayload(body);
      const recipientIds = normalizeOwnerIds(body?.recipient_ids);
      if (payload.rule_type === 'drive_practice' && !recipientIds.length) {
        return json({ error: 'Drive practice rules need at least one recipient.' }, { status: 400 });
      }
      const { error } = await db
        .from('planner_calendar_rules')
        .update(payload)
        .eq('frc_team', actor.frcTeam)
        .eq('id', ruleId);
      if (error) throw error;
      if (payload.rule_type === 'drive_practice') {
        await ensurePlannerUsersOnTeam(db, actor.frcTeam, recipientIds);
        await replacePlannerRuleRecipients(db, actor.frcTeam, ruleId, recipientIds);
      } else {
        await replacePlannerRuleRecipients(db, actor.frcTeam, ruleId, []);
      }
      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    if (action === 'delete-calendar-rule') {
      const ruleId = String(body?.rule_id || '').trim();
      if (!ruleId) return json({ error: 'rule_id required' }, { status: 400 });
      const { error } = await db
        .from('planner_calendar_rules')
        .delete()
        .eq('frc_team', actor.frcTeam)
        .eq('id', ruleId);
      if (error) throw error;
      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    if (action === 'reorder-items') {
      const itemIds = Array.isArray(body?.item_ids) ? body.item_ids.map((value) => String(value || '').trim()).filter(Boolean) : [];
      if (!itemIds.length) return json({ error: 'item_ids required' }, { status: 400 });
      for (let index = 0; index < itemIds.length; index += 1) {
        const { error } = await db
          .from('planner_items')
          .update({ sort_order: index * 1000 })
          .eq('frc_team', actor.frcTeam)
          .eq('id', itemIds[index]);
        if (error) throw error;
      }
      const recompute = await recomputePlannerTeam(db, actor.frcTeam);
      return await bundleResponse(db, actor.frcTeam, recompute.warnings);
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    const normalized = normalizePlannerActionError(error);
    return json({ error: normalized.message }, { status: normalized.status });
  }
}
