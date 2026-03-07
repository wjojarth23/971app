import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getSupabase } from '$lib/server/971bot.js';

const getClientFromRequest = (request) => {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
};

function getDbClient(fallbackClient) {
  try {
    return getSupabase();
  } catch {
    return fallbackClient;
  }
}

function isLocalHost(url) {
  return url?.hostname === 'localhost' || url?.hostname === '127.0.0.1';
}

function isPublicReadRequest(url) {
  const teamKey = String(url.searchParams.get('team_key') || '').trim();
  return url.searchParams.has('list_teams') || Boolean(teamKey);
}

async function getActor(authSupa) {
  const { data } = await authSupa.auth.getUser();
  return data?.user || null;
}

// POST to save notes: expects { action: 'save-note', match_key, match_number, team_key, notes }
export async function POST({ request, url }) {
  try {
    const body = await request.json();
    const action = body?.action;
    if (action !== 'save-note') return json({ error: 'Invalid action' }, { status: 400 });

    const authSupa = getClientFromRequest(request);
    const db = getDbClient(authSupa);
    const actor = await getActor(authSupa);
    const isLocal = isLocalHost(url);

    if (!isLocal && !actor?.id) return json({ error: 'Unauthorized' }, { status: 401 });

    const match_key = body.match_key || null;
    const match_number = body.match_number || null;
    const team_key = body.team_key || null;
    const notes = body.notes || '';

    if (!match_key || !team_key) return json({ error: 'match_key and team_key required' }, { status: 400 });

    const payload = {
      match_key,
      match_number: Number(match_number) || null,
      team_key,
      notes: String(notes),
      created_by: actor?.id || body?.user_id || null,
      created_at: new Date().toISOString()
    };

    const { data, error } = await db.from('scout_notes').insert([payload]).select('*').single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

export async function GET({ url, request }) {
  try {
    const authSupa = getClientFromRequest(request);
    const db = getDbClient(authSupa);
    const actor = await getActor(authSupa);
    const isLocal = isLocalHost(url);
    const canReadPublic = isPublicReadRequest(url);

    if (!isLocal && !actor?.id && !canReadPublic) return json({ error: 'Unauthorized' }, { status: 401 });

    const team_key = url.searchParams.get('team_key');
    const event_key = String(url.searchParams.get('event_key') || '').trim();
    const applyEventFilter = (query) => (event_key ? query.ilike('match_key', `${event_key}_%`) : query);
    if (team_key) {
      let query = db
        .from('scout_notes')
        .select('*')
        .eq('team_key', team_key);
      query = applyEventFilter(query);
      const { data, error } = await query.order('created_at', { ascending: false });

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    if (url.searchParams.get('list_teams')) {
      const recent = Number(url.searchParams.get('recent') || '1000');
      let query = db
        .from('scout_notes')
        .select('team_key');
      query = applyEventFilter(query);
      const { data, error } = await query
        .order('team_key', { ascending: true })
        .limit(recent);

      if (error) return json({ error: error.message }, { status: 500 });

      const seen = new Set();
      const teams = [];
      for (const row of data || []) {
        const t = row?.team_key;
        if (t && !seen.has(t)) {
          seen.add(t);
          teams.push(t);
        }
      }
      return json({ success: true, data: teams });
    }

    const recent = Number(url.searchParams.get('recent') || '50');
    const { data, error } = await db
      .from('scout_notes')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(recent);

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
