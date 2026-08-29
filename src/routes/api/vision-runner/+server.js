import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';
import { summarizeVision, trajectoryMetrics, reconcileWithReference } from '$lib/visionAnalytics.js';
import { fetchTbaMatchReference } from '$lib/server/vision_reference.js';

const serviceClient = () => createClient(env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_KEY);
const authorized = (request) => {
  const expected = env.VISION_RUNNER_TOKEN;
  const supplied = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') || '';
  return Boolean(expected && supplied && expected.length === supplied.length);
};

async function checkToken(request) {
  if (!authorized(request)) return false;
  const expected = new TextEncoder().encode(env.VISION_RUNNER_TOKEN);
  const supplied = new TextEncoder().encode(request.headers.get('authorization').replace(/^Bearer\s+/i, ''));
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) difference |= expected[index] ^ supplied[index];
  return difference === 0;
}

export async function POST({ request }) {
  if (!(await checkToken(request))) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const action = body?.action;
  const db = serviceClient();

  if (action === 'claim') {
    const runnerId = String(body.runner_id || '').trim();
    if (!runnerId) return json({ error: 'runner_id required' }, { status: 400 });
    const { data: candidates, error } = await db.from('vision_runs').select('id').eq('status', 'queued').order('created_at').limit(5);
    if (error) return json({ error: error.message }, { status: 500 });
    for (const candidate of candidates || []) {
      const { data: run } = await db.from('vision_runs').update({ status: 'claimed', claimed_by: runnerId, claimed_at: new Date().toISOString() }).eq('id', candidate.id).eq('status', 'queued').select('*, vision_matches(*)').single();
      if (!run) continue;
      const { data: views } = await db.from('vision_views').select('*').eq('vision_match_id', run.vision_match_id);
      const signedViews = [];
      for (const view of views || []) {
        const { data: signed } = await db.storage.from('vision-recordings').createSignedUrl(view.storage_path, 3600);
        signedViews.push({ ...view, signed_url: signed?.signedUrl || null });
      }
      return json({ run: { ...run, views: signedViews } });
    }
    return json({ run: null });
  }

  if (action === 'processing') {
    const { data, error } = await db.from('vision_runs').update({ status: 'processing', started_at: new Date().toISOString() }).eq('id', body.run_id).eq('status', 'claimed').select('id');
    if (error) return json({ error: error.message }, { status: 500 });
    if (!data?.length) return json({ error: 'Run was not claimable' }, { status: 409 });
    return json({ success: true });
  }

  if (action === 'complete') {
    const { data: run } = await db.from('vision_runs').select('*, vision_matches(match_key)').eq('id', body.run_id).single();
    if (!run || run.status !== 'processing') return json({ error: 'Run is not processing' }, { status: 409 });
    const tracks = (body.tracks || []).map((track) => ({ ...track, vision_run_id: run.id, metrics: track.metrics || trajectoryMetrics(track.trajectory) }));
    const observations = (body.observations || []).map((observation) => ({ ...observation, vision_run_id: run.id, model_version: run.model_version }));
    if (tracks.length) await db.from('vision_tracks').insert(tracks);
    if (observations.length) await db.from('vision_observations').insert(observations);
    const summary = summarizeVision(observations, tracks);
    const reference = await fetchTbaMatchReference(run.vision_matches?.match_key, env.TBA_API_KEY || env.PUBLIC_TBA_API_KEY);
    if (reference) await db.from('vision_reference_snapshots').upsert({ vision_run_id: run.id, source: 'tba', match_key: run.vision_matches.match_key, payload: reference }, { onConflict: 'vision_run_id,source' });
    const discrepancies = reference ? reconcileWithReference(summary, reference, run.config?.thresholds).map((item) => ({ ...item, vision_run_id: run.id })) : [];
    if (discrepancies.length) await db.from('vision_discrepancies').insert(discrepancies);
    await Promise.all([
      db.from('vision_runs').update({ status: 'complete', completed_at: new Date().toISOString() }).eq('id', run.id).eq('status', 'processing'),
      db.from('vision_matches').update({ status: discrepancies.length ? 'review' : 'complete', updated_at: new Date().toISOString() }).eq('id', run.vision_match_id)
    ]);
    return json({ success: true, summary, reference, discrepancy_count: discrepancies.length });
  }

  if (action === 'fail') {
    await db.from('vision_runs').update({ status: 'failed', error: String(body.error || 'Runner failed'), completed_at: new Date().toISOString() }).eq('id', body.run_id).in('status', ['claimed','processing']);
    return json({ success: true });
  }
  return json({ error: 'Invalid action' }, { status: 400 });
}
