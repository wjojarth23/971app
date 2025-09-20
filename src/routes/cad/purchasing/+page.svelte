<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { hasPermission } from '$lib/permissions.js';
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

  await Promise.all([loadParts(), loadBuildOptions()]);
    loading = false;
  });

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
  requester: requesterName || 'Unknown',
  purchaser: user.id,
        approved: false,
        status: 'pending'
  ,
  notes: miscNotes && miscNotes.trim() !== '' ? miscNotes.trim() : null
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
      <div style="margin-top:1rem; display:flex; gap:0.5rem;">
          {#if hasPermission(user, 'PLACE_ORDERS_MISC')}
            <button class="btn btn-secondary" on:click={() => { showAddMiscModal = true; }}>Add Misc Item</button>
          {/if}
        </div>
    </div>

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

    {#if filteredParts.length > 0}
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Vendor</th>
              <th>Project ID</th>
              <th>Requester</th>
              <th>Quantity</th>
              <th>Price</th>
              <th>Link</th>
              <th>Approved</th>
              <th>Status</th>
              <th>Kit</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredParts as part}
              <tr
                on:click={(e) => onRowClick(e, part)}
                on:keydown={(e) => onRowKeyDown(e, part)}
                role={canEdit(part) ? 'button' : undefined}
                tabindex={canEdit(part) ? '0' : undefined}
                style={canEdit(part) ? 'cursor: pointer;' : ''}
              >
                <td class="part-name">
                  <div class="name-cell">
                    {part.name}
                    {#if part.notes}
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
                  {part.requester || 'Unknown'}
                </td>
                <td class="quantity">
                  {part.quantity || 1}
                </td>
                <td class="price">
                  {#if part.price !== null && part.price !== undefined}
                    <div>${part.price.toFixed(2)}</div>
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
      <div class="modal">
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
      <div class="modal">
        <h3>Edit Purchasing Item</h3>
        <div class="form-row">
          <label for="edit-name">Name</label>
          <input id="edit-name" type="text" bind:value={editName} />
        </div>
        <div class="form-row">
          <label for="edit-vendor">Vendor</label>
          <input id="edit-vendor" type="text" bind:value={editVendor} />
        </div>
        <div class="form-row">
          <label for="edit-project">Project ID</label>
          <input id="edit-project" type="text" bind:value={editProjectId} />
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
      <div class="modal">
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
      <div class="modal">
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
{:else}
  <div class="error-container">
    <p>Please log in to access Parts Management.</p>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--background);
    color: var(--text);
  }


  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    gap: 1rem;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top: 3px solid var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }

  .parts-container {
    max-width: 1600px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  .page-header {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 2rem;
    margin-bottom: 2rem;
    box-shadow: var(--shadow-sm);
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header-content h1 {
    margin: 0;
    color: var(--secondary);
    font-size: 2rem;
  }

  .header-content p {
    margin: 0.5rem 0 0 0;
    color: #666;
    font-size: 1.1rem;
  }

  /* removed unused table CSS (relies on global) */

  .part-name {
    font-weight: 500;
    min-width: 200px;
  }

  .name-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .material {
    color: #666;
  }

  .project-id {
    font-family: 'Monaco', 'Menlo', monospace;
    font-size: 0.8rem;
    color: #666;
  }

  .requester {
    color: #666;
  }

  .download {
    text-align: center;
  }

  /* Make the link button compact and match input/select sizing and corner radius */
  .download .btn {
    padding: 0.375rem 0.5rem;
    height: 32px;
    border-radius: 4px;
    min-width: 36px;
    display: inline-flex;
    align-items: center;
    justify-content: center;
  }

  .approved { text-align: center; }
  .approved-info { display:flex; align-items:center; gap:0.375rem; justify-content:center; color:var(--text); }
  .approver-name { font-size:0.9rem; color:#444; }

  /* removed legacy download-btn styles */

  .status-select {
    border: 1px solid var(--border);
    /* Use same compact sizing as BOM route: 32px height, 4px radius */
    border-radius: 4px;
    padding: 0.375rem 0.5rem;
    font-size: 0.8125rem;
    background: white;
    color: var(--text);
    min-width: 120px;
    height: 32px;
    line-height: normal;
    vertical-align: middle;
  }

  /* Approve button styling: muted yellow with yellow border, match dropdown radius */
  .btn-approve {
    background: #fff7cc; /* muted yellow */
    color: #5a4300; /* darker yellow/brown text for contrast */
    border: 1px solid #ffdf7a; /* yellow border */
    padding: 0.375rem 0.6rem;
    height: 32px;
    border-radius: 4px;
    font-size: 0.8125rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .btn-approve:hover {
    background: #fff2b8;
  }

  /* Make only the button text (not icons) non-bold */
  .btn-approve .approve-text { font-weight: 400; }

  /* Rejected button: same sizing as approve but red */
  .btn-rejected {
    background: #ffecec; /* light red */
    color: #7a0f0f; /* dark red text */
    border: 1px solid #f5a5a5; /* red border */
    padding: 0.375rem 0.6rem;
    height: 32px;
    border-radius: 4px;
    font-size: 0.8125rem;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  }
  .btn-rejected:hover { background: #ffdede; }
  .btn-rejected .rejected-text { font-weight: 400; text-transform: lowercase; }

  /* Selected value background by data-status */
  .status-select.colorful[data-status="pending"] {
    background: #fff3cd;
    color: #8a6d3b;
    border-color: #ffe69c;
  }
  .status-select.colorful[data-status="ordered"] {
    background: #ede7f6;
    color: #5e35b1;
    border-color: #c5b3e6;
  }
  .status-select.colorful[data-status="ordered"] {
    background: #ede7f6;
    color: #5e35b1;
    border-color: #c5b3e6;
  }
  .status-select.colorful[data-status="delivered"] {
    background: #e8f5e9;
    color: #2e7d32;
    border-color: #a5d6a7;
  }
  .status-select.colorful[data-status="kitted"] {
    background: #e0f7fa;
    color: #006064;
    border-color: #80deea;
  }
  .status-select.colorful[data-status="approved"] {
    background: #e8fef1;
    color: #1b5e20;
    border-color: #a7e9b6;
  }
  .status-select.colorful[data-status="rejected"] {
    background: #ffebee;
    color: #c62828;
    border-color: #ef9a9a;
  }

  /* Colorful dropdown options and selected background */
  .status-select.colorful option[value="pending"] { background: #fff3cd; }
  .status-select.colorful option[value="rejected"] { background: #ffebee; }
  .status-select.colorful option[value="ordered"] { background: #ede7f6; }
  .status-select.colorful option[value="delivered"] { background: #e8f5e9; }
  .status-select.colorful option[value="kitted"] { background: #e0f7fa; }

  .kit-inline { display: flex; align-items: center; gap: 0.5rem; }
  /* Match BOM sizing so inputs and selects align: 32px height, small radius */
  .kit-input { min-width: 140px; padding: 0.375rem 0.5rem; font-size: 0.8125rem; border-radius: 4px; height: 32px; }

  /* Price input in table should match the compact BOM control sizing */
  .price-input { padding: 0.375rem 0.5rem; font-size: 0.8125rem; border-radius: 4px; height: 32px; }

  /* removed unused states */

  /* removed old kit button styles */

  /* Modal Styles */
  .modal-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0,0,0,0.4);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 60;
  }

  /* Match manufacture filters layout: inline grid of controls */
  .filters {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 0.75rem;
    margin-bottom: 0.5rem;
    align-items: end;
  }

  .form-group { display:flex; flex-direction:column; }
  .form-label { font-size:0.9rem; margin-bottom:0.25rem; color:#333; }
  .form-select { padding:0.45rem; border:1px solid var(--border); border-radius:4px; height:36px; }

  .modal {
    background: var(--primary);
    border: 1px solid var(--border);
    padding: 1.25rem;
    border-radius: 8px;
    width: 420px;
    max-width: calc(100% - 2rem);
    box-shadow: var(--shadow-lg);
  }

  .modal h3 { margin: 0 0 0.5rem 0; }
  .modal .form-row { margin: 0.5rem 0; display:flex; flex-direction:column; }
  .modal .form-row label { font-size: 0.9rem; margin-bottom: 0.25rem; }
  .modal input[type="text"], .modal input[type="number"] { padding: 0.45rem; border: 1px solid var(--border); border-radius: 4px; }
  .modal .combo-input { padding: 0.45rem; border: 1px solid var(--border); border-radius: 4px; width: 100%; }
  .modal textarea { padding: 0.45rem; border: 1px solid var(--border); border-radius: 4px; resize: vertical; }
  .modal-actions { display:flex; justify-content:flex-end; gap:0.5rem; margin-top:0.75rem; }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    padding: 4rem 2rem;
    text-align: center;
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    color: #666;
  }

  .empty-state h3 {
    margin: 1rem 0 0.5rem 0;
    color: var(--secondary);
  }

  .empty-state p {
    margin: 0.25rem 0;
    color: #999;
  }

  /* removed unused .edit-cell styles */

  .notes-badge {
    /* Paler red background with red outline to match danger button styling */
    background: #ffe6e6; /* pale red */
    color: #7a0b0b; /* darker red text for contrast */
    border: 1px solid #ffb3b3; /* red outline */
    width: 20px;
    height: 20px;
    border-radius: 50%;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    margin-left: 0.5rem;
    font-weight: 700;
    cursor: pointer;
    padding: 0;
    font-size: 12px;
  }

.notes-badge:hover {
  background: #ffd6d6; /* slightly darker on hover */
}

  .btn-danger { background: #ffe6e6; color: #7a0b0b; border: 1px solid #ffb3b3; cursor: pointer; }
  .btn-danger:hover { background: #ffd6d6; }

  .error-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 60vh;
    text-align: center;
  }

  @media (max-width: 1400px) { }

  @media (max-width: 1200px) { .parts-container { margin: 1rem; padding: 0; } .page-header { padding: 1.5rem; } .header-content { flex-direction: column; align-items: flex-start; } }

  @media (max-width: 768px) { }
</style>
