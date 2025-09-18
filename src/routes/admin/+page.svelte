<script>
  import { onMount } from 'svelte';
  import { userStore, getUserUUID } from '$lib/stores/user.js';
  import { PERMISSIONS, hasPermission } from '$lib/permissions.js';
  import { supabase } from '$lib/supabase.js';
  import { get } from 'svelte/store';
  const BOT_BASE_URL = import.meta.env?.VITE_BOT_BASE_URL || '/api/971bot';
  async function notifyUserNeedsApproval(u) {
    try {
      await fetch(`${BOT_BASE_URL}/notify/user_registration`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: u.id, name: u.full_name || u.email || u.id })
      });
    } catch (e) {
      console.warn('Failed to notify bot about user', u.id, e);
    }
  }

  let users = [];
  let loading = false;
  let error = null;
  // Feature toggle to enable/disable ban button across the UI
  const enableBan = false;

  async function getAuthHeader() {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  const currentUser = userStore;

  onMount(async () => {
    await loadUsers();
  });

  async function loadUsers() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/admin?action=list-users', {
        headers: { ...(await getAuthHeader()) }
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load users');
      users = body.data.map((u) => ({ ...u, permissions: Array.isArray(u.permissions) ? u.permissions : u.permissions ? [String(u.permissions)] : [] }));
      // Notify for users lacking CAN_SEE_ROUTES (needing approval). Avoid spamming: only first load.
      if (!window.__notifiedUsersForApproval) {
        window.__notifiedUsersForApproval = new Set();
      }
      users.filter(u => !u.permissions.includes('CAN_SEE_ROUTES')).forEach(u => {
        if (!window.__notifiedUsersForApproval.has(u.id)) {
          window.__notifiedUsersForApproval.add(u.id);
          notifyUserNeedsApproval(u);
        }
      });
    } catch (err) {
      error = err.message || String(err);
    } finally {
      loading = false;
    }
  }

  function togglePermission(user, perm) {
    if (!user.permissions) user.permissions = [];
    if (user.permissions.includes(perm)) {
      user.permissions = user.permissions.filter((p) => p !== perm);
    } else {
      user.permissions = [...user.permissions, perm];
    }

    // If admin panel access is removed, strip elevated admin perms
    if (!user.permissions.includes('VIEW_ADMIN_PANEL')) {
      user.permissions = user.permissions.filter((p) => p !== 'BAN_USERS' && p !== 'APPROVE_USERS');
    }

    // force update
    users = users.slice();
  }

  async function saveUser(u) {
  error = null;
    // Try to derive the actor id from the authenticated session first
    let actor_id = get(currentUser)?.id || getUserUUID();
    if (!actor_id) {
      try {
        const { data } = await supabase.auth.getSession();
        actor_id = data?.session?.user?.id || actor_id;
      } catch (e) {
        // ignore
      }
    }

    if (!actor_id) {
      error = 'Unable to determine current user id; refresh and try again.';
      return;
    }

    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ actor_id, target_id: u.id, permissions: u.permissions })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || JSON.stringify(body));
  // show toast
  import('$lib/toast.js').then((m) => m.toastActions.show('Permissions updated'));
      await loadUsers();
    } catch (err) {
  error = err.message || String(err);
  import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }

  async function doAction(u, act) {
  error = null;
    // Promote feature disabled client-side
    if (act === 'promote') {
      import('$lib/toast.js').then((m) => m.toastActions.show('Promote feature is disabled'));
      return;
    }
    let actor_id = get(currentUser)?.id || getUserUUID();
    if (!actor_id) {
      try {
        const { data } = await supabase.auth.getSession();
        actor_id = data?.session?.user?.id || actor_id;
      } catch (e) {}
    }
    if (!actor_id) {
      error = 'Unable to determine current user id; refresh and try again.';
      return;
    }
    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ actor_id, target_id: u.id, action: act })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || JSON.stringify(body));
  const msg = act === 'promote' ? 'User promoted' : act === 'ban' ? 'User banned' : 'Action complete';
  import('$lib/toast.js').then((m) => m.toastActions.show(msg));
      await loadUsers();
    } catch (err) {
  error = err.message || String(err);
  import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }
</script>

<h2>Admin Panel - Permissions</h2>

{#if loading}
  <p>Loading users…</p>
{:else}
  {#if error}
    <p class="error">{error}</p>
  {/if}

  <div class="table-container">
    <table class="table admin-table">
    <thead>
      <tr>
        <th>Name</th>
        <th>Email</th>
        <th>Role</th>
        <th>Permissions</th>
        <th>Actions</th>
      </tr>
    </thead>
    <tbody>
  {#each users as u}
        <tr>
          <td>{u.full_name || u.id}</td>
          <td>{u.email}</td>
          <td>{u.role}</td>
          <td>
            <div class="perms">
              {#each PERMISSIONS as p}
                {#if p === 'CAN_SEE_ROUTES' || (u.permissions.includes('CAN_SEE_ROUTES') && ((p !== 'BAN_USERS' && p !== 'APPROVE_USERS') || u.permissions.includes('VIEW_ADMIN_PANEL')))}
                  <label class="perm">
                    <input type="checkbox" checked={u.permissions.includes(p)} on:change={() => togglePermission(u, p)} />
                    <span>{p}</span>
                  </label>
                {/if}
              {/each}
            </div>
          </td>
            <td>
            <button class="btn btn-secondary" on:click={() => saveUser(u)}>Save</button>
            <!-- Promote feature removed from UI. Short-circuited in doAction as well. -->
            {#if (!u.permissions || !u.permissions.includes('CAN_SEE_ROUTES')) && (hasPermission(get(currentUser), 'APPROVE_USERS') || get(currentUser)?.role === 'admin')}
              <button class="btn btn-secondary" on:click={() => doAction(u, 'approve')}>Approve</button>
            {/if}
            {#if enableBan && (hasPermission(get(currentUser), 'BAN_USERS') || get(currentUser)?.role === 'admin')}
              <button class="btn btn-danger" on:click={() => doAction(u, 'ban')}>Ban</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
  </div>
{/if}

<style>
  /* Make admin table use global table tokens and card container */
  .admin-table { width: 100%; border-collapse: collapse; }
  .admin-table th, .admin-table td { padding: 0.6rem; border-bottom: 1px solid var(--border); text-align: left; }
  .perms { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .perm { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--primary); border: 1px solid var(--border); padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.85rem; }
  .perm input { width: 14px; height: 14px; }
  .perm span { font-weight: 600; color: var(--secondary); font-size: 0.78rem; }
  .error { color: var(--danger); font-weight: 600; }

  /* Make action buttons align and smaller inside table */
  td > .btn { margin-right: 0.35rem; font-size: 0.85rem; }

  /* Slightly narrow email column for better layout */
  .admin-table td:nth-child(2) { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Subnav to reach Gantt subroute */
  .subnav { margin: 0.5rem 0 1rem; }
  .subnav .btn { font-size: 0.9rem; }
</style>
