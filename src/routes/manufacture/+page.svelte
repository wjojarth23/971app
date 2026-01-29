<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { isTeam9584 } from '$lib/frcTeams.js';
  import { goto } from '$app/navigation';
  import { PUBLIC_ONSHAPE_BASE_URL } from '$env/static/public';
  import { Search, Filter, Clock, Truck, Package, Download, Zap, Wrench, FileText, Upload, ExternalLink, Pencil, Trash2, X, Users } from 'lucide-svelte';
  import ROUTER_FLOW from '$lib/router_flow.json';
  import { getDisplayStatus, BUTTONS, getBadgeClass, getWorkflowStatuses } from '$lib/statuses.js';
  import { TEAM_ROLES } from '$lib/permissions.js';
  import stockData from '$lib/stock.json';
  
  let parts = [];
  let filteredParts = [];
  let loading = true;
  let user = null;
  let searchTerm = '';
  let filterWorkflow = '';
  let filterStatus = '';
  let filterProject = '';
  let toastMessage = '';
  let showToast = false;
  // Kitting bins
  let bins = [];
  let selectedBinMap = {}; // per-part selected bin_id
  let assignedUserNames = {};
  
  // Assign Mode State
  let assignMode = false;
  let rosterMembers = [];
  let draggingUser = null;
  $: canUseAssignMode = (user?.team_role === TEAM_ROLES.MANUFACTURING_LEAD);
  $: if (!canUseAssignMode && assignMode) {
    assignMode = false;
  }
  
  const workflows = [
    { value: 'laser-cut', label: 'Laser Cut', icon: Zap },
    { value: 'router', label: 'Router', icon: Wrench },
    { value: 'lathe', label: 'Lathe', icon: FileText },
    { value: 'mill', label: 'Mill', icon: FileText },
    { value: '3d-print', label: '3D Print', icon: Upload }
  ];
  
  // Include all DB-allowed statuses for filtering (combined from all workflows)
  const statuses = [
    { value: 'pending', label: 'Pending' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'drawing', label: 'Drawing In Progress' },
    { value: 'print-started', label: 'Print Started' },
    { value: 'machining', label: 'Machining' },
    { value: 'inspection', label: 'Inspection' },
    { value: 'cammed', label: 'CAM Reviewed' },
    { value: 'cam_review', label: 'CAM Review Ready' },
    { value: 'machined', label: 'Machined' },
    { value: 'complete', label: 'Complete' }
  ];
  
  // Get workflow-specific statuses for edit modal
  $: editStatusOptions = editWorkflow ? getWorkflowStatuses(editWorkflow) : statuses;

  function getWorkflowClass(workflow) {
    if (!workflow) return 'tag-workflow-default';
    return `tag-workflow-${workflow.toLowerCase().replace(/_/g, '-')}`;
  }
  let showEditModal = false;
  let editPart = null;
  let editStatus = '';
  let editWorkflow = '';
  let editStock = '';
  let editCustomStock = '';
  $: editStockOptions = editWorkflow ? (stockData[editWorkflow] || []).map(s => s.description) : [];
  $: projectIds = Array.from(new Set(parts.filter(p => p.status !== 'complete' && p.project_id).map(p => p.project_id))).sort();

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
    await loadBins();

    loading = false;
  });

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
  await loadAssignedUserNames(parts);
  // Prefill selected bin dropdowns from current values
      for (const p of parts) {
        if (p.kitting_bin) selectedBinMap[p.id] = p.kitting_bin;
      }
    } catch (error) {
      console.error('Error loading parts:', error);
      alert('Error loading parts. Please try again.');
    } finally {
      loading = false;
    }
  }

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

  async function loadAssignedUserNames(partList) {
    const ids = [...new Set(partList.map(part => part.assigned_to).filter(Boolean))];
    if (ids.length === 0) {
      assignedUserNames = {};
      return;
    }

    try {
      const { data, error } = await supabase
        .from('user_profiles')
        .select('id, full_name, email')
        .in('id', ids);

      if (error) throw error;

      assignedUserNames = (data || []).reduce((acc, profile) => {
        acc[profile.id] = profile.full_name || profile.email || 'Assigned';
        return acc;
      }, {});
    } catch (error) {
      console.error('Error loading assigned user names:', error);
      assignedUserNames = {};
    }
  }

  async function loadRosterMembers() {
    try {
      // Load members from "Manufacturing Roles" roster
      // First find the roster
      const { data: rosters } = await supabase
        .from('rosters')
        .select('id')
        .ilike('name', '%Manufacturing Roles%')
        .limit(1);
      
      if (!rosters || rosters.length === 0) return;
      
      const rosterId = rosters[0].id;
      
      // Get entries with user details and keys (roles)
      const { data: entries, error } = await supabase
        .from('roster_entries')
        .select('*, user:user_id(id, full_name, email), key:key_id(key_name, category)')
        .eq('roster_id', rosterId);
        
      if (error) throw error;
      
      rosterMembers = entries || [];
    } catch (err) {
      console.error('Failed to load roster members', err);
    }
  }

  function toggleAssignMode() {
    if (!canUseAssignMode) return;
    assignMode = !assignMode;
    if (assignMode && rosterMembers.length === 0) {
      loadRosterMembers();
    }
  }

  function handleDragStart(e, user) {
    draggingUser = user;
    e.dataTransfer.effectAllowed = 'copy';
    e.dataTransfer.setData('text/plain', JSON.stringify(user));
  }

  function handleDragOver(e) {
    if (!assignMode || !canUseAssignMode) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  }

  async function handleDrop(e, part) {
    if (!assignMode || !canUseAssignMode) return;
    e.preventDefault();
    if (!draggingUser) return;
    
    try {
      const { error } = await supabase
        .from('parts')
        .update({ assigned_to: draggingUser.user_id, updated_at: new Date().toISOString() })
        .eq('id', part.id);
        
      if (error) throw error;
      
      const updatedParts = parts.map(p => {
        if (p.id === part.id) {
          return { ...p, assigned_to: draggingUser.user_id };
        }
        return p;
      });
      parts = updatedParts;
      
      assignedUserNames = {
        ...assignedUserNames,
        [draggingUser.user_id]: draggingUser.user.full_name || draggingUser.user.email
      };
      
      showToastMessage(`Assigned to ${draggingUser.user.full_name || draggingUser.user.email}`);
      await sendNotification('part-assigned', { part_id: part.id });
    } catch (err) {
      console.error('Failed to assign user', err);
      showToastMessage('Failed to assign user');
    } finally {
      draggingUser = null;
    }
  }

  $: filteredRosterMembers = rosterMembers.filter(m => {
    // Filter by workflow tag if selected
    if (!filterWorkflow) return true;
    // Assuming key category or name matches workflow
    // Map workflow values to potential key names/categories
    const workflowMap = {
      'laser-cut': ['laser', 'laser cutter'],
      'router': ['router', 'cnc router'],
      'lathe': ['lathe'],
      'mill': ['mill', 'cnc mill'],
      '3d-print': ['3d print', 'printer']
    };
    
    const keywords = workflowMap[filterWorkflow] || [];
    if (keywords.length === 0) return true;
    
    const keyName = m.key?.key_name?.toLowerCase() || '';
    const category = m.key?.category?.toLowerCase() || '';
    
    return keywords.some(k => keyName.includes(k) || category.includes(k));
  });

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

      // Use the new translation workflow for both STL and STEP (prefer STEP for 3D prints)
      const action = 'translate-part';
      
      // Build the API URL
      const params = new URLSearchParams({
        action: action,
        documentId: part.onshape_document_id,
        elementId: part.onshape_element_id,
        partId: part.onshape_part_id,
        wvm: part.onshape_wvm,
        wvmId: part.onshape_wvmid,
        // Force STEP for 3D-print parts; otherwise fall back to part.file_format or STEP
        format: part.workflow === '3d-print' ? 'STEP' : (part.file_format === 'stl' ? 'STL' : 'STEP')
      });
      
      showToastMessage('Download requested...');
      
      const response = await fetch(`/api/onshape?${params}`);
      
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
      }

      // Create blob and download
      const blob = await response.blob();
      const fileExt = part.workflow === '3d-print' ? 'step' : (part.file_format === 'stl' ? 'stl' : 'step');
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
      if (newStatus === 'complete') {
        await sendNotification('part-complete', { part_id: partId });
      }
      await loadParts();
    } catch (error) {
      console.error('Error updating part status:', error);
      alert('Error updating part status. Please try again.');
    }
  }

  // Load available kitting bins from Supabase
  async function loadBins() {
    try {
      const { data, error } = await supabase
        .from('kitting_bins')
        .select('bin_id, name')
        .order('name', { ascending: true });
      if (error) throw error;
      bins = data || [];
    } catch (err) {
      console.warn('Error loading kitting bins (does table exist?):', err?.message || err);
      bins = [];
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
  // Additional file meta helpers for router STEP/DXF handling
  function getFileMeta(part) {
    try {
      return JSON.parse(part.file_url || '{}') || {};
    } catch {
      return {};
    }
  }

  async function ensureInProgress(part) {
    try {
      if (part?.status === 'pending') {
        await updatePartStatus(part.id, 'in-progress');
      }
    } catch {}
  }

  async function downloadStepFromOnshape(part) {
    await ensureInProgress(part);
    const params = new URLSearchParams({
      action: 'translate-part',
      documentId: part.onshape_document_id,
      elementId: part.onshape_element_id,
      partId: part.onshape_part_id,
      wvm: part.onshape_wvm,
      wvmId: part.onshape_wvmid,
      format: 'STEP'
    });
    const response = await fetch(`/api/onshape?${params}`);
    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP error! status: ${response.status}`);
    }
    const blob = await response.blob();
    const fileName = `${(part.name || 'part').replace(/[^a-zA-Z0-9]/g, '_')}.step`;
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = fileName;
    document.body.appendChild(a); a.click();
    window.URL.revokeObjectURL(url); document.body.removeChild(a);
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
      // Prefer the centralized display mapping
      return getDisplayStatus(part.status, meta);
    }

  // Lathe/Mill: no inspection stage; show raw status

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
  'Stock',
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
          `"${(part.stock_assignment || '').replace(/"/g, '""')}"`,
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

  // Edit modal handlers
  function openEditModal(part) {
    editPart = part;
    // If router part is in the CAM Review Ready pseudo-state, surface that value in the select
    const meta = part.workflow === 'router' ? getRouterMeta(part) : {};
    editStatus = (part.workflow === 'router' && meta.step === 'cam_review') ? 'cam_review' : (part.status || 'pending');
    editWorkflow = part.workflow || '';
    editStock = part.stock_assignment || '';
    editCustomStock = '';
    showEditModal = true;
  }

  // Local state helpers to avoid a full reload after button clicks
  function setLocalRouterMeta(partId, updates) {
    parts = parts.map((p) => {
      if (p.id !== partId) return p;
      let root = {};
      try {
        root = JSON.parse(p.file_url || '{}') || {};
      } catch {
        root = {};
      }
      root.router_meta = { ...(root.router_meta || {}), ...updates };
      return { ...p, file_url: JSON.stringify(root) };
    });
  }

  function setLocalStatus(partId, status) {
    parts = parts.map((p) => (p.id === partId ? { ...p, status } : p));
  }

  // Row click handler: open edit modal when user clicks the row body
  // but ignore clicks that originated on interactive elements (buttons, inputs, links)
  function onRowClick(e, part) {
    try {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) return;
    } catch (err) {
      // defensive: if DOM not available, just return
      return;
    }
    openEditModal(part);
  }

  function onRowKeyDown(e, part) {
    // Only act on Enter or Space
    if (e.key !== 'Enter' && e.key !== ' ') return;
    try {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a')) return;
    } catch (err) {
      return;
    }
    // Prevent page from scrolling on Space
    e.preventDefault();
    openEditModal(part);
  }

  function closeEditModal() {
    showEditModal = false;
    editPart = null;
  }

  async function saveEdits() {
    if (!editPart) return;
    const effectiveStock = editStock === '__other__' ? (editCustomStock || '').trim() : editStock;
    // If the user selected the CAM review pseudo-status, store underlying 'cammed'
    // as the actual status and set router_meta.step = 'cam_review' separately.
    const update = {
      // If user picked the pseudo-status 'cam_review' (CAM Review Ready), keep underlying status as in-progress
      // and set router_meta.step to 'cam_review' below. Previously this stored 'cammed' which caused it to appear
      // immediately as CAM Reviewed; keep it as 'in-progress' instead.
      status: editStatus === 'cam_review' ? 'in-progress' : editStatus,
      workflow: editWorkflow,
      updated_at: new Date().toISOString()
    };
    if (effectiveStock) update.stock_assignment = effectiveStock;
    try {
      const { error } = await supabase
        .from('parts')
        .update(update)
        .eq('id', editPart.id);
      if (error) throw error;
      // If the pseudo-status was selected, ensure router_meta step is set
      if (editStatus === 'cam_review') {
        try { await updateRouterMeta(editPart, { step: 'cam_review' }); } catch (e) { console.warn('updateRouterMeta failed:', e); }
      }
      await loadParts();
      showToastMessage('Part updated');
    } catch (e) {
      console.error('saveEdits error:', e);
      alert('Failed to update part: ' + (e.message || e));
    } finally {
      closeEditModal();
    }
  }

  async function deleteCurrentPart() {
    if (!editPart) return;
    if (!confirm('Delete this part permanently?')) return;
    try {
      // Normalize id (parts.id is bigint)
      const normalizedId = (typeof editPart.id === 'string' && /^\d+$/.test(editPart.id)) ? Number(editPart.id) : editPart.id;

      // Clear any build_bom references to this part first
      try {
        const { data: refs, error: refErr } = await supabase.from('build_bom').select('id').eq('parts_id', normalizedId);
        if (refErr) throw refErr;
        if (refs && refs.length > 0) {
          const ids = refs.map(r => r.id);
          const { error: clearErr } = await supabase.from('build_bom').update({ parts_id: null, added: false }).in('id', ids);
          if (clearErr) throw clearErr;
        }
      } catch (e) {
        console.error('Failed to clear BOM refs before deleting part:', e);
        alert('Failed to delete part: could not clear BOM references. Remove or unlink those BOM rows first.');
        return;
      }

      const { error } = await supabase
        .from('parts')
        .delete()
        .eq('id', normalizedId);
      if (error) throw error;
      await loadParts();
      showToastMessage('Part deleted');
    } catch (e) {
      console.error('deleteCurrentPart error:', e);
      alert('Failed to delete part: ' + (e.message || e));
    } finally {
      closeEditModal();
    }
  }

  // Reactive statement that filters parts when search term, filters, or parts array changes
  // ToDo tab: hide completed parts
  $: filteredParts = parts.filter(part => {
    const matchesSearch = !searchTerm || 
      part.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      part.requester.toLowerCase().includes(searchTerm.toLowerCase()) ||
      part.project_id.toLowerCase().includes(searchTerm.toLowerCase());
    
    const matchesWorkflow = !filterWorkflow || part.workflow === filterWorkflow;
    const meta = part.workflow === 'router' ? getRouterMeta(part) : {};
    // Treat CAM Review Ready as a pseudo-status based on router_meta.step
    const matchesStatus = !filterStatus ||
      part.status === filterStatus ||
      (filterStatus === 'cam_review' && meta.step === 'cam_review');
    const matchesProject = !filterProject || part.project_id === filterProject;
    const notCompleted = part.status !== 'complete';
    
    return matchesSearch && matchesWorkflow && matchesStatus && matchesProject && notCompleted;
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

<div class="manufacture-page-container">
<div class="page-header">
  <h1>Parts List</h1>
  <div class="page-actions">
    {#if canUseAssignMode}
      <button 
        class="btn {assignMode ? 'btn-primary' : 'btn-secondary'}"
        on:click={toggleAssignMode}
      >
        <Users size={16} />
        {assignMode ? 'Exit Assign Mode' : 'Assign Mode'}
      </button>
    {/if}
    <a href="/manufacture/create" class="btn btn-primary">
      <Upload size={16} />
      Create New Part
    </a>
    <button
      class="btn btn-secondary"
      on:click={exportToCSV}
    >
      <Download size={16} />
      Export CSV
    </button>
  </div>
</div>

<!-- Manufacture Sub-Tabs -->
<div class="subtabs">
  <a href="/manufacture" class:active={$page.url.pathname === '/manufacture'}>ToDo</a>
  <a href="/manufacture/completed" class:active={$page.url.pathname === '/manufacture/completed'}>Completed</a>
  <a href="/manufacture/router" class:active={$page.url.pathname === '/manufacture/router'}>Router</a>
  <a href="/manufacture/bins" class:active={$page.url.pathname === '/manufacture/bins'}>Bins</a>
</div>

<div class="card">
  <div class="filters" style="--filters-columns: 2fr 1fr 1fr 1fr;">
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
    
    <div class="form-group">
      <label class="form-label">
        <Filter size={16} />
        Project
      </label>
      <select class="form-select" bind:value={filterProject}>
        <option value="">All Projects</option>
        {#each projectIds as pid}
          <option value={pid}>{pid}</option>
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
  <div class="content-layout">
    {#if assignMode}
      <aside class="assign-sidebar">
        <h3>Roster</h3>
        <div class="roster-list">
          {#each filteredRosterMembers as member}
            <div 
              class="roster-member" 
              draggable="true" 
              role="button"
              tabindex="0"
              on:dragstart={(e) => handleDragStart(e, member)}
            >
              <div class="member-name">{member.user?.full_name || member.user?.email}</div>
              <div class="member-role">{member.key?.key_name}</div>
            </div>
          {/each}
          {#if filteredRosterMembers.length === 0}
            <p class="text-muted">No members found for this workflow.</p>
          {/if}
        </div>
      </aside>
    {/if}

  <!-- Mobile Card View -->
  <div class="mobile-parts-list">
    {#each filteredParts as part (part.id)}
      <div 
        class="part-card"
        on:click={(e) => onRowClick(e, part)}
        on:keydown={(e) => onRowKeyDown(e, part)}
        role="button"
        tabindex="0"
      >
        <div class="part-card-header">
          <div class="part-card-title">
            <strong>{part.name}</strong>
            {#if isTeam9584(part.frc_team)}
              <span class="tag team-tag tag-9584">9584</span>
            {/if}
          </div>
          <span class="status-badge {getBadgeClass(part.status, getRouterMeta(part))}">{getStatusDisplay(part)}</span>
        </div>
        
        <div class="part-card-meta">
          <span class={`tag workflow-tag ${getWorkflowClass(part.workflow)}`}>
            {getWorkflowLabel(part.workflow)}
          </span>
          {#if part.project_id}
            <span class="part-card-project">{part.project_id}</span>
          {/if}
          {#if part.assigned_to}
            <span class="pill pill-soft pill-assigned">
              {assignedUserNames[part.assigned_to] || 'Assigned'}
            </span>
          {/if}
        </div>
        
        <div class="part-card-details">
          <div class="part-card-detail">
            <span class="detail-label">Qty</span>
            <span class="detail-value">{part.quantity || 1}</span>
          </div>
          {#if part.stock_assignment}
            <div class="part-card-detail">
              <span class="detail-label">Stock</span>
              <span class="detail-value">{part.stock_assignment}</span>
            </div>
          {/if}
          <div class="part-card-detail">
            <span class="detail-label">Created</span>
            <span class="detail-value">{formatDate(part.created_at)}</span>
          </div>
        </div>
        
        <div class="part-card-actions">
          <!-- Source/Download buttons -->
          {#if part.source_type === 'onshape_api'}
            {#if part.workflow === 'laser-cut'}
              <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadFile(part, part.status)}>
                <Download size={14} /> SVG
              </button>
            {:else if part.workflow === 'lathe' || part.workflow === 'mill'}
              <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => openSubsystemDocument(part)}>
                <ExternalLink size={14} /> View
              </button>
              {:else if part.workflow === 'router'}
                <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadStepFromOnshape(part)}>
                  <Download size={14} /> STEP
                </button>
              {:else}
              <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadFile(part, part.status)}>
                <Download size={14} /> File
              </button>
            {/if}
          {:else if part.file_name}
            <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadFromStorage(part.file_name, part.id)}>
              <Download size={14} /> File
            </button>
          {/if}
          
          <!-- Status action buttons -->
          {#if part.status === 'pending'}
            {#if part.workflow === 'router'}
              <button
                class="btn btn-primary btn-sm"
                on:click|stopPropagation={async () => { await updatePartStatus(part.id, 'in-progress'); await updateRouterMeta(part, { step: 'cam_ing' }); setLocalStatus(part.id, 'in-progress'); setLocalRouterMeta(part.id, { step: 'cam_ing' }); }}
              >
                <Clock size={14} /> Start
              </button>
            {:else}
              <button
                class="btn btn-primary btn-sm"
                on:click|stopPropagation={() => updatePartStatus(part.id, 'in-progress')}
              >
                <Clock size={14} /> Start
              </button>
            {/if}
          {:else if part.status === 'in-progress'}
            {#if part.workflow === 'router'}
              {#if !getRouterMeta(part).step || getRouterMeta(part).step === 'cam_ing'}
                <button
                  class="btn btn-primary btn-sm"
                  on:click|stopPropagation={async () => { await updateRouterMeta(part, { step: 'cam_review' }); setLocalRouterMeta(part.id, { step: 'cam_review' }); }}
                >
                  CAM Done
                </button>
              {:else if getRouterMeta(part).step === 'cam_review'}
                <button
                  class="btn btn-primary btn-sm"
                  on:click|stopPropagation={async () => { await updatePartStatus(part.id, 'cammed'); await updateRouterMeta(part, { step: 'cammed' }); setLocalStatus(part.id, 'cammed'); setLocalRouterMeta(part.id, { step: 'cammed' }); }}
                >
                  {BUTTONS.CAM_REVIEWED}
                </button>
              {/if}
            {/if}
          {/if}
        </div>
      </div>
    {/each}
  </div>

  <!-- Desktop Table View -->
  <div class="table-container desktop-table" class:assign-mode={assignMode}>
    <table class="table">
      <thead>
        <tr>
          <th class="name-col">Name</th>
          <th>Workflow</th>
          <th class="mono" class:hidden={assignMode}>Project ID</th>
          <th class:hidden={assignMode}>Qty</th>
          <th class:hidden={assignMode}>Stock</th>
          <th class="source-col" class:hidden={assignMode}>Source</th>
          <th>Status</th>
          <th class:hidden={assignMode}>Created</th>
          <th class:hidden={assignMode}>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredParts as part (part.id)}
          <tr
            class="parts-row"
            on:click={(e) => onRowClick(e, part)}
            on:keydown={(e) => onRowKeyDown(e, part)}
            on:dragover={handleDragOver}
            on:drop={(e) => handleDrop(e, part)}
            role="button"
            tabindex="0"
            class:droppable={assignMode}
          >
            <td class="name-col">
              <div class="name-line">
                <strong>{part.name}</strong>
                {#if isTeam9584(part.frc_team)}
                  <span class="tag team-tag tag-9584" title="Requested by Team 9584">9584</span>
                {/if}
              </div>
              {#if part.assigned_to}
                 <span class="assigned-user-badge pill pill-soft pill-assigned">
                   {assignedUserNames[part.assigned_to] || 'Assigned'}
                 </span>
              {/if}
            </td>
            <td>
              <span class={`tag workflow-tag ${getWorkflowClass(part.workflow)}`}>
                {getWorkflowLabel(part.workflow)}
              </span>
            </td>
            <td class="mono" class:hidden={assignMode}>{part.project_id}</td>
            <td class:hidden={assignMode}>{part.quantity || 1}</td>
            <td class="text-muted" class:hidden={assignMode}>{part.stock_assignment || '-'}</td>
            <td class="source-col" class:hidden={assignMode}>
              {#if part.source_type === 'onshape_api'}
                <div class="source-cell" class:multi-files={part.workflow === 'router'}>
                  {#if part.workflow === 'laser-cut'}
                    <button
                      type="button"
                      class="tag tag-source tag-action"
                      aria-label="Download SVG"
                      title="Download SVG"
                      on:click|stopPropagation={() => downloadFile(part, part.status)}
                    >
                      <Download size={14} />
                      SVG
                    </button>
                  {:else if part.workflow === 'lathe' || part.workflow === 'mill'}
                    <button
                      type="button"
                      class="tag tag-source tag-action"
                      aria-label="Open document"
                      title="Open document"
                      on:click|stopPropagation={() => openSubsystemDocument(part)}
                    >
                      <ExternalLink size={14} />
                      PDF
                    </button>
                  {:else if part.workflow === 'router'}
                    <button
                      type="button"
                      class="tag tag-source tag-action"
                      aria-label="Download STEP file"
                      title="Download STEP"
                      on:click|stopPropagation={() => downloadStepFromOnshape(part)}
                    >
                      <Download size={14} />
                      STEP
                    </button>
                  {:else}
                    <button
                      type="button"
                      class="tag tag-source tag-action"
                      aria-label={`Download ${part.workflow === '3d-print' ? 'STEP' : (part.file_format === 'stl' ? 'STL' : 'STEP')} file`}
                      title="Download file"
                      on:click|stopPropagation={() => downloadFile(part, part.status)}
                    >
                      <Download size={14} />
                      {part.workflow === '3d-print' ? 'STEP' : (part.file_format === 'stl' ? 'STL' : 'STEP')}
                    </button>
                  {/if}
                </div>
              {:else if part.workflow === 'router'}
                {#await Promise.resolve((() => { try { return JSON.parse(part.file_url || '{}') } catch { return {} } })()) then meta}
                  <div class="source-cell multi-files">
                    {#if meta.step_file}
                      <button
                        type="button"
                        class="tag tag-source tag-action"
                        aria-label="Download STEP file"
                        title="Download STEP"
                        on:click|stopPropagation={() => downloadFromStorage(meta.step_file, part.id)}
                      >
                        <Download size={14} />
                        STEP
                      </button>
                    {/if}
                    {#if !meta.step_file}
                      <span class="file-label">{part.file_name}</span>
                      <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click|stopPropagation={() => downloadFromStorage(part.file_name, part.id)}>
                        <Download size={16} />
                      </button>
                    {/if}
                  </div>
                {/await}
              {:else if part.file_name}
                <div class="source-cell">
                  <span class="file-label">{part.file_name}</span>
                  <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click|stopPropagation={() => downloadFromStorage(part.file_name, part.id)}>
                    <Download size={16} />
                  </button>
                </div>
              {:else}
                <span class="text-muted">-</span>
              {/if}
            </td>
            <td>
              <span class="status-badge {getBadgeClass(part.status, getRouterMeta(part))} status-table status-fade">{getStatusDisplay(part)}</span>
            </td>
            <td class:hidden={assignMode}>{formatDate(part.created_at)}</td>
            <td class:hidden={assignMode}>
              <div class="row-actions">
              </div>
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
                  <!-- Router: CAM Done appears when in CAMing sub-step or no step set -->
                  {#if !getRouterMeta(part).step || getRouterMeta(part).step === 'cam_ing'}
                  <div class="actions-col">
                    <button
                      class="btn btn-secondary btn-sm"
                      on:click={async () => { await updateRouterMeta(part, { step: 'cam_review' }); }}
                      title="CAM Done"
                    >
                      CAM Done
                    </button>
                  </div>
              {:else if getRouterMeta(part).step === 'cam_review'}
              <div class="actions-col">
                    <button
                      class="btn btn-secondary btn-sm"
                      on:click={async () => { await updatePartStatus(part.id, 'cammed'); await updateRouterMeta(part, { step: 'cammed' }); setLocalStatus(part.id, 'cammed'); setLocalRouterMeta(part.id, { step: 'cammed' }); }}
                      title={BUTTONS.CAM_REVIEWED}
                    >
                      {BUTTONS.CAM_REVIEWED}
                    </button>
                  </div>
                  {/if}
                {/if}
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
  </div>
{/if}
</div>

<!-- Edit Part Modal -->
{#if showEditModal}
  <div
    class="modal-backdrop"
    on:click|self={closeEditModal}
    role="button"
    tabindex="0"
    on:keydown={(e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); closeEditModal(); } }}
  >
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>Edit Part{editPart ? `: ${editPart.name}` : ''}</h3>
        <button type="button" class="modal-close-button" aria-label="Close dialog" on:click={closeEditModal}>
          <X size={18} />
        </button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label" for="edit-status">Status</label>
          <select id="edit-status" class="form-select" bind:value={editStatus}>
            {#each editStatusOptions as status}
              <option value={status.value}>{status.label}</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-workflow">Workflow</label>
          <select id="edit-workflow" class="form-select" bind:value={editWorkflow}>
            {#each workflows as w}
              <option value={w.value}>{w.label}</option>
            {/each}
          </select>
        </div>
        <div class="form-group">
          <label class="form-label" for="edit-stock">Stock</label>
          <select id="edit-stock" class="form-select" bind:value={editStock}>
            <option value="">—</option>
            {#each editStockOptions as s}
              <option value={s}>{s}</option>
            {/each}
            <option value="__other__">Custom...</option>
          </select>
        </div>
        {#if editStock === '__other__'}
        <div class="form-group">
          <input class="form-input" type="text" placeholder="Custom stock" bind:value={editCustomStock} />
        </div>
        {/if}
      </div>
      <div class="modal-footer">
        <button class="btn btn-danger" on:click={deleteCurrentPart}>
          <Trash2 size={16} />
          Delete
        </button>
        <div class="spacer"></div>
        <button class="btn" on:click={closeEditModal}>Cancel</button>
        <button class="btn btn-primary" on:click={saveEdits}>Save</button>
      </div>
    </div>
  </div>
{/if}

<!-- Toast Notification -->
{#if showToast}
  <div class="toast">
    {toastMessage}
  </div>
{/if}

<style>
  .manufacture-page-container {
    max-width: 1400px;
    margin: 0 auto;
  }
  
  .table tr { background: white; }
  .table tbody tr:nth-child(even) { background: var(--color-white); }

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
    min-width: 140px;
    max-width: 200px;
    width: 1%;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .name-line {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .source-cell {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    min-width: 0;
    flex-wrap: wrap;
  }

  .source-cell .file-label {
    flex: 1 1 140px;
    min-width: 0;
  }

  .source-cell.multi-files {
    justify-content: flex-start;
  }

  .version-text {
    font-size: 0.75rem;
    color: var(--neutral-500);
  }

  .file-label {
    display: block;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    min-width: 0;
  }

  .actions-col {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    min-width: 110px;
  }

  .kitting-inline {
    display: flex;
    align-items: center;
    gap: 0.5rem;
  }

  .kitting-input {
    min-width: 120px;
    margin: 0;
    box-sizing: border-box;
  }

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

  .status-badge.status-table.status-pending { --badge-bg: var(--brand-gold-soft); background: var(--brand-gold-soft); color: var(--orange-strong); border-color: var(--brand-gold-base); }
  .status-badge.status-table.status-progress { --badge-bg: var(--blue-soft); background: var(--blue-soft); color: var(--blue-base); border-color: var(--blue-base); }
  .status-badge.status-table.status-cammed { --badge-bg: var(--purple-soft); background: var(--purple-soft); color: var(--purple-strong); border-color: var(--purple-base); }
  .status-badge.status-table.status-complete { --badge-bg: var(--green-soft); background: var(--green-soft); color: var(--success); border-color: var(--green-base); }
  .status-badge.status-table.status-travis { --badge-bg: var(--green-soft); background: var(--green-soft); color: var(--green-strong); border-color: var(--green-base); }

  .parts-row {
    cursor: pointer;
  }

  .assigned-user-badge {
    display: inline-flex;
    margin-top: 0.3rem;
  }

  :global(.btn-icon svg) {
    width: 16px;
    height: 16px;
  }

  .source-col .source-cell .btn.btn-icon :global(svg) {
    width: 16px !important;
    height: 16px !important;
    min-width: 16px; min-height: 16px; transform: none !important; flex: 0 0 auto;
  }
  :global(.actions-col .btn svg), :global(.kitting-inline .btn svg) { width: 18px; height: 18px; }
  .file-input-hidden { display: none; }
  .table thead th { background: var(--background); color: var(--text); font-weight: 600; border-bottom: none; }

  .content-layout { display: flex; gap: 1rem; align-items: flex-start; }
  .assign-sidebar { width: 250px; background: var(--surface-1); border: 1px solid var(--border); border-radius: 8px; padding: 1rem; position: sticky; top: 1rem; max-height: calc(100vh - 2rem); display: flex; flex-direction: column; gap: 0.5rem; overflow: hidden; overscroll-behavior: contain; flex-shrink: 0; }
  .assign-sidebar h3 { margin-top: 0; margin-bottom: 1rem; font-size: 1.1rem; border-bottom: 1px solid var(--border); padding-bottom: 0.5rem; }
  .roster-list { display: flex; flex-direction: column; gap: 0.5rem; flex: 1; min-height: 0; overflow-y: auto; max-height: calc(100vh - 6rem); overscroll-behavior: contain; padding-right: 0.25rem; }
  .roster-member { background: var(--surface-2); border: 1px solid var(--border); padding: 0.5rem; border-radius: 4px; cursor: grab; user-select: none; }
  .roster-member:active { cursor: grabbing; }
  .member-name { font-weight: 500; }
  .member-role { font-size: 0.8rem; color: var(--text-muted); }
  .table-container.assign-mode { flex: 1; }
  .hidden { display: none !important; }
  tr.droppable { transition: background-color 0.2s; }
  tr.droppable:hover { background-color: var(--surface-2); }

  /* Toast notification */
  .toast {
    position: fixed;
    bottom: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    background: var(--secondary);
    color: var(--primary);
    padding: var(--space-3) var(--space-6);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-lg);
    z-index: 1000;
  }

  /* Mobile Responsive Styles */
  
  /* Mobile Parts Card List - Hidden on desktop */
  .mobile-parts-list {
    display: none;
  }
  
  .part-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    cursor: pointer;
    transition: box-shadow 0.2s, border-color 0.2s;
  }
  
  .part-card:hover {
    border-color: var(--primary);
    box-shadow: var(--shadow-md);
  }
  
  .part-card:active {
    background: var(--surface-2);
  }
  
  .part-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--gap-3);
    margin-bottom: var(--space-3);
  }
  
  .part-card-title {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    flex-wrap: wrap;
    flex: 1;
    min-width: 0;
  }
  
  .part-card-title strong {
    font-size: 1rem;
    color: var(--secondary);
    word-break: break-word;
  }
  
  .part-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
    margin-bottom: var(--space-3);
  }
  
  .part-card-project {
    font-size: var(--font-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }
  
  .part-card-details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: var(--gap-3);
    padding: var(--space-3);
    background: var(--background);
    border-radius: var(--radius-sm);
    margin-bottom: var(--space-3);
  }
  
  .part-card-detail {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  
  .detail-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted);
  }
  
  .detail-value {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text);
  }
  
  .part-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
    padding-top: var(--space-3);
    border-top: 1px solid var(--border);
  }
  
  .part-card-actions .btn {
    flex: 1 1 auto;
    min-width: 80px;
    justify-content: center;
  }

  @media (max-width: 900px) {
    .actions-col { min-width: auto; }
    .table th.name-col, .table td.name-col { min-width: 80px; max-width: 100px; }
    .table th.source-col, .table td.source-col { min-width: 70px; max-width: 100px; }
    
    .content-layout {
      flex-direction: column;
    }
    
    .assign-sidebar {
      width: 100%;
      position: static;
      max-height: none;
    }
    
    .roster-list {
      max-height: 200px;
    }
  }

  @media (max-width: 768px) {
    .manufacture-page-container {
      padding: 0;
    }
    
    /* Hide desktop table, show mobile cards */
    .desktop-table {
      display: none;
    }
    
    .mobile-parts-list {
      display: block;
    }
    
    /* Compact filters */
    .filter-card {
      padding: var(--space-3);
    }
    
    .filter-grid {
      grid-template-columns: 1fr;
      gap: var(--gap-3);
    }
    
    .page-header {
      padding: var(--space-3);
    }
    
    .page-header h1 {
      font-size: 1.25rem;
    }
    
    .page-actions {
      flex-direction: column;
      width: 100%;
    }
    
    .page-actions .btn {
      width: 100%;
      justify-content: center;
    }
  }

  @media (max-width: 480px) {
    .part-card {
      padding: var(--space-3);
    }
    
    .part-card-title strong {
      font-size: 0.9rem;
    }
    
    .part-card-details {
      grid-template-columns: 1fr 1fr;
      padding: var(--space-2);
    }
    
    .part-card-actions .btn {
      font-size: 0.75rem;
      padding: var(--space-2);
    }
    
    .status-badge {
      font-size: 0.65rem;
      padding: var(--space-1) var(--space-2);
    }
  }
</style>
