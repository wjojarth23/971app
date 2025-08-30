<script>
  import { onMount } from 'svelte';
  import { userStore, getUserUUID } from '$lib/stores/user.js';
  import { PERMISSIONS, hasPermission } from '$lib/permissions.js';
  import { supabase } from '$lib/supabase.js';
  import { get } from 'svelte/store';

  let users = [];
  let loading = false;
  let error = null;

  const currentUser = userStore;

  onMount(async () => {
    await loadUsers();
  });

  async function loadUsers() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/admin?action=list-users');
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load users');
      users = body.data.map((u) => ({ ...u, permissions: Array.isArray(u.permissions) ? u.permissions : u.permissions ? [String(u.permissions)] : [] }));
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
    // force update
    users = users.slice();
  }

  async function saveUser(u) {
    error = null;
    const actor_id = get(currentUser)?.id || getUserUUID();
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor_id, target_id: u.id, permissions: u.permissions })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Save failed');
      // reload to ensure canonical data
      await loadUsers();
    } catch (err) {
      error = err.message || String(err);
    }
  }

  async function doAction(u, act) {
    error = null;
    const actor_id = get(currentUser)?.id || getUserUUID();
    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ actor_id, target_id: u.id, action: act })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Action failed');
      await loadUsers();
    } catch (err) {
      error = err.message || String(err);
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

  <table class="admin-table">
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
                <label class="perm">
                  <input type="checkbox" checked={u.permissions.includes(p)} on:change={() => togglePermission(u, p)} />
                  <span>{p}</span>
                </label>
              {/each}
            </div>
          </td>
          <td>
            <button on:click={() => saveUser(u)}>Save</button>
            {#if hasPermission(get(currentUser), 'PROMOTE_USERS') || get(currentUser)?.role === 'admin'}
              <button on:click={() => doAction(u, 'promote')}>Promote</button>
            {/if}
            {#if hasPermission(get(currentUser), 'APPROVE_USERS') || get(currentUser)?.role === 'admin'}
              <button on:click={() => doAction(u, 'approve')}>Approve</button>
            {/if}
            {#if hasPermission(get(currentUser), 'BAN_USERS') || get(currentUser)?.role === 'admin'}
              <button on:click={() => doAction(u, 'ban')}>Ban</button>
            {/if}
          </td>
        </tr>
      {/each}
    </tbody>
  </table>
{/if}

<style>
  .admin-table { width: 100%; border-collapse: collapse; }
  .admin-table th, .admin-table td { padding: 0.5rem; border: 1px solid var(--border); text-align: left; }
  .perms { display: flex; flex-wrap: wrap; gap: 0.5rem; }
  .perm { display: flex; align-items: center; gap: 0.25rem; }
  .error { color: var(--danger); }
</style>
