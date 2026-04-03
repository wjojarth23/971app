import { getSupabase, getSlackClient, slackUserIdForEmail } from '$lib/server/971bot';
import { NOTIFICATION_KEYS } from '$lib/notifications/constants.js';
import { mergeNotificationSettings } from '$lib/notifications/settings.js';
import { formatPacificDateTimeWithZone, formatPacificTimeWithZone } from '$lib/timezone.js';

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
    open: 'Open',
    in_progress: 'In Progress',
    file_uploaded: 'File Uploaded',
    under_review: 'Under Review',
    changes_requested: 'Changes Requested',
    approved: 'Approved',
    done: 'Done',
    closed: 'Closed'
  };
  return map[status] || String(status || 'Updated');
}

export async function notifyTaskAssignedById(taskId) {
  const supa = getSupabase();
  const { data: task } = await supa
    .from('tasks')
    .select('id, title, assignee_id, created_at')
    .eq('id', taskId)
    .maybeSingle();
  if (!task?.assignee_id) {
    return { ok: false, reason: 'no-assignee' };
  }
  const { data: p0Link } = await supa
    .from('planner_item_p0_bugs')
    .select('planner_item_id')
    .eq('task_id', task.id)
    .limit(1)
    .maybeSingle();
  const isP0Bug = !!p0Link?.planner_item_id;
  const text = isP0Bug
    ? `You were assigned P0 bug: ${task.title || 'Untitled bug'}. React with :white_check_mark: when you start it.`
    : `You were assigned task: ${task.title || 'Untitled task'}.`;
  const entityKey = task.created_at ? `task:${task.id}:assigned:${task.assignee_id}:${task.created_at}` : `task:${task.id}:assigned`;
  const result = await dispatchNotification({
    userId: task.assignee_id,
    notificationKey: NOTIFICATION_KEYS.TASK_ASSIGNED,
    entityKey,
    text
  });
  if (isP0Bug && result?.ok && result.channel && result.ts) {
    await supa
      .from('tasks')
      .update({
        assignment_slack_channel: result.channel,
        assignment_slack_ts: result.ts
      })
      .eq('id', task.id);

    try {
      await getSlackClient().reactions.add({
        channel: result.channel,
        timestamp: result.ts,
        name: 'white_check_mark'
      });
    } catch (error) {
      console.warn('Failed to add P0 bug start reaction', error?.data || error?.message || error);
    }
  }
  return result;
}

export async function handleP0BugAssignmentReaction({ channel, ts, reaction, reactingUser }) {
  if (String(reaction || '').trim() !== 'white_check_mark' || !channel || !ts) {
    return { handled: false };
  }

  const supa = getSupabase();
  const { data: task, error: taskError } = await supa
    .from('tasks')
    .select('id, assignee_id, status, assignment_slack_channel, assignment_slack_ts')
    .eq('assignment_slack_channel', channel)
    .eq('assignment_slack_ts', ts)
    .maybeSingle();
  if (taskError) throw taskError;
  if (!task?.id) return { handled: false };

  const user = await fetchNotificationUser(task.assignee_id, supa);
  if (user?.slack_user_id && reactingUser && user.slack_user_id !== reactingUser) {
    return { handled: true, ignored: true };
  }

  const { data: link, error: linkError } = await supa
    .from('planner_item_p0_bugs')
    .select('planner_item_id')
    .eq('task_id', task.id)
    .limit(1)
    .maybeSingle();
  if (linkError) throw linkError;
  if (!link?.planner_item_id) return { handled: true, ignored: true };

  if (task.status === 'open') {
    const { error: updateTaskError } = await supa
      .from('tasks')
      .update({ status: 'in_progress' })
      .eq('id', task.id)
      .eq('status', 'open');
    if (updateTaskError) throw updateTaskError;
  }

  const { data: plannerItem, error: plannerError } = await supa
    .from('planner_items')
    .select('id, status')
    .eq('id', link.planner_item_id)
    .maybeSingle();
  if (plannerError) throw plannerError;

  if (plannerItem?.id && String(plannerItem.status || '').trim().toLowerCase() === 'not_started') {
    const { error: updatePlannerError } = await supa
      .from('planner_items')
      .update({ status: 'green' })
      .eq('id', plannerItem.id)
      .eq('status', 'not_started');
    if (updatePlannerError) throw updatePlannerError;
  }

  return { handled: true, status: 'started' };
}

export async function notifyTaskReviewRequestedById(taskId) {
  const supa = getSupabase();
  const { data: task } = await supa
    .from('tasks')
    .select('id, title, reviewer_id, attachment_uploaded_at')
    .eq('id', taskId)
    .maybeSingle();
  if (!task?.reviewer_id) {
    return { ok: false, reason: 'no-reviewer' };
  }
  const text = `Task ready for review: ${task.title || 'Untitled task'}.`;
  const entityKey = task.attachment_uploaded_at
    ? `task:${task.id}:review:${task.reviewer_id}:${task.attachment_uploaded_at}`
    : `task:${task.id}:review`;
  return dispatchNotification({
    userId: task.reviewer_id,
    notificationKey: NOTIFICATION_KEYS.TASK_REVIEW_REQUESTED,
    entityKey,
    text
  });
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
    .from('tasks')
    .select('id, title, assignee_id, status, updated_at')
    .eq('id', taskId)
    .maybeSingle();
  if (!task?.assignee_id) {
    return { ok: false, reason: 'no-assignee' };
  }
  if (changedByUserId && task.assignee_id === changedByUserId) {
    return { ok: false, reason: 'self-change' };
  }
  const fromLabel = taskStatusLabel(previousStatus || task.status);
  const toLabel = taskStatusLabel(nextStatus || task.status);
  const actor = changedByName ? ` by ${changedByName}` : '';
  const text = `Task status updated${actor}: ${task.title || 'Untitled task'} (${fromLabel} -> ${toLabel}).`;
  const entityKey = task.updated_at
    ? `task:${task.id}:status:${task.assignee_id}:${task.updated_at}:${toLabel}`
    : `task:${task.id}:status:${toLabel}`;
  return dispatchNotification({
    userId: task.assignee_id,
    notificationKey: NOTIFICATION_KEYS.TASK_STATUS_CHANGED,
    entityKey,
    text
  });
}

export async function notifyTaskDeadlineById(taskId) {
  const supa = getSupabase();
  const { data: task } = await supa
    .from('tasks')
    .select('id, title, assignee_id, deadline_at, status')
    .eq('id', taskId)
    .maybeSingle();
  if (!task?.assignee_id || !task?.deadline_at) {
    return { ok: false, reason: 'missing-deadline-or-assignee' };
  }
  const deadlineLabel = formatPacificDateTimeWithZone(task.deadline_at);
  const text = `Deadline reached for task: ${task.title || 'Untitled task'}. Deadline: ${deadlineLabel || 'Pacific time unavailable'}. Current status: ${taskStatusLabel(task.status)}.`;
  const entityKey = `task:${task.id}:deadline:${task.assignee_id}:${new Date(task.deadline_at).toISOString()}`;
  return dispatchNotification({
    userId: task.assignee_id,
    notificationKey: NOTIFICATION_KEYS.TASK_DEADLINE,
    entityKey,
    text
  });
}
