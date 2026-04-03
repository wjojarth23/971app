import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import {
  nextWorkMoment,
  recomputePlannerSchedule,
  roundUpToSlot,
  toDateOrNull,
  workingMinutesBetween
} from '$lib/planner/schedule.js';
import { rollupPlannerStatuses } from '$lib/planner/status.js';
import {
  PLANNER_AUTO_FIXING_TASK_DAYS,
  PLANNER_DEFAULT_MIN_DURATION_MINUTES,
  PLANNER_DEFAULT_TASK_DURATION_MINUTES,
  PLANNER_FIXING_TASK_MODE,
  PLANNER_STANDARD_TASK_MODE
} from '$lib/planner/constants.js';

const P0_BUG_DONE_STATUSES = new Set(['done', 'closed']);

export function getPlannerDbFromRequest(request) {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
}

function normalizeTaskStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function normalizePlannerTaskMode(value) {
  return String(value || '').trim().toLowerCase() === PLANNER_FIXING_TASK_MODE
    ? PLANNER_FIXING_TASK_MODE
    : PLANNER_STANDARD_TASK_MODE;
}

function addDays(value, days) {
  const date = new Date(value);
  date.setDate(date.getDate() + days);
  return date;
}

function buildPlannerFixingTaskTitle(title) {
  const bugTitle = String(title || '').trim() || 'Untitled bug';
  return `P0 Fix: ${bugTitle}`;
}

function taskHasDeadline(value) {
  const timestamp = Date.parse(value || '');
  return Number.isFinite(timestamp) ? timestamp : null;
}

function compareP0BugRows(a, b) {
  const aDeadline = taskHasDeadline(a?.deadline_at);
  const bDeadline = taskHasDeadline(b?.deadline_at);

  if (aDeadline !== null && bDeadline === null) return -1;
  if (aDeadline === null && bDeadline !== null) return 1;
  if (aDeadline !== null && bDeadline !== null && aDeadline !== bDeadline) {
    return aDeadline - bDeadline;
  }

  const aUpdated = taskHasDeadline(a?.updated_at) ?? taskHasDeadline(a?.created_at) ?? 0;
  const bUpdated = taskHasDeadline(b?.updated_at) ?? taskHasDeadline(b?.created_at) ?? 0;
  return bUpdated - aUpdated;
}

export async function getPlannerActor(db) {
  const { data: authData, error: authErr } = await db.auth.getUser();
  if (authErr || !authData?.user?.id) return null;
  const actorId = authData.user.id;
  const { data: profile } = await db
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

export function plannerTeamEnabled(team) {
  return team === '971' || team === '9584';
}

export async function fetchPlannerTeamPeople(db, team) {
  const { data, error } = await db
    .from('user_profiles')
    .select('id, full_name, email, frc_team, slack_user_id, slack_dm_channel, banned')
    .eq('frc_team', team)
    .order('full_name', { ascending: true });
  if (error) throw error;
  return (data || [])
    .filter((row) => !row?.banned)
    .map((row) => ({
      id: row.id,
      full_name: row.full_name || null,
      email: row.email || null,
      frc_team: row.frc_team || null,
      slack_user_id: row.slack_user_id || null,
      slack_dm_channel: row.slack_dm_channel || null
    }));
}

async function fetchPlannerTaskRows(db, team, { taskIds = null, includeClosed = false } = {}) {
  let query = db
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
      review_notes,
      created_at,
      updated_at
    `)
    .eq('frc_team', team);

  if (Array.isArray(taskIds)) {
    const uniqueTaskIds = Array.from(new Set(taskIds.filter(Boolean)));
    if (!uniqueTaskIds.length) return [];
    query = query.in('id', uniqueTaskIds);
  }

  const { data: taskRows, error: tasksError } = await query;

  if (tasksError) {
    const errorMessage = String(tasksError?.message || '').toLowerCase();
    if (errorMessage.includes('tasks')) return [];
    throw tasksError;
  }

  const scopedRows = includeClosed
    ? (taskRows || [])
    : (taskRows || []).filter((row) => !P0_BUG_DONE_STATUSES.has(normalizeTaskStatus(row?.status)));
  const subsystemIds = Array.from(new Set(scopedRows.map((row) => row?.subsystem_id).filter(Boolean)));
  let subsystemMap = new Map();

  if (subsystemIds.length) {
    const { data: subsystems, error: subsystemError } = await db
      .from('subsystems')
      .select('id, name')
      .in('id', subsystemIds);
    if (subsystemError) throw subsystemError;
    subsystemMap = new Map((subsystems || []).map((subsystem) => [subsystem.id, {
      id: subsystem.id,
      name: subsystem.name || 'Unknown'
    }]));
  }

  return scopedRows
    .map((row) => ({
      ...row,
      subsystem: row?.subsystem_id ? (subsystemMap.get(row.subsystem_id) || null) : null
    }))
    .sort(compareP0BugRows);
}

async function fetchPlannerP0BugRows(db, team) {
  return fetchPlannerTaskRows(db, team);
}

export async function fetchPlannerSnapshot(db, team) {
  const [itemsResult, dependenciesResult, rulesResult, ownersResult, p0BugLinksResult, ruleRecipientsResult] = await Promise.all([
    db
      .from('planner_items')
      .select(`
        id,
        frc_team,
        kind,
        task_mode,
        title,
        notes,
        category,
        status,
        critical_level,
        duration_minutes,
        requested_duration_minutes,
        min_duration_minutes,
        manual_start_at,
        scheduled_start_at,
        scheduled_end_at,
        sort_order,
        created_by,
        created_at,
        updated_at
      `)
      .eq('frc_team', team)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true }),
    db
      .from('planner_dependencies')
      .select('id, frc_team, predecessor_item_id, successor_item_id, created_by, created_at')
      .eq('frc_team', team),
    db
      .from('planner_calendar_rules')
      .select('id, frc_team, rule_type, label, weekday, specific_date, starts_at, ends_at, enabled, is_default, created_by, created_at, updated_at')
      .eq('frc_team', team)
      .order('specific_date', { ascending: true, nullsFirst: true })
      .order('weekday', { ascending: true, nullsFirst: true })
      .order('starts_at', { ascending: true }),
    db
      .from('planner_item_owners')
      .select('id, frc_team, planner_item_id, user_id, owner_type, created_at')
      .eq('frc_team', team)
    ,
    db
      .from('planner_item_p0_bugs')
      .select('id, frc_team, planner_item_id, task_id, created_by, created_at')
      .eq('frc_team', team)
    ,
    db
      .from('planner_calendar_rule_recipients')
      .select('id, frc_team, planner_calendar_rule_id, user_id, created_at')
      .eq('frc_team', team)
  ]);

  if (itemsResult.error) throw itemsResult.error;
  if (dependenciesResult.error) throw dependenciesResult.error;
  if (rulesResult.error) throw rulesResult.error;
  if (ownersResult.error) throw ownersResult.error;
  if (p0BugLinksResult.error) throw p0BugLinksResult.error;
  if (ruleRecipientsResult.error) throw ruleRecipientsResult.error;

  return {
    items: itemsResult.data || [],
    dependencies: dependenciesResult.data || [],
    calendar_rules: rulesResult.data || [],
    owner_rows: ownersResult.data || [],
    p0_bug_link_rows: p0BugLinksResult.data || [],
    rule_recipient_rows: ruleRecipientsResult.data || []
  };
}

export async function fetchPlannerBundle(db, team, { warnings = [] } = {}) {
  const [snapshot, people, p0BugRows] = await Promise.all([
    fetchPlannerSnapshot(db, team),
    fetchPlannerTeamPeople(db, team),
    fetchPlannerP0BugRows(db, team)
  ]);

  const peopleMap = new Map(people.map((person) => [person.id, person]));
  const hydrateBug = (row) => ({
    ...row,
    assignee: row?.assignee_id ? (peopleMap.get(row.assignee_id) || null) : null,
    reviewer: row?.reviewer_id ? (peopleMap.get(row.reviewer_id) || null) : null,
    creator: row?.created_by ? (peopleMap.get(row.created_by) || null) : null
  });
  const linkedBugIds = Array.from(new Set((snapshot.p0_bug_link_rows || []).map((row) => row?.task_id).filter(Boolean)));
  const linkedBugRows = linkedBugIds.length
    ? await fetchPlannerTaskRows(db, team, { taskIds: linkedBugIds, includeClosed: true })
    : [];
  const activeP0BugMap = new Map(p0BugRows.map((row) => [row.id, hydrateBug(row)]));
  const linkedBugMap = new Map(linkedBugRows.map((row) => [row.id, hydrateBug(row)]));
  const ownersByItem = new Map();
  for (const ownerRow of snapshot.owner_rows) {
    if (!ownersByItem.has(ownerRow.planner_item_id)) ownersByItem.set(ownerRow.planner_item_id, []);
    ownersByItem.get(ownerRow.planner_item_id).push(ownerRow);
  }
  const p0BugsByItem = new Map();
  for (const linkRow of snapshot.p0_bug_link_rows || []) {
    if (!p0BugsByItem.has(linkRow.planner_item_id)) p0BugsByItem.set(linkRow.planner_item_id, []);
    p0BugsByItem.get(linkRow.planner_item_id).push(linkRow.task_id);
  }
  const recipientsByRule = new Map();
  for (const recipientRow of snapshot.rule_recipient_rows || []) {
    if (!recipientsByRule.has(recipientRow.planner_calendar_rule_id)) recipientsByRule.set(recipientRow.planner_calendar_rule_id, []);
    recipientsByRule.get(recipientRow.planner_calendar_rule_id).push(recipientRow);
  }

  const items = rollupPlannerStatuses(snapshot.items.map((item) => {
    const ownerRows = ownersByItem.get(item.id) || [];
    const owners = ownerRows
      .filter((row) => row.owner_type === 'owner')
      .map((row) => peopleMap.get(row.user_id))
      .filter(Boolean);
    const accountableRow = ownerRows.find((row) => row.owner_type === 'accountable');
    const accountable = accountableRow ? (peopleMap.get(accountableRow.user_id) || null) : null;
    const p0BugIds = Array.from(new Set((p0BugsByItem.get(item.id) || []).filter(Boolean)));
    return {
      ...item,
      task_mode: normalizePlannerTaskMode(item?.task_mode),
      owners,
      owner_ids: owners.map((owner) => owner.id),
      p0_bug_ids: p0BugIds,
      p0_bugs: p0BugIds
        .map((bugId) => activeP0BugMap.get(bugId) || linkedBugMap.get(bugId) || null)
        .filter(Boolean),
      accountable,
      accountable_user_id: accountable?.id || null
    };
  }), snapshot.dependencies);

  const p0_bugs = p0BugRows.map(hydrateBug);

  const calendar_rules = snapshot.calendar_rules.map((rule) => {
    const recipientRows = recipientsByRule.get(rule.id) || [];
    const recipients = recipientRows
      .map((row) => peopleMap.get(row.user_id))
      .filter(Boolean);
    return {
      ...rule,
      recipients,
      recipient_ids: recipients.map((person) => person.id)
    };
  });

  return {
    items,
    dependencies: snapshot.dependencies,
    calendar_rules,
    people,
    p0_bugs,
    warnings
  };
}

export async function replacePlannerOwners(db, team, itemId, ownerIds = [], accountableUserId = null) {
  await db
    .from('planner_item_owners')
    .delete()
    .eq('frc_team', team)
    .eq('planner_item_id', itemId);

  const inserts = [];
  for (const ownerId of Array.from(new Set(ownerIds.filter(Boolean)))) {
    inserts.push({
      frc_team: team,
      planner_item_id: itemId,
      user_id: ownerId,
      owner_type: 'owner'
    });
  }
  if (accountableUserId) {
    inserts.push({
      frc_team: team,
      planner_item_id: itemId,
      user_id: accountableUserId,
      owner_type: 'accountable'
    });
  }
  if (!inserts.length) return;
  const { error } = await db.from('planner_item_owners').insert(inserts);
  if (error) throw error;
}

export async function replacePlannerP0BugLinks(db, team, itemId, taskIds = [], createdBy = null) {
  await db
    .from('planner_item_p0_bugs')
    .delete()
    .eq('frc_team', team)
    .eq('planner_item_id', itemId);

  const inserts = Array.from(new Set((taskIds || []).filter(Boolean))).map((taskId) => ({
    frc_team: team,
    planner_item_id: itemId,
    task_id: taskId,
    created_by: createdBy
  }));

  if (!inserts.length) return;
  const { error } = await db.from('planner_item_p0_bugs').insert(inserts);
  if (error) throw error;
}

export async function replacePlannerRuleRecipients(db, team, ruleId, recipientIds = []) {
  await db
    .from('planner_calendar_rule_recipients')
    .delete()
    .eq('frc_team', team)
    .eq('planner_calendar_rule_id', ruleId);

  const inserts = Array.from(new Set((recipientIds || []).filter(Boolean))).map((recipientId) => ({
    frc_team: team,
    planner_calendar_rule_id: ruleId,
    user_id: recipientId
  }));

  if (!inserts.length) return;
  const { error } = await db.from('planner_calendar_rule_recipients').insert(inserts);
  if (error) throw error;
}

export async function ensurePlannerUsersOnTeam(db, team, userIds = []) {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (!uniqueIds.length) return [];
  const { data, error } = await db
    .from('user_profiles')
    .select('id, frc_team, banned')
    .in('id', uniqueIds);
  if (error) throw error;
  const valid = new Set(
    (data || [])
      .filter((row) => row?.id && !row?.banned && row?.frc_team === team)
      .map((row) => row.id)
  );
  for (const userId of uniqueIds) {
    if (!valid.has(userId)) {
      throw new Error('All selected people must be active members of your team.');
    }
  }
  return uniqueIds;
}

export async function ensurePlannerP0BugsOnTeam(db, team, taskIds = []) {
  const uniqueIds = Array.from(new Set(taskIds.filter(Boolean)));
  if (!uniqueIds.length) return [];
  const { data, error } = await db
    .from('tasks')
    .select('id, frc_team')
    .in('id', uniqueIds);
  if (error) throw error;
  const valid = new Set(
    (data || [])
      .filter((row) => row?.id && row?.frc_team === team)
      .map((row) => row.id)
  );
  for (const taskId of uniqueIds) {
    if (!valid.has(taskId)) {
      throw new Error('All selected P0 bugs must be on your team.');
    }
  }
  return uniqueIds;
}

export function getPlannerAutoFixingDurationMinutes(reportedAt, rules = [], days = PLANNER_AUTO_FIXING_TASK_DAYS) {
  const startAt = toDateOrNull(reportedAt) || new Date();
  const endAt = addDays(startAt, days);
  const workingMinutes = roundUpToSlot(workingMinutesBetween(startAt, endAt, rules));
  return Math.max(PLANNER_DEFAULT_TASK_DURATION_MINUTES, workingMinutes);
}

export async function createPlannerFixingTaskFromP0Bug(db, actor, bug) {
  if (!actor?.frcTeam || !actor?.id || !bug?.id) {
    throw new Error('Missing actor or P0 bug data for planner task creation.');
  }

  const snapshot = await fetchPlannerSnapshot(db, actor.frcTeam);
  const sortOrder = snapshot.items.length
    ? Math.max(...snapshot.items.map((item) => Number(item.sort_order) || 0)) + 1000
    : 0;
  const manualStartAt = toDateOrNull(bug.created_at) || new Date();
  const durationMinutes = getPlannerAutoFixingDurationMinutes(
    manualStartAt,
    snapshot.calendar_rules,
    PLANNER_AUTO_FIXING_TASK_DAYS
  );

  const { data: created, error: createError } = await db
    .from('planner_items')
    .insert([{
      frc_team: actor.frcTeam,
      kind: 'task',
      task_mode: PLANNER_FIXING_TASK_MODE,
      title: buildPlannerFixingTaskTitle(bug.title),
      notes: null,
      category: null,
      status: 'not_started',
      critical_level: 1,
      duration_minutes: durationMinutes,
      requested_duration_minutes: durationMinutes,
      min_duration_minutes: Math.min(durationMinutes, PLANNER_DEFAULT_MIN_DURATION_MINUTES),
      manual_start_at: manualStartAt.toISOString(),
      sort_order: sortOrder,
      created_by: actor.id
    }])
    .select('id')
    .single();
  if (createError) throw createError;

  try {
    await replacePlannerP0BugLinks(db, actor.frcTeam, created.id, [bug.id], actor.id);
    const recompute = await recomputePlannerTeam(db, actor.frcTeam, { now: manualStartAt });
    return {
      item_id: created.id,
      warnings: recompute.warnings || []
    };
  } catch (error) {
    await db
      .from('planner_items')
      .delete()
      .eq('frc_team', actor.frcTeam)
      .eq('id', created.id);
    throw error;
  }
}

export async function recomputePlannerTeam(db, team, options = {}) {
  const snapshot = await fetchPlannerSnapshot(db, team);
  const result = recomputePlannerSchedule(snapshot.items, snapshot.dependencies, snapshot.calendar_rules, options);

  for (const item of result.items) {
    const source = snapshot.items.find((entry) => entry.id === item.id);
    if (!source) continue;

    const nextDuration = item.kind === 'task'
      ? roundUpToSlot(Number(item.duration_minutes) || PLANNER_DEFAULT_TASK_DURATION_MINUTES)
      : null;
    const nextRequestedDuration = item.kind === 'task'
      ? roundUpToSlot(Number(item.requested_duration_minutes) || Number(item.duration_minutes) || PLANNER_DEFAULT_TASK_DURATION_MINUTES)
      : null;
    const nextMinDuration = item.kind === 'task'
      ? roundUpToSlot(Number(item.min_duration_minutes) || PLANNER_DEFAULT_MIN_DURATION_MINUTES)
      : PLANNER_DEFAULT_MIN_DURATION_MINUTES;
    const nextManualStart = item.manual_start_at || null;
    const nextScheduledStart = item.scheduled_start_at || null;
    const nextScheduledEnd = item.scheduled_end_at || null;

    const unchanged =
      String(source.manual_start_at || '') === String(nextManualStart || '') &&
      String(source.scheduled_start_at || '') === String(nextScheduledStart || '') &&
      String(source.scheduled_end_at || '') === String(nextScheduledEnd || '') &&
      Number(source.duration_minutes || 0) === Number(nextDuration || 0) &&
      Number(source.requested_duration_minutes || 0) === Number(nextRequestedDuration || 0) &&
      Number(source.min_duration_minutes || 0) === Number(nextMinDuration || 0);

    if (unchanged) continue;

    const { error } = await db
      .from('planner_items')
      .update({
        manual_start_at: nextManualStart,
        scheduled_start_at: nextScheduledStart,
        scheduled_end_at: nextScheduledEnd,
        duration_minutes: nextDuration,
        requested_duration_minutes: nextRequestedDuration,
        min_duration_minutes: nextMinDuration
      })
      .eq('id', item.id);
    if (error) throw error;
  }

  return {
    warnings: result.warnings || [],
    hasCycle: !!result.hasCycle
  };
}

export async function getDefaultPlannerStart(db, team, now = new Date()) {
  const snapshot = await fetchPlannerSnapshot(db, team);
  return nextWorkMoment(now, snapshot.calendar_rules).toISOString();
}
