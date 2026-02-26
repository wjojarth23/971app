<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { initAuth, user as authUserStore, userStore, signOut } from '$lib/stores/auth.js';
  import { hasPermission } from '$lib/permissions.js';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';
  import navConfig from '$lib/navigation.json';
  import { Move3d, Hammer, Wrench, Receipt, Home, Briefcase, Coins, Package, User, ChevronDown, Menu, X, Camera } from 'lucide-svelte';
  import { goto, afterNavigate } from '$app/navigation';
  import { page } from '$app/stores';
  import Toasts from '$lib/Toasts.svelte';
  import { trackUserAttendance } from '$lib/attendance.js';
  import { toastActions } from '$lib/toast.js';

  let authUser = null;
  let profile = null;
  let lastProfile = null;
  let mobileMenuOpen = false;
  let scoutingEventKey = '';
  $: activeProfile = profile ?? lastProfile;
  
  // Check if user is approved (has CAN_SEE_ROUTES permission)
  $: isApproved = hasPermission(activeProfile, 'CAN_SEE_ROUTES');
  
  // Routes that unapproved users can access
  const ALLOWED_UNAPPROVED_ROUTES = ['/', '/profile'];
  
  // Check if current route is allowed for unapproved users
  function isRouteAllowedForUnapproved(pathname) {
    return ALLOWED_UNAPPROVED_ROUTES.some(route => pathname === route || pathname.startsWith(route + '/'));
  }
  
  // Guard: redirect unapproved users away from protected routes
  $: if (activeProfile && !isApproved && typeof window !== 'undefined') {
    const currentPath = $page.url.pathname;
    if (!isRouteAllowedForUnapproved(currentPath)) {
      goto('/');
    }
  }

  // Close mobile menu on route change
  $: if ($page.url.pathname) {
    mobileMenuOpen = false;
  }

  function toggleMobileMenu() {
    mobileMenuOpen = !mobileMenuOpen;
  }

  // Use the fetched profile (user_profiles) for role/permission checks
  function can(perm) {
    return hasPermission(activeProfile, perm);
  }

  async function checkAttendance(currentProfile) {
    if (typeof window === 'undefined') return;
    if (!currentProfile?.id) return;
    console.log('[attendance] checkAttendance invoked for profile id:', currentProfile?.id, 'path:', $page.url.pathname);
    try {
      const result = await trackUserAttendance(currentProfile.id);
      if (result?.recorded) {
        const locationName = result.record?.location?.name;
        const suffix = locationName ? ` at ${locationName}` : '';
        toastActions.show(`Attendance recorded${suffix}!`);
      }
    } catch (err) {
      console.warn('Attendance check failed', err);
    }
  }

  afterNavigate(() => {
    if (profile) {
      void checkAttendance(profile);
    }
  });

  onMount(() => {
    const unsubAuth = authUserStore.subscribe((v) => { authUser = v; });
    const unsubProfile = userStore.subscribe((v) => {
      profile = v;
      if (v) {
        lastProfile = v;
        void checkAttendance(v);
      }
    });
    void fetchActiveScoutingEventKey().then((k) => {
      scoutingEventKey = k || '';
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

  // Check if any child route in a folder is active
  function isFolderActive(folder) {
    if (!folder?.children) return false;
    return folder.children.some(child => {
      const childRoute = routeForKey(child.key ?? inferKey(child));
      return $page.url.pathname === childRoute;
    });
  }

  function canRenderTabKey(key) {
    const normalized = String(key || '').toLowerCase();
    if (normalized === 'scouting-admin' || normalized === 'scoutingadmin') {
      return activeProfile?.team_role === 'Competition Lead';
    }
    return true;
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
      case 'pitscout': return '/pitscout';
      case 'scouting-admin': return '/scouting-admin';
      case 'scoutingadmin': return '/scouting-admin';
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
    pitscout: Camera,
    scoutingadmin: Briefcase,
    'scouting-admin': Briefcase,
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
      
      <!-- Mobile Menu Toggle -->
      <button class="mobile-menu-toggle" on:click={toggleMobileMenu} aria-label="Toggle menu">
        {#if mobileMenuOpen}
          <X size={24} />
        {:else}
          <Menu size={24} />
        {/if}
      </button>
      
      <!-- Desktop Navigation -->
      <nav class="desktop-nav" class:mobile-open={mobileMenuOpen}>
        <a href="/" class="nav-link" class:active={isActive('/') }>
          <Home size={18} />
          Home
        </a>

        {#if isApproved}
          {#if customTabs}
            {#each customTabs as item}
              {#if item.type === 'folder'}
                <div class="nav-folder">
                  <button class="nav-link folder-trigger" class:active={isFolderActive(item)} aria-haspopup="true" aria-expanded="false">
                    <span class="folder-label">{displayLabel(item)}</span>
                    <ChevronDown size={14} class="folder-caret" />
                  </button>
                  <div class="folder-menu">
                    {#each item.children ?? [] as child}
                      {#if (child.key || child.label) && canRenderTabKey(child.key ?? inferKey(child))}
                        <a href={routeForKey(child.key ?? inferKey(child))} class="nav-link">
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
                {#if canRenderTabKey(item.key ?? inferKey(item))}
                  <a href={routeForKey(item.key ?? inferKey(item))} class="nav-link" class:active={isActive(routeForKey(item.key ?? inferKey(item)))}>
                    <svelte:component this={iconMap[item.key ?? inferKey(item)] ?? Home} size={18} />
                    {displayLabel(item)}
                  </a>
                {/if}
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
            {#if scoutingEventKey}
              {#if navConfig?.tabs?.notescout !== false}
                <a href="/notescout" class="nav-link" class:active={isActive('/notescout')}>
                  <svelte:component this={iconMap['notescout'] ?? Coins} size={18} />
                  Note Scouting
                </a>
              {/if}
              {#if navConfig?.tabs?.datascout !== false}
                <a href="/datascout" class="nav-link" class:active={isActive('/datascout')}>
                  <svelte:component this={iconMap['datascout'] ?? Coins} size={18} />
                  Data Scouting
                </a>
              {/if}
              {#if navConfig?.tabs?.pitscout !== false}
                <a href="/pitscout" class="nav-link" class:active={isActive('/pitscout')}>
                  <svelte:component this={iconMap['pitscout'] ?? Camera} size={18} />
                  Pit Scouting
                </a>
              {/if}
              {#if activeProfile?.team_role === 'Competition Lead'}
                <a href="/scouting-admin" class="nav-link" class:active={isActive('/scouting-admin')}>
                  <svelte:component this={iconMap['scouting-admin'] ?? Briefcase} size={18} />
                  Scouting Admin
                </a>
              {/if}
            {/if}
          {/if}

          {#if can('VIEW_ADMIN_PANEL')}
            <a href="/admin" class="nav-link" class:active={isActive('/admin')}>
              <Briefcase size={18} />
              Admin
            </a>
          {/if}
        {/if}
        
        <!-- Profile link in mobile menu - always visible -->
        <a href="/profile" class="nav-link mobile-profile-link" class:active={isActive('/profile')}>
          <User size={18} />
          Profile
        </a>
      </nav>

      <!-- User Menu - Profile link (desktop only) -->
      <div class="user-menu">
          <a href="/profile" class="profile-link">
          <User size={18} />
          <span class="profile-name">{activeProfile?.full_name || activeProfile?.email || 'Profile'}</span>
        </a>
      </div>
    </div>
  </header>
  
{/if}

<!-- Mobile menu overlay - outside conditional to avoid nesting issues -->
{#if mobileMenuOpen}
  <button class="mobile-menu-overlay" on:click={() => mobileMenuOpen = false} aria-label="Close menu"></button>
{/if}

<main class="container page-container">
  <slot />
</main>

<Toasts />

<style>
  :global(html) {
    background-color: var(--background);
  }

  /* Navigation Header Styles */
  .nav-header {
    background: var(--primary);
    border-bottom: 1px solid var(--border);
    width: 100%;
    margin-bottom: var(--space-7);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .nav-container {
    display: flex;
    align-items: stretch;
    justify-content: space-between;
    padding: 0 var(--space-7);
    max-width: 1400px;
    margin: 0 auto;
    min-height: 64px;
  }

  .nav-container > .brand,
  .nav-container > .desktop-nav,
  .nav-container > .user-menu {
    align-self: stretch;
  }

  .brand {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    color: var(--secondary);
    flex-shrink: 0;
  }

  .brand h1 {
    margin: 0;
    font-size: var(--font-xl);
    font-weight: 700;
    white-space: nowrap;
  }

  /* Mobile Menu Toggle */
  .mobile-menu-toggle {
    display: none;
    background: none;
    border: none;
    color: var(--secondary);
    cursor: pointer;
    padding: var(--space-2);
    border-radius: var(--radius-sm);
  }

  .mobile-menu-toggle:hover {
    background: var(--background);
  }

  .desktop-nav {
    display: flex;
    align-items: stretch;
    gap: var(--gap-4);
    flex: 1;
    justify-content: center;
    margin: 0 var(--space-7);
  }

  .nav-link {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    padding: var(--space-3) var(--space-6);
    text-decoration: none;
    color: var(--secondary);
    font-weight: 500;
    font-size: var(--font-xs);
    border-bottom: none;
    height: 100%;
    white-space: nowrap;
    position: relative;
  }

  .nav-link:hover {
    color: var(--secondary);
    background: transparent;
  }

  .nav-link:focus-visible {
    outline: 2px solid var(--accent-strong, var(--accent));
    outline-offset: 2px;
  }

  .nav-link.active {
    color: var(--secondary);
    background: var(--accent-subtle);
    border-radius: 0;
  }

  .nav-link::after {
    content: '';
    position: absolute;
    left: 0;
    right: 0;
    bottom: -1px;
    height: 4px;
    background: transparent;
    transition: background 0.2s ease;
  }

  .nav-link.active::after,
  .nav-link:focus-visible::after {
    background: var(--accent, var(--accent));
  }

  .user-menu {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }

  .profile-link { 
    display: inline-flex; 
    align-items: center; 
    gap: var(--gap-2); 
    color: var(--secondary); 
    text-decoration: none; 
    padding: var(--space-1) var(--space-2); 
  }

  .profile-name { 
    margin-left: var(--space-1); 
    font-weight: 600; 
  }

  /* Mobile profile link in nav - hidden by default */
  .mobile-profile-link {
    display: none;
  }

  /* Folder dropdown styles */
  .nav-folder { position: relative; }
  .folder-trigger { 
    background: transparent; 
    border: none; 
    cursor: pointer; 
    color: var(--secondary); 
    padding: var(--space-3) var(--space-6); 
    font-weight: 500; 
    display: inline-flex; 
    align-items: center; 
    gap: var(--gap-1); 
  }

  :global(.folder-caret) { 
    font-size: var(--font-xs); 
    opacity: 0.85; 
    margin-left: var(--space-1); 
  }

  .folder-label { 
      color: var(--secondary); 
      font-weight: 600; /* Match nav-link weight for better visibility */
      font-size: var(--font-xs); 
    }

  .folder-menu .nav-link { 
    font-weight: 500; 
    font-size: var(--font-xs); 
  }

  .folder-menu { 
    display: none; 
    position: absolute; 
    top: 100%; 
    left: 0; 
    background: var(--card); 
    border: 1px solid var(--border); 
    min-width: 220px; 
    z-index: 40; 
    padding: var(--space-1); 
    border-radius: var(--radius-lg); 
    box-shadow: 0 8px 20px rgba(0,0,0,0.06); 
  }

  .nav-folder:hover .folder-menu { display: block; }
  .folder-menu .nav-link { 
    display: block; 
    padding: var(--space-2) var(--space-3); 
    border-radius: var(--radius-sm); 
    color: var(--text); 
  }

  /* Mobile menu overlay */
  .mobile-menu-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.5);
    z-index: 90;
    border: none;
    cursor: pointer;
  }

  :global(.site-footer) {
    width: 100%;
    background: var(--primary);
    border-top: 1px solid var(--border);
    color: var(--text);
    padding: var(--space-7) 0 var(--space-6);
  }

  :global(.footer-container) { 
    max-width: 1400px; 
    margin: 0 auto; 
    padding: 0 var(--space-7); 
    display: flex; 
    gap: var(--gap-4); 
    align-items: center; 
    justify-content: space-between; 
    font-size: var(--font-xs); 
  }

  :global(.footer-left), :global(.footer-center), :global(.footer-right) { 
    white-space: nowrap; 
    opacity: 0.95; 
  }

  main.container.page-container { 
    flex: 1 0 auto; 
    min-height: calc(100vh - 220px); 
    max-width: 1440px; 
    margin: 0 auto; 
    padding: 0 var(--space-4); 
  }

  /* Mobile Responsive Styles */
  @media (max-width: 900px) {
    .nav-container {
      padding: 0 var(--space-4);
    }
    
    .desktop-nav {
      margin: 0 var(--space-4);
      gap: var(--gap-2);
    }
    
    .nav-link {
      padding: var(--space-3) var(--space-3);
      font-size: 0.7rem;
    }
    
    .folder-trigger {
      padding: var(--space-3) var(--space-3);
    }
    
    .profile-name {
      display: none;
    }
  }

  @media (max-width: 768px) {
    .nav-header {
      margin-bottom: var(--space-4);
    }
    
    .nav-container {
      min-height: 56px;
    }
    
    .brand h1 {
      font-size: var(--font-md);
    }
    
    .mobile-menu-toggle {
      display: flex;
      align-items: center;
      justify-content: center;
    }
    
    .user-menu {
      display: none;
    }
    
    .desktop-nav {
      display: none;
      position: fixed;
      top: 56px;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--primary);
      flex-direction: column;
      align-items: stretch;
      padding: var(--space-4);
      gap: var(--gap-2);
      overflow-y: auto;
      z-index: 95;
      margin: 0;
    }
    
    .desktop-nav.mobile-open {
      display: flex;
    }
    
    .nav-link {
      padding: var(--space-4);
      border-radius: var(--radius-sm);
      border-bottom: none;
      font-size: var(--font-base);
      justify-content: flex-start;
    }
    
    .nav-link.active {
      border-radius: var(--radius-sm);
    }
    
    .mobile-profile-link {
      display: flex;
      margin-top: auto;
      padding-top: var(--space-4);
      border-top: 1px solid var(--border);
    }
    
    .nav-folder {
      width: 100%;
    }
    
    .folder-trigger {
      width: 100%;
      padding: var(--space-4);
      justify-content: flex-start;
      font-size: var(--font-base);
    }
    
    .folder-menu {
      position: static;
      display: block;
      border: none;
      box-shadow: none;
      padding-left: var(--space-6);
      background: transparent;
    }
    
    .folder-menu .nav-link {
      padding: var(--space-3) var(--space-4);
    }
    
    main.container.page-container {
      padding: 0 var(--space-3);
      min-height: calc(100vh - 160px);
    }
  }

  @media (max-width: 480px) {
    .brand h1 {
      font-size: var(--font-base);
    }
    
    main.container.page-container {
      padding: 0 var(--space-2);
    }
  }
</style>
