import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { supabase } from '$lib/supabase.js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env } from '$env/dynamic/private';

function getSupabaseForRead(request) {
  const serviceKey = env?.SUPABASE_SERVICE_KEY;
  if (serviceKey) {
    return createClient(PUBLIC_SUPABASE_URL, serviceKey);
  }
  const auth = request?.headers?.get?.('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: auth ? { Authorization: auth } : {} }
  });
}

/*
  Data Scout API
  POST actions:
    - record-event: { action, match_key, match_number, team_key, phase, event_type, event_value, role, on_shift, user_id }
  DELETE actions:
    - { id } => deletes specific event
  GET query params:
    - ?team_key=... => all events for team
    - ?team_key=...&match_key=... => events for that match/team
    - ?list_teams=1 => list of distinct team keys
*/

export async function POST({ request }) {
  try {
    const body = await request.json();
    if (body?.action !== 'record-event') return json({ error: 'Invalid action' }, { status: 400 });
    const {
      match_key, match_number, team_key, phase, event_type, event_value,
      role, on_shift, user_id
    } = body;
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
      created_by: user_id || null,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('scout_data_events').insert([payload]).select('*').single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

export async function DELETE({ request }) {
  try {
    const { id } = await request.json();
    if (!id) return json({ error: 'Missing ID' }, { status: 400 });

    const { error } = await supabase.from('scout_data_events').delete().eq('id', id);
    if (error) return json({ error: error.message }, { status: 500 });

    return json({ success: true });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

export async function GET({ url, request }) {
  const readSupa = getSupabaseForRead(request);
  try {
    const team_key = url.searchParams.get('team_key');
    const match_key = url.searchParams.get('match_key');

    if (team_key && match_key) {
      const { data, error } = await readSupa
        .from('scout_data_events')
        .select('*')
        .eq('team_key', team_key)
        .eq('match_key', match_key)
        .order('created_at', { ascending: true });
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    if (team_key) {
      const { data, error } = await readSupa
        .from('scout_data_events')
        .select('*')
        .eq('team_key', team_key)
        .order('created_at', { ascending: true });
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    if (url.searchParams.get('list_teams')) {
      const { data, error } = await readSupa
        .from('scout_data_events')
        .select('team_key')
        .order('team_key', { ascending: true })
        .limit(2000);
      if (error) return json({ error: error.message }, { status: 500 });
      const seen = new Set();
      const teams = [];
      for (const row of data || []) {
        const t = row?.team_key;
        if (t && !seen.has(t)) { seen.add(t); teams.push(t); }
      }
      return json({ success: true, data: teams });
    }

    const recent = Number(url.searchParams.get('recent') || '100');
    const { data, error } = await readSupa
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
