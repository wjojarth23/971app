import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase.js';
import { PERMISSIONS } from '$lib/permissions.js';

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
  const action = url.searchParams.get('action');

  if (action === 'list-users') {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, permissions')
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

      if (!actor_id || !target_id) {
        return json({ error: 'actor_id and target_id required' }, { status: 400 });
      }

      // Fetch actor profile and check permission
      const { data: actor } = await supabase
        .from('user_profiles')
        .select('id, role, permissions')
        .eq('id', actor_id)
        .single();

      const actorPerms = Array.isArray(actor?.permissions) ? actor.permissions : actor?.permissions ? [String(actor.permissions)] : [];

      // Action shortcuts: promote / ban
      if (action === 'promote') {
        if (actor?.role !== 'admin' && !actorPerms.includes('PROMOTE_USERS')) {
          return json({ error: 'Not authorized to promote users' }, { status: 403 });
        }
        const { error } = await supabase.from('user_profiles').update({ role: 'admin' }).eq('id', target_id);
        if (error) return json({ error: error.message }, { status: 500 });
        return json({ success: true });
      }

      if (action === 'ban') {
        if (actor?.role !== 'admin' && !actorPerms.includes('BAN_USERS')) {
          return json({ error: 'Not authorized to ban users' }, { status: 403 });
        }

        if (action === 'approve') {
          if (actor?.role !== 'admin' && !actorPerms.includes('APPROVE_USERS')) {
            return json({ error: 'Not authorized to approve users' }, { status: 403 });
          }
          const { error } = await supabase.from('user_profiles').update({ role: 'member' }).eq('id', target_id);
          if (error) return json({ error: error.message }, { status: 500 });
          return json({ success: true });
        }
        const { error } = await supabase.from('user_profiles').update({ role: 'banned' }).eq('id', target_id);
        if (error) return json({ error: error.message }, { status: 500 });
        return json({ success: true });
      }

      // Default to editing permissions
      if (!Array.isArray(permissions)) {
        return json({ error: 'permissions[] required for permission updates' }, { status: 400 });
      }

      if (actor?.role !== 'admin' && !actorPerms.includes('EDIT_PERMISSIONS')) {
        return json({ error: 'Not authorized' }, { status: 403 });
      }

      // Ensure only known permissions are stored
      const filtered = permissions.filter((p) => PERMISSIONS.includes(p));

      const { error } = await supabase
        .from('user_profiles')
        .update({ permissions: filtered })
        .eq('id', target_id);

      if (error) return json({ error: error.message }, { status: 500 });

      return json({ success: true });
  } catch (err) {
    return json({ error: err.message || String(err) }, { status: 500 });
  }
}
