import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getSupabase } from '$lib/server/971bot';
import { notifyTaskDeadlineById } from '$lib/server/slack_notifications.js';

const OPEN_STATUSES = ['open', 'in_progress', 'file_uploaded', 'under_review', 'changes_requested'];

function requireToken(url) {
  const expected = env.NOTIFICATION_CRON_TOKEN || env.CRON_NOTIFICATION_TOKEN || null;
  if (!expected) return true;
  const provided = url.searchParams.get('token');
  return provided === expected;
}

export async function GET({ url }) {
  if (!requireToken(url)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const db = getSupabase();
    const nowIso = new Date().toISOString();
    const { data: overdue, error } = await db
      .from('tasks')
      .select('id')
      .not('deadline_at', 'is', null)
      .lte('deadline_at', nowIso)
      .in('status', OPEN_STATUSES);
    if (error) return json({ error: error.message || 'Failed to query overdue tasks' }, { status: 500 });

    let sent = 0;
    for (const row of overdue || []) {
      const res = await notifyTaskDeadlineById(row.id);
      if (res?.ok) sent += 1;
    }

    return json({ ok: true, checked: (overdue || []).length, notified: sent });
  } catch (error) {
    return json({ error: error?.message || 'Failed to send task deadline notifications' }, { status: 500 });
  }
}
