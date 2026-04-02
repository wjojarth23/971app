import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isAuthorizedCronRequest } from '$lib/server/cron_auth.js';
import { sendDuePlannerPrompts } from '$lib/server/planner_notifications.js';

export async function GET({ url, request }) {
  if (!isAuthorizedCronRequest({ url, headers: request.headers, env })) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const result = await sendDuePlannerPrompts(new Date());
    return json(result);
  } catch (error) {
    return json({ error: error?.message || 'Failed to send planner prompts' }, { status: 500 });
  }
}
