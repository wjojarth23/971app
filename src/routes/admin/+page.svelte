<script>
  import { onMount } from 'svelte';
  import { userStore, getUserUUID } from '$lib/stores/user.js';
  import { PERMISSIONS, hasPermission } from '$lib/permissions.js';
  import { supabase } from '$lib/supabase.js';
  import { get } from 'svelte/store';
  
  const BOT_BASE_URL = import.meta.env?.VITE_BOT_BASE_URL || '/api/971bot';
  
  // Permission categories for better organization
  const PERMISSION_CATEGORIES = {
    'Access & Auth': ['CAN_SEE_ROUTES', 'VIEW_ADMIN_PANEL'],
    'User Management': ['BAN_USERS', 'PROMOTE_USERS', 'APPROVE_USERS', 'EDIT_PERMISSIONS'],
    'Build & CAD': ['CREATE_SUBSYSTEMS', 'CREATE_BUILDS'],
    'Purchasing': ['APPROVE_PURCHASES', 'PLACE_ORDERS_MISC'],
    'Scouting': ['NOTE_SCOUT_ADMIN', 'DATA_SCOUT_ADMIN', 'DATA_SCOUT_MEMBER', 'VIDEO_SCOUT_MEMBER']
  };

  let users = [];
  let filteredUsers = [];
  let loading = false;
  let error = null;
  let activeTab = 'users';
  let searchTerm = '';
  let filterStatus = 'all'; // all, pending, active, banned
  let selectedUser = null;
  let showPermissionModal = false;

  // Roster management
  let rosters = [];
  let activeRoster = null;
  let rosterSearchTerm = '';
  let filteredRosterUsers = [];
  let showCreateRosterModal = false;
  let newRosterName = '';
  let newRosterDescription = '';
  let showPermissionGrantModal = false;
  let selectedPermission = '';
  let grantMode = 'all'; // 'all' or 'selective'
  let selectedRosterMembers = new Set();

  const currentUser = userStore;
  const enableBan = false;

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

  async function getAuthHeader() {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      return token ? { Authorization: `Bearer ${token}` } : {};
    } catch {
      return {};
    }
  }

  onMount(async () => {
    await loadUsers();
    await loadRosters();
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
      users = body.data.map((u) => ({ 
        ...u, 
        permissions: Array.isArray(u.permissions) ? u.permissions : u.permissions ? [String(u.permissions)] : []
      }));
      
      filterUsers();
      
      // Notify for users lacking CAN_SEE_ROUTES (needing approval)
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

  async function loadRosters() {
    try {
      const { data, error } = await supabase
        .from('rosters')
        .select(`
          *,
          roster_members(
            user_id,
            added_at
          )
        `)
        .order('name');
      
      if (error) throw error;
      
      rosters = data.map(r => ({
        ...r,
        members: r.roster_members || []
      }));
      
      if (rosters.length > 0 && !activeRoster) {
        activeRoster = rosters[0];
      }
    } catch (err) {
      console.error('Failed to load rosters:', err);
      import('$lib/toast.js').then((m) => m.toastActions.show('Failed to load rosters'));
    }
  }

  async function createRoster() {
    if (!newRosterName.trim()) {
      import('$lib/toast.js').then((m) => m.toastActions.show('Roster name required'));
      return;
    }

    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session?.session?.user?.id;

      const { data, error } = await supabase
        .from('rosters')
        .insert({
          name: newRosterName.trim(),
          description: newRosterDescription.trim() || null,
          created_by: userId
        })
        .select()
        .single();

      if (error) throw error;

      import('$lib/toast.js').then((m) => m.toastActions.show('Roster created'));
      newRosterName = '';
      newRosterDescription = '';
      showCreateRosterModal = false;
      await loadRosters();
      activeRoster = data;
    } catch (err) {
      error = err.message || String(err);
      import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }

  async function deleteRoster(roster) {
    if (!confirm(`Delete roster "${roster.name}"? This will remove all members but won't affect their permissions.`)) {
      return;
    }

    try {
      const { error } = await supabase
        .from('rosters')
        .delete()
        .eq('id', roster.id);

      if (error) throw error;

      import('$lib/toast.js').then((m) => m.toastActions.show('Roster deleted'));
      await loadRosters();
      if (activeRoster?.id === roster.id) {
        activeRoster = rosters[0] || null;
      }
    } catch (err) {
      error = err.message || String(err);
      import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }

  function filterUsers() {
    let result = users;
    
    // Filter by search term
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      result = result.filter(u => 
        (u.full_name || '').toLowerCase().includes(term) ||
        (u.email || '').toLowerCase().includes(term)
      );
    }
    
    // Filter by status
    if (filterStatus === 'pending') {
      result = result.filter(u => !u.permissions.includes('CAN_SEE_ROUTES') && !u.banned);
    } else if (filterStatus === 'active') {
      result = result.filter(u => u.permissions.includes('CAN_SEE_ROUTES') && !u.banned);
    } else if (filterStatus === 'banned') {
      result = result.filter(u => u.banned || u.role === 'banned');
    }
    
    filteredUsers = result;
  }

  function filterRosterUsers() {
    if (!activeRoster) {
      filteredRosterUsers = [];
      return;
    }

    const rosterUserIds = new Set(activeRoster.members.map(m => m.user_id));
    let result = users.filter(u => !rosterUserIds.has(u.id) && u.permissions.includes('CAN_SEE_ROUTES'));
    
    if (rosterSearchTerm) {
      const term = rosterSearchTerm.toLowerCase();
      result = result.filter(u => 
        (u.full_name || '').toLowerCase().includes(term) ||
        (u.email || '').toLowerCase().includes(term)
      );
    }
    
    filteredRosterUsers = result;
  }

  function getRosterMembers() {
    if (!activeRoster) return [];
    const memberIds = new Set(activeRoster.members.map(m => m.user_id));
    return users.filter(u => memberIds.has(u.id));
  }

  $: {
    searchTerm;
    filterStatus;
    filterUsers();
  }

  $: {
    rosterSearchTerm;
    activeRoster;
    filterRosterUsers();
  }

  function openPermissionModal(user) {
    selectedUser = { ...user, permissions: [...user.permissions] };
    showPermissionModal = true;
  }

  function closePermissionModal() {
    showPermissionModal = false;
    selectedUser = null;
  }

  function togglePermission(perm) {
    if (!selectedUser) return;
    if (!selectedUser.permissions) selectedUser.permissions = [];
    
    if (selectedUser.permissions.includes(perm)) {
      selectedUser.permissions = selectedUser.permissions.filter((p) => p !== perm);
    } else {
      selectedUser.permissions = [...selectedUser.permissions, perm];
    }

    // If admin panel access is removed, strip elevated admin perms
    if (!selectedUser.permissions.includes('VIEW_ADMIN_PANEL')) {
      selectedUser.permissions = selectedUser.permissions.filter((p) => 
        p !== 'BAN_USERS' && p !== 'APPROVE_USERS'
      );
    }
  }

  async function savePermissions() {
    if (!selectedUser) return;
    
    error = null;
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
        body: JSON.stringify({ 
          actor_id, 
          target_id: selectedUser.id, 
          permissions: selectedUser.permissions 
        })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || JSON.stringify(body));
      
      import('$lib/toast.js').then((m) => m.toastActions.show('Permissions updated'));
      closePermissionModal();
      await loadUsers();
      loadRosters();
    } catch (err) {
      error = err.message || String(err);
      import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }

  async function doAction(u, act) {
    error = null;
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
      
      const msg = act === 'approve' ? 'User approved' : act === 'ban' ? 'User banned' : 'Action complete';
      import('$lib/toast.js').then((m) => m.toastActions.show(msg));
      await loadUsers();
    } catch (err) {
      error = err.message || String(err);
      import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }

  async function addToRoster(user) {
    if (!activeRoster) return;

    try {
      const { data: session } = await supabase.auth.getSession();
      const userId = session?.session?.user?.id;

      const { error } = await supabase
        .from('roster_members')
        .insert({
          roster_id: activeRoster.id,
          user_id: user.id,
          added_by: userId
        });

      if (error) throw error;

      await loadRosters();
      filterRosterUsers();
      import('$lib/toast.js').then((m) => m.toastActions.show('User added to roster'));
    } catch (err) {
      if (err.message?.includes('duplicate')) {
        import('$lib/toast.js').then((m) => m.toastActions.show('User already in roster'));
      } else {
        error = err.message || String(err);
        import('$lib/toast.js').then((m) => m.toastActions.show(error));
      }
    }
  }

  async function removeFromRoster(user) {
    if (!activeRoster) return;

    try {
      const { error } = await supabase
        .from('roster_members')
        .delete()
        .eq('roster_id', activeRoster.id)
        .eq('user_id', user.id);

      if (error) throw error;

      await loadRosters();
      filterRosterUsers();
      import('$lib/toast.js').then((m) => m.toastActions.show('User removed from roster'));
    } catch (err) {
      error = err.message || String(err);
      import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }

  function openPermissionGrantModal() {
    const members = getRosterMembers();
    if (members.length === 0) {
      import('$lib/toast.js').then((m) => m.toastActions.show('No members in roster'));
      return;
    }
    selectedPermission = '';
    grantMode = 'all';
    selectedRosterMembers.clear();
    showPermissionGrantModal = true;
  }

  function toggleRosterMember(userId) {
    if (selectedRosterMembers.has(userId)) {
      selectedRosterMembers.delete(userId);
    } else {
      selectedRosterMembers.add(userId);
    }
    selectedRosterMembers = selectedRosterMembers;
  }

  async function grantPermissionToRoster() {
    if (!selectedPermission) {
      import('$lib/toast.js').then((m) => m.toastActions.show('Select a permission'));
      return;
    }

    const members = getRosterMembers();
    let targetMembers = members;

    if (grantMode === 'selective') {
      if (selectedRosterMembers.size === 0) {
        import('$lib/toast.js').then((m) => m.toastActions.show('Select at least one member'));
        return;
      }
      targetMembers = members.filter(m => selectedRosterMembers.has(m.id));
    }

    let actor_id = get(currentUser)?.id || getUserUUID();
    if (!actor_id) {
      try {
        const { data } = await supabase.auth.getSession();
        actor_id = data?.session?.user?.id || actor_id;
      } catch (e) {}
    }

    try {
      const auth = await getAuthHeader();
      const promises = targetMembers.map(async (user) => {
        let updatedPerms = [...user.permissions];
        if (!updatedPerms.includes(selectedPermission)) {
          updatedPerms.push(selectedPermission);
        }

        return fetch('/api/admin', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...auth },
          body: JSON.stringify({ 
            actor_id, 
            target_id: user.id, 
            permissions: updatedPerms 
          })
        });
      });

      await Promise.all(promises);
      import('$lib/toast.js').then((m) => m.toastActions.show(`Permission granted to ${targetMembers.length} member(s)`));
      showPermissionGrantModal = false;
      await loadUsers();
    } catch (err) {
      error = err.message || String(err);
      import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }

  function getUserStatus(user) {
    if (user.banned || user.role === 'banned') return 'banned';
    if (!user.permissions.includes('CAN_SEE_ROUTES')) return 'pending';
    return 'active';
  }

</script>

<div class="container">
  <h2>Admin Panel</h2>

  {#if error}
    <div class="error-msg">{error}</div>
  {/if}

  <!-- Tabs -->
  <div class="tabs">
    <button 
      class="tab-btn" 
      class:active={activeTab === 'users'}
      on:click={() => activeTab = 'users'}
    >
      Users
      {#if users.filter(u => !u.permissions.includes('CAN_SEE_ROUTES')).length > 0}
        <span class="count">({users.filter(u => !u.permissions.includes('CAN_SEE_ROUTES')).length} pending)</span>
      {/if}
    </button>
    <button 
      class="tab-btn" 
      class:active={activeTab === 'rosters'}
      on:click={() => activeTab = 'rosters'}
    >
      Rosters
    </button>
    <button 
      class="tab-btn" 
      class:active={activeTab === 'permissions'}
      on:click={() => activeTab === 'permissions'}
    >
      Permissions Reference
    </button>
  </div>

  <!-- Users Tab -->
  {#if activeTab === 'users'}
    <div class="tab-content">
      <!-- Search & Filters -->
      <div class="toolbar card">
        <input 
          type="text" 
          class="form-input" 
          placeholder="Search users..." 
          bind:value={searchTerm}
        />
        
        <div class="filter-btns">
          <button 
            class="btn btn-sm {filterStatus === 'all' ? 'btn-primary' : 'btn-secondary'}"
            on:click={() => filterStatus = 'all'}
          >
            All
          </button>
          <button 
            class="btn btn-sm {filterStatus === 'pending' ? 'btn-primary' : 'btn-secondary'}"
            on:click={() => filterStatus = 'pending'}
          >
            Pending
          </button>
          <button 
            class="btn btn-sm {filterStatus === 'active' ? 'btn-primary' : 'btn-secondary'}"
            on:click={() => filterStatus = 'active'}
          >
            Active
          </button>
        </div>
      </div>

      {#if loading}
        <div class="card">Loading users...</div>
      {:else if filteredUsers.length === 0}
        <div class="card">No users found</div>
      {:else}
        <!-- Users Table -->
        <div class="card">
          <table class="data-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>Status</th>
                <th>Permissions</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each filteredUsers as user}
                {@const status = getUserStatus(user)}
                <tr>
                  <td>{user.full_name || 'Unnamed'}</td>
                  <td>{user.email || user.id}</td>
                  <td>
                    <span class="status-badge status-{status}">{status}</span>
                  </td>
                  <td>
                    <div class="perm-list">
                      {#each user.permissions as perm}
                        <span class="perm-tag">{perm}</span>
                      {/each}
                    </div>
                  </td>
                  <td class="actions">
                    {#if status === 'pending'}
                      <button class="btn btn-sm btn-success" on:click={() => doAction(user, 'approve')}>
                        Approve
                      </button>
                    {/if}
                    <button class="btn btn-sm btn-secondary" on:click={() => openPermissionModal(user)}>
                      Edit
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Rosters Tab -->
  {#if activeTab === 'rosters'}
    <div class="tab-content">
      <div class="roster-layout">
        <!-- Roster Selector -->
        <div class="roster-selector card">
          <div class="roster-header-section">
            <h3>Rosters</h3>
            <button class="btn btn-sm btn-primary" on:click={() => showCreateRosterModal = true}>
              Create New
            </button>
          </div>
          
          {#if rosters.length === 0}
            <p class="muted">No rosters yet</p>
          {:else}
            {#each rosters as roster}
              <div class="roster-btn-wrapper">
                <button 
                  class="roster-btn {activeRoster?.id === roster.id ? 'active' : ''}"
                  on:click={() => { activeRoster = roster; filterRosterUsers(); }}
                >
                  <span class="roster-name">{roster.name}</span>
                  <span class="roster-count">{roster.members.length}</span>
                </button>
                <button 
                  class="delete-roster-btn"
                  on:click={() => deleteRoster(roster)}
                  title="Delete roster"
                >
                  ×
                </button>
              </div>
            {/each}
          {/if}
        </div>

        {#if activeRoster}
          <!-- Current Roster Members -->
          <div class="roster-members card">
            <div class="roster-header">
              <div>
                <h3>{activeRoster.name}</h3>
                {#if activeRoster.description}
                  <p class="roster-desc">{activeRoster.description}</p>
                {/if}
              </div>
              <button class="btn btn-sm btn-primary" on:click={openPermissionGrantModal}>
                Update Permissions
              </button>
            </div>
            
            {#if getRosterMembers().length === 0}
              <p class="muted">No members in this roster</p>
            {:else}
              <table class="data-table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Email</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {#each getRosterMembers() as user}
                    <tr>
                      <td>{user.full_name || 'Unnamed'}</td>
                      <td>{user.email || user.id}</td>
                      <td>
                        <button 
                          class="btn btn-sm btn-secondary" 
                          on:click={() => removeFromRoster(user)}
                        >
                          Remove
                        </button>
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            {/if}
          </div>

          <!-- Add Members -->
          <div class="add-members card">
            <h3>Add Members</h3>
            <input 
              type="text" 
              class="form-input" 
              placeholder="Search users to add..." 
              bind:value={rosterSearchTerm}
            />
            
            <div class="user-list">
              {#if filteredRosterUsers.length === 0}
                <p class="muted">No users available</p>
              {:else}
                {#each filteredRosterUsers.slice(0, 10) as user}
                  <div class="user-item">
                    <div>
                      <div class="user-name">{user.full_name || 'Unnamed'}</div>
                      <div class="user-email">{user.email || user.id}</div>
                    </div>
                    <button 
                      class="btn btn-sm btn-primary" 
                      on:click={() => addToRoster(user)}
                    >
                      Add
                    </button>
                  </div>
                {/each}
              {/if}
            </div>
          </div>
        {:else}
          <div class="card">
            <p class="muted">Select or create a roster to manage members</p>
          </div>
        {/if}
      </div>
    </div>
  {/if}

  <!-- Permissions Reference Tab -->
  {#if activeTab === 'permissions'}
    <div class="tab-content">
      {#each Object.entries(PERMISSION_CATEGORIES) as [category, perms]}
        <div class="card">
          <h3>{category}</h3>
          <table class="data-table">
            <thead>
              <tr>
                <th>Permission</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              {#each perms as perm}
                <tr>
                  <td><code>{perm}</code></td>
                  <td>
                    {#if perm === 'CAN_SEE_ROUTES'}
                      Required to access the application
                    {:else if perm === 'VIEW_ADMIN_PANEL'}
                      Access to admin panel
                    {:else if perm === 'APPROVE_USERS'}
                      Approve pending user registrations
                    {:else if perm === 'EDIT_PERMISSIONS'}
                      Modify user permissions
                    {:else if perm === 'BAN_USERS'}
                      Ban users from the system
                    {:else if perm === 'CREATE_SUBSYSTEMS'}
                      Create new subsystems in CAD
                    {:else if perm === 'CREATE_BUILDS'}
                      Create new build projects
                    {:else if perm === 'APPROVE_PURCHASES'}
                      Approve purchase orders
                    {:else if perm === 'PLACE_ORDERS_MISC'}
                      Place miscellaneous orders
                    {:else if perm === 'NOTE_SCOUT_ADMIN'}
                      Manage note scouting assignments
                    {:else if perm === 'DATA_SCOUT_ADMIN'}
                      Manage data scouting assignments
                    {:else if perm === 'DATA_SCOUT_MEMBER'}
                      Eligible for data scouting assignments
                    {:else if perm === 'VIDEO_SCOUT_MEMBER'}
                      Eligible for video scouting assignments
                    {:else}
                      Permission: {perm}
                    {/if}
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
    </div>
  {/if}
</div>

<!-- Create Roster Modal -->
{#if showCreateRosterModal}
  <div class="modal-overlay" on:click={() => showCreateRosterModal = false} role="button" tabindex="0" on:keydown={(e) => e.key === 'Escape' && (showCreateRosterModal = false)}>
    <div class="modal card" on:click|stopPropagation role="dialog" tabindex="-1" on:keydown={(e) => e.key === 'Escape' && (showCreateRosterModal = false)}>
      <div class="modal-header">
        <h3>Create New Roster</h3>
        <button class="close-btn" on:click={() => showCreateRosterModal = false}>×</button>
      </div>
      
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Roster Name</label>
          <input 
            type="text" 
            class="form-input" 
            placeholder="e.g. Data Scouts 2025" 
            bind:value={newRosterName}
          />
        </div>
        
        <div class="form-group">
          <label class="form-label">Description (optional)</label>
          <textarea 
            class="form-input" 
            placeholder="What is this roster for?" 
            bind:value={newRosterDescription}
            rows="3"
          ></textarea>
        </div>
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showCreateRosterModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={createRoster}>Create</button>
      </div>
    </div>
  </div>
{/if}

<!-- Permission Grant Modal -->
{#if showPermissionGrantModal}
  <div class="modal-overlay" on:click={() => showPermissionGrantModal = false} role="button" tabindex="0" on:keydown={(e) => e.key === 'Escape' && (showPermissionGrantModal = false)}>
    <div class="modal card" on:click|stopPropagation role="dialog" tabindex="-1" on:keydown={(e) => e.key === 'Escape' && (showPermissionGrantModal = false)}>
      <div class="modal-header">
        <h3>Grant Permission to Roster</h3>
        <button class="close-btn" on:click={() => showPermissionGrantModal = false}>×</button>
      </div>
      
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label">Select Permission</label>
          <select class="form-select" bind:value={selectedPermission}>
            <option value="">Choose a permission...</option>
            {#each PERMISSIONS as perm}
              {#if perm !== 'CAN_SEE_ROUTES'}
                <option value={perm}>{perm}</option>
              {/if}
            {/each}
          </select>
        </div>
        
        <div class="form-group">
          <label class="form-label">Grant Mode</label>
          <div class="radio-group">
            <label class="radio-label">
              <input 
                type="radio" 
                bind:group={grantMode} 
                value="all"
              />
              Grant to all members ({getRosterMembers().length})
            </label>
            <label class="radio-label">
              <input 
                type="radio" 
                bind:group={grantMode} 
                value="selective"
              />
              Selective grant (choose specific members)
            </label>
          </div>
        </div>

        {#if grantMode === 'selective'}
          <div class="form-group">
            <label class="form-label">Select Members</label>
            <div class="member-selection">
              {#each getRosterMembers() as user}
                <label class="checkbox-label">
                  <input 
                    type="checkbox" 
                    checked={selectedRosterMembers.has(user.id)}
                    on:change={() => toggleRosterMember(user.id)}
                  />
                  {user.full_name || user.email || 'Unnamed'}
                </label>
              {/each}
            </div>
          </div>
        {/if}
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showPermissionGrantModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={grantPermissionToRoster}>Grant Permission</button>
      </div>
    </div>
  </div>
{/if}

<!-- Permission Modal -->
{#if showPermissionModal && selectedUser}
  <div class="modal-overlay" on:click={closePermissionModal}>
    <div class="modal card" on:click|stopPropagation>
      <div class="modal-header">
        <h3>Edit Permissions: {selectedUser.full_name || selectedUser.email}</h3>
        <button class="close-btn" on:click={closePermissionModal}>×</button>
      </div>
      
      <div class="modal-body">
        {#each Object.entries(PERMISSION_CATEGORIES) as [category, perms]}
          <div class="perm-section">
            <h4>{category}</h4>
            {#each perms as perm}
              {#if perm === 'CAN_SEE_ROUTES' || (selectedUser.permissions.includes('CAN_SEE_ROUTES') && ((perm !== 'BAN_USERS' && perm !== 'APPROVE_USERS') || selectedUser.permissions.includes('VIEW_ADMIN_PANEL')))}
                <label class="checkbox-label">
                  <input 
                    type="checkbox" 
                    checked={selectedUser.permissions.includes(perm)} 
                    on:change={() => togglePermission(perm)}
                  />
                  {perm}
                </label>
              {/if}
            {/each}
          </div>
        {/each}
      </div>

      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={closePermissionModal}>Cancel</button>
        <button class="btn btn-primary" on:click={savePermissions}>Save</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .container {
    max-width: 1400px;
    margin: 0 auto;
    padding: 2rem 1rem;
  }

  h2 {
    margin-bottom: 1.5rem;
  }

  h3 {
    margin: 0 0 1rem 0;
    font-size: 1.125rem;
  }

  h4 {
    margin: 1rem 0 0.5rem 0;
    font-size: 0.95rem;
    font-weight: 600;
  }

  .error-msg {
    background: var(--danger);
    color: white;
    padding: 0.75rem 1rem;
    border-radius: var(--radius-sm);
    margin-bottom: 1rem;
  }

  /* Tabs */
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    border-bottom: 1px solid var(--border);
  }

  .tab-btn {
    background: transparent;
    border: none;
    padding: 0.75rem 1rem;
    cursor: pointer;
    font-weight: 600;
    color: var(--muted);
    border-bottom: 2px solid transparent;
    transition: all 0.2s;
  }

  .tab-btn:hover {
    color: var(--secondary);
  }

  .tab-btn.active {
    color: var(--secondary);
    border-bottom-color: var(--accent);
  }

  .count {
    font-size: 0.85rem;
    color: var(--muted);
  }

  /* Toolbar */
  .toolbar {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 1rem;
    flex-wrap: wrap;
  }

  .toolbar .form-input {
    flex: 1;
    min-width: 250px;
  }

  .filter-btns {
    display: flex;
    gap: 0.5rem;
  }

  /* Data Table */
  .data-table {
    width: 100%;
    border-collapse: collapse;
  }

  .data-table th {
    text-align: left;
    padding: 0.75rem;
    border-bottom: 2px solid var(--border);
    font-weight: 600;
    font-size: 0.875rem;
  }

  .data-table td {
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .data-table tbody tr:hover {
    background: var(--muted-bg);
  }

  .data-table .actions {
    display: flex;
    gap: 0.5rem;
  }

  /* Status & Tags */
  .status-badge {
    display: inline-block;
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .status-pending {
    background: var(--warning);
    color: #3a2f00;
  }

  .status-active {
    background: var(--success);
    color: white;
  }

  .status-banned {
    background: var(--danger);
    color: white;
  }

  .perm-list {
    display: flex;
    flex-wrap: wrap;
    gap: 0.25rem;
  }

  .perm-tag {
    background: var(--muted-bg);
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    font-size: 0.75rem;
    font-family: monospace;
  }

  /* Roster Layout */
  .roster-layout {
    display: grid;
    grid-template-columns: 200px 1fr 300px;
    gap: 1rem;
  }

  .roster-selector h3 {
    font-size: 1rem;
    margin-bottom: 0.75rem;
  }

  .roster-header-section {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .roster-header-section h3 {
    margin: 0;
  }

  .roster-btn-wrapper {
    position: relative;
    margin-bottom: 0.5rem;
  }

  .roster-btn {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    text-align: left;
    background: transparent;
    border: 1px solid var(--border);
    padding: 0.625rem;
    padding-right: 2.5rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: all 0.2s;
  }

  .roster-btn:hover {
    background: var(--muted-bg);
  }

  .roster-btn.active {
    background: var(--accent);
    border-color: var(--accent);
    font-weight: 600;
  }

  .roster-name {
    font-weight: 600;
  }

  .roster-count {
    font-size: 0.85rem;
    color: var(--muted);
  }

  .roster-btn.active .roster-count {
    color: var(--secondary);
  }

  .delete-roster-btn {
    position: absolute;
    right: 0.25rem;
    top: 50%;
    transform: translateY(-50%);
    background: transparent;
    border: none;
    width: 28px;
    height: 28px;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: 1.25rem;
    color: var(--muted);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.2s;
  }

  .delete-roster-btn:hover {
    background: var(--danger);
    color: white;
  }

  .roster-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
    padding-bottom: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .roster-desc {
    color: var(--muted);
    font-size: 0.875rem;
    margin: 0.25rem 0 0 0;
  }

  .muted {
    color: var(--muted);
    font-style: italic;
  }

  .radio-group {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .radio-label {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
  }

  .radio-label:hover {
    background: var(--muted-bg);
  }

  .radio-label input {
    cursor: pointer;
  }

  .member-selection {
    max-height: 300px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.5rem;
  }

  .member-selection .checkbox-label {
    margin-bottom: 0.25rem;
  }

  textarea.form-input {
    resize: vertical;
    min-height: 80px;
  }

  .add-members h3 {
    margin-bottom: 0.75rem;
  }

  .add-members .form-input {
    margin-bottom: 1rem;
  }

  .user-list {
    max-height: 500px;
    overflow-y: auto;
  }

  .user-item {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.75rem;
    border-bottom: 1px solid var(--border);
  }

  .user-item:hover {
    background: var(--muted-bg);
  }

  .user-name {
    font-weight: 600;
    font-size: 0.9rem;
  }

  .user-email {
    font-size: 0.8rem;
    color: var(--muted);
  }

  /* Modal */
  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.5);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    max-width: 600px;
    width: 100%;
    max-height: 80vh;
    overflow-y: auto;
    margin: 1rem;
  }

  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding-bottom: 1rem;
    margin-bottom: 1rem;
    border-bottom: 1px solid var(--border);
  }

  .close-btn {
    background: transparent;
    border: none;
    font-size: 1.5rem;
    cursor: pointer;
    color: var(--muted);
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: var(--radius-sm);
  }

  .close-btn:hover {
    background: var(--muted-bg);
    color: var(--secondary);
  }

  .modal-body {
    margin-bottom: 1rem;
  }

  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border);
  }

  .perm-section {
    margin-bottom: 1.5rem;
  }

  .checkbox-label {
    display: block;
    padding: 0.5rem;
    cursor: pointer;
    border-radius: var(--radius-sm);
    transition: background 0.2s;
  }

  .checkbox-label:hover {
    background: var(--muted-bg);
  }

  .checkbox-label input {
    margin-right: 0.5rem;
  }

  code {
    background: var(--muted-bg);
    padding: 0.25rem 0.5rem;
    border-radius: var(--radius-sm);
    font-family: monospace;
    font-size: 0.875rem;
  }

  @media (max-width: 1024px) {
    .roster-layout {
      grid-template-columns: 1fr;
    }

    .toolbar {
      flex-direction: column;
      align-items: stretch;
    }

    .toolbar .form-input {
      width: 100%;
    }
  }
</style>
