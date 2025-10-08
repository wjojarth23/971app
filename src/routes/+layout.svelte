<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { initAuth, user as authUserStore, userStore, signOut } from '$lib/stores/auth.js';
  import notescoutConfig from '$lib/notescout.json';
  import navConfig from '$lib/navigation.json';
  import { Move3d, Hammer, Wrench, Receipt, Home, Briefcase, Coins, Package, User } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Toasts from '$lib/Toasts.svelte';

  let authUser = null;
  let profile = null;
  let lastProfile = null;
  $: activeProfile = profile ?? lastProfile;
  let predictTabVisible = false;
  let predictInfoLoaded = false;

  // Use the fetched profile (user_profiles) for role/permission checks
  function can(perm) {
    if (!activeProfile) return false;
    if (activeProfile.role === 'admin') return true;
    return Array.isArray(activeProfile.permissions) && activeProfile.permissions.includes(perm);
  }

  onMount(() => {
    const unsubAuth = authUserStore.subscribe((v) => { authUser = v; });
    const unsubProfile = userStore.subscribe((v) => { profile = v; if (v) lastProfile = v; });
    const uninit = initAuth();
    // Predict feature has been removed; mark loaded so nav renders normally
    predictInfoLoaded = true;
    return () => { unsubAuth?.(); unsubProfile?.(); uninit?.(); };
  });

  async function handleLogout() {
    await signOut();
    goto('/');
  }

  // Check if current route is active
  function isActive(path) {
    return $page.url.pathname === path;
  }

  // Map known tab keys to routes (extend as needed)
  function routeForKey(key) {
    switch (key) {
      case 'manufacture': return '/manufacture';
      case 'kitting': return '/kitting';
      case 'cad': return '/cad';
      case 'build': return '/cad/build';
      case 'purchasing': return '/cad/purchasing';
      case 'notescout': return '/notescout';
      case 'predict': return '/predict';
      case 'home': return '/';
      default: return '/' + key;
    }
  }

  // Small icon map so user-provided keys render nicer icons
  const iconMap = {
    manufacture: Hammer,
    kitting: Package,
    cad: Move3d,
    build: Wrench,
    purchasing: Receipt,
    notescout: Coins,
    home: Home,
    profile: User
  };

  // Infer a key for icon lookup from an item (prefer explicit key, fallback to label content)
  function inferKey(item) {
    if (!item) return null;
    if (typeof item === 'string') return item;
    if (item.key) return String(item.key);
    if (!item.label) return null;
    const lab = String(item.label).toLowerCase();
    for (const k of Object.keys(iconMap)) {
      if (lab.includes(k)) return k;
    }
    return lab.replace(/[^a-z0-9]/g, '');
  }

  function displayLabel(item) {
    if (!item) return '';
    if (typeof item === 'string') return String(item).replace(/^(.)/, (m) => m.toUpperCase());
    return item.label ?? '';
  }
</script>

{#if authUser || activeProfile}
  <!-- Navigation Header -->
  <header class="nav-header">
    <div class="nav-container">
      <div class="brand">
        <Briefcase size={28} />
        <h1>971 Hub</h1>
      </div>
      
      <!-- Desktop Navigation -->
      <nav class="desktop-nav">
        <a href="/" class="nav-link" class:active={isActive('/') }>
          <Home size={18} />
          Home
        </a>

        {#if activeProfile?.header_tabs && Array.isArray(activeProfile.header_tabs)}
          {#each activeProfile.header_tabs as item}
            {#if item.type === 'folder'}
              <div class="nav-folder">
                <button class="nav-link folder-trigger">
                  {item.label}
                </button>
                <div class="folder-menu">
                  {#each item.children ?? [] as child}
                    {#if child.key || child.label}
                      <a href={routeForKey(child.key ?? inferKey(child))} class="nav-link" class:active={isActive(routeForKey(child.key ?? inferKey(child)))}>
                        <svelte:component this={iconMap[child.key ?? inferKey(child)] ?? Home} size={18} />
                        {displayLabel(child)}
                      </a>
                    {:else}
                      <span class="nav-link">{child.label}</span>
                    {/if}
                  {/each}
                </div>
              </div>
            {:else}
              <a href={routeForKey(item.key ?? inferKey(item))} class="nav-link" class:active={isActive(routeForKey(item.key ?? inferKey(item)))}>
                <svelte:component this={iconMap[item.key ?? inferKey(item)] ?? Home} size={18} />
                {displayLabel(item)}
              </a>
            {/if}
          {/each}
        {:else}
          <!-- Fallback: original static nav driven by navConfig -->
          {#if navConfig?.tabs?.manufacture !== false}
            <a href="/manufacture" class="nav-link" class:active={isActive('/manufacture')}>
                <svelte:component this={iconMap['manufacture'] ?? Hammer} size={18} />
                Manufacture
              </a>
          {/if}
          {#if navConfig?.tabs?.kitting !== false}
            <a href="/kitting" class="nav-link" class:active={isActive('/kitting')}>
              <svelte:component this={iconMap['kitting'] ?? Package} size={18} />
              Kitting
            </a>
          {/if}
          <a href="/cad" class="nav-link" class:active={isActive('/cad')}>
            <svelte:component this={iconMap['cad'] ?? Move3d} size={18} />
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
              <svelte:component this={iconMap['notescout'] ?? Coins} size={18} />
              Note Scouting
            </a>
          {/if}
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
          <span class="profile-name">{activeProfile?.full_name || activeProfile?.email || 'Profile'}</span>
        </a>
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

  /* Folder dropdown styles */
  .nav-folder { position: relative; }
  .folder-trigger { background: transparent; border: none; cursor: pointer; color: var(--secondary); padding: 0.75rem 1.25rem; font-weight: 500; }
  .folder-menu { display: none; position: absolute; top: 100%; left: 0; background: var(--accent); border: 1px solid var(--border); min-width: 200px; z-index: 40; }
  .nav-folder:hover .folder-menu { display: block; }
  .folder-menu .nav-link { display: block; padding: 0.5rem 1rem; }

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
