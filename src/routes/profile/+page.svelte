<script>
  import { onMount } from 'svelte';
  import { userStore, fetchUserProfile } from '$lib/stores/auth.js';
  import { supabase } from '$lib/supabase.js';
  import { toastActions } from '$lib/toast.js';
  import navigation from '$lib/navigation.json';
  import HeaderPreview from '$lib/components/HeaderPreview.svelte';
  import { NOTIFICATION_UI_OPTIONS } from '$lib/notifications/constants.js';
  import { mergeNotificationSettings } from '$lib/notifications/settings.js';
  import { getUserAttendanceStats, getUserAttendanceHistory } from '$lib/attendance.js';

  let user = null;
  let unsub;

  // Editable fields
  let full_name = '';
  let email = '';
  let currentPassword = '';
  let newPassword = '';
  let passwordConfirm = '';

  let savingProfile = false;
  let changingPassword = false;
  // Appearance / customization
  let header_tabs = null; // array structure stored in DB
  let dashboard_layout = 'grid';
  let newFolderName = '';
  let addTabKey = '';
  let targetFolderIdx = '';
  let resettingNav = false;
  let notificationSettings = mergeNotificationSettings();
  let attendanceStats = null;
  let attendanceHistory = [];
  let attendanceLoading = false;
  let attendanceUserId = null;

  function formatAttendanceMoment(value) {
    if (!value) return '—';
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }).format(new Date(value));
    } catch {
      return value;
    }
  }

  async function loadAttendanceSummary(force = false) {
    if (!user?.id) {
      attendanceStats = null;
      attendanceHistory = [];
      return;
    }
    if (!force && attendanceUserId === user.id && attendanceStats) return;
    attendanceLoading = true;
    attendanceUserId = user.id;
    try {
      const [stats, history] = await Promise.all([
        getUserAttendanceStats(user.id),
        getUserAttendanceHistory(user.id, 12)
      ]);
      attendanceStats = stats;
      attendanceHistory = history;
    } catch (err) {
      console.error('Failed to load attendance summary', err);
      toastActions.show('Unable to load attendance');
    } finally {
      attendanceLoading = false;
    }
  }

  // Basic tab manipulation helpers (in-memory; saved when profile saved)
  function ensureHeaderTabs() {
    if (!header_tabs || !Array.isArray(header_tabs)) header_tabs = [];
  }

  function createFolder() {
    if (!newFolderName.trim()) return toastActions.show('Folder name required');
    ensureHeaderTabs();
    // Normalize label: keep CAD uppercase, otherwise capitalize first char
    const raw = newFolderName.trim();
    const label = raw.toLowerCase() === 'cad' ? 'CAD' : raw.replace(/^(.)/, (m) => m.toUpperCase());
    header_tabs.push({ type: 'folder', label, children: [] });
    header_tabs = header_tabs.slice();
    toastActions.show('Folder added');
    newFolderName = '';
    autosave();
  }

  function addTab() {
    if (!addTabKey) return toastActions.show('Select a tab to add');
    ensureHeaderTabs();
    const raw = String(addTabKey || '').trim();
    const label = raw.toLowerCase() === 'cad' ? 'CAD' : raw.replace(/^(.)/, (m) => m.toUpperCase());
    const newTab = { type: 'tab', key: addTabKey, label };
    if (targetFolderIdx !== '' && header_tabs[Number(targetFolderIdx)]?.type === 'folder') {
      const f = header_tabs[Number(targetFolderIdx)];
      f.children = Array.isArray(f.children) ? f.children : [];
      f.children.push(newTab);
    } else {
      header_tabs.push(newTab);
    }
    header_tabs = header_tabs.slice();
    toastActions.show('Tab added');
    addTabKey = '';
    autosave();
  }

  function removeEntry(idx) {
    ensureHeaderTabs();
    if (!confirm('Remove this tab/folder?')) return;
    header_tabs.splice(idx, 1);
    header_tabs = header_tabs.slice();
    toastActions.show('Removed');
    autosave();
  }

  function removeChild(folderIdx, childIdx) {
    ensureHeaderTabs();
    const f = header_tabs[folderIdx];
    if (!confirm('Remove this tab from the folder?')) return;
    if (f && Array.isArray(f.children)) f.children.splice(childIdx, 1);
    header_tabs = header_tabs.slice();
    toastActions.show('Removed');
    autosave();
  }

  // Drag and drop handler
  function handleDrop(event) {
    const { payload, target } = event.detail;
    ensureHeaderTabs();

    // Extract the item being dragged
    let draggedItem;
    if (payload.fromType === 'top') {
      draggedItem = header_tabs[payload.idx];
      header_tabs.splice(payload.idx, 1);
    } else if (payload.fromType === 'child') {
      const folder = header_tabs[payload.folderIdx];
      if (folder && Array.isArray(folder.children)) {
        draggedItem = folder.children[payload.childIdx];
        folder.children.splice(payload.childIdx, 1);
      }
    }

    if (!draggedItem) return;

    // Insert at target
    if (target.type === 'folder') {
      const targetFolder = header_tabs[target.folderIdx];
      if (targetFolder && targetFolder.type === 'folder') {
        targetFolder.children = Array.isArray(targetFolder.children) ? targetFolder.children : [];
        targetFolder.children.push(draggedItem);
      }
    } else if (target.type === 'index') {
      header_tabs.splice(target.idx, 0, draggedItem);
    } else if (target.type === 'end') {
      header_tabs.push(draggedItem);
    }

    header_tabs = header_tabs.slice();
    toastActions.show('Reordered');
    autosave();
  }

  function autosave() {
    try { saveProfile(); } catch (e) { console.warn('autosave failed', e); }
  }

  onMount(() => {
    unsub = userStore.subscribe((v) => {
      user = v;
      if (user) {
        full_name = user.full_name || '';
        email = user.email || '';
        // load appearance settings if present
        header_tabs = user.header_tabs || null;
        dashboard_layout = user.dashboard_layout || 'grid';
        notificationSettings = mergeNotificationSettings(user.notification_settings);
        void loadAttendanceSummary(true);
      }
    });
    return () => unsub?.();
  });

  function toggleNotification(key, enabled) {
    notificationSettings = {
      ...notificationSettings,
      [key]: enabled
    };
  }

  async function saveProfile() {
  if (!user?.id) return toastActions.show('Not signed in');
    savingProfile = true;
    try {
      // Save basic profile + appearance customizations
      const payload = {
        full_name: full_name,
        email: email,
        dashboard_layout: dashboard_layout,
        header_tabs: header_tabs,
        notification_settings: notificationSettings
      };
      console.log('saveProfile payload', payload);

      const { data, error } = await supabase
        .from('user_profiles')
        .update(payload)
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw error;
  toastActions.show('Profile updated');
      // Refresh profile from DB so we display the canonical saved manifest
      try {
        const refreshed = await fetchUserProfile(user.id);
        if (refreshed) {
          header_tabs = refreshed.header_tabs || null;
          dashboard_layout = refreshed.dashboard_layout || 'grid';
        }
      } catch (e) {
        console.warn('Failed to refresh profile after save', e);
      }
    } catch (e) {
      console.error('profile update error', e);
  toastActions.show(e.message || 'Failed to update profile');
    } finally {
      savingProfile = false;
    }
  }

  async function changePassword() {
  if (!user) return toastActions.show('Not signed in');
  if (!newPassword) return toastActions.show('New password required');
  if (newPassword !== passwordConfirm) return toastActions.show('Passwords do not match');
    changingPassword = true;
    try {
      // Supabase requires re-auth or uses auth.updateUser with password.
      const { data, error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
  toastActions.show('Password changed');
      currentPassword = '';
      newPassword = '';
      passwordConfirm = '';
    } catch (e) {
      console.error('change password error', e);
  toastActions.show(e.message || 'Failed to change password');
    } finally {
      changingPassword = false;
    }
  }

  async function resetNavigation() {
    if (!user?.id) return toastActions.show('Not signed in');
    if (!confirm('Reset navigation to defaults? This will remove all custom folders/tabs you have added.')) return;
    resettingNav = true;
    try {
      const { error } = await supabase
        .from('user_profiles')
        .update({ header_tabs: null })
        .eq('id', user.id);
      if (error) throw error;
      header_tabs = null;
      toastActions.show('Navigation reset. Reloading profile...');
      try { await fetchUserProfile(user.id); } catch (e) { /* ignore */ }
    } catch (e) {
      console.error('resetNavigation error', e);
      toastActions.show(e.message || 'Failed to reset navigation');
    } finally {
      resettingNav = false;
    }
  }

  function formatRoleLabel(value) {
    if (!value) return 'Unassigned';
    return String(value)
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  }
</script>

<svelte:head>
  <title>Profile</title>
</svelte:head>

{#if user}
  <div class="profile-page">
    <h2>Profile</h2>

    <section class="card">
      <h3>Account</h3>
      <label>Full name
        <input type="text" bind:value={full_name} />
      </label>
      <label>Email
        <input type="email" bind:value={email} />
      </label>
      <div class="actions">
        <button class="btn" on:click={saveProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save'}</button>
      </div>
    </section>

    <section class="card">
      <h3>Your Roles</h3>
      <div class="roles-grid">
        <div class="role-box">
          <div class="role-label">General Role</div>
          <div class="role-value">{formatRoleLabel(user.general_role || user.role || 'Unassigned')}</div>
        </div>
        <div class="role-box">
          <div class="role-label">Purchasing Role</div>
          <div class="role-value">{formatRoleLabel(user.purchasing_role || 'Unassigned')}</div>
        </div>
        <div class="role-box">
          <div class="role-label">Team / Other Role</div>
          <div class="role-value">{formatRoleLabel(user.team_role || (Array.isArray(user.roster_keys) && user.roster_keys[0]) || 'Unassigned')}</div>
        </div>
      </div>
    </section>

    <section class="card">
      <div class="attendance-card-header">
        <h3>Your Attendance</h3>
        <button type="button" class="btn btn-sm" on:click={() => loadAttendanceSummary(true)} disabled={attendanceLoading}>
          {attendanceLoading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>
      <p class="muted">Attendance is captured automatically when you join during an active schedule from an approved network.</p>
      {#if attendanceLoading}
        <div class="empty-state">Loading attendance…</div>
      {:else}
        <div class="attendance-stats">
          <div class="stat-block">
            <span class="stat-label">Days in the last 30 days</span>
            <strong class="stat-value">{attendanceStats?.days_attended ?? 0}</strong>
          </div>
          <div class="stat-block">
            <span class="stat-label">Last check-in</span>
            <strong class="stat-value">{formatAttendanceMoment(attendanceStats?.last_attended_at)}</strong>
          </div>
        </div>
        <div class="attendance-history">
          <h4>Recent check-ins</h4>
          {#if attendanceHistory.length === 0}
            <div class="empty-state">No recorded attendance yet.</div>
          {:else}
            <ul>
              {#each attendanceHistory as entry (entry.id)}
                <li>
                  <div>
                    <strong>{entry.schedule?.label || 'Attendance window'}</strong>
                    <div class="muted">{entry.location?.name || 'Unknown location'}</div>
                  </div>
                  <span>{formatAttendanceMoment(entry.recorded_at)}</span>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/if}
    </section>

    <section class="card">
      <h3>Change Password</h3>
      <label>New password
        <input type="password" bind:value={newPassword} />
      </label>
      <label>Confirm password
        <input type="password" bind:value={passwordConfirm} />
      </label>
      <div class="actions">
        <button class="btn" on:click={changePassword} disabled={changingPassword}>{changingPassword ? 'Changing...' : 'Change Password'}</button>
      </div>
    </section>

    <section class="card">
      <h3>Notifications</h3>
      <p class="muted">Choose which Slack DMs you want to receive.</p>
      <div class="notification-grid">
        {#each NOTIFICATION_UI_OPTIONS as option}
          <label class="notify-row">
            <input
              type="checkbox"
              checked={notificationSettings?.[option.key] !== false}
              on:change={(event) => toggleNotification(option.key, event.currentTarget.checked)}
            />
            <div>
              <div class="notify-label">{option.label}</div>
              <div class="notify-desc">{option.description}</div>
            </div>
          </label>
        {/each}
      </div>
      <div class="actions">
        <button class="btn" on:click={saveProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save Notifications'}</button>
      </div>
    </section>

    <section class="card">
      <h3>Customize Navigation</h3>
      <p class="muted">Drag and drop to reorder tabs and folders. Add new tabs or create folders to organize your navigation.</p>

      <!-- Live Preview -->
      <div class="preview-container">
        <h4>Preview</h4>
        <HeaderPreview header_tabs={header_tabs} on:drop={handleDrop} />
      </div>

      <!-- Quick Actions -->
      <div class="quick-actions">
        <div class="action-group">
          <label for="new-folder-name">Create folder</label>
          <div class="input-group">
            <input id="new-folder-name" placeholder="Folder name" bind:value={newFolderName} />
            <button class="btn btn-sm" on:click={createFolder} disabled={!newFolderName.trim()}>Create</button>
          </div>
        </div>

        <div class="action-group">
          <label for="add-tab-select">Add tab</label>
          <div class="input-group">
            <select id="add-tab-select" bind:value={addTabKey}>
              <option value="">-- Select tab --</option>
              {#each Object.keys(navigation.tabs) as key}
                <option value={key}>{key}</option>
              {/each}
            </select>

            <select id="target-folder-select" title="Add to">
              <option value="">Top level</option>
              {#each (header_tabs && Array.isArray(header_tabs) ? header_tabs : []) as it, i}
                {#if it.type === 'folder'}
                  <option value={i}>{it.label ? (it.label.toLowerCase() === 'cad' ? 'CAD' : it.label.replace(/^(.)/, (m) => m.toUpperCase())) : ''}</option>
                {/if}
              {/each}
            </select>

            <button class="btn btn-sm" on:click={addTab} disabled={!addTabKey}>Add</button>
          </div>
        </div>
      </div>

      <!-- Management -->
      {#if header_tabs && Array.isArray(header_tabs) && header_tabs.length > 0}
        <div class="manage-section">
          <h4>Manage Items</h4>
          <div class="items-list">
            {#each header_tabs as item, idx}
              <div class="item-row">
                <div class="item-info">
                  <span class="item-label">{item.label ? (item.label.toLowerCase() === 'cad' ? 'CAD' : item.label.replace(/^(.)/, (m) => m.toUpperCase())) : ''}</span>
                  {#if item.type === 'folder'}
                    <span class="badge">Folder</span>
                    {#if Array.isArray(item.children) && item.children.length > 0}
                      <span class="item-meta">{item.children.length} items</span>
                    {/if}
                  {:else}
                    <span class="badge badge-tab">Tab</span>
                  {/if}
                </div>
                <button class="btn-remove" on:click={() => removeEntry(idx)} aria-label={"Remove " + (item.label ? (item.label.toLowerCase() === 'cad' ? 'CAD' : item.label.replace(/^(.)/, (m) => m.toUpperCase())) : '')}>Remove</button>
              </div>

              {#if item.type === 'folder' && Array.isArray(item.children) && item.children.length > 0}
                <div class="folder-items">
                  {#each item.children as child, cidx}
                    <div class="item-row child">
                      <span class="item-label">{child.label ? (child.label.toLowerCase() === 'cad' ? 'CAD' : child.label.replace(/^(.)/, (m) => m.toUpperCase())) : ''}</span>
                      <button class="btn-remove small" on:click={() => removeChild(idx, cidx)} aria-label={"Remove " + (child.label ? (child.label.toLowerCase() === 'cad' ? 'CAD' : child.label.replace(/^(.)/, (m) => m.toUpperCase())) : '')}>✕</button>
                    </div>
                  {/each}
                </div>
              {/if}
            {/each}
          </div>
        </div>
      {/if}

      <div class="actions">
        <button class="btn btn-outline" disabled={resettingNav} on:click={resetNavigation}>
          {resettingNav ? 'Resetting...' : 'Reset to Defaults'}
        </button>
      </div>
    </section>

    <section class="card">
      <h3>Dashboard Layout</h3>
      <label for="dashboard-layout">Layout style</label>
      <select id="dashboard-layout" bind:value={dashboard_layout}>
        <option value="grid">Grid</option>
        <option value="compact">Compact</option>
        <option value="detailed">Detailed</option>
      </select>
      <div class="actions">
        <button class="btn" on:click={saveProfile} disabled={savingProfile}>
          {savingProfile ? 'Saving...' : 'Save Layout'}
        </button>
      </div>
    </section>
  </div>
{:else}
  <div class="profile-page">
    <h2>Profile</h2>
    <p>Please sign in to view your profile.</p>
  </div>
{/if}

<style>
  .profile-page { max-width: 860px; margin: 0 auto; padding: 1rem; }
  .card { background: var(--card); padding: 1.5rem; margin-bottom: 1.5rem; border: 1px solid var(--border); border-radius: 8px; }
  .card h3 { margin-top: 0; margin-bottom: 1rem; font-size: 1.25rem; }
  .card h4 { margin: 1rem 0 0.5rem; font-size: 1rem; font-weight: 600; }
  
  label { display: block; margin-bottom: 0.35rem; font-weight: 500; font-size: 0.95rem; }
  /* Inputs/selects sizing controlled globally in src/app.css */
  input, select { width: 100%; border: 1px solid var(--border); }
  input:focus, select:focus { outline: none; border-color: var(--accent); }
  
  .actions { margin-top: 1rem; display: flex; gap: 0.5rem; }
  
  /* Roles Grid */
  .roles-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 1rem; }
  .role-box { background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; text-align: center; }
  .role-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); margin-bottom: 0.5rem; }
  .role-value { font-size: 1.1rem; font-weight: 600; color: var(--text); }
  
  .muted { color: var(--muted); font-size: 0.9rem; margin-bottom: 1rem; }
  .attendance-card-header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; }
  .attendance-stats { display: flex; flex-wrap: wrap; gap: 1rem; margin-bottom: 1rem; }
  .stat-block { flex: 1 1 220px; border: 1px solid var(--border); border-radius: 8px; padding: 0.75rem 1rem; background: var(--surface-1); }
  .stat-label { font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.04em; color: var(--muted); }
  .stat-value { font-size: 1.5rem; margin-top: 0.35rem; display: block; }
  .attendance-history h4 { margin-top: 0; margin-bottom: 0.5rem; }
  .attendance-history ul { list-style: none; padding: 0; margin: 0; display: flex; flex-direction: column; gap: 0.75rem; }
  .attendance-history li { display: flex; justify-content: space-between; gap: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
  .attendance-history li:last-child { border-bottom: none; padding-bottom: 0; }

  /* Preview */
  .preview-container { margin: 1.5rem 0; padding: 1rem; background: var(--background); border: 1px solid var(--border); border-radius: 6px; }
  .preview-container h4 { margin-top: 0; margin-bottom: 0.75rem; font-size: 0.9rem; text-transform: uppercase; letter-spacing: 0.5px; color: var(--muted); }
  .notification-grid { display: flex; flex-direction: column; gap: 0.75rem; }
  .notify-row { display: flex; gap: 0.75rem; align-items: flex-start; padding: 0.5rem 0; border-bottom: 1px solid var(--border); }
  .notify-row:last-child { border-bottom: none; }
  .notify-label { font-weight: 600; }
  .notify-desc { color: var(--muted); font-size: 0.85rem; }

  /* Quick Actions */
  .quick-actions { display: flex; flex-direction: column; gap: 1rem; margin: 1.5rem 0; }
  .action-group { display: flex; flex-direction: column; gap: 0.5rem; }
  .action-group label { margin-bottom: 0.25rem; }
  .input-group { display: flex; gap: 0.5rem; }
  .input-group input, .input-group select { flex: 1; min-width: 0; }
  /* Compact button sizing handled by global .btn-sm tokens */
  .btn-sm { white-space: nowrap; }

  /* Manage Items */
  .manage-section { margin-top: 1.5rem; padding-top: 1.5rem; border-top: 1px solid var(--border); }
  .items-list { display: flex; flex-direction: column; gap: 0.5rem; }
  .item-row { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem; background: var(--background); border: 1px solid var(--border); border-radius: 6px; }
  .item-row.child { margin-left: 2rem; padding: 0.5rem 0.75rem; background: transparent; border: 1px dashed var(--border); }
  .item-info { display: flex; align-items: center; gap: 0.5rem; flex: 1; }
  .item-label { font-weight: 500; }
  .item-meta { font-size: 0.85rem; color: var(--muted); }
  .badge { background: var(--accent); color: var(--text); padding: 0.15rem 0.5rem; border-radius: 4px; font-size: 0.75rem; font-weight: 600; }
  .badge-tab { background: var(--muted-bg); color: var(--muted); }
  .btn-remove { background: transparent; border: 1px solid #f5c6c6; color: #b33; cursor: pointer; }
  /* small variant sizing provided globally */
  .btn-remove:hover { background: #ffecec; }
  .folder-items { display: flex; flex-direction: column; gap: 0.35rem; margin-top: 0.5rem; }

  @media (max-width: 640px) {
    .input-group { flex-direction: column; }
    .input-group input, .input-group select { width: 100%; }
  }
</style>
