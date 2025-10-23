<script>
  import { onMount } from 'svelte';
  import { userStore, getUserUUID } from '$lib/stores/user.js';
  import { PERMISSIONS, hasPermission } from '$lib/permissions.js';
  import { supabase } from '$lib/supabase.js';
  import { get } from 'svelte/store';
  import { ShoppingCart, DollarSign, TrendingUp, Package, Plus, Edit, Trash2, User } from 'lucide-svelte';
  import { toastActions } from '$lib/toast.js';
  const BOT_BASE_URL = import.meta.env?.VITE_BOT_BASE_URL || '/api/971bot';

  // Tab management
  let activeTab = 'permissions'; // 'permissions' or 'purchasing'
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
  // Feature toggle to enable/disable ban button across the UI
  const enableBan = false;

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
    const totalShippingCost = filteredOrders.reduce((sum, o) => sum + (o.shipping_cost || 0), 0);
    const orderCount = filteredOrders.length;

    // Calculate spending on non-order items (approved but not in an order)
    const filteredPurchases = filterByTimePeriod(purchases, days, customStartDate, customEndDate);
    const nonOrderSpending = filteredPurchases
      .filter(p => !p.order_id && (p.status === 'approved' || p.status === 'ordered' || p.status === 'delivered' || p.status === 'kitted'))
      .reduce((sum, p) => sum + (p.final_price || p.price || 0) * (p.quantity || 1), 0);

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

  const currentUser = userStore;

  onMount(async () => {
    await loadUsers();
    if (activeTab === 'purchasing') {
      await loadVendors();
      await loadPurchaseHistory();
    }
  });

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

      // Load orders with placed_by user email
      const { data: ordersData, error: ordersErr } = await supabase
        .from('orders')
        .select(`
          *,
          placed_by_email:placed_by(email)
        `)
        .order('placed_at', { ascending: false });
      
      if (ordersErr) throw ordersErr;
      orders = (ordersData || []).map(o => ({
        ...o,
        placed_by_email: o.placed_by_email?.email || 'Unknown'
      }));
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
    // derive actor id
    let actor_id = get(currentUser)?.id || getUserUUID();
    if (!actor_id) {
      try {
        const { data } = await supabase.auth.getSession();
        actor_id = data?.session?.user?.id || actor_id;
      } catch (e) {
        console.warn('Failed to read session for actor id', e);
      }
    }
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
  async function doAction(u, act) {
    error = null;
    // derive actor id
    let actor_id = get(currentUser)?.id || getUserUUID();
    if (!actor_id) {
      try {
        const { data } = await supabase.auth.getSession();
        actor_id = data?.session?.user?.id || actor_id;
      } catch (e) {
        console.warn('Failed to read session for actor id', e);
      }
    }
    if (!actor_id) {
      error = 'Unable to determine current user id; refresh and try again.';
      return;
    }

    if (act === 'promote') {
      import('$lib/toast.js').then((m) => m.toastActions.show('Promote feature is disabled'));
      return;
    }

    try {
      const auth = await getAuthHeader();
      const res = await fetch('/api/admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...auth },
        body: JSON.stringify({ actor_id, target_id: u.id, action: act })
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || JSON.stringify(body));
      const msg = act === 'ban' ? 'User banned' : act === 'approve' ? 'User approved' : 'Action complete';
      import('$lib/toast.js').then((m) => m.toastActions.show(msg));
      await loadUsers();
    } catch (err) {
      error = err.message || String(err);
      import('$lib/toast.js').then((m) => m.toastActions.show(error));
    }
  }
</script>

<h2>Admin Panel</h2>

<div class="tabs">
  <button 
    class="tab-button {activeTab === 'permissions' ? 'active' : ''}"
    on:click={() => { activeTab = 'permissions'; }}
  >
    Permissions
  </button>
  <button 
    class="tab-button {activeTab === 'purchasing' ? 'active' : ''}"
    on:click={async () => { 
      activeTab = 'purchasing'; 
      if (vendors.length === 0) await loadVendors();
      if (purchaseHistory.length === 0) await loadPurchaseHistory();
    }}
  >
    Purchasing
  </button>
</div>

{#if activeTab === 'permissions'}
  <div class="tab-content">
    {#if loading}
      <p>Loading users…</p>
    {:else}
      {#if error}
        <p class="error">{error}</p>
      {/if}

      <div class="table-container">
        <table class="table admin-table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
            <th>Permissions</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
      {#each users as u}
            <tr>
              <td>{u.full_name || u.id}</td>
              <td>{u.email}</td>
              <td>{u.role}</td>
              <td>
                <div class="perms">
                  {#each PERMISSIONS as p}
                    {#if p === 'CAN_SEE_ROUTES' || (u.permissions.includes('CAN_SEE_ROUTES') && ((p !== 'BAN_USERS' && p !== 'APPROVE_USERS') || u.permissions.includes('VIEW_ADMIN_PANEL')))}
                      <label class="perm">
                        <input type="checkbox" checked={u.permissions.includes(p)} on:change={() => togglePermission(u, p)} />
                        <span>{p}</span>
                      </label>
                    {/if}
                  {/each}
                </div>
              </td>
                <td>
                <button class="btn btn-secondary" on:click={() => saveUser(u)}>Save</button>
                <!-- Promote feature removed from UI. Short-circuited in doAction as well. -->
                {#if (!u.permissions || !u.permissions.includes('CAN_SEE_ROUTES')) && (hasPermission(get(currentUser), 'APPROVE_USERS') || get(currentUser)?.role === 'admin')}
                  <button class="btn btn-secondary" on:click={() => doAction(u, 'approve')}>Approve</button>
                {/if}
                {#if enableBan && (hasPermission(get(currentUser), 'BAN_USERS') || get(currentUser)?.role === 'admin')}
                  <button class="btn btn-danger" on:click={() => doAction(u, 'ban')}>Ban</button>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
      </div>
    {/if}
  </div>
{:else if activeTab === 'purchasing'}
  <div class="tab-content">
    <div class="purchasing-section">
      <h3>Vendor Management</h3>
      <button class="btn btn-primary" on:click={openAddVendorModal}>
        <Plus size={16} /> Add Vendor
      </button>

      {#if loadingVendors}
        <p>Loading vendors...</p>
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
                    <button class="btn btn-sm btn-secondary" on:click={() => openEditVendorModal(vendor)}>
                      <Edit size={14} /> Edit
                    </button>
                    <button class="btn btn-sm btn-danger" on:click={() => deleteVendor(vendor)}>
                      <Trash2 size={14} /> Delete
                    </button>
                  </td>
                </tr>
              {/each}
              {#if vendors.length === 0}
                <tr>
                  <td colspan="4" style="text-align: center; color: var(--text-secondary);">No vendors added yet</td>
                </tr>
              {/if}
            </tbody>
          </table>
        </div>
      {/if}
    </div>

    <div class="purchasing-section">
      <h3>Purchase Analytics</h3>
      
      <div class="analytics-filters">
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
        <p>Loading purchase data...</p>
      {:else}
        <!-- Total Spending Summary -->
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
                      <td colspan="3" style="text-align: center; color: var(--text-secondary);">No data</td>
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
                      <td colspan="3" style="text-align: center; color: var(--text-secondary);">No data</td>
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
                      <td colspan="3" style="text-align: center; color: var(--text-secondary);">No data</td>
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
                      <td colspan="3" style="text-align: center; color: var(--text-secondary);">No data</td>
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

          <!-- Spending by Order Placer removed to simplify analytics -->
        </div>
      {/if}
    </div>
  </div>
{/if}

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

<style>
  .tabs {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1.5rem;
    border-bottom: 2px solid var(--border);
  }

  .tab-button {
    padding: 0.75rem 1.5rem;
    background: transparent;
    border: none;
    border-bottom: 3px solid transparent;
    cursor: pointer;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    transition: all 0.2s;
  }

  .tab-button:hover {
    color: var(--secondary);
    background: rgba(255, 193, 7, 0.1);
  }

  .tab-button.active {
    color: var(--secondary);
    border-bottom-color: var(--secondary);
  }

  .tab-content {
    padding: 1rem 0;
  }

  .purchasing-section {
    margin-bottom: 2rem;
    padding: 1.5rem;
    background: var(--primary);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .purchasing-section h3 {
    margin-top: 0;
    margin-bottom: 1rem;
    color: var(--text);
  }

  .total-spending-card {
    margin-bottom: 2rem;
    padding: 1.25rem 1.5rem;
    background: var(--card-bg);
    border: 1px solid var(--border);
    border-radius: 8px;
  }

  .total-spending-content {
    display: flex;
    align-items: center;
    gap: 1.5rem;
  }

  .total-spending-icon {
    border: 1px solid var(--border);
    border-radius: 50%;
    padding: 0.5rem;
    display: flex;
    align-items: center;
    justify-content: center;
    color: var(--text);
  }

  .total-spending-details {
    flex: 1;
  }

  .total-spending-label {
    font-size: 0.9rem;
    font-weight: 600;
    color: var(--text);
    opacity: 0.9;
    text-transform: none;
    letter-spacing: 0;
  }

  .total-spending-amount {
    font-size: 2rem;
    font-weight: 700;
    color: var(--text);
    line-height: 1.2;
    margin: 0.25rem 0;
  }

  .total-spending-items {
    font-size: 0.95rem;
    color: var(--text-secondary);
  }

  .analytics-filters {
    display: flex;
    gap: 1rem;
    margin-bottom: 1.5rem;
    flex-wrap: wrap;
  }

  .analytics-filters .form-group {
    flex: 1;
    min-width: 200px;
  }

  .analytics-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1.5rem;
  }

  .analytics-card {
    padding: 1.5rem;
    background: var(--primary);
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .analytics-card h4 {
    margin: 0 0 1rem 0;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    color: var(--text);
    font-size: 1.1rem;
  }

  .analytics-table {
    max-height: 400px;
    overflow-y: auto;
    border-radius: 4px;
  }

  .analytics-table table {
    font-size: 0.9rem;
    width: 100%;
  }

  .analytics-table thead th {
    position: sticky;
    top: 0;
    background: var(--primary);
    z-index: 1;
    padding: 0.75rem 0.5rem;
    font-weight: 600;
  }

  .analytics-table tbody td {
    padding: 0.75rem 0.5rem;
  }

  .analytics-table tbody tr:hover {
    background: rgba(255, 193, 7, 0.05);
  }

  .modal-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
  }

  .modal {
    background: var(--primary);
    padding: 2rem;
    border-radius: 12px;
    max-width: 500px;
    width: 90%;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    border: 1px solid var(--border);
  }

  .modal h3 {
    margin-top: 0;
    color: var(--text);
  }

  .modal-actions {
    display: flex;
    gap: 0.75rem;
    justify-content: flex-end;
    margin-top: 1.5rem;
  }

  .form-checkbox {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    cursor: pointer;
  }

  .form-checkbox input[type="checkbox"] {
    width: 18px;
    height: 18px;
    cursor: pointer;
  }

  .btn-sm {
    padding: 0.35rem 0.75rem;
    font-size: 0.85rem;
  }
  
  /* Make admin table use global table tokens and card container */
  .admin-table { width: 100%; border-collapse: collapse; }
  .admin-table th, .admin-table td { padding: 0.6rem; border-bottom: 1px solid var(--border); text-align: left; }
  .perms { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .perm { display: inline-flex; align-items: center; gap: 0.4rem; background: var(--primary); border: 1px solid var(--border); padding: 0.25rem 0.5rem; border-radius: 6px; font-size: 0.85rem; }
  .perm input { width: 14px; height: 14px; }
  .perm span { font-weight: 600; color: var(--secondary); font-size: 0.78rem; }
  .error { color: var(--danger); font-weight: 600; }

  /* Make action buttons align and smaller inside table */
  td > .btn { margin-right: 0.35rem; font-size: 0.85rem; }

  /* Slightly narrow email column for better layout */
  .admin-table td:nth-child(2) { max-width: 220px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

  /* Subnav to reach Gantt subroute */
  .subnav { margin: 0.5rem 0 1rem; }
  .subnav .btn { font-size: 0.9rem; }

  /* Spacing between Add Vendor button and table */
  .purchasing-section > .btn { margin-bottom: 0.75rem; }
</style>
