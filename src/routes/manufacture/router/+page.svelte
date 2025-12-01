<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';
  import { Package, Group, GripVertical, Download } from 'lucide-svelte';

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

  let parts = [];
  let loading = true;
  let dragPart = null;
  let groupMap = {}; // group_id => { id, parts: [] }
  let useDedicatedTables = true; // will flip false if queries fail
  let editingGroupId = null; // currently editing group id
  let editingGroupName = '';

  import ROUTER_FLOW from '$lib/router_flow.json';
  import { getDisplayStatus, BUTTONS, getBadgeClass } from '$lib/statuses.js';

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
    } else if (action === 'cut') {
      // Move to cut
      for (const p of group.parts) {
        await updateRouterMeta(p, { step: 'cut' });
      }
    }
    await loadParts();
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
        await supabase.from('parts').update({ status: 'cammed', updated_at: new Date().toISOString() }).eq('id', part.id);
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
      // Filter to only show router parts whose status is pending, cammed, or travis_progged (meta flag)
      parts = (data || []).filter(p => {
        if (p.status === 'pending') return true;
        if (p.status === 'cammed') return true; // include cammed (we will distinguish travis_progged in display)
        // Treat travis_progged as a virtual status layered on top of cammed; if future real status added, handle here
        const meta = parseMeta(p);
        if (meta?.travis_progged) return true;
        return false;
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
        format: part.file_format === 'stl' ? 'STL' : 'STEP'
      });
      const resp = await fetch(`/api/onshape?${params}`);
      if (!resp.ok) throw new Error('Onshape download failed');
      const blob = await resp.blob();
      const ext = part.file_format === 'stl' ? 'stl' : 'step';
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

  async function downloadDXFFromOnshape(part) {
    try {
      if (part?.status === 'pending') {
        await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', part.id);
      }
      const params = new URLSearchParams({
        action: 'convert-to-dxf',
        documentId: part.onshape_document_id,
        elementId: part.onshape_element_id,
        partId: part.onshape_part_id,
        wvm: part.onshape_wvm || 'v',
        wvmId: part.onshape_wvmid
      });
      const resp = await fetch(`/api/onshape?${params}`);
      if (!resp.ok) throw new Error('Onshape DXF download failed');
      const blob = await resp.blob();
      const fname = `${(part.name || 'part').replace(/[^A-Za-z0-9]/g,'_')}.dxf`;
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
  <div class="group-list">
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
              {#if groupIsReadyForTProged(g)}
                <button class="btn btn-primary btn-sm" on:click={() => applyGroupAction(g.id, 'tproged')}>{BUTTONS.TRAVIS}</button>
              {:else if groupIsTravisProgged(g)}
                <button class="btn btn-warning btn-sm" on:click={() => applyGroupAction(g.id, 'cut')}>Cut</button>
              {/if}
            {/if}
          </div>
          <div class="bom-table-container">
          <table class="bom-table group-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Stock</th>
                <th>Project</th>
                <th>Qty</th>
                <th>Source</th>
                <th class="action-col">Status</th>
                <th class="remove-col"></th>
              </tr>
            </thead>
            <tbody>
              {#each g.parts as p, i}
                <tr class="row {i % 2 === 0 ? 'even':'odd'}" draggable="true" on:dragstart={(e)=>handleDragStart(e,p)} on:drop={(e)=>handleDrop(e,p)} on:dragover={(e)=>handleDragOver(e,p)} on:dragleave={handleDragLeave}>
                  <td class="part-name">{p.name}</td>
                  <td>{getStock(p) || '-'}</td>
                  <td class="mono">{p.project_id}</td>
                  <td>{p.quantity || 1}</td>
                  <td>
                    {#if p.source_type === 'onshape_api' || p.is_onshape_part}
                      <div class="source-cell">
                        <span class="source-tag">STEP</span>
                        <button class="btn btn-secondary btn-icon" aria-label="Download STEP" title="Download STEP" on:click={()=>downloadStepFromOnshape(p)}><Download size={14} /></button>
                        <span class="source-tag">DXF</span>
                        <button class="btn btn-secondary btn-icon" aria-label="Download DXF" title="Download DXF" on:click={()=>downloadDXFFromOnshape(p)}><Download size={14} /></button>
                      </div>
                    {:else}
                      {#await Promise.resolve(parseMeta(p)) then meta}
                        <div class="source-cell">
                          {#if meta.step_file}
                            <span class="source-tag">STEP</span>
                            <button class="btn btn-secondary btn-icon" aria-label="Download STEP" title="Download STEP" on:click={()=>downloadFromStorage(meta.step_file)}><Download size={14} /></button>
                          {/if}
                          {#if meta.dxf_file}
                            <span class="source-tag">DXF</span>
                            <button class="btn btn-secondary btn-icon" aria-label="Download DXF" title="Download DXF" on:click={()=>downloadFromStorage(meta.dxf_file)}><Download size={14} /></button>
                          {/if}
                          {#if !meta.step_file && !meta.dxf_file}
                            {#if p.file_name}
                              <span class="file-label">{p.file_name}</span>
                              <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click={()=>downloadFromStorage(p.file_name)}><Download size={14} /></button>
                            {:else}-{/if}
                          {/if}
                        </div>
                      {/await}
                    {/if}
                  </td>
                  <td class="action-cell">
                    {#key p.id}
                      {#await Promise.resolve(parseMeta(p)) then meta}
                        {#if groupIsTravisProgged(g)}
                          <!-- When the whole group is Travis-progged, show a green TravisProgged tag in the status column -->
                          <span class="status-badge {getBadgeClass(p.status, meta)} status-table">{getDisplayStatus(p.status, meta)}</span>
                        {:else}
                          {#if p.status === 'pending'}
                            <button class="btn btn-secondary btn-sm" on:click={async () => { await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', p.id); await updateRouterMeta(p, { step: 'cam_ing' }); await loadParts(); }}>Start</button>
                          {:else if p.status === 'in-progress' && (!meta.router_meta || meta.router_meta.step === 'cam_ing')}
                            <button class="btn btn-secondary btn-sm" on:click={async () => { await supabase.from('parts').update({ status:'cammed', updated_at: new Date().toISOString() }).eq('id', p.id); await updateRouterMeta(p, { step: 'cam_review' }); await loadParts(); }}>{BUTTONS.CAM_REVIEWED}</button>
                          {:else if p.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'cam_review'}
                            <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(p, { travis_progged: true, step: 'queued' })}>{BUTTONS.TRAVIS}</button>
                          {:else if p.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'queued'}
                            <!-- Per-row Cut button removed: only group header Cut is allowed. Show Travis tag in status column -->
                            <span class="status-badge {getBadgeClass(p.status, meta)} status-table">{getDisplayStatus(p.status, meta)}</span>
                          {:else if p.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'cut'}
                            <div class="kitting-inline">
                              <select class="form-select kitting-input" bind:value={selectedBinMap[p.id]}>
                                <option value="">Select bin…</option>
                                {#each bins as b}
                                  <option value={b.bin_id}>{b.bin_id}</option>
                                {/each}
                              </select>
                              <button class="btn btn-secondary btn-sm btn-nowrap"
                                on:click={async () => { const v = (selectedBinMap[p.id] || '').trim(); if (v) { await supabase.from('parts').update({ kitting_bin: v, updated_at: new Date().toISOString(), status: 'complete' }).eq('id', p.id); await loadParts(); } }}
                                disabled={!selectedBinMap[p.id]}>
                                <Package size={14} />
                                Kit
                              </button>
                            </div>
                          {:else}
                            {#if getNextRouterStep(p) && getNextRouterStep(p) !== 'cut'}
                              <button class="btn btn-secondary btn-sm" on:click={() => advanceRouterStep(p, getNextRouterStep(p))}>{ROUTER_FLOW.labels?.[getNextRouterStep(p)] || getNextRouterStep(p)}</button>
                            {:else if getNextRouterStep(p) === 'cut'}
                              <!-- Next step is cut (group-level) — leave per-row actions empty -->
                            {:else}
                              <span class="status-badge status-table">{getDisplayStatus(p.status, meta)}</span>
                            {/if}
                          {/if}
                        {/if}
                      {/await}
                    {/key}
                  </td>
                  <td class="remove-col"><button class="remove-inline" on:click={()=>removeFromGroup(p)} title="Remove">×</button></td>
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
    <div class="parts-table-wrapper">
      <div class="bom-table-container">
      <table class="bom-table router-table">
  <thead><tr><th>Name</th><th>Stock</th><th>Project</th><th>Qty</th><th>Source</th><th>Status</th></tr></thead>
        <tbody>
          {#each ungroupedParts as part, i (part.id)}
            <tr class="row {i % 2 === 0 ? 'even':'odd'}"
              draggable="true"
              on:dragstart={(e)=>handleDragStart(e,part)}
              on:dragover={(e)=>handleDragOver(e,part)}
              on:dragleave={handleDragLeave}
              on:drop={(e)=>handleDrop(e,part)}
            >
              <td class="part-name">{part.name}</td>
              <td>{getStock(part) || '-'}</td>
              <td class="mono">{part.project_id}</td>
              <td>{part.quantity || 1}</td>
              <td>
                {#if part.source_type === 'onshape_api' || part.is_onshape_part}
                  <div class="source-cell">
                    <span class="source-tag">STEP</span>
                    <button class="btn btn-secondary btn-icon" aria-label="Download STEP" title="Download STEP" on:click={()=>downloadStepFromOnshape(part)}><Download size={14} /></button>
                    <span class="source-tag">DXF</span>
                    <button class="btn btn-secondary btn-icon" aria-label="Download DXF" title="Download DXF" on:click={()=>downloadDXFFromOnshape(part)}><Download size={14} /></button>
                  </div>
                {:else}
                    {#await Promise.resolve(parseMeta(part)) then meta}
                    <div class="source-cell">
                      {#if meta.step_file}
                        <span class="source-tag">STEP</span>
                        <button class="btn btn-secondary btn-icon" aria-label="Download STEP" title="Download STEP" on:click={()=>downloadFromStorage(meta.step_file)}><Download size={14} /></button>
                      {/if}
                      {#if meta.dxf_file}
                        <span class="source-tag">DXF</span>
                        <button class="btn btn-secondary btn-icon" aria-label="Download DXF" title="Download DXF" on:click={()=>downloadFromStorage(meta.dxf_file)}><Download size={14} /></button>
                      {/if}
                      {#if !meta.step_file && !meta.dxf_file}
                        {#if part.file_name}
                          <span class="file-label">{part.file_name}</span>
                          <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click={()=>downloadFromStorage(part.file_name)}><Download size={14} /></button>
                        {:else}-{/if}
                      {/if}
                    </div>
                  {/await}
                {/if}
              </td>
              <td class="action-cell">
                {#key part.id}
                  {#await Promise.resolve(parseMeta(part)) then meta}
                      {#if part.status === 'pending'}
                      <button class="btn btn-secondary btn-sm" on:click={async () => { await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', part.id); await updateRouterMeta(part, { step: 'cam_ing' }); await loadParts(); }}>Start</button>
                    {:else if part.status === 'in-progress' && (!meta.router_meta || meta.router_meta.step === 'cam_ing')}
                      <button class="btn btn-secondary btn-sm" on:click={async () => { await supabase.from('parts').update({ status:'cammed', updated_at: new Date().toISOString() }).eq('id', part.id); await updateRouterMeta(part, { step: 'cam_review' }); await loadParts(); }}>{BUTTONS.CAM_REVIEWED}</button>
                          {:else if part.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'cam_review'}
                            <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(part, { travis_progged: true, step: 'queued' })}>{BUTTONS.TRAVIS}</button>
                          {:else if part.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'queued'}
                          <!-- Next is cut (group-level) - leave actions empty -->
                          {:else if part.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'cut'}
                      <div class="kitting-inline">
                        <input type="text" placeholder="Bin ID" class="form-input kitting-input"
                          on:keydown={async (e) => { if (e.key === 'Enter' && e.target.value.trim()) {
                            await supabase.from('parts').update({ kitting_bin: e.target.value.trim(), updated_at: new Date().toISOString(), status: 'complete' }).eq('id', part.id);
                            await loadParts();
                          }}} />
                        <button class="btn btn-secondary btn-sm btn-nowrap"
                          on:click={async (e) => {
                            const input = e.target.previousElementSibling;
                            if (input && input.value.trim()) {
                              await supabase.from('parts').update({ kitting_bin: input.value.trim(), updated_at: new Date().toISOString(), status: 'complete' }).eq('id', part.id);
                              await loadParts();
                            }
                          }}>
                          <Package size={14} />
                          Kit
                        </button>
                      </div>
                    {:else}
                      {#if getNextRouterStep(part) && getNextRouterStep(part) !== 'cut'}
                        <button class="btn btn-secondary btn-sm" on:click={() => advanceRouterStep(part, getNextRouterStep(part))}>{ROUTER_FLOW.labels?.[getNextRouterStep(part)] || getNextRouterStep(part)}</button>
                      {:else if getNextRouterStep(part) === 'cut'}
                        <!-- Next is cut (group-level) - leave actions empty -->
                      {:else}
                        <span class="status-badge {getBadgeClass(part.status, meta)} status-table">{getDisplayStatus(part.status, meta)}</span>
                      {/if}
                    {/if}
                  {/await}
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
  .group-list { display:flex; flex-direction:column; gap:1.25rem; }
  .subheading { margin:0; font-size:1rem; font-weight:600; }
  .group-table-wrapper { padding:0.6rem; border-radius:8px; background:var(--surface, var(--color-white)); border:1px solid rgba(0,0,0,0.03); }
  .group-table-header { font-size:1.05rem; font-weight:600; margin:0 0 0.5rem 0; display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
  .group-name-btn { background:none; border:none; font:inherit; cursor:pointer; padding:0.15rem 0.35rem; border-radius:6px; }
  .group-name-btn:hover { background: var(--neutral-100); }
  .group-name-input { border:1px solid var(--border); padding:0.25rem 0.4rem; border-radius:6px; }
  :global(.router-table tr.drag-over), :global(.group-table tr.drag-over) { outline:2px dashed var(--accent); }
  .parts-table-wrapper { position:relative; }
  .hint { font-size:0.8rem; color:var(--neutral-500); margin-top:0.5rem; }
  .bom-table th:first-child, .bom-table td:first-child { min-width:220px; max-width:520px; }
  .bom-table th:nth-last-child(1), .bom-table td:nth-last-child(1) { width:56px; text-align:right; }
  .part-name { font-weight:500; color: var(--text); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .source-cell { display:inline-flex; align-items:center; gap:0.5rem; }
  .source-tag { display: inline-flex; align-items: center; justify-content: center; background: transparent; color: var(--secondary); border: 1px solid var(--border); text-transform: uppercase; letter-spacing: 0.02em; margin-right: 0.25rem; height: var(--control-height); min-height: var(--control-height); padding: 0 0.75rem; border-radius: 4px; font-size: 0.8125rem; line-height: 1; box-sizing: border-box; gap: 0.375rem; }
  .file-label { max-width:160px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:0.78rem; }
  .kitting-inline { display:flex; gap:0.5rem; align-items:center; }
  .kitting-input { padding:0.35rem; border:1px solid var(--border); border-radius:6px; min-width:110px; }
  .status-table { font-weight:700; }
  .bom-table th.action-col, .bom-table td.action-cell { width:110px; max-width:120px; white-space:nowrap; }
  .bom-table td.remove-col { width:36px; max-width:40px; text-align:center; }
</style>
