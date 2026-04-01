import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { sendDuePlannerPrompts } from '$lib/server/planner_notifications.js';

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
    const result = await sendDuePlannerPrompts(new Date());
    return json(result);
  } catch (error) {
    return json({ error: error?.message || 'Failed to send planner prompts' }, { status: 500 });
  }
}
