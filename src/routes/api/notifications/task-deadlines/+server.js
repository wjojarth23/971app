import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { isAuthorizedCronRequest } from '$lib/server/cron_auth.js';

export async function GET({ url, request }) {
  if (!isAuthorizedCronRequest({ url, headers: request.headers, env })) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return json({
      ok: true,
      checked: 0,
      notified: 0,
      skipped: true,
      reason: 'p0-bug-deadlines-removed'
    });
  } catch (error) {
    return json({ error: error?.message || 'Failed to send task deadline notifications' }, { status: 500 });
  }
}
