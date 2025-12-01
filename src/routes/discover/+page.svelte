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

  <div class="filters" style="--filters-columns: 2fr 1fr;">
    <input
      type="text"
      placeholder="Search members..."
      bind:value={searchQuery}
      class="form-input search-input"
    />
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
    <!-- Mobile Card View -->
    <div class="mobile-member-cards">
      {#each filteredUsers as user}
        <div class="member-card">
          <div class="member-card-header">
            <strong class="member-card-name">{user.full_name}</strong>
            {#if user.team_role}
              <span class="member-card-role">{user.team_role}</span>
            {/if}
          </div>
          {#if publicRosters.length > 0}
            <div class="member-card-rosters">
              {#each publicRosters as roster}
                {@const keys = getRosterKeysForUser(user.id, roster.id)}
                {#if keys}
                  <div class="member-card-roster">
                    <span class="roster-name">{roster.name}</span>
                    <span class="roster-keys">{keys}</span>
                  </div>
                {/if}
              {/each}
            </div>
          {/if}
        </div>
      {/each}
    </div>
    
    <!-- Desktop Table View -->
    <div class="table-container desktop-discover-table">
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
    display: grid;
    grid-template-columns: var(--filters-columns, 2fr 1fr);
    gap: var(--gap-3);
    margin-bottom: var(--space-4);
  }
  
  /* Mobile Member Cards - Hidden on desktop */
  .mobile-member-cards {
    display: none;
  }
  
  .member-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
  }
  
  .member-card-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--gap-3);
    margin-bottom: var(--space-2);
  }
  
  .member-card-name {
    font-size: 1rem;
    color: var(--secondary);
  }
  
  .member-card-role {
    font-size: var(--font-xs);
    color: var(--text-muted);
    background: var(--background);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
  
  .member-card-rosters {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2);
  }
  
  .member-card-roster {
    display: flex;
    justify-content: space-between;
    gap: var(--gap-2);
    font-size: var(--font-xs);
    padding: var(--space-2);
    background: var(--background);
    border-radius: var(--radius-sm);
  }
  
  .roster-name {
    color: var(--text-muted);
    font-weight: 500;
  }
  
  .roster-keys {
    color: var(--text);
  }
  
  /* Mobile Responsive Styles */
  @media (max-width: 768px) {
    .discover-container {
      padding: var(--space-3);
    }
    
    .discover-container h2 {
      font-size: 1.5rem;
    }
    
    .filters {
      grid-template-columns: 1fr;
    }
    
    /* Hide desktop table, show mobile cards */
    .desktop-discover-table {
      display: none;
    }
    
    .mobile-member-cards {
      display: block;
    }
  }
  
  @media (max-width: 480px) {
    .discover-container {
      padding: var(--space-2);
    }
    
    .discover-container h2 {
      font-size: 1.25rem;
    }
    
    .member-card {
      padding: var(--space-3);
    }
    
    .member-card-header {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--gap-1);
    }
  }
</style>
