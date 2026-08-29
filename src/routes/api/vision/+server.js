import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

function clientFor(request) {
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: request.headers.get('authorization') || '' } }
  });
}

async function actorFor(client) {
  const { data } = await client.auth.getUser();
  return data?.user || null;
}

const safeName = (value) => String(value || 'recording.mov').replace(/[^a-zA-Z0-9._-]+/g, '-').slice(-100);

export async function GET({ request, url }) {
  const client = clientFor(request);
  const actor = await actorFor(client);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });
  const id = url.searchParams.get('id');
  if (!id) {
    const { data, error } = await client.from('vision_matches').select('*, vision_views(count), vision_runs(id,status,model_name,model_version,created_at)').order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, { status: 403 });
    return json({ success: true, data });
  }
  const [{ data: match, error }, { data: rawViews }, { data: runs }] = await Promise.all([
    client.from('vision_matches').select('*').eq('id', id).single(),
    client.from('vision_views').select('*').eq('vision_match_id', id).order('created_at'),
    client.from('vision_runs').select('*').eq('vision_match_id', id).order('created_at', { ascending: false })
  ]);
  if (error) return json({ error: error.message }, { status: 404 });
  const views = [];
  for (const view of rawViews || []) {
    const { data: signed } = await client.storage.from('vision-recordings').createSignedUrl(view.storage_path, 900);
    views.push({ ...view, signed_url: signed?.signedUrl || null });
  }
  const runId = url.searchParams.get('run_id') || runs?.[0]?.id;
  let tracks = [], observations = [], discrepancies = [];
  if (runId) {
    const results = await Promise.all([
      client.from('vision_tracks').select('*').eq('vision_run_id', runId),
      client.from('vision_observations').select('*').eq('vision_run_id', runId).order('started_ms'),
      client.from('vision_discrepancies').select('*').eq('vision_run_id', runId).order('created_at')
    ]);
    tracks = results[0].data || [];
    observations = results[1].data || [];
    discrepancies = results[2].data || [];
  }
  return json({ success: true, data: { match, views: views || [], runs: runs || [], tracks, observations, discrepancies } });
}

export async function POST({ request }) {
  const client = clientFor(request);
  const actor = await actorFor(client);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });
  const body = await request.json().catch(() => null);
  const action = body?.action;

  if (action === 'create-match') {
    if (!body.event_key || !body.match_key) return json({ error: 'event_key and match_key required' }, { status: 400 });
    const { data, error } = await client.from('vision_matches').insert({ event_key: body.event_key, match_key: body.match_key, capture_notes: body.capture_notes || null, created_by: actor.id }).select('*').single();
    if (error) return json({ error: error.message }, { status: 400 });
    return json({ success: true, data });
  }

  if (action === 'add-view') {
    if (!body.vision_match_id || !body.file_name || !body.label) return json({ error: 'vision_match_id, label, and file_name required' }, { status: 400 });
    const { data: match, error: matchError } = await client.from('vision_matches').select('event_key,match_key').eq('id', body.vision_match_id).single();
    if (matchError) return json({ error: matchError.message }, { status: 404 });
    const storagePath = `${match.event_key}/${match.match_key}/${crypto.randomUUID()}-${safeName(body.file_name)}`;
    const { data: view, error } = await client.from('vision_views').insert({
      vision_match_id: body.vision_match_id, label: body.label, storage_path: storagePath,
      camera_position: body.camera_position || null, frame_rate: body.frame_rate || null,
      width: body.width || null, height: body.height || null, sync_offset_ms: body.sync_offset_ms || 0,
      homography: body.homography || null, calibration_points: body.calibration_points || []
    }).select('*').single();
    if (error) return json({ error: error.message }, { status: 400 });
    const { data: upload, error: uploadError } = await client.storage.from('vision-recordings').createSignedUploadUrl(storagePath);
    if (uploadError) return json({ error: uploadError.message }, { status: 500 });
    return json({ success: true, data: { view, upload } });
  }

  if (action === 'queue-run') {
    if (!body.vision_match_id || !body.model_name || !body.model_version) return json({ error: 'vision_match_id and model identity required' }, { status: 400 });
    const { data: views } = await client.from('vision_views').select('id').eq('vision_match_id', body.vision_match_id);
    if (!views?.length) return json({ error: 'Upload at least one camera view first' }, { status: 400 });
    const { data, error } = await client.from('vision_runs').insert({ vision_match_id: body.vision_match_id, model_name: body.model_name, model_version: body.model_version, config: body.config || {}, created_by: actor.id }).select('*').single();
    if (error) return json({ error: error.message }, { status: 400 });
    await client.from('vision_matches').update({ status: 'queued', updated_at: new Date().toISOString() }).eq('id', body.vision_match_id);
    return json({ success: true, data });
  }

  if (action === 'review') {
    const allowed = ['accepted_vision','accepted_reference','corrected','unobservable','dismissed'];
    if (!body.id || !allowed.includes(body.status)) return json({ error: 'Valid discrepancy id and status required' }, { status: 400 });
    const { data, error } = await client.from('vision_discrepancies').update({ status: body.status, reviewer_id: actor.id, review_notes: body.review_notes || null, reviewed_at: new Date().toISOString() }).eq('id', body.id).select('*').single();
    if (error) return json({ error: error.message }, { status: 400 });
    return json({ success: true, data });
  }
  if (action === 'update-track') {
    if (!body.id) return json({ error: 'track id required' }, { status: 400 });
    const { data, error } = await client.from('vision_tracks').update({
      team_key: body.team_key || null,
      identity_confidence: body.team_key ? 1 : 0,
      needs_review: !body.team_key
    }).eq('id', body.id).select('*').single();
    if (error) return json({ error: error.message }, { status: 400 });
    return json({ success: true, data });
  }
  if (action === 'update-observation') {
    if (!body.id) return json({ error: 'observation id required' }, { status: 400 });
    const { data, error } = await client.from('vision_observations').update({
      team_key: body.team_key || null,
      value: body.value || {},
      confidence: Number.isFinite(Number(body.confidence)) ? Number(body.confidence) : undefined
    }).eq('id', body.id).select('*').single();
    if (error) return json({ error: error.message }, { status: 400 });
    return json({ success: true, data });
  }
  return json({ error: 'Invalid action' }, { status: 400 });
}
