<script>
  import { onMount } from 'svelte';
  import { userStore, fetchUserProfile } from '$lib/stores/auth.js';
  import { supabase } from '$lib/supabase.js';
  import { toastActions } from '$lib/toast.js';
  import navigation from '$lib/navigation.json';

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

  // Basic tab manipulation helpers (in-memory; saved when profile saved)
  function ensureHeaderTabs() {
    if (!header_tabs || !Array.isArray(header_tabs)) header_tabs = [];
  }

  function createFolder() {
    if (!newFolderName) return toastActions.show('Folder name required');
    ensureHeaderTabs();
    header_tabs.push({ type: 'folder', label: newFolderName, children: [] });
    // trigger svelte reactivity by reassigning a new array reference
    header_tabs = header_tabs.slice();
    console.log('createFolder -> header_tabs', header_tabs);
    toastActions.show('Folder added');
    newFolderName = '';
    // Auto-save so users see persistence immediately
    try { saveProfile(); } catch (e) { console.warn('autosave createFolder failed', e); }
  }

  function addTab() {
    if (!addTabKey) return toastActions.show('Select a tab to add');
    ensureHeaderTabs();
    const newTab = { type: 'tab', key: addTabKey, label: addTabKey };
    if (targetFolderIdx !== '' && header_tabs[Number(targetFolderIdx)]?.type === 'folder') {
      const f = header_tabs[Number(targetFolderIdx)];
      f.children = Array.isArray(f.children) ? f.children : [];
      f.children.push(newTab);
    } else {
      header_tabs.push(newTab);
    }
    // reassign to ensure Svelte notices the change
    header_tabs = header_tabs.slice();
    toastActions.show('Tab added');
    addTabKey = '';
    // Auto-save so users see persistence immediately
    try { saveProfile(); } catch (e) { console.warn('autosave addTab failed', e); }
  }

  function moveUp(idx) {
    ensureHeaderTabs();
    if (idx <= 0) return;
    const a = header_tabs[idx-1];
    header_tabs[idx-1] = header_tabs[idx];
    header_tabs[idx] = a;
    header_tabs = header_tabs.slice();
  }

  function moveDown(idx) {
    ensureHeaderTabs();
    if (idx >= header_tabs.length - 1) return;
    const a = header_tabs[idx+1];
    header_tabs[idx+1] = header_tabs[idx];
    header_tabs[idx] = a;
    header_tabs = header_tabs.slice();
  }

  function removeEntry(idx) {
    ensureHeaderTabs();
    header_tabs.splice(idx, 1);
    header_tabs = header_tabs.slice();
    toastActions.show('Removed');
    try { saveProfile(); } catch (e) { console.warn('autosave removeEntry failed', e); }
  }

  function removeChild(folderIdx, childIdx) {
    ensureHeaderTabs();
    const f = header_tabs[folderIdx];
    if (f && Array.isArray(f.children)) f.children.splice(childIdx, 1);
    header_tabs = header_tabs.slice();
    toastActions.show('Removed');
    try { saveProfile(); } catch (e) { console.warn('autosave removeChild failed', e); }
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
      }
    });
    return () => unsub?.();
  });

  async function saveProfile() {
  if (!user?.id) return toastActions.show('Not signed in');
    savingProfile = true;
    try {
      // Save basic profile + appearance customizations
      const payload = {
        full_name: full_name,
        email: email,
        dashboard_layout: dashboard_layout,
        header_tabs: header_tabs
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
      <h3>Change password</h3>
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
      <h3>Permissions</h3>
      <div class="permissions">
        {#if Array.isArray(user.permissions) && user.permissions.length > 0}
          <ul>
            {#each user.permissions as p}
              <li>{p}</li>
            {/each}
          </ul>
        {:else}
          <div>No extra permissions (role: {user.role})</div>
        {/if}
      </div>
    </section>

    <section class="card">
      <h3>Customize</h3>
      <label>Dashboard layout
        <select bind:value={dashboard_layout}>
          <option value="grid">Grid</option>
          <option value="compact">Compact</option>
          <option value="detailed">Detailed</option>
        </select>
      </label>
      <div class="actions" style="margin-top:0.5rem">
        <button class="btn" on:click={saveProfile} disabled={savingProfile}>{savingProfile ? 'Saving...' : 'Save customizations'}</button>
      </div>

      <div style="margin-top:0.5rem">
        <h4>Header tabs & folders</h4>
        <p class="muted">Reorder tabs, create folders and group pages. Changes are saved with your profile.</p>

        <div class="tabs-manifest">
          <!-- If user has custom header_tabs, show it; otherwise build a default list from navigation.json -->
          {#if header_tabs && Array.isArray(header_tabs)}
            <ul>
              {#each header_tabs as item, idx}
                <li class="tab-item">
                  {#if item.type === 'folder'}
                    <strong>{item.label}</strong>
                    <button on:click={() => moveUp(idx)}>▲</button>
                    <button on:click={() => moveDown(idx)}>▼</button>
                    <button on:click={() => removeEntry(idx)}>Remove</button>
                    <ul class="folder-children">
                      {#each item.children as child, cidx}
                        <li>{child.label} <button on:click={() => removeChild(idx, cidx)}>Remove</button></li>
                      {/each}
                    </ul>
                  {:else}
                    <span>{item.label}</span>
                    <button on:click={() => moveUp(idx)}>▲</button>
                    <button on:click={() => moveDown(idx)}>▼</button>
                    <button on:click={() => removeEntry(idx)}>Remove</button>
                  {/if}
                </li>
              {/each}
            </ul>
          {:else}
            <div class="muted">No custom tabs configured — using defaults.</div>
            <ul>
              {#each Object.keys(navigation.tabs) as key}
                <li>{key} {navigation.tabs[key] ? '' : '(hidden by default)'}</li>
              {/each}
            </ul>
          {/if}
        </div>

        <div class="tabs-actions">
          <input placeholder="New folder name" bind:value={newFolderName} />
          <button on:click={createFolder}>Create folder</button>
          <select bind:value={addTabKey}>
            <option value="">-- Add tab --</option>
            {#each Object.keys(navigation.tabs) as key}
              <option value={key}>{key}</option>
            {/each}
          </select>
          <select bind:value={targetFolderIdx} title="Add tab to">
            <option value="">Top level</option>
            {#each (header_tabs && Array.isArray(header_tabs) ? header_tabs : []) as it, i}
              {#if it.type === 'folder'}
                <option value={i}>Folder: {it.label}</option>
              {/if}
            {/each}
          </select>
          <button on:click={addTab}>Add tab</button>
        </div>
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
  .profile-page { max-width: 720px; margin: 0 auto; padding: 1rem; }
  .card { background: var(--card); padding: 1rem; margin-bottom: 1rem; border: 1px solid var(--border); border-radius: 6px; }
  label { display: block; margin: 0.5rem 0; }
  input { width: 100%; padding: 0.5rem; border: 1px solid var(--border); border-radius: 4px; }
  .actions { margin-top: 0.5rem; }
  .permissions ul { margin: 0; padding-left: 1.25rem; }
  .profile-name { margin-left: 0.5rem; }
  .muted { color: var(--muted); font-size: 0.9rem; }
  .tabs-manifest ul { list-style: none; padding-left: 0; }
  .tab-item { display:flex; gap:0.5rem; align-items:center; padding:0.25rem 0; }
  .folder-children { margin-left:1rem; list-style: disc; }
  .tabs-actions { margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center; }
</style>
