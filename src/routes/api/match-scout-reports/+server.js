import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getSupabase } from '$lib/server/971bot.js';
import { normalizeMatchScoutReport } from '$lib/server/matchScoutReports.js';

const clientFor = (request) => createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, { global: { headers: { Authorization: request.headers.get('authorization') || '' } } });
const serviceOr = (fallback) => { try { return getSupabase(); } catch { return fallback; } };
const local = (url) => ['localhost', '127.0.0.1'].includes(url.hostname);

export async function GET({ request, url }) {
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  if (!eventKey) return json({ error: 'event_key required' }, { status: 400 });
  const auth = clientFor(request);
  const { data: authData } = await auth.auth.getUser();
  if (!local(url) && !authData?.user?.id) return json({ error: 'Unauthorized' }, { status: 401 });
  const db = authData?.user?.id ? auth : serviceOr(auth);
  const { data, error } = await db.from('match_scout_reports').select('*').eq('event_key', eventKey).order('match_number');
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ success: true, data: data || [] });
}

export async function POST({ request, url }) {
  const auth = clientFor(request);
  const { data: authData } = await auth.auth.getUser();
  const actor = authData?.user;
  if (!local(url) && !actor?.id) return json({ error: 'Unauthorized' }, { status: 401 });
  const report = normalizeMatchScoutReport(await request.json());
  if (!report) return json({ error: 'Event, match, team, and starting position are required.' }, { status: 400 });
  const db = actor?.id ? auth : serviceOr(auth);
  const payload = { ...report, reported_by: actor?.id || null, updated_at: new Date().toISOString() };
  const { data, error } = await db.from('match_scout_reports').upsert(payload, { onConflict: 'event_key,match_number,team_key,reported_by' }).select('*').single();
  if (error) return json({ error: error.message }, { status: 500 });
  return json({ success: true, data });
}
