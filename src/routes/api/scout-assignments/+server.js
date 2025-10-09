import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase.js';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

const getClientFromRequest = (request) => {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
};

async function fetchActorProfile(supa) {
  const { data: authRes } = await supa.auth.getUser();
  const actorId = authRes?.user?.id || null;
  if (!actorId) return { actorId: null, profile: null };
  const { data: profileRow } = await supabase
    .from('user_profiles')
    .select('id, role, permissions')
    .eq('id', actorId)
    .single();
  const perms = Array.isArray(profileRow?.permissions)
    ? profileRow.permissions.map(String)
    : profileRow?.permissions
    ? [String(profileRow.permissions)]
    : [];
  return { actorId, profile: { id: actorId, role: profileRow?.role || 'member', permissions: perms } };
}

function hasAdminForType(profile, scouting_type) {
  if (!profile) return false;
  if (profile.role === 'admin') return true;
  const needed = scouting_type === 'note' ? 'NOTE_SCOUT_ADMIN' : 'DATA_SCOUT_ADMIN';
  return (profile.permissions || []).includes(needed);
}

/*
  Scouting assignments API
  GET /api/scout-assignments?scouting_type=data|note
    -> returns rows with user name joined
  GET /api/scout-assignments?scouting_type=..&user_id=..&mine=1
    -> rows for a specific user (incomplete first)

  POST actions:
    assign-single: { scouting_type, match_key, team_key, user_id }
    assign-robot:  { scouting_type, team_key, user_id } (applies to all matches containing team_key)
    bulk-assign:   { scouting_type, items:[{match_key, team_key, user_id}...] }
*/

export async function GET({ url, request }) {
  try {
    const scouting_type = url.searchParams.get('scouting_type');
    if(!scouting_type) return json({ error: 'scouting_type required' }, { status:400 });

    // AuthN/Z (bypass on localhost)
    const supa = getClientFromRequest(request);
    const { actorId, profile } = await fetchActorProfile(supa);
    const mine = !!url.searchParams.get('mine');
    const reqUserId = url.searchParams.get('user_id') || null;
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';

    if (!isLocal) {
      if (mine) {
        // Allow without Authorization header; if Authorization present, it must match the requested user_id
        if (!reqUserId) {
          return json({ error: 'user_id required' }, { status: 400 });
        }
        if (actorId && reqUserId !== actorId) {
          return json({ error: 'Forbidden' }, { status: 403 });
        }
      } else {
        // Listing global assignments requires proper admin
        if (!hasAdminForType(profile, scouting_type)) {
          return json({ error: 'Forbidden' }, { status: 403 });
        }
      }
    }

    const base = supabase
      .from('scout_match_assignments')
      .select('id, scouting_type, match_key, team_key, assigned_user, completed_at')
      .eq('scouting_type', scouting_type);

    // My assignments view
    if (url.searchParams.get('mine') && url.searchParams.get('user_id')) {
      base.eq('assigned_user', url.searchParams.get('user_id'))
        .order('completed_at', { ascending: true })
        .order('match_key', { ascending: true });
    } else {
      base.limit(5000);
    }

    const { data, error } = await base;
    if (error) return json({ error: error.message }, { status:500 });

    // Build user name lookup without relying on a DB foreign key join
    const ids = Array.from(new Set((data || []).map(r => r.assigned_user).filter(Boolean)));
    let nameMap = {};
    if (ids.length > 0) {
      const { data: users, error: uErr } = await supabase
        .from('user_profiles')
        .select('id, full_name, email')
        .in('id', ids);
      if (!uErr) {
        for (const u of users || []) {
          nameMap[u.id] = u.full_name || u.email || null;
        }
      }
    }

    const rows = (data || []).map(r => ({
      id: r.id,
      scouting_type: r.scouting_type,
      match_key: r.match_key,
      team_key: r.team_key,
      assigned_user: r.assigned_user,
      completed_at: r.completed_at,
      user_name: r.assigned_user ? (nameMap[r.assigned_user] ?? null) : null
    }));
    return json({ success:true, data: rows });
  }catch(e){ return json({ error: e.message||'Internal error' }, { status:500 }); }
}

export async function POST({ request, url }) {
  try {
    const body = await request.json();
    const action = body?.action;
    const scouting_type = body?.scouting_type;
    if(!scouting_type) return json({ error: 'scouting_type required' }, { status:400 });

    // AuthN/Z (bypass on localhost)
    const supa = getClientFromRequest(request);
    const { actorId, profile } = await fetchActorProfile(supa);
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    // Only admins for the scouting_type may modify assignments, except 'complete' which is restricted below
    if (!isLocal && action !== 'complete' && !hasAdminForType(profile, scouting_type)) {
      return json({ error: 'Forbidden' }, { status: 403 });
    }

    async function upsert(match_key, team_key, user_id){
      // Try update then insert
      let { error } = await supabase
        .from('scout_match_assignments')
        .upsert({ scouting_type, match_key, team_key, assigned_user: user_id }, { onConflict: 'scouting_type,match_key,team_key' });
      if(error) return { error };
      return { success:true };
    }

    if(action === 'assign-single'){
      const { match_key, team_key, user_id } = body;
      if(!match_key || !team_key || !user_id) return json({ error: 'match_key, team_key, user_id required' }, { status:400 });
      const { error } = await supabase
        .from('scout_match_assignments')
        .upsert({ scouting_type, match_key, team_key, assigned_user: user_id }, { onConflict: 'scouting_type,match_key,team_key' });
      if(error) return json({ error: error.message }, { status:500 });
      return json({ success:true });
    }

    if(action === 'assign-robot'){
      const { team_key, user_id } = body;
      if(!team_key || !user_id) return json({ error: 'team_key, user_id required' }, { status:400 });
      // find all matches containing this team in existing rows OR accept client does not send matches (no strict enforcement)
      // simplest: client must send match_key for single; here we just update all rows currently referencing team_key
      const { data: existing, error: selErr } = await supabase.from('scout_match_assignments').select('match_key').eq('scouting_type', scouting_type).eq('team_key', team_key);
      if(selErr) return json({ error: selErr.message }, { status:500 });
      for(const row of existing || []){
        const { error } = await supabase.from('scout_match_assignments').upsert({ scouting_type, match_key: row.match_key, team_key, assigned_user: user_id }, { onConflict: 'scouting_type,match_key,team_key' });
        if(error) return json({ error: error.message }, { status:500 });
      }
      return json({ success:true });
    }

    if(action === 'bulk-assign'){
      const items = Array.isArray(body.items)? body.items: [];
      if(items.length===0) return json({ error: 'items required' }, { status:400 });
      const rows = items.map(i => ({ scouting_type, match_key: i.match_key, team_key: i.team_key, assigned_user: i.user_id }));
      const { error } = await supabase.from('scout_match_assignments').upsert(rows, { onConflict: 'scouting_type,match_key,team_key' });
      if(error) return json({ error: error.message }, { status:500 });
      return json({ success:true });
    }

    if(action === 'complete') {
      const { match_key, team_key, user_id } = body;
      if(!match_key || !team_key || !user_id) return json({ error: 'match_key, team_key, user_id required' }, { status:400 });
      // Only the signed-in assignee can complete (unless local bypass)
      if (!isLocal && (!actorId || user_id !== actorId)) return json({ error: 'Forbidden' }, { status:403 });
      // Ensure the row exists and belongs to user
      const { data: row, error: rErr } = await supabase
        .from('scout_match_assignments')
        .select('assigned_user')
        .eq('scouting_type', scouting_type)
        .eq('match_key', match_key)
        .eq('team_key', team_key)
        .single();
      if(rErr) return json({ error: rErr.message }, { status:500 });
      if(row.assigned_user !== user_id) return json({ error: 'Not owner' }, { status:403 });
      const { error } = await supabase
        .from('scout_match_assignments')
        .update({ completed_at: new Date().toISOString() })
        .eq('scouting_type', scouting_type)
        .eq('match_key', match_key)
        .eq('team_key', team_key);
      if(error) return json({ error: error.message }, { status:500 });
      return json({ success:true });
    }

    return json({ error: 'Invalid action' }, { status:400 });
  }catch(e){ return json({ error: e.message||'Internal error' }, { status:500 }); }
}
