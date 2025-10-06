<script>  import '../app.css';
  import { onMount } from 'svelte';
  import { initAuth, userStore } from '$lib/stores/auth.js';
  import notescoutConfig from '$lib/notescout.json';
  import navConfig from '$lib/navigation.json';
import { Move3d, Hammer, Wrench, Receipt, Home, Briefcase, Coins, Package, User } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Toasts from '$lib/Toasts.svelte';
  let user = null;
  let predictTabVisible = false;
  let predictInfoLoaded = false;

  function can(perm) {
    if (!user) return false;
    if (user.role === 'admin') return true;
    return Array.isArray(user.permissions) && user.permissions.includes(perm);
  }

  onMount(() => {
    const unsub = userStore.subscribe((v) => { user = v; });
    const uninit = initAuth();
    // Predict feature has been removed; mark loaded so nav renders normally
    predictInfoLoaded = true;
    return () => { unsub?.(); uninit?.(); unsubPredict?.(); };
  });


  async function handleLogout() {
    await signOut();
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
          {#if can('CAN_SEE_ROUTES')}
          <a href="/manufacture" class="nav-link" class:active={isActive('/manufacture')}>
            <Hammer size={18} />
            Manufacture
          </a>
          {#if navConfig?.tabs?.kitting !== false}
          <a href="/kitting" class="nav-link" class:active={isActive('/kitting')}>
            <Package size={18} />
            Kitting
          </a>
          {/if}
          <a href="/cad" class="nav-link" class:active={isActive('/cad')}>
            <Move3d size={18} />
            CAD
          </a>
          {#if navConfig?.tabs?.build !== false}
          <a href="/cad/build" class="nav-link" class:active={isActive('/cad/build')}>
            <Wrench size={18} />
            Build
          </a>
          {/if}
          <a href="/cad/purchasing" class="nav-link" class:active={isActive('/cad/purchasing')}>
            <Receipt size={18} />
            Purchasing
          </a>
          {#if notescoutConfig?.event_key}
            <a href="/notescout" class="nav-link" class:active={isActive('/notescout')}>
              <Coins size={18} />
              Note Scouting
            </a>
          {/if}
          <!-- Predict feature removed -->
        {/if}
        {#if can('VIEW_ADMIN_PANEL')}
        <a href="/admin" class="nav-link" class:active={isActive('/admin')}>
          <Briefcase size={18} />
          Admin
        </a>
        {/if}
      </nav>

      <!-- User Menu - Profile link -->
      <div class="user-menu">
        <a href="/profile" class="profile-link">
          <User size={18} />
          <span class="profile-name">{user?.full_name || user?.email || 'Profile'}</span>
        </a>
      </div>
    </div>
  </header>
{/if}

<main class="container page-container">
  <slot />
</main>

<Toasts />

<style>
  :global(html) {
    background-color: var(--background);
  }

  :global(body) {
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--background);
    color: var(--text);
    display: flex;
    flex-direction: column;
    min-height: 100vh;
  }


  /* Navigation Header Styles */
  .nav-header {
    background: var(--primary);
    border-bottom: 1px solid var(--border);
    width: 100%;
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
  .profile-link { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--secondary); text-decoration: none; padding: 0.25rem 0.5rem; }
  .profile-name { margin-left: 0.25rem; font-weight: 600; }

  /* Footer styles */
  :global(.site-footer) {
    width: 100%;
    background: var(--primary); /* match site off-white */
    border-top: 1px solid var(--border); /* only top border */
    color: var(--text);
    padding: 2.5rem 0 1.25rem; /* larger top spacing so footer isn't immediately visible */
  }

  :global(.footer-container) {
    max-width: 1400px;
    margin: 0 auto;
    padding: 0 2rem;
    display: flex;
    gap: 1rem;
    align-items: center;
    justify-content: space-between;
    font-size: 0.9rem;
  }

  :global(.footer-left), :global(.footer-center), :global(.footer-right) {
    white-space: nowrap;
    opacity: 0.95;
  }

  /* Ensure main content area grows so footer is pushed below the fold for short pages */
  main.container.page-container {
    flex: 1 0 auto;
    min-height: calc(100vh - 220px); /* header+footer buffer so footer isn't visible without scrolling on short pages */
    max-width: 1440px;
    margin: 0 auto;
    padding: 0 1rem;
  }

  /* Button styles use global tokens from app.css */
</style>
