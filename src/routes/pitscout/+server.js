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

async function getActor(authSupa) {
  const { data } = await authSupa.auth.getUser();
  return data?.user || null;
}

function sanitizePhotoPaths(input) {
  if (!Array.isArray(input)) return [];
  const clean = input
    .map((value) => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean)
    .slice(0, 3);
  return [...new Set(clean)];
}

export async function POST({ request, url }) {
  try {
    const body = await request.json();
    if (body?.action !== 'save-entry') return json({ error: 'Invalid action' }, { status: 400 });

    const authSupa = getClientFromRequest(request);
    const db = getDbClient(authSupa);
    const actor = await getActor(authSupa);
    const isLocal = isLocalHost(url);

    if (!isLocal && !actor?.id) return json({ error: 'Unauthorized' }, { status: 401 });

    const event_key = String(body?.event_key || '').trim();
    const team_key = String(body?.team_key || '').trim();
    const drivebase_type = body?.drivebase_type || null;
    const shooter_type = body?.shooter_type || null;
    const hopper_type = body?.hopper_type || null;
    const human_player_balls_in_auto = body?.human_player_balls_in_auto || null;
    const photo_paths = sanitizePhotoPaths(body?.photo_paths);

    if (!event_key || !team_key) {
      return json({ error: 'event_key and team_key are required' }, { status: 400 });
    }

    const payload = {
      event_key,
      team_key,
      drivebase_type,
      shooter_type,
      hopper_type,
      human_player_balls_in_auto,
      photo_paths,
      created_by: actor?.id || body?.user_id || null,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await db
      .from('pit_scout_entries')
      .upsert(payload, { onConflict: 'event_key,team_key' })
      .select('*')
      .single();

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

    if (!isLocal && !actor?.id) return json({ error: 'Unauthorized' }, { status: 401 });

    const event_key = String(url.searchParams.get('event_key') || '').trim();
    const team_key = String(url.searchParams.get('team_key') || '').trim();

    if (event_key && team_key) {
      const { data, error } = await db
        .from('pit_scout_entries')
        .select('*')
        .eq('event_key', event_key)
        .eq('team_key', team_key)
        .maybeSingle();

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data: data || null });
    }

    if (event_key) {
      const { data, error } = await db
        .from('pit_scout_entries')
        .select('*')
        .eq('event_key', event_key)
        .order('team_key', { ascending: true });

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data: data || [] });
    }

    const recent = Number(url.searchParams.get('recent') || '100');
    const { data, error } = await db
      .from('pit_scout_entries')
      .select('*')
      .order('updated_at', { ascending: false })
      .limit(recent);

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data: data || [] });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
