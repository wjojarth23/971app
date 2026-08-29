import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getSupabase } from '$lib/server/971bot.js';
import { summarizeVision } from '$lib/visionAnalytics.js';

// Valid scout_data_events.event_type climb_pos values (see
// src/lib/scoutingStats.js's CLIMB_LEVEL map) - vision's own climb value is
// free-form (usually the literal string 'success' when no specific level was
// configured; see vision_runner.py's default_climb_level), so only a value
// that already matches this real vocabulary is safe to release. Anything
// else is silently skipped rather than corrupting downstream power-ranking
// aggregation with a value nothing else recognizes.
const VALID_CLIMB_POS = new Set(['N/A', 'Failed', 'L1', 'L2', 'L3']);

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

// A runner is considered online if it's heartbeated more recently than this.
// vision_runner.py's own default poll interval is 10s (VISION_POLL_SECONDS);
// this is a generous multiple of that so one slow iteration (a big video
// download, a GPU busy on inference) doesn't flap a healthy runner offline.
const RUNNER_ONLINE_THRESHOLD_MS = 60_000;

export async function GET({ request, url }) {
  const client = clientFor(request);
  const actor = await actorFor(client);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

  const dashboardEventKey = url.searchParams.get('dashboard');
  if (dashboardEventKey) {
    const { data: matches, error } = await client
      .from('vision_matches')
      .select('id, match_key, status, vision_runs(id, status, model_name, model_version, created_at, completed_at, released_at)')
      .eq('event_key', dashboardEventKey)
      .order('match_key');
    if (error) return json({ error: error.message }, { status: 403 });

    const runIds = [];
    const runCounts = { total: 0, complete: 0, failed: 0, in_progress: 0, released: 0 };
    for (const match of matches || []) {
      for (const run of match.vision_runs || []) {
        runCounts.total += 1;
        runIds.push(run.id);
        if (run.status === 'complete') runCounts.complete += 1;
        else if (run.status === 'failed') runCounts.failed += 1;
        else runCounts.in_progress += 1;
        if (run.released_at) runCounts.released += 1;
      }
    }

    const { data: discrepancies } = runIds.length
      ? await client.from('vision_discrepancies').select('id, severity, status').in('vision_run_id', runIds)
      : { data: [] };
    const discrepancyCounts = { total: (discrepancies || []).length, open: 0, open_critical: 0, resolved: 0 };
    for (const discrepancy of discrepancies || []) {
      if (discrepancy.status === 'open') {
        discrepancyCounts.open += 1;
        if (discrepancy.severity === 'critical') discrepancyCounts.open_critical += 1;
      } else {
        discrepancyCounts.resolved += 1;
      }
    }

    const [{ data: runners }, { count: queueDepth }] = await Promise.all([
      client.from('vision_runners').select('*').order('runner_id'),
      client.from('vision_runs').select('id', { count: 'exact', head: true }).eq('status', 'queued')
    ]);
    const now = Date.now();
    const fleet = (runners || []).map((runner) => ({
      ...runner,
      online: runner.last_seen_at ? (now - new Date(runner.last_seen_at).getTime()) < RUNNER_ONLINE_THRESHOLD_MS : false
    }));

    return json({
      success: true,
      data: {
        event_key: dashboardEventKey,
        matches_total: (matches || []).length,
        matches_complete: (matches || []).filter((match) => match.status === 'complete').length,
        runs: runCounts,
        discrepancies: discrepancyCounts,
        queue_depth: queueDepth ?? 0,
        runners: fleet
      }
    });
  }

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
  let tracks = [], observations = [], discrepancies = [], qwenClips = [];
  if (runId) {
    const results = await Promise.all([
      client.from('vision_tracks').select('*').eq('vision_run_id', runId),
      client.from('vision_observations').select('*').eq('vision_run_id', runId).order('started_ms'),
      client.from('vision_discrepancies').select('*').eq('vision_run_id', runId).order('created_at'),
      client.from('vision_qwen_clips').select('id,view_id,started_ms,ended_ms,model,revision,dtype,latency_ms,clip_quality,event_count,normalized_result,created_at').eq('vision_run_id', runId).order('started_ms')
    ]);
    tracks = results[0].data || [];
    observations = results[1].data || [];
    discrepancies = results[2].data || [];
    qwenClips = results[3].data || [];
  }
  return json({ success: true, data: { match, views: views || [], runs: runs || [], tracks, observations, discrepancies, qwenClips } });
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
      homography: body.homography || null, calibration_points: body.calibration_points || [],
      field_mask: body.field_mask || null, goal_zones: body.goal_zones || []
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
    const { data, error } = await client.from('vision_runs').insert({
      vision_match_id: body.vision_match_id,
      model_name: body.model_name,
      model_version: body.model_version,
      qwen_model: body.qwen_model || 'Qwen/Qwen3-VL-30B-A3B-Instruct',
      qwen_revision: body.qwen_revision || '9c4b90e1e4ba969fd3b5378b57d966d725f1b86c',
      qwen_dtype: 'bfloat16',
      config: body.config || {},
      created_by: actor.id
    }).select('*').single();
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

    // Naming a robot is the whole point of the identity editor, so push it
    // down to that robot's own events. Without this the assignment only ever
    // reached vision_tracks, summarizeVision reads team identity off the
    // observations, and release-run would emit nothing for a track a human
    // had just carefully identified. Observations already reviewed are left
    // alone - a human decision outranks a later bulk re-attribution.
    const { data: attributed, error: cascadeError } = await client
      .from('vision_observations')
      .update({ team_key: body.team_key || null })
      .eq('track_id', body.id)
      .eq('review_status', 'unreviewed')
      .select('id');
    if (cascadeError) return json({ error: cascadeError.message }, { status: 400 });
    return json({ success: true, data, attributed_observations: attributed?.length || 0 });
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
  // Bulk review. A single match can produce dozens of observations across
  // several views, and clearing them one click at a time is slower than
  // scouting the match by hand - which would defeat the point of the tool.
  // Deliberately limited to the non-destructive verdicts: 'corrected' needs a
  // per-observation value and team, so it stays single-row only.
  if (action === 'review-observations') {
    const allowed = ['accepted', 'rejected', 'unobservable'];
    const ids = Array.isArray(body.ids) ? body.ids.filter(Boolean) : [];
    if (!ids.length || !allowed.includes(body.status)) {
      return json({ error: 'ids[] and a status of accepted, rejected or unobservable are required' }, { status: 400 });
    }
    if (ids.length > 500) return json({ error: 'Too many observations in one request (max 500)' }, { status: 400 });
    const { data, error } = await client.from('vision_observations').update({
      review_status: body.status,
      reviewer_id: actor.id,
      reviewed_at: new Date().toISOString()
    }).in('id', ids).select('id');
    if (error) return json({ error: error.message }, { status: 400 });
    return json({ success: true, data: { reviewed: data?.length || 0 } });
  }
  if (action === 'review-observation') {
    const allowed = ['accepted','corrected','rejected','unobservable'];
    if (!body.id || !allowed.includes(body.status)) return json({ error: 'Valid observation id and review status required' }, { status: 400 });
    const updates = {
      review_status: body.status,
      reviewer_id: actor.id,
      reviewed_at: new Date().toISOString()
    };
    if (body.status === 'corrected') {
      if (body.value && typeof body.value === 'object') updates.value = body.value;
      if (body.team_key !== undefined) updates.team_key = body.team_key || null;
    }
    const { data, error } = await client.from('vision_observations').update(updates).eq('id', body.id).select('*').single();
    if (error) return json({ error: error.message }, { status: 400 });
    return json({ success: true, data });
  }

  // Reviewed-result consumer: the one path that lets a project owner turn
  // advisory vision output into real scouting data. Every other action
  // above is available to any approved user; this one requires the
  // separate VISION_RELEASE permission (see permissions.js).
  if (action === 'release-run') {
    if (!body.run_id) return json({ error: 'run_id required' }, { status: 400 });

    const { data: actorProfile } = await client.from('user_profiles').select('role, permissions').eq('id', actor.id).single();
    const canRelease = actorProfile?.role === 'admin' || (actorProfile?.permissions || []).includes('VISION_RELEASE');
    if (!canRelease) return json({ error: 'VISION_RELEASE permission required' }, { status: 403 });

    const db = getSupabase(); // service role: writes to scout_data_events, a
    // table this actor's own RLS identity has no INSERT grant on (see
    // scoutingvision.md) - the permission check above is the real gate.
    const { data: run, error: runError } = await db.from('vision_runs').select('*, vision_matches(match_key)').eq('id', body.run_id).single();
    if (runError) return json({ error: runError.message }, { status: 404 });
    if (run.status !== 'complete') return json({ error: 'Only a completed run can be released' }, { status: 400 });
    if (run.released_at) return json({ error: 'This run has already been released' }, { status: 409 });

    const matchKey = run.vision_matches?.match_key;
    if (!matchKey) return json({ error: 'Run has no associated match' }, { status: 400 });

    const [{ data: tracks }, { data: observations }] = await Promise.all([
      db.from('vision_tracks').select('*').eq('vision_run_id', run.id),
      db.from('vision_observations').select('*').eq('vision_run_id', run.id)
    ]);
    const reviewedObservations = (observations || []).filter((observation) => ['accepted', 'corrected'].includes(observation.review_status));
    const summary = summarizeVision(reviewedObservations, tracks || []);

    const nowIso = new Date().toISOString();
    const rows = [];
    const skippedClimbs = [];
    for (const [teamKey, team] of Object.entries(summary.teams)) {
      if (!teamKey) continue; // never release an alliance-only, unattributed result as a specific team's data
      if (team.fuelObservations > 0 && Number.isFinite(team.fuelScored)) {
        rows.push({
          match_key: matchKey, match_number: null, team_key: teamKey, phase: null,
          event_type: 'hub_fuel_override', event_value: String(Math.round(team.fuelScored)),
          role: 'vision', on_shift: null, created_by: actor.id, created_at: nowIso
        });
      }
      if (team.climb && VALID_CLIMB_POS.has(team.climb)) {
        rows.push({
          match_key: matchKey, match_number: null, team_key: teamKey, phase: null,
          event_type: 'climb_pos', event_value: team.climb,
          role: 'vision', on_shift: null, created_by: actor.id, created_at: nowIso
        });
      } else if (team.climb) {
        // Refusing an unrecognized climb value is right, but doing it silently
        // isn't: the release looks like it worked while that team's climb
        // quietly never lands. Name it so a reviewer can correct the value.
        skippedClimbs.push({ team_key: teamKey, value: team.climb });
      }
    }
    if (!rows.length) {
      return json({
        error: skippedClimbs.length
          ? `No releasable results: ${skippedClimbs.length} climb(s) have a level that isn't one of ${[...VALID_CLIMB_POS].join(', ')} - correct them in review, or set a default climb level on the run.`
          : 'No reviewed, attributable team results to release yet - accept/correct observations and resolve team identity first',
        skipped_climbs: skippedClimbs
      }, { status: 400 });
    }

    const { data: inserted, error: insertError } = await db.from('scout_data_events').insert(rows).select('id');
    if (insertError) return json({ error: insertError.message }, { status: 500 });

    await Promise.all([
      db.from('vision_runs').update({ released_at: nowIso, released_by: actor.id }).eq('id', run.id),
      db.from('vision_release_log').insert({
        vision_run_id: run.id,
        released_by: actor.id,
        scout_data_event_ids: (inserted || []).map((row) => row.id),
        team_count: Object.keys(summary.teams).length
      })
    ]);

    return json({ success: true, data: { released_count: rows.length, skipped_climbs: skippedClimbs } });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
}
