<script>
  import { onMount } from 'svelte';
  import { userStore } from '$lib/stores/auth.js';
  import { supabase } from '$lib/supabase.js';
  import { toastActions } from '$lib/toast.js';

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

  onMount(() => {
    unsub = userStore.subscribe((v) => {
      user = v;
      if (user) {
        full_name = user.full_name || '';
        email = user.email || '';
      }
    });
    return () => unsub?.();
  });

  async function saveProfile() {
  if (!user?.id) return toastActions.show('Not signed in');
    savingProfile = true;
    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .update({ full_name: full_name, email: email })
        .eq('id', user.id)
        .select()
        .single();

      if (error) throw error;
  toastActions.show('Profile updated');
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
</style>
