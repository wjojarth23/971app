import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isAuthorizedCronRequest } from '$lib/server/cron_auth.js';
import { sendVisionRunnerHealthAlerts } from '$lib/server/slack_notifications.js';

// Cron-only, same trust boundary/token as the other scheduled notification
// sweeps (isAuthorizedCronRequest / cron_auth.js). A runner that loses its
// Qwen service stops claiming work and reports it nowhere but its own row -
// this is what turns that into a Slack alert.
export async function GET({ url, request }) {
  if (!isAuthorizedCronRequest({ url, headers: request.headers, env })) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await sendVisionRunnerHealthAlerts();
  return json(result);
}
