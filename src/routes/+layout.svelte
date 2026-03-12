<script>
  import '../app.css';
  import { onMount } from 'svelte';
  import { initAuth, user as authUserStore, userStore } from '$lib/stores/auth.js';
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
  let openDesktopFolder = -1;
  let openMobileFolders = {};
  let scoutingEventKey = '';
  $: activeProfile = profile ?? lastProfile;

  // Check if user is approved (has CAN_SEE_ROUTES permission)
  $: isApproved = hasPermission(activeProfile, 'CAN_SEE_ROUTES');

  // Routes that unapproved users can access
  const ALLOWED_UNAPPROVED_ROUTES = ['/', '/profile'];

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

  // Close menus on route change
  $: if ($page.url.pathname) {
    mobileMenuOpen = false;
    openMobileFolders = {};
    openDesktopFolder = -1;
  }

  function closeMobileMenu() {
    mobileMenuOpen = false;
    openMobileFolders = {};
  }

  function toggleMobileMenu() {
    if (mobileMenuOpen) {
      closeMobileMenu();
    } else {
      mobileMenuOpen = true;
    }
  }

  function closeDesktopFolders() {
    openDesktopFolder = -1;
  }

  function toggleDesktopFolder(event, idx) {
    event.preventDefault();
    event.stopPropagation();
    openDesktopFolder = openDesktopFolder === idx ? -1 : idx;
  }

  function toggleMobileFolder(idx) {
    openMobileFolders = { ...openMobileFolders, [idx]: !openMobileFolders[idx] };
  }

  function can(perm) {
    return hasPermission(activeProfile, perm);
  }

  async function checkAttendance(currentProfile) {
    if (typeof window === 'undefined') return;
    if (!currentProfile?.id) return;
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
    const onPointerDown = (event) => {
      if (!event.target?.closest?.('.desktop-nav')) {
        closeDesktopFolders();
      }
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        closeDesktopFolders();
        closeMobileMenu();
      }
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);

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
    return () => {
      document.body.style.overflow = '';
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      unsubAuth?.();
      unsubProfile?.();
      uninit?.();
    };
  });

  $: if (typeof document !== 'undefined') {
    document.body.style.overflow = mobileMenuOpen ? 'hidden' : '';
  }

  function isActive(path) {
    return $page.url.pathname === path;
  }

  function isFolderActive(folder) {
    if (!folder?.children) return false;
    return folder.children.some((child) => isActive(child.href));
  }

  // --- Key / route / icon helpers ---

  function normalizeKey(rawKey) {
    const compact = String(rawKey || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!compact) return '';
    if (compact === 'home') return 'home';
    if (compact === 'profile') return 'profile';
    if (compact.startsWith('manufacture')) return 'manufacture';
    if (compact.startsWith('kitting')) return 'kitting';
    if (compact === 'cad') return 'cad';
    if (compact.startsWith('build')) return 'build';
    if (compact.startsWith('purchase') || compact.startsWith('purchasing')) return 'purchasing';
    if (compact.startsWith('notescout')) return 'notescout';
    if (compact.startsWith('datascout')) return 'datascout';
    if (compact.startsWith('teamview')) return 'teamview';
    if (compact.startsWith('pitscout')) return 'pitscout';
    if (compact.startsWith('task')) return 'tasks';
    if (compact === 'scoutingadmin' || compact === 'scoutadmin') return 'scouting-admin';
    return compact;
  }

  const ROUTE_MAP = {
    manufacture: '/manufacture',
    kitting: '/kitting',
    cad: '/cad',
    build: '/cad/build',
    purchasing: '/cad/purchasing',
    notescout: '/notescout',
    tasks: '/tasks',
    teamview: '/teamview',
    datascout: '/datascout',
    pitscout: '/pitscout',
    'scouting-admin': '/scouting-admin',
    home: '/',
    profile: '/profile',
    admin: '/admin'
  };

  const iconMap = {
    manufacture: Hammer,
    kitting: Package,
    cad: Move3d,
    build: Wrench,
    purchasing: Receipt,
    notescout: Coins,
    tasks: Briefcase,
    teamview: Coins,
    datascout: Coins,
    pitscout: Camera,
    'scouting-admin': Briefcase,
    home: Home,
    profile: User,
    admin: Briefcase
  };

  const LABEL_MAP = {
    manufacture: 'Manufacture',
    kitting: 'Kitting',
    cad: 'CAD',
    build: 'Build',
    purchasing: 'Purchasing',
    notescout: 'Note Scouting',
    tasks: 'Tasks',
    teamview: 'Team View',
    datascout: 'Data Scouting',
    pitscout: 'Pit Scouting',
    'scouting-admin': 'Scouting Admin',
    admin: 'Admin'
  };

  function inferKey(item) {
    if (!item) return '';
    if (typeof item === 'string') return normalizeKey(item);
    if (item.key) return normalizeKey(item.key);
    if (!item.label) return '';
    const lab = String(item.label).toLowerCase();
    for (const k of Object.keys(iconMap)) {
      if (lab.includes(k)) return k;
    }
    return normalizeKey(lab);
  }

  function displayLabel(item) {
    if (!item) return '';
    let lab = '';
    if (typeof item === 'string') lab = item;
    else if (item.label) lab = String(item.label);
    else if (item.key) lab = String(item.key);
    lab = lab.trim();
    if (!lab) return '';
    if (lab.toLowerCase() === 'cad') return 'CAD';
    return lab.charAt(0).toUpperCase() + lab.slice(1);
  }

  function canRenderTabKey(key) {
    const k = normalizeKey(key);
    if (k === 'scouting-admin') return activeProfile?.team_role === 'Competition Lead';
    return true;
  }

  function toLinkItem(item) {
    const key = inferKey(item);
    if (!key || !canRenderTabKey(key)) return null;
    return {
      type: 'link',
      key,
      href: ROUTE_MAP[key] || '/' + key,
      label: displayLabel(item) || LABEL_MAP[key] || key,
      icon: iconMap[key] || Home
    };
  }

  function buildNavItems(items) {
    if (!Array.isArray(items)) return [];
    return items.map((item) => {
      if (!item || typeof item !== 'object') return null;
      if (item.type === 'folder') {
        const children = (item.children || []).map(toLinkItem).filter(Boolean);
        if (!children.length) return null;
        return {
          type: 'folder',
          label: displayLabel(item) || 'Folder',
          children
        };
      }
      return toLinkItem(item);
    }).filter(Boolean);
  }

  function sanitizeTabs(tabs) {
    if (!Array.isArray(tabs)) return null;
    return tabs.map(entry => {
      if (!entry || typeof entry !== 'object') return null;
      const copy = { ...entry };
      if (copy.type === 'folder') {
        copy.children = Array.isArray(copy.children) ? copy.children.map(c => ({ ...c })) : [];
      }
      if (!copy.key && !copy.label) return null;
      return copy;
    }).filter(Boolean);
  }

  function fallbackTabs() {
    const tabs = [];
    if (navConfig?.tabs?.manufacture !== false) tabs.push({ key: 'manufacture', label: 'Manufacture' });
    if (navConfig?.tabs?.kitting !== false) tabs.push({ key: 'kitting', label: 'Kitting' });
    tabs.push({ key: 'cad', label: 'CAD' });
    if (navConfig?.tabs?.build !== false) tabs.push({ key: 'build', label: 'Build' });
    tabs.push({ key: 'purchasing', label: 'Purchasing' });
    if (navConfig?.tabs?.tasks !== false) tabs.push({ key: 'tasks', label: 'Tasks' });
    if (scoutingEventKey) {
      if (navConfig?.tabs?.notescout !== false) tabs.push({ key: 'notescout', label: 'Note Scouting' });
      const hasLegacyDatascoutFlag = Object.prototype.hasOwnProperty.call(navConfig?.tabs || {}, 'datascout');
      const teamViewEnabled = navConfig?.tabs?.teamview !== false || (hasLegacyDatascoutFlag && navConfig?.tabs?.datascout !== false);
      if (teamViewEnabled) tabs.push({ key: 'teamview', label: 'Team View' });
      if (navConfig?.tabs?.pitscout !== false) tabs.push({ key: 'pitscout', label: 'Pit Scouting' });
      if (activeProfile?.team_role === 'Competition Lead') tabs.push({ key: 'scouting-admin', label: 'Scouting Admin' });
    }
    return tabs;
  }

  function hasTabKey(items, wantedKey) {
    if (!Array.isArray(items)) return false;
    for (const item of items) {
      if (!item || typeof item !== 'object') continue;
      const key = normalizeKey(item.key || item.label);
      if (key === wantedKey) return true;
      if (item.type === 'folder' && hasTabKey(item.children, wantedKey)) return true;
    }
    return false;
  }

  function addAdminTabIfAllowed(tabs) {
    const list = Array.isArray(tabs) ? [...tabs] : [];
    if (!can('VIEW_ADMIN_PANEL')) return list;
    if (hasTabKey(list, 'admin')) return list;
    list.push({ key: 'admin', label: 'Admin' });
    return list;
  }

  $: customTabs = sanitizeTabs(activeProfile?.header_tabs);
  $: baseNavTabs = addAdminTabIfAllowed(customTabs ?? fallbackTabs());
  $: navItems = isApproved ? buildNavItems(baseNavTabs) : [];
  $: profileDisplayName = activeProfile?.full_name || activeProfile?.email || 'Profile';
</script>

{#if authUser || activeProfile}
  <header class="nav-header">
    <div class="nav-container">
      <!-- Brand -->
      <a href="/" class="brand" on:click={closeDesktopFolders}>
        <Briefcase size={24} />
        <span class="brand-name">971 Hub</span>
      </a>

      <!-- Desktop Nav -->
      <nav class="desktop-nav" aria-label="Primary navigation">
        <a href="/" class="nav-item" class:active={isActive('/')} on:click={closeDesktopFolders}>
          <Home size={16} />
          <span>Home</span>
        </a>

        {#if isApproved}
          {#each navItems as item, idx}
            {#if item.type === 'folder'}
              <div class="nav-dropdown" class:open={openDesktopFolder === idx}>
                <button
                  type="button"
                  class="nav-item"
                  class:active={isFolderActive(item)}
                  aria-haspopup="true"
                  aria-expanded={openDesktopFolder === idx}
                  on:click={(e) => toggleDesktopFolder(e, idx)}
                >
                  <span>{item.label}</span>
                  <ChevronDown size={14} class="caret" />
                </button>
                <div class="dropdown-menu">
                  {#each item.children as child}
                    <a href={child.href} class="dropdown-link" class:active={isActive(child.href)} on:click={closeDesktopFolders}>
                      <svelte:component this={child.icon} size={16} />
                      <span>{child.label}</span>
                    </a>
                  {/each}
                </div>
              </div>
            {:else}
              <a href={item.href} class="nav-item" class:active={isActive(item.href)} on:click={closeDesktopFolders}>
                <svelte:component this={item.icon} size={16} />
                <span>{item.label}</span>
              </a>
            {/if}
          {/each}

        {/if}
      </nav>

      <!-- Desktop Profile -->
      <a href="/profile" class="desktop-profile" on:click={closeDesktopFolders}>
        <User size={16} />
        <span class="profile-name">{profileDisplayName}</span>
      </a>

      <!-- Mobile Menu Toggle -->
      <button class="mobile-toggle" on:click={toggleMobileMenu} aria-expanded={mobileMenuOpen} aria-label="Toggle menu">
        {#if mobileMenuOpen}
          <X size={24} />
        {:else}
          <Menu size={24} />
        {/if}
      </button>
    </div>
  </header>
{/if}

<!-- Mobile Nav Panel -->
{#if mobileMenuOpen}
  <div class="mobile-overlay" on:click={closeMobileMenu} on:keydown={(e) => e.key === 'Escape' && closeMobileMenu()} role="button" tabindex="-1" aria-label="Close menu"></div>
  <nav class="mobile-nav" aria-label="Mobile navigation">
    <div class="mobile-section-label">Navigation</div>
    <a href="/" class="mobile-link" class:active={isActive('/')} on:click={closeMobileMenu}>
      <Home size={18} />
      <span>Home</span>
    </a>

    {#if isApproved}
      {#each navItems as item, idx}
        {#if item.type === 'folder'}
          <div class="mobile-folder" class:open={openMobileFolders[idx]}>
            <button
              type="button"
              class="mobile-link mobile-folder-btn"
              class:active={isFolderActive(item)}
              aria-expanded={!!openMobileFolders[idx]}
              on:click={() => toggleMobileFolder(idx)}
            >
              <span>{item.label}</span>
              <ChevronDown size={16} class="caret" />
            </button>
            {#if openMobileFolders[idx]}
              <div class="mobile-folder-children">
                {#each item.children as child}
                  <a href={child.href} class="mobile-link mobile-child" class:active={isActive(child.href)} on:click={closeMobileMenu}>
                    <svelte:component this={child.icon} size={16} />
                    <span>{child.label}</span>
                  </a>
                {/each}
              </div>
            {/if}
          </div>
        {:else}
          <a href={item.href} class="mobile-link" class:active={isActive(item.href)} on:click={closeMobileMenu}>
            <svelte:component this={item.icon} size={18} />
            <span>{item.label}</span>
          </a>
        {/if}
      {/each}

    {/if}

    <div class="mobile-divider"></div>
    <div class="mobile-section-label">Account</div>
    <a href="/profile" class="mobile-link" class:active={isActive('/profile')} on:click={closeMobileMenu}>
      <User size={18} />
      <span>{profileDisplayName}</span>
    </a>
  </nav>
{/if}

<main class="container page-container">
  <slot />
</main>

<Toasts />

<style>
  :global(html) {
    background-color: var(--background);
  }

  /* ========== HEADER BAR ========== */
  .nav-header {
    background: var(--surface-1);
    border-bottom: 1px solid var(--border);
    position: sticky;
    top: 0;
    z-index: 110;
    width: 100%;
    margin-bottom: var(--space-7);
    box-shadow: var(--shadow-sm);
  }

  .nav-container {
    display: flex;
    align-items: center;
    max-width: 1440px;
    margin: 0 auto;
    padding: 0 clamp(0.75rem, 2vw, 1.75rem);
    min-height: 60px;
    gap: var(--gap-3);
  }

  /* ========== BRAND ========== */
  .brand {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    color: var(--secondary);
    text-decoration: none;
    flex-shrink: 0;
    margin-right: var(--space-3);
    padding: 0.4rem 0.6rem;
    border-radius: var(--radius-sm);
    transition: background 0.15s ease, color 0.15s ease;
  }

  .brand:hover {
    background: var(--accent-subtle);
  }

  .brand-name {
    font-size: var(--font-xl);
    font-weight: 700;
    white-space: nowrap;
  }

  /* ========== DESKTOP NAV ========== */
  .desktop-nav {
    display: flex;
    align-items: center;
    gap: var(--gap-1);
    flex: 1;
    min-width: 0;
    padding: 0;
    overflow-x: auto;
    scrollbar-width: none;
  }

  .desktop-nav::-webkit-scrollbar {
    display: none;
  }

  .nav-item {
    display: flex;
    align-items: center;
    gap: 6px;
    padding: 8px 11px;
    color: var(--secondary);
    text-decoration: none;
    font-size: var(--font-xs);
    font-weight: 500;
    white-space: nowrap;
    border: 1px solid transparent;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    position: relative;
    transition: background 0.15s ease, color 0.15s ease, border-color 0.15s ease;
    min-height: 34px;
  }

  .nav-item:hover {
    background: var(--surface-2);
    border-color: var(--border);
  }

  .nav-item.active {
    background: var(--accent-subtle);
    color: var(--secondary);
    border-color: var(--accent);
    font-weight: 600;
  }

  .nav-item:focus-visible {
    outline: 2px solid var(--accent-strong, var(--accent));
    outline-offset: 2px;
  }

  /* ========== DESKTOP DROPDOWN ========== */
  .nav-dropdown {
    position: relative;
  }

  :global(.caret) {
    transition: transform 0.2s ease;
    opacity: 0.7;
  }

  .nav-dropdown.open :global(.caret) {
    transform: rotate(180deg);
  }

  .nav-dropdown.open .dropdown-menu {
    display: flex;
  }

  .dropdown-menu {
    position: absolute;
    top: calc(100% + 6px);
    left: 0;
    min-width: 200px;
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-md);
    padding: var(--space-1);
    z-index: 200;
    display: none;
    flex-direction: column;
    gap: 2px;
  }

  .dropdown-link {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px 14px;
    color: var(--text);
    text-decoration: none;
    font-size: var(--font-xs);
    font-weight: 500;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    transition: background 0.12s ease, border-color 0.12s ease;
  }

  .dropdown-link:hover {
    background: var(--accent-subtle);
    border-color: var(--border);
  }

  .dropdown-link.active {
    background: var(--accent-subtle);
    color: var(--secondary);
    border-color: var(--accent);
    font-weight: 600;
  }

  /* ========== DESKTOP PROFILE ========== */
  .desktop-profile {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    color: var(--secondary);
    text-decoration: none;
    padding: 6px 10px;
    border-radius: var(--radius-sm);
    flex-shrink: 0;
    margin-left: auto;
    min-width: 0;
    max-width: 260px;
    border: 1px solid var(--border);
    background: var(--surface-1);
    transition: background 0.15s ease, border-color 0.15s ease;
  }

  .desktop-profile:hover {
    background: var(--surface-2);
    border-color: var(--accent);
  }

  .profile-name {
    font-weight: 600;
    font-size: var(--font-xs);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ========== MOBILE TOGGLE ========== */
  .mobile-toggle {
    display: none;
    align-items: center;
    justify-content: center;
    background: transparent;
    border: none;
    color: var(--secondary);
    cursor: pointer;
    padding: 0.45rem;
    border-radius: var(--radius-sm);
    margin-left: auto;
    flex-shrink: 0;
    border: 1px solid var(--border);
    background: var(--surface-1);
  }

  .mobile-toggle:hover {
    background: var(--surface-2);
    border-color: var(--accent);
  }

  .mobile-toggle:focus-visible {
    outline: 2px solid var(--accent-strong, var(--accent));
    outline-offset: 2px;
  }

  /* ========== MOBILE OVERLAY ========== */
  .mobile-overlay {
    display: none;
  }

  /* ========== MOBILE NAV ========== */
  .mobile-nav {
    display: none;
  }

  .mobile-link {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 14px;
    color: var(--secondary);
    text-decoration: none;
    font-size: 0.95rem;
    font-weight: 500;
    border: none;
    background: none;
    cursor: pointer;
    border-radius: var(--radius-sm);
    width: 100%;
    text-align: left;
    min-height: 44px;
    transition: background 0.15s ease, color 0.15s ease;
    border: 1px solid transparent;
  }

  .mobile-link:hover {
    background: var(--surface-2);
    border-color: var(--border);
  }

  .mobile-link.active {
    background: var(--accent-subtle);
    color: var(--text);
    font-weight: 600;
    border-color: var(--accent);
  }

  .mobile-section-label {
    color: var(--text-muted);
    font-size: 0.7rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    text-transform: uppercase;
    padding: 0 var(--space-1);
  }

  .mobile-folder {
    border: none;
    border-radius: 0;
    overflow: visible;
    background: transparent;
  }

  .mobile-folder-btn {
    justify-content: space-between;
    border-radius: var(--radius-sm);
    background: var(--primary);
    border-color: transparent;
  }

  .mobile-folder .mobile-link,
  .mobile-folder .mobile-link:hover,
  .mobile-folder .mobile-link.active {
    border-color: transparent;
  }

  .mobile-folder.open .mobile-folder-btn {
    border-bottom: none;
  }

  .mobile-folder.open :global(.caret) {
    transform: rotate(180deg);
  }

  .mobile-folder-children {
    display: flex;
    flex-direction: column;
    padding: var(--space-2);
    gap: 2px;
    border-top: none;
    background: var(--primary);
  }

  .mobile-child {
    font-size: 0.9rem;
    padding: 12px 14px;
    min-height: 44px;
  }

  .mobile-divider {
    height: 1px;
    background: var(--border);
    margin: var(--space-2) 0;
  }

  /* ========== FOOTER (global) ========== */
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

  /* ========== MAIN CONTENT ========== */
  main.container.page-container {
    flex: 1 0 auto;
    min-height: calc(100vh - 220px);
    max-width: 1440px;
    margin: 0 auto;
    padding: 0 var(--space-4);
  }

  /* ========== TABLET (≤960px) ========== */
  @media (max-width: 960px) {
    .nav-container {
      padding: 0 var(--space-4);
    }

    .nav-item {
      padding: 7px 9px;
      font-size: 0.74rem;
    }

    .desktop-profile {
      max-width: 42px;
      justify-content: center;
      padding: 6px;
    }

    .profile-name {
      display: none;
    }
  }

  /* ========== MOBILE (≤768px) ========== */
  @media (max-width: 768px) {
    .nav-header {
      margin-bottom: var(--space-4);
    }

    .nav-container {
      min-height: 56px;
    }

    .brand-name {
      font-size: var(--font-md);
    }

    .desktop-nav,
    .desktop-profile {
      display: none;
    }

    .mobile-toggle {
      display: flex;
    }

    .mobile-overlay {
      display: block;
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.32);
      z-index: 119;
    }

    .mobile-nav {
      display: flex;
      flex-direction: column;
      position: fixed;
      top: 56px;
      left: 0;
      right: 0;
      bottom: 0;
      background: var(--surface-1);
      z-index: 120;
      padding: var(--space-4);
      gap: var(--gap-2);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      border-top: 1px solid var(--border);
      box-shadow: var(--shadow-md);
    }

    main.container.page-container {
      padding: 0 var(--space-3);
      min-height: calc(100vh - 160px);
    }
  }

  /* ========== SMALL MOBILE (≤480px) ========== */
  @media (max-width: 480px) {
    .brand-name {
      font-size: var(--font-base);
    }

    main.container.page-container {
      padding: 0 var(--space-2);
    }
  }

  /* ========== DESKTOP POLISH (>=769px) ========== */
  @media (min-width: 769px) {
    .nav-header {
      --desktop-header-height: 64px;
      --desktop-nav-item-height: 38px;
      --desktop-underline-thickness: 3px;
      --desktop-underline-offset: calc(((var(--desktop-header-height) - var(--desktop-nav-item-height)) / 2) + 1px);
      --desktop-underline-inset: 0.35rem;
      background: var(--surface-1);
      border-bottom-color: var(--border);
      box-shadow: var(--shadow-sm);
    }

    .nav-container {
      min-height: var(--desktop-header-height);
      padding: 0 clamp(0.75rem, 2vw, 1.75rem);
      gap: var(--gap-3);
    }

    .brand {
      margin-right: var(--space-2);
      padding: 0.35rem 0.5rem;
      border-radius: var(--radius-sm);
      border: 1px solid transparent;
      font-weight: 600;
    }

    .brand:hover {
      background: var(--surface-2);
      border-color: var(--border);
    }

    .brand-name {
      font-size: var(--font-md);
      letter-spacing: 0;
    }

    .desktop-nav {
      gap: 0.2rem;
      padding: 0;
      border: none;
      border-radius: 0;
      background: transparent;
      overflow: visible;
    }

    .nav-item {
      gap: 0.45rem;
      padding: 0.55rem 0.7rem;
      min-height: var(--desktop-nav-item-height);
      height: var(--desktop-nav-item-height);
      border: 1px solid transparent;
      border-radius: var(--radius-sm);
      background: transparent;
      color: var(--secondary);
      font-size: 0.84rem;
      font-weight: 600;
      line-height: 1;
    }

    .nav-item :global(svg) {
      opacity: 0.9;
      transition: opacity 0.15s ease, color 0.15s ease;
      flex-shrink: 0;
    }

    .nav-item:hover {
      background: transparent;
      border-color: transparent;
      color: var(--secondary);
    }

    .nav-item:hover :global(svg) {
      opacity: 1;
    }

    .nav-item:hover::after {
      content: '';
      position: absolute;
      left: var(--desktop-underline-inset);
      right: var(--desktop-underline-inset);
      bottom: calc(-1 * var(--desktop-underline-offset));
      height: var(--desktop-underline-thickness);
      border-radius: 2px;
      background: rgba(143, 95, 0, 0.32);
    }

    .nav-item.active {
      background: transparent;
      border-color: transparent;
      box-shadow: none;
      color: var(--secondary);
    }

    .nav-item.active::after {
      content: '';
      position: absolute;
      left: var(--desktop-underline-inset);
      right: var(--desktop-underline-inset);
      bottom: calc(-1 * var(--desktop-underline-offset));
      height: var(--desktop-underline-thickness);
      border-radius: 2px;
      background: var(--accent);
    }

    .nav-item.active :global(svg) {
      opacity: 1;
      color: var(--accent-strong);
    }

    .nav-dropdown {
      display: flex;
      align-items: center;
      position: relative;
    }

    .nav-dropdown::after {
      content: '';
      position: absolute;
      top: 100%;
      left: 0;
      width: max(100%, 220px);
      height: 0;
    }

    .nav-dropdown:hover::after,
    .nav-dropdown:focus-within::after,
    .nav-dropdown.open::after {
      height: calc(((var(--desktop-header-height) - var(--desktop-nav-item-height)) / 2) + 4px);
    }

    .nav-dropdown:hover .dropdown-menu,
    .nav-dropdown:focus-within .dropdown-menu,
    .nav-dropdown.open .dropdown-menu {
      display: flex;
    }

    .nav-dropdown:hover :global(.caret),
    .nav-dropdown:focus-within :global(.caret),
    .nav-dropdown.open :global(.caret) {
      transform: rotate(180deg);
    }

    .dropdown-menu {
      top: calc(100% + ((var(--desktop-header-height) - var(--desktop-nav-item-height)) / 2));
      min-width: 220px;
      background: var(--card);
      border-color: var(--border);
      border-radius: 8px;
      padding: var(--space-1);
      box-shadow: var(--shadow-md);
    }

    .dropdown-link {
      min-height: 34px;
      padding: 0.5rem 0.68rem;
      border-radius: var(--radius-sm);
      font-size: var(--font-xs);
      color: var(--text);
    }

    .dropdown-link:hover {
      background: var(--surface-2);
      border-color: var(--border);
    }

    .dropdown-link.active {
      background: var(--accent-subtle);
      border-color: var(--accent);
      box-shadow: none;
    }

    .desktop-profile {
      margin-left: var(--space-2);
      min-height: 38px;
      padding: 0.45rem 0.65rem;
      border-radius: var(--radius-sm);
      background: var(--surface-1);
      border-color: var(--border);
    }

    .desktop-profile:hover {
      background: var(--surface-2);
      border-color: var(--accent);
    }

    .profile-name {
      font-size: var(--font-xs);
      max-width: 220px;
      color: var(--secondary);
    }
  }
</style>
