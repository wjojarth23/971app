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

/*
  Data Scout API
  POST actions:
    - record-event: { action, match_key, match_number, team_key, phase, event_type, event_value, role, on_shift }
  DELETE actions:
    - { id } => deletes specific event
  GET query params:
    - ?team_key=... => all events for team
    - ?team_key=...&match_key=... => events for that match/team
    - ?list_teams=1 => list of distinct team keys
*/

export async function POST({ request, url }) {
  try {
    const body = await request.json();
    if (body?.action !== 'record-event') return json({ error: 'Invalid action' }, { status: 400 });

    const authSupa = getClientFromRequest(request);
    const db = getDbClient(authSupa);
    const actor = await getActor(authSupa);
    const isLocal = isLocalHost(url);

    if (!isLocal && !actor?.id) return json({ error: 'Unauthorized' }, { status: 401 });

    const { match_key, match_number, team_key, phase, event_type, event_value, role, on_shift } = body;
    if (!match_key || !team_key || !event_type) return json({ error: 'Missing required fields' }, { status: 400 });

    const payload = {
      match_key,
      match_number: Number(match_number) || null,
      team_key,
      phase: phase || null,
      event_type,
      event_value: event_value ?? null,
      role: role ?? null,
      on_shift: typeof on_shift === 'boolean' ? on_shift : null,
      created_by: actor?.id || body?.user_id || null,
      created_at: new Date().toISOString()
    };

    const { data, error } = await db.from('scout_data_events').insert([payload]).select('*').single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

export async function DELETE({ request, url }) {
  try {
    const { id } = await request.json();
    if (!id) return json({ error: 'Missing ID' }, { status: 400 });

    const authSupa = getClientFromRequest(request);
    const db = getDbClient(authSupa);
    const actor = await getActor(authSupa);
    const isLocal = isLocalHost(url);

    if (!isLocal && !actor?.id) return json({ error: 'Unauthorized' }, { status: 401 });

    if (!isLocal) {
      const { data: profile } = await authSupa
        .from('user_profiles')
        .select('role')
        .eq('id', actor.id)
        .single();

      const { data: row, error: rowErr } = await db
        .from('scout_data_events')
        .select('created_by')
        .eq('id', id)
        .single();

      if (rowErr) return json({ error: rowErr.message }, { status: 500 });

      const canDelete = profile?.role === 'admin' || row?.created_by === actor.id;
      if (!canDelete) return json({ error: 'Forbidden' }, { status: 403 });
    }

    const { error } = await db.from('scout_data_events').delete().eq('id', id);
    if (error) return json({ error: error.message }, { status: 500 });

    return json({ success: true });
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
    const match_key = url.searchParams.get('match_key');

    if (team_key && match_key) {
      const { data, error } = await db
        .from('scout_data_events')
        .select('*')
        .eq('team_key', team_key)
        .eq('match_key', match_key)
        .order('created_at', { ascending: true });

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    if (team_key) {
      const { data, error } = await db
        .from('scout_data_events')
        .select('*')
        .eq('team_key', team_key)
        .order('created_at', { ascending: true });

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    if (url.searchParams.get('list_teams')) {
      const { data, error } = await db
        .from('scout_data_events')
        .select('team_key')
        .order('team_key', { ascending: true })
        .limit(2000);

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

    const recent = Number(url.searchParams.get('recent') || '100');
    const { data, error } = await db
      .from('scout_data_events')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(recent);

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
