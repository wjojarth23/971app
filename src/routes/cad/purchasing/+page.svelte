<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { hasPermission } from '$lib/permissions.js';
  import { ShoppingCart, Package, DollarSign, Truck, CheckCircle, Clock, AlertTriangle, Edit, MapPin, Download, Settings, X, Link as LinkIcon } from 'lucide-svelte';
  import { toastActions } from '$lib/toast.js';
  import { goto } from '$app/navigation';

  let user = null;
  let loading = true;
  let parts = [];
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
  let miscProjectText = '';
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
        name: session.user.user_metadata?.full_name || (session.user.email ? session.user.email.split('@')[0] : '')
      });
      await loadUserFromUUID(supabase);
    }

    await loadParts();
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
      const { data, error } = await supabase.from('purchasing').delete().eq('id', editPart.id);
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
      const payload = {
        // Minimal required fields for a misc purchasing item
        // project_id is NOT NULL in the DB schema, use an empty string when none provided
        name: miscProjectText && miscProjectText.trim() !== '' ? miscProjectText.trim() : 'Misc Item',
        project_id: miscProjectText && miscProjectText.trim() !== '' ? miscProjectText.trim() : '',
        url: miscUrl && miscUrl.trim() !== '' ? miscUrl.trim() : null,
        price: miscPrice === '' ? null : Number(miscPrice),
        quantity: miscQuantity ? Number(miscQuantity) : 1,
        requester: requesterName || 'Unknown',
        approved: false,
        status: 'pending'
  ,
  notes: miscNotes && miscNotes.trim() !== '' ? miscNotes.trim() : null
      };

      const { error } = await supabase.from('purchasing').insert([payload]);
      if (error) throw error;

      // Reset modal state and reload parts
      showAddMiscModal = false;
      miscUrl = '';
      miscPrice = '';
      miscQuantity = 1;
      miscProjectText = '';
  miscNotes = '';
      await loadParts();
    } catch (err) {
      console.error('Failed to add misc item', err);
      alert('Failed to add item');
    }
  }

  async function updatePartStatus(part, statusField, newStatus) {
    try {
      const { error } = await supabase
        .from('purchasing')
        .update({ [statusField]: newStatus })
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
        .update({ approved: true, approver: approverName })
        .eq('id', part.id);

      if (error) throw error;
      await loadParts();
    } catch (err) {
      console.error('Failed to approve part', err);
      alert('Failed to approve part');
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

    {#if parts.length > 0}
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
              <th>Edit</th>
            </tr>
          </thead>
          <tbody>
            {#each parts as part}
              <tr>
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
                  {:else}
                    {#if hasPermission(user, 'APPROVE_PURCHASES')}
                      <button class="btn btn-approve btn-sm" on:click={() => approvePart(part)}><span class="approve-text">Approve</span></button>
                    {:else}
                      <span style="color:#666; font-size:12px;">Needs approval</span>
                    {/if}
                  {/if}
                </td>
                <td class="status">
                  <select 
                    class="status-select colorful" 
                    value={part.status || 'pending'}
                    data-status={part.status || 'pending'}
                    on:change={(e) => {
                      const val = e.target.value;
                      if ((val === 'ordered' || val === 'delivered') && !hasPermission(user, 'PLACE_ORDERS_MISC')) {
                        alert('You do not have permission to change order status.');
                        // revert select visually by reloading parts
                        loadParts();
                        return;
                      }
                      updatePartStatus(part, 'status', val);
                    }}
                  >
                    <option value="pending" data-color="#ffc107">Pending</option>
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
                <td class="edit-cell">
                  {#if (part.status || 'pending') === 'pending' && hasPermission(user, 'PLACE_ORDERS_MISC')}
                    <button class="btn btn-secondary btn-sm" title="Edit item" on:click={() => openEditModal(part)}>
                      <Edit size={14} />
                    </button>
                  {/if}
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

  /* Colorful dropdown options and selected background */
  .status-select.colorful option[value="pending"] { background: #fff3cd; }
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

  .edit-cell { text-align: center; }
  .edit-cell .btn { padding: 0.325rem 0.45rem; height: 32px; border-radius: 4px; min-width: 36px; display:inline-flex; align-items:center; justify-content:center; }

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
