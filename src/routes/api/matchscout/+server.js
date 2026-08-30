import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getSupabase } from '$lib/server/971bot.js';
import { normalizeMatchScoutEntry, normalizePitProblemReport, normalizeTeamKey } from '$lib/server/matchScoutingSchema.js';

// Backend for match scouting and the pit-problem handoff.
//
// Both existed only in the browser before this: the match scouting workspace
// had no server at all, and a flagged pit problem went to window.localStorage
// - which is per-device, so the pit crew it was written for could never see
// it. Everything here exists to get that data off the one phone it was
// entered on.

function clientFor(request) {
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: request.headers.get('authorization') || '' } }
  });
}

// Writes go through the service client for the same reason pitscout does:
// scouts are not granted direct table rights, and the route is the gate.
function writeClient(fallback) {
  try {
    return getSupabase();
  } catch {
    return fallback;
  }
}

async function actorFor(client) {
  const { data } = await client.auth.getUser();
  return data?.user || null;
}

export async function GET({ request, url }) {
  const client = clientFor(request);
  const actor = await actorFor(client);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

  const db = writeClient(client);
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!eventKey) return json({ error: 'event_key is required' }, { status: 400 });

  const resource = url.searchParams.get('resource') || 'entries';

  if (resource === 'pit-problems') {
    // The pit crew's actual question is "what is still open", so unresolved
    // reports come first and newest-first within that.
    let query = db.from('pit_problem_reports').select('*').eq('event_key', eventKey);
    if (url.searchParams.get('open') === '1') query = query.eq('resolved', false);
    const teamKey = normalizeTeamKey(url.searchParams.get('team_key'));
    if (teamKey) query = query.eq('team_key', teamKey);
    const { data, error } = await query.order('resolved').order('created_at', { ascending: false });
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  }

  let query = db.from('match_scout_entries').select('*').eq('event_key', eventKey);
  const teamKey = normalizeTeamKey(url.searchParams.get('team_key'));
  if (teamKey) query = query.eq('team_key', teamKey);
  const matchKey = String(url.searchParams.get('match_key') || '').trim();
  if (matchKey) query = query.eq('match_key', matchKey);
  const { data, error } = await query.order('match_key').order('team_key');
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ success: true, data });
}

export async function POST({ request }) {
  const client = clientFor(request);
  const actor = await actorFor(client);
  if (!actor) return json({ error: 'Unauthorized' }, { status: 401 });

  const body = await request.json().catch(() => null);
  const action = body?.action;
  const db = writeClient(client);

  if (action === 'save-entry') {
    const { value, error: invalid } = normalizeMatchScoutEntry(body, actor.id);
    if (invalid) return json({ error: invalid }, { status: 400 });

    // Keyed on the scout as well as the match, so two people covering the
    // same robot both keep their observations instead of overwriting each
    // other, while one scout revising their own report updates it in place.
    const { data, error } = await db
      .from('match_scout_entries')
      .upsert(value, { onConflict: 'event_key,match_key,team_key,created_by' })
      .select('*')
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  }

  if (action === 'report-pit-problem') {
    const { value, error: invalid } = normalizePitProblemReport(body, actor.id);
    if (invalid) return json({ error: invalid }, { status: 400 });
    const { data, error } = await db.from('pit_problem_reports').insert(value).select('*').single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  }

  if (action === 'resolve-pit-problem') {
    if (!body?.id) return json({ error: 'id is required' }, { status: 400 });
    const resolved = body.resolved !== false;
    const { data, error } = await db
      .from('pit_problem_reports')
      .update({
        resolved,
        // Reopening clears the resolution rather than leaving a stale one, so
        // "who closed this" always refers to the closure that is in force.
        resolved_by: resolved ? actor.id : null,
        resolved_at: resolved ? new Date().toISOString() : null
      })
      .eq('id', body.id)
      .select('*')
      .single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
}
