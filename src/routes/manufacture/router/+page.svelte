<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';
  import { Package, Group, GripVertical, Download, Settings } from 'lucide-svelte';
  import AutocamReviewModal from '$lib/components/AutocamReviewModal.svelte';
  import { userStore } from '$lib/stores/auth.js';
  import { TEAM_ROLES } from '$lib/permissions.js';

  // User profile for permission checks
  let profile = null;
  $: isManufacturingLead = profile?.team_role === TEAM_ROLES.MANUFACTURING_LEAD || 
                          profile?.general_role === 'lead' || 
                          profile?.role === 'admin';

  // Autocam review modal state
  let showAutocamModal = false;
  let autocamReviewPart = null;

  function openAutocamReview(part) {
    autocamReviewPart = part;
    showAutocamModal = true;
  }

  function closeAutocamReview() {
    showAutocamModal = false;
    autocamReviewPart = null;
    loadParts(); // Refresh after review
  }

  // Lightweight helpers borrowed from the manufacture list for mobile cards
  function formatDate(dateString) {
    return new Date(dateString).toLocaleDateString();
  }

  function getWorkflowLabel(workflow) {
    // Router page only lists router parts, but keep a helper for consistency
    return workflow ? workflow.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()) : 'Router';
  }

  function getWorkflowClass(workflow) {
    if (!workflow) return 'tag-workflow-default';
    return `tag-workflow-${workflow.toLowerCase().replace(/_/g, '-')}`;
  }

  function getStatusDisplay(part) {
    return getDisplayStatus(part.status, parseMeta(part));
  }

  function groupIsCut(g) {
    if (!g || !g.parts || g.parts.length === 0) return false;
    return g.parts.every(p => {
      const m = parseMeta(p);
      return Boolean(m?.router_meta && m.router_meta.step === 'cut');
    });
  }

  function groupIsReadyForTProged(g) {
    if (!g || !g.parts || g.parts.length === 0) return false;
    return g.parts.every(p => {
      const m = parseMeta(p);
      return Boolean(m?.router_meta && m.router_meta.step === 'layout');
    });
  }

  function groupIsTravisProgged(g) {
    if (!g || !g.parts || g.parts.length === 0) return false;
    return g.parts.every(p => {
      const m = parseMeta(p);
      // Accept either explicit travis_progged flag or router_meta.step === 'queued'
      return Boolean((m?.router_meta && m.router_meta.step === 'queued') || m?.travis_progged || (m?.router_meta && m.router_meta.travis_progged));
    });
  }

  // ==================== State ====================
  let parts = [];
  let loading = true;
  let groupMap = {};
  let useDedicatedTables = true;

  // Edit Mode vs View Mode
  let editMode = false;

  // The subtab determines router vs postprocessing — driven by local state

  // Drag-and-drop state
  let dragPart = null;
  let dragOverTarget = null;

  // Group editing state
  let editingGroupId = null;
  let editingGroupName = '';
  let groupFields = {}; // gid -> { cut_name, output_folder, machine }

  const MACHINE_OPTIONS = ['UNC Router', 'ShopSabre'];

  // Stock options from stock.json
  const routerStockOptions = stockData.router || [];

  // Two machines
  const MACHINES = ['UNC Router', 'ShopSabre'];

  // Machine color map
  const MACHINE_COLORS = {
    'UNC Router': { bg: 'var(--blue-soft)', text: 'var(--blue-strong)', border: 'var(--blue-base)' },
    'ShopSabre': { bg: 'var(--purple-soft)', text: 'var(--purple-strong)', border: 'var(--purple-base, #9c27b0)' }
  };

  // Stock color map — color by material type
  function getStockColor(stock) {
    if (!stock) return { bg: 'var(--surface-2)', text: 'var(--text-muted)', border: 'var(--border)' };
    const s = stock.toLowerCase();
    if (s.includes('polycarbonate')) return { bg: 'var(--blue-soft)', text: 'var(--blue-strong)', border: 'var(--blue-base)' };
    if (s.includes('tube')) return { bg: 'var(--green-soft)', text: 'var(--green-strong)', border: 'var(--green-base)' };
    // Aluminum sheets (default for router)
    return { bg: 'var(--brand-gold-soft)', text: 'var(--brand-gold-strong)', border: 'var(--brand-gold-base)' };
  }

  function getMachineColor(machine) {
    return MACHINE_COLORS[machine] || { bg: 'var(--surface-2)', text: 'var(--text-muted)', border: 'var(--border)' };
  }

  function shortHash(id = '') {
    const cleaned = id.replace(/-/g, '');
    if (!cleaned) return '000';
    let sum = 0;
    for (let i = 0; i < cleaned.length; i++) sum = (sum * 31 + cleaned.charCodeAt(i)) >>> 0;
    return (sum & 0xfff).toString(16).padStart(3, '0');
  }

  // We store grouping metadata inside file_url JSON under router_group_id
  function parseMeta(part) {
    try { return JSON.parse(part.file_url || '{}') || {}; } catch { return {}; }
  }

  function getStatusColors(status) {
    if (status === BUTTONS.TRAVIS || status === 'TravisProgged') return { bg: 'var(--green-soft)', text: 'var(--green-strong)', border: 'var(--green-base)' };
    if (status === BUTTONS.MACHINED || status === 'Machined') return { bg: 'var(--blue-soft)', text: 'var(--blue-strong)', border: 'var(--blue-base)' };
    if (status === BUTTONS.CAM_REVIEWED || status === 'CAM Reviewed') return { bg: 'var(--purple-soft)', text: 'var(--purple-strong)', border: 'var(--purple-base, #9c27b0)' };
    return { bg: 'var(--brand-gold-soft)', text: 'var(--brand-gold-strong)', border: 'var(--brand-gold-base)' };
  }

  async function updateMeta(part, updates) {
    let root = {};
    try { root = JSON.parse(part.file_url || '{}') || {}; } catch { root = {}; }
    root = { ...root, ...updates };
    await supabase.from('parts').update({ file_url: JSON.stringify(root), updated_at: new Date().toISOString() }).eq('id', part.id);
  }

  function groupIsCut(g) {
    if (!g || !g.parts || g.parts.length === 0) return false;
    return g.parts.every(p => {
      const m = parseMeta(p);
      return p.status === 'machined' || Boolean(m?.router_meta && m.router_meta.step === 'cut');
    });
  }

  function groupIsKitted(g) {
    if (!g || !g.parts || g.parts.length === 0) return false;
    return g.parts.every(p => p.status === 'complete' || p.status === 'kitted');
  }

  function getGroupDisplayStatus(g) {
    if (g.status) return g.status;
    if (!g || !g.parts || g.parts.length === 0) return BUTTONS.PENDING;
    if (groupIsCut(g)) return BUTTONS.MACHINED;
    const allTravis = g.parts.every(p => {
      const m = parseMeta(p);
      return m?.travis_progged || (m?.router_meta && m.router_meta.step === 'queued');
    });
    if (allTravis) return BUTTONS.TRAVIS;
    const allCammed = g.parts.every(p => p.status === 'cammed');
    if (allCammed) return BUTTONS.CAM_REVIEWED;
    return BUTTONS.PENDING;
  }

  async function advanceRouterStep(part, nextStep) {
    if (!part || !nextStep) return;
    try {
      if (nextStep === 'cam_ing') {
        await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', part.id);
        await updateRouterMeta(part, { step: 'cam_ing' });
      } else if (nextStep === 'cam_review') {
        // CAM Review Ready: status stays 'in-progress', step is 'cam_review'
        await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', part.id);
        await updateRouterMeta(part, { step: 'cam_review' });
      } else if (nextStep === 'queued') {
        // TravisProgged: underlying cammed + flag
        await supabase.from('parts').update({ status: 'cammed', updated_at: new Date().toISOString() }).eq('id', part.id);
        await updateRouterMeta(part, { travis_progged: true, step: 'queued' });
      } else {
        // generic step (e.g., layout)
        await updateRouterMeta(part, { step: nextStep });
      }
    } catch (e) {
      console.error('Failed to advance router step', e);
      alert('Failed to advance step: ' + (e?.message || e));
    } finally {
      await loadParts();
    }
    const stockMismatchParts = g.parts.filter(p => (p.stock_assignment || '') !== groupStock);
    if (stockMismatchParts.length > 0 && stockMismatchParts.length < g.parts.length) {
      mismatches.stock = { count: stockMismatchParts.length, label: stockMismatchParts[0].stock_assignment || 'None' };
    }
    return mismatches;
  }

  // Auto-fill stock based on most common among parts
  function getMostCommonValue(items, key) {
    const counts = {};
    for (const item of items) {
      const val = item[key] || '';
      if (val) counts[val] = (counts[val] || 0) + 1;
    }
    let best = '';
    let bestCount = 0;
    for (const [val, count] of Object.entries(counts)) {
      if (count > bestCount) { bestCount = count; best = val; }
    }
    return best;
  }

  // ==================== Data Loading ====================
  async function loadParts() {
    loading = true;
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .eq('workflow', 'router')
      .order('created_at', { ascending: false });

    if (!error) {
      // Show all router parts except those fully completed/kitted (non-complete set)
      parts = (data || []).filter(p => {
        if (p.status === 'complete' || p.status === 'kitted') return false;
        return true;
      });
    }

    await loadGroups();
    loading = false;
  }

  async function loadGroups() {
    if (useDedicatedTables) {
      const { data: groups, error: gErr } = await supabase.from('router_groups').select('id, name, created_at, stock_type, cut_name, output_folder, machine');
      const { data: links, error: lErr } = await supabase.from('router_group_parts').select('group_id, part_id');
      if (gErr || lErr) {
        console.log('Failed to load dedicated tables, falling back to JSON', { gErr, lErr });
        useDedicatedTables = false;
        buildGroupsFromJSON();
      } else {
        const gmap = {};
        groups.forEach(g => {
          const stockType = g.stock_type || 'stock';
          const suffix = shortHash(g.id);
          gmap[g.id] = {
            id: g.id,
            name: g.name || `${stockType}_${suffix}`,
            stock_type: stockType,
            cut_name: g.cut_name || '',
            output_folder: g.output_folder || '',
            machine: g.machine || 'UNC Router',
            parts: []
          };
        });
        const partById = Object.fromEntries(parts.map(p => [p.id, p]));
        links.forEach(l => { if (gmap[l.group_id] && partById[l.part_id]) gmap[l.group_id].parts.push(partById[l.part_id]); });
        groupMap = gmap;
      }
    } else {
      buildGroupsFromJSON();
    }
    groupFields = {};
    Object.values(groupMap).forEach((g) => {
      groupFields[g.id] = {
        cut_name: g.cut_name || '',
        output_folder: g.output_folder || '',
        machine: g.machine || 'UNC Router'
      };
    });
    loading = false;
  }

  function buildGroupsFromJSON() {
    groupMap = {};
    for (const p of parts) {
      const meta = parseMeta(p);
      if (meta.router_group_id) {
        if (!groupMap[meta.router_group_id]) {
          const stockType = extractStockType(p);
          const suffix = shortHash(meta.router_group_id);
          groupMap[meta.router_group_id] = {
            id: meta.router_group_id,
            name: meta.router_group_name || `${stockType}_${suffix}`,
            stock_type: stockType,
            cut_name: '',
            output_folder: '',
            machine: 'UNC Router',
            parts: []
          };
        }
        groupMap[meta.router_group_id].parts.push(p);
      }
    }
  }

  // ==================== Computed Values ====================
  $: groupedIdSet = new Set(Object.values(groupMap).flatMap((g) => g.parts.map((p) => p.id)));
  $: ungroupedParts = parts.filter((p) => !groupedIdSet.has(p.id));
  function getStock(part) { return part.stock_assignment || ''; }
  function extractStockType(part) {
    const stock = getStock(part) || '';
    const first = stock.split(' ')[0]?.trim();
    return first && first.length > 0 ? first : 'stock';
  }
  function inferGroupStock(g) {
    if (g?.stock_type) return g.stock_type;
    const firstPart = g?.parts?.[0];
    if (firstPart) return extractStockType(firstPart);
    return 'stock';
  }
  function makeGroupName(part) {
    const base = (getStock(part).split(' ')[0] || 'Group').replace(/[^A-Za-z0-9]/g,'');
    const rand = Math.floor(10 + Math.random()*90); // 2 digits
    return `${base}${rand}`;
  }

  // Router groups: not yet cut
  $: routerGroups = Object.values(groupMap)
    .filter(g => g.parts.length > 0 && !groupIsCut(g))
    .sort((a, b) => (a.queue_position ?? 999) - (b.queue_position ?? 999));

  // Per-machine status summaries for View Mode
  $: machineGroups = (() => {
    const result = {};
    for (const machine of MACHINES) {
      const groups = routerGroups.filter(g => g.machine === machine);
      const cutting = groups.find(g =>
        g.status === BUTTONS.TRAVIS || getGroupDisplayStatus(g) === BUTTONS.TRAVIS
      ) || (groups.length > 0 ? groups[0] : null);
      const upNext = groups.find(g => g !== cutting) || null;
      result[machine] = { cutting, upNext };
    }
    // Also include unassigned machine groups
    const unassigned = routerGroups.filter(g => !g.machine || !MACHINES.includes(g.machine));
    if (unassigned.length > 0) {
      result['Unassigned'] = {
        cutting: unassigned[0] || null,
        upNext: unassigned.length > 1 ? unassigned[1] : null
      };
    }
  }

  async function downloadFromOnshape(part) {
    try {
      // Log the Onshape IDs being used for debugging
      console.log('Downloading from Onshape:', {
        name: part.name,
        onshape_document_id: part.onshape_document_id,
        onshape_element_id: part.onshape_element_id,
        onshape_part_id: part.onshape_part_id,
        onshape_wvm: part.onshape_wvm,
        onshape_wvmid: part.onshape_wvmid
      });
      
      const params = new URLSearchParams({
        action: 'translate-part',
        documentId: part.onshape_document_id,
        elementId: part.onshape_element_id,
        partId: part.onshape_part_id,
        wvm: part.onshape_wvm || 'v',
        wvmId: part.onshape_wvmid,
        // Prefer STEP for 3D prints
        format: part.workflow === '3d-print' ? 'STEP' : (part.file_format === 'stl' ? 'STL' : 'STEP')
      });
      const resp = await fetch(`/api/onshape?${params}`);
      if (!resp.ok) {
        const errorData = await resp.json().catch(() => ({}));
        const errorMsg = errorData.details || errorData.error || 'Onshape download failed';
        console.error('Onshape download failed:', errorData);
        if (errorData.suggestion) {
          alert(`Download failed: ${errorMsg}\n\nSuggestion: ${errorData.suggestion}`);
        } else {
          alert(`Download failed: ${errorMsg}`);
        }
        return;
      }
      const blob = await resp.blob();
      const ext = part.workflow === '3d-print' ? 'step' : (part.file_format === 'stl' ? 'stl' : 'step');
      const fname = `${(part.name || 'part').replace(/[^A-Za-z0-9]/g,'_')}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=fname; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { 
      console.error('Error downloading from Onshape:', e);
      alert(`Download error: ${e.message}`);
    }
  }

  async function downloadStepFromOnshape(part) {
    try {
      if (part?.status === 'pending') {
        await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', part.id);
      }
      
      // Log the Onshape IDs being used for debugging
      console.log('Downloading STEP for part:', {
        name: part.name,
        onshape_document_id: part.onshape_document_id,
        onshape_element_id: part.onshape_element_id,
        onshape_part_id: part.onshape_part_id,
        onshape_wvm: part.onshape_wvm,
        onshape_wvmid: part.onshape_wvmid
      });
      
      const params = new URLSearchParams({
        action: 'translate-part',
        documentId: part.onshape_document_id,
        elementId: part.onshape_element_id,
        partId: part.onshape_part_id,
        wvm: part.onshape_wvm || 'v',
        wvmId: part.onshape_wvmid,
        format: 'STEP'
      });
      const resp = await fetch(`/api/onshape?${params}`);
      if (!resp.ok) {
        // Try to get detailed error message
        const errorData = await resp.json().catch(() => ({}));
        const errorMsg = errorData.details || errorData.error || 'Onshape STEP download failed';
        console.error('STEP download failed:', errorData);
        if (errorData.suggestion) {
          alert(`Download failed: ${errorMsg}\n\nSuggestion: ${errorData.suggestion}`);
        } else {
          alert(`Download failed: ${errorMsg}`);
        }
        return;
      }
      const blob = await resp.blob();
      const fname = `${(part.name || 'part').replace(/[^A-Za-z0-9]/g,'_')}.step`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=fname; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { 
      console.error('Error downloading STEP:', e);
      alert(`Download error: ${e.message}`);
    }
  }



  function makeGroupName(part) {
    const base = (getStock(part).split(' ')[0] || 'Group').replace(/[^A-Za-z0-9]/g, '');
    const rand = Math.floor(10 + Math.random() * 90);
    return `${base}${rand}`;
  }

  function getFileTypeLabel(part, meta = {}) {
    if (part?.source_type === 'onshape_api' || part?.is_onshape_part) {
      if (part?.file_format) return String(part.file_format).toUpperCase();
      return 'STEP';
    }
    if (meta?.step_file) return 'STEP';
    if (part?.file_name && part.file_name.includes('.')) {
      const ext = part.file_name.split('.').pop();
      if (ext) return ext.toUpperCase();
    }
    return 'FILE';
  }

  // Group renaming
  async function saveGroupName(gid) {
    if (!gid) return;
    const newName = editingGroupName.trim();
    if (!newName) { editingGroupId = null; editingGroupName = ''; return; }
    try {
      if (useDedicatedTables) {
        await supabase.from('router_groups').update({ name: newName }).eq('id', gid);
      } else {
        const group = groupMap[gid];
        if (group) {
          for (const p of group.parts) {
            const meta = parseMeta(p);
            meta.router_group_name = newName;
            await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', p.id);
          }
        }
      }
    } catch (e) {
      console.error('Rename failed', e);
      alert('Failed to rename group');
    } finally {
      editingGroupId = null;
      editingGroupName = '';
      await loadParts();
    }
  }

  async function updateGroupField(gid, field, value) {
    if (!useDedicatedTables) return;
    try {
      await supabase.from('router_groups').update({ [field]: value }).eq('id', gid);
      await loadParts();
    } catch (e) {
      console.error(`Failed to update ${field}`, e);
    }
  }

  async function moveGroupInQueue(gid, direction) {
    const groups = [...routerGroups];
    const idx = groups.findIndex(g => g.id === gid);
    if (idx === -1) return;
    const newIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (newIdx < 0 || newIdx >= groups.length) return;
    const temp = groups[idx];
    groups[idx] = groups[newIdx];
    groups[newIdx] = temp;
    try {
      for (let i = 0; i < groups.length; i++) {
        await supabase.from('router_groups').update({ queue_position: i }).eq('id', groups[i].id);
      }
      await loadParts();
    } catch (e) {
      console.error('Failed to reorder queue', e);
    }
  }

  async function updateGroupField(gid, field, value) {
    if (!gid || !useDedicatedTables) return;
    groupFields = { ...groupFields, [gid]: { ...(groupFields[gid] || {}), [field]: value } };
    const payload = { [field]: value };
    try {
      await supabase.from('router_groups').update(payload).eq('id', gid);
    } catch (e) {
      console.error('Update group field failed', e);
      alert('Failed to update group field');
    } finally {
      await loadParts();
    }
  }

  function handleDragStart(event, part) {
    dragPart = part;
    event.dataTransfer.effectAllowed = 'move';
  }

  function handleDragOver(event, target) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    dragOverTarget = target;
  }

  function handleDragLeave() {
    dragOverTarget = null;
  }

    const dragGroup = findGroupIdForPart(dragPart);
    let targetGroup = findGroupIdForPart(targetPart);

    const dragStock = extractStockType(dragPart).toLowerCase();
    const targetStock = extractStockType(targetPart).toLowerCase();

    // Enforce stock-type consistency when grouping/merging
    if (dragGroup && targetGroup && dragGroup !== targetGroup) {
      const dragGroupStock = inferGroupStock(groupMap[dragGroup]).toLowerCase();
      const targetGroupStock = inferGroupStock(groupMap[targetGroup]).toLowerCase();
      if (dragGroupStock !== targetGroupStock) {
        alert('Cannot merge groups with different stock types.');
        return;
      }
    }

    if (targetGroup && !dragGroup) {
      const targetGroupStock = inferGroupStock(groupMap[targetGroup]).toLowerCase();
      if (dragStock !== targetGroupStock) {
        alert('Parts in a group must share the same stock type.');
        return;
      }
    }

    if (dragGroup && !targetGroup) {
      const dragGroupStock = inferGroupStock(groupMap[dragGroup]).toLowerCase();
      if (targetStock !== dragGroupStock) {
        alert('Parts in a group must share the same stock type.');
        return;
      }
    }

    if (!dragGroup && !targetGroup && dragStock !== targetStock) {
      alert('Cannot create a group with mixed stock types.');
      return;
    }

  async function handleDropOnPart(event, targetPart) {
    event.preventDefault();
    dragOverTarget = null;
    if (!dragPart || dragPart.id === targetPart.id) return;
    const targetGroupId = findGroupIdForPart(targetPart);
    const dragGroupId = findGroupIdForPart(dragPart);
    if (useDedicatedTables) {
      if (!targetGroupId && !dragGroupId) {
        const newId = crypto.randomUUID();
        const stockType = extractStockType(targetPart) || extractStockType(dragPart);
        await supabase.from('router_groups').insert({
          id: newId,
          name: '',
          stock_type: stockType,
          cut_name: '',
          output_folder: '',
          machine: 'UNC Router'
        });
        await supabase.from('router_group_parts').insert([
          { group_id: newId, part_id: targetPart.id },
          { group_id: newId, part_id: dragPart.id }
        ]);
      } else if (targetGroupId && !dragGroupId) {
        await addPartToGroup(dragPart, targetGroupId);
      } else if (!targetGroupId && dragGroupId) {
        await addPartToGroup(targetPart, dragGroupId);
      } else if (targetGroupId && dragGroupId && targetGroupId !== dragGroupId) {
        await supabase.from('router_group_parts').delete().match({ group_id: dragGroupId, part_id: dragPart.id });
        await addPartToGroup(dragPart, targetGroupId);
      }
    }
    dragPart = null;
    await loadParts();
  }

  async function handleDropOnEmptySpace(event) {
    event.preventDefault();
    dragOverTarget = null;
    if (!dragPart) return;
    if (useDedicatedTables) {
      const newId = crypto.randomUUID();
      await supabase.from('router_groups').insert({
        id: newId,
        name: makeGroupName(dragPart),
        queue_position: routerGroups.length,
        stock: dragPart.stock_assignment || ''
      });
      await supabase.from('router_group_parts').insert({ group_id: newId, part_id: dragPart.id });
    }
    dragPart = null;
    await loadParts();
  }

  async function addPartToGroup(part, groupId) {
    if (!useDedicatedTables) return;
    await supabase.from('router_group_parts').delete().match({ part_id: part.id });
    const { data: existing } = await supabase.from('router_group_parts').select('*').match({ group_id: groupId, part_id: part.id });
    if (!existing || existing.length === 0) {
      await supabase.from('router_group_parts').insert({ group_id: groupId, part_id: part.id });
    }
  }

  function findGroupIdForPart(part) {
    for (const g of Object.values(groupMap)) {
      if (g.parts.some(p => p.id === part.id)) return g.id;
    }
    return null;
  }

  async function removeFromGroup(part) {
    if (useDedicatedTables) {
      let gid = findGroupIdForPart(part);
      await supabase.from('router_group_parts').delete().match({ part_id: part.id });
      if (gid) {
        const { count } = await supabase.from('router_group_parts').select('part_id', { count: 'exact', head: true }).eq('group_id', gid);
        if (!count || count === 0) {
          await supabase.from('router_groups').delete().eq('id', gid);
        }
      }
    }
    await loadParts();
  }

  onMount(() => {
    const unsubUser = userStore.subscribe(v => { profile = v; });
    loadParts();
    return () => { unsubUser?.(); };
  });
</script>

<svelte:head><title>Router Grouping</title></svelte:head>

<!-- Autocam Review Modal -->
<AutocamReviewModal 
  part={autocamReviewPart} 
  visible={showAutocamModal} 
  on:close={closeAutocamReview}
  on:update={loadParts}
/>

<div class="page-header">
  <h1>Router Parts</h1>
  <div class="page-actions">
    {#if isManufacturingLead}
      <a href="/manufacture/autocam" class="btn btn-ghost">
        <Settings size={16} /> Autocam Settings
      </a>
    {/if}
    <a href="/manufacture" class="btn btn-secondary">Back</a>
  </div>
</div>
<div class="subtabs">
  <a href="/manufacture" class:active={$page.url.pathname === '/manufacture'}>ToDo</a>
  <a href="/manufacture/completed" class:active={$page.url.pathname === '/manufacture/completed'}>Completed</a>
  <a href="/manufacture/router" class:active={$page.url.pathname === '/manufacture/router'}>Router</a>
  <a href="/manufacture/post-processing" class:active={$page.url.pathname === '/manufacture/post-processing'}>Post Processing</a>
  <a href="/manufacture/bins" class:active={$page.url.pathname === '/manufacture/bins'}>Bins</a>
</div>

{#if loading}
  <div class="card"><p>Loading...</p></div>
{:else}
  <!-- Mobile cards -->
  <div class="mobile-section">
    {#if Object.keys(groupMap).length > 0}
      <h2 class="subheading">Groups</h2>
      {#each Object.values(groupMap).filter(g => (g.parts && g.parts.length > 0)) as g}
        {#if !groupIsCut(g)}
          <div class="group-card" role="group" aria-label="Router group">
            <div class="group-card-header">
              {#if editingGroupId === g.id}
                <input class="group-name-input" bind:value={editingGroupName} on:keydown={(e)=>{ if(e.key==='Enter'){ saveGroupName(g.id); } else if (e.key==='Escape'){ editingGroupId=null; editingGroupName=''; } }} on:blur={()=>saveGroupName(g.id)} />
              {:else}
                <button class="group-name-btn" on:click={()=>{ editingGroupId=g.id; editingGroupName=g.name || g.id; }}>{g.name || g.id}</button>
                {#if groupIsAllCamReviewed(g) || groupIsTravisProgged(g)}
                  <select 
                    class="group-status-select {groupIsTravisProgged(g) ? 'status-travis' : 'status-cammed'}"
                    value={getGroupStatus(g)}
                    on:change={(e) => handleGroupStatusChange(g.id, e.target.value)}
                  >
                    {#each GROUP_STATUS_OPTIONS as opt}
                      <option value={opt}>{opt}</option>
                    {/each}
                  </select>
                {/if}
              {/if}
            </div>

            <div class="mobile-parts-list">
              {#each g.parts as part (part.id)}
                <div class="part-card" role="article">
                  <div class="part-card-header">
                    <div class="part-card-title">
                      <strong>{part.name}</strong>
                    </div>
                    <span class={`status-badge ${getBadgeClass(part.status, parseMeta(part))}`}>{getStatusDisplay(part)}</span>
                  </div>

                  <div class="part-card-meta">
                    <span class={`tag workflow-tag ${getWorkflowClass(part.workflow)}`}>
                      {getWorkflowLabel(part.workflow)}
                    </span>
                    {#if part.project_id}
                      <span class="part-card-project">{part.project_id}</span>
                    {/if}
                  </div>

                  <div class="part-card-details">
                    <div class="part-card-detail">
                      <span class="detail-label">Qty</span>
                      <span class="detail-value">{part.quantity || 1}</span>
                    </div>
                    <div class="part-card-detail">
                      <span class="detail-label">Stock</span>
                      <span class="detail-value">{getStock(part) || '-'}</span>
                    </div>
                    <div class="part-card-detail">
                      <span class="detail-label">Created</span>
                      <span class="detail-value">{formatDate(part.created_at)}</span>
                    </div>
                  </div>

                  <div class="part-card-actions">
                    {#if part.source_type === 'onshape_api' || part.is_onshape_part}
                      <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadStepFromOnshape(part)}>
                        <Download size={14} /> {getFileTypeLabel(part)}
                      </button>
                    {:else}
                      {#if parseMeta(part).step_file}
                        <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadFromStorage(parseMeta(part).step_file)}>
                          <Download size={14} /> {getFileTypeLabel(part, parseMeta(part))}
                        </button>
                      {:else if part.file_name}
                        <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadFromStorage(part.file_name)}>
                          <Download size={14} /> {getFileTypeLabel(part)}
                        </button>
                      {/if}
                    {/if}

                    <div class="status-action">
                      {#key part.id}
                        <RouterStatusSelector part={part} on:update={loadParts} onReviewAutocam={openAutocamReview} />
                      {/key}
                    </div>

                    <button class="btn btn-ghost btn-sm danger" on:click|stopPropagation={() => removeFromGroup(part)}>Remove</button>
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {/if}
      {/each}
    {/if}

    <h2 class="subheading">Ungrouped</h2>
    <div class="mobile-parts-list">
      {#each ungroupedParts as part (part.id)}
        <div class="part-card" role="article">
          <div class="part-card-header">
            <div class="part-card-title">
              <strong>{part.name}</strong>
            </div>
            <span class={`status-badge ${getBadgeClass(part.status, parseMeta(part))}`}>{getStatusDisplay(part)}</span>
          </div>

          <div class="part-card-meta">
            <span class={`tag workflow-tag ${getWorkflowClass(part.workflow)}`}>
              {getWorkflowLabel(part.workflow)}
            </span>
            {#if part.project_id}
              <span class="part-card-project">{part.project_id}</span>
            {/if}
          </div>

          <div class="part-card-details">
            <div class="part-card-detail">
              <span class="detail-label">Qty</span>
              <span class="detail-value">{part.quantity || 1}</span>
            </div>
            <div class="part-card-detail">
              <span class="detail-label">Stock</span>
              <span class="detail-value">{getStock(part) || '-'}</span>
            </div>
            <div class="part-card-detail">
              <span class="detail-label">Created</span>
              <span class="detail-value">{formatDate(part.created_at)}</span>
            </div>
          </div>

          <div class="part-card-actions">
            {#if part.source_type === 'onshape_api' || part.is_onshape_part}
              <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadStepFromOnshape(part)}>
                <Download size={14} /> {getFileTypeLabel(part)}
              </button>
            {:else}
              {#if parseMeta(part).step_file}
                <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadFromStorage(parseMeta(part).step_file)}>
                  <Download size={14} /> {getFileTypeLabel(part, parseMeta(part))}
                </button>
              {:else if part.file_name}
                <button class="btn btn-secondary btn-sm" on:click|stopPropagation={() => downloadFromStorage(part.file_name)}>
                  <Download size={14} /> {getFileTypeLabel(part)}
                </button>
              {/if}
            {/if}

            <div class="status-action">
              {#key part.id}
                <RouterStatusSelector part={part} on:update={loadParts} onReviewAutocam={openAutocamReview} />
              {/key}
            </div>
          </div>
        </div>
      {/each}
      {#if ungroupedParts.length === 0}
        <p class="hint">No ungrouped parts.</p>
      {/if}
    </div>
  </div>

  <!-- Desktop tables -->
  <div class="group-list desktop-table-view">
    {#if Object.keys(groupMap).length > 0}
      <h2 class="subheading">Groups</h2>
      {#each Object.values(groupMap).filter(g => (g.parts && g.parts.length > 0)) as g}
        {#if !groupIsCut(g)}
  <div class="group-table-wrapper" role="group" aria-label="Router group" on:dragover={(e)=>{e.preventDefault();}} on:drop={(e)=>{ if(dragPart){ handleDrop(e, g.parts[0] || dragPart); } }}>
          <div class="group-table-header">
            {#if editingGroupId === g.id}
              <input class="group-name-input" bind:value={editingGroupName} on:keydown={(e)=>{ if(e.key==='Enter'){ saveGroupName(g.id); } else if (e.key==='Escape'){ editingGroupId=null; editingGroupName=''; } }} on:blur={()=>saveGroupName(g.id)} />
            {:else}
              <button class="group-name-btn" on:click={()=>{ editingGroupId=g.id; editingGroupName=g.name || g.id; }}>{g.name || g.id}</button>
              {#if groupIsAllCamReviewed(g) || groupIsTravisProgged(g)}
                <!-- Group-level status dropdown when all parts are CAM Reviewed or beyond -->
                <select 
                  class="group-status-select {groupIsTravisProgged(g) ? 'status-travis' : 'status-cammed'}"
                  value={getGroupStatus(g)}
                  on:change={(e) => handleGroupStatusChange(g.id, e.target.value)}
                >
                  {#each GROUP_STATUS_OPTIONS as opt}
                    <option value={opt}>{opt}</option>
                  {/each}
                </select>
              {/if}
            {/if}
          </div>

      {#if groupFields[g.id]}
        <div class="group-meta">
          <div class="group-meta-header">
            <div class="group-meta-title">
              <Group size={16} />
              <span>Router setup</span>
            </div>
            <span class="meta-pill">Fill before export</span>
          </div>
          <div class="group-meta-grid">
            <label class="group-meta-field">
              <span class="field-label">Cut name</span>
              <input
                class="meta-input"
                value={groupFields[g.id].cut_name}
                on:change={(e)=>updateGroupField(g.id,'cut_name', e.target.value)}
                disabled={!useDedicatedTables}
                placeholder="Cut name"
              />
            </label>
            <label class="group-meta-field">
              <span class="field-label">Output folder</span>
              <input
                class="meta-input"
                value={groupFields[g.id].output_folder}
                on:change={(e)=>updateGroupField(g.id,'output_folder', e.target.value)}
                disabled={!useDedicatedTables}
                placeholder="/router/outputs"
              />
            </label>
            <label class="group-meta-field">
              <span class="field-label">Machine</span>
              <select
                class="meta-input"
                value={groupFields[g.id].machine}
                on:change={(e)=>updateGroupField(g.id,'machine', e.target.value)}
                disabled={!useDedicatedTables}
              >
                {#each MACHINE_OPTIONS as opt}
                  <option value={opt}>{opt}</option>
                {/each}
              </select>
            </label>
          </div>
        </div>
      {/if}
          <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Stock</th>
                <th>Project</th>
                <th>Qty</th>
                <th>Source</th>
                {#if !groupIsAllCamReviewed(g) && !groupIsTravisProgged(g)}
                  <th>Status</th>
                {/if}
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each g.parts as p, i}
                <tr draggable="true" on:dragstart={(e)=>handleDragStart(e,p)} on:drop={(e)=>handleDrop(e,p)} on:dragover={(e)=>handleDragOver(e,p)} on:dragleave={handleDragLeave}>
                  <td><strong>{p.name}</strong></td>
                  <td>{getStock(p) || '-'}</td>
                  <td class="mono">{p.project_id}</td>
                  <td>{p.quantity || 1}</td>
                  <td>
                    {#if p.source_type === 'onshape_api' || p.is_onshape_part}
                      <button class="btn btn-secondary source-btn" aria-label={`Download ${getFileTypeLabel(p)}`} title={`Download ${getFileTypeLabel(p)}`} on:click={()=>downloadStepFromOnshape(p)}>
                        {getFileTypeLabel(p)}
                      </button>
                    {:else}
                      {#await Promise.resolve(parseMeta(p)) then meta}
                        <div class="source-cell">
                          {#if meta.step_file}
                            <button class="btn btn-secondary source-btn" aria-label={`Download ${getFileTypeLabel(p, meta)}`} title={`Download ${getFileTypeLabel(p, meta)}`} on:click={()=>downloadFromStorage(meta.step_file)}>
                              {getFileTypeLabel(p, meta)}
                            </button>
                          {:else if p.file_name}
                            <button class="btn btn-secondary source-btn" aria-label={`Download ${getFileTypeLabel(p, meta)}`} title={`Download ${getFileTypeLabel(p, meta)}`} on:click={()=>downloadFromStorage(p.file_name)}>
                              {getFileTypeLabel(p, meta)}
                            </button>
                          {:else}-{/if}
                        </div>
                      {/await}
                    {/if}
                  </td>
                  {#if !groupIsAllCamReviewed(g) && !groupIsTravisProgged(g)}
                    <td>
                      {#key p.id}
                        <RouterStatusSelector part={p} on:update={loadParts} onReviewAutocam={openAutocamReview} />
                      {/key}
                    </td>
                  {/if}
                {:else}
                  <span class="text-muted">—</span>
                {/if}
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}

    <div class="router-layout" class:edit-mode={editMode}>
      <!-- Edit Mode: Left Panel - Ungrouped Parts Bank -->
      {#if editMode}
        <div class="card ungrouped-bank">
          <h2 class="section-title">Ungrouped Parts</h2>
          <!-- svelte-ignore a11y_no_static_element_interactions -->
          <div
            class="ungrouped-list"
            role="list"
            on:dragover={(e) => { e.preventDefault(); }}
            on:drop={handleDropOnEmptySpace}
          >
            {#each ungroupedParts as part (part.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="ungrouped-part"
                role="listitem"
                draggable="true"
                on:dragstart={(e) => handleDragStart(e, part)}
                class:dragging={dragPart?.id === part.id}
              >
                <GripVertical size={14} class="drag-handle" />
                <span class="part-name">{part.name}</span>
              </div>
            {:else}
              <p class="text-muted" style="text-align:center; padding: var(--space-4); font-size: var(--font-xs);">All parts are grouped</p>
            {/each}
          </div>
        </div>
      {/if}

      <!-- Groups Panel -->
      <div class="groups-panel">
        <h2 class="section-title">Router Queue</h2>

        {#if routerGroups.length === 0}
          <div class="empty-state">
            <Package size={32} />
            <h3>No Router Groups</h3>
            <p>{editMode ? 'Drag parts together to create groups.' : 'Switch to Edit Mode to create groups.'}</p>
          </div>
        {:else}
          <div class="groups-list">
            {#each routerGroups as g, idx (g.id)}
              <!-- svelte-ignore a11y_no_static_element_interactions -->
              <div
                class="group-card"
                role="article"
                class:drag-over={dragOverTarget === g.id}
                on:dragover={(e) => handleDragOver(e, g.id)}
                on:dragleave={handleDragLeave}
                on:drop={(e) => handleDropOnGroup(e, g)}
              >
                <td><strong>{part.name}</strong></td>
                <td>{getStock(part) || '-'}</td>
                <td class="mono">{part.project_id}</td>
                <td>{part.quantity || 1}</td>
                <td>
                  {#if part.source_type === 'onshape_api' || part.is_onshape_part}
                    <button class="btn btn-secondary source-btn" aria-label={`Download ${getFileTypeLabel(part)}`} title={`Download ${getFileTypeLabel(part)}`} on:click={()=>downloadStepFromOnshape(part)}>
                      {getFileTypeLabel(part)}
                    </button>
                  {:else}
                    {#await Promise.resolve(parseMeta(part)) then meta}
                      <div class="source-cell">
                        {#if meta.step_file}
                          <button class="btn btn-secondary source-btn" aria-label={`Download ${getFileTypeLabel(part, meta)}`} title={`Download ${getFileTypeLabel(part, meta)}`} on:click={()=>downloadFromStorage(meta.step_file)}>
                            {getFileTypeLabel(part, meta)}
                          </button>
                        {:else if part.file_name}
                          <button class="btn btn-secondary source-btn" aria-label={`Download ${getFileTypeLabel(part, meta)}`} title={`Download ${getFileTypeLabel(part, meta)}`} on:click={()=>downloadFromStorage(part.file_name)}>
                            {getFileTypeLabel(part, meta)}
                          </button>
                        {:else}-{/if}
                      </div>
                    {/await}
                  {/if}
                </td>
                <td>
                  {#key part.id}
                    <RouterStatusSelector part={part} on:update={loadParts} onReviewAutocam={openAutocamReview} />
                  {/key}
                </td>
              </tr>
            {/each}
          </div>
        {/if}

        {#if editMode}
          <div class="hint">
            <AlertCircle size={14} />
            Drag parts from the bank to create or add to groups. Drag parts within groups to reorganize.
          </div>
        {/if}
      </div>
    </div>

{/if}

<style>
  /* ==================== Page Actions ==================== */
  .page-actions {
    display: flex;
    gap: var(--gap-2);
    align-items: center;
  }

  /* ==================== Machine Status Grid (View Mode) ==================== */
  .machine-status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: var(--gap-4);
    margin-bottom: var(--space-4);
  }

  .machine-section {
    padding: 0;
    overflow: hidden;
  }

  .machine-header {
    padding: var(--space-3) var(--space-4);
    border-left: 3px solid var(--border);
  }

  .machine-name {
    font-weight: 600;
    font-size: var(--font-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text);
  }

  .machine-status-cards {
    display: grid;
    grid-template-columns: 1fr 1fr;
    border-top: 1px solid var(--border);
  }

  .status-summary-card {
    padding: var(--space-3) var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
  }

  .status-summary-card + .status-summary-card {
    border-left: 1px solid var(--border);
  }

  .status-label {
    font-size: var(--font-xs);
    font-weight: 600;
    text-transform: uppercase;
    color: var(--text-muted);
    letter-spacing: 0.04em;
  }

  .status-group-name {
    font-size: var(--font-xs);
    font-weight: 600;
    color: var(--text);
  }

  .status-group-meta {
    font-size: var(--font-xs);
    color: var(--text-muted);
  }

  .status-target-date {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    font-size: var(--font-xs);
    color: var(--text-muted);
  }

  /* ==================== Color Chips ==================== */
  .color-chip {
    display: inline-flex;
    align-items: center;
    height: var(--control-height);
    padding: var(--control-padding-lg);
    border-radius: var(--radius-sm);
    font-size: var(--font-xs);
    font-weight: 600;
    border: 1px solid;
    line-height: 1;
    box-sizing: border-box;
  }

  /* ==================== Section Title ==================== */
  .section-title {
    font-size: var(--font-base);
    font-weight: 600;
    margin: 0 0 var(--space-3) 0;
    color: var(--text);
  }

  /* ==================== Router Layout ==================== */
  .router-layout {
    display: flex;
    gap: var(--gap-4);
  }

  .router-layout.edit-mode {
    display: grid;
    grid-template-columns: 260px 1fr;
  }

  /* ==================== Ungrouped Parts Bank ==================== */
  .ungrouped-bank {
    padding: var(--space-4);
    max-height: calc(100vh - 250px);
    overflow-y: auto;
    position: sticky;
    top: var(--space-4);
  }

  .ungrouped-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2);
    min-height: 80px;
  }

  .ungrouped-part {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    padding: var(--space-2) var(--space-3);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    cursor: grab;
    transition: border-color 0.15s ease, background 0.15s ease;
  }

  .ungrouped-part:hover {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .ungrouped-part.dragging {
    opacity: 0.4;
  }

  :global(.drag-handle) {
    color: var(--text-muted);
    flex-shrink: 0;
  }

  .part-name {
    font-size: var(--font-xs);
    color: var(--text);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  /* ==================== Groups Panel ==================== */
  .groups-panel {
    flex: 1;
    min-width: 0;
  }

  .groups-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }

  /* ==================== Group Card ==================== */
  .group-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
    transition: border-color 0.15s ease, box-shadow 0.15s ease;
  }

  .group-card.drag-over {
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--accent-subtle);
  }

  .group-card-inner {
    display: grid;
    grid-template-columns: 1fr 240px;
    min-height: 120px;
  }

  /* Group Parts (Left Half) */
  .group-parts {
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
  }

  .group-header {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    margin-bottom: var(--space-3);
    padding-bottom: var(--space-3);
    border-bottom: 1px solid var(--border);
  }

  .group-name-btn {
    background: none;
    border: none;
    font-size: 1rem;
    font-weight: 700;
    color: var(--text);
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: background 0.15s ease, color 0.15s ease;
  }

  .group-name-btn:hover {
    background: var(--neutral-100);
    color: var(--secondary);
  }

  .group-name-input {
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: var(--font-base);
    font-weight: 600;
    min-width: 200px;
    background: var(--surface-1);
  }

  .group-name-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px var(--btn-focus-ring);
  }

  /* Group meta area (inspired by fill parts list) */
  .group-meta {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
    box-shadow: inset 0 1px 0 rgba(255,255,255,0.04);
  }

  .group-meta-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    margin-bottom: var(--space-3);
  }

  .group-meta-title {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    font-weight: 700;
    color: var(--secondary);
    letter-spacing: 0.01em;
  }

  .meta-pill {
    display: inline-flex;
    align-items: center;
    gap: 0.35rem;
    background: var(--accent-subtle);
    color: var(--accent-strong, var(--accent));
    border: 1px solid var(--accent-soft, var(--accent));
    border-radius: 999px;
    padding: 0.35rem 0.75rem;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .group-meta-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: var(--gap-3);
  }

  .group-meta-field {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }

  .field-label {
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    font-weight: 700;
  }

  .meta-input {
    width: 100%;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    padding: 0.65rem 0.75rem;
    font-size: 0.95rem;
    background: var(--card);
    color: var(--text);
    transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
  }

  .meta-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--btn-focus-ring);
    background: var(--surface-1);
  }

  .meta-input:disabled {
    cursor: not-allowed;
    opacity: 0.6;
  }

  /* Drag-over highlight for table rows */
  :global(.table tr.drag-over) {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
    background: var(--accent-subtle) !important;
  }

  .mismatch-badge.status-mismatch {
    background: var(--brand-gold-soft);
    color: var(--brand-gold-strong);
  }

  .mismatch-badge.stock-mismatch {
    background: var(--blue-soft);
    color: var(--blue-strong);
  }

  .parts-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
  }

  .part-row {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: background 0.15s ease;
  }

  .part-row:hover {
    background: var(--surface-2);
  }

  .part-row.drag-over {
    background: var(--accent-subtle);
    outline: 1px dashed var(--accent);
  }

  .remove-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 22px;
    height: 22px;
    padding: 0;
    border: 1px solid transparent;
    border-radius: var(--radius-sm);
    background: transparent;
    color: var(--text-muted);
    cursor: pointer;
    margin-left: auto;
    transition: all 0.15s ease;
  }

  .remove-btn:hover {
    background: var(--red-soft);
    border-color: var(--red-base);
    color: var(--red-base);
  }

  /* ==================== Group Metadata (Right Half) ==================== */
  .group-metadata {
    padding: var(--space-4);
    background: var(--surface-2);
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }

  .meta-field {
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
  }

  .meta-label {
    font-size: var(--font-xs);
    font-weight: 600;
    color: var(--text-muted);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .meta-value {
    font-size: var(--font-xs);
    color: var(--text);
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  /* Status select - color-coded like tags, matching control height */
  .group-status-select {
    font-weight: 600;
    font-size: var(--font-xs);
    line-height: 1;
  }

  /* Queue controls */
  .queue-controls {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    margin-top: auto;
  }

  .queue-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--primary);
    color: var(--text);
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .queue-btn:hover:not(:disabled) {
    background: var(--accent-subtle);
    border-color: var(--accent);
  }

  .queue-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }

  .queue-position {
    font-size: var(--font-xs);
    font-weight: 600;
    color: var(--text-muted);
    min-width: 30px;
    text-align: center;
  }

  /* ==================== Hints ==================== */
  .hint {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    font-size: var(--font-xs);
    color: var(--text-muted);
    margin-top: var(--space-4);
    padding: var(--space-3) var(--space-4);
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
  }

  /* ==================== Responsive ==================== */
  @media (max-width: 900px) {
    .router-layout.edit-mode {
      grid-template-columns: 1fr;
    }

    .ungrouped-bank {
      max-height: 200px;
      position: static;
    }

    .group-card-inner {
      grid-template-columns: 1fr;
    }

    .group-parts {
      border-right: none;
      border-bottom: 1px solid var(--border);
    }

    .machine-status-grid {
      grid-template-columns: 1fr;
    }

    .machine-status-cards {
      grid-template-columns: 1fr;
    }

    .status-summary-card + .status-summary-card {
      border-left: none;
      border-top: 1px solid var(--border);
    }

  }

  /* Mobile card layout (hidden on desktop) */
  .mobile-section {
    display: none;
    margin-top: var(--space-4);
    flex-direction: column;
    gap: var(--space-4);
  }

  .mobile-parts-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .group-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }

  .group-card-header {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    justify-content: space-between;
    margin-bottom: var(--space-3);
  }

  .part-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    box-shadow: var(--shadow-sm);
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .part-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--gap-3);
  }

  .part-card-title {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .part-card-title strong {
    font-size: 1rem;
    color: var(--secondary);
  }

  .part-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
  }

  .part-card-project {
    font-size: var(--font-xs);
    color: var(--text-muted);
    font-family: var(--font-mono);
  }

  .part-card-details {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
    gap: var(--gap-3);
    padding: var(--space-3);
    background: var(--background);
    border-radius: var(--radius-sm);
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
    font-size: 0.9rem;
    font-weight: 600;
  }

  .part-card-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
    align-items: center;
  }

  .part-card-actions .btn {
    flex: 1 1 auto;
    min-width: 120px;
    justify-content: center;
  }

  .status-action {
    flex: 1 1 160px;
  }

  /* Desktop hide/show */
  .desktop-table-view {
    display: block;
  }

  @media (max-width: 900px) {
    .desktop-table-view {
      display: none;
    }
    .mobile-section {
      display: flex;
    }
  }

  @media (max-width: 540px) {
    .part-card {
      padding: var(--space-3);
    }
    .part-card-actions .btn {
      min-width: 100px;
    }
    .part-card-details {
      grid-template-columns: 1fr 1fr;
    }
  }
</style>
