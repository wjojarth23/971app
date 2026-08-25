import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isAuthorizedCronRequest } from '$lib/server/cron_auth.js';
import { sendStaleManufacturingReminders } from '$lib/server/slack_notifications.js';

// Cron-only, same trust boundary/token as the planner notification sweep
// (isAuthorizedCronRequest / cron_auth.js) - not a new external app, just
// another scheduled first-party sweep, so it reuses that same secret
// rather than provisioning a new one.
export async function GET({ url, request }) {
  if (!isAuthorizedCronRequest({ url, headers: request.headers, env })) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await sendStaleManufacturingReminders();
  return json(result);
}
