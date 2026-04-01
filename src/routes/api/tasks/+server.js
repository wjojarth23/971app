import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { parsePacificDateTimeInput } from '$lib/timezone.js';
import { createPlannerFixingTaskFromP0Bug } from '$lib/server/planner_data.js';
import {
  notifyTaskAssignedById,
  notifyTaskReviewRequestedById,
  notifyTaskStatusChanged
} from '$lib/server/slack_notifications.js';

const GENERAL_TYPES = ['CAD', 'Mechanical', 'Electrical', 'Software', 'Other'];
const OPEN_STATUSES = new Set(['open', 'in_progress', 'file_uploaded', 'under_review', 'changes_requested']);
const CLOSABLE_STATUSES = new Set([...OPEN_STATUSES, 'approved', 'done', 'closed']);

function getClientFromRequest(request) {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function toGeneralTypeFromKey(keyName) {
  const key = normalizeKey(keyName);
  if (!key) return null;
  if (key.includes('cad')) return 'CAD';
  if (key.includes('mechanical')) return 'Mechanical';
  if (key.includes('electrical')) return 'Electrical';
  if (key.includes('software')) return 'Software';
  if (key.includes('other')) return 'Other';
  return null;
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
    userMap = new Map((users || []).map((u) => [u.id, u]));
  }

  for (const row of data || []) {
    const sid = row?.subsystem_id;
    const user = row?.user_id ? userMap.get(row.user_id) : null;
    if (!sid || !user?.id || user?.banned || user?.frc_team !== team) continue;
    if (!bySubsystem[sid]) bySubsystem[sid] = [];
    bySubsystem[sid].push({
      id: user.id,
      full_name: user.full_name || null,
      email: user.email || null
    });
  }
  for (const sid of Object.keys(bySubsystem)) {
    bySubsystem[sid].sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', undefined, { sensitivity: 'base' }));
  }
  return bySubsystem;
}

async function fetchGeneralCandidates(db, team) {
  const grouped = Object.fromEntries(GENERAL_TYPES.map((k) => [k, []]));
  const { data: users, error } = await db
    .from('user_profiles')
    .select('id, full_name, email, frc_team, banned, task_general_categories')
    .eq('frc_team', team);
  if (error) {
    const msg = String(error?.message || '').toLowerCase();
    if (msg.includes('task_general_categories')) return grouped;
    throw error;
  }

  for (const user of users || []) {
    if (!user?.id || user?.banned) continue;
    const categories = Array.isArray(user.task_general_categories)
      ? user.task_general_categories
      : [];
    for (const rawCategory of categories) {
      const category = GENERAL_TYPES.find((t) => normalizeKey(t) === normalizeKey(rawCategory));
      if (!category) continue;
      grouped[category].push({
        id: user.id,
        full_name: user.full_name || null,
        email: user.email || null
      });
    }
  }

  for (const type of GENERAL_TYPES) {
    const seenIds = new Set();
    grouped[type] = grouped[type].filter((person) => {
      if (!person?.id || seenIds.has(person.id)) return false;
      seenIds.add(person.id);
      return true;
    });
    grouped[type].sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || '', undefined, { sensitivity: 'base' }));
  }
  return grouped;
}

async function fetchTasksBundle(db, team) {
  const { data: subsystems, error: subsystemsError } = await db
    .from('subsystems')
    .select('id, name, frc_team')
    .eq('frc_team', team)
    .order('name', { ascending: true });
  if (subsystemsError) throw subsystemsError;

  const subsystemIds = (subsystems || []).map((s) => s.id).filter(Boolean);
  const [subsystemMembers, generalCandidates] = await Promise.all([
    fetchSubsystemMembers(db, subsystemIds, team),
    fetchGeneralCandidates(db, team)
  ]);

  const { data: taskRows, error: tasksError } = await db
    .from('tasks')
    .select(`
      id,
      frc_team,
      title,
      description,
      scope,
      general_type,
      subsystem_id,
      assignee_id,
      reviewer_id,
      created_by,
      needs_review,
      needs_manufacturing,
      deadline_at,
      status,
      review_decision,
      review_notes,
      reviewed_at,
      attachment_path,
      attachment_name,
      attachment_uploaded_at,
      parts_id,
      created_at,
      updated_at
    `)
    .eq('frc_team', team)
    .order('created_at', { ascending: false });
  if (tasksError) throw tasksError;

  const userIds = new Set();
  for (const row of taskRows || []) {
    if (row?.assignee_id) userIds.add(row.assignee_id);
    if (row?.reviewer_id) userIds.add(row.reviewer_id);
    if (row?.created_by) userIds.add(row.created_by);
  }
  const userIdList = [...userIds];
  let userMap = new Map();
  if (userIdList.length) {
    const { data: users, error: usersError } = await db
      .from('user_profiles')
      .select('id, full_name, email')
      .in('id', userIdList);
    if (usersError) throw usersError;
    userMap = new Map((users || []).map((u) => [u.id, { id: u.id, full_name: u.full_name || null, email: u.email || null }]));
  }

  const subsystemMap = new Map((subsystems || []).map((s) => [s.id, { id: s.id, name: s.name }]));
  const tasks = (taskRows || []).map((row) => ({
    ...row,
    subsystem: row?.subsystem_id ? subsystemMap.get(row.subsystem_id) || null : null,
    assignee: row?.assignee_id ? userMap.get(row.assignee_id) || null : null,
    reviewer: row?.reviewer_id ? userMap.get(row.reviewer_id) || null : null,
    creator: row?.created_by ? userMap.get(row.created_by) || null : null
  }));

  return {
    tasks: tasks || [],
    subsystems: subsystems || [],
    subsystem_members: subsystemMembers,
    general_candidates: generalCandidates
  };
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
      const description = String(body?.description || '').trim() || null;
      const scope = body?.scope === 'subsystem' ? 'subsystem' : 'general';
      const generalType = scope === 'general' ? String(body?.general_type || '').trim() : null;
      const subsystemId = scope === 'subsystem' ? String(body?.subsystem_id || '').trim() : null;
      const assigneeId = String(body?.assignee_id || '').trim() || null;
      const reviewerIdRaw = String(body?.reviewer_id || '').trim();
      const needsReview = !!body?.needs_review;
      const needsManufacturing = !!body?.needs_manufacturing;
      const reviewerId = needsReview ? (reviewerIdRaw || actor.id) : null;
      const rawDeadlineAt = String(body?.deadline_at || '').trim();
      const parsedDeadlineAt = rawDeadlineAt ? parsePacificDateTimeInput(rawDeadlineAt) : null;
      const deadlineAt = parsedDeadlineAt ? parsedDeadlineAt.toISOString() : null;

      if (!title) return json({ error: 'title required' }, { status: 400 });
      if (!assigneeId) return json({ error: 'assignee_id required' }, { status: 400 });
      if (rawDeadlineAt && !parsedDeadlineAt) {
        return json({ error: 'deadline_at must be a valid Pacific time' }, { status: 400 });
      }
      if (scope === 'general' && !GENERAL_TYPES.includes(generalType)) {
        return json({ error: 'general_type required for general tasks' }, { status: 400 });
      }
      if (scope === 'subsystem' && !subsystemId) {
        return json({ error: 'subsystem_id required for subsystem tasks' }, { status: 400 });
      }

      if (scope === 'subsystem') {
        const { data: subsystem } = await db
          .from('subsystems')
          .select('id, frc_team')
          .eq('id', subsystemId)
          .maybeSingle();
        if (!subsystem?.id || subsystem?.frc_team !== actor.frcTeam) {
          return json({ error: 'Invalid subsystem for your team' }, { status: 400 });
        }
      }

      const { data: assigneeProfile } = await db
        .from('user_profiles')
        .select('id, frc_team')
        .eq('id', assigneeId)
        .maybeSingle();
      if (!assigneeProfile?.id || assigneeProfile.frc_team !== actor.frcTeam) {
        return json({ error: 'Assignee must be on your FRC team' }, { status: 400 });
      }

      if (needsReview) {
        const { data: reviewerProfile } = await db
          .from('user_profiles')
          .select('id, frc_team')
          .eq('id', reviewerId)
          .maybeSingle();
        if (!reviewerProfile?.id || reviewerProfile.frc_team !== actor.frcTeam) {
          return json({ error: 'Reviewer must be on your FRC team' }, { status: 400 });
        }
      }

      const payload = {
        frc_team: actor.frcTeam,
        title,
        description,
        scope,
        general_type: scope === 'general' ? generalType : null,
        subsystem_id: scope === 'subsystem' ? subsystemId : null,
        assignee_id: assigneeId,
        reviewer_id: needsReview ? reviewerId : null,
        created_by: actor.id,
        needs_review: needsReview,
        needs_manufacturing: needsManufacturing,
        deadline_at: deadlineAt,
        status: 'open'
      };

      const { data: created, error: createError } = await db
        .from('tasks')
        .insert([payload])
        .select('id, title, created_at')
        .single();
      if (createError) throw createError;

      try {
        await createPlannerFixingTaskFromP0Bug(db, actor, created);
      } catch (plannerError) {
        await db
          .from('tasks')
          .delete()
          .eq('frc_team', actor.frcTeam)
          .eq('id', created.id);
        throw plannerError;
      }

      await notifyTaskAssignedById(created.id);
      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'upload-file') {
      const taskId = String(body?.task_id || '').trim();
      const attachmentPath = String(body?.attachment_path || '').trim();
      const attachmentName = sanitizeFileName(body?.attachment_name || '');
      if (!taskId || !attachmentPath) return json({ error: 'task_id and attachment_path required' }, { status: 400 });

      const { data: existing, error: existingError } = await db
        .from('tasks')
        .select('id, frc_team, assignee_id, needs_review, reviewer_id, status')
        .eq('id', taskId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing?.id || existing.frc_team !== actor.frcTeam) return json({ error: 'Task not found' }, { status: 404 });
      if (existing.assignee_id !== actor.id) return json({ error: 'Only the assignee can upload task files' }, { status: 403 });

      const nextStatus = existing.needs_review ? 'under_review' : 'file_uploaded';
      const { error: updateError } = await db
        .from('tasks')
        .update({
          attachment_path: attachmentPath,
          attachment_name: attachmentName || null,
          attachment_uploaded_at: new Date().toISOString(),
          status: nextStatus
        })
        .eq('id', taskId);
      if (updateError) throw updateError;

      if (existing.needs_review && existing.reviewer_id) {
        await notifyTaskReviewRequestedById(taskId);
      }

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'review') {
      const taskId = String(body?.task_id || '').trim();
      const decision = String(body?.decision || '').trim().toLowerCase();
      const notes = String(body?.notes || '').trim() || null;
      if (!taskId || (decision !== 'approve' && decision !== 'changes_requested')) {
        return json({ error: 'task_id and decision required' }, { status: 400 });
      }

      const { data: existing, error: existingError } = await db
        .from('tasks')
        .select('id, frc_team, reviewer_id, status')
        .eq('id', taskId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing?.id || existing.frc_team !== actor.frcTeam) return json({ error: 'Task not found' }, { status: 404 });
      if (existing.reviewer_id !== actor.id) return json({ error: 'Only the assigned reviewer can review this task' }, { status: 403 });

      const previousStatus = existing.status;
      const nextStatus = decision === 'approve' ? 'approved' : 'changes_requested';
      const { error: updateError } = await db
        .from('tasks')
        .update({
          status: nextStatus,
          review_decision: decision === 'approve' ? 'approved' : 'changes_requested',
          review_notes: notes,
          reviewed_at: new Date().toISOString()
        })
        .eq('id', taskId);
      if (updateError) throw updateError;

      await notifyTaskStatusChanged({
        taskId,
        previousStatus,
        nextStatus,
        changedByName: actor.fullName || actor.email || 'Reviewer',
        changedByUserId: actor.id
      });

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'set-status') {
      const taskId = String(body?.task_id || '').trim();
      const nextStatus = String(body?.status || '').trim().toLowerCase();
      if (!taskId || !CLOSABLE_STATUSES.has(nextStatus)) {
        return json({ error: 'task_id and valid status required' }, { status: 400 });
      }

      const { data: existing, error: existingError } = await db
        .from('tasks')
        .select('id, frc_team, status, created_by, reviewer_id, assignee_id')
        .eq('id', taskId)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing?.id || existing.frc_team !== actor.frcTeam) return json({ error: 'Task not found' }, { status: 404 });
      const canUpdate = actor.id === existing.assignee_id || actor.id === existing.created_by || actor.id === existing.reviewer_id || actor.role === 'admin';
      if (!canUpdate) return json({ error: 'Forbidden' }, { status: 403 });
      if (existing.status === nextStatus) {
        const bundle = await fetchTasksBundle(db, actor.frcTeam);
        return json({ success: true, data: bundle });
      }

      const { error: updateError } = await db
        .from('tasks')
        .update({ status: nextStatus })
        .eq('id', taskId);
      if (updateError) throw updateError;

      await notifyTaskStatusChanged({
        taskId,
        previousStatus: existing.status,
        nextStatus,
        changedByName: actor.fullName || actor.email || 'Teammate',
        changedByUserId: actor.id
      });

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'add-to-parts') {
      const taskId = String(body?.task_id || '').trim();
      const workflow = String(body?.workflow || 'mill').trim();
      if (!taskId) return json({ error: 'task_id required' }, { status: 400 });

      const { data: task, error: taskError } = await db
        .from('tasks')
        .select('id, frc_team, title, description, scope, subsystem_id, subsystem:subsystem_id(name), needs_manufacturing, needs_review, status, attachment_path, attachment_name, parts_id')
        .eq('id', taskId)
        .maybeSingle();
      if (taskError) throw taskError;
      if (!task?.id || task.frc_team !== actor.frcTeam) return json({ error: 'Task not found' }, { status: 404 });
      if (task.parts_id) return json({ error: 'Task already added to parts list' }, { status: 400 });
      if (!task.needs_manufacturing) return json({ error: 'Task is not marked for manufacturing' }, { status: 400 });
      if (!task.attachment_path) return json({ error: 'Task must have an uploaded file before adding to parts' }, { status: 400 });
      if (task.needs_review && task.status !== 'approved') {
        return json({ error: 'Task must be approved before adding to parts' }, { status: 400 });
      }

      const safeWorkflow = ['laser-cut', 'router', 'lathe', 'mill', '3d-print'].includes(workflow) ? workflow : 'mill';
      const requester = actor.fullName || actor.email || 'Task System';
      const projectId =
        task.scope === 'subsystem'
          ? (task?.subsystem?.name || 'Task Misc')
          : `${task.scope === 'general' ? task.title : 'Task'} Misc`;
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

      const { error: updateTaskErr } = await db
        .from('tasks')
        .update({ parts_id: insertedPart.id })
        .eq('id', taskId);
      if (updateTaskErr) throw updateTaskErr;

      const bundle = await fetchTasksBundle(db, actor.frcTeam);
      return json({ success: true, data: bundle });
    }

    if (action === 'check-deadline-status') {
      const nowIso = new Date().toISOString();
      const { data, error } = await db
        .from('tasks')
        .select('id')
        .eq('frc_team', actor.frcTeam)
        .not('deadline_at', 'is', null)
        .lte('deadline_at', nowIso)
        .in('status', [...OPEN_STATUSES]);
      if (error) throw error;
      return json({ success: true, data: { overdue_count: (data || []).length } });
    }

    return json({ error: 'Unknown action' }, { status: 400 });
  } catch (error) {
    return json({ error: error?.message || 'Task action failed' }, { status: 500 });
  }
}
