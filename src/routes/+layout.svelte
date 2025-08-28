<script>  import '../app.css';
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore } from '$lib/stores/user.js';
  import { LogOut, Move3d, Hammer, Wrench, Receipt, Home, Briefcase } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  let user = null;

  onMount(async () => {
    // Check if user is already logged in
    const { data: { session } } = await supabase.auth.getSession();
    if (session) {
      await loadUserProfile(session.user);
    }

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        await loadUserProfile(session.user);
      } else if (event === 'SIGNED_OUT') {
        user = null;
        userStore.set(null);
      }
    });

    return () => subscription?.unsubscribe();
  });  async function loadUserProfile(authUser) {
    try {
      // Use auth user data directly - no database lookup needed
      user = {
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.user_metadata?.full_name
          || (typeof authUser.user_metadata?.display_name === 'string'
              ? authUser.user_metadata.display_name.split(' ')[0]
              : authUser.email.split('@')[0]),
        role: authUser.user_metadata?.role || 'member',
        permissions: Array.isArray(authUser.user_metadata?.permissions)
          ? authUser.user_metadata.permissions.map(String)
          : [String(authUser.user_metadata?.permissions || 'basic')]
      };      userStore.set(user);
      console.log('User set from auth data:', user);
      
    // Attendance tracking removed
    } catch (error) {
      console.error('Error loading user profile:', error);
      // Fallback to basic user info
      user = {
        id: authUser.id,
        email: authUser.email,
        full_name: authUser.user_metadata?.name || '',
        role: 'member',
        permissions: 'basic'
      };
      userStore.set(user);
    }
  }

  async function handleLogout() {
    const { error } = await supabase.auth.signOut();
    if (error) {
      console.error('Error logging out:', error);
    }
    goto('/');
  }

  // Check if current route is active
  function isActive(path) {
    return $page.url.pathname === path;
  }
</script>

{#if user}
  <!-- Navigation Header -->
  <header class="nav-header">    <div class="nav-container">
      <div class="brand">
        <Briefcase size={28} />
        <h1>971 Hub</h1>
      </div>
      
      <!-- Desktop Navigation -->
      <nav class="desktop-nav">
        <a href="/" class="nav-link" class:active={isActive('/')}>
          <Home size={18} />
          Home
        </a>
        <a href="/manufacture" class="nav-link" class:active={isActive('/manufacture')}>
          <Hammer size={18} />
          Manufacture
        </a>
        <a href="/cad" class="nav-link" class:active={isActive('/cad')}>
          <Move3d size={18} />
          CAD
        </a>
        <a href="/cad/build" class="nav-link" class:active={isActive('/cad/build')}>
          <Wrench size={18} />
          Build
        </a>
        <a href="/cad/purchasing" class="nav-link" class:active={isActive('/cad/purchasing')}>
          <Receipt size={18} />
          Purchasing
  </a>
      </nav>

      <!-- User Menu - Simplified -->      <div class="user-menu">
        <button class="btn btn-ghost btn-sm" on:click={handleLogout}>
          <LogOut size={16} />
          Sign Out
        </button>
      </div>
    </div>
  </header>
{/if}

<main class="container">
  <slot />
</main>

<style>
  :global(html) {
    background-color: var(--background);
  }

  :global(body) {
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--background);
    color: var(--text);
  }


  /* Navigation Header Styles */
  .nav-header {
    background: var(--primary);
    border-bottom: 1px solid var(--border);
    width: 100vw;
    position: relative;
    left: 50%;
    right: 50%;
    margin-left: -50vw;
    margin-right: -50vw;
    margin-bottom: 2rem;
  }
  .nav-container {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    padding: 0 2rem; /* remove top padding so active background touches top */
    max-width: 1400px;
    margin: 0 auto;
    min-height: 60px;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    color: var(--secondary);
    flex-shrink: 0;
  }

  .brand h1 {
    margin: 0;
    font-size: 1.5rem;
    font-weight: 700;
    white-space: nowrap;
  }

  .desktop-nav {
    display: flex;
    align-items: stretch;
    gap: 1rem;
    flex: 1;
    justify-content: center;
    margin: 0 2rem;
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1.25rem;
    text-decoration: none;
    color: var(--secondary);
    font-weight: 500;
    font-size: 0.95rem;
    border-bottom: 3px solid transparent; /* legacy underline – kept neutral */
    height: 100%;
    white-space: nowrap;
  }

  /* No hover state per request */
  .nav-link:hover {
    color: var(--secondary);
    background: transparent;
    border-color: transparent;
  }

  .nav-link.active {
    color: var(--secondary);
    background: var(--accent); /* full-height yellow box */
    border-bottom-color: transparent; /* remove underline */
    border-radius: 0; /* square edges */
  }
  .user-menu {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  /* Button styles use global tokens from app.css */
</style>
