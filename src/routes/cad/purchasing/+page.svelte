<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { hasPermission } from '$lib/permissions.js';
  import { isTeam9584 } from '$lib/frcTeams.js';
  import { ShoppingCart, Package, DollarSign, Truck, CheckCircle, Clock, AlertTriangle, Edit, MapPin, Download, Settings, X, Link as LinkIcon } from 'lucide-svelte';
  import { toastActions } from '$lib/toast.js';
  import { goto } from '$app/navigation';
  // Base URL for the Slack bot service (971bot). Defaults to the in-app endpoint.
  // Optionally expose via a public env var and import from $env/static/public
  const BOT_BASE_URL = import.meta.env?.VITE_BOT_BASE_URL || '/api/971bot';
  async function notifyPurchaseBot(payload) {
    try {
      const res = await fetch(`${BOT_BASE_URL}/notify/purchase`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      if (!res.ok) {
        console.warn('Bot notify failed', await res.text());
      }
    } catch (e) {
      console.warn('Bot notify error', e);
    }
  }

  let user = null;
  let loading = true;
  let parts = [];
  // Filters
  let vendorFilter = '';
  let projectFilter = '';
  let statusFilter = '';

  // Derived options and filtered view
  $: vendorOptions = Array.from(new Set(parts.map(p => (p.vendor || '').toString()).filter(v => v && v !== '') ))
    .map(v => v);
  $: projectOptions = Array.from(new Set(parts.map(p => (p.project_id || '').toString()).filter(v => v && v !== '')))
    .map(v => v);
  $: filteredParts = parts.filter(p => {
    // Hide rejected items unless the current user is the rejector or the requester/purchaser.
    // Compare robustly by normalizing text and also allow purchaser UUID match when available.
    if ((p.status || '').toString().toLowerCase() === 'rejected') {
      const currentUserName = (user?.full_name || user?.email || '').toString().toLowerCase().trim();
      const approverName = (p.approver || '').toString().toLowerCase().trim();
      const requesterName = (p.requester || '').toString().toLowerCase().trim();
      const isRejector = currentUserName && approverName && currentUserName === approverName;
      const isRequesterByName = currentUserName && requesterName && currentUserName === requesterName;
      const isRequesterById = !!(user?.id && p.purchaser && user.id === p.purchaser);
      if (!isRejector && !isRequesterByName && !isRequesterById) return false;
    }
    
    if (vendorFilter && vendorFilter !== '') {
      const pv = (p.vendor || '').toString().toLowerCase();
      if (pv !== vendorFilter.toString().toLowerCase()) return false;
    }
    if (projectFilter && projectFilter !== '') {
      const pp = (p.project_id || '').toString();
      if (pp !== projectFilter.toString()) return false;
    }
    if (statusFilter && statusFilter !== '') {
      const ps = (p.status || 'pending').toString().toLowerCase();
      if (ps !== statusFilter.toString().toLowerCase()) return false;
    }
    return true;
  });
  let showKittingModal = false;
  let selectedPart = null;
  let showLinkModal = false;
  let linkModalPart = null;
  let linkModalUrl = '';
  let linkModalPrice = '';
  // Add misc-item modal state
  let showAddMiscModal = false;
  let miscUrl = '';
  let miscPrice = '';
  let miscQuantity = 1;
  let miscVendor = 'Other'; // Selected vendor
  // Item name (separate from project)
  let miscProjectText = '';
  // Project selection/linking to a build
  let buildOptions = []; // { id, label }
  let miscProject = ''; // typed or selected project label/id to store in project_id
  let miscNotes = '';
  // Edit modal state
  let showEditModal = false;
  let editPart = null;
  let editName = '';
  let editVendor = '';
  let editProjectId = '';
  let editUrl = '';
  let editPrice = '';
  let editQuantity = 1;
  let editKittingBin = '';
  let editNotes = '';
  let saving = false;
  let showNotesModal = false;
  let notesModalPart = null;
  async function sendNotification(type, payload = {}) {
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      await fetch('/api/notifications', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token ? { authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({ type, ...payload })
      });
    } catch (err) {
      console.warn('Notification request failed', err);
    }
  }

  // Vendor management
  let vendors = [];
  let vendorDropdownOptions = [];
  $: vendorDropdownOptions = ['Other', ...vendors.map(v => v.name)];

  // Order creation mode
  let orderMode = false;
  let selectedItems = new Set();
  let selectedVendor = null;
  let showOrderModal = false;
  let orderTotal = 0;
  let orderDeliveryDate = ''; // iso date string YYYY-MM-DD when user picks a date
  let orderDeliveryInDays = ''; // if user chooses "in X days" this is a number (string-bound)
  let orderNotes = '';
  
  // Filter items for order mode - only show approved items
  $: orderableItems = parts.filter(p => p.status === 'approved' && !p.order_id);
  
  // When in order mode and a vendor is selected, filter to that vendor only
  $: displayedOrderItems = orderMode && selectedVendor 
    ? orderableItems.filter(p => {
        const itemVendor = p.vendor || 'Other';
        return itemVendor === selectedVendor;
      })
    : orderableItems;

  onMount(async () => {
    // Hydrate from UUID and keep local var in sync
    const unsub = userStore.subscribe((v) => { user = v; });
    await loadUserFromUUID(supabase);

    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    if (!session && !user) {
      goto('/');
      return;
    }
    if (session?.user?.id) {
      setUserUUID(session.user.id);
      await upsertProfileIfMissing(supabase, {
        id: session.user.id,
        email: session.user.email,
        name: session.user.user_metadata?.name || session.user.user_metadata?.full_name || null
      });
      await loadUserFromUUID(supabase);
    }

  await Promise.all([loadParts(), loadBuildOptions(), loadVendors()]);
    loading = false;
  });

  async function loadVendors() {
    try {
      const { data, error } = await supabase
        .from('vendors')
        .select('*')
        .order('name');
      if (error) throw error;
      vendors = data || [];
    } catch (err) {
      console.error('Failed to load vendors', err);
      // Don't block the page if vendors fail to load
    }
  }

  function detectVendorFromUrl(url) {
    if (!url || !vendors.length) return 'Other';
    
    const cleanUrl = url.toLowerCase().trim();
    
    for (const vendor of vendors) {
      const urlBase = vendor.url_base.toLowerCase().trim();
      if (cleanUrl.includes(urlBase)) {
        return vendor.name;
      }
    }
    
    return 'Other';
  }

  // Watch for URL changes in misc modal and auto-detect vendor
  $: if (miscUrl) {
    const detected = detectVendorFromUrl(miscUrl);
    if (detected !== miscVendor) {
      miscVendor = detected;
    }
  }

  async function loadParts() {
    try {
      // Load COTS purchasing items
      const { data, error } = await supabase
        .from('purchasing')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      parts = data || [];
    } catch (error) {
      console.error('Error loading parts:', error);
      alert('Failed to load parts');
    }
  }

  function toggleOrderMode() {
    orderMode = !orderMode;
    if (!orderMode) {
      // Reset selections when exiting order mode
      selectedItems.clear();
      selectedVendor = null;
      selectedItems = selectedItems; // trigger reactivity
    }
  }

  function toggleItemSelection(item) {
    const itemVendor = item.vendor || 'Other';
    
    if (selectedItems.has(item.id)) {
      // Deselecting item
      selectedItems.delete(item.id);
      selectedItems = selectedItems;
      
      // If no items left, reset vendor filter
      if (selectedItems.size === 0) {
        selectedVendor = null;
      }
    } else {
      // Selecting item
      if (selectedItems.size === 0) {
        // First item selected - set vendor filter
        selectedVendor = itemVendor;
      }
      selectedItems.add(item.id);
      selectedItems = selectedItems;
    }
  }

  function openOrderConfirmModal() {
    if (selectedItems.size === 0) {
      toastActions.show('Please select at least one item to order');
      return;
    }
    
    // compute subtotal for selected items and pre-fill order total with subtotal (user can edit)
    const subtotal = parts.filter(p => selectedItems.has(p.id)).reduce((sum, p) => sum + ((p.final_price || p.price || 0) * (p.quantity || 1)), 0);
    orderTotal = subtotal;
    orderDeliveryDate = '';
    orderDeliveryInDays = '';
    orderNotes = '';
    showOrderModal = true;
  }

  async function placeOrder() {
    if (!user) {
      toastActions.show('You must be signed in to place orders');
      return;
    }

    try {
      const selectedParts = parts.filter(p => selectedItems.has(p.id));
      const totalCost = selectedParts.reduce((sum, p) => {
        return sum + ((p.final_price || p.price || 0) * (p.quantity || 1));
      }, 0);

      // Generate order number
      const orderNumber = `ORD-${Date.now()}`;

      // Determine final order total and shipping
      const parsedOrderTotal = parseFloat(orderTotal) || 0;
      // If user supplied an order total, compute shipping as order_total - items_total (min 0)
      const shippingCostNum = Math.max(0, parsedOrderTotal - totalCost);
      // Determine delivery date from either explicit date or "in X days"
      let deliveryDateFinal = null;
      if (orderDeliveryInDays && Number(orderDeliveryInDays) > 0) {
        const d = new Date();
        d.setDate(d.getDate() + Number(orderDeliveryInDays));
        deliveryDateFinal = d.toISOString().slice(0,10);
      } else if (orderDeliveryDate) {
        // assume YYYY-MM-DD string
        deliveryDateFinal = orderDeliveryDate;
      }

      // Create order record
      const orderData = {
        order_number: orderNumber,
        vendor: selectedVendor,
        total_items: selectedParts.length,
        total_cost: totalCost,
        order_total: parsedOrderTotal || (totalCost + 0),
        shipping_cost: shippingCostNum,
        delivery_date: deliveryDateFinal,
        placed_by: user.id,
        notes: orderNotes && orderNotes.trim() !== '' ? orderNotes.trim() : null
      };

      const { data: orderRecord, error: orderError } = await supabase
        .from('orders')
        .insert([orderData])
        .select();

      if (orderError) throw orderError;

      const orderId = orderRecord[0].id;

      // Calculate shipping cost allocation per item (proportional to item cost)
      // shippingCostNum already computed above
      const allocations = selectedParts.map(p => {
        const itemCost = (p.final_price || p.price || 0) * (p.quantity || 1);
        const allocation = totalCost > 0 ? (itemCost / totalCost) * shippingCostNum : 0;
        return {
          id: p.id,
          allocation: allocation
        };
      });

      // Update all selected items
      for (const part of selectedParts) {
        const allocation = allocations.find(a => a.id === part.id)?.allocation || 0;
        
        const { error: updateError } = await supabase
          .from('purchasing')
          .update({
            status: 'ordered',
            order_id: orderId,
            shipping_cost_allocated: allocation,
            delivery_date: deliveryDateFinal
          })
          .eq('id', part.id);

        if (updateError) throw updateError;
      }

      toastActions.show(`Order ${orderNumber} placed successfully!`);
      showOrderModal = false;
      orderMode = false;
      selectedItems.clear();
      selectedVendor = null;
      selectedItems = selectedItems;
      
      await loadParts();
    } catch (err) {
      console.error('Failed to place order', err);
      toastActions.show('Failed to place order: ' + (err.message || String(err)));
    }
  }

  // Load builds to offer as Project options
  async function loadBuildOptions() {
    try {
      const { data, error } = await supabase
        .from('builds')
        .select(`id, release_name, subsystems(name)`) // denormalized project label
        .order('created_at', { ascending: false });
      if (error) throw error;
      const seen = new Set();
      buildOptions = (data || []).map(b => {
        const label = `${b.subsystems?.name || 'Project'}-${b.release_name || ''}`;
        return { id: b.id, label };
      })
      // ensure unique labels while keeping first occurrence
      .filter(opt => (seen.has(opt.label) ? false : (seen.add(opt.label), true)));
    } catch (e) {
      console.warn('Failed to load builds for project options', e?.message || e);
      buildOptions = [];
    }
  }

  function openEditModal(part) {
    editPart = part;
    editName = part.name || '';
    editVendor = part.vendor || '';
    editProjectId = part.project_id || '';
    editUrl = part.url || '';
    editPrice = part.price !== null && part.price !== undefined ? String(part.price) : '';
    editQuantity = part.quantity || 1;
    editKittingBin = part.kitting_bin || '';
  editNotes = part.notes || '';
    showEditModal = true;
  }

  // Row interaction: open edit modal on row click (when permitted)
  function canEdit(part) {
    return (part.status || 'pending') === 'pending' && hasPermission(user, 'PLACE_ORDERS_MISC');
  }
  function onRowClick(e, part) {
    // Avoid triggering when clicking on controls/links
    try {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a') || e.target.closest('select') || e.target.closest('textarea')) return;
    } catch {}
    if (canEdit(part)) openEditModal(part);
  }
  function onRowKeyDown(e, part) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    try {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a') || e.target.closest('select') || e.target.closest('textarea')) return;
    } catch {}
    e.preventDefault();
    if (canEdit(part)) openEditModal(part);
  }

  async function saveEdit() {
    if (!user) { alert('You must be signed in to edit items'); return; }
  console.log('saveEdit called for', editPart && editPart.id);
  toastActions.show('Saving...');
  saving = true;
    try {
      const updates = {
        name: editName,
        vendor: editVendor || null,
        project_id: editProjectId || '',
        url: editUrl || null,
  price: editPrice === '' ? null : Number(editPrice),
        quantity: editQuantity ? Number(editQuantity) : 1,
        kitting_bin: editKittingBin || null
  ,
  notes: editNotes && editNotes.trim() !== '' ? editNotes.trim() : null
      };
      const { error } = await supabase.from('purchasing').update(updates).eq('id', editPart.id);
      if (error) throw error;
      showEditModal = false;
      editPart = null;
      await loadParts();
      toastActions.show('Item saved');
    } catch (err) {
      console.error('Failed to save edits', err);
  const msg = 'Failed to save edits: ' + (err.message || String(err));
  alert(msg);
  toastActions.show(msg);
    }
    saving = false;
  }

  async function deleteEditPart() {
    if (!user) { alert('You must be signed in to delete items'); return; }
    if (!editPart) return;
    try {
      // Normalize id for matching against build_bom bigint columns
      const normalizedId = (typeof editPart.id === 'string' && /^\d+$/.test(editPart.id)) ? Number(editPart.id) : editPart.id;

      // Clear any build_bom references to this purchasing id before attempting delete
      try {
        const { data: refs, error: refErr } = await supabase.from('build_bom').select('id').eq('purchasing_id', normalizedId);
        if (refErr) throw refErr;
        if (refs && refs.length > 0) {
          const ids = refs.map(r => r.id);
          const { error: clearErr } = await supabase.from('build_bom').update({ purchasing_id: null, added: false }).in('id', ids);
          if (clearErr) throw clearErr;
        }
      } catch (e) {
        console.error('Failed to clear build_bom references for purchasing id before delete:', e);
        alert('Failed to delete item: could not clear BOM references. Remove or unlink BOM rows first.');
        return;
      }

      const { data, error } = await supabase.from('purchasing').delete().eq('id', normalizedId);
      if (error) {
        console.error('Failed to delete item', error);
        alert('Failed to delete item: ' + (error.message || JSON.stringify(error)));
        return;
      }
      showEditModal = false;
      editPart = null;
  await loadParts();
  toastActions.show('Item deleted');
    } catch (err) {
      console.error('Failed to delete item', err);
  const msg = 'Failed to delete item: ' + (err.message || String(err));
  alert(msg);
  toastActions.show(msg);
    }
  }

  async function addMiscItem() {
    if (!user) {
      alert('You must be signed in to add items');
      return;
    }

    try {
      const requesterName = user.full_name || user.email || null;
  // Resolve project_id from the typed input. Use the typed text as the stored project id.
  // If the typed label matches a known build, remember that for optional linking to build.part_ids.
  const typed = (miscProject && miscProject.trim()) || '';
  const matchedBuild = typed ? buildOptions.find(b => b.label === typed) : null;
  const projectIdToUse = typed;
      const payload = {
        // Minimal required fields for a misc purchasing item
        // project_id is NOT NULL in the DB schema, use an empty string when none provided
        name: miscProjectText && miscProjectText.trim() !== '' ? miscProjectText.trim() : 'Misc Item',
        project_id: projectIdToUse,
        url: miscUrl && miscUrl.trim() !== '' ? miscUrl.trim() : null,
        price: miscPrice === '' ? null : Number(miscPrice),
        quantity: miscQuantity ? Number(miscQuantity) : 1,
        vendor: miscVendor && miscVendor !== 'Other' ? miscVendor : null,
  requester: requesterName || 'Unknown',
  purchaser: user.id,
          approved: false,
        status: 'pending'
  ,
        notes: miscNotes && miscNotes.trim() !== '' ? miscNotes.trim() : null,
          frc_team: user?.frc_team || null
      };

      const { data: inserted, error } = await supabase.from('purchasing').insert([payload]).select();
      if (error) throw error;

      // If linked to a build, associate it so it appears in Build Components
  const newItem = inserted?.[0];
  if (newItem) {
        notifyPurchaseBot({
          requester: newItem.requester || requesterName || 'Unknown',
          item_name: newItem.name,
          project_id: newItem.project_id || '',
          purchase_id: newItem.id
        });
      }
  if (newItem && matchedBuild && matchedBuild.id) {
        try {
          const { data: bData, error: bErr } = await supabase
            .from('builds')
            .select('id, part_ids')
    .eq('id', matchedBuild.id)
            .single();
          if (!bErr && bData) {
            const current = Array.isArray(bData.part_ids) ? bData.part_ids : [];
            const newIds = current.includes(newItem.id) ? current : [...current, newItem.id];
              const { error: updErr } = await supabase
              .from('builds')
              .update({ part_ids: newIds })
              .eq('id', matchedBuild.id);
            if (updErr) console.warn('Failed to link misc item to build:', updErr?.message || updErr);
          }
        } catch (linkErr) {
          console.warn('Error linking misc item to build:', linkErr?.message || linkErr);
        }
      }

      // Reset modal state and reload parts
      showAddMiscModal = false;
      miscUrl = '';
      miscPrice = '';
      miscQuantity = 1;
      miscProjectText = '';
  miscProject = '';
  miscNotes = '';
      await loadParts();
    } catch (err) {
      console.error('Failed to add misc item', err);
      alert('Failed to add item');
    }
  }

  async function updatePartStatus(part, statusField, newStatus) {
    try {
      // If reverting an approved item back to pending, clear approved flag and approver
      // If reverting a rejected item back to pending, clear approver (used as rejector)
      let updates = { [statusField]: newStatus };
      if ((part.status || '').toString().toLowerCase() === 'approved' && (newStatus || '').toString().toLowerCase() === 'pending') {
        updates.approved = false;
        updates.approver = null;
      }
      if ((part.status || '').toString().toLowerCase() === 'rejected' && (newStatus || '').toString().toLowerCase() === 'pending') {
        updates.approver = null;
      }

      const { error } = await supabase
        .from('purchasing')
        .update(updates)
        .eq('id', part.id);

      if (error) throw error;
      
      await loadParts();
    } catch (error) {
      console.error('Error updating status:', error);
      alert('Failed to update status');
    }
  }

  async function updateKittingLocationFor(part, location) {
    try {
      const { error } = await supabase
        .from('purchasing')
        .update({ kitting_bin: location })
        .eq('id', part.id);

      if (error) throw error;
      await loadParts();
    } catch (error) {
      console.error('Error updating kitting location:', error);
      alert('Failed to update kitting location');
    }
  }

  function downloadPart(part) {
    // For purchasing, open vendor URL if present
    if (part?.url) {
      window.open(part.url, '_blank', 'noopener');
    } else {
      alert('No link available for this item');
    }
  }

  async function approvePart(part) {
    if (!user) {
      alert('You must be signed in to approve items');
      return;
    }
    try {
      const approverName = user.full_name || user.email || null;
      const { error } = await supabase
  .from('purchasing')
  .update({ approved: true, approver: approverName, status: 'approved' })
  .eq('id', part.id);

      if (error) throw error;
      await sendNotification('purchase-approved', { purchase_id: part.id });
      await loadParts();
    } catch (err) {
      console.error('Failed to approve part', err);
      alert('Failed to approve part');
    }
  }

  async function rejectPart(part) {
    if (!user) {
      alert('You must be signed in to reject items');
      return;
    }
    try {
      const rejectorName = user.full_name || user.email || null;
      const { error } = await supabase
  .from('purchasing')
  .update({ approved: false, approver: rejectorName, status: 'rejected' })
  .eq('id', part.id);

      if (error) throw error;
      await loadParts();
    } catch (err) {
      console.error('Failed to reject part', err);
      alert('Failed to reject part');
    }
  }

  async function unrejectPart(part) {
    if (!user) {
      alert('You must be signed in to unreject items');
      return;
    }
    try {
      const { error } = await supabase
  .from('purchasing')
  .update({ approved: false, approver: null, status: 'pending' })
  .eq('id', part.id);

      if (error) throw error;
      await loadParts();
    } catch (err) {
      console.error('Failed to unreject part', err);
      alert('Failed to unreject part');
    }
  }

  function getWorkflowDisplay(workflow) {
    if (!workflow) return 'Not specified';
    return workflow.charAt(0).toUpperCase() + workflow.slice(1);
  }
</script>

<svelte:head>
  <title>Purchasing (COTS) - 971 Hub</title>
</svelte:head>

{#if loading}
  <div class="loading-container">
    <div class="loading-spinner"></div>
    <p>Loading parts...</p>
  </div>
{:else if user}
  <div class="parts-container">
    <div class="page-header">
      <div class="header-content">
        <ShoppingCart size={32} />
        <div>
          <h1>Purchasing (COTS)</h1>
          <p>Track vendor parts, orders, delivery, and kitting</p>
        </div>
      </div>
      <div style="margin-top:1rem; display:flex; gap:0.5rem; flex-wrap: wrap;">
          {#if hasPermission(user, 'PLACE_ORDERS_MISC')}
            <button class="btn btn-secondary" on:click={() => { showAddMiscModal = true; }}>Add Misc Item</button>
          {/if}
          {#if hasPermission(user, 'APPROVE_PURCHASES')}
            {#if !orderMode}
              <button class="btn btn-primary" on:click={toggleOrderMode}>
                  <Package size={16} /> Create Order
                </button>
              {:else}
                <!-- use primary (accent) for confirm instead of green success; keep semantic icon -->
                <button class="btn btn-primary" on:click={openOrderConfirmModal} disabled={selectedItems.size === 0}>
                  <CheckCircle size={16} /> Confirm Order ({selectedItems.size} items)
                </button>
              <button class="btn btn-secondary" on:click={toggleOrderMode}>Cancel</button>
            {/if}
          {/if}
        </div>
    </div>

    {#if orderMode}
      <div class="order-mode-banner">
        <div class="order-mode-content">
          <div class="order-mode-icon"><Package size={28} /></div>
          <div>
            <strong>Order Creation Mode</strong>
            <p>Select items to include in this order. {selectedVendor ? `Showing only ${selectedVendor} items.` : 'Select an item to filter by vendor.'}</p>
          </div>
        </div>
      </div>
    {/if}

    <div class="card">
      <div class="filters">
        <div class="form-group">
          <label class="form-label">Vendor</label>
          <select class="form-select" bind:value={vendorFilter}>
            <option value="">All vendors</option>
            {#each vendorOptions as v}
              <option value={v}>{v}</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Project</label>
          <select class="form-select" bind:value={projectFilter}>
            <option value="">All projects</option>
            {#each projectOptions as p}
              <option value={p}>{p}</option>
            {/each}
          </select>
        </div>

        <div class="form-group">
          <label class="form-label">Status</label>
          <select class="form-select" bind:value={statusFilter}>
            <option value="">Any</option>
            <option value="pending">Pending</option>
            <option value="rejected">Rejected</option>
            <option value="approved">Approved</option>
            <option value="ordered">Ordered</option>
            <option value="delivered">Delivered</option>
            <option value="kitted">Kitted</option>
          </select>
        </div>
      </div>
    </div>

    {#if (orderMode ? displayedOrderItems : filteredParts).length > 0}
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              {#if orderMode}
                <th style="width: 40px;">
                  <input type="checkbox" disabled style="opacity: 0.3;" />
                </th>
              {/if}
              <th>Name</th>
              <th>Vendor</th>
              <th>Project ID</th>
              <th>Requester</th>
              <th>Quantity</th>
              <th>Price</th>
              {#if !orderMode}
                <th>Link</th>
                <th>Approved</th>
                <th>Status</th>
                <th>Shipping</th>
                <th>Delivery</th>
                <th>Kit</th>
              {:else}
                <th>Total</th>
              {/if}
            </tr>
          </thead>
          <tbody>
            {#each (orderMode ? displayedOrderItems : filteredParts) as part}
              <tr
                on:click={(e) => orderMode ? null : onRowClick(e, part)}
                on:keydown={(e) => orderMode ? null : onRowKeyDown(e, part)}
                role={orderMode ? undefined : (canEdit(part) ? 'button' : undefined)}
                tabindex={orderMode ? undefined : (canEdit(part) ? '0' : undefined)}
                style={orderMode ? '' : (canEdit(part) ? 'cursor: pointer;' : '')}
                class={orderMode && selectedItems.has(part.id) ? 'selected-row' : ''}
              >
                {#if orderMode}
                  <td on:click|stopPropagation>
                    <input 
                      type="checkbox" 
                      checked={selectedItems.has(part.id)}
                      on:change={() => toggleItemSelection(part)}
                    />
                  </td>
                {/if}
                <td class="part-name">
                  <div class="name-cell">
                    {part.name}
                    {#if part.notes && !orderMode}
                      <button class="notes-badge" title="View notes" on:click={() => { notesModalPart = part; showNotesModal = true; }}>
                        !
                      </button>
                    {/if}
                  </div>
                </td>
                <td class="material">
                  {part.vendor || '—'}
                </td>
                <td class="project-id">
                  {part.project_id || '-'}
                </td>
                <td class="requester">
                  <div class="requester-content">
                    <span>{(part.requester || 'Unknown').split(' ')[0]}</span>
                    {#if isTeam9584(part.frc_team)}
                      <span class="tag team-tag tag-9584" title="Team 9584">9584</span>
                    {/if}
                  </div>
                </td>
                <td class="quantity">
                  {part.quantity || 1}
                </td>
                <td class="price">
                  {#if orderMode || (part.price !== null && part.price !== undefined)}
                    <div>${(part.price || 0).toFixed(2)}</div>
                  {:else}
                    <input type="number" min="0" step="0.01" class="form-input price-input" placeholder="unit cost" value={part.price || ''}
                      on:change={async (e) => {
                        const val = e.target.value === '' ? null : Number(e.target.value);
                        try {
                          const { error } = await supabase.from('purchasing').update({ price: val }).eq('id', part.id);
                          if (error) throw error;
                          await loadParts();
                        } catch (err) {
                          console.error('Failed to update price', err);
                          alert('Failed to update price');
                        }
                      }}
                    />
                  {/if}
                </td>
                {#if !orderMode}
                <td class="download">
                  <button class="btn btn-secondary btn-sm" on:click={() => {
                      if (part.url) {
                        downloadPart(part);
                      } else {
                        // Open modal to ask for URL/Price
                        linkModalPart = part;
                        linkModalUrl = '';
                        linkModalPrice = part.price !== null ? String(part.price) : '';
                        showLinkModal = true;
                      }
                    }} title="Open vendor link">
                    <LinkIcon size={16} />
                  </button>
                </td>
                <td class="approved">
                  {#if part.approved}
                    <div class="approved-info">
                      <span class="approver-name">{part.approver ? part.approver.split(' ')[0] : 'Approved'}</span>
                    </div>
                  {:else if (part.status || '').toString().toLowerCase() === 'rejected'}
                    <button class="btn btn-rejected btn-sm" on:click={() => unrejectPart(part)} title="Click to unreject">
                      <span class="rejected-text">Rejected</span>
                    </button>
                  {:else}
                    {#if hasPermission(user, 'APPROVE_PURCHASES')}
                      <button class="btn btn-approve btn-sm" 
                        on:click={() => approvePart(part)}
                        on:contextmenu={(e) => { e.preventDefault(); rejectPart(part); }}
                        title="Left click to approve, Right click to reject">
                        <span class="approve-text">Approve</span>
                      </button>
                    {:else}
                      <span style="color:#666; font-size:12px;">Needs approval</span>
                    {/if}
                  {/if}
                </td>
                <td class="status">
                  <!-- Show an 'Approved' disabled placeholder when the part is approved or in a state after approval
                       (so the green approved badge is visible). Use the actual status value when possible so the select
                       doesn't show a blank value. -->
                  <select
                    class="status-select colorful"
                    value={(() => {
                      const s = (part.status || '').toString().toLowerCase();
                      const selectable = ['pending','rejected','ordered','delivered','kitted'];
                      const approvedLevel = ['approved','ordered','delivered','kitted'];
                      if (selectable.includes(s)) return s;
                      if (approvedLevel.includes(s)) return '__approved__';
                      return 'pending';
                    })()}
                    data-status={part.status || 'pending'}
                    on:change={(e) => {
                      const val = e.target.value;
                      if (val === '__approved__') return; // placeholder only
                      if ((val === 'ordered' || val === 'delivered') && !hasPermission(user, 'PLACE_ORDERS_MISC')) {
                        alert('You do not have permission to change order status.');
                        loadParts();
                        return;
                      }
                      updatePartStatus(part, 'status', val);
                    }}
                  >
                    
                    <option value="pending" data-color="#ffc107">Pending</option>
                    <option value="rejected" data-color="#e74c3c">Rejected</option>
                    {#if ['approved','ordered','delivered','kitted'].includes((part.status || '').toString().toLowerCase())}
                      <option value="__approved__" data-color="#4caf50">Approved</option>
                    {/if}
                    <option value="ordered" data-color="#6c5ce7">Ordered</option>
                    <option value="delivered" data-color="#27ae60">Delivered</option>
                    <option value="kitted" data-color="#2ecc71">Kitted</option>
                  </select>
                </td>
                <td class="shipping">
                  {#if part.shipping_cost_allocated && part.shipping_cost_allocated > 0}
                    <span style="color: var(--text-secondary); font-size: 12px;">
                      +${part.shipping_cost_allocated.toFixed(2)}
                    </span>
                  {:else}
                    <span style="color: var(--text-secondary); font-size: 12px;">—</span>
                  {/if}
                </td>
                <td class="delivery">
                  {#if part.delivery_date}
                    <span style="font-size:12px; color:var(--text-secondary);">{new Date(part.delivery_date).toLocaleDateString()}</span>
                  {:else}
                    <span style="color: var(--text-secondary); font-size: 12px;">—</span>
                  {/if}
                </td>
                <td class="kit">
                  <div class="kit-inline">
                    <input 
                      type="text" 
                      class="form-input kit-input" 
                      placeholder="Bin/Location"
                      value={part.kitting_bin || ''}
                      on:keydown={(e) => { if (e.key === 'Enter') updateKittingLocationFor(part, e.target.value.trim()); }}
                      on:blur={(e) => updateKittingLocationFor(part, e.target.value.trim())}
                    />
                  </div>
                </td>
                {:else}
                  <td class="price">
                    <strong>${((part.price || 0) * (part.quantity || 1)).toFixed(2)}</strong>
                  </td>
                {/if}
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {:else}
      <div class="empty-state">
  <ShoppingCart size={64} />
        <h3>No Parts Found</h3>
  <p>No purchasing items have been added yet.</p>
  <p>Add COTS items via your BOM flow or purchasing tools.</p>
      </div>
    {/if}
  </div>

  <!-- Kitting modal removed; inline input used instead -->
  {#if showLinkModal}
    <div class="modal-backdrop">
      <div class="modal" style="--modal-width: 460px;">
        <h3>Provide vendor link and unit price</h3>
        <div class="form-row">
          <label for="link-input">Link</label>
          <input id="link-input" type="text" bind:value={linkModalUrl} placeholder="https://..." />
        </div>
        <div class="form-row">
          <label for="price-input">Unit Price</label>
          <input id="price-input" type="number" min="0" step="0.01" bind:value={linkModalPrice} />
        </div>
        <div class="modal-actions">
          <button class="btn" on:click={() => { showLinkModal = false; linkModalPart = null; }}>Cancel</button>
          <button class="btn btn-primary" on:click={async () => {
            // Save to DB
            try {
              const updates = { url: linkModalUrl || null };
              if (linkModalPrice !== '') updates.price = Number(linkModalPrice);
              const { error } = await supabase.from('purchasing').update(updates).eq('id', linkModalPart.id);
              if (error) throw error;
              showLinkModal = false;
              linkModalPart = null;
              await loadParts();
            } catch (err) {
              console.error('Failed saving link/price', err);
              alert('Failed to save');
            }
          }}>Save</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showEditModal}
    <div class="modal-backdrop">
      <div class="modal" style="--modal-width: 460px;">
        <h3>Edit Purchasing Item</h3>
        <div class="form-row">
          <label for="edit-name">Name</label>
          <input id="edit-name" type="text" bind:value={editName} />
        </div>
        <div class="form-row">
          <label for="edit-vendor">Vendor</label>
          <select id="edit-vendor" bind:value={editVendor}>
            <option value="">Other</option>
            {#each vendors as vendor}
              <option value={vendor.name}>{vendor.name}</option>
            {/each}
          </select>
        </div>
        <div class="form-row">
          <label for="edit-project">Project ID</label>
          <select id="edit-project" bind:value={editProjectId}>
            <option value="">Select project…</option>
            {#each buildOptions as b}
              <option value={b.label}>{b.label}</option>
            {/each}
            <option value="Mechanical Supply">Mechanical Supply</option>
            <option value="Mechanical Consumable">Mechanical Consumable</option>
            <option value="Electrical Supply">Electrical Supply</option>
            <option value="Electrical Consumable">Electrical Consumable</option>
            <option value="Lab Consumable">Lab Consumable</option>
            <option value="Lab Supply">Lab Supply</option>
            <option value="Software Consumable">Software Consumable</option>
            <option value="Software Supply">Software Supply</option>
            <option value="Competition">Competition</option>
            <option value="Outreach + Fundraising">Outreach + Fundraising</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-row">
          <label for="edit-qty">Quantity</label>
          <input id="edit-qty" type="number" min="1" bind:value={editQuantity} />
        </div>
        <div class="form-row">
          <label for="edit-price">Unit Price</label>
          <input id="edit-price" type="number" min="0" step="0.01" bind:value={editPrice} />
        </div>
        <div class="form-row">
          <label for="edit-url">Link</label>
          <input id="edit-url" type="text" bind:value={editUrl} />
        </div>
        <div class="form-row">
          <label for="edit-kit">Kitting Bin</label>
          <input id="edit-kit" type="text" bind:value={editKittingBin} />
        </div>
        <div class="form-row">
          <label for="edit-notes">Notes</label>
          <textarea id="edit-notes" rows="4" bind:value={editNotes} placeholder="Order notes, vendor info, etc."></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn" on:click={() => { showEditModal = false; editPart = null; }}>Cancel</button>
          <button class="btn btn-danger" on:click={deleteEditPart}>Delete</button>
          <button class="btn btn-primary" on:click={saveEdit} disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showAddMiscModal}
    <div class="modal-backdrop">
      <div class="modal" style="--modal-width: 460px;">
        <h3>Add Misc Purchasing Item (not linked to a build)</h3>
        <div class="form-row">
          <label for="misc-project">Item name</label>
          <input id="misc-project" type="text" bind:value={miscProjectText} placeholder="Robot parts" />
        </div>
        <div class="form-row">
          <label for="misc-build">Project ID</label>
          <select id="misc-build" bind:value={miscProject} class="combo-input">
            <option value="">Select project…</option>
            {#each buildOptions as b}
              <option value={b.label}>{b.label}</option>
            {/each}
            <option value="Mechanical Supply">Mechanical Supply</option>
            <option value="Mechanical Consumable">Mechanical Consumable</option>
            <option value="Electrical Supply">Electrical Supply</option>
            <option value="Electrical Consumable">Electrical Consumable</option>
            <option value="Lab Consumable">Lab Consumable</option>
            <option value="Lab Supply">Lab Supply</option>
            <option value="Software Consumable">Software Consumable</option>
            <option value="Software Supply">Software Supply</option>
            <option value="Competition">Competition</option>
            <option value="Outreach + Fundraising">Outreach + Fundraising</option>
            <option value="Other">Other</option>
          </select>
        </div>
        <div class="form-row">
          <label for="misc-qty">Quantity</label>
          <input id="misc-qty" type="number" min="1" bind:value={miscQuantity} />
        </div>
        <div class="form-row">
          <label for="misc-price">Unit Price</label>
          <input id="misc-price" type="number" min="0" step="0.01" bind:value={miscPrice} />
        </div>
        <div class="form-row">
          <label for="misc-url">Link (optional)</label>
          <input id="misc-url" type="text" bind:value={miscUrl} placeholder="https://..." />
        </div>
        <div class="form-row">
          <label for="misc-vendor">Vendor</label>
          <select id="misc-vendor" bind:value={miscVendor} class="form-select modal-select">
            {#each vendorDropdownOptions as vendorOpt}
              <option value={vendorOpt}>{vendorOpt}</option>
            {/each}
          </select>
          <small style="color: var(--text-secondary); margin-top: 0.25rem;">Auto-detected from URL if available</small>
        </div>
        <div class="form-row">
          <label for="misc-notes">Notes (optional)</label>
          <textarea id="misc-notes" rows="4" bind:value={miscNotes} placeholder="Order notes, vendor info, etc."></textarea>
        </div>
        <div class="modal-actions">
          <button class="btn" on:click={() => { showAddMiscModal = false; }}>Cancel</button>
          <button class="btn btn-primary" on:click={addMiscItem}>Add Item</button>
        </div>
      </div>
    </div>
  {/if}

  {#if showNotesModal}
    <div class="modal-backdrop">
      <div class="modal" style="--modal-width: 460px;">
        <h3>Notes</h3>
        <div class="form-row">
          <div style="white-space:pre-wrap; max-height:300px; overflow:auto;">{notesModalPart ? notesModalPart.notes || '' : ''}</div>
        </div>
        <div class="modal-actions">
          <button class="btn" on:click={() => { showNotesModal = false; notesModalPart = null; }}>Close</button>
          {#if hasPermission(user, 'PLACE_ORDERS_MISC') && (notesModalPart?.status || 'pending') === 'pending'}
            <button class="btn btn-primary" on:click={() => {
              // open edit modal pre-loaded with this part
              showNotesModal = false;
              openEditModal(notesModalPart);
            }}>Edit</button>
          {/if}
        </div>
      </div>
    </div>
  {/if}

  {#if showOrderModal}
    <div class="modal-backdrop">
      <div class="modal" style="--modal-width: 460px;">
        <h3>Confirm Order</h3>
        
        <div class="order-summary">
          <div class="order-summary-row">
            <span>Vendor:</span>
            <strong>{selectedVendor}</strong>
          </div>
          <div class="order-summary-row">
            <span>Items:</span>
            <strong>{selectedItems.size}</strong>
          </div>
          <div class="order-summary-row">
            <span>Subtotal:</span>
            <strong>${parts.filter(p => selectedItems.has(p.id)).reduce((sum, p) => sum + ((p.final_price || p.price || 0) * (p.quantity || 1)), 0).toFixed(2)}</strong>
          </div>
        </div>

          <div class="form-row">
            <label for="order-total">Order Total (items + shipping)</label>
            <input
                id="order-total"
                class="form-input"
                type="number"
                min="0"
                step="0.01"
                bind:value={orderTotal}
                placeholder="0.00"
              />
            <small style="color: var(--text-secondary); margin-top: 0.25rem;">
              Enter the total charged for the order. Shipping will be calculated as (order total - items total)
              and distributed across items proportionally by cost.
            </small>
          </div>

        <div class="form-row">
          <label>Delivery Date</label>
          <div style="display:flex; gap:0.5rem; align-items:center;">
            <input type="date" class="form-input" bind:value={orderDeliveryDate} />
            <div style="display:flex; align-items:center; gap:0.25rem;">
              <label style="margin:0; font-size:12px; color:var(--text-secondary);">or in</label>
              <input type="number" class="form-input" min="0" step="1" placeholder="days" bind:value={orderDeliveryInDays} />
              <span style="font-size:12px; color:var(--text-secondary);">days</span>
            </div>
          </div>
          <small style="color: var(--text-secondary); margin-top: 0.25rem;">
            Choose a specific delivery date or specify "in X days". Leave blank if unknown.
          </small>
        </div>

        <div class="form-row">
          <label for="order-notes">Order Notes (optional)</label>
          <textarea 
            id="order-notes"
            class="form-input"
            rows="3" 
            bind:value={orderNotes} 
            placeholder="Tracking info, PO number, etc."
          ></textarea>
        </div>

        <div class="order-summary-row total-row">
          <span>Total (incl. shipping):</span>
          <strong>${(parseFloat(orderTotal) && parseFloat(orderTotal) > 0) ? parseFloat(orderTotal).toFixed(2) : parts.filter(p => selectedItems.has(p.id)).reduce((sum, p) => sum + ((p.final_price || p.price || 0) * (p.quantity || 1)), 0).toFixed(2)}</strong>
        </div>

        <div class="modal-actions">
          <button class="btn btn-secondary" on:click={() => { showOrderModal = false; }}>Cancel</button>
          <button class="btn btn-primary" on:click={placeOrder}>Place Order</button>
        </div>
      </div>
    </div>
  {/if}
{:else}
  <div class="error-container">
    <p>Please log in to access Parts Management.</p>
  </div>
{/if}

<style>
  .order-mode-banner {
    margin: 1rem 0;
    padding: 0.875rem 1rem;
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: 4px;
  }

  .order-mode-content {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .order-mode-icon {
    font-size: 2rem;
  }

  .order-mode-banner strong {
    color: var(--text);
    font-size: 1.1rem;
    display: block;
    margin-bottom: 0.25rem;
  }

  .order-mode-banner p {
    color: var(--text-secondary);
    margin: 0;
    opacity: 1;
  }

  .selected-row {
    background: transparent !important;
    border-left: 3px solid var(--border);
  }

  .order-summary {
    background: var(--primary);
    border: 1px solid var(--border);
    padding: 0.75rem 1rem;
    border-radius: 4px;
    margin-bottom: 1rem;
  }

  .order-summary-row {
    display: flex;
    justify-content: space-between;
    padding: 0.5rem 0;
    border-bottom: 1px solid var(--border);
  }

  .order-summary-row:last-child {
    border-bottom: none;
  }

  .order-summary-row.total-row {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 2px solid var(--secondary);
    font-size: 1.2rem;
  }

  .order-summary-row.total-row strong {
    color: var(--secondary);
  }

  .parts-container {
    max-width: 1600px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  .page-header { padding: 2rem; margin-bottom: 2rem; box-shadow: var(--shadow-sm); }
  .header-content h1 { font-size: 2rem; }
  .header-content p { margin: 0.5rem 0 0 0; font-size: 1.1rem; }

  .part-name {
    font-weight: 500;
    max-width: 180px;
    text-align: left;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .part-name .name-cell {
    display: inline-flex !important;
    flex-direction: row !important;
    align-items: center !important;
    gap: 0.5rem;
    flex-wrap: nowrap;
    vertical-align: middle;
    max-width: 100%;
    overflow: hidden;
  }

  .part-name .name-cell .notes-badge {
    flex-shrink: 0;
    display: inline-flex !important;
    vertical-align: middle;
  }

  .material {
    color: var(--neutral-500);
  }

  .project-id {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8rem;
    color: var(--neutral-500);
  }

  .requester {
    color: var(--neutral-500);
    vertical-align: middle;
  }

  .requester-content {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    white-space: nowrap;
  }

  .requester-content span:first-child {
    min-width: 0;
  }

  .download {
    text-align: center;
  }

  .download .btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .approved { text-align: center; }
  .approved-info { display: flex; align-items: center; gap: 0.375rem; justify-content: center; color: var(--text); }
  .approver-name { font-size: 0.9rem; color: var(--neutral-500); }

  .status-select {
    border: 1px solid rgba(0, 0, 0, 0.08);
    background: white;
    color: var(--text);
    min-width: 120px;
    border-radius: 4px;
    outline: 2px solid transparent;
    outline-offset: 1px;
    transition: border-color 0.15s ease, outline-color 0.15s ease;
  }

  .status-select:focus-visible {
    outline-color: color-mix(in srgb, var(--focus-ring, var(--secondary)) 40%, transparent);
  }

  .btn-approve {
    background: var(--brand-gold-soft);
    color: var(--brand-gold-strong);
    border: 1px solid var(--brand-gold-soft);
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
    outline: 2px solid transparent;
    outline-offset: 2px;
    transition: outline-color 0.15s ease, box-shadow 0.15s ease;
    box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.02);
  }
  .btn-approve:hover {
    background: var(--brand-gold-soft);
  }
  .btn-approve:focus-visible {
    outline-color: color-mix(in srgb, var(--brand-gold-strong) 35%, transparent);
  }

  .btn-approve .approve-text { font-weight: 400; }
  .btn-rejected .rejected-text { font-weight: 400; text-transform: lowercase; }

  .status-select.colorful {
    box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.4);
  }
  .status-select.colorful[data-status="pending"] {
    background: var(--brand-gold-soft);
    color: var(--brand-gold-strong);
    border-color: color-mix(in srgb, var(--brand-gold-strong) 35%, transparent);
  }
  .status-select.colorful[data-status="ordered"] {
    background: var(--purple-soft);
    color: var(--purple-strong);
    border-color: color-mix(in srgb, var(--purple-strong) 35%, transparent);
  }
  .status-select.colorful[data-status="delivered"] {
    background: var(--green-soft);
    color: var(--green-base);
    border-color: color-mix(in srgb, var(--green-strong) 30%, transparent);
  }
  .status-select.colorful[data-status="kitted"] {
    background: var(--green-soft);
    color: var(--green-base);
    border-color: color-mix(in srgb, var(--green-strong) 30%, transparent);
  }
  .status-select.colorful[data-status="approved"] {
    background: var(--green-soft);
    color: var(--green-strong);
    border-color: color-mix(in srgb, var(--green-strong) 30%, transparent);
  }
  .status-select.colorful[data-status="rejected"] {
    background: var(--red-soft);
    color: var(--red-strong);
    border-color: color-mix(in srgb, var(--red-strong) 35%, transparent);
  }

  .status-select.colorful option[value="pending"] { background: var(--brand-gold-soft); }
  .status-select.colorful option[value="rejected"] { background: var(--red-soft); }
  .status-select.colorful option[value="ordered"] { background: var(--purple-soft); }
  .status-select.colorful option[value="delivered"] { background: var(--green-soft); }
  .status-select.colorful option[value="kitted"] { background: var(--green-soft); }

  .kit-inline { display: flex; align-items: center; gap: 0.5rem; }
  .kit-input { min-width: 140px; }

  .notes-badge {
    background: var(--red-soft);
    color: var(--red-strong);
    border: 1px solid var(--red-soft);
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 0.5rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    height: 20px;
    width: 20px;
    min-width: 20px;
    aspect-ratio: 1 / 1;
    border-radius: 50%;
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
    font-size: 0.75rem;
    line-height: 1;
    box-sizing: border-box;
    vertical-align: middle;
  }

  .notes-badge:hover {
    background: var(--red-soft);
  }

  .modal textarea { min-height: 72px; }

  @media (max-width: 1200px) { 
    .parts-container { margin: 1rem; padding: 0; } 
    .page-header { padding: 1.5rem; } 
    .header-content { flex-direction: column; align-items: flex-start; } 
  }
</style>
