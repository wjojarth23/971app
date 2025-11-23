<script>
  import { onMount } from 'svelte';
  import { userStore } from '$lib/stores/user.js';
  import { hasPermission, GENERAL_ROLES } from '$lib/permissions.js';
  import { supabase } from '$lib/supabase.js';
  import { goto } from '$app/navigation';

  let users = [];
  let publicRosters = [];
  let rosterEntries = [];
  let loading = true;
  let searchQuery = '';
  let roleFilter = '';

  $: filteredUsers = users.filter(u => {
    const nameMatch = u.full_name?.toLowerCase().includes(searchQuery.toLowerCase()) || u.email?.toLowerCase().includes(searchQuery.toLowerCase());
    const roleMatch = !roleFilter || u.team_role === roleFilter;
    return nameMatch && roleMatch;
  });

  onMount(async () => {
    const user = $userStore;
    if (!user || !hasPermission(user, 'CAN_SEE_ROUTES')) { // Basic check, refine for Subsystem Lead
       // Actually user said "General permission SUBSYTEM LEAD or LEAD"
       const role = user?.general_role;
       if (role !== GENERAL_ROLES.SUBSYSTEM_LEAD && role !== GENERAL_ROLES.LEAD && user?.role !== 'admin') {
         goto('/');
         return;
       }
    }

    await loadData();
  });

  async function loadData() {
    loading = true;
    try {
      // Load Users
      const { data: usersData } = await supabase.from('user_profiles').select('id, full_name, email, team_role');
      users = usersData || [];

      // Load Public Rosters
      const { data: rostersData } = await supabase.from('rosters').select('*').eq('is_public', true);
      publicRosters = rostersData || [];

      // Load Entries for Public Rosters
      if (publicRosters.length > 0) {
        const rosterIds = publicRosters.map(r => r.id);
        const { data: entriesData } = await supabase
          .from('roster_entries')
          .select('user_id, roster_id, key:key_id(key_name)')
          .in('roster_id', rosterIds);
        rosterEntries = entriesData || [];
      }
    } catch (err) {
      console.error('Failed to load discover data', err);
    } finally {
      loading = false;
    }
  }

  function getRosterKeysForUser(userId, rosterId) {
    return rosterEntries
      .filter(e => e.user_id === userId && e.roster_id === rosterId)
      .map(e => e.key.key_name)
      .join(', ');
  }
</script>

<div class="discover-container">
  <h2>Discover Team</h2>

  <div class="filters">
    <input type="text" placeholder="Search members..." bind:value={searchQuery} class="form-input search-input" />
    <select bind:value={roleFilter} class="form-select role-select">
      <option value="">All Roles</option>
      {#each [...new Set(users.map(u => u.team_role).filter(Boolean))] as role}
        <option value={role}>{role}</option>
      {/each}
    </select>
  </div>

  {#if loading}
    <p>Loading...</p>
  {:else}
    <div class="table-container">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Role</th>
            {#each publicRosters as roster}
              <th>{roster.name}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each filteredUsers as user}
            <tr>
              <td>{user.full_name}</td>
              <td>{user.team_role || '-'}</td>
              {#each publicRosters as roster}
                <td>{getRosterKeysForUser(user.id, roster.id)}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

<style>
  .discover-container {
    padding: 2rem;
    max-width: 1200px;
    margin: 0 auto;
  }

  .filters {
    display: flex;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .filters .search-input {
    flex: 2;
  }

  .filters .role-select {
    flex: 1;
  }

  .table-container {
    overflow-x: auto;
    background: var(--surface-1);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .table {
    width: 100%;
    border-collapse: collapse;
  }

  .table th, .table td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }

  .table th {
    background: var(--surface-2);
    font-weight: 600;
  }
</style>
