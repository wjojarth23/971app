import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase.js';

// POST to save notes: expects { action: 'save-note', match_key, match_number, team_key, notes, user_id }
export async function POST({ request }) {
  try {
    const body = await request.json();
    const action = body?.action;
    if (action !== 'save-note') return json({ error: 'Invalid action' }, { status: 400 });

    const match_key = body.match_key || null;
    const match_number = body.match_number || null;
    const team_key = body.team_key || null;
    const notes = body.notes || '';
    const user_id = body.user_id || null;

    if (!match_key || !team_key) return json({ error: 'match_key and team_key required' }, { status: 400 });

    const payload = {
      match_key,
      match_number: Number(match_number) || null,
      team_key,
      notes: String(notes),
      created_by: user_id || null,
      created_at: new Date().toISOString()
    };

    const { data, error } = await supabase.from('scout_notes').insert([payload]).select('*').single();
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}

export async function GET({ url }) {
  try {
    // If a team_key query param is present, return all notes for that team
    const team_key = url.searchParams.get('team_key');
    if (team_key) {
      const { data, error } = await supabase
        .from('scout_notes')
        .select('*')
        .eq('team_key', team_key)
        .order('created_at', { ascending: false });
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    // If list_teams=1 requested, return distinct team keys (server-side dedupe)
    if (url.searchParams.get('list_teams')) {
      // fetch a large recent set and dedupe team_key values
      const recent = Number(url.searchParams.get('recent') || '1000');
      const { data, error } = await supabase
        .from('scout_notes')
        .select('team_key')
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

    // Default: Allow fetching recent notes via ?recent=50
    const recent = Number(url.searchParams.get('recent') || '50');
    const { data, error } = await supabase.from('scout_notes').select('*').order('created_at', { ascending: false }).limit(recent);
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
