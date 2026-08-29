import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getSupabase } from '$lib/server/971bot.js';
import {
  PROBLEM_STATUSES,
  normalizeProblemCreate,
  normalizeProblemStatus
} from '$lib/server/scoutingProblems.js';

const getClientFromRequest = (request) => createClient(
  PUBLIC_SUPABASE_URL,
  PUBLIC_SUPABASE_ANON_KEY,
  { global: { headers: { Authorization: request?.headers?.get('authorization') || '' } } }
);

function getDbClient(fallbackClient) {
  try {
    return getSupabase();
  } catch {
    return fallbackClient;
  }
}

async function getActor(client) {
  const { data } = await client.auth.getUser();
  return data?.user || null;
}

function isLocal(url) {
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
}

export async function GET({ request, url }) {
  try {
    const authClient = getClientFromRequest(request);
    const actor = await getActor(authClient);
    if (!isLocal(url) && !actor?.id) return json({ error: 'Unauthorized' }, { status: 401 });
    const db = actor?.id ? authClient : getDbClient(authClient);

    const eventKey = String(url.searchParams.get('event_key') || '').trim();
    if (!eventKey) return json({ error: 'event_key required' }, { status: 400 });

    let query = db
      .from('scouting_problem_reports')
      .select('*')
      .eq('event_key', eventKey)
      .order('created_at', { ascending: false })
      .limit(500);
    const teamKey = String(url.searchParams.get('team_key') || '').trim();
    const status = String(url.searchParams.get('status') || '').trim().toLowerCase();
    if (teamKey) query = query.eq('team_key', teamKey);
    if (PROBLEM_STATUSES.includes(status)) query = query.eq('status', status);

    const { data, error } = await query;
    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data: data || [] });
  } catch (error) {
    return json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST({ request, url }) {
  try {
    const body = await request.json();
    const authClient = getClientFromRequest(request);
    const actor = await getActor(authClient);
    if (!isLocal(url) && !actor?.id) return json({ error: 'Unauthorized' }, { status: 401 });
    const db = actor?.id ? authClient : getDbClient(authClient);

    if (body.action === 'create-report') {
      const payload = normalizeProblemCreate(body);
      if (!payload) return json({ error: 'event_key, team_key, and summary required' }, { status: 400 });
      const { data, error } = await db
        .from('scouting_problem_reports')
        .insert({ ...payload, reported_by: actor?.id || body.user_id || null })
        .select('*')
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    if (body.action === 'update-status') {
      const updates = normalizeProblemStatus(body);
      if (!body.id || !updates) return json({ error: 'id and valid status required' }, { status: 400 });
      const now = new Date().toISOString();
      if (updates.status === 'acknowledged') {
        updates.acknowledged_by = actor?.id || null;
        updates.acknowledged_at = now;
      }
      if (updates.status === 'resolved' || updates.status === 'dismissed') {
        updates.resolved_by = actor?.id || null;
        updates.resolved_at = now;
      }
      if (updates.status === 'open') {
        updates.acknowledged_by = null;
        updates.acknowledged_at = null;
        updates.resolved_by = null;
        updates.resolved_at = null;
      }
      const { data, error } = await db
        .from('scouting_problem_reports')
        .update(updates)
        .eq('id', body.id)
        .select('*')
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data });
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  } catch (error) {
    return json({ error: error.message || 'Internal error' }, { status: 500 });
  }
}
