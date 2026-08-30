import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { getCronSecrets, isAuthorizedCronRequest } from '$lib/server/cron_auth.js';
import { getSupabase } from '$lib/server/971bot.js';
import { retentionDaysFrom, selectExpiredRecordings } from '$lib/server/vision_retention.js';

// Reclaims the video files behind long-since-released runs. Match recordings
// are the largest thing this feature stores and nothing ever deleted them.
//
// Two deliberate safety properties, both enforced in vision_retention.js:
// deletion is opt-in (no VISION_RECORDING_RETENTION_DAYS means this does
// nothing), and a recording is only eligible once its run has been released -
// video is the evidence behind a reviewer's decision.
//
// Fails closed for the same reason as the stale-runner sweep: cron_auth is
// fail-open by default, and this one deletes files.
export async function GET({ url, request }) {
  if (!getCronSecrets(env).length) {
    return json({
      error: 'No cron secret configured; refusing to run an unauthenticated deletion sweep. Set CRON_NOTIFICATION_TOKEN (see issue #5).'
    }, { status: 503 });
  }
  if (!isAuthorizedCronRequest({ url, headers: request.headers, env })) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  const retentionDays = retentionDaysFrom(env);
  if (!retentionDays) {
    return json({ ok: true, deleted: 0, reason: 'VISION_RECORDING_RETENTION_DAYS is not set; retention is opt-in' });
  }

  const db = getSupabase();
  const { data: views, error } = await db
    .from('vision_views')
    .select('id, storage_path, recording_deleted_at, vision_matches(vision_runs(released_at))')
    .is('recording_deleted_at', null);
  if (error) return json({ error: error.message }, { status: 500 });

  const expired = selectExpiredRecordings(views, { retentionDays });
  if (!expired.length) return json({ ok: true, checked: (views || []).length, deleted: 0 });

  const { error: removeError } = await db.storage
    .from('vision-recordings')
    .remove(expired.map((view) => view.storage_path));
  // Stamp nothing if the delete failed - a row marked reclaimed whose file is
  // still there would hide the storage from every future sweep.
  if (removeError) return json({ error: removeError.message }, { status: 500 });

  const { error: stampError } = await db
    .from('vision_views')
    .update({ recording_deleted_at: new Date().toISOString() })
    .in('id', expired.map((view) => view.id));
  if (stampError) return json({ error: stampError.message }, { status: 500 });

  return json({ ok: true, checked: (views || []).length, deleted: expired.length, retention_days: retentionDays });
}
