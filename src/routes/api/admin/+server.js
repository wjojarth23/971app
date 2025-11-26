import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { PERMISSIONS, getRoleDerivedPermissions, normalizePermissions } from '$lib/permissions.js';

const getClientFromRequest = (request) => {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
};

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, request }) {
  const action = url.searchParams.get('action');

  if (action === 'list-users') {
    const supa = getClientFromRequest(request);
    const { data, error } = await supa
      .from('user_profiles')
      .select('id, email, full_name, role, permissions, banned, general_role, purchasing_role, team_role, frc_team')
      .order('full_name', { ascending: true });

    if (error) return json({ error: error.message }, { status: 500 });
    return json({ success: true, data });
  }

  return json({ error: 'Invalid action' }, { status: 400 });
}

/** @type {import('./$types').RequestHandler} */
export async function POST({ request }) {
  try {
    const body = await request.json();
    const { actor_id, target_id, permissions, action } = body || {};
    const supa = getClientFromRequest(request);

    if (!actor_id || !target_id) {
      return json({ error: 'actor_id and target_id required' }, { status: 400 });
    }

    // Fetch actor profile and check permission
    const { data: actor } = await supa
      .from('user_profiles')
      .select('id, role, permissions')
      .eq('id', actor_id)
      .single();

    const actorPerms = Array.isArray(actor?.permissions)
      ? actor.permissions.map(String)
      : actor?.permissions
      ? [String(actor.permissions)]
      : [];

    const isActorAdmin = actor?.role === 'admin';

    // Action shortcuts: promote / ban / approve
    if (action === 'promote') {
      if (!isActorAdmin && !actorPerms.includes('PROMOTE_USERS')) {
        return json({ error: 'Not authorized to promote users' }, { status: 403 });
      }
      const { error } = await supa
        .from('user_profiles')
        .update({ role: 'admin', banned: false })
        .eq('id', target_id);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    if (action === 'ban') {
      if (!isActorAdmin && !actorPerms.includes('BAN_USERS')) {
        return json({ error: 'Not authorized to ban users' }, { status: 403 });
      }
      const { error } = await supa
        .from('user_profiles')
        .update({ role: 'banned', banned: true })
        .eq('id', target_id);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    if (action === 'approve') {
      if (!isActorAdmin && !actorPerms.includes('APPROVE_USERS')) {
        return json({ error: 'Not authorized to approve users' }, { status: 403 });
      }

      // Ensure approved users can see routes by adding CAN_SEE_ROUTES
      const { data: target, error: tErr } = await supa
        .from('user_profiles')
        .select('permissions')
        .eq('id', target_id)
        .single();
      if (tErr) return json({ error: tErr.message }, { status: 500 });

      const currentPerms = Array.isArray(target?.permissions)
        ? target.permissions.map(String)
        : target?.permissions
        ? [String(target.permissions)]
        : [];

      // Normalize and ensure only known permissions
      const normalized = currentPerms.filter((p) => PERMISSIONS.includes(p));
      if (!normalized.includes('CAN_SEE_ROUTES')) normalized.push('CAN_SEE_ROUTES');

      const { error } = await supa
        .from('user_profiles')
        .update({ role: 'member', banned: false, permissions: normalized, general_role: 'member' })
        .eq('id', target_id);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true });
    }

    if (action === 'update-roles') {
      const { general_role, purchasing_role, team_role, frc_team } = body;
      if (!isActorAdmin && !actorPerms.includes('EDIT_PERMISSIONS')) {
        return json({ error: 'Not authorized' }, { status: 403 });
      }

      const { data: targetRow, error: targetErr } = await supa
        .from('user_profiles')
        .select('id, email, full_name, permissions, general_role, purchasing_role, team_role, frc_team, role, header_tabs, dashboard_layout, created_at, updated_at, banned, notification_settings, slack_user_id, slack_dm_channel')
        .eq('id', target_id)
        .single();
      if (targetErr) return json({ error: targetErr.message }, { status: 500 });

      const existingPerms = normalizePermissions(targetRow.permissions);
      const prevRolePerms = getRoleDerivedPermissions({ general_role: targetRow.general_role, purchasing_role: targetRow.purchasing_role });
      const manualExtras = existingPerms.filter((perm) => !prevRolePerms.has(perm));

      const nextRolePerms = getRoleDerivedPermissions({ general_role, purchasing_role });
      let merged = Array.from(new Set([...nextRolePerms, ...manualExtras])).filter((perm) => PERMISSIONS.includes(perm));

      if (!merged.includes('VIEW_ADMIN_PANEL')) {
        merged = merged.filter((perm) => perm !== 'BAN_USERS' && perm !== 'APPROVE_USERS');
      }

      // Build update payload - only include fields that were passed
      const updatePayload = { permissions: merged };
      if (general_role !== undefined) updatePayload.general_role = general_role;
      if (purchasing_role !== undefined) updatePayload.purchasing_role = purchasing_role;
      if (team_role !== undefined) updatePayload.team_role = team_role;
      if (frc_team !== undefined) updatePayload.frc_team = frc_team;

      const { data: updatedRow, error } = await supa
        .from('user_profiles')
        .update(updatePayload)
        .eq('id', target_id)
        .select('id, email, full_name, role, permissions, general_role, purchasing_role, team_role, frc_team, header_tabs, dashboard_layout, created_at, updated_at, banned, notification_settings, slack_user_id, slack_dm_channel')
        .single();
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data: updatedRow });
    }

    // Default to editing permissions
    if (!Array.isArray(permissions)) {
      return json({ error: 'permissions[] required for permission updates' }, { status: 400 });
    }

    if (!isActorAdmin && !actorPerms.includes('EDIT_PERMISSIONS')) {
      return json({ error: 'Not authorized' }, { status: 403 });
    }

    // Ensure only known permissions are stored
    let filtered = permissions
      .map(String)
      .filter((p) => PERMISSIONS.includes(p));

    // Enforce: without VIEW_ADMIN_PANEL, you cannot be granted BAN_USERS or APPROVE_USERS
    if (!filtered.includes('VIEW_ADMIN_PANEL')) {
      filtered = filtered.filter((p) => p !== 'BAN_USERS' && p !== 'APPROVE_USERS');
    }

    const { error } = await supa
      .from('user_profiles')
      .update({ permissions: filtered })
      .eq('id', target_id);

    if (error) return json({ error: error.message }, { status: 500 });

    return json({ success: true });
  } catch (err) {
    return json({ error: err.message || String(err) }, { status: 500 });
  }
}
