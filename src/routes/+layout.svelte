<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { initAuth, user as authUserStore, userStore, signOut } from '$lib/stores/auth.js';
  import notescoutConfig from '$lib/notescout.json';
  import navConfig from '$lib/navigation.json';
  import { Move3d, Hammer, Wrench, Receipt, Home, Briefcase, Coins, Package, User, ChevronDown } from 'lucide-svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/stores';
  import Toasts from '$lib/Toasts.svelte';
  import { trackUserAttendance } from '$lib/attendance.js';
  import { toastActions } from '$lib/toast.js';

  let authUser = null;
  let profile = null;
  let lastProfile = null;
  let attendanceChecked = false;
  $: activeProfile = profile ?? lastProfile;

  // Use the fetched profile (user_profiles) for role/permission checks
  function can(perm) {
    if (!activeProfile) return false;
    if (activeProfile.role === 'admin') return true;
    return Array.isArray(activeProfile.permissions) && activeProfile.permissions.includes(perm);
  }

  async function maybeCheckAttendance(currentProfile) {
    if (attendanceChecked || typeof window === 'undefined') return;
    if (!currentProfile?.id) return;
    attendanceChecked = true;
    try {
      const result = await trackUserAttendance(currentProfile.id);
      if (result?.recorded) {
        const locationName = result.record?.location?.name;
        const suffix = locationName ? ` at ${locationName}` : '';
        toastActions.show(`Attendance recorded${suffix}!`);
      }
    } catch (err) {
      console.warn('Attendance auto-check failed', err);
    }
  }

  onMount(() => {
    const unsubAuth = authUserStore.subscribe((v) => { authUser = v; });
    const unsubProfile = userStore.subscribe((v) => {
      profile = v;
      if (v) {
        lastProfile = v;
        void maybeCheckAttendance(v);
      } else {
        attendanceChecked = false;
      }
    });
    const uninit = initAuth();
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
      case 'datascout': return '/datascout';
      case 'home': return '/';
      case 'profile': return '/profile';
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
    datascout: Coins,
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

  // Format labels for display: capitalize first character for everything
  // but keep 'CAD' fully uppercase when present.
  function displayLabel(item) {
    if (!item) return '';
    let lab = '';
    if (typeof item === 'string') lab = String(item);
    else if (item.label) lab = String(item.label);
    else if (item.key) lab = String(item.key);
    lab = lab.trim();
    if (!lab) return '';
    if (lab.toLowerCase() === 'cad') return 'CAD';
    return lab.replace(/^(.)/, (m) => m.toUpperCase());
  }

  // Defensive clone & validate header tabs to avoid accidental mutation & invalid objects causing wrong links
  function sanitizeTabs(tabs) {
    if (!Array.isArray(tabs)) return null;
    return tabs.map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const copy = { ...entry };
      if (copy.type === 'folder') {
        copy.children = Array.isArray(copy.children) ? copy.children.map(c => ({ ...c })) : [];
      }
      if (!copy.key && !copy.label) {
        console.warn('Dropping header_tabs item lacking key/label', copy);
        return null;
      }
      return copy;
    }).filter(Boolean);
  }
  $: customTabs = sanitizeTabs(activeProfile?.header_tabs);
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

        {#if customTabs}
          {#each customTabs as item}
            {#if item.type === 'folder'}
              <div class="nav-folder">
                <button class="nav-link folder-trigger" aria-haspopup="true" aria-expanded="false">
                  <span class="folder-label">{displayLabel(item)}</span>
                  <ChevronDown size={14} class="folder-caret" />
                </button>
                <div class="folder-menu">
                  {#each item.children ?? [] as child}
                    {#if child.key || child.label}
                      <a href={routeForKey(child.key ?? inferKey(child))} class="nav-link" class:active={isActive(routeForKey(child.key ?? inferKey(child)))}>
                        <svelte:component this={iconMap[child.key ?? inferKey(child)] ?? Home} size={18} />
                        {displayLabel(child)}
                      </a>
                    {:else}
                      <span class="nav-link">{displayLabel(child)}</span>
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
            <a href="/datascout" class="nav-link" class:active={isActive('/datascout')}>
              <svelte:component this={iconMap['datascout'] ?? Coins} size={18} />
              Data Scouting
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
  /* Folder-specific tweaks: bold label, caret */
  .folder-trigger { display: inline-flex; align-items: center; gap: 0.35rem; }
  :global(.folder-caret) { font-size: 0.85rem; opacity: 0.85; margin-left: 0.15rem; }
  /* Make folder label text match nav-link text */
  .folder-label { color: var(--secondary); font-weight: 500; font-size: 0.95rem; }
  /* Ensure dropdown child links use the same weight/size */
  .folder-menu .nav-link { font-weight: 500; font-size: 0.95rem; }
  /* Folder hover: square light grey (no rounding or yellow) */
  .nav-folder:hover > .folder-trigger { background: var(--background); color: var(--text); border-radius: 0; border: 1px solid var(--border); }

  /* Dropdown menu: styled as a subtle card; child items keep accent hover */
  .folder-menu { display: none; position: absolute; top: 100%; left: 0; background: var(--card); border: 1px solid var(--border); min-width: 220px; z-index: 40; padding: 0.35rem; border-radius: 6px; box-shadow: 0 8px 20px rgba(0,0,0,0.06); }
  .nav-folder:hover .folder-menu { display: block; }
  .folder-menu .nav-link { display: block; padding: 0.5rem 0.9rem; border-radius: 4px; color: var(--text); }
  .folder-menu .nav-link:hover { background: var(--accent); color: var(--secondary); }

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
