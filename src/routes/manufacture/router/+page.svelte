<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';
  import { Package, Group, GripVertical, Download } from 'lucide-svelte';

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

  // Check if all parts in group are CAM Reviewed (status === 'cammed' without travis flag)
  function groupIsAllCamReviewed(g) {
    if (!g || !g.parts || g.parts.length === 0) return false;
    return g.parts.every(p => {
      const m = parseMeta(p);
      // CAM Reviewed means status is 'cammed' and not travis_progged
      const isTravis = m?.travis_progged || (m?.router_meta && m.router_meta.step === 'queued');
      return p.status === 'cammed' && !isTravis;
    });
  }

  // Get the current group-level status for display
  function getGroupStatus(g) {
    if (!g || !g.parts || g.parts.length === 0) return BUTTONS.PENDING;
    if (groupIsCut(g)) return BUTTONS.MACHINED;
    if (groupIsTravisProgged(g)) return BUTTONS.TRAVIS;
    if (groupIsAllCamReviewed(g)) return BUTTONS.CAM_REVIEWED;
    return BUTTONS.PENDING; // Mixed or still in progress
  }

  // Group status options after CAM Reviewed
  const GROUP_STATUS_OPTIONS = [BUTTONS.CAM_REVIEWED, BUTTONS.TRAVIS, BUTTONS.MACHINED];

  let parts = [];
  let loading = true;
  let dragPart = null;
  let groupMap = {}; // group_id => { id, parts: [] }
  let useDedicatedTables = true; // will flip false if queries fail
  let editingGroupId = null; // currently editing group id
  let editingGroupName = '';

  import ROUTER_FLOW from '$lib/router_flow.json';
  import { getDisplayStatus, BUTTONS, getBadgeClass } from '$lib/statuses.js';
  import RouterStatusSelector from '$lib/components/RouterStatusSelector.svelte';

  // We store grouping metadata inside file_url JSON under router_group_id
  function parseMeta(part) {
    try { return JSON.parse(part.file_url || '{}') || {}; } catch { return {}; }
  }
  async function updateMeta(part, updates) {
    let root = {}; try { root = JSON.parse(part.file_url || '{}') || {}; } catch { root = {}; }
    root = { ...root, ...updates };
    await supabase.from('parts').update({ file_url: JSON.stringify(root), updated_at: new Date().toISOString() }).eq('id', part.id);
  }

  // Router meta helpers (store step/travis flag under file_url.router_meta)
  async function updateRouterMeta(part, updates) {
    if (!part) return;
    let root = {};
    try { root = JSON.parse(part.file_url || '{}') || {}; } catch { root = {}; }
    root.router_meta = { ...(root.router_meta || {}), ...updates };
    await supabase.from('parts')
      .update({ file_url: JSON.stringify(root), updated_at: new Date().toISOString() })
      .eq('id', part.id);
  }

  // Group-level actions: set all parts in group to TProged or Cut
  async function applyGroupAction(groupId, action) {
    const group = groupMap[groupId];
    if (!group) return;
    if (action === 'tproged') {
      // Ensure status cammed, mark travis_progged and move to queued
      for (const p of group.parts) {
        if (p.status !== 'cammed') {
          await supabase.from('parts').update({ status: 'cammed', updated_at: new Date().toISOString() }).eq('id', p.id);
        }
        await updateRouterMeta(p, { travis_progged: true, step: 'queued' });
      }
    } else if (action === 'cut' || action === 'machined') {
      // Move to machined
      for (const p of group.parts) {
        await supabase.from('parts').update({ status: 'machined', updated_at: new Date().toISOString() }).eq('id', p.id);
        await updateRouterMeta(p, { step: 'cut' });
      }
    }
    await loadParts();
  }

  // Handle group status dropdown change
  async function handleGroupStatusChange(groupId, newStatus) {
    const group = groupMap[groupId];
    if (!group) return;
    
    if (newStatus === BUTTONS.TRAVIS) {
      await applyGroupAction(groupId, 'tproged');
    } else if (newStatus === BUTTONS.MACHINED) {
      await applyGroupAction(groupId, 'machined');
    } else if (newStatus === BUTTONS.CAM_REVIEWED) {
      // Reset back to CAM Reviewed (remove travis flag)
      for (const p of group.parts) {
        await supabase.from('parts').update({ status: 'cammed', updated_at: new Date().toISOString() }).eq('id', p.id);
        const m = parseMeta(p);
        if (m.travis_progged) delete m.travis_progged;
        if (m.router_meta) {
          delete m.router_meta.travis_progged;
          m.router_meta.step = 'cammed';
        }
        await supabase.from('parts').update({ file_url: JSON.stringify(m), updated_at: new Date().toISOString() }).eq('id', p.id);
      }
      await loadParts();
    }
  }

  // Router helpers: compute next router step for a part and advance it
  function getNextRouterStep(part) {
    const meta = parseMeta(part);
    const seq = ROUTER_FLOW.sequence || [];
    const current = meta?.router_meta?.step;
    if (current) {
      const idx = seq.indexOf(current);
      if (idx >= 0 && idx < seq.length - 1) return seq[idx + 1];
      return null;
    }
    // No explicit step stored: infer from status
    if (part.status === 'pending' || part.status === 'in-progress') return 'cam_ing';
    if (part.status === 'cammed') return 'layout'; // assume cammed means ready for layout when no meta
    return null;
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
  }

  // When using dedicated tables as the source of truth, clear any stale JSON router_group_id
  async function clearJsonGroup(part) {
    const meta = parseMeta(part);
    if (meta && meta.router_group_id) {
      delete meta.router_group_id;
      await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', part.id);
    }
  }

  async function loadParts() {
    const { data, error } = await supabase.from('parts').select('*').eq('workflow','router').order('created_at', { ascending: false });
    if (!error) {
      // Show all router parts except those fully completed/kitted (non-complete set)
      parts = (data || []).filter(p => {
        if (p.status === 'complete' || p.status === 'kitted') return false;
        return true;
      });
      // Prefill selected bin dropdowns from existing values
      for (const p of parts) {
        if (p.kitting_bin) selectedBinMap[p.id] = p.kitting_bin;
      }
    }
    // Try to load groups from dedicated tables
    if (useDedicatedTables) {
      const { data: groups, error: gErr } = await supabase.from('router_groups').select('id, name, created_at');
      const { data: links, error: lErr } = await supabase.from('router_group_parts').select('group_id, part_id');
      if (gErr || lErr) {
        console.log('Failed to load dedicated tables, falling back to JSON', { gErr, lErr });
        useDedicatedTables = false; // fallback
        buildGroups();
      } else {
        console.log('Loaded groups and links', { groups, links });
        const gmap = {};
        groups.forEach(g => { gmap[g.id] = { id: g.id, name: g.name || g.id, parts: [] }; });
        const partById = Object.fromEntries(parts.map(p => [p.id, p]));
        links.forEach(l => { if (gmap[l.group_id] && partById[l.part_id]) gmap[l.group_id].parts.push(partById[l.part_id]); });
        groupMap = gmap;
        console.log('Built groupMap', groupMap);
      }
    } else {
      buildGroups();
    }
    loading = false;
  }

  function buildGroups() {
    groupMap = {};
    for (const p of parts) {
      const meta = parseMeta(p);
      if (meta.router_group_id) {
        if (!groupMap[meta.router_group_id]) groupMap[meta.router_group_id] = { id: meta.router_group_id, name: meta.router_group_name || meta.router_group_id, parts: [] };
        groupMap[meta.router_group_id].parts.push(p);
      }
    }
  }

  function getGroupId(part) { return parseMeta(part).router_group_id; }
  function findGroupIdForPart(part) {
    if (useDedicatedTables) {
      for (const g of Object.values(groupMap)) {
        if (g.parts.some(p => p.id === part.id)) return g.id;
      }
      return null;
    }
    return getGroupId(part) || null;
  }
  // Build a definitive grouped-id set. When using dedicated tables, ignore JSON metadata entirely.
  // Only include JSON router_group_id when we have fallen back to JSON mode.
  $: groupedIdSet = (() => {
    const ids = new Set(Object.values(groupMap).flatMap((g) => g.parts.map((p) => p.id)));
    if (!useDedicatedTables) {
      // Back-compat: include parts that still have a non-empty JSON router_group_id
      for (const p of parts) {
        const meta = parseMeta(p);
        const gid = meta && typeof meta.router_group_id !== 'undefined' ? meta.router_group_id : null;
        const hasGid = typeof gid === 'string' ? gid.trim().length > 0 : Boolean(gid);
        if (hasGid) ids.add(p.id);
      }
    }
    return ids;
  })();

  // Reactive list of parts not in any group
  $: ungroupedParts = parts.filter((p) => !groupedIdSet.has(p.id));
  function getStock(part) { return part.stock_assignment || ''; }
  function makeGroupName(part) {
    const base = (getStock(part).split(' ')[0] || 'Group').replace(/[^A-Za-z0-9]/g,'');
    const rand = Math.floor(10 + Math.random()*90); // 2 digits
    return `${base}${rand}`;
  }

  // (Status chip display removed in favor of dropdown editing)

  async function updateStatus(part, value) {
    if (!part) return;
    if (value === BUTTONS.PENDING) {
      // set status pending and clear travis flag
      await supabase.from('parts').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', part.id);
      const meta = parseMeta(part);
      if (meta.travis_progged || meta.router_group_name) {
        if (meta.travis_progged) delete meta.travis_progged;
        await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', part.id);
      }
    } else if (value === BUTTONS.CAM_REVIEWED) {
      // status cammed & remove travis flag
      await supabase.from('parts').update({ status: 'cammed', updated_at: new Date().toISOString() }).eq('id', part.id);
      const meta = parseMeta(part);
      if (meta.travis_progged) {
        delete meta.travis_progged;
        await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', part.id);
      }
    } else if (value === BUTTONS.TRAVIS) {
      // underlying status cammed + flag
      await supabase.from('parts').update({ status: 'cammed', updated_at: new Date().toISOString() }).eq('id', part.id);
      const meta = parseMeta(part);
      if (!meta.travis_progged) {
        meta.travis_progged = true;
        await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', part.id);
      }
    } else if (value === 'Cut') {
      // Set router workflow step to 'cut' (do not mark complete yet)
      const meta = parseMeta(part);
      if (!meta.router_meta) meta.router_meta = {};
      meta.router_meta.step = 'cut';
      await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', part.id);
    }
    await loadParts();
  }

  // Source download helpers (mirrors manufacture list simplified)
  async function downloadFile(part) {
    if (!part) return;
    try {
      if (part.status === 'pending') {
        await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', part.id);
      }
      if (part.source_type === 'onshape_api' || part.is_onshape_part) {
        await downloadFromOnshape(part);
      } else if (part.file_name) {
        await downloadFromStorage(part.file_name, part.id);
      }
    } catch (e) {
      console.error('Download failed', e);
      alert('Download failed: ' + (e?.message || e));
    } finally {
      await loadParts();
    }
  }

  async function downloadFromOnshape(part) {
    try {
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
      if (!resp.ok) throw new Error('Onshape download failed');
      const blob = await resp.blob();
      const ext = part.workflow === '3d-print' ? 'step' : (part.file_format === 'stl' ? 'stl' : 'step');
      const fname = `${(part.name || 'part').replace(/[^A-Za-z0-9]/g,'_')}.${ext}`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=fname; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { throw e; }
  }

  async function downloadStepFromOnshape(part) {
    try {
      if (part?.status === 'pending') {
        await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', part.id);
      }
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
      if (!resp.ok) throw new Error('Onshape STEP download failed');
      const blob = await resp.blob();
      const fname = `${(part.name || 'part').replace(/[^A-Za-z0-9]/g,'_')}.step`;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a'); a.href=url; a.download=fname; document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url);
    } catch (e) { throw e; }
  }



  async function downloadFromStorage(fileName) {
    try {
      let { data, error } = await supabase.storage.from('manufacturing-files').createSignedUrl(fileName,60);
      if (error) throw error;
      window.open(data.signedUrl,'_blank');
    } catch (e) { throw e; }
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
    if (!newName) { editingGroupId = null; editingGroupName=''; return; }
    try {
      if (useDedicatedTables) {
        await supabase.from('router_groups').update({ name: newName }).eq('id', gid);
      } else {
        // store in each part's metadata for this group
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
      editingGroupId = null; editingGroupName='';
      await loadParts();
    }
  }

  function handleDragStart(event, part) {
    dragPart = part;
    event.dataTransfer.effectAllowed = 'move';
    // start autoscroll watcher while dragging
    startAutoScroll(event);
  }
  function handleDragOver(event, targetPart) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
    // update autoscroll position
    updateAutoScroll(event);
  }
  function handleDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
  }
  async function handleDrop(event, targetPart) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    if (!dragPart || dragPart.id === targetPart.id) return;

    // stop autoscroll when drop completes
    stopAutoScroll();

  // Establish or reuse a group id (use link-table map when present)
  let targetGroup = findGroupIdForPart(targetPart);
  const dragGroup = findGroupIdForPart(dragPart);

  if (useDedicatedTables) {
      // Need concrete group id(s) from link table. Ensure we remove any existing links for parts being moved
      if (!targetGroup && !dragGroup) {
        // If either part still has links in DB (stale groupMap), remove them first
        await supabase.from('router_group_parts').delete().match({ part_id: targetPart.id });
        await supabase.from('router_group_parts').delete().match({ part_id: dragPart.id });
        const newId = crypto.randomUUID();
        await supabase.from('router_groups').insert({ id: newId, name: makeGroupName(targetPart) });
        await supabase.from('router_group_parts').insert([
          { group_id: newId, part_id: targetPart.id },
          { group_id: newId, part_id: dragPart.id }
        ]);
      } else if (targetGroup && !dragGroup) {
        // remove any existing links for dragPart (move it)
        await supabase.from('router_group_parts').delete().match({ part_id: dragPart.id });
        // insert only if not already present
        const { data: existing } = await supabase.from('router_group_parts').select('*').match({ group_id: targetGroup, part_id: dragPart.id });
        if (!existing || existing.length === 0) {
          await supabase.from('router_group_parts').insert({ group_id: targetGroup, part_id: dragPart.id });
        }
      } else if (!targetGroup && dragGroup) {
        // remove any existing links for targetPart
        await supabase.from('router_group_parts').delete().match({ part_id: targetPart.id });
        const { data: existing } = await supabase.from('router_group_parts').select('*').match({ group_id: dragGroup, part_id: targetPart.id });
        if (!existing || existing.length === 0) {
          await supabase.from('router_group_parts').insert({ group_id: dragGroup, part_id: targetPart.id });
        }
      } else if (targetGroup && dragGroup && targetGroup !== dragGroup) {
        // Move drag part to targetGroup (delete old link, insert if missing)
        await supabase.from('router_group_parts').delete().match({ group_id: dragGroup, part_id: dragPart.id });
        const { data: existing } = await supabase.from('router_group_parts').select('*').match({ group_id: targetGroup, part_id: dragPart.id });
        if (!existing || existing.length === 0) {
          await supabase.from('router_group_parts').insert({ group_id: targetGroup, part_id: dragPart.id });
        }
      }
    } else {
      if (!targetGroup && !dragGroup) {
        targetGroup = `grp_${Date.now()}`;
        await updateMeta(targetPart, { router_group_id: targetGroup });
        await updateMeta(dragPart, { router_group_id: targetGroup });
      } else if (targetGroup && !dragGroup) {
        await updateMeta(dragPart, { router_group_id: targetGroup });
      } else if (!targetGroup && dragGroup) {
        await updateMeta(targetPart, { router_group_id: dragGroup });
      } else if (targetGroup && dragGroup && targetGroup !== dragGroup) {
        await updateMeta(dragPart, { router_group_id: targetGroup });
      }
    }
    if (useDedicatedTables) {
      await clearJsonGroup(targetPart);
      await clearJsonGroup(dragPart);
    }
    await loadParts();
  }

  // --- Auto-scroll while dragging ---
  let _autoScrollTimer = null;
  let _lastMouseY = 0;
  const SCROLL_ZONE = 120; // px from viewport edge to start scrolling
  const SCROLL_SPEED = 12; // px per tick

  function startAutoScroll(event) {
    _lastMouseY = event.clientY || (event.touches && event.touches[0] && event.touches[0].clientY) || 0;
    if (_autoScrollTimer) return;
    _autoScrollTimer = setInterval(() => {
      try {
        const rect = document.documentElement.getBoundingClientRect();
        const viewHeight = window.innerHeight || (rect.bottom - rect.top);
        if (!_lastMouseY) return;
        // If mouse near top
        if (_lastMouseY < SCROLL_ZONE) {
          const amount = Math.ceil((SCROLL_ZONE - _lastMouseY) / SCROLL_ZONE * SCROLL_SPEED);
          window.scrollBy({ top: -amount, left: 0, behavior: 'auto' });
        } else if (_lastMouseY > viewHeight - SCROLL_ZONE) {
          const amount = Math.ceil((_lastMouseY - (viewHeight - SCROLL_ZONE)) / SCROLL_ZONE * SCROLL_SPEED);
          window.scrollBy({ top: amount, left: 0, behavior: 'auto' });
        }
      } catch (e) {
        // ignore
      }
    }, 30);
    // update last mouse position globally while dragging
    window.addEventListener('dragover', updateAutoScroll);
    window.addEventListener('touchmove', updateAutoScroll, { passive: true });
  }

  function updateAutoScroll(event) {
    _lastMouseY = event.clientY || (event.touches && event.touches[0] && event.touches[0].clientY) || _lastMouseY;
  }

  function stopAutoScroll() {
    if (_autoScrollTimer) {
      clearInterval(_autoScrollTimer);
      _autoScrollTimer = null;
    }
    window.removeEventListener('dragover', updateAutoScroll);
    window.removeEventListener('touchmove', updateAutoScroll);
    _lastMouseY = 0;
  }

  async function removeFromGroup(part) {
    if (useDedicatedTables) {
      // identify group id
      let gid = null;
      for (const g of Object.values(groupMap)) {
        if (g.parts.some(p => p.id === part.id)) { gid = g.id; break; }
      }
      await supabase.from('router_group_parts').delete().match({ part_id: part.id });
      if (gid) {
        // check if any parts remain
        const { count } = await supabase.from('router_group_parts').select('part_id', { count: 'exact', head: true }).eq('group_id', gid);
        if (!count || count === 0) {
          await supabase.from('router_groups').delete().eq('id', gid);
        }
      }
      await clearJsonGroup(part);
    } else {
      const meta = parseMeta(part);
      if (!meta.router_group_id) return;
      delete meta.router_group_id;
      await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', part.id);
    }
    await loadParts();
  }

  onMount(loadParts);
</script>

<svelte:head><title>Router Grouping</title></svelte:head>

<div class="page-header">
  <h1>Router Parts</h1>
  <div class="page-actions">
    <a href="/manufacture" class="btn btn-secondary">Back</a>
  </div>
</div>
<div class="subtabs">
  <a href="/manufacture" class:active={$page.url.pathname === '/manufacture'}>ToDo</a>
  <a href="/manufacture/completed" class:active={$page.url.pathname === '/manufacture/completed'}>Completed</a>
  <a href="/manufacture/router" class:active={$page.url.pathname === '/manufacture/router'}>Router</a>
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
                        <RouterStatusSelector part={part} on:update={loadParts} />
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
                <RouterStatusSelector part={part} on:update={loadParts} />
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
                        <RouterStatusSelector part={p} on:update={loadParts} />
                      {/key}
                    </td>
                  {/if}
                  <td><button class="remove-btn" on:click={()=>removeFromGroup(p)} title="Remove from group">×</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
          </div>
        </div>
      {/if}
      {/each}
    {/if}

    <h2 class="subheading">Ungrouped</h2>
    <div class="card">
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Name</th>
              <th>Stock</th>
              <th>Project</th>
              <th>Qty</th>
              <th>Source</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {#each ungroupedParts as part, i (part.id)}
              <tr
                draggable="true"
                on:dragstart={(e)=>handleDragStart(e,part)}
                on:dragover={(e)=>handleDragOver(e,part)}
                on:dragleave={handleDragLeave}
                on:drop={(e)=>handleDrop(e,part)}
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
                    <RouterStatusSelector part={part} on:update={loadParts} />
                  {/key}
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
      <p class="hint">Drag one row onto another to create or add to a group. Drag grouped rows onto ungrouped rows to merge. Remove via ×.</p>
    </div>
  </div>
{/if}

<style>
  /* Main page layout */
  .group-list {
    display: flex;
    flex-direction: column;
    gap: var(--space-6);
  }

  /* Section headings */
  .subheading {
    margin: 0 0 var(--space-3) 0;
    font-size: var(--font-md);
    font-weight: 600;
    color: var(--text);
  }

  /* Group card wrapper */
  .group-table-wrapper {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }

  /* Group header with name + actions */
  .group-table-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    margin-bottom: var(--space-3);
  }

  .group-name-btn {
    background: none;
    border: none;
    font-size: 1rem;
    font-weight: 600;
    color: var(--text);
    cursor: pointer;
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
    transition: background 0.15s ease;
  }

  .group-name-btn:hover {
    background: var(--neutral-100);
  }

  .group-name-input {
    border: 1px solid var(--border);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-sm);
    font-size: 1rem;
    font-weight: 600;
    min-width: 180px;
  }

  .group-name-input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 2px var(--btn-focus-ring);
  }

  /* Drag-over highlight for table rows */
  :global(.table tr.drag-over) {
    outline: 2px dashed var(--accent);
    outline-offset: -2px;
    background: var(--accent-subtle) !important;
  }

  /* Draggable row cursor */
  .table tbody tr {
    cursor: grab;
  }

  .table tbody tr:active {
    cursor: grabbing;
  }

  /* Hint text */
  .hint {
    font-size: var(--font-xs);
    color: var(--text-muted);
    margin-top: var(--space-3);
  }

  /* Source file display */
  .source-cell {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    flex-wrap: wrap;
  }

  .source-tag {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: transparent;
    color: var(--secondary);
    border: 1px solid var(--border);
    text-transform: uppercase;
    letter-spacing: 0.02em;
    height: var(--control-height);
    min-height: var(--control-height);
    padding: 0 0.75rem;
    border-radius: var(--radius-sm);
    font-size: 0.8125rem;
    line-height: 1;
    box-sizing: border-box;
  }

  .file-label {
    max-width: 140px;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    font-size: var(--font-xs);
    color: var(--text-muted);
  }

  /* Remove button styling */
  .remove-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    padding: 0;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--color-white);
    color: var(--text-muted);
    font-size: 1.25rem;
    font-weight: 400;
    line-height: 1;
    cursor: pointer;
    transition: all 0.15s ease;
  }

  .remove-btn:hover {
    background: var(--red-soft);
    border-color: var(--red-base);
    color: var(--red-base);
  }

  /* Mono text for project IDs */
  .mono {
    font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    font-size: 0.8125rem;
  }

  /* Group-level status dropdown */
  .group-status-select {
    appearance: none;
    -webkit-appearance: none;
    cursor: pointer;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    padding: 0 2rem 0 0.75rem;
    height: var(--control-height, 32px);
    min-width: 140px;
    border-radius: var(--radius-sm, 4px);
    border: 1px solid transparent;
    margin-left: auto;
    background-image: url("data:image/svg+xml;charset=US-ASCII,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%22292.4%22%20height%3D%22292.4%22%3E%3Cpath%20fill%3D%22%23333%22%20d%3D%22M287%2069.4a17.6%2017.6%200%200%200-13-5.4H18.4c-5%200-9.3%201.8-12.9%205.4A17.6%2017.6%200%200%200%200%2082.2c0%205%201.8%209.3%205.4%2012.9l128%20127.9c3.6%203.6%207.8%205.4%2012.8%205.4s9.2-1.8%2012.8-5.4L287%2095c3.5-3.5%205.4-7.8%205.4-12.8%200-5-1.9-9.2-5.5-12.8z%22%2F%3E%3C%2Fsvg%3E");
    background-repeat: no-repeat;
    background-position: right 0.5rem center;
    background-size: 0.5em auto;
    box-sizing: border-box;
  }

  .group-status-select.status-cammed {
    background-color: var(--purple-soft, #ede7f6);
    color: var(--purple-strong, #7b1fa2);
    border-color: var(--purple-base, #9c27b0);
  }

  .group-status-select.status-travis {
    background-color: var(--green-soft, #d1fae5);
    color: var(--green-strong, #166534);
    border-color: var(--green-base, #4ea953);
  }

  .group-status-select option {
    background-color: white;
    color: #1f2933;
    font-weight: 500;
  }

  /* Mobile responsive */
  @media (max-width: 768px) {
    .group-table-wrapper {
      padding: var(--space-3);
    }

    .group-table-header {
      flex-wrap: wrap;
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
