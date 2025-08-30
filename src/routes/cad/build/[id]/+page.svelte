<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { goto } from '$app/navigation';
  import { ArrowLeft, Package, CheckCircle, Clock, Wrench, ExternalLink, MapPin, Plus } from 'lucide-svelte';
  import stockData from '$lib/stock.json';

  let user = null;
  let loading = true;
  let build = null;
  let buildId = $page.params.id;
  let otherItems = [];
  // Edit modal state for build items
  let showEditModal = false;
  let editTarget = null;
  let editWorkflow = '';
  let editMaterial = '';
  let editQuantity = 1;
  let editStockAssignment = '';
  let editStockChoice = '';
  let editStockAssignmentCustom = null;

  onMount(async () => {
    // Hydrate from UUID and keep local var in sync
    const unsub = userStore.subscribe((v) => { user = v; });
    await loadUserFromUUID(supabase);

    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    if (!session && !user) {
      goto('/');
      loading = false;
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

    await loadBuildDetails();
    loading = false;
  });

  async function loadBuildDetails() {
    try {
      const { data, error } = await supabase
        .from('builds')
        .select(`
          *,
          subsystems(
            id,
            name,
            description,
            onshape_url,
            onshape_document_id,
            onshape_workspace_id,
            onshape_element_id
          )
        `)
        .eq('id', buildId)
        .single();

      if (error) throw error;
      build = data;

      const { data: otherData, error: otherErr } = await supabase
        .from('build_bom')
        .select('*')
        .eq('build_id', buildId)
        .eq('part_type', 'other')
        .order('created_at', { ascending: true });
      if (!otherErr) otherItems = otherData || [];

      if (build.part_ids && build.part_ids.length > 0) {
        const { data: partsData, error: partsError } = await supabase
          .from('parts')
          .select('*')
          .in('id', build.part_ids);
        if (!partsError) build.parts = partsData || [];

        const { data: purchasingData, error: purchasingError } = await supabase
          .from('purchasing')
          .select('*')
          .in('id', build.part_ids);
        if (!purchasingError) build.purchasing = purchasingData || [];
      } else {
        build.parts = [];
        build.purchasing = [];
      }
    } catch (error) {
      console.error('Error loading build details:', error);
      alert('Failed to load build details: ' + error.message);
      goto('/cad/build');
    } finally {
      loading = false;
    }
  }

  async function promoteOtherToManufacturing(item) {
    try {
      const workflow = item.workflow || 'mill';
      const project_id = `${build?.subsystems?.name || 'Project'}-${build?.release_name || ''}`;

      const { data: parts, error: partsErr } = await supabase
        .from('parts')
        .insert([{
          name: item.part_name || 'Unnamed Part',
          requester: user?.full_name || user?.email,
          project_id,
          workflow,
          status: 'pending',
          quantity: item.quantity || 1,
          material: item.material || ''
        }])
        .select();
      if (partsErr) throw partsErr;
      const part = parts?.[0];

      if (part?.id) {
        const current = build.part_ids || [];
        const newPartIds = current.includes(part.id) ? current : [...current, part.id];
        const { error: updErr } = await supabase
          .from('builds')
          .update({ part_ids: newPartIds })
          .eq('id', buildId);
        if (updErr) throw updErr;
      }

      const { error: bomUpdErr } = await supabase
        .from('build_bom')
        .update({ part_type: 'manufactured', added_to_parts_list: true })
        .eq('id', item.id);
      if (bomUpdErr) throw bomUpdErr;

      await loadBuildDetails();
    } catch (e) {
      console.error('Promote to manufacturing failed:', e);
      alert('Failed to add to manufacturing');
    }
  }

  async function promoteOtherToPurchasing(item) {
    try {
      const project_id = `${build?.subsystems?.name || 'Project'}-${build?.release_name || ''}`;
      const { data: pur, error: purErr } = await supabase
        .from('purchasing')
        .insert([{
          name: item.part_name || 'Unnamed Item',
          requester: user?.full_name || user?.email,
          project_id,
          quantity: item.quantity || 1,
          material: item.material || '',
          status: 'pending'
        }])
        .select();
      if (purErr) throw purErr;
      const p = pur?.[0];

      if (p?.id) {
        const current = build.part_ids || [];
        const newPartIds = current.includes(p.id) ? current : [...current, p.id];
        const { error: updErr } = await supabase
          .from('builds')
          .update({ part_ids: newPartIds })
          .eq('id', buildId);
        if (updErr) throw updErr;
      }

      const { error: bomUpdErr } = await supabase
        .from('build_bom')
        .update({ part_type: 'COTS', added_to_purchasing: true })
        .eq('id', item.id);
      if (bomUpdErr) throw bomUpdErr;

      await loadBuildDetails();
    } catch (e) {
      console.error('Promote to purchasing failed:', e);
      alert('Failed to add to purchasing');
    }
  }

  async function removeOtherItem(itemId) {
    try {
      const { error } = await supabase
        .from('build_bom')
        .delete()
        .eq('id', itemId);
      if (error) throw error;
      await loadBuildDetails();
    } catch (e) {
      console.error('Remove other item failed:', e);
      alert('Failed to remove item');
    }
  }

  async function markAsAssembled() {
    try {
      const { error } = await supabase
        .from('builds')
        .update({ 
          status: 'assembled',
          assembled_at: new Date().toISOString(),
          assembled_by: user.id
        })
        .eq('id', buildId);

      if (error) throw error;
      await loadBuildDetails();
    } catch (error) {
      console.error('Error marking as assembled:', error);
      alert('Failed to mark as assembled');
    }
  }

  function getStocksForWorkflow(workflow) {
    return stockData[workflow] || [];
  }

  function updateOtherPartType(index, newType) {
    if (!otherItems[index]) return;
    otherItems[index].part_type = newType;
    if (newType === 'COTS') {
      otherItems[index].workflow = 'purchase';
    } else {
      otherItems[index].workflow = otherItems[index].workflow && otherItems[index].workflow !== 'purchase' ? otherItems[index].workflow : 'mill';
    }
    otherItems = [...otherItems];
  }

  // Helpers for stock selection on 'other' items
  function updateOtherStockChoice(index, choice) {
    const item = otherItems[index];
    if (!item) return;
    item._stock_choice = choice;
    if (choice && choice !== '__other__') {
      item.stock_assignment = choice;
      item.stock_assignment_custom = null;
    } else if (choice === '__other__') {
      item.stock_assignment = '';
      item.stock_assignment_custom = '';
    } else {
      item.stock_assignment = '';
      item.stock_assignment_custom = null;
    }
    otherItems = [...otherItems];
  }

  function updateOtherCustomStock(index, value) {
    const item = otherItems[index];
    if (!item) return;
    item.stock_assignment_custom = value;
    item.stock_assignment = value;
    item._stock_choice = '__other__';
    otherItems = [...otherItems];
  }

  function updateOtherWorkflow(index, newWorkflow) {
    if (!otherItems[index]) return;
    otherItems[index].workflow = newWorkflow;
    otherItems = [...otherItems];
  }

  function getOtherDisplayType(item) {
    if (item.part_type === 'COTS' || item.part_type === 'manufactured') return item.part_type;
    if (item.workflow === 'purchase') return 'COTS';
    if (item.workflow) return 'manufactured';
    return 'manufactured';
  }

  function handleOtherAddClick(item) {
    const isCots = getOtherDisplayType(item) === 'COTS';
    if (isCots) {
      promoteOtherToPurchasing(item);
    } else {
      promoteOtherToManufacturing(item);
    }
  }

  function getBuildProgress() {
    if (!build) return { percent: 0, manufactured: 0, total: 0, status: 'No parts' };
    const allParts = [...(build.parts || []), ...(build.purchasing || [])];
    if (allParts.length === 0) return { percent: 0, manufactured: 0, total: 0, status: 'No parts' };
    const manufactured = allParts.filter(item => item.status === 'complete' || item.status === 'delivered').length;
    const inProgress = allParts.filter(item => item.status === 'in-progress' || item.status === 'cammed' || item.status === 'ordered').length;
    let status = 'Requested';
    if (manufactured === allParts.length) status = 'Ready to Assemble';
    else if (inProgress > 0 || manufactured > 0) status = 'Manufacturing';
    const mfgParts = build.parts || [];
    const purParts = build.purchasing || [];
    const mfgComplete = mfgParts.filter(p => p.status === 'complete').length;
    const purComplete = purParts.filter(p => p.status === 'delivered').length;
    return {
      percent: Math.round((manufactured / allParts.length) * 100),
      manufactured,
      total: allParts.length,
      inProgress,
      status,
      mfgPercent: mfgParts.length ? Math.round((mfgComplete / mfgParts.length) * 100) : 0,
      purPercent: purParts.length ? Math.round((purComplete / purParts.length) * 100) : 0,
      mfgCount: { complete: mfgComplete, total: mfgParts.length },
      purCount: { complete: purComplete, total: purParts.length }
    };
  }

  function getWorkflowIcon(workflow) {
    switch (workflow) {
      case '3d-print': return '🖨️';
      case 'laser-cut': return '🔥';
      case 'mill': return '⚙️';
      case 'lathe': return '🔄';
      case 'router': return '🪚';
      case 'purchase': return '🛒';
      default: return '🔧';
    }
  }
  function openEditModal(part) {
    editTarget = part;
    editWorkflow = part.workflow || '';
    editMaterial = part.material || '';
    editQuantity = part.quantity || 1;
  editStockAssignment = part.stock_assignment || '';
  editStockChoice = part._stock_choice || (part.stock_assignment_custom ? '__other__' : '') || '';
  editStockAssignmentCustom = part.stock_assignment_custom ?? null;
    showEditModal = true;
  }

  async function saveEdit() {
    if (!editTarget) {
      showEditModal = false;
      return;
    }
    try {
      if (editTarget.workflow === 'purchase') {
        const { error } = await supabase
          .from('purchasing')
          .update({
            material: editMaterial,
            quantity: editQuantity
          })
          .eq('id', editTarget.id);
        if (error) throw error;
      } else {
        // Try updating stock_assignment too; if column doesn't exist, retry without it
        let updateError = null;
        const baseUpdate = {
          workflow: editWorkflow || null,
          material: editMaterial,
          quantity: editQuantity
        };
        // Determine final stock value from choice/custom fields
        const finalStock = (editStockChoice === '__other__') ? (editStockAssignmentCustom || editStockAssignment || null) : (editStockChoice || editStockAssignment || null);
        try {
          const { error } = await supabase
            .from('parts')
            .update({
              ...baseUpdate,
              stock_assignment: finalStock
            })
            .eq('id', editTarget.id);
          if (error) updateError = error;
        } catch (e) {
          updateError = e;
        }
        if (updateError) {
          const msg = String(updateError.message || updateError);
          if (msg.includes('stock_assignment') && msg.includes('does not exist')) {
            const { error: e2 } = await supabase
              .from('parts')
              .update(baseUpdate)
              .eq('id', editTarget.id);
            if (e2) throw e2;
          } else {
            throw updateError;
          }
        }
      }
      await loadBuildDetails();
    } catch (e) {
      console.error('Edit save failed:', e);
      alert('Failed to save changes');
    } finally {
      showEditModal = false;
      editTarget = null;
    }
  }

  async function removeBuildAssociation(partId) {
    try {
      const current = build?.part_ids || [];
      const newIds = current.filter((id) => id !== partId);
      const { error } = await supabase
        .from('builds')
        .update({ part_ids: newIds })
        .eq('id', buildId);
      if (error) throw error;
      await loadBuildDetails();
    } catch (e) {
      console.error('Remove from build failed:', e);
      alert('Failed to remove from build');
    }
  }
</script>

<svelte:head>
  <title>Build Details - {build?.subsystems?.name || 'Unknown'} {build?.release_name || ''} - 971 Hub</title>
</svelte:head>

<div class="main-content">
  {#if loading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading build details...</p>
    </div>
  {:else if build}
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <div class="header-actions">
            <button class="back-button" on:click={() => goto('/cad/build')}>
              <ArrowLeft size={16} />
              Back to Builds
            </button>
            {#if build.subsystems?.onshape_url}
              <a href={build.subsystems.onshape_url} target="_blank" class="btn btn-secondary btn-sm">
                <ExternalLink size={16} />
                View CAD
              </a>
            {/if}
          </div>
          <div class="header-info">
            <h1>
              <Package size={32} />
              {build.subsystems?.name || 'Unknown Subsystem'} - {build.release_name}
            </h1>
            <p class="build-hash">Build #{build.build_hash?.split('_')[1] || build.id.substring(0, 8)}</p>
            <div class="build-meta">
              <span>Created: {new Date(build.created_at).toLocaleDateString()}</span>
              {#if build.assembled_at}
                <span>Assembled: {new Date(build.assembled_at).toLocaleDateString()}</span>
              {/if}
            </div>
          </div>
        </div>
        <div class="header-right">
          {#if build.status !== 'assembled'}
            {@const progress = getBuildProgress()}
            {#if progress.status === 'Ready to Assemble'}
              <button class="btn btn-success btn-sm" on:click={markAsAssembled}>
                <CheckCircle size={16} />
                Mark as Assembled
              </button>
            {/if}
          {/if}
        </div>
      </div>
    </div>

    <div class="status-section">
      <div class="status-card status-{build.status}">
        <div class="status-header">
          <span class="status-title">Parts</span>
          <span class="flag flag-{build.status}">
            {#if build.status === 'pending'}
              <Clock size={14} /> Pending
            {:else if build.status === 'manufacturing'}
              <Wrench size={14} /> in progress
            {:else if build.status === 'ready_to_assemble'}
              <CheckCircle size={14} /> Ready to Assemble
            {:else if build.status === 'assembled'}
              <CheckCircle size={14} /> Assembled
            {/if}
          </span>
        </div>
        {#if build}
          {@const progress = getBuildProgress()}
          <div class="progress-section">
            <div class="progress-row">
              <span class="progress-label">Manufacturing</span>
              <div class="progress-bar">
                <div class="progress-fill mfg" style="width: {progress.mfgPercent}%"></div>
              </div>
              <span class="progress-count">{progress.mfgCount.complete}/{progress.mfgCount.total}</span>
            </div>
            <div class="progress-row">
              <span class="progress-label">Purchasing</span>
              <div class="progress-bar">
                <div class="progress-fill pur" style="width: {progress.purPercent}%"></div>
              </div>
              <span class="progress-count">{progress.purCount.complete}/{progress.purCount.total}</span>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <div class="bom-section">
      <div class="parts-header">
        <h2>Build Components</h2>
        <div class="legend">
          <span class="legend-item"><span class="dot manufactured"></span>Manufactured</span>
          <span class="legend-item"><span class="dot cots"></span>COTS</span>
        </div>
      </div>
      {#if build.parts || build.purchasing}
        {@const allParts = [...(build.parts || []), ...(build.purchasing || [])]}
        {#if allParts.length > 0}
          <div class="bom-table-container">
            <table class="bom-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Type</th>
                  <th>Workflow</th>
                  <th>Qty</th>
                  <th>Material</th>
                  <th>Status</th>
                  <th>Kitting</th>
                  <th>Added</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {#each allParts as part, i}
                  <tr class="row {i % 2 === 0 ? 'even' : 'odd'}">
                    <td class="part-name">
                      <div class="name-cell">
                        <div class="avatar">
                          <Package size={14} />
                        </div>
                        <div class="name-wrap">
                          <div class="name">{part.name || part.part_name || 'Unnamed Part'}</div>
                          {#if part.part_number}
                            <div class="part-number">{part.part_number}</div>
                          {/if}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="chip {part.workflow === 'purchase' ? 'chip-cots' : 'chip-mfg'}">
                        {part.workflow === 'purchase' ? 'COTS' : 'Manufactured'}
                      </span>
                    </td>
                    <td>
                      <span class="chip chip-neutral">
                        {part.workflow || 'N/A'}
                      </span>
                    </td>
                    <td class="quantity">{part.quantity || 1}</td>
                    <td class="material">{part.material || '-'}</td>
                    <td>
                      <span class="chip {part.status ? `chip-status-${part.status}` : 'chip-neutral'}">
                        {#if part.status === 'pending'}
                          <Clock size={12} />
                        {:else if part.status === 'in-progress' || part.status === 'cammed'}
                          <Wrench size={12} />
                        {:else if part.status === 'ordered'}
                          <Package size={12} />
                        {:else if part.status === 'delivered' || part.status === 'complete' || part.status === 'manufactured'}
                          <CheckCircle size={12} />
                        {:else}
                          <Clock size={12} />
                        {/if}
                        <span>{part.status || 'unknown'}</span>
                      </span>
                    </td>
                    <td class="kitting">
                      {#if part.kitting_bin}
                        <div class="kitting-location">
                          <MapPin size={14} />
                          {part.kitting_bin}
                        </div>
                      {:else}
                        <span class="no-kitting">Not assigned</span>
                      {/if}
                    </td>
                    <td class="date">{new Date(part.created_at).toLocaleDateString()}</td>
                    <td class="actions">
                      <button class="btn btn-sm chip-edit" on:click={() => openEditModal(part)}>Edit</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty-state">
            <Package size={48} />
            <h3>No Parts in This Build</h3>
            <p>No parts have been added to this build yet.</p>
          </div>
        {/if}
      {:else}
        <div class="empty-state">
          <Package size={48} />
          <h3>No Parts in This Build</h3>
          <p>No parts have been added to this build yet.</p>
        </div>
      {/if}
    </div>

    {#if otherItems && otherItems.length > 0}
      <div class="bom-section">
        <div class="parts-header">
          <h2>Other Items</h2>
          <div class="legend">
            <span class="legend-item"><span class="dot other"></span>Other</span>
          </div>
        </div>
        <div class="bom-table-container">
          <table class="bom-table">
            <thead>
              <tr>
                <th>Part Name</th>
                <th>Qty</th>
                <th>Type</th>
                <th>Workflow</th>
                <th>Material</th>
                <th>Dimensions</th>
                <th>Stock Assignment</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {#each otherItems as item, i}
                <tr class="table-row">
                  <td>
                    <div class="part-name">
                      {item.part_name}
                      {#if item.part_number}
                        <div class="part-description">{item.part_number}</div>
                      {/if}
                    </div>
                  </td>
                  <td>{item.quantity || 1}</td>
                  <td>
                    {#if true}
                      {@const displayType = getOtherDisplayType(item)}
                      <select
                        class="type-dropdown {displayType === 'COTS' ? 'type-cots' : 'type-manufactured'}"
                        value={displayType}
                        on:change={(e) => updateOtherPartType(i, e.target.value)}
                      >
                        <option value="COTS">COTS</option>
                        <option value="manufactured">Manufactured</option>
                      </select>
                    {/if}
                  </td>
                  <td>
                    {#if (getOtherDisplayType(item) === 'COTS')}
                      <span class="workflow-badge workflow-purchase">Purchase</span>
                    {:else}
                      <select
                        class="workflow-dropdown workflow-{item.workflow || 'mill'}"
                        value={item.workflow || 'mill'}
                        on:change={(e) => updateOtherWorkflow(i, e.target.value)}
                      >
                        <option value="3d-print">3D Print</option>
                        <option value="laser-cut">Laser Cut</option>
                        <option value="lathe">Lathe</option>
                        <option value="mill">Mill</option>
                        <option value="router">Router</option>
                      </select>
                    {/if}
                  </td>
                  <td>{item.material || '-'}</td>
                  <td>
                    {#if item.bounding_box_x && item.bounding_box_y && item.bounding_box_z}
                      <div class="bounding-box">
                        {(item.bounding_box_x * 1000).toFixed(1)} × {(item.bounding_box_y * 1000).toFixed(1)} × {(item.bounding_box_z * 1000).toFixed(1)} mm
                      </div>
                    {:else}
                      <span class="no-data">No dimensions</span>
                    {/if}
                  </td>
                  <td>
                    {#if (getOtherDisplayType(item) !== 'COTS')}
                      <div class="stock-select">
                        <select on:change={(e) => updateOtherStockChoice(i, e.target.value)} value={item._stock_choice || item.stock_assignment}>
                          <option value="">Select Stock</option>
                          {#each getStocksForWorkflow(item.workflow || 'mill') as stock}
                            <option value={stock.description}>{stock.description}</option>
                          {/each}
                          <option value="__other__">Other...</option>
                        </select>

                        {#if (item._stock_choice === '__other__' || (!item._stock_choice && item.stock_assignment_custom !== null))}
                          <input type="text" class="form-input" placeholder="Type custom stock" bind:value={item.stock_assignment_custom} on:input={(e) => updateOtherCustomStock(i, e.target.value)} />
                        {/if}
                      </div>
                    {:else}
                      <span class="no-stock">-</span>
                    {/if}
                  </td>
                  <td>
                    <button class="btn btn-sm btn-yellow add-btn" on:click={() => handleOtherAddClick(item)}>
                      <Plus size={14} />
                      Add
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      </div>
    {/if}
  {:else}
    <div class="error-container">
      <h2>Build Not Found</h2>
      <p>The requested build could not be found.</p>
      <button class="btn btn-primary btn-sm" on:click={() => goto('/cad/build')}>
        <ArrowLeft size={16} />
        Back to Builds
      </button>
    </div>
  {/if}
</div>

{#if showEditModal}
  <div class="modal-backdrop" role="presentation" tabindex="-1" on:click={() => { showEditModal = false; editTarget = null; }}></div>
  <div class="modal" on:click|stopPropagation>
    <h3>Edit Build Item</h3>
    <div class="modal-row">
      <label>Workflow</label>
      {#if editTarget?.workflow === 'purchase'}
        <span class="workflow-badge workflow-purchase">Purchase</span>
      {:else}
        <select class="workflow-dropdown workflow-{editWorkflow || 'mill'}" bind:value={editWorkflow}>
          <option value="3d-print">3D Print</option>
          <option value="laser-cut">Laser Cut</option>
          <option value="lathe">Lathe</option>
          <option value="mill">Mill</option>
          <option value="router">Router</option>
        </select>
      {/if}
    </div>
    <div class="modal-row">
      <label>Stock</label>
      {#if editTarget?.workflow === 'purchase'}
        <span class="no-stock">-</span>
      {:else}
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          <select on:change={(e) => editStockChoice = e.target.value} value={editStockChoice || editStockAssignment}>
            <option value="">Select Stock</option>
            {#each getStocksForWorkflow(editWorkflow || 'mill') as stock}
              <option value={stock.description}>{stock.description}</option>
            {/each}
            <option value="__other__">Other...</option>
          </select>
          {#if (editStockChoice === '__other__' || (!editStockChoice && typeof editStockAssignmentCustom !== 'undefined' && editStockAssignmentCustom !== null))}
            <input class="form-input" type="text" placeholder="Type custom stock" bind:value={editStockAssignmentCustom} />
          {/if}
        </div>
      {/if}
    </div>
    <div class="modal-row">
      <label>Material</label>
      <!-- Material is read-only in the modal; only stock/workflow should be editable -->
      <input class="form-input" type="text" bind:value={editMaterial} readonly title="Material is read-only" />
    </div>
    <div class="modal-row">
      <label>Quantity</label>
      <input class="form-input" type="number" min="1" step="1" bind:value={editQuantity} />
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline-danger" on:click={() => { removeBuildAssociation(editTarget.id); showEditModal = false; editTarget = null; }}>Delete</button>
      <div style="flex:1"></div>
      <button class="btn" on:click={() => { showEditModal = false; editTarget = null; }}>Cancel</button>
      <button class="btn btn-yellow" on:click={saveEdit}>Save</button>
    </div>
  </div>
{/if}

<style>
  /* Make this section invisible (no padding/border), full width like BOM */
  .bom-section { display: block; }

  /* Modal styles (match BOM route) */
  .modal-backdrop {
    position: fixed !important;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4);
    z-index: 2147483646 !important;
    display: block !important;
    pointer-events: auto !important;
  }
  .modal {
    position: fixed !important;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) !important;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    width: min(560px, 92vw);
    z-index: 2147483647 !important;
    box-shadow: 0 10px 30px rgba(0,0,0,0.15);
    display: block !important;
    pointer-events: auto !important;
  }
  .modal-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    align-items: center;
    gap: 0.75rem;
    margin: 0.5rem 0;
  }
  .form-input {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 6px;
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .main-content { max-width: 1440px; margin: 0 auto; padding: 1.25rem; }
  .loading-container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; gap: 1rem; }
  .loading-spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top: 3px solid #FFD700; border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  .page-header { margin-bottom: 1rem; }
  .header-content { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .header-left { flex: 1; }
  .header-right { display: flex; align-items: center; gap: 0.5rem; }
  .header-actions { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .back-button { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.75rem; background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.85rem; }
  .header-info h1 { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.5rem 0; color: var(--text); font-size: 1.6rem; font-weight: 600; }
  .build-hash { margin: 0.25rem 0; color: var(--secondary); font-family: monospace; font-size: 0.9rem; }
  .build-meta { display: flex; gap: 1rem; margin-top: 0.25rem; font-size: 0.85rem; color: var(--secondary); }
  .status-section { margin-bottom: 1rem; }
  .status-card { background: white; border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
  .status-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .status-title { font-size: 1.1rem; font-weight: 600; color: var(--text); }
  .flag { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.375rem 0.75rem; height: 32px; border-radius: 4px; font-size: 0.8125rem; font-weight: 600; border: 1px solid transparent; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; flex: 0 1 280px; box-sizing: border-box; min-width: 0; margin-left: auto; }
  .flag.flag-pending { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .flag.flag-manufacturing { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .flag.flag-ready_to_assemble { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
  .flag.flag-assembled { background: #e8f6ef; color: #11642a; border-color: #a7e0c1; }
  .progress-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .progress-row { display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: 0.5rem; }
  .progress-label { font-size: 0.85rem; color: var(--secondary); }
  .progress-count { font-size: 0.85rem; color: #666; }
  .progress-bar { width: 100%; height: 10px; background: #f0f0f0; border-radius: 5px; overflow: hidden; }
  .progress-fill { height: 100%; transition: width 0.3s ease; }
  .progress-fill.mfg { background: linear-gradient(90deg, #27ae60, #2ecc71); }
  .progress-fill.pur { background: linear-gradient(90deg, #ffd54f, #ffb300); }
  .parts-section { background: white; border: 1px solid var(--border); border-radius: 12px; padding: 1rem; margin-bottom: 1.25rem; }
  .parts-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
  .legend { display: flex; gap: 1rem; color: #666; font-size: 0.85rem; }
  .legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .dot.manufactured { background: #e3f2fd; border: 1px solid #90caf9; }
  .dot.cots { background: #fff8e1; border: 1px solid #ffcc02; }
  .dot.other { background: #f3f4f6; border: 1px solid #e5e7eb; }
  .parts-section h2 { margin: 0 0 0.75rem 0; color: var(--text); font-size: 1.25rem; }
  .parts-table-bleed { margin: 0 -1rem -1rem -1rem; border-top: 1px solid var(--border); overflow-x: auto; border-bottom-left-radius: 12px; border-bottom-right-radius: 12px; }
  .parts-table { width: 100%; border-collapse: separate; border-spacing: 0; font-size: 0.9rem; }
  .parts-table thead th { position: sticky; top: 0; background: #fbfbfc; z-index: 1; text-align: left; padding: 0.675rem 0.9rem; border-bottom: 1px solid var(--border); color: #34495e; font-weight: 600; }
  .parts-table tbody td { padding: 0.675rem 0.9rem; border-bottom: 1px solid var(--border); }
  .parts-table tbody tr.even { background: #fff; }
  .parts-table tbody tr.odd { background: #fcfcfd; }
  .parts-table tbody tr:hover { background: #f6f7f9; }
  .part-name { font-weight: 500; }
  .name-cell { display: flex; align-items: center; gap: 0.65rem; }
  .avatar { width: 26px; height: 26px; border-radius: 6px; background: #f3f4f6; display: inline-flex; align-items: center; justify-content: center; color: #6b7280; border: 1px solid #e5e7eb; }
  .name-wrap { display: flex; flex-direction: column; }
  .name-cell .name { font-weight: 600; color: var(--text); }
  .name-cell .part-number { font-size: 0.78rem; color: #6b7280; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.375rem 0.75rem; height: 32px; border-radius: 4px; font-size: 0.8125rem; font-weight: 500; border: 1px solid transparent; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 520px) { .flag { flex-basis: 200px; } }
  .chip-mfg { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .chip-cots { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .chip-neutral { background: #f3f4f6; color: #374151; border-color: #e5e7eb; }
  .chip-status-pending { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .chip-status-in-progress, .chip-status-cammed { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .chip-status-ordered { background: #eef7ff; color: #0f609b; border-color: #b6e0fe; }
  .chip-status-delivered, .chip-status-complete, .chip-status-manufactured { background: #e8f6ef; color: #11642a; border-color: #a7e0c1; }
  .quantity { text-align: center; font-weight: 600; color: #111827; }
  .material { color: #4b5563; }
  .kitting { color: #4b5563; }
  .kitting-location { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--success); font-weight: 500; }
  .no-kitting { color: #999; font-style: italic; }
  .date { color: #6b7280; font-size: 0.85rem; }
  .error-container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; gap: 1rem; }
  :root { --primary: #ffffff; --secondary: #6c757d; --accent: #FFD700; --background: #f8f9fa; --surface: #ffffff; --border: #e1e5e9; --text: #2c3e50; --success: #27ae60; --warning: #f39c12; --danger: #e74c3c; }
  .bom-table-container { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
  .bom-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .bom-table th, .bom-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
  .bom-table th { background: var(--background); font-weight: 600; color: var(--text); }
  /* Ensure rows in the main BOM table use the same white background as the other table
     The parts table below uses .table-row; rows in the build table use class="row" so
     target both class patterns here. */
  .bom-table .table-row,
  .bom-table tbody tr.row,
  .bom-table tbody tr.row.even,
  .bom-table tbody tr.row.odd {
    background: #fff;
  }
  .bom-table tr:hover { background: #f8f9fa; }

  /* Remove double-thick bottom border: the container (.bom-table-container) already has
     a 1px border, so hide the bottom border on the table's last row to avoid two adjacent
     borders appearing thicker. */
  .bom-table tbody tr:last-child td {
    border-bottom: none;
  }
  .part-description { font-size: 0.75rem; color: var(--secondary); margin-top: 0.25rem; }
  .workflow-badge { display: inline-flex; align-items: center; padding: 0.375rem 0.75rem; border-radius: 4px; font-size: 0.8125rem; font-weight: 500; background: var(--background); border: 1px solid var(--border); height: 32px; }
  .workflow-purchase { background: #fff8e1; color: #f57f17; border-color: #ffcc02; }
  .no-data { color: var(--secondary); font-style: italic; }
  .btn-yellow { background: #FFD700; color: #333; height: 40px; }
  .btn-yellow:hover { background: #FFC107; }
  .btn-outline-danger { background: #fff5f5; color: #e74c3c; border: 1px solid #e74c3c; }
  .btn-outline-danger:hover { background: #ffe8e8; }
  .add-btn { min-width: 80px; }
  .type-dropdown { padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8125rem; background: white; cursor: pointer; height: 32px; }
  .type-cots { background: #fff8e1 !important; color: #f57f17 !important; border-color: #ffcc02 !important; }
  .type-manufactured { background: #e1f5fe !important; color: #0277bd !important; border-color: #81d4fa !important; }
  .bounding-box { font-family: monospace; font-size: 0.75rem; }
  .no-stock { color: var(--secondary); font-style: italic; }
  .workflow-dropdown { padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8125rem; background: var(--background); color: var(--text); cursor: pointer; height: 32px; }
  .workflow-dropdown.workflow-3d-print { background: #e3f2fd; color: #1565c0; border-color: #90caf9; }
  .workflow-dropdown.workflow-laser-cut { background: #fff3e0; color: #ef6c00; border-color: #ffcc02; }
  .workflow-dropdown.workflow-lathe { background: #f3e5f5; color: #7b1fa2; border-color: #ce93d8; }
  .workflow-dropdown.workflow-mill { background: #e8f5e8; color: #388e3c; border-color: #a5d6a7; }
  .workflow-dropdown.workflow-router { background: #fce4ec; color: #c2185b; border-color: #f8bbd9; }
  select { padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8125rem; background: white; cursor: pointer; height: 32px; }
  /* Edit button should match the COTS chip height and corner radius */
  /* Stronger selector to override global .btn rules so default state is visible */
  button.btn.btn-sm.chip-edit,
  .actions > .chip-edit {
    display: inline-flex !important;
    align-items: center !important;
    gap: 0.35rem !important;
    padding: 0.375rem 0.75rem !important;
    height: 32px !important;
    border-radius: 4px !important;
    font-size: 0.8125rem !important;
    font-weight: 500 !important;
    border: 1px solid #d1d5db !important; /* visible subtle border */
    background: #f3f4f6 !important; /* light grey */
    color: #374151 !important; /* darker text for contrast */
    cursor: pointer !important;
    transition: background 120ms ease, transform 80ms ease, box-shadow 120ms ease !important;
    box-shadow: none !important;
  }
  button.btn.btn-sm.chip-edit:hover,
  .actions > .chip-edit:hover {
    background: #e6e7e9 !important;
    transform: translateY(-1px) !important;
  }
  button.btn.btn-sm.chip-edit:focus,
  .actions > .chip-edit:focus {
    outline: 3px solid rgba(37,99,235,0.12) !important;
    box-shadow: 0 0 0 3px rgba(37,99,235,0.08) !important;
  }
</style>
