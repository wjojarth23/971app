import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCronSecrets, isAuthorizedCronRequest } from '$lib/server/cron_auth.js';
import { sendVisionRunnerHealthAlerts } from '$lib/server/slack_notifications.js';

// Cron-only, same token as the other scheduled notification sweeps
// (cron_auth.js). A runner that loses its Qwen service stops claiming work and
// reports it nowhere but its own row - this is what turns that into a Slack
// alert.
//
// Fails CLOSED, unlike the older sweeps. isAuthorizedCronRequest() is
// deliberately fail-open - it accepts any request when no cron secret is
// configured - and CRON_NOTIFICATION_TOKEN is currently commented out of
// cloudbuild.yaml's --set-secrets (frc971/spartanshub issue #5), so inheriting
// that default would put a new unauthenticated endpoint on the live service.
// A health sweep that doesn't run is a far smaller problem than an open
// endpoint, and refusing loudly is what gets the secret configured. Remove
// this guard only once issue #5 is closed and the fail-open default is gone.
export async function GET({ url, request }) {
  if (!getCronSecrets(env).length) {
    return json({
      error: 'No cron secret configured; refusing to run an unauthenticated sweep. Set CRON_NOTIFICATION_TOKEN (see issue #5).'
    }, { status: 503 });
  }
  if (!isAuthorizedCronRequest({ url, headers: request.headers, env })) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const result = await sendVisionRunnerHealthAlerts();
  return json(result);
}
