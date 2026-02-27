import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import notescoutConfig from '$lib/notescout.json';
import { TEAM_ROLES } from '$lib/permissions.js';
import { getSupabase } from '$lib/server/971bot.js';

const COMPETITION_LEAD = String(TEAM_ROLES.COMPETITION_LEAD || 'Competition Lead');

const getClientFromRequest = (request) => {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
};

function fallbackEventKey() {
  return String(notescoutConfig?.event_key || '').trim() || null;
}

function isCompetitionLead(profile) {
  return String(profile?.team_role || '').trim().toLowerCase() === COMPETITION_LEAD.toLowerCase();
}

async function fetchActorProfile(authSupa) {
  const { data } = await authSupa.auth.getUser();
  const actorId = data?.user?.id || null;
  if (!actorId) return { actorId: null, profile: null };

  const { data: profile } = await authSupa
    .from('user_profiles')
    .select('id, role, team_role')
    .eq('id', actorId)
    .single();

  return { actorId, profile: profile || null };
}

async function getActiveEventKey(db) {
  const { data, error } = await db
    .from('scouting_settings')
    .select('event_key')
    .eq('id', 1)
    .maybeSingle();

  if (error) return fallbackEventKey();
  return String(data?.event_key || '').trim() || fallbackEventKey();
}

export async function GET() {
  try {
    const db = getSupabase();
    const eventKey = await getActiveEventKey(db);
    return json({ success: true, data: { event_key: eventKey } });
  } catch {
    return json({ success: true, data: { event_key: fallbackEventKey() } });
  }
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    const nextEventKey = String(body?.event_key || '').trim();
    if (!nextEventKey) return json({ error: 'event_key is required' }, { status: 400 });

    const authSupa = getClientFromRequest(request);
    const { actorId, profile } = await fetchActorProfile(authSupa);
    if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!isCompetitionLead(profile)) return json({ error: 'Forbidden' }, { status: 403 });

    const db = getSupabase();
    const { data, error } = await db
      .from('scouting_settings')
      .upsert({ id: 1, event_key: nextEventKey, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: 'id' })
      .select('event_key')
      .single();

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data: { event_key: data?.event_key || nextEventKey } });
  } catch (e) {
    return json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
