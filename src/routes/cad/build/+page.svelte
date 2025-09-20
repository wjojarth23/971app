<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { Settings, Package, Wrench, CheckCircle, Clock, ExternalLink } from 'lucide-svelte';
  import { goto } from '$app/navigation';

  let user = null;
  let loading = true;
  let builds = [];
  let buildStats = {
    total: 0,
    pending: 0,
    manufacturing: 0,
    ready_to_assemble: 0,
    assembled: 0
  };
  // UI state for project grouping
  let projectOpen = {};
  let groupedBuilds = {};
  let editingProjectName = {};
  let tempProjectName = {};

  // Drag-and-drop handlers
  function onDragStart(e, build) {
    try {
      e.dataTransfer.setData('text/plain', String(build.id));
      e.dataTransfer.setData('application/json', JSON.stringify({ sourcePid: build.project_id || '__NO_PROJECT__' }));
      e.dataTransfer.effectAllowed = 'move';
    } catch (err) { }
  }

  async function dropOnBuild(e, targetBuild) {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId || draggedId === String(targetBuild.id)) return;
    // Always form a new project container for the two builds
    const newPid = `Project-${Math.floor(Math.random()*90000)+10000}`;
    try {
      const { error } = await supabase.from('builds').update({ project_id: newPid }).in('id', [draggedId, targetBuild.id]);
      if (error) throw error;
      await loadBuilds();
      projectOpen = { ...projectOpen, [newPid]: true };
      editingProjectName = { ...editingProjectName, [newPid]: true };
      tempProjectName = { ...tempProjectName, [newPid]: newPid };
    } catch (err) {
      console.error('Failed creating project container:', err);
      alert('Failed to create project container: ' + (err?.message || err));
    }
  }

  async function dropOnProject(e, pid) {
    e.preventDefault();
    e.stopPropagation();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (!draggedId) return;
    try {
      const { error } = await supabase.from('builds').update({ project_id: pid }).eq('id', draggedId);
      if (error) throw error;
      await loadBuilds();
      projectOpen = { ...projectOpen, [pid]: true };
    } catch (err) {
      console.error('Failed assigning build to project:', err);
      alert('Failed to assign build to project: ' + (err?.message || err));
    }
  }

  function allowDrop(e) { e.preventDefault(); }

  // Inline project name editing
  function startEditProjectName(pid) {
    if (pid === '__NO_PROJECT__') return; // don't edit unassigned
    editingProjectName = { ...editingProjectName, [pid]: true };
    tempProjectName = { ...tempProjectName, [pid]: pid };
    projectOpen = { ...projectOpen, [pid]: true };
  }

  async function saveProjectName(oldPid) {
    const newName = (tempProjectName[oldPid] || '').trim();
    if (!newName || newName === oldPid) {
      editingProjectName = { ...editingProjectName, [oldPid]: false };
      return;
    }
    try {
      const { error } = await supabase.from('builds').update({ project_id: newName }).eq('project_id', oldPid);
      if (error) throw error;
      await loadBuilds();
    } catch (err) {
      console.error('Failed renaming project:', err);
      alert('Failed renaming project: ' + (err?.message || err));
    }
  }

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

    await loadBuilds();
    loading = false;
  });  async function loadBuilds() {
    try {
      const { data, error } = await supabase
        .from('builds')
        .select(`
          *,
          subsystems(name, onshape_url)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      builds = data || [];
      
      // Get parts data for each build using build_bom table (same approach as detailed build page)
      for (const build of builds) {
        try {
          // Load BOM snapshot for this build
          const { data: bomData, error: bomErr } = await supabase
            .from('build_bom')
            .select('*')
            .eq('build_id', build.id)
            .order('created_at', { ascending: true });

          let bomSnapshot = [];
          if (!bomErr && bomData) {
            bomSnapshot = bomData;
          }

          // Get BOM rows that have been added to the build
          const addedBomRows = bomSnapshot.filter(row => row.added === true);

          // Collect all related IDs from added BOM rows
          const partsIds = addedBomRows.filter(row => row.parts_id).map(row => row.parts_id);
          const purchasingIds = addedBomRows.filter(row => row.purchasing_id).map(row => row.purchasing_id);
          const kittingIds = addedBomRows.filter(row => row.kitting_id).map(row => row.kitting_id);

          // Fetch actual created items only (no placeholders)
          let partsData = [];
          let purchasingData = [];
          let kittingData = [];

          if (partsIds.length > 0) {
            const { data, error: partsError } = await supabase
              .from('parts')
              .select('*')
              .in('id', partsIds);
            if (!partsError) partsData = data || [];
          }

          if (purchasingIds.length > 0) {
            const { data, error: purchasingError } = await supabase
              .from('purchasing')
              .select('*')
              .in('id', purchasingIds);
            if (!purchasingError) purchasingData = data || [];
          }

          if (kittingIds.length > 0) {
            const { data, error: kittingError } = await supabase
              .from('kitting')
              .select('*')
              .in('id', kittingIds);
            if (!kittingError) kittingData = data || [];
          }

          // Create placeholder entries only for BOM rows that were explicitly added
          // to the build (row.added === true). This ensures progress and cost
          // calculations only measure items the user chose to include.
          const allBomRows = (bomSnapshot || []).filter(r => r.added === true);

          const pendingParts = allBomRows.filter(row =>
            row.part_type === 'manufactured' && !row.parts_id
          ).map(row => ({
            _bom: true,
            bom_id: row.id,
            name: row.part_name,
            part_number: row.part_number || null,
            quantity: row.quantity || 1,
            material: row.material || '',
            workflow: row.workflow || 'mill',
            status: 'needs_approval',
            stock_assignment: row.stock_assignment || null
          }));

          const pendingPurchasing = allBomRows.filter(row =>
            row.part_type === 'COTS' && (row.workflow || 'purchase') === 'purchase' && !row.purchasing_id
          ).map(row => ({
            _bom: true,
            bom_id: row.id,
            name: row.part_name,
            part_number: row.part_number || null,
            quantity: row.quantity || 1,
            material: row.material || '',
            workflow: 'purchase',
            status: 'needs_approval'
          }));

          const pendingKitting = allBomRows.filter(row =>
            row.part_type === 'COTS' && row.workflow === 'kit' && !row.kitting_id
          ).map(row => ({
            _bom: true,
            bom_id: row.id,
            name: row.part_name,
            part_number: row.part_number || null,
            quantity: row.quantity || 1,
            material: row.material || '',
            workflow: 'kit',
            status: 'needs_approval'
          }));

          // Merge placeholders with actual created rows (actuals only fetched for added BOM rows)
          const mergedParts = [...(partsData || []), ...(pendingParts || [])];
          const mergedPurchasing = [...(purchasingData || []), ...(pendingPurchasing || [])];
          const mergedKitting = [...(kittingData || []), ...(pendingKitting || [])];

          build.parts = mergedParts;
          build.purchasing = mergedPurchasing;
          build.kitting = mergedKitting;

          // Compute purchasing cost for this build from merged purchasing rows
          try {
            build.totalPurchasingCost = (mergedPurchasing || []).reduce((sum, p) => {
              const unit = (p.final_price ?? p.price) || 0;
              const qty = p.quantity || 1;
              return sum + (Number(unit) * Number(qty));
            }, 0);
          } catch (e) { build.totalPurchasingCost = 0; }
        } catch (e) {
          console.error(`Error loading parts for build ${build.id}:`, e);
          build.parts = [];
          build.purchasing = [];
          build.kitting = [];
          build.totalPurchasingCost = 0;
        }
      }
      
      // Calculate stats and update build statuses
      buildStats = {
        total: builds.length,
        pending: 0,
        manufacturing: 0,
        ready_to_assemble: 0,
        assembled: 0
      };

      // Recalculate and normalize build statuses based on current part states
      for (const build of builds) {
        if (build.status !== 'assembled') {
          const allParts = [...(build.parts || []), ...(build.purchasing || []), ...(build.kitting || [])];
          const hasParts = allParts.length > 0;
          const allComplete = hasParts && allParts.every(p => p.status === 'complete' || p.status === 'delivered' || p.status === 'kitted');
          const anyStarted = hasParts && allParts.some(p => ['in-progress','cammed','ordered','delivered','complete','manufactured','kitted'].includes(p.status));
          let newStatus = 'pending';
            if (allComplete) newStatus = 'ready_to_assemble';
            else if (anyStarted) newStatus = 'manufacturing';
          if (newStatus !== build.status) {
            const { error: updErr } = await supabase.from('builds').update({ status: newStatus }).eq('id', build.id);
            if (!updErr) build.status = newStatus;
          }
        }
        if (build.status === 'pending') buildStats.pending++;
        else if (build.status === 'manufacturing') buildStats.manufacturing++;
        else if (build.status === 'ready_to_assemble') buildStats.ready_to_assemble++;
        else if (build.status === 'assembled') buildStats.assembled++;
      }
      // Build grouping by project_id for UI
      groupedBuilds = {};
      for (const b of builds) {
        const pid = b.project_id || '__NO_PROJECT__';
        if (!groupedBuilds[pid]) groupedBuilds[pid] = [];
        groupedBuilds[pid].push(b);
      }
      // Initialize UI state for each project container after grouping
      for (const pid of Object.keys(groupedBuilds)) {
        // default all project containers to open so cards are visible
        if (projectOpen[pid] === undefined) projectOpen[pid] = true;
        if (editingProjectName[pid] === undefined) editingProjectName[pid] = false;
        if (tempProjectName[pid] === undefined) tempProjectName[pid] = pid;
      }
      // reassign shallow copies so Svelte notices changes to nested objects
      projectOpen = { ...projectOpen };
      editingProjectName = { ...editingProjectName };
      tempProjectName = { ...tempProjectName };

    } catch (error) {
      console.error('Error loading builds:', error);
    }
  }

  async function markAsAssembled(buildId) {
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
      await loadBuilds();
    } catch (error) {
      console.error('Error marking as assembled:', error);
      alert('Failed to mark as assembled');
    }
  }
  // Calculate progress based on BOM rows (each row counts as one part regardless of quantity)
  function getBuildProgress(build) {
    const allParts = [...(build.parts || []), ...(build.purchasing || []), ...(build.kitting || [])];
    if (allParts.length === 0) {
      return {
        percent: 0,
        manufactured: 0,
        total: 0,
        status: 'No parts',
        mfgPercent: 0,
        purPercent: 0,
        kitPercent: 0,
        mfgCount: { complete: 0, total: 0 },
        purCount: { complete: 0, total: 0 },
        kitCount: { complete: 0, total: 0 }
      };
    }

    // For row-based progress we treat each item in the merged lists as one row
    // (this matches the BOM rows shown to users). Ignore per-row quantity.
    const manufactured = allParts.filter(item => item.status === 'complete' || item.status === 'delivered' || item.status === 'kitted').length;
    const inProgress = allParts.filter(item => item.status === 'in-progress' || item.status === 'cammed' || item.status === 'ordered').length;

    let status = 'Requested';
    if (manufactured === allParts.length) status = 'Ready to Assemble';
    else if (inProgress > 0 || manufactured > 0) status = 'Manufacturing';

    // Derive per-workflow row counts (row-based)
    const mfgParts = allParts.filter(p => (p.workflow || '').toString() !== 'purchase' && (p.workflow || '').toString() !== 'kit');
    const purParts = allParts.filter(p => (p.workflow || '').toString() === 'purchase');
    const kitParts = allParts.filter(p => (p.workflow || '').toString() === 'kit');

    const mfgComplete = mfgParts.filter(p => p.status === 'complete' || p.status === 'manufactured').length;
    const purComplete = purParts.filter(p => p.status === 'delivered').length;
    const kitComplete = kitParts.filter(p => p.status === 'kitted').length;

    return {
      percent: Math.round((manufactured / allParts.length) * 100),
      manufactured,
      total: allParts.length,
      inProgress,
      status,
      mfgPercent: mfgParts.length ? Math.round((mfgComplete / mfgParts.length) * 100) : 0,
      purPercent: purParts.length ? Math.round((purComplete / purParts.length) * 100) : 0,
      kitPercent: kitParts.length ? Math.round((kitComplete / kitParts.length) * 100) : 0,
      mfgCount: { complete: mfgComplete, total: mfgParts.length },
      purCount: { complete: purComplete, total: purParts.length },
      kitCount: { complete: kitComplete, total: kitParts.length }
    };
  }
</script>

<svelte:head>
  <title>Build Center - 971 Hub</title>
</svelte:head>

{#if loading}
  <div class="loading-container">
    <div class="loading-spinner"></div>
    <p>Loading...</p>
  </div>
{:else if user}
  <div class="build-container">
    <div class="page-header">
      <div class="header-content">
        <Settings size={32} />
        <div>
          <h1>Build Center</h1>
          <p>Manage build configurations and assembly processes</p>
        </div>
      </div>
    </div>

    <!-- Build Statistics -->
    <div class="stats-grid">
      <div class="stat-card">
        <Package size={24} />
        <div class="stat-info">
          <h3>{buildStats.total}</h3>
          <p>Total Builds</p>
        </div>
      </div>
      <div class="stat-card">
        <Clock size={24} />
        <div class="stat-info">
          <h3>{buildStats.pending}</h3>
          <p>Pending</p>
        </div>
      </div>
      <div class="stat-card">
        <Wrench size={24} />
        <div class="stat-info">
          <h3>{buildStats.manufacturing}</h3>
          <p>Manufacturing</p>
        </div>
      </div>
      <div class="stat-card">
        <CheckCircle size={24} />
        <div class="stat-info">
          <h3>{buildStats.ready_to_assemble}</h3>
          <p>Ready to Assemble</p>
        </div>
      </div>
      <div class="stat-card">
        <CheckCircle size={24} />
        <div class="stat-info">
          <h3>{buildStats.assembled}</h3>
          <p>Assembled</p>
        </div>
      </div>
    </div>

    <!-- Active Builds grouped by Project -->
    <div class="build-sections">
      <section class="section">
        <h2>All Builds</h2>
        {#if builds.length > 0}
          {#each Object.keys(groupedBuilds) as pid}
            {@const human = pid === '__NO_PROJECT__' ? 'Unassigned' : pid}
            {@const projectBuilds = groupedBuilds[pid]}
            {@const projectTotalCost = projectBuilds.reduce((s,b) => s + (b.totalPurchasingCost || 0), 0)}
            {@const projectPartsCount = projectBuilds.reduce((s,b) => s + (((b.parts||[]).length || 0) + ((b.purchasing||[]).length || 0) + ((b.kitting||[]).length || 0)), 0)}
            <div class="project-container" role="group" on:drop={(e) => dropOnProject(e, pid)} on:dragover={allowDrop} on:dragenter={allowDrop}>
              <div class="project-header" on:click={() => { if (pid !== '__NO_PROJECT__') projectOpen = { ...projectOpen, [pid]: !projectOpen[pid] }; }} on:keydown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && pid !== '__NO_PROJECT__') { projectOpen = { ...projectOpen, [pid]: !projectOpen[pid] }; } }} role="button" tabindex="0">
                <div>
                  <strong class="project-name">{human}</strong>
                  <div class="project-meta">{projectBuilds.length} builds • {projectPartsCount} parts • Total cost: ${projectTotalCost.toFixed(2)}</div>
                </div>
                <div class="project-actions">
                  {#if pid === '__NO_PROJECT__'}
                    <span class="muted">Unassigned</span>
                  {:else}
                    {#if editingProjectName[pid]}
                      <input class="form-input" bind:value={tempProjectName[pid]} on:keydown={(e) => { if (e.key === 'Enter') saveProjectName(pid); }} />
                      <button class="btn btn-sm" on:click={() => saveProjectName(pid)}>Save</button>
                      <button class="btn btn-sm" on:click={() => { editingProjectName[pid] = false; }}>Cancel</button>
                    {:else}
                      <button class="btn btn-sm" on:click|stopPropagation={() => startEditProjectName(pid)}>Rename</button>
                    {/if}
                  {/if}
                </div>
              </div>
              {#if projectOpen[pid]}
                    <div class="builds-grid">
                  {#each projectBuilds as build}
                    {@const progress = getBuildProgress(build)}
        <div class="build-card status-{build.status}"
          draggable="true"
          on:dragstart|stopPropagation={(e) => onDragStart(e, build)}
          on:drop|stopPropagation={(e) => dropOnBuild(e, build)}
          on:dragover|stopPropagation={allowDrop}
          on:dragenter|stopPropagation={allowDrop}
          on:click={() => goto(`/cad/build/${build.id}`)}
          on:keydown={(e) => e.key === 'Enter' && goto(`/cad/build/${build.id}`)}
          role="button"
          tabindex="0">
                      <div class="build-header">
                        <div class="icon-wrap"><Package size={18} /></div>
                        <div class="build-info">
                          <h3>{build.subsystems?.name || 'Unknown'} · {build.release_name}</h3>
                          <p>Build #{build.build_hash?.split('_')[1] || 'N/A'}</p>
                        </div>
                        <span class="status-badge status-{build.status}">
                          {#if build.status === 'pending'}
                            <Clock size={14} /> Pending
                          {:else if build.status === 'manufacturing'}
                            <Wrench size={14} /> in progress
                          {:else if build.status === 'ready_to_assemble'}
                            <CheckCircle size={14} /> Ready
                          {:else if build.status === 'assembled'}
                            <CheckCircle size={14} /> Assembled
                          {/if}
                        </span>
                      </div>

                      <div class="progress-section">
                        <div class="progress-row">
                          <span class="progress-label">Manufacturing</span>
                          <div class="progress-bar small">
                            <div class="progress-fill mfg" style="width: {progress.mfgPercent}%"></div>
                          </div>
                          <span class="progress-count">{progress.mfgCount.complete}/{progress.mfgCount.total}</span>
                        </div>
                        <div class="progress-row">
                          <span class="progress-label">Purchasing</span>
                          <div class="progress-bar small">
                            <div class="progress-fill pur" style="width: {progress.purPercent}%"></div>
                          </div>
                          <span class="progress-count">{progress.purCount.complete}/{progress.purCount.total}</span>
                        </div>
                        <div class="progress-row">
                          <span class="progress-label">Kitting</span>
                          <div class="progress-bar small">
                            <div class="progress-fill kit" style="width: {progress.kitPercent}%"></div>
                          </div>
                          <span class="progress-count">{progress.kitCount.complete}/{progress.kitCount.total}</span>
                        </div>
                      </div>

                      <div class="build-details">
                        <div class="meta">
                          <span>{progress.manufactured}/{progress.total} parts</span>
                          <span>•</span>
                          <span>{progress.percent}%</span>
                          <span>•</span>
                          <span>Created {new Date(build.created_at).toLocaleDateString()}</span>
                        </div>
                        <div style="margin-top:0.5rem; display:flex; gap:0.5rem; align-items:center;">
                          <div class="cost-badge">Cost: ${ (build.totalPurchasingCost || 0).toFixed(2) }</div>
                        </div>
                      </div>

                      <div class="build-actions">
                        <a href="/cad/build/{build.id}" class="btn btn-primary btn-sm">
                          <ExternalLink size={14} />
                          View Details
                        </a>
                        {#if build.subsystems?.onshape_url}
                          <a href={build.subsystems.onshape_url} target="_blank" class="btn btn-secondary btn-sm">
                            <ExternalLink size={14} />
                            View CAD
                          </a>
                        {/if}
                        {#if build.status !== 'assembled'}
                          {@const progress = getBuildProgress(build)}
                          {#if progress.status === 'Ready'}
                            <button class="btn btn-success btn-sm" on:click|stopPropagation={() => markAsAssembled(build.id)}>
                              <CheckCircle size={14} />
                              Build Finished
                            </button>
                          {/if}
                        {/if}
                      </div>
                    </div>
                  {/each}
                </div>
              {/if}
            </div>
          {/each}
      {:else}        <div class="empty-state">
          <Package size={48} />
          <h3>No Builds Yet</h3>
          <p>Builds are automatically created when you add parts from CAD subsystem BOMs.</p>
          <p>To create your first build:</p>
          <ol style="text-align: left; margin: 1rem 0;">
            <li>Go to a CAD subsystem</li>
            <li>Generate or view a BOM</li>
            <li>Add parts to manufacturing or purchasing</li>
            <li>A build will be created automatically</li>
          </ol>
          <a href="/cad" class="btn btn-primary btn-sm">
            Go to CAD Subsystems
          </a>
        </div>
      {/if}
    </section>
  </div>
</div>
{:else}
  <div class="error-container">
    <p>Please log in to access the Build Center.</p>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--background);
    color: var(--text);
  }

  :root {
    --primary: #ffffff;
    --secondary: #1a1a1a;
    --accent: #f1c40f;
    --background: #f8f9fa;
    --border: #e1e5e9;
    --text: #2c3e50;
    --success: #27ae60;
    --warning: #f39c12;
    --danger: #e74c3c;
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
  .build-container { max-width: 1400px; margin: 0 auto; padding: 0 1rem 1rem; }
  .page-header { background: var(--primary); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; margin: 1rem 0; }

  .header-content {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header-content h1 {
    margin: 0;
    color: var(--secondary);
    font-size: 1.25rem;
  }

  .header-content p {
    margin: 0.25rem 0 0 0;
    color: #666;
    font-size: 0.95rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .stat-card {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    box-shadow: var(--shadow-sm);
  }

  .stat-info h3 {
    margin: 0;
    color: var(--secondary);
    font-size: 1.5rem;
  }

  .stat-info p {
    margin: 0.25rem 0 0 0;
    color: #666;
    font-size: 0.9rem;
  }

  .build-sections {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section { background: var(--primary); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; box-shadow: var(--shadow-sm); }

  .section h2 {
    margin: 0 0 0.75rem 0;
    color: var(--secondary);
    font-size: 1.5rem;
  }

  .builds-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }
  .project-container { border: 1px solid var(--border); border-radius: 10px; padding: 0.5rem; margin-bottom: 1rem; background: #fff; }
  .project-header { display:flex; align-items:center; justify-content:space-between; padding:0.5rem; cursor:pointer; }
  .project-name { font-size:1rem; }
  .project-meta { color:#666; font-size:0.9rem; }
  .project-builds { padding:0.5rem 0.25rem; }
  .cost-badge { background:#f3f4f6; padding:0.25rem 0.5rem; border-radius:6px; font-weight:600; }
  .assign-project .form-input { width:140px; }
  .build-card { background: var(--surface, #fff); border: 1px solid var(--border); border-radius: 12px; padding: 0.9rem; transition: box-shadow 0.2s ease, transform 0.15s ease; cursor: pointer; }

  .build-card:hover {
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);
  }

  .build-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .icon-wrap { width: 28px; height: 28px; border-radius: 8px; background: #f3f4f6; display: inline-flex; align-items: center; justify-content: center; color: #6b7280; border: 1px solid #e5e7eb; }

  .build-info {
    flex: 1;
    min-width: 0; /* allow flex child to shrink for truncation */
  }

  .build-info h3 { margin: 0; color: var(--secondary); font-size: 1rem; font-weight: 600; }

  .build-info p {
    margin: 0.25rem 0 0 0;
    color: #666;
    font-size: 0.9rem;
  }

  .status-badge { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.6rem; border-radius: 6px; font-size: 0.78rem; font-weight: 600; border: 1px solid transparent; margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; box-sizing: border-box; }
  .status-badge.status-pending { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .status-badge.status-manufacturing { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .status-badge.status-ready_to_assemble { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
  .status-badge.status-assembled { background: #e8f6ef; color: #11642a; border-color: #a7e0c1; }

  .progress-bar { width: 100%; height: 8px; background: #eef2f7; border-radius: 999px; overflow: hidden; margin-bottom: 0.75rem; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #ffd54f, #ffb300); transition: width 0.3s ease; }
  /* Extended per-category progress styles */
  .progress-section { display: flex; flex-direction: column; gap: 0.35rem; margin-bottom: 0.5rem; }
  .progress-row { display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: 0.5rem; }
  .progress-label { font-size: 0.8rem; color: #6b7280; }
  .progress-count { font-size: 0.8rem; color: #6b7280; }
  .progress-bar.small { height: 8px; background: #eef2f7; border-radius: 999px; overflow: hidden; }
  .progress-fill.mfg { background: linear-gradient(90deg, #27ae60, #2ecc71); }
  .progress-fill.pur { background: linear-gradient(90deg, #ffd54f, #ffb300); }
  .progress-fill.kit { background: linear-gradient(90deg, #9fa8da, #5c6bc0); }

  .build-details .meta { display: flex; gap: 0.5rem; flex-wrap: wrap; color: #6b7280; font-size: 0.85rem; }

  .build-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .empty-state {
    text-align: center;
    padding: 1.5rem;
    color: #666;
  }

  .empty-state h3 {
    margin: 1rem 0;
    color: var(--secondary);
  }

  .empty-state p {
    margin-bottom: 2rem;
    line-height: 1.5;
  }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .tool-card {
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    text-align: center;
    transition: all 0.2s ease;
  }

  .tool-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    border-color: var(--accent);
  }

  .tool-card h3 {
    margin: 0.5rem 0;
    color: var(--secondary);
    font-size: 1.1rem;
  }

  .tool-card p {
    margin: 0 0 1.5rem 0;
    color: #666;
    line-height: 1.5;
  }

  /* Removed unused checklist styles */

  /* Buttons use global styles from app.css */

  .error-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 60vh;
    text-align: center;
  }

  /* Removed per-build parts table styles in favor of compact cards */

  @media (max-width: 768px) {
    .build-container {
      margin: 0;
      padding: 0;
    }

    .page-header {
      padding: 0.75rem;
    }

    .header-content {
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
    }

    .header-content h1 {
      font-size: 1.5rem;
    }

    .section {
      padding: 0.75rem;
    }

    .tools-grid {
      grid-template-columns: 1fr;
    }

    .build-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .build-status {
      align-self: flex-start;
    }
  }
</style>
