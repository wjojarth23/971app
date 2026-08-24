import { getSupabase, getSlackClient, slackUserIdForEmail } from '$lib/server/971bot';
import { NOTIFICATION_KEYS } from '$lib/notifications/constants.js';
import { mergeNotificationSettings } from '$lib/notifications/settings.js';
import { formatPacificDateTimeWithZone, formatPacificTimeWithZone, formatPacificDate } from '$lib/timezone.js';

function formatMatchLabel(matchKey = '') {
  if (!matchKey) return 'match';
  const parts = matchKey.split('_');
  const last = parts[parts.length - 1] || matchKey;
  if (/^qm\d+/i.test(last)) {
    return `Qualification ${last.replace(/^qm/i, '')}`;
  }
  if (/^sf\d+/i.test(last)) {
    return `Semi ${last.replace(/^sf/i, '')}`;
  }
  if (/^f\d+/i.test(last)) {
    return `Final ${last.replace(/^f/i, '')}`;
  }
  return last.toUpperCase();
}

async function fetchNotificationUser(userId, supa) {
  if (!userId) return null;
  const { data } = await supa
    .from('user_profiles')
    .select('id, email, full_name, notification_settings, slack_user_id, slack_dm_channel')
    .eq('id', userId)
    .maybeSingle();
  return data || null;
}

async function ensureSlackUserId(user, supa) {
  if (user.slack_user_id) return user.slack_user_id;
  if (!user.email) return null;
  const slackId = await slackUserIdForEmail(user.email);
  if (slackId) {
    await supa.from('user_profiles').update({ slack_user_id: slackId }).eq('id', user.id);
    user.slack_user_id = slackId;
  }
  return slackId;
}

async function ensureSlackDmChannel(user, supa) {
  if (user.slack_dm_channel) return user.slack_dm_channel;
  const slackUserId = await ensureSlackUserId(user, supa);
  if (!slackUserId) return null;
  const client = getSlackClient();
  const response = await client.conversations.open({ users: slackUserId });
  if (response?.ok && response.channel?.id) {
    const channel = response.channel.id;
    await supa.from('user_profiles').update({ slack_dm_channel: channel }).eq('id', user.id);
    user.slack_dm_channel = channel;
    return channel;
  }
  return null;
}

async function recordNotificationLog(supa, userId, notificationKey, entityKey) {
  if (!entityKey) return;
  const { data: existing } = await supa
    .from('user_notification_logs')
    .select('id')
    .eq('user_id', userId)
    .eq('event_type', notificationKey)
    .eq('entity_key', entityKey)
    .maybeSingle();
  if (existing) {
    throw new Error('duplicate_notification');
  }
  await supa
    .from('user_notification_logs')
    .insert({ user_id: userId, event_type: notificationKey, entity_key: entityKey });
}

async function dispatchNotification({ userId, notificationKey, entityKey = null, text, blocks = null }) {
  const supa = getSupabase();
  const user = await fetchNotificationUser(userId, supa);
  if (!user) return { ok: false, reason: 'missing-user' };

  const settings = mergeNotificationSettings(user.notification_settings);
  if (settings[notificationKey] === false) {
    return { ok: false, reason: 'disabled' };
  }

  try {
    await recordNotificationLog(supa, user.id, notificationKey, entityKey);
  } catch (err) {
    if (err?.message === 'duplicate_notification') {
      return { ok: false, reason: 'duplicate' };
    }
    throw err;
  }

  const channel = await ensureSlackDmChannel(user, supa);
  if (!channel) {
    return { ok: false, reason: 'missing-channel' };
  }

  const client = getSlackClient();
  const response = await client.chat.postMessage({ channel, text, blocks });
  return {
    ok: !!response?.ok,
    channel: response?.channel || channel,
    ts: response?.ts || null
  };
}

export async function notifyScoutAssignment({ assignmentId, userId, matchKey, teamKey, scoutingType }) {
  if (!userId || !assignmentId) return { ok: false, reason: 'invalid-input' };
  const teamDisplay = teamKey ? teamKey.replace(/^frc/i, '') : 'team';
  const label = formatMatchLabel(matchKey);
  const typeLabel = scoutingType === 'note' ? 'note' : 'data';
  const text = `You were assigned to ${typeLabel} scouting for ${label} (Team ${teamDisplay}).`;
  return dispatchNotification({
    userId,
    notificationKey: NOTIFICATION_KEYS.SHIFT_ASSIGNMENTS,
    text
  });
}

export async function notifyPartAssignmentById(partId) {
  const supa = getSupabase();
  const { data: part } = await supa
    .from('parts')
    .select('id, name, project_id, workflow, assigned_to, updated_at')
    .eq('id', partId)
    .maybeSingle();
  if (!part?.assigned_to) {
    return { ok: false, reason: 'no-assignee' };
  }
  const text = `Manufacturing assigned you to ${part.name || 'a part'} (${part.workflow}) for ${part.project_id}.`;
  const entityKey = part.updated_at ? `${part.id}:${part.assigned_to}:${part.updated_at}` : null;
  return dispatchNotification({
    userId: part.assigned_to,
    notificationKey: NOTIFICATION_KEYS.PART_ASSIGNMENTS,
    entityKey,
    text
  });
}

async function findSubsystemIdForPart(partId, existingSubsystemId = null) {
  if (existingSubsystemId) return existingSubsystemId;
  const supa = getSupabase();
  const { data } = await supa
    .from('build_bom')
    .select('builds(subsystem_id)')
    .eq('parts_id', partId)
    .maybeSingle();
  return data?.builds?.subsystem_id || null;
}

export async function notifyPartCompletedById(partId) {
  const supa = getSupabase();
  const { data: part } = await supa
    .from('parts')
    .select('id, name, project_id, workflow, status, subsystem_id')
    .eq('id', partId)
    .maybeSingle();
  if (!part || part.status !== 'complete') {
    return { ok: false, reason: 'not-complete' };
  }
  const subsystemId = await findSubsystemIdForPart(part.id, part.subsystem_id);
  if (!subsystemId) {
    return { ok: false, reason: 'no-subsystem' };
  }
  const { data: members } = await supa
    .from('subsystem_members')
    .select('user_id')
    .eq('subsystem_id', subsystemId);
  if (!members?.length) {
    return { ok: false, reason: 'no-members' };
  }
  const text = `${part.name || 'A part'} for ${part.project_id} is marked complete.`;
  const results = [];
  for (const member of members) {
    if (!member?.user_id) continue;
    const entityKey = `${part.id}:${member.user_id}:complete`;
    const res = await dispatchNotification({
      userId: member.user_id,
      notificationKey: NOTIFICATION_KEYS.SUBSYSTEM_PARTS_COMPLETE,
      entityKey,
      text
    });
    results.push(res);
  }
  return { ok: true, sent: results.length };
}

export async function notifyPurchaseApprovedById(purchaseId) {
  const supa = getSupabase();
  const { data: purchase } = await supa
    .from('purchasing')
    .select('id, name, project_id, status, purchaser, requester')
    .eq('id', purchaseId)
    .maybeSingle();
  if (!purchase || purchase.status !== 'approved' || !purchase.purchaser) {
    return { ok: false, reason: 'not-approved' };
  }
  const text = `${purchase.name || 'Your purchase'} for ${purchase.project_id} was approved.`;
  const entityKey = `${purchase.id}:${purchase.purchaser}:approved`;
  return dispatchNotification({
    userId: purchase.purchaser,
    notificationKey: NOTIFICATION_KEYS.PURCHASE_APPROVED,
    entityKey,
    text
  });
}

export async function notifyMatchReminder({ userId, matchKey, teams, matchTime }) {
  if (!userId || !matchKey) return { ok: false, reason: 'invalid-input' };
  const label = formatMatchLabel(matchKey);
  const teamList = teams && teams.length ? teams.map((t) => t.replace(/^frc/i, '')).join(', ') : 'your assigned teams';
  const whenLabel = matchTime ? formatPacificTimeWithZone(matchTime * 1000) : '';
  const when = whenLabel ? ` at ${whenLabel}` : '';
  const text = `${label}${when} is starting soon. You're scouting teams ${teamList}.`; 
  const entityKey = `${matchKey}:${userId}`;
  return dispatchNotification({
    userId,
    notificationKey: NOTIFICATION_KEYS.MATCH_REMINDERS,
    entityKey,
    text
  });
}

function taskStatusLabel(status = '') {
  const map = {
    red: 'Red',
    yellow: 'Yellow',
    green: 'Green',
    completed: 'Completed',
    open: 'Red',
    in_progress: 'Yellow',
    file_uploaded: 'Yellow',
    under_review: 'Yellow',
    changes_requested: 'Red',
    approved: 'Green',
    done: 'Completed',
    closed: 'Completed'
  };
  return map[status] || String(status || 'Updated');
}

async function fetchPlannerItemOwnerId(supa, taskId) {
  const { data: ownerRow, error: ownerError } = await supa
    .from('planner_item_people')
    .select('user_id')
    .eq('planner_item_id', taskId)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (ownerError) throw ownerError;
  return ownerRow?.user_id || null;
}

export async function notifyTaskAssignedById(taskId) {
  const supa = getSupabase();
  const { data: task } = await supa
    .from('planner_items')
    .select('id, title, created_at, item_type')
    .eq('id', taskId)
    .eq('item_type', 'p0_bug')
    .maybeSingle();
  const ownerId = task?.id ? await fetchPlannerItemOwnerId(supa, task.id) : null;
  if (!ownerId) {
    return { ok: false, reason: 'no-assignee' };
  }
  const text = `You were assigned P0 bug: ${task.title || 'Untitled bug'}.`;
  const entityKey = task.created_at ? `task:${task.id}:assigned:${ownerId}:${task.created_at}` : `task:${task.id}:assigned`;
  return dispatchNotification({
    userId: ownerId,
    notificationKey: NOTIFICATION_KEYS.TASK_ASSIGNED,
    entityKey,
    text
  });
}

export async function handleP0BugAssignmentReaction({ channel, ts, reaction, reactingUser }) {
  void channel;
  void ts;
  void reaction;
  void reactingUser;
  return { handled: false };
}

export async function notifyTaskReviewRequestedById(taskId) {
  void taskId;
  return { ok: false, reason: 'review-flow-removed' };
}

export async function notifyTaskStatusChanged({
  taskId,
  previousStatus = null,
  nextStatus = null,
  changedByName = null,
  changedByUserId = null
}) {
  const supa = getSupabase();
  const { data: task } = await supa
    .from('planner_items')
    .select('id, title, status, updated_at, item_type')
    .eq('id', taskId)
    .eq('item_type', 'p0_bug')
    .maybeSingle();
  const ownerId = task?.id ? await fetchPlannerItemOwnerId(supa, task.id) : null;
  if (!ownerId) {
    return { ok: false, reason: 'no-assignee' };
  }
  if (changedByUserId && ownerId === changedByUserId) {
    return { ok: false, reason: 'self-change' };
  }
  const fromLabel = taskStatusLabel(previousStatus || task.status);
  const toLabel = taskStatusLabel(nextStatus || task.status);
  const actor = changedByName ? ` by ${changedByName}` : '';
  const text = `Task status updated${actor}: ${task.title || 'Untitled task'} (${fromLabel} -> ${toLabel}).`;
  const entityKey = task.updated_at
    ? `task:${task.id}:status:${ownerId}:${task.updated_at}:${toLabel}`
    : `task:${task.id}:status:${toLabel}`;
  return dispatchNotification({
    userId: ownerId,
    notificationKey: NOTIFICATION_KEYS.TASK_STATUS_CHANGED,
    entityKey,
    text
  });
}

export async function notifyTaskDeadlineById(taskId) {
  void taskId;
  return { ok: false, reason: 'deadlines-removed' };
}

// Manufacturing leads-per-workflow, by email. No dedicated leads table/role
// exists yet (team_role only has a single flat 'Manufacturing Lead', not
// per-process) - this is the placeholder until that's built out. Workflow
// values are the real, verbatim strings used by parts.workflow throughout
// manufacture/create/+page.svelte and manufacture/+page.svelte - not an
// enum, just free text, so keep these in sync if a new workflow is added.
// Empty arrays are fine (and expected for now): no leads configured means
// notifyManufacturingRequestById() below is a no-op for that workflow.
//
// yuvan262626@gmail.com (Yuvan Shankar) is intentionally always included
// here, permanently, for oversight/testing of this feature - not a
// temporary testing-phase placeholder to be removed later. Real 3D print
// leads are Anton Strougo and Sahil Rajput.
export const MANUFACTURING_WORKFLOW_LEAD_EMAILS = {
  'router': [],
  'lathe': [],
  'mill': [],
  'laser-cut': [],
  '3d-print': ['sahilshethrajput@gmail.com', 'antonstrougo@gmail.com', 'yuvan262626@gmail.com']
};

const WORKFLOW_LABELS = {
  'router': 'Router',
  'lathe': 'Lathe',
  'mill': 'Mill',
  'laser-cut': 'Laser Cut',
  '3d-print': '3D Print'
};

export async function notifyManufacturingRequestById(partId) {
  const supa = getSupabase();
  const { data: part } = await supa
    .from('parts')
    .select('id, name, workflow, project_id, requester, created_at')
    .eq('id', partId)
    .maybeSingle();
  if (!part) {
    return { ok: false, reason: 'no-part' };
  }

  const leadEmails = MANUFACTURING_WORKFLOW_LEAD_EMAILS[part.workflow] || [];
  if (!leadEmails.length) {
    return { ok: false, reason: 'no-leads-configured' };
  }

  const workflowLabel = WORKFLOW_LABELS[part.workflow] || part.workflow;
  const requesterLabel = part.requester || 'Someone';
  const dateLabel = formatPacificDate(part.created_at) || formatPacificDate(new Date());
  const text = `${requesterLabel} has requested to ${workflowLabel} ${part.name || 'Unnamed part'}, on ${dateLabel}.`;

  const results = [];
  for (const email of leadEmails) {
    const { data: leadUser } = await supa
      .from('user_profiles')
      .select('id')
      .eq('email', email)
      .maybeSingle();
    if (!leadUser?.id) {
      results.push({ ok: false, reason: 'lead-not-found', email });
      continue;
    }
    const entityKey = part.created_at ? `${part.id}:${leadUser.id}:${part.created_at}` : `${part.id}:${leadUser.id}`;
    const res = await dispatchNotification({
      userId: leadUser.id,
      notificationKey: NOTIFICATION_KEYS.MANUFACTURING_REQUEST,
      entityKey,
      text
    });
    results.push({ ...res, email });
  }
  return { ok: true, sent: results };
}
