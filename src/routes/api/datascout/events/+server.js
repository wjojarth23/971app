import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env } from '$env/dynamic/private';

function getSupabaseForRequest(request) {
  // Prefer service role to bypass RLS (reads work for all users)
  const serviceKey = env?.SUPABASE_SERVICE_KEY;
  if (serviceKey) {
    return createClient(PUBLIC_SUPABASE_URL, serviceKey);
  }
  // Fallback: anon client with user's auth so RLS can allow reads
  const auth = request?.headers?.get?.('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: auth ? { Authorization: auth } : {} }
  });
}

/**
 * GET /api/datascout/events
 * Query params:
 *   - team_key: events for team (optionally with match_key)
 *   - match_key: filter by match (with team_key)
 *   - list_teams=1: distinct team keys with data
 *   - recent: limit for default query (default 100)
 */
export async function GET({ url, request }) {
  const supabase = getSupabaseForRequest(request);
  try {
    const team_key = url.searchParams.get('team_key');
    const match_key = url.searchParams.get('match_key');

    if (team_key && match_key) {
      const { data, error } = await supabase
        .from('scout_data_events')
        .select('*')
        .eq('team_key', team_key)
        .eq('match_key', match_key)
        .order('created_at', { ascending: true });
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    if (team_key) {
      const { data, error } = await supabase
        .from('scout_data_events')
        .select('*')
        .eq('team_key', team_key)
        .order('created_at', { ascending: true });
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    if (url.searchParams.get('list_teams') === '1') {
      const { data, error } = await supabase
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
    const { data, error } = await supabase
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
