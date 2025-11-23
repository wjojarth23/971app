import { getSupabase, getSlackClient, slackUserIdForEmail } from '$lib/server/971bot';
import { NOTIFICATION_KEYS } from '$lib/notifications/constants.js';
import { mergeNotificationSettings } from '$lib/notifications/settings.js';

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
  await client.chat.postMessage({ channel, text, blocks });
  return { ok: true };
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
  const when = matchTime ? ` at ${new Date(matchTime * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : '';
  const text = `${label}${when} is starting soon. You're scouting teams ${teamList}.`; 
  const entityKey = `${matchKey}:${userId}`;
  return dispatchNotification({
    userId,
    notificationKey: NOTIFICATION_KEYS.MATCH_REMINDERS,
    entityKey,
    text
  });
}
