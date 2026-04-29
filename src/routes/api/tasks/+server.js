import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import {
  addDrivePracticeBugReportLinks,
  ensurePlannerP0BugsOnTeam,
  ensurePlannerUsersOnTeam,
  fetchPlannerP0BugRows,
  fetchPlannerTeamPeople,
  normalizeP0BugStatus,
  recomputePlannerTeam,
  replacePlannerOwners
} from '$lib/server/planner_data.js';
import {
  notifyTaskAssignedById,
  notifyTaskReviewRequestedById,
  notifyTaskStatusChanged
} from '$lib/server/slack_notifications.js';

const GENERAL_TYPES = ['CAD', 'Mechanical', 'Electrical', 'Software', 'Other'];

function getClientFromRequest(request) {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function sanitizeFileName(raw) {
  return String(raw || 'task-file').replace(/[^a-zA-Z0-9._-]/g, '_');
}

async function getActor(authSupa) {
  const { data: authData, error: authErr } = await authSupa.auth.getUser();
  if (authErr || !authData?.user?.id) return null;
  const actorId = authData.user.id;
  const { data: profile } = await authSupa
    .from('user_profiles')
    .select('id, full_name, email, frc_team, role, banned')
    .eq('id', actorId)
    .maybeSingle();
  if (!profile?.id || profile?.banned) return null;
  return {
    id: profile.id,
    fullName: profile.full_name || null,
    email: profile.email || null,
    frcTeam: profile.frc_team || null,
    role: profile.role || 'member'
  };
}

async function fetchSubsystemMembers(db, subsystemIds, team) {
  const bySubsystem = {};
  if (!Array.isArray(subsystemIds) || subsystemIds.length === 0) return bySubsystem;
  const { data, error } = await db
    .from('subsystem_members')
    .select('subsystem_id, user_id')
    .in('subsystem_id', subsystemIds);
  if (error) throw error;

  const userIds = [...new Set((data || []).map((row) => row?.user_id).filter(Boolean))];
  let userMap = new Map();
  if (userIds.length > 0) {
    const { data: users, error: userError } = await db
      .from('user_profiles')
      .select('id, full_name, email, frc_team, banned')
      .in('id', userIds);
    if (userError) throw userError;
    userMap = new Map((users || []).map((user) => [user.id, user]));
  }

  for (const row of data || []) {
    const subsystemId = row?.subsystem_id;
    const user = row?.user_id ? userMap.get(row.user_id) : null;
    if (!subsystemId || !user?.id || user?.banned || user?.frc_team !== team) continue;
    if (!bySubsystem[subsystemId]) bySubsystem[subsystemId] = [];
    bySubsystem[subsystemId].push({
      id: user.id,
      full_name: user.full_name || null,
      email: user.email || null
    });
  }

  for (const subsystemId of Object.keys(bySubsystem)) {
    bySubsystem[subsystemId].sort((left, right) =>
      (left.full_name || left.email || '').localeCompare(right.full_name || right.email || '', undefined, { sensitivity: 'base' })
    );
  }
  return bySubsystem;
}

async function fetchGeneralCandidates(db, team) {
  const grouped = Object.fromEntries(GENERAL_TYPES.map((key) => [key, []]));
  const { data: users, error } = await db
    .from('user_profiles')
    .select('id, full_name, email, frc_team, banned, task_general_categories')
    .eq('frc_team', team);
  if (error) {
    const message = String(error?.message || '').toLowerCase();
    if (message.includes('task_general_categories')) return grouped;
    throw error;
  }

  for (const user of users || []) {
    if (!user?.id || user?.banned) continue;
    const categories = Array.isArray(user.task_general_categories)
      ? user.task_general_categories
      : [];
    for (const rawCategory of categories) {
      const match = GENERAL_TYPES.find((type) => normalizeKey(type) === normalizeKey(rawCategory));
      if (!match) continue;
      grouped[match].push({
        id: user.id,
        full_name: user.full_name || null,
        email: user.email || null
      });
    }
  }

  for (const type of GENERAL_TYPES) {
    const seenIds = new Set();
    grouped[type] = grouped[type]
      .filter((person) => {
        if (!person?.id || seenIds.has(person.id)) return false;
        seenIds.add(person.id);
        return true;
      })
      .sort((left, right) =>
        (left.full_name || left.email || '').localeCompare(right.full_name || right.email || '', undefined, { sensitivity: 'base' })
      );
  }

  return grouped;
}

async function fetchTaskOwnerId(db, taskId) {
  const { data, error } = await db
    .from('planner_item_people')
    .select('user_id')
    .eq('planner_item_id', taskId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data?.user_id || null;
}

async function fetchTaskPartIds(db, team, taskId) {
  const { data, error } = await db
    .from('planner_item_parts')
    .select('part_id')
    .eq('frc_team', team)
    .eq('planner_item_id', taskId);
  if (error) throw error;
  return Array.from(new Set((data || []).map((row) => Number(row.part_id)).filter(Number.isFinite)));
}

async function validateTaskOwnership(db, { actor, scope, generalType, subsystemId, ownerId }) {
  if (!ownerId) {
    return { error: 'owner_id required' };
  }

  if (scope === 'general' && !GENERAL_TYPES.includes(generalType)) {
    return { error: 'general_type required for general P0 bugs' };
  }

  if (scope === 'subsystem') {
    if (!subsystemId) return { error: 'subsystem_id required for subsystem P0 bugs' };
    const { data: subsystem, error: subsystemError } = await db
      .from('subsystems')
      .select('id, frc_team')
      .eq('id', subsystemId)
      .maybeSingle();
    if (subsystemError) throw subsystemError;
    if (!subsystem?.id || subsystem?.frc_team !== actor.frcTeam) {
      return { error: 'Invalid subsystem for your team' };
    }
  }

  await ensurePlannerUsersOnTeam(db, actor.frcTeam, [ownerId]);
  return { error: null };
}

async function fetchTasksBundle(db, team) {
  const { data: subsystems, error: subsystemsError } = await db
    .from('subsystems')
    .select('id, name, frc_team')
    .eq('frc_team', team)
    .order('name', { ascending: true });
  if (subsystemsError) throw subsystemsError;

  const subsystemIds = (subsystems || []).map((subsystem) => subsystem.id).filter(Boolean);
  const [subsystemMembers, generalCandidates, people, tasks] = await Promise.all([
    fetchSubsystemMembers(db, subsystemIds, team),
    fetchGeneralCandidates(db, team),
    fetchPlannerTeamPeople(db, team),
    fetchPlannerP0BugRows(db, team, { includeCompleted: true })
  ]);

  return {
    tasks,
    people,
    subsystems: subsystems || [],
    subsystem_members: subsystemMembers,
    general_candidates: generalCandidates
  };
}

function normalizeP0Scope(rawValue) {
  return String(rawValue || '').trim().toLowerCase() === 'subsystem' ? 'subsystem' : 'general';
}

function canMutateTask(actor, existing, ownerId) {
  return actor.role === 'admin' || actor.id === existing.created_by || actor.id === ownerId;
}

async function fetchExistingP0Bug(db, team, taskId) {
  const { data: existing, error } = await db
    .from('planner_items')
    .select('id, frc_team, item_type, created_by, status, title, scope, general_type, subsystem_id, needs_manufacturing, attachment_path, attachment_name, attachment_uploaded_at')
    .eq('id', taskId)
    .eq('frc_team', team)
    .eq('item_type', 'p0_bug')
    .maybeSingle();
  if (error) throw error;
  return existing || null;
}

export async function GET({ request }) {
  try {
    const db = getClientFromRequest(request);
    const actor = await getActor(db);
    if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!actor.frcTeam || (actor.frcTeam !== '971' && actor.frcTeam !== '9584')) {
      return json({ error: 'Tasks are only enabled for Team 971 and Team 9584 users.' }, { status: 403 });
    }

    const bundle = await fetchTasksBundle(db, actor.frcTeam);
    return json({ success: true, data: bundle });
  } catch (error) {
    return json({ error: error?.message || 'Failed to load tasks' }, { status: 500 });
  }
}

export async function POST({ request }) {
  const db = getClientFromRequest(request);
  const actor = await getActor(db);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });
  if (!actor.frcTeam || (actor.frcTeam !== '971' && actor.frcTeam !== '9584')) {
    return json({ error: 'Tasks are only enabled for Team 971 and Team 9584 users.' }, { status: 403 });
  }

  const body = await request.json().catch(() => ({}));
  const action = String(body?.action || '').trim().toLowerCase();

  try {
    if (action === 'create') {
      const title = String(body?.title || '').trim();
      const details = String(body?.details ?? body?.description ?? '').trim() || null;
      const scope = normalizeP0Scope(body?.scope);
      const generalType = scope === 'general' ? String(body?.general_type || '').trim() : null;
      const subsystemId = scope === 'subsystem' ? String(body?.subsystem_id || '').trim() : null;
      const ownerId = String(body?.owner_id || body?.assignee_id || actor.id || '').trim() || null;
      const needsManufacturing = !!body?.needs_manufacturing;
      const status = normalizeP0BugStatus(body?.status);

      if (!title) return json({ error: 'title required' }, { status: 400 });

      const ownershipValidation = await validateTaskOwnership(db, {
        actor,
        scope,
        generalType,
        subsystemId,
        ownerId
      });
      if (ownershipValidation.error) {
        return json({ error: ownershipValidation.error }, { status: 400 });
      }

      const { data: lastItem } = await db
        .from('planner_items')
        .select('sort_order')
        .eq('frc_team', actor.frcTeam)
        .order('sort_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      const sortOrder = (Number(lastItem?.sort_order) || 0) + 1000;

      const { data: created, error: createError } = await db
        .from('planner_items')
        .insert([{
          frc_team: actor.frcTeam,
          item_type: 'p0_bug',
          title,
          details,
          work_category: null,
          status,
          critical_level: 1,
          duration_minutes: 120,
          requested_duration_minutes: 120,
          min_duration_minutes: 30,
          manual_start_at: null,
          sort_order: sortOrder,
          created_by: actor.id,
          scope,
          general_type: scope === 'general' ? generalType : null,
          subsystem_id: scope === 'subsystem' ? subsystemId : null,
          needs_manufacturing: needsManufacturing
        }])
        .select('id')
        .single();
      if (createError) throw createError;

      await replacePlannerOwners(db, actor.frcTeam, created.id, [ownerId], null);
      await notifyTaskAssignedById(created.id);

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle, created_task_id: created.id });
    }

    if (action === 'update-metadata') {
      const taskId = String(body?.task_id || body?.item_id || '').trim();
      if (!taskId) return json({ error: 'task_id required' }, { status: 400 });

      const existing = await fetchExistingP0Bug(db, actor.frcTeam, taskId);
      if (!existing?.id) return json({ error: 'Task not found' }, { status: 404 });

      const currentOwnerId = await fetchTaskOwnerId(db, taskId);
      if (!canMutateTask(actor, existing, currentOwnerId)) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }

      const title = String(body?.title || '').trim();
      const details = String(body?.details ?? body?.description ?? '').trim() || null;
      const scope = normalizeP0Scope(body?.scope || existing.scope);
      const generalType = scope === 'general'
        ? String(body?.general_type ?? existing.general_type ?? '').trim()
        : null;
      const subsystemId = scope === 'subsystem'
        ? String(body?.subsystem_id ?? existing.subsystem_id ?? '').trim()
        : null;
      const ownerId = String(body?.owner_id || body?.assignee_id || currentOwnerId || '').trim() || null;
      const needsManufacturing = body?.needs_manufacturing === undefined
        ? !!existing.needs_manufacturing
        : !!body?.needs_manufacturing;
      const status = body?.status === undefined
        ? normalizeP0BugStatus(existing.status)
        : normalizeP0BugStatus(body?.status);

      if (!title) return json({ error: 'title required' }, { status: 400 });

      const ownershipValidation = await validateTaskOwnership(db, {
        actor,
        scope,
        generalType,
        subsystemId,
        ownerId
      });
      if (ownershipValidation.error) {
        return json({ error: ownershipValidation.error }, { status: 400 });
      }

      const { error: updateError } = await db
        .from('planner_items')
        .update({
          title,
          details,
          status,
          scope,
          general_type: scope === 'general' ? generalType : null,
          subsystem_id: scope === 'subsystem' ? subsystemId : null,
          needs_manufacturing: needsManufacturing
        })
        .eq('id', taskId);
      if (updateError) throw updateError;

      await replacePlannerOwners(db, actor.frcTeam, taskId, [ownerId], null);
      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'upload-file') {
      const taskId = String(body?.task_id || body?.item_id || '').trim();
      const attachmentPath = String(body?.attachment_path || '').trim();
      const attachmentName = sanitizeFileName(body?.attachment_name || '');
      if (!taskId || !attachmentPath) {
        return json({ error: 'task_id and attachment_path required' }, { status: 400 });
      }

      const existing = await fetchExistingP0Bug(db, actor.frcTeam, taskId);
      if (!existing?.id) return json({ error: 'Task not found' }, { status: 404 });

      const currentOwnerId = await fetchTaskOwnerId(db, taskId);
      if (!canMutateTask(actor, existing, currentOwnerId)) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }

      const { error: updateError } = await db
        .from('planner_items')
        .update({
          attachment_path: attachmentPath,
          attachment_name: attachmentName || null,
          attachment_uploaded_at: new Date().toISOString()
        })
        .eq('id', taskId);
      if (updateError) throw updateError;

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'review') {
      await notifyTaskReviewRequestedById(String(body?.task_id || '').trim());
      return json({ error: 'P0 bug review flow has been removed.' }, { status: 400 });
    }

    if (action === 'set-status') {
      const taskId = String(body?.task_id || body?.item_id || '').trim();
      const nextStatus = normalizeP0BugStatus(body?.status);
      if (!taskId) return json({ error: 'task_id required' }, { status: 400 });

      const existing = await fetchExistingP0Bug(db, actor.frcTeam, taskId);
      if (!existing?.id) return json({ error: 'Task not found' }, { status: 404 });

      const currentOwnerId = await fetchTaskOwnerId(db, taskId);
      if (!canMutateTask(actor, existing, currentOwnerId)) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }

      const previousStatus = normalizeP0BugStatus(existing.status);
      if (previousStatus === nextStatus) {
        const bundle = await fetchTasksBundle(db, actor.frcTeam);
        return json({ success: true, data: bundle });
      }

      const { error: updateError } = await db
        .from('planner_items')
        .update({ status: nextStatus })
        .eq('id', taskId);
      if (updateError) throw updateError;

      await notifyTaskStatusChanged({
        taskId,
        previousStatus,
        nextStatus,
        changedByName: actor.fullName || actor.email || 'Teammate',
        changedByUserId: actor.id
      });

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'delete') {
      const taskId = String(body?.task_id || body?.item_id || '').trim();
      if (!taskId) return json({ error: 'task_id required' }, { status: 400 });

      const existing = await fetchExistingP0Bug(db, actor.frcTeam, taskId);
      if (!existing?.id) return json({ error: 'Task not found' }, { status: 404 });

      const currentOwnerId = await fetchTaskOwnerId(db, taskId);
      if (!canMutateTask(actor, existing, currentOwnerId)) {
        return json({ error: 'Forbidden' }, { status: 403 });
      }

      const { data: linkedPlannerItems, error: linkedPlannerItemsError } = await db
        .from('planner_item_p0_bugs')
        .select('planner_item_id')
        .eq('frc_team', actor.frcTeam)
        .eq('p0_bug_item_id', taskId)
        .is('report_area', null);
      if (linkedPlannerItemsError) throw linkedPlannerItemsError;

      const linkedPlannerItemIds = Array.from(new Set((linkedPlannerItems || []).map((row) => row.planner_item_id).filter(Boolean)));

      const { error: deleteError } = await db
        .from('planner_items')
        .delete()
        .eq('frc_team', actor.frcTeam)
        .eq('id', taskId)
        .eq('item_type', 'p0_bug');
      if (deleteError) throw deleteError;

      if (linkedPlannerItemIds.length) {
        const { data: remainingLinks, error: remainingLinksError } = await db
          .from('planner_item_p0_bugs')
          .select('planner_item_id')
          .eq('frc_team', actor.frcTeam)
          .in('planner_item_id', linkedPlannerItemIds)
          .is('report_area', null);
        if (remainingLinksError) throw remainingLinksError;

        const itemsWithLinks = new Set((remainingLinks || []).map((row) => row.planner_item_id).filter(Boolean));
        const orphanedIds = linkedPlannerItemIds.filter((itemId) => !itemsWithLinks.has(itemId));

        if (orphanedIds.length) {
          const { error: plannerDeleteError } = await db
            .from('planner_items')
            .delete()
            .eq('frc_team', actor.frcTeam)
            .eq('item_type', 'fixing_block')
            .in('id', orphanedIds);
          if (plannerDeleteError) throw plannerDeleteError;

          await recomputePlannerTeam(db, actor.frcTeam);
        }
      }

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'add-to-parts') {
      const taskId = String(body?.task_id || body?.item_id || '').trim();
      const workflow = String(body?.workflow || 'mill').trim();
      if (!taskId) return json({ error: 'task_id required' }, { status: 400 });

      const task = await fetchExistingP0Bug(db, actor.frcTeam, taskId);
      if (!task?.id) return json({ error: 'Task not found' }, { status: 404 });

      const linkedPartIds = await fetchTaskPartIds(db, actor.frcTeam, taskId);
      if (linkedPartIds.length) return json({ error: 'Task already linked to parts' }, { status: 400 });
      if (!task.needs_manufacturing) return json({ error: 'Task is not marked for manufacturing' }, { status: 400 });
      if (!task.attachment_path) return json({ error: 'Task must have an uploaded file before adding to parts' }, { status: 400 });

      const safeWorkflow = ['laser-cut', 'router', 'lathe', 'mill', '3d-print'].includes(workflow) ? workflow : 'mill';
      const requester = actor.fullName || actor.email || 'Task System';
      let projectId = 'Task Misc';
      if (task.scope === 'subsystem' && task.subsystem_id) {
        const { data: subsystem } = await db
          .from('subsystems')
          .select('name')
          .eq('id', task.subsystem_id)
          .maybeSingle();
        projectId = subsystem?.name || 'Task Misc';
      } else if (task.scope === 'general') {
        projectId = `${task.general_type || task.title || 'Task'} Misc`;
      }

      const fileName = task.attachment_name || sanitizeFileName(task.title || 'task-file');
      const { data: insertedPart, error: insertError } = await db
        .from('parts')
        .insert([{
          name: task.title,
          requester,
          project_id: projectId,
          workflow: safeWorkflow,
          quantity: 1,
          stock_assignment: 'Task Misc',
          file_name: fileName,
          file_url: task.attachment_path,
          status: 'pending',
          frc_team: task.frc_team
        }])
        .select('id')
        .single();
      if (insertError) throw insertError;

      const { error: linkError } = await db
        .from('planner_item_parts')
        .insert([{
          frc_team: actor.frcTeam,
          planner_item_id: taskId,
          part_id: insertedPart.id
        }]);
      if (linkError) throw linkError;

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'check-deadline-status') {
      return json({ success: true, data: { overdue_count: 0 } });
    }

    if (action === 'link-drive-practice-bugs') {
      const plannerItemId = String(body?.planner_item_id || '').trim();
      const reportArea = String(body?.report_area || '').trim().toLowerCase();
      const taskIds = Array.isArray(body?.task_ids)
        ? Array.from(new Set(body.task_ids.map((value) => String(value || '').trim()).filter(Boolean)))
        : [];

      if (!plannerItemId || !taskIds.length || !reportArea) {
        return json({ error: 'planner_item_id, report_area, and task_ids required' }, { status: 400 });
      }
      if (!['vision', 'software', 'electrical', 'mechanical', 'brownout'].includes(reportArea)) {
        return json({ error: 'Invalid drive practice report area.' }, { status: 400 });
      }

      const { data: plannerItem, error: plannerItemError } = await db
        .from('planner_items')
        .select('id, frc_team, item_type')
        .eq('id', plannerItemId)
        .maybeSingle();
      if (plannerItemError) throw plannerItemError;
      if (!plannerItem?.id || plannerItem.frc_team !== actor.frcTeam) {
        return json({ error: 'Drive practice not found' }, { status: 404 });
      }
      if (plannerItem.item_type !== 'drive_practice_session') {
        return json({ error: 'Only drive practice tasks can track reported P0 bugs.' }, { status: 400 });
      }

      await ensurePlannerP0BugsOnTeam(db, actor.frcTeam, taskIds);
      await addDrivePracticeBugReportLinks(db, actor.frcTeam, plannerItemId, taskIds, actor.id, reportArea);
      return json({ success: true, linked_task_ids: taskIds });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return json({ error: error?.message || 'Task action failed' }, { status: 500 });
  }
}
