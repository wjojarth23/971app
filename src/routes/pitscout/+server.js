import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getSupabase } from '$lib/server/971bot.js';
import { selectPitScoutEntries, upsertPitScoutEntry } from '$lib/server/pitScoutingSchema.js';

const NO_CLIMB_OPTION = 'No Climb';
const CLIMB_OPTIONS = [NO_CLIMB_OPTION, 'L1 Auto', 'L1', 'L2', 'L3'];

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
  const eventKey = String(url.searchParams.get('event_key') || '').trim();
  return Boolean(eventKey);
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

function sanitizeAutoOptions(input) {
  if (!Array.isArray(input)) return [];

  const clean = [];
  const seen = new Set();

  for (const value of input) {
    const name = String(value?.name || '').trim().slice(0, 60);
    const description = String(value?.description || '').trim().slice(0, 220);
    if (!name || !description) continue;

    const key = `${name.toLowerCase()}::${description.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    clean.push({ name, description });

    if (clean.length >= 8) break;
  }

  return clean;
}

function sanitizeLongText(input, maxLength = 240) {
  return String(input || '').trim().slice(0, maxLength) || null;
}

function sanitizeEstimatedBps(input) {
  if (input === null || input === undefined) return null;
  const raw = typeof input === 'string' ? input.trim() : input;
  if (raw === '') return null;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 0) return null;

  return Math.round(parsed * 100) / 100;
}

function sanitizeClimbOptions(input) {
  if (!Array.isArray(input)) return [];
  const selected = new Set(
    input
      .map((value) => String(value || '').trim())
      .filter((value) => CLIMB_OPTIONS.includes(value))
  );
  if (selected.has(NO_CLIMB_OPTION)) return [NO_CLIMB_OPTION];
  return CLIMB_OPTIONS.filter((value) => value !== NO_CLIMB_OPTION && selected.has(value));
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
    const likely_breaking_component = sanitizeLongText(body?.likely_breaking_component);
    const estimated_bps = sanitizeEstimatedBps(body?.estimated_bps);
    const climb_options = sanitizeClimbOptions(body?.climb_options);
    const photo_paths = sanitizePhotoPaths(body?.photo_paths);
    const auto_options = sanitizeAutoOptions(body?.auto_options);

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
      likely_breaking_component,
      estimated_bps,
      climb_options,
      auto_options,
      photo_paths,
      created_by: actor?.id || body?.user_id || null,
      updated_at: new Date().toISOString()
    };

    const result = await upsertPitScoutEntry(db, payload);
    if (result.error) return json({ error: result.error.message }, { status: 500 });
    return json({
      success: true,
      data: result.data,
      meta: {
        schema: result.schema,
        warning: result.warning
      }
    });
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

    const event_key = String(url.searchParams.get('event_key') || '').trim();
    const team_key = String(url.searchParams.get('team_key') || '').trim();

    if (event_key && team_key) {
      const result = await selectPitScoutEntries(db, (query) =>
        query.eq('event_key', event_key).eq('team_key', team_key).maybeSingle()
      );

      if (result.error) return json({ error: result.error.message }, { status: 500 });
      return json({
        success: true,
        data: result.data || null,
        meta: {
          schema: result.schema,
          warning: result.warning
        }
      });
    }

    if (event_key) {
      const result = await selectPitScoutEntries(db, (query) =>
        query.eq('event_key', event_key).order('team_key', { ascending: true })
      );

      if (result.error) return json({ error: result.error.message }, { status: 500 });
      return json({
        success: true,
        data: result.data || [],
        meta: {
          schema: result.schema,
          warning: result.warning
        }
      });
    }

    const recent = Number(url.searchParams.get('recent') || '100');
    const result = await selectPitScoutEntries(db, (query) =>
      query.order('updated_at', { ascending: false }).limit(recent)
    );

    if (result.error) return json({ error: result.error.message }, { status: 500 });
    return json({
      success: true,
      data: result.data || [],
      meta: {
        schema: result.schema,
        warning: result.warning
      }
    });
  } catch (e) {
    return json({ error: e.message || 'Internal error' }, { status: 500 });
  }
}
