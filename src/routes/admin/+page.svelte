<script>
  import { onMount } from 'svelte';
  import { userStore, getUserUUID } from '$lib/stores/user.js';
  import { PERMISSIONS, hasPermission, GENERAL_ROLES, PURCHASING_ROLES, TEAM_ROLES } from '$lib/permissions.js';
  import { supabase } from '$lib/supabase.js';
  import { get } from 'svelte/store';
  import { ShoppingCart, DollarSign, TrendingUp, Package, Plus, Edit, Trash2, User } from 'lucide-svelte';
  import { toastActions } from '$lib/toast.js';
  const BOT_BASE_URL = import.meta.env?.VITE_BOT_BASE_URL || '/api/971bot';

  // Tab management
  let activeTab = 'access'; // 'access', 'purchasing', 'rosters'
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

  // User management state
  let users = [];
  let loading = false;
  let error = null;
  let userSearchQuery = '';
  let generalRoleFilter = 'all';
  let purchasingRoleFilter = 'all';
  let teamRoleFilter = 'all';
  let approvalFilter = 'all';
  let savingRoleIds = new Set();

  // Roster Management State
  let rosters = [];
  let rosterKeys = [];
  let rosterEntries = [];
  let selectedRoster = null;
  let loadingRosters = false;
  let showCreateRosterModal = false;
  let newRosterName = '';
  let newRosterType = 'multi';
  let newRosterPublic = false;
  let newRosterAdmin = false;
  let newKeyName = '';
  let newKeyCategory = 'General';
  let rosterSearchQuery = '';
  let rosterMemberSearchQuery = '';

  // Purchasing admin state
  let vendors = [];
  let purchaseHistory = [];
  let orders = [];
  let loadingVendors = false;
  let loadingPurchases = false;
  let loadingOrders = false;
  let showAddVendorModal = false;
  let showEditVendorModal = false;
  let editingVendor = null;
  let vendorName = '';
  let vendorUrlBase = '';
  let vendorFreeShipping = false;
  
  // Analytics filters
  let timePeriodDays = 30;
  let customStartDate = '';
  let customEndDate = '';

  const defaultGeneralRole = GENERAL_ROLES.NONE;
  const defaultPurchasingRole = PURCHASING_ROLES.BASIC;
  const defaultTeamRole = TEAM_ROLES.OTHER;

  const generalRoleThemes = {
    [GENERAL_ROLES.NONE]: { bg: 'var(--muted-bg)', border: '#e5e7eb', text: '#6b7280' },
    [GENERAL_ROLES.MEMBER]: { bg: '#dbeafe', border: '#bfdbfe', text: '#1e3a8a' },
    [GENERAL_ROLES.SUBSYSTEM_LEAD]: { bg: '#fef3c7', border: '#fde68a', text: '#92400e' },
    [GENERAL_ROLES.LEAD]: { bg: '#dcfce7', border: '#bbf7d0', text: '#166534' }
  };

  const purchasingRoleThemes = {
    [PURCHASING_ROLES.BASIC]: { bg: '#f3f4f6', border: '#e5e7eb', text: '#374151' },
    [PURCHASING_ROLES.APPROVER]: { bg: '#e0f2f1', border: '#bae4de', text: '#0f766e' },
    [PURCHASING_ROLES.LEAD]: { bg: '#fee2e2', border: '#fecaca', text: '#991b1b' },
    [PURCHASING_ROLES.BUDGETING]: { bg: '#ede9fe', border: '#ddd6fe', text: '#5b21b6' }
  };

  const teamRoleThemes = {
    [TEAM_ROLES.COMPETITION_LEAD]: { bg: '#e0e7ff', border: '#c7d2fe', text: '#3730a3' },
    [TEAM_ROLES.MECHANICAL_LEAD]: { bg: '#fef3c7', border: '#fde68a', text: '#92400e' },
    [TEAM_ROLES.SOFTWARE_LEAD]: { bg: '#ddd6fe', border: '#c4b5fd', text: '#5b21b6' },
    [TEAM_ROLES.MANUFACTURING_LEAD]: { bg: '#dcfce7', border: '#bbf7d0', text: '#166534' },
    [TEAM_ROLES.MANUFACTURING_MEMBER]: { bg: '#fff7ed', border: '#fed7aa', text: '#9a3412' },
    [TEAM_ROLES.CAD_MEMBER]: { bg: '#fef2f2', border: '#fee2e2', text: '#991b1b' },
    [TEAM_ROLES.SOFTWARE_MEMBER]: { bg: '#e0f2fe', border: '#bae6fd', text: '#075985' },
    [TEAM_ROLES.OTHER]: { bg: '#f3f4f6', border: '#e5e7eb', text: '#374151' }
  };

  const approvalFilterOptions = [
    { value: 'all', label: 'All Statuses' },
    { value: 'pending', label: 'Pending Approval' },
    { value: 'approved', label: 'Approved' }
  ];

  const generalRoleOptions = Object.values(GENERAL_ROLES);
  const purchasingRoleOptions = Object.values(PURCHASING_ROLES);
  const teamRoleOptions = Array.from(new Set(Object.values(TEAM_ROLES)));

  function formatRoleLabel(value) {
    if (!value) return 'Unassigned';
    return value
      .replace(/[_-]+/g, ' ')
      .replace(/\b\w/g, (char) => char.toUpperCase())
      .trim();
  }

  function roleThemeStyle(theme) {
    const safeTheme = theme || { bg: 'var(--surface-1)', border: 'var(--border)', text: 'var(--text)' };
    return `--role-bg:${safeTheme.bg}; --role-border:${safeTheme.border}; --role-text:${safeTheme.text};`;
  }

  const isUserApproved = (user) => user?.permissions?.includes('CAN_SEE_ROUTES');

  function resetUserFilters() {
    userSearchQuery = '';
    generalRoleFilter = 'all';
    purchasingRoleFilter = 'all';
    teamRoleFilter = 'all';
    approvalFilter = 'all';
  }

  function setSaving(userId, isSaving) {
    const next = new Set(savingRoleIds);
    if (isSaving) {
      next.add(userId);
    } else {
      next.delete(userId);
    }
    savingRoleIds = next;
  }

  // Computed analytics
  $: approverStats = computeApproverStats(purchaseHistory, timePeriodDays, customStartDate, customEndDate);
  $: projectStats = computeProjectStats(purchaseHistory, timePeriodDays, customStartDate, customEndDate);
  $: vendorStats = computeVendorStats(purchaseHistory, vendors, timePeriodDays, customStartDate, customEndDate);
  $: ordererStats = computeOrdererStats(purchaseHistory, timePeriodDays, customStartDate, customEndDate);
  $: totalSpending = computeTotalSpending(purchaseHistory, timePeriodDays, customStartDate, customEndDate);
  $: orderStats = computeOrderStats(orders, purchaseHistory, timePeriodDays, customStartDate, customEndDate);

  function computeApproverStats(purchases, days, startDate, endDate) {
    const filtered = filterByTimePeriod(purchases, days, startDate, endDate);
    const stats = {};
    filtered.forEach(p => {
      if (p.approver && (p.status === 'approved' || p.status === 'ordered' || p.status === 'delivered' || p.status === 'kitted')) {
        if (!stats[p.approver]) {
          stats[p.approver] = { count: 0, total: 0 };
        }
        stats[p.approver].count++;
        stats[p.approver].total += (p.final_price || p.price || 0) * (p.quantity || 1);
      }
    });
    return Object.entries(stats).map(([name, data]) => ({
      approver: name,
      count: data.count,
      total: data.total
    })).sort((a, b) => b.total - a.total);
  }

  function computeOrdererStats(purchases, days, startDate, endDate) {
    const filtered = filterByTimePeriod(purchases, days, startDate, endDate);
    const stats = {};
    filtered.forEach(p => {
      const ordererName = p.requester || 'Unknown';
      if (p.status === 'approved' || p.status === 'ordered' || p.status === 'delivered' || p.status === 'kitted') {
        if (!stats[ordererName]) {
          stats[ordererName] = { count: 0, total: 0 };
        }
        stats[ordererName].count++;
        stats[ordererName].total += (p.final_price || p.price || 0) * (p.quantity || 1);
      }
    });
    return Object.entries(stats).map(([name, data]) => ({
      orderer: name,
      count: data.count,
      total: data.total
    })).sort((a, b) => b.total - a.total);
  }

  function computeProjectStats(purchases, days, startDate, endDate) {
    const filtered = filterByTimePeriod(purchases, days, startDate, endDate);
    const stats = {};
    filtered.forEach(p => {
      if (p.project_id && (p.status === 'approved' || p.status === 'ordered' || p.status === 'delivered' || p.status === 'kitted')) {
        if (!stats[p.project_id]) {
          stats[p.project_id] = { count: 0, total: 0 };
        }
        stats[p.project_id].count++;
        stats[p.project_id].total += (p.final_price || p.price || 0) * (p.quantity || 1);
      }
    });
    return Object.entries(stats).map(([project, data]) => ({
      project_id: project,
      count: data.count,
      total: data.total
    })).sort((a, b) => b.total - a.total);
  }

  function computeVendorStats(purchases, vendorList, days, startDate, endDate) {
    const filtered = filterByTimePeriod(purchases, days, startDate, endDate);
    const vendorNames = new Set(vendorList.map(v => v.name.toLowerCase()));
    const stats = {};
    
    filtered.forEach(p => {
      if (p.status === 'approved' || p.status === 'ordered' || p.status === 'delivered' || p.status === 'kitted') {
        // Normalize vendor name for matching
        const rawVendor = p.vendor || '';
        const normalizedVendor = rawVendor.trim().toLowerCase();
        
        // Check if this vendor is in our vendor table
        let vendorKey = 'Other';
        if (normalizedVendor && vendorNames.has(normalizedVendor)) {
          // Find the proper case version
          const match = vendorList.find(v => v.name.toLowerCase() === normalizedVendor);
          vendorKey = match ? match.name : rawVendor;
        }
        
        if (!stats[vendorKey]) {
          stats[vendorKey] = { count: 0, total: 0 };
        }
        stats[vendorKey].count++;
        stats[vendorKey].total += (p.final_price || p.price || 0) * (p.quantity || 1);
      }
    });
    
    return Object.entries(stats).map(([vendor, data]) => ({
      vendor: vendor,
      count: data.count,
      total: data.total
    })).sort((a, b) => b.total - a.total);
  }

  function computeTotalSpending(purchases, days, startDate, endDate) {
    const filtered = filterByTimePeriod(purchases, days, startDate, endDate);
    let total = 0;
    let items = 0;

    filtered.forEach(p => {
      if (p.status === 'approved' || p.status === 'ordered' || p.status === 'delivered' || p.status === 'kitted') {
        const qty = p.quantity || 1;
        const itemCost = (p.final_price || p.price || 0) * qty;
        const shippingAlloc = Number(p.shipping_cost_allocated || 0);
        total += itemCost + shippingAlloc;
        items += qty;
      }
    });

    return { total, count: items };
  }

  function computeOrderStats(ordersList, purchases, days, startDate, endDate) {
    const filteredOrders = ordersList.filter(o => {
      const date = new Date(o.placed_at);
      if (customStartDate && customEndDate) {
        return date >= new Date(customStartDate) && date <= new Date(customEndDate);
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return date >= cutoff;
      }
    });

    const totalOrderSpending = filteredOrders.reduce((sum, o) => sum + (o.total_cost || 0) + (o.shipping_cost || 0), 0);
    const orderCount = filteredOrders.length;

    // Calculate spending on non-order items (approved but not in an order)
    const filteredPurchases = filterByTimePeriod(purchases, days, customStartDate, customEndDate);
    const eligibleStatuses = new Set(['approved', 'ordered', 'delivered', 'kitted']);
    const scopedPurchases = filteredPurchases.filter(p => eligibleStatuses.has(p.status));

    const nonOrderSpending = scopedPurchases
      .filter(p => !p.order_id)
      .reduce((sum, p) => sum + (p.final_price || p.price || 0) * (p.quantity || 1), 0);

    const totalShippingCost = scopedPurchases
      .reduce((sum, p) => sum + Number(p.shipping_cost_allocated || 0), 0);

    return {
      totalOrderSpending,
      totalShippingCost,
      orderCount,
      nonOrderSpending,
      averageOrderCost: orderCount > 0 ? totalOrderSpending / orderCount : 0
    };
  }

  function computeOrderPlacerStats(ordersList, days, startDate, endDate) {
    const filteredOrders = ordersList.filter(o => {
      const date = new Date(o.placed_at);
      if (customStartDate && customEndDate) {
        return date >= new Date(customStartDate) && date <= new Date(customEndDate);
      } else {
        const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
        return date >= cutoff;
      }

    });

    const stats = {};
    filteredOrders.forEach(o => {
      const placer = o.placed_by_email || 'Unknown';
      if (!stats[placer]) {
        stats[placer] = { count: 0, totalCost: 0, totalShipping: 0 };
      }
      stats[placer].count++;
      stats[placer].totalCost += (o.total_cost || 0);
      stats[placer].totalShipping += (o.shipping_cost || 0);
    });

    return Object.entries(stats).map(([placer, data]) => ({
      placer,
      count: data.count,
      totalCost: data.totalCost,
      totalShipping: data.totalShipping,
      totalSpent: data.totalCost + data.totalShipping
    })).sort((a, b) => b.totalSpent - a.totalSpent);
  }

  function filterByTimePeriod(purchases, days, startDate, endDate) {
    const now = new Date();
    let cutoff;
    
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      return purchases.filter(p => {
        const date = new Date(p.created_at);
        return date >= start && date <= end;
      });
    } else {
      cutoff = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
      return purchases.filter(p => {
        const date = new Date(p.created_at);
        return date >= cutoff;
      });
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

  async function resolveActorId() {
    let actorId = get(currentUser)?.id || getUserUUID();
    if (!actorId) {
      try {
        const { data } = await supabase.auth.getSession();
        actorId = data?.session?.user?.id || actorId;
      } catch (err) {
        console.warn('Failed to resolve actor id from session', err);
      }
    }
    return actorId;
  }

  async function performUserAction(targetId, action) {
    const actorId = await resolveActorId();
    if (!actorId) throw new Error('Unable to determine current user id; refresh and try again.');
    const auth = await getAuthHeader();

    const res = await fetch('/api/admin', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth },
      body: JSON.stringify({ actor_id: actorId, target_id: targetId, action })
    });

    if (!res.ok) {
      let body = {};
      try {
        body = await res.json();
      } catch {
        // ignore json parse errors
      }
      throw new Error(body.error || `Failed to ${action} user`);
    }
  }

  const currentUser = userStore;

  onMount(async () => {
    await loadUsers();
    await loadRosters();
    if (activeTab === 'purchasing') {
      await loadVendors();
      await loadPurchaseHistory();
    }
  });

  async function selectRoster(roster) {
    selectedRoster = roster;
    await Promise.all([loadRosterKeys(roster.id), loadRosterEntries(roster.id)]);
  }

  async function loadRosterKeys(rosterId) {
    try {
      const { data, error } = await supabase.from('roster_keys').select('*').eq('roster_id', rosterId).order('category').order('key_name');
      if (error) throw error;
      rosterKeys = data || [];
    } catch (err) {
      console.error('Failed to load roster keys', err);
    }
  }

  async function loadRosterEntries(rosterId) {
    try {
      const { data, error } = await supabase.from('roster_entries').select('*, user:user_id(id, full_name, email), key:key_id(key_name)').eq('roster_id', rosterId);
      if (error) throw error;
      rosterEntries = data || [];
    } catch (err) {
      console.error('Failed to load roster entries', err);
    }
  }

  async function createRoster() {
    if (!newRosterName) return;
    try {
      const { data, error } = await supabase.from('rosters').insert([{
        name: newRosterName,
        type: newRosterType,
        is_public: newRosterPublic,
        is_admin_editable: newRosterAdmin,
        created_by: await resolveActorId()
      }]).select().single();
      
      if (error) throw error;
      rosters = [...rosters, data];
      showCreateRosterModal = false;
      newRosterName = '';
      toastActions.show('Roster created');
    } catch (err) {
      console.error('Failed to create roster', err);
      toastActions.show('Failed to create roster');
    }
  }

  async function addKeyToRoster() {
    if (!selectedRoster || !newKeyName) return;
    try {
      const { data, error } = await supabase.from('roster_keys').insert([{
        roster_id: selectedRoster.id,
        key_name: newKeyName,
        category: newKeyCategory
      }]).select().single();
      
      if (error) throw error;
      rosterKeys = [...rosterKeys, data];
      newKeyName = '';
      toastActions.show('Key added');
    } catch (err) {
      console.error('Failed to add key', err);
      toastActions.show('Failed to add key');
    }
  }

  async function deleteRosterKey(key) {
    if (!selectedRoster) return;
    try {
      const { error } = await supabase.from('roster_keys').delete().eq('id', key.id);
      if (error) throw error;
      rosterKeys = rosterKeys.filter((k) => k.id !== key.id);
      rosterEntries = rosterEntries.filter((entry) => entry.key_id !== key.id);
      toastActions.show('Key removed');
    } catch (err) {
      console.error('Failed to remove key', err);
      toastActions.show('Failed to remove key');
    }
  }

  async function assignUserToRoster(user, key) {
    if (!selectedRoster) return;
    try {
      // If single select, remove existing entry for this user in this roster
      if (selectedRoster.type === 'single') {
        const existing = rosterEntries.find(e => e.user_id === user.id);
        if (existing) {
          await supabase.from('roster_entries').delete().eq('id', existing.id);
        }
      }

      const { data, error } = await supabase.from('roster_entries').insert([{
        roster_id: selectedRoster.id,
        user_id: user.id,
        key_id: key.id
      }]).select('*, user:user_id(id, full_name, email), key:key_id(key_name)').single();

      if (error) throw error;
      
      // Update local state
      if (selectedRoster.type === 'single') {
        rosterEntries = rosterEntries.filter(e => e.user_id !== user.id);
      }
      rosterEntries = [...rosterEntries, data];
      toastActions.show('User assigned');
    } catch (err) {
      console.error('Failed to assign user', err);
      toastActions.show('Failed to assign user');
    }
  }

  async function removeUserFromRoster(entryId) {
    try {
      const { error } = await supabase.from('roster_entries').delete().eq('id', entryId);
      if (error) throw error;
      rosterEntries = rosterEntries.filter(e => e.id !== entryId);
      toastActions.show('User removed');
    } catch (err) {
      console.error('Failed to remove user', err);
      toastActions.show('Failed to remove user');
    }
  }

  async function updateUserRoles(user, roles) {
    setSaving(user.id, true);
    const optimisticUsers = users.map((u) => (u.id === user.id ? { ...u, ...roles } : u));
    users = optimisticUsers;

    try {
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(await getAuthHeader()) },
        body: JSON.stringify({
          action: 'update-roles',
          actor_id: await resolveActorId(),
          target_id: user.id,
          ...roles
        })
      });
      if (!res.ok) throw new Error('Failed to update roles');

      let updatedUser = optimisticUsers.find((u) => u.id === user.id) || user;
      if (!isUserApproved(updatedUser)) {
        try {
          await performUserAction(updatedUser.id, 'approve');
          const withPermission = new Set(updatedUser.permissions || []);
          withPermission.add('CAN_SEE_ROUTES');
          updatedUser = { ...updatedUser, permissions: Array.from(withPermission) };
        } catch (approveErr) {
          console.warn('Auto approval failed', approveErr);
        }
      }

      users = optimisticUsers.map((u) => (u.id === updatedUser.id ? updatedUser : u));
      toastActions.show('Roles updated');
    } catch (err) {
      console.error('Failed to update roles', err);
      toastActions.show('Failed to update roles');
      await loadUsers();
    } finally {
      setSaving(user.id, false);
    }
  }

  async function loadVendors() {
    loadingVendors = true;
    try {
      const { data, error: err } = await supabase
        .from('vendors')
        .select('*')
        .order('name');
      if (err) throw err;
      vendors = data || [];
    } catch (err) {
      console.error('Failed to load vendors', err);
      toastActions.show('Failed to load vendors');
    } finally {
      loadingVendors = false;
    }
  }

  async function loadPurchaseHistory() {
    loadingPurchases = true;
    loadingOrders = true;
    try {
      const { data, error: err } = await supabase
        .from('purchasing')
        .select('*')
        .order('created_at', { ascending: false });
      if (err) throw err;
      purchaseHistory = data || [];

      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select('*')
        .order('placed_at', { ascending: false });
      if (ordersErr) throw ordersErr;

      const userIds = Array.from(new Set((ordersData || [])
        .map(o => o.placed_by)
        .filter(Boolean)));

      let userLookup = new Map();
      if (userIds.length) {
        const { data: profiles, error: profilesErr } = await supabase
          .from('user_profiles')
          .select('id, email, full_name')
          .in('id', userIds);
        if (profilesErr) throw profilesErr;
        userLookup = new Map((profiles || []).map(profile => [profile.id, profile]));
      }

      orders = (ordersData || []).map((order) => {
        const profile = order.placed_by ? userLookup.get(order.placed_by) : null;
        return {
          ...order,
          placed_by_email: profile?.email || 'Unknown',
          placed_by_name: profile?.full_name || null
        };
      });
    } catch (err) {
      console.error('Failed to load purchase history', err);
      toastActions.show('Failed to load purchase history');
    } finally {
      loadingPurchases = false;
      loadingOrders = false;
    }
  }

  async function openAddVendorModal() {
    vendorName = '';
    vendorUrlBase = '';
    vendorFreeShipping = false;
    showAddVendorModal = true;
  }

  async function openEditVendorModal(vendor) {
    editingVendor = vendor;
    vendorName = vendor.name;
    vendorUrlBase = vendor.url_base;
    vendorFreeShipping = vendor.free_shipping;
    showEditVendorModal = true;
  }

  async function saveVendor() {
    if (!vendorName || !vendorUrlBase) {
      toastActions.show('Vendor name and URL base are required');
      return;
    }

    try {
      const payload = {
        name: vendorName.trim(),
        url_base: vendorUrlBase.trim(),
        free_shipping: vendorFreeShipping
      };

      if (editingVendor) {
        const { error: err } = await supabase
          .from('vendors')
          .update(payload)
          .eq('id', editingVendor.id);
        if (err) throw err;
        toastActions.show('Vendor updated');
      } else {
        const { error: err } = await supabase
          .from('vendors')
          .insert([payload]);
        if (err) throw err;
        toastActions.show('Vendor added');
      }

      showAddVendorModal = false;
      showEditVendorModal = false;
      editingVendor = null;
      await loadVendors();
    } catch (err) {
      console.error('Failed to save vendor', err);
      toastActions.show('Failed to save vendor: ' + (err.message || String(err)));
    }
  }

  async function deleteVendor(vendor) {
    if (!confirm(`Delete vendor "${vendor.name}"? This cannot be undone.`)) return;

    try {
      const { error: err } = await supabase
        .from('vendors')
        .delete()
        .eq('id', vendor.id);
      if (err) throw err;
      toastActions.show('Vendor deleted');
      await loadVendors();
    } catch (err) {
      console.error('Failed to delete vendor', err);
      toastActions.show('Failed to delete vendor: ' + (err.message || String(err)));
    }
  }

  async function loadUsers() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/admin?action=list-users', {
        headers: { ...(await getAuthHeader()) }
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Failed to load users');
      users = body.data.map((u) => ({ ...u, permissions: Array.isArray(u.permissions) ? u.permissions : u.permissions ? [String(u.permissions)] : [] }));
      // Notify for users lacking CAN_SEE_ROUTES (needing approval). Avoid spamming: only first load.
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

  $: filteredRosters = rosters.filter((r) => r.name.toLowerCase().includes(rosterSearchQuery.toLowerCase()));
  $: filteredRosterMembers = users.filter((u) => (u.full_name || '').toLowerCase().includes(rosterMemberSearchQuery.toLowerCase()));
  $: pendingApprovals = users.filter((u) => !isUserApproved(u));
  $: hasActiveUserFilters = Boolean(
    userSearchQuery.trim() ||
    generalRoleFilter !== 'all' ||
    purchasingRoleFilter !== 'all' ||
    teamRoleFilter !== 'all' ||
    approvalFilter !== 'all'
  );

  $: accessFilteredUsers = users
    .filter((user) => {
      const searchTerm = userSearchQuery.trim().toLowerCase();
      const matchesSearch = !searchTerm ||
        (user.full_name || '').toLowerCase().includes(searchTerm) ||
        (user.email || '').toLowerCase().includes(searchTerm);
      if (!matchesSearch) return false;

      const userGeneralRole = user.general_role || defaultGeneralRole;
      const userPurchasingRole = user.purchasing_role || defaultPurchasingRole;
      const userTeamRole = user.team_role || defaultTeamRole;
      const approved = isUserApproved(user);

      if (generalRoleFilter !== 'all' && userGeneralRole !== generalRoleFilter) return false;
      if (purchasingRoleFilter !== 'all' && userPurchasingRole !== purchasingRoleFilter) return false;
      if (teamRoleFilter !== 'all' && userTeamRole !== teamRoleFilter) return false;
      if (approvalFilter === 'pending' && approved) return false;
      if (approvalFilter === 'approved' && !approved) return false;
      return true;
    })
    .sort((a, b) => {
      const approvedDiff = Number(isUserApproved(a)) - Number(isUserApproved(b));
      if (approvedDiff !== 0) return approvedDiff;
      const nameA = (a.full_name || a.email || '').toLowerCase();
      const nameB = (b.full_name || b.email || '').toLowerCase();
      return nameA.localeCompare(nameB);
    });

  function togglePermission(user, perm) {
    if (!user.permissions) user.permissions = [];
    if (user.permissions.includes(perm)) {
      user.permissions = user.permissions.filter((p) => p !== perm);
    } else {
      user.permissions = [...user.permissions, perm];
    }

    // If admin panel access is removed, strip elevated admin perms
    if (!user.permissions.includes('VIEW_ADMIN_PANEL')) {
      user.permissions = user.permissions.filter((p) => p !== 'BAN_USERS' && p !== 'APPROVE_USERS');
    }

    // force update
    users = users.slice();
  }
  async function saveUser(u) {
    // Persist user changes (permissions/role) to the server.
    error = null;
    const actor_id = await resolveActorId();
    if (!actor_id) {
      error = 'Unable to determine current user id; refresh and try again.';
      return;
    }

    try {
      const auth = await getAuthHeader();
      // Call server endpoint to save user details. Backend should accept this payload.
      const res = await fetch('/api/admin?action=save-user', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ actor_id, target_id: u.id, user: { role: u.role, permissions: u.permissions, full_name: u.full_name } })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || JSON.stringify(body));
      import('$lib/toast.js').then((m) => m.toastActions.show('User saved'));
      await loadUsers();
    } catch (err) {
      error = err.message || String(err);
      import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }

  // Actions for approve/ban/promote triggered by buttons in the table
  // Roster Management functions
  async function loadRosters() {
    loadingRosters = true;
    try {
      const { data, error } = await supabase.from('rosters').select('*').order('name');
      if (error) throw error;
      rosters = data || [];
    } catch (err) {
      console.error('Failed to load rosters', err);
      toastActions.show('Failed to load rosters');
    } finally {
      loadingRosters = false;
    }
  }

  async function setActiveTab(tab) {
    activeTab = tab;
    if (tab === 'purchasing') {
      if (vendors.length === 0) await loadVendors();
      if (purchaseHistory.length === 0) await loadPurchaseHistory();
    }
    if (tab === 'rosters' && rosters.length === 0) {
      await loadRosters();
    }
  }

  onMount(async () => {
    await loadUsers();
    await loadRosters();
  });


  $: {
    // Sync user list with permissions changes
    if (users.length > 0 && users[0].permissions) {
      const allPermissions = new Set();
      users.forEach(u => {
        if (Array.isArray(u.permissions)) {
          u.permissions.forEach(p => allPermissions.add(p));
        }
      });
      // Add default permissions for new users
      if (!allPermissions.has('CAN_SEE_ROUTES')) {
        users.forEach(u => {
          if (!u.permissions.includes('CAN_SEE_ROUTES')) {
            u.permissions.push('CAN_SEE_ROUTES');
          }
        });
      }
    }
  }
</script>

<svelte:head>
  <title>Admin Control Center</title>
</svelte:head>

<div class="container admin-page">
  <div class="page-header">
    <div>
      <h1>Admin Control Center</h1>
      <p class="text-muted">Manage permissions, curated rosters, and purchasing workflows from one cohesive surface.</p>
    </div>
    <div class="page-actions">
      {#if activeTab === 'access'}
        <button class="btn btn-secondary" on:click={loadUsers} disabled={loading}>Refresh Users</button>
      {:else if activeTab === 'rosters'}
        <button class="btn btn-secondary" on:click={loadRosters} disabled={loadingRosters}>Refresh Rosters</button>
      {:else if activeTab === 'purchasing'}
        <button class="btn btn-secondary" on:click={loadPurchaseHistory} disabled={loadingPurchases || loadingOrders}>Refresh Analytics</button>
      {/if}
    </div>
  </div>

  <nav class="tab-nav" role="tablist" aria-label="Admin sections">
    <button type="button" class:active={activeTab === 'access'} on:click={() => setActiveTab('access')}>
      Roles & Access
    </button>
    <button type="button" class:active={activeTab === 'rosters'} on:click={() => setActiveTab('rosters')}>
      Roster Studio
    </button>
    <button type="button" class:active={activeTab === 'purchasing'} on:click={() => setActiveTab('purchasing')}>
      Purchasing
    </button>
  </nav>

  {#if activeTab === 'access'}
    <section class="section-card">
      <div class="section-header">
        <div>
          <h3>Role Assignment</h3>
          <p>Pending approvals: {pendingApprovals.length}</p>
        </div>
        <div class="section-actions">
          <button class="btn btn-secondary" on:click={loadUsers} disabled={loading}>Reload</button>
        </div>
      </div>

      {#if loading}
        <div class="empty-state">Loading users…</div>
      {:else if error}
        <div class="empty-state">{error}</div>
      {:else if accessFilteredUsers.length === 0}
        <div class="empty-state">No users match your filters.</div>
      {:else}
        <div class="role-filters">
          <input
            class="form-input filter-input"
            type="text"
            placeholder="Search by name or email..."
            bind:value={userSearchQuery}
          />
          <select class="form-select filter-input" bind:value={generalRoleFilter} aria-label="Filter by general role">
            <option value="all">All General Roles</option>
            {#each generalRoleOptions as roleValue}
              <option value={roleValue}>{formatRoleLabel(roleValue)}</option>
            {/each}
          </select>
          <select class="form-select filter-input" bind:value={purchasingRoleFilter} aria-label="Filter by purchasing role">
            <option value="all">All Purchasing Roles</option>
            {#each purchasingRoleOptions as roleValue}
              <option value={roleValue}>{formatRoleLabel(roleValue)}</option>
            {/each}
          </select>
          <select class="form-select filter-input" bind:value={teamRoleFilter} aria-label="Filter by team role">
            <option value="all">All Team Roles</option>
            {#each teamRoleOptions as roleValue}
              <option value={roleValue}>{formatRoleLabel(roleValue)}</option>
            {/each}
          </select>
          <select class="form-select filter-input" bind:value={approvalFilter} aria-label="Filter by approval status">
            {#each approvalFilterOptions as option}
              <option value={option.value}>{option.label}</option>
            {/each}
          </select>
          {#if hasActiveUserFilters}
            <button type="button" class="btn btn-secondary btn-sm" on:click={resetUserFilters}>Clear Filters</button>
          {/if}
        </div>

        <div class="table-container">
          <table class="table admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Email</th>
                <th>General Role</th>
                <th>Purchasing Role</th>
                <th>Team Role</th>
              </tr>
            </thead>
            <tbody>
              {#each accessFilteredUsers as user (user.id)}
                <tr class:pending-row={!isUserApproved(user)}>
                  <td>
                    <div class="name-cell">
                      <strong>{user.full_name || 'No Name'}</strong>
                      {#if !isUserApproved(user)}
                        <span class="chip chip-pill chip-soft status-chip status-chip--pending">Pending approval</span>
                      {/if}
                    </div>
                  </td>
                  <td>
                    <div class="email-cell">
                      <span>{user.email || '—'}</span>
                      {#if savingRoleIds.has(user.id)}
                        <span class="saving-indicator">Saving…</span>
                      {/if}
                    </div>
                  </td>
                  <td>
                    <select
                      class="form-select role-select"
                      style={roleThemeStyle(generalRoleThemes[user.general_role || defaultGeneralRole])}
                      value={user.general_role || defaultGeneralRole}
                      disabled={savingRoleIds.has(user.id)}
                      aria-label={`General role for ${user.full_name || user.email}`}
                      on:change={(e) => updateUserRoles(user, { general_role: e.target.value })}
                    >
                      {#each generalRoleOptions as roleValue}
                        <option value={roleValue}>{formatRoleLabel(roleValue)}</option>
                      {/each}
                    </select>
                  </td>
                  <td>
                    <select
                      class="form-select role-select"
                      style={roleThemeStyle(purchasingRoleThemes[user.purchasing_role || defaultPurchasingRole])}
                      value={user.purchasing_role || defaultPurchasingRole}
                      disabled={savingRoleIds.has(user.id)}
                      aria-label={`Purchasing role for ${user.full_name || user.email}`}
                      on:change={(e) => updateUserRoles(user, { purchasing_role: e.target.value })}
                    >
                      {#each purchasingRoleOptions as roleValue}
                        <option value={roleValue}>{formatRoleLabel(roleValue)}</option>
                      {/each}
                    </select>
                  </td>
                  <td>
                    <select
                      class="form-select role-select"
                      style={roleThemeStyle(teamRoleThemes[user.team_role || defaultTeamRole])}
                      value={user.team_role || defaultTeamRole}
                      disabled={savingRoleIds.has(user.id)}
                      aria-label={`Team role for ${user.full_name || user.email}`}
                      on:change={(e) => updateUserRoles(user, { team_role: e.target.value })}
                    >
                      {#each teamRoleOptions as roleValue}
                        <option value={roleValue}>{formatRoleLabel(roleValue)}</option>
                      {/each}
                    </select>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="section-card">
      <div class="section-header">
        <div>
          <h3>Manufacturing Portal</h3>
          <p>The manufacturing portal lives in its own tab so approvals stay cleanly separated.</p>
        </div>
        <div class="section-actions">
          <a class="btn btn-secondary" href="/manufacture/portal" target="_blank" rel="noreferrer">
            Open Portal
          </a>
        </div>
      </div>
      <div class="grid-3">
        <div class="stat-card">
          <Package size={20} />
          <div>
            <div class="text-muted">Key Roles</div>
            <strong>Subsystem & Manufacturing Leads</strong>
          </div>
        </div>
        <div class="stat-card">
          <TrendingUp size={20} />
          <div>
            <div class="text-muted">Leaderboard</div>
            <strong>Highlights recent completions</strong>
          </div>
        </div>
        <div class="stat-card">
          <User size={20} />
          <div>
            <div class="text-muted">Roster Source</div>
            <strong>Manufacturing Roles roster</strong>
          </div>
        </div>
      </div>
      <p class="text-muted">Use the Roster Studio tab to curate Manufacturing Roles, then assign parts directly inside the portal.</p>
    </section>
  {:else if activeTab === 'rosters'}
    <section class="section-card">
      <div class="section-header">
        <div>
          <h3>Roster Studio</h3>
          <p>Drag roster keys onto members to organize scouting, manufacturing, or leadership duties.</p>
        </div>
        <div class="section-actions">
          <button class="btn btn-primary" on:click={() => showCreateRosterModal = true}>
            <Plus size={16} /> New Roster
          </button>
        </div>
      </div>

      <div class="roster-selector-block">
        <div class="selector-heading">
          <div>
            <strong>Rosters</strong>
            <p class="text-muted">Pick a roster to edit.</p>
          </div>
        </div>
        <input class="form-input" type="text" placeholder="Search rosters..." bind:value={rosterSearchQuery} />
        {#if loadingRosters}
          <div class="empty-state">Loading rosters…</div>
        {:else if filteredRosters.length === 0}
          <div class="empty-state">No rosters match.</div>
        {:else}
          <div class="roster-pill-row">
            {#each filteredRosters as roster}
              <button
                type="button"
                class="roster-pill {selectedRoster?.id === roster.id ? 'active' : ''}"
                on:click={() => selectRoster(roster)}
              >
                <span>{roster.name}</span>
                <small>{roster.type === 'single' ? 'Single' : 'Multi'}</small>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      {#if selectedRoster}
        <div class="roster-main">
          <div class="panel roster-meta">
            <div class="panel-header">
              <div>
                <strong>{selectedRoster.name}</strong>
                <div class="badge-row">
                  <span class="badge-soft">{selectedRoster.is_public ? 'Public' : 'Private'}</span>
                  <span class="badge-soft">{selectedRoster.is_admin_editable ? 'Admin only' : 'Open edit'}</span>
                  <span class="badge-soft">{selectedRoster.type === 'single' ? 'Single select' : 'Multi select'}</span>
                </div>
              </div>
            </div>
          </div>

          <div class="roster-workspace">
            <div class="keys-column">
              <div class="list-card sticky-card">
                <div class="section-header">
                  <div>
                    <h4>Keys</h4>
                    <p>Drag a key onto a member.</p>
                  </div>
                </div>
                <div class="add-key-form">
                  <input class="form-input" type="text" placeholder="Key name" bind:value={newKeyName} />
                  <input class="form-input" type="text" placeholder="Category" bind:value={newKeyCategory} />
                  <button class="btn btn-secondary" on:click={addKeyToRoster}>Add</button>
                </div>
                <div class="list-card__items">
                  {#if rosterKeys.length === 0}
                    <div class="empty-state">No keys defined yet.</div>
                  {:else}
                    {#each rosterKeys as key}
                      <div
                        class="list-row key-row"
                        draggable="true"
                        on:dragstart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify(key))}
                      >
                        <div>
                          <strong>{key.key_name}</strong>
                          <div class="text-muted">{key.category || 'Uncategorized'}</div>
                        </div>
                        <button class="btn btn-sm btn-danger" on:click={() => deleteRosterKey(key)}>Remove</button>
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>

            <div class="members-column">
              <div class="list-card">
                <div class="section-header">
                  <div>
                    <h4>Members</h4>
                    <p>Drop a key to assign responsibilities.</p>
                  </div>
                </div>
                <input class="form-input" type="text" placeholder="Search members..." bind:value={rosterMemberSearchQuery} />
                <div class="list-card__items member-list">
                  {#if filteredRosterMembers.length === 0}
                    <div class="empty-state">No members found.</div>
                  {:else}
                    {#each filteredRosterMembers as user}
                      <div
                        class="list-row member-row member-row--compact"
                        on:dragover={(e) => e.preventDefault()}
                        on:drop={async (e) => {
                          e.preventDefault();
                          const key = JSON.parse(e.dataTransfer.getData('text/plain'));
                          await assignUserToRoster(user, key);
                        }}
                      >
                        <div>
                          <strong>{user.full_name}</strong>
                          <div class="member-keys">
                            {#each rosterEntries.filter((entry) => entry.user_id === user.id) as entry}
                              <span class="chip chip-compact">
                                {entry.key.key_name}
                                <button class="chip-remove" on:click={() => removeUserFromRoster(entry.id)} aria-label={`Remove ${entry.key.key_name}`}>
                                  ×
                                </button>
                              </span>
                            {/each}
                          </div>
                        </div>
                        {#if selectedRoster.type === 'single'}
                          <select
                            class="form-select"
                            on:change={(e) => {
                              const key = rosterKeys.find((k) => k.id === e.target.value);
                              if (key) assignUserToRoster(user, key);
                            }}
                          >
                            <option value="">Select key</option>
                            {#each rosterKeys as key}
                              <option value={key.id} selected={!!rosterEntries.find((entry) => entry.user_id === user.id && entry.key_id === key.id)}>
                                {key.key_name}
                              </option>
                            {/each}
                          </select>
                        {/if}
                      </div>
                    {/each}
                  {/if}
                </div>
              </div>
            </div>
          </div>
        </div>
      {:else}
        <div class="panel roster-empty">
          <div class="panel-body">
            <div class="empty-state">Select a roster to begin editing.</div>
          </div>
        </div>
      {/if}
    </section>
  {:else if activeTab === 'purchasing'}
    <section class="section-card">
      <div class="section-header">
        <div>
          <h3>Vendor Directory</h3>
          <p>Keep the approved vendor list tidy and consistent.</p>
        </div>
        <div class="section-actions">
          <button class="btn btn-primary" on:click={openAddVendorModal}>
            <Plus size={16} /> Add Vendor
          </button>
        </div>
      </div>

      {#if loadingVendors}
        <div class="empty-state">Loading vendors…</div>
      {:else}
        <div class="table-container">
          <table class="table admin-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>URL Base</th>
                <th>Free Shipping</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {#each vendors as vendor}
                <tr>
                  <td>{vendor.name}</td>
                  <td>{vendor.url_base}</td>
                  <td>{vendor.free_shipping ? 'Yes' : 'No'}</td>
                  <td>
                    <div class="section-actions">
                      <button class="btn btn-sm btn-secondary" on:click={() => openEditVendorModal(vendor)}>
                        <Edit size={14} /> Edit
                      </button>
                      <button class="btn btn-sm btn-danger" on:click={() => deleteVendor(vendor)}>
                        <Trash2 size={14} /> Delete
                      </button>
                    </div>
                  </td>
                </tr>
              {/each}
              {#if vendors.length === 0}
                <tr>
                  <td colspan="4" style="text-align: center;" class="text-muted">No vendors added yet.</td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      {/if}
    </section>

    <section class="section-card">
      <div class="section-header">
        <div>
          <h3>Purchasing Analytics</h3>
          <p>Filter trends by rolling window or custom dates.</p>
        </div>
      </div>

      <div class="grid-3">
        <div class="form-group">
          <label class="form-label">Time Period</label>
          <select class="form-select" bind:value={timePeriodDays} on:change={() => { customStartDate = ''; customEndDate = ''; }}>
            <option value={7}>Last 7 days</option>
            <option value={30}>Last 30 days</option>
            <option value={90}>Last 90 days</option>
            <option value={365}>Last year</option>
          </select>
        </div>
        <div class="form-group">
          <label class="form-label">Custom Start Date</label>
          <input type="date" class="form-input" bind:value={customStartDate} />
        </div>
        <div class="form-group">
          <label class="form-label">Custom End Date</label>
          <input type="date" class="form-input" bind:value={customEndDate} />
        </div>
      </div>

      {#if loadingPurchases}
        <div class="empty-state">Loading purchase data…</div>
      {:else}
        <div class="total-spending-card">
          <div class="total-spending-content">
            <div class="total-spending-icon">
              <TrendingUp size={32} />
            </div>
            <div class="total-spending-details">
              <div class="total-spending-label">Total Spending</div>
              <div class="total-spending-amount">${totalSpending.total.toFixed(2)}</div>
              <div class="total-spending-items">{totalSpending.count} items</div>
            </div>
          </div>
        </div>

        <div class="analytics-grid">
          <div class="analytics-card">
            <h4><DollarSign size={20} /> Spending by Approver</h4>
            <div class="analytics-table">
              <table class="table">
                <thead>
                  <tr>
                    <th>Approver</th>
                    <th>Items</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {#each approverStats as stat}
                    <tr>
                      <td>{stat.approver}</td>
                      <td>{stat.count}</td>
                      <td>${stat.total.toFixed(2)}</td>
                    </tr>
                  {/each}
                  {#if approverStats.length === 0}
                    <tr>
                      <td colspan="3" class="text-muted" style="text-align: center;">No data</td>
                    </tr>
                  {/if}
                </tbody>
              </table>
            </div>
          </div>

          <div class="analytics-card">
            <h4><Package size={20} /> Spending by Orderer</h4>
            <div class="analytics-table">
              <table class="table">
                <thead>
                  <tr>
                    <th>Orderer</th>
                    <th>Items</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {#each ordererStats as stat}
                    <tr>
                      <td>{stat.orderer}</td>
                      <td>{stat.count}</td>
                      <td>${stat.total.toFixed(2)}</td>
                    </tr>
                  {/each}
                  {#if ordererStats.length === 0}
                    <tr>
                      <td colspan="3" class="text-muted" style="text-align: center;">No data</td>
                    </tr>
                  {/if}
                </tbody>
              </table>
            </div>
          </div>

          <div class="analytics-card">
            <h4><Package size={20} /> Spending by Project</h4>
            <div class="analytics-table">
              <table class="table">
                <thead>
                  <tr>
                    <th>Project ID</th>
                    <th>Items</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {#each projectStats as stat}
                    <tr>
                      <td>{stat.project_id}</td>
                      <td>{stat.count}</td>
                      <td>${stat.total.toFixed(2)}</td>
                    </tr>
                  {/each}
                  {#if projectStats.length === 0}
                    <tr>
                      <td colspan="3" class="text-muted" style="text-align: center;">No data</td>
                    </tr>
                  {/if}
                </tbody>
              </table>
            </div>
          </div>

          <div class="analytics-card">
            <h4><ShoppingCart size={20} /> Spending by Vendor</h4>
            <div class="analytics-table">
              <table class="table">
                <thead>
                  <tr>
                    <th>Vendor</th>
                    <th>Items</th>
                    <th>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {#each vendorStats as stat}
                    <tr>
                      <td>{stat.vendor}</td>
                      <td>{stat.count}</td>
                      <td>${stat.total.toFixed(2)}</td>
                    </tr>
                  {/each}
                  {#if vendorStats.length === 0}
                    <tr>
                      <td colspan="3" class="text-muted" style="text-align: center;">No data</td>
                    </tr>
                  {/if}
                </tbody>
              </table>
            </div>
          </div>

          <div class="analytics-card">
            <h4><Package size={20} /> Order Summary</h4>
            <div class="analytics-table">
              <table class="table">
                <tbody>
                  <tr>
                    <td><strong>Total Orders</strong></td>
                    <td>{orderStats.orderCount}</td>
                  </tr>
                  <tr>
                    <td><strong>Order Spending</strong></td>
                    <td>${orderStats.totalOrderSpending.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td><strong>Shipping Costs</strong></td>
                    <td>${orderStats.totalShippingCost.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td><strong>Non-Order Spending</strong></td>
                    <td>${orderStats.nonOrderSpending.toFixed(2)}</td>
                  </tr>
                  <tr>
                    <td><strong>Avg Order Cost</strong></td>
                    <td>${orderStats.averageOrderCost.toFixed(2)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      {/if}
    </section>
  {/if}
</div>

<!-- Add Vendor Modal -->
{#if showAddVendorModal}
  <div class="modal-overlay" on:click={() => showAddVendorModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Add Vendor</h3>
      <div class="form-group">
        <label class="form-label">Vendor Name</label>
        <input type="text" class="form-input" bind:value={vendorName} placeholder="e.g., McMaster-Carr" />
      </div>
      <div class="form-group">
        <label class="form-label">URL Base</label>
        <input type="text" class="form-input" bind:value={vendorUrlBase} placeholder="e.g., mcmaster.com" />
      </div>
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" bind:checked={vendorFreeShipping} />
          <span>Free Shipping</span>
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" on:click={() => showAddVendorModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={saveVendor}>Add Vendor</button>
      </div>
    </div>
  </div>
{/if}

<!-- Edit Vendor Modal -->
{#if showEditVendorModal}
  <div class="modal-overlay" on:click={() => showEditVendorModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Edit Vendor</h3>
      <div class="form-group">
        <label class="form-label">Vendor Name</label>
        <input type="text" class="form-input" bind:value={vendorName} />
      </div>
      <div class="form-group">
        <label class="form-label">URL Base</label>
        <input type="text" class="form-input" bind:value={vendorUrlBase} />
      </div>
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" bind:checked={vendorFreeShipping} />
          <span>Free Shipping</span>
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" on:click={() => { showEditVendorModal = false; editingVendor = null; }}>Cancel</button>
        <button class="btn btn-primary" on:click={saveVendor}>Save Changes</button>
      </div>
    </div>
  </div>
{/if}

<!-- Create Roster Modal -->
{#if showCreateRosterModal}
  <div class="modal-overlay" on:click={() => showCreateRosterModal = false}>
    <div class="modal" on:click|stopPropagation>
      <h3>Create Roster</h3>
      <div class="form-group">
        <label class="form-label">Roster Name</label>
        <input type="text" class="form-input" bind:value={newRosterName} placeholder="e.g., Engineering Team" />
      </div>
      <div class="form-group">
        <label class="form-label">Roster Type</label>
        <select class="form-select" bind:value={newRosterType}>
          <option value="multi">Multi-Select</option>
          <option value="single">Single-Select</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" bind:checked={newRosterPublic} />
          <span>Public Roster</span>
        </label>
      </div>
      <div class="form-group">
        <label class="form-checkbox">
          <input type="checkbox" bind:checked={newRosterAdmin} />
          <span>Admin Only</span>
        </label>
      </div>
      <div class="modal-actions">
        <button class="btn btn-secondary" on:click={() => showCreateRosterModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={createRoster}>Create Roster</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .error { color: var(--danger); font-weight: 600; }
  .admin-table td:nth-child(2) { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  .role-filters {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    margin-bottom: 0.75rem;
    align-items: center;
  }

  .filter-input {
    flex: 1 1 160px;
    min-width: 160px;
  }

  .role-select {
    border-color: var(--role-border, var(--border));
    background: var(--role-bg, var(--primary));
    color: var(--role-text, var(--text));
    font-weight: 600;
    transition: border-color 0.2s ease, background 0.2s ease;
  }

  .role-select:disabled {
    opacity: 0.7;
    cursor: progress;
  }

  .role-select option {
    color: var(--text);
    background: var(--primary);
    font-weight: 500;
  }

  .pending-row {
    background: #fffaf0;
  }

  .name-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .email-cell {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.95rem;
  }

  .status-chip {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-size: 0.75rem;
  }

  .status-chip--pending {
    background: #fef3c7;
    color: #92400e;
    border-color: #fde68a;
  }

  .roster-selector-block {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 1rem 1.25rem;
    background: var(--surface-1);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    box-shadow: var(--shadow-sm);
  }

  .roster-pill-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
    max-height: 240px;
    overflow-y: auto;
  }

  .roster-main {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin-top: 1rem;
  }

  .roster-workspace {
    display: grid;
    grid-template-columns: minmax(220px, 300px) 1fr;
    gap: 1.25rem;
    align-items: flex-start;
  }

  .keys-column .sticky-card {
    position: sticky;
    top: 1rem;
    max-height: calc(100vh - 140px);
    overflow: hidden;
  }

  .keys-column .sticky-card .list-card__items {
    max-height: calc(100vh - 320px);
  }

  .members-column .list-card__items {
    max-height: calc(100vh - 320px);
    overscroll-behavior: contain;
    overflow-y: auto;
  }

  .member-list {
    max-height: calc(100vh - 220px);
    overflow-y: auto;
    padding-right: 0.35rem;
    overscroll-behavior: contain;
  }

  .member-row--compact {
    padding: 0.4rem 0.5rem;
    gap: 0.45rem;
    align-items: flex-start;
  }

  .member-row--compact strong {
    font-size: 0.9rem;
  }

  .chip-compact {
    padding: 0.1rem 0.45rem;
    font-size: 0.7rem;
  }

  .saving-indicator {
    font-size: 0.75rem;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.08em;
  }

  @media (max-width: 900px) {
    .admin-table td:nth-child(2) {
      max-width: unset;
      white-space: normal;
    }

    .roster-workspace {
      grid-template-columns: 1fr;
    }

    .keys-column .sticky-card {
      position: static;
      max-height: none;
    }
  }
</style>
