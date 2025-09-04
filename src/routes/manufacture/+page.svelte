<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { goto } from '$app/navigation';
  import { PUBLIC_ONSHAPE_BASE_URL } from '$env/static/public';
  import { Search, Filter, Clock, Truck, Package, Download, Zap, Wrench, FileText, Upload, ExternalLink } from 'lucide-svelte';
  
  let parts = [];
  let filteredParts = [];
  let loading = true;
  let user = null;
  let searchTerm = '';
  let filterWorkflow = '';
  let filterStatus = '';
  let toastMessage = '';
  let showToast = false;
  
  const workflows = [
    { value: 'laser-cut', label: 'Laser Cut', icon: Zap },
    { value: 'router', label: 'Router', icon: Wrench },
    { value: 'lathe', label: 'Lathe', icon: FileText },
    { value: 'mill', label: 'Mill', icon: FileText },
    { value: '3d-print', label: '3D Print', icon: Upload }
  ];
  
  // Include all DB-allowed statuses for filtering
  const statuses = [
    { value: 'pending', label: 'Pending' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'cammed', label: 'Cammed' },
    { value: 'machined', label: 'Machined' },
    { value: 'inspected', label: 'Inspected' },
    { value: 'complete', label: 'Complete' }
  ];

  import ROUTER_FLOW from '$lib/router_flow.json';

  onMount(async () => {
    // Hydrate from UUID and keep local var in sync
    const unsub = userStore.subscribe((v) => { user = v; });
    await loadUserFromUUID(supabase);

    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    if (!session && !user) {
      loading = false;
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

  // Fixed drag and drop handlers for better Vercel compatibility (kept for potential future use)
  function handleDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add('active');
  }

  function handleDragLeave(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('active');
  }

  async function loadParts() {
    try {
      // Query the parts table directly
      const { data, error } = await supabase
        .from('parts')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      // Transform the data to include source_type for compatibility
      const transformedData = data.map(part => ({
        ...part,
        source_type: part.is_onshape_part ? 'onshape_api' : 'file_upload'
      }));
      
      parts = transformedData || [];
    } catch (error) {
      console.error('Error loading parts:', error);
      alert('Error loading parts. Please try again.');
    } finally {
      loading = false;
    }
  }

  async function downloadFile(part, currentStatus) {
    try {
      // If part is still "pending", automatically mark it as "in-progress"
      if (currentStatus === 'pending') {
        await updatePartStatus(part.id, 'in-progress');
      }
      // If this part requires a drawing (lathe/mill) we no longer generate or download PDFs.
      // Instead, open the subsystem/document for the part.
      if (part.workflow === 'lathe' || part.workflow === 'mill') {
        await openSubsystemDocument(part);
        return;
      }

      if (part.source_type === 'onshape_api') {
        // Handle Onshape API download for non-drawing exports
        await downloadFromOnshape(part);
      } else {
        // Handle storage bucket download (legacy parts created via create route)
        await downloadFromStorage(part.file_name, part.id);
      }
    } catch (error) {
      console.error('Error downloading file:', error);
      alert(`Error downloading file: ${error.message}`);
    }
  }

  async function downloadFromOnshape(part) {
    try {
      // Special handling for laser cutter - download SVG instead of STEP
      if (part.workflow === 'laser-cut') {
        await downloadSVGForLaser(part);
        return;
      }

      // Note: lathe/mill drawing PDF generation has been removed. Those parts should
      // open the subsystem/document page instead (handled earlier in downloadFile or via UI).

      // Use the new translation workflow for both STL and STEP
      const action = 'translate-part';
      
      // Build the API URL
      const params = new URLSearchParams({
        action: action,
        documentId: part.onshape_document_id,
        elementId: part.onshape_element_id,
        partId: part.onshape_part_id,
        wvm: part.onshape_wvm,
        wvmId: part.onshape_wvmid,
        format: part.file_format === 'stl' ? 'STL' : 'STEP'
      });
      
      showToastMessage('Download requested...');
      
      const response = await fetch(`/api/onshape?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Create blob and download
      const blob = await response.blob();
      const fileExt = part.file_format === 'stl' ? 'stl' : 'step';
      const fileName = `${part.name.replace(/[^a-zA-Z0-9]/g, '_')}.${fileExt}`;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      showToastMessage(`${fileExt.toUpperCase()} file downloaded successfully!`);
    } catch (error) {
      console.error('Error downloading from Onshape:', error);
      showToastMessage(`Error downloading file: ${error.message}`);
      throw error;
    }
  }

  async function downloadFromStorage(fileName, partId) {
    try {
      showToastMessage('Download requested...');
      
      // Try to create signed URL for the filename as stored
      let { data, error } = await supabase.storage
        .from('manufacturing-files')
        .createSignedUrl(fileName, 60); // URL expires in 60 seconds
      
      // If that fails, it might be URL encoded, so try decoding it
      if (error && error.message.includes('Object not found')) {
        const decodedFileName = decodeURIComponent(fileName);
        const result = await supabase.storage
          .from('manufacturing-files')
          .createSignedUrl(decodedFileName, 60);
        data = result.data;
        error = result.error;
      }
      
      if (error) throw error;
      
      // Open the signed URL in a new tab
      window.open(data.signedUrl, '_blank');
      showToastMessage('File download started!');
    } catch (error) {
      console.error('Error downloading from storage:', error);
      showToastMessage(`Error downloading file: ${error.message}`);
      throw new Error(`Error downloading file: ${error.message}. The file may have been deleted or the filename may be incorrect.`);
    }
  }

  // Manufacture Actions Helpers

  async function updatePartStatus(partId, newStatus) {
    try {
      const { error } = await supabase
        .from('parts')
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq('id', partId);
      
      if (error) throw error;
      await loadParts();
    } catch (error) {
      console.error('Error updating part status:', error);
      alert('Error updating part status. Please try again.');
    }
  }

  async function completePart(partId, deliveryMethod, kittingBin = '') {
    try {
      const updateData = {
        status: 'complete',
        delivered: deliveryMethod === 'delivered',
        updated_at: new Date().toISOString()
      };
      
      if (deliveryMethod === 'kitting-bin' && kittingBin) {
        updateData.kitting_bin = kittingBin;
      }
      
      const { error } = await supabase
        .from('parts')
        .update(updateData)
        .eq('id', partId);
      
      if (error) throw error;
      await loadParts();
    } catch (error) {
      console.error('Error completing part:', error);
      alert('Error completing part. Please try again.');
    }
  }

  // Helper: persist the latest bin entry (store in kitting_bin per spec "last value")
  async function updateBin(partId, bin) {
    try {
      if (!bin) return;
      const { error } = await supabase
        .from('parts')
        .update({ kitting_bin: bin, updated_at: new Date().toISOString() })
        .eq('id', partId);
      if (error) console.warn('updateBin error:', error.message);
    } catch (e) {
      console.warn('updateBin exception:', e?.message || e);
    }
  }

  // Router meta helpers: persist fine-grained router workflow without DB schema changes
  function getRouterMeta(part) {
    try {
      const root = JSON.parse(part.file_url || '{}');
      return root && root.router_meta ? root.router_meta : {};
    } catch {
      return {};
    }
  }
  async function updateRouterMeta(part, updates) {
    try {
      let root = {};
      try {
        root = JSON.parse(part.file_url || '{}') || {};
      } catch {
        root = {};
      }
      root.router_meta = { ...(root.router_meta || {}), ...updates };
      const { error } = await supabase
        .from('parts')
        .update({ file_url: JSON.stringify(root), updated_at: new Date().toISOString() })
        .eq('id', part.id);
      if (error) console.warn('updateRouterMeta error:', error.message);
      await loadParts();
    } catch (e) {
      console.warn('updateRouterMeta exception:', e?.message || e);
    }
  }
  // Router flow helpers (new) - definitions moved earlier in file for JSON-based flow

  // Open the subsystem page or linked Onshape document for parts that require drawings
  async function openSubsystemDocument(part) {
    try {
      // Prefer navigating to the subsystem page if we have a subsystem_id
      if (part.subsystem_id) {
        const url = `/cad/${part.subsystem_id}`;
        window.open(url, '_blank', 'noopener');
        return;
      }

      // If we have Onshape params in the DB, open the Onshape web UI directly.
      // Use drawing element id when available (onshape_drawing_element_id),
      // otherwise fall back to the primary element id.
      if (part.onshape_document_id && (part.onshape_wvmid || part.onshape_wvm) && (part.onshape_drawing_element_id || part.onshape_element_id)) {
        try {
          const baseUrl = PUBLIC_ONSHAPE_BASE_URL || 'https://cad.onshape.com';
          const documentId = part.onshape_document_id;
          const wvm = part.onshape_wvm || 'w'; // expected 'w'|'v'|'m'
          const wvmId = part.onshape_wvmid;
          const elementId = part.onshape_drawing_element_id || part.onshape_element_id;

          // Construct URL like: https://cad.onshape.com/documents/{documentId}/{wvm}/{wvmId}/e/{elementId}
          const url = `${baseUrl.replace(/\/$/, '')}/documents/${encodeURIComponent(documentId)}/${encodeURIComponent(wvm)}/${encodeURIComponent(wvmId)}/e/${encodeURIComponent(elementId)}`;
          window.open(url, '_blank', 'noopener');
          return;
        } catch (err) {
          console.error('Error constructing Onshape URL:', err);
        }
      }

      // If we have an Onshape document id but couldn't open the web UI directly,
      // try to find a linked subsystem and navigate there as a fallback.
      if (part.onshape_document_id) {
        try {
          const { data: subsystems, error } = await supabase
            .from('subsystems')
            .select('id')
            .eq('onshape_document_id', part.onshape_document_id)
            .limit(1);

          if (!error && subsystems && subsystems.length > 0) {
            const url = `/cad/${subsystems[0].id}`;
            window.open(url, '_blank', 'noopener');
            return;
          }
        } catch (err) {
          console.error('Error querying subsystems for document id:', err);
        }

        // If we couldn't find a subsystem, open the CAD landing page where users can locate the document
        window.open('/cad', '_blank', 'noopener');
        return;
      }

      alert('No subsystem or document found for this part.');
    } catch (error) {
      console.error('Error opening subsystem document:', error);
      alert('Unable to open subsystem document.');
    }
  }

  function getWorkflowLabel(workflow) {
    const found = workflows.find(w => w.value === workflow);
    return found ? found.label : workflow;
  }

  function getWorkflowIcon(workflow) {
    const found = workflows.find(w => w.value === workflow);
    return found ? found.icon : FileText;
  }

  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString();
  }

  function getStatusDisplay(part) {
    // Router: reflect sub-steps using router_meta; prefer sub-step label if present
    if (part.workflow === 'router') {
      const meta = getRouterMeta(part);
      if (meta?.step && ROUTER_FLOW.labels[meta.step]) {
        return ROUTER_FLOW.labels[meta.step];
      }
      if (part.status === 'cammed') {
        return meta?.travis_progged ? 'TProged' : 'Cammed';
      }
    }

    // Lathe/Mill: map "machined" to human-readable "Needs Inspection"
    if ((part.workflow === 'lathe' || part.workflow === 'mill') && part.status === 'machined') {
      return 'Needs Inspection';
    }

    if (part.status === 'complete') {
      if (part.kitting_bin) {
        return part.kitting_bin;
      } else if (part.delivered) {
        return 'Delivered';
      }
      return 'Complete';
    }
    return part.status;
  }

  function getStatusBadgeClass(status) {
    if (status === 'in-progress') return 'status-progress';
    if (status === 'machined' || status === 'inspected') return 'status-progress';
    if (status === 'cammed') return 'status-cammed';
    if (status === 'complete') return 'status-complete';
    return 'status-pending';
  }

  async function exportToCSV() {
    try {
      // Fetch all parts data from the parts table
      const { data, error } = await supabase
        .from('parts')
        .select('*')
        .order('created_at', { ascending: false });
      
      if (error) throw error;
      
      if (!data || data.length === 0) {
        alert('No parts data to export.');
        return;
      }
      
      // Define CSV headers
      const headers = [
        'ID',
        'Name',
        'Requester',
        'Project ID',
        'Workflow',
        'Quantity',
        'Material',
        'Status',
        'Source Type',
        'File Name',
        'File Format',
        'Onshape Document ID',
        'Onshape Version',
        'Kitting Bin',
        'Delivered',
        'Created Date',
        'Updated Date'
      ];
      
      // Convert data to CSV format
      const csvContent = [
        headers.join(','), // Header row
        ...data.map(part => [
          part.id || '',
          `"${(part.name || '').replace(/"/g, '""')}"`, // Escape quotes
          `"${(part.requester || '').replace(/"/g, '""')}"`,
          `"${(part.project_id || '').replace(/"/g, '""')}"`,
          part.workflow || '',
          part.quantity || 1,
          `"${(part.material || '').replace(/"/g, '""')}"`,
          part.status || '',
          part.source_type || '',
          `"${(part.file_name || '').replace(/"/g, '""')}"`,
          part.file_format || '',
          part.onshape_document_id || '',
          part.onshape_wvmid || '',
          `"${(part.kitting_bin || '').replace(/"/g, '""')}"`,
          part.delivered ? 'Yes' : 'No',
          part.created_at ? new Date(part.created_at).toLocaleString() : '',
          part.updated_at ? new Date(part.updated_at).toLocaleString() : ''
        ].join(','))
      ].join('\n');
      
      // Create and download the file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      
      link.setAttribute('href', url);
      link.setAttribute('download', `parts_export_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      
    } catch (error) {
      console.error('Error exporting CSV:', error);
      alert('Error exporting data. Please try again.');
    }
  }

  // Reactive statement that filters parts when search term, filters, or parts array changes
  $: filteredParts = parts.filter(part => {
    const matchesSearch = !searchTerm || 
      part.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      part.requester.toLowerCase().includes(searchTerm.toLowerCase()) ||
      part.project_id.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesWorkflow = !filterWorkflow || part.workflow === filterWorkflow;
    const matchesStatus = !filterStatus || part.status === filterStatus;
    
    return matchesSearch && matchesWorkflow && matchesStatus;
  });

  // Toast notification functions
  function showToastMessage(message) {
    toastMessage = message;
    showToast = true;
    
    // Auto-hide after 3 seconds
    setTimeout(() => {
      showToast = false;
    }, 3000);
  }

  // SVG download function for laser cutter
  async function downloadSVGForLaser(part) {
    try {
      showToastMessage('Download requested - Converting to SVG...');
      
      // Build the API URL for SVG conversion
      const params = new URLSearchParams({
        action: 'convert-to-svg',
        documentId: part.onshape_document_id,
        elementId: part.onshape_element_id,
        partId: part.onshape_part_id,
        wvm: part.onshape_wvm,
        wvmId: part.onshape_wvmid
      });
      
      const response = await fetch(`/api/onshape?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }
      
      // Create blob and download SVG
      const blob = await response.blob();
      const fileName = `${part.name.replace(/[^a-zA-Z0-9]/g, '_')}.svg`;
      
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      showToastMessage('SVG file downloaded successfully!');
    } catch (error) {
      console.error('Error downloading SVG:', error);
      showToastMessage(`Error downloading SVG: ${error.message}`);
    }
  }
</script>

<svelte:head>
  <title>Parts List - Manufacturing Management</title>
</svelte:head>

<div class="page-header">
  <h1>Parts List</h1>
  <div class="page-actions">
    <a href="/create" class="btn btn-primary" style="text-decoration: none; display: inline-flex; align-items: center; gap: 8px;">
      <Upload size={16} />
      Create New Part
    </a>
    <button
      class="btn btn-secondary"
      on:click={exportToCSV}
      style="display: inline-flex; align-items: center; gap: 8px;"
    >
      <Download size={16} />
      Export CSV
    </button>
  </div>
</div>

<!-- Manufacture Sub-Tabs -->
<div class="subtabs">
  <a href="/manufacture" class:active={$page.url.pathname === '/manufacture'}>All</a>
  <a href="/manufacture/router" class:active={$page.url.pathname === '/manufacture/router'}>Router</a>
</div>

<div class="card">
  <div class="filters">
    <div class="form-group">
      <label class="form-label">
        <Search size={16} />
        Search
      </label>
      <input
        type="text"
        class="form-input"
        placeholder="Search by name, requester, or project ID..."
        bind:value={searchTerm}
      />
    </div>
    
    <div class="form-group">
      <label class="form-label">
        <Filter size={16} />
        Workflow
      </label>
      <select class="form-select" bind:value={filterWorkflow}>
        <option value="">All Workflows</option>
        {#each workflows as workflow}
          <option value={workflow.value}>{workflow.label}</option>
        {/each}
      </select>
    </div>
    
    <div class="form-group">
      <label class="form-label">
        <Filter size={16} />
        Status
      </label>
      <select class="form-select" bind:value={filterStatus}>
        <option value="">All Statuses</option>
        {#each statuses as status}
          <option value={status.value}>{status.label}</option>
        {/each}
      </select>
    </div>
  </div>
</div>

{#if loading}
  <div class="card">
    <p>Loading parts...</p>
  </div>
{:else if filteredParts.length === 0}
  <div class="card">
    <p>No parts found. {parts.length === 0 ? 'Create your first part!' : 'Try adjusting your filters.'}</p>
  </div>
{:else}
  <div class="table-container">
    <table class="table">
      <thead>
        <tr>
          <th class="name-col">Name</th>
          <th>Workflow</th>
          <th class="mono">Project ID</th>
          <th>Qty</th>
          <th>Stock</th>
          <th class="source-col">Source</th>
          <th>Status</th>
          <th>Bin</th>
          <th>Created</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredParts as part (part.id)}
          <tr>
            <td class="name-col"><strong>{part.name}</strong></td>
            <td>
              <div class="workflow-badge workflow-{part.workflow || 'mill'}">
                {getWorkflowLabel(part.workflow)}
              </div>
            </td>
            <td class="mono">{part.project_id}</td>
            <td>{part.quantity || 1}</td>
            <td class="text-muted">{part.stock_assignment || part.material || '-'}</td>
            <td class="source-col">
              {#if part.source_type === 'onshape_api'}
                <div class="source-cell">
                  <span class="source-tag">
                    {#if part.workflow === 'laser-cut'}
                      SVG
                    {:else if part.workflow === 'lathe' || part.workflow === 'mill'}
                      PDF
                    {:else}
                      {part.file_format === 'stl' ? 'STL' : 'STEP'}
                    {/if}
                  </span>
                  {#if part.workflow === 'lathe' || part.workflow === 'mill'}
                    <!-- For drawings, show open-document action instead of downloading a PDF -->
                    <button class="btn btn-secondary btn-icon" aria-label="Open document" title="Open document" on:click={() => openSubsystemDocument(part)}>
                      <ExternalLink size={16} />
                    </button>
                  {:else}
                    <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click={() => downloadFile(part, part.status)}>
                      <Download size={16} />
                    </button>
                  {/if}
                </div>
              {:else if part.file_name}
                <div class="source-cell">
                  <span class="file-label">{part.file_name}</span>
                  <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click={() => downloadFromStorage(part.file_name, part.id)}>
                    <Download size={16} />
                  </button>
                </div>
              {:else}
                <span class="text-muted">-</span>
              {/if}
            </td>
            <td>
              <span class="status-badge {getStatusBadgeClass(part.status)} status-table status-fade">{getStatusDisplay(part)}</span>
            </td>
            <td class="mono">{part.kitting_bin || '-'}</td>
            <td>{formatDate(part.created_at)}</td>
            <td>
              {#if part.status === 'pending'}
                {#if part.workflow === 'router'}
                <button
                  class="btn btn-secondary btn-sm"
                  on:click={async () => { await updatePartStatus(part.id, 'in-progress'); await updateRouterMeta(part, { step: 'cam_ing' }); }}
                  title="Start"
                >
                  <Clock size={14} />
                  Start
                </button>
                {:else}
                <button
                  class="btn btn-secondary btn-sm"
                  on:click={() => updatePartStatus(part.id, 'in-progress')}
                  title="Start Work"
                >
                  <Clock size={14} />
                  Start
                </button>
                {/if}

              {:else if part.status === 'in-progress'}
                {#if part.workflow === 'router'}
                  <!-- Router: CAMed appears when in CAMing sub-step -->
                  {#if getRouterMeta(part).step === 'cam_ing'}
                  <div class="actions-col">
                    <button
                      class="btn btn-secondary btn-sm"
                      on:click={async () => { await updatePartStatus(part.id, 'cammed'); await updateRouterMeta(part, { step: 'layout' }); }}
                      title="CAMed"
                    >
                      CAMed
                    </button>
                  </div>
                  {/if}
                {:else if part.workflow === '3d-print' || part.workflow === 'laser-cut'}
                  <!-- 3D prints and Laser cut: field + Kit (completes) -->
                  <div class="actions-col">
                    <div class="kitting-inline">
                      <input
                        type="text"
                        placeholder="Bin ID"
                        class="form-input kitting-input"
                        on:keydown={(e) => {
                          if (e.key === 'Enter' && e.target.value.trim()) {
                            completePart(part.id, 'kitting-bin', e.target.value.trim());
                          }
                        }}
                      />
                      <button
                        class="btn btn-secondary btn-sm btn-nowrap"
                        on:click={(e) => {
                          const input = e.target.previousElementSibling;
                          if (input && input.value.trim()) {
                            completePart(part.id, 'kitting-bin', input.value.trim());
                          }
                        }}
                        title="Kit and Finish"
                      >
                        <Package size={14} />
                        Kit
                      </button>
                    </div>
                  </div>
                {:else if part.workflow === 'lathe' || part.workflow === 'mill'}
                  <!-- Mill/Lathe: field + Inspection (saves bin, sets to 'machined' = needs inspection) -->
                  <div class="actions-col">
                    <div class="kitting-inline">
                      <input
                        type="text"
                        placeholder="Inspection Bin"
                        class="form-input kitting-input"
                        on:keydown={async (e) => {
                          if (e.key === 'Enter') {
                            const bin = e.target.value.trim();
                            await updateBin(part.id, bin);
                            await updatePartStatus(part.id, 'machined');
                          }
                        }}
                      />
                      <button
                        class="btn btn-secondary btn-sm btn-nowrap"
                        on:click={async (e) => {
                          const input = e.target.previousElementSibling;
                          const bin = input && input.value.trim();
                          await updateBin(part.id, bin || '');
                          await updatePartStatus(part.id, 'machined');
                        }}
                        title="Send to Inspection"
                      >
                        Inspection
                      </button>
                    </div>
                  </div>
                {:else}
                  <!-- Fallback: field + Kit -->
                  <div class="actions-col">
                    <div class="kitting-inline">
                      <input
                        type="text"
                        placeholder="Bin ID"
                        class="form-input kitting-input"
                        on:keydown={(e) => {
                          if (e.key === 'Enter' && e.target.value.trim()) {
                            completePart(part.id, 'kitting-bin', e.target.value.trim());
                          }
                        }}
                      />
                      <button
                        class="btn btn-secondary btn-sm btn-nowrap"
                        on:click={(e) => {
                          const input = e.target.previousElementSibling;
                          if (input && input.value.trim()) {
                            completePart(part.id, 'kitting-bin', input.value.trim());
                          }
                        }}
                        title="Kit and Finish"
                      >
                        <Package size={14} />
                        Kit
                      </button>
                    </div>
                  </div>
                {/if}

              {:else if (part.workflow === 'lathe' || part.workflow === 'mill') && part.status === 'machined'}
                <!-- Mill/Lathe when Needs Inspection: field + Kit (finish workflow) -->
                <div class="actions-col">
                  <div class="kitting-inline">
                    <input
                      type="text"
                      placeholder="Kitting Bin"
                      class="form-input kitting-input"
                      on:keydown={(e) => {
                        if (e.key === 'Enter' && e.target.value.trim()) {
                          completePart(part.id, 'kitting-bin', e.target.value.trim());
                        }
                      }}
                    />
                    <button
                      class="btn btn-secondary btn-sm btn-nowrap"
                      on:click={(e) => {
                        const input = e.target.previousElementSibling;
                        if (input && input.value.trim()) {
                          completePart(part.id, 'kitting-bin', input.value.trim());
                        }
                      }}
                      title="Kit and Finish"
                    >
                      <Package size={14} />
                      Kit
                    </button>
                  </div>
                </div>

              {:else if part.workflow === 'router' && part.status === 'cammed'}
                <!-- Router after Cammed per new flow: layout -> TProged -> queued -> Cut -> inspection -> Bin/Kit -->
                {#if getRouterMeta(part).step === 'layout'}
                  <div class="actions-col">
                    <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(part, { travis_progged: true, step: 'queued' })}>TProged</button>
                  </div>
                {:else if getRouterMeta(part).step === 'queued'}
                  <div class="actions-col">
                    <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(part, { step: 'inspection' })}>Cut</button>
                  </div>
                {:else if getRouterMeta(part).step === 'inspection'}
                  <div class="actions-col">
                    <div class="kitting-inline">
                      <input
                        type="text"
                        placeholder="Bin ID"
                        class="form-input kitting-input"
                        on:keydown={(e) => {
                          if (e.key === 'Enter' && e.target.value.trim()) {
                            completePart(part.id, 'kitting-bin', e.target.value.trim());
                          }
                        }}
                      />
                      <button
                        class="btn btn-secondary btn-sm btn-nowrap"
                        on:click={(e) => {
                          const input = e.target.previousElementSibling;
                          if (input && input.value.trim()) {
                            completePart(part.id, 'kitting-bin', input.value.trim());
                          }
                        }}
                        title="Kit and Finish"
                      >
                        <Package size={14} />
                        Kit
                      </button>
                    </div>
                  </div>
                {:else}
                  <!-- Fallback: if no step set, begin at Layout -->
                  <div class="actions-col">
                    <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(part, { step: 'layout' })}>Start Layout</button>
                  </div>
                {/if}

              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<!-- Toast Notification -->
{#if showToast}
  <div class="toast">
    {toastMessage}
  </div>
{/if}

<style>
  /* Uses global .page-header and .page-actions from app.css */

  .filters {
    display: grid;
    grid-template-columns: 2fr 1fr 1fr;
    gap: 1rem;
    margin-bottom: 0.25rem;
  }

  /* Sub tabs */
  .subtabs {
    display: flex;
    gap: 0.5rem;
    margin: 0 0 1rem 0;
  }
  .subtabs a {
    text-decoration: none;
    padding: 0.5rem 0.85rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 0.85rem;
    color: var(--text);
  }
  .subtabs a.active {
    background: var(--accent);
    color: var(--secondary);
  }

  /* --- BOM-style Table Styling --- */
  /* Tables: rely on global .table/.table-container styles */
  .table tr { background: white; }
  .table tbody tr:nth-child(even) { background: #fcfcfc; }

  /* Skinnier columns for Name and Source */
  .table th.name-col,
  .table td.name-col {
    min-width: 144px;
    max-width: 216px;
    width: 1%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .table th.source-col,
  .table td.source-col {
  /* Narrower to reduce wasted space; keep tag + button visible */
  /* slightly wider so source tag + action fit comfortably */
  min-width: 140px;
  max-width: 200px;
  width: 1%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  }

  .mono {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace;
    font-size: 0.9rem;
    overflow-wrap: anywhere;
  }

  .source-cell {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    min-width: 0;
    /* Allow enough room for tag + button; keep ellipsis on overflow */
    max-width: 220px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .btn-icon { border: 1px solid var(--border); background: var(--background); }

  .version-text {
    font-size: 0.75rem;
    color: #666;
  }

  .file-label {
    max-width: 160px;
    display: inline-block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    vertical-align: bottom;
  }

  .actions-col {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 192px;
  }

  .kitting-inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .kitting-input {
  min-width: 120px;
  margin: 0;
  padding: 0 0.75rem;
  height: 32px; /* match badge/button height */
  line-height: 32px;
  border-radius: 4px;
  box-sizing: border-box;
  }

  /* Workflow / tag styles (match BOM muted-outline look) */
  .workflow-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    text-transform: uppercase;
    border: 1px solid;
  }

  /* Hyphenated and non-hyphenated variants to cover both class conventions used across the app */
  .workflow-mill {
    background: #e3f2fd;
    color: #1976d2;
    border-color: #bbdefb;
  }

  .workflow-laser-cut,
  .workflow-lasercut {
    background: #fff3e0;
    color: #f57c00;
    border-color: #ffcc02;
  }

  .workflow-3d-print,
  .workflow-3dprint {
    background: #f3e5f5;
    color: #7b1fa2;
    border-color: #ce93d8;
  }

  .workflow-router {
    background: #e8f5e8;
    color: #388e3c;
    border-color: #a5d6a7;
  }

  .workflow-purchase {
    background: #e8f5e8;
    color: #2e7d32;
    border-color: #4caf50;
  }

  .workflow-lathe {
    background: #fce4ec;
    color: #c2185b;
    border-color: #f48fb1;
  }

  /* Make sure badges that include both classes pick up the colors */
  .workflow-badge.workflow-mill { background: #e3f2fd; color: #1976d2; border-color: #bbdefb; }
  .workflow-badge.workflow-laser-cut { background: #fff3e0; color: #f57c00; border-color: #ffcc02; }
  .workflow-badge.workflow-lasercut { background: #fff3e0; color: #f57c00; border-color: #ffcc02; }
  .workflow-badge.workflow-3d-print { background: #f3e5f5; color: #7b1fa2; border-color: #ce93d8; }
  .workflow-badge.workflow-3dprint { background: #f3e5f5; color: #7b1fa2; border-color: #ce93d8; }
  .workflow-badge.workflow-router { background: #e8f5e8; color: #388e3c; border-color: #a5d6a7; }
  .workflow-badge.workflow-purchase { background: #e8f5e8; color: #2e7d32; border-color: #4caf50; }
  .workflow-badge.workflow-lathe { background: #fce4ec; color: #c2185b; border-color: #f48fb1; }

  /* Source tag: use muted-outline variant to match BOM tags */
  .source-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--secondary);
    border: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    margin-right: 0.25rem;
  }

  /* Status badges: keep compact row height */
  .status-badge.status-table {
    display: inline-flex;
    align-items: center;
    min-width: 80px;
    border: 1px solid var(--border);
    box-sizing: border-box;
    vertical-align: middle;
    overflow: hidden;
    white-space: nowrap;
    background: transparent;
    color: var(--secondary);
  }

  .status-badge.status-table.status-pending { --badge-bg: #fff3e0; background: #fff3e0; color: #f57c00; border-color: #ffcc02; }
  .status-badge.status-table.status-progress { --badge-bg: #e3f2fd; background: #e3f2fd; color: #1976d2; border-color: #bbdefb; }
  .status-badge.status-table.status-cammed { --badge-bg: #f3e5f5; background: #f3e5f5; color: #7b1fa2; border-color: #ce93d8; }
  .status-badge.status-table.status-complete { --badge-bg: #e8f5e8; background: #e8f5e8; color: var(--success); border-color: #a5d6a7; }

  /* Unified tag/button sizing to keep consistent height, padding and corner radius (BOM-like) */
  .workflow-badge,
  .source-tag,
  .status-badge.status-table,
  .btn-icon {
    height: 32px;
    min-height: 32px;
    padding: 0 0.75rem;
    border-radius: 4px;
    font-size: 0.8125rem;
    line-height: 1;
    box-sizing: border-box;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
  }

  /* Make Kit/Bin controls match badge sizing and corner radius */
  .kitting-inline .btn,
  .kitting-inline .btn.btn-sm,
  .actions-col .btn,
  .actions-col .btn.btn-sm {
    height: 32px;
    min-height: 32px;
    padding: 0 0.75rem;
    border-radius: 4px;
    display: inline-flex;
    align-items: center;
    gap: 0.375rem;
    font-size: 0.8125rem;
    box-sizing: border-box;
  }

  /* Prevent workflow labels from wrapping */
  .workflow-badge {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* Make source button icons larger */
  :global(.btn-icon svg) {
    width: 16px;
    height: 16px;
  }

  /* Force icon size in source cell buttons in case of global overrides */
  .source-col .source-cell .btn.btn-icon :global(svg) {
    width: 16px !important;
    height: 16px !important;
    min-width: 16px;
    min-height: 16px;
    transform: none !important;
    flex: 0 0 auto;
  }

  /* And make the small action icons (Kit/Inspection/etc.) match the same visual size */
  :global(.actions-col .btn svg),
  :global(.kitting-inline .btn svg) {
    width: 18px;
    height: 18px;
  }

  .text-muted { color: #6b7280; }

  .file-input-hidden {
    display: none;
  }

  /* Toast Notification Styles */
  .toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--secondary);
    color: var(--primary);
    padding: 12px 24px;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    z-index: 1000;
    font-weight: 500;
    animation: slideUp 0.3s ease-out;
  }

  /* Table header: slight dark gray background like BOM and remove thick separator */
  .table thead th {
    background: var(--background);
    color: var(--text);
    font-weight: 600;
    border-bottom: none;
  }

  @keyframes slideUp {
    from {
      opacity: 0;
      transform: translateX(-50%) translateY(20px);
    }
    to {
      opacity: 1;
      transform: translateX(-50%) translateY(0);
    }
  }

  @media (max-width: 900px) {
    .filters {
      grid-template-columns: 1fr;
    }
    .actions-col {
      min-width: auto;
    }
    .table th.name-col,
    .table td.name-col {
      min-width: 80px;
      max-width: 100px;
    }
    .table th.source-col,
    .table td.source-col {
      min-width: 70px;
      max-width: 100px;
    }
    /* Hide Material column on small screens (5th) */
    .table thead th:nth-child(5),
    .table tbody td:nth-child(5) {
      display: none;
    }
    /* Hide Created column on small screens (now 9th after adding Bin) */
    .table thead th:nth-child(9),
    .table tbody td:nth-child(9) {
      display: none;
    }
  }
</style>
