<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';
  import { Package, Group, GripVertical, Download } from 'lucide-svelte';

  function groupIsCut(g) {
    if (!g || !g.parts || g.parts.length === 0) return false;
    return g.parts.every(p => {
      const m = parseMeta(p);
      return Boolean(m?.router_meta && m.router_meta.step === 'inspection');
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
      return Boolean(m?.router_meta && m.router_meta.step === 'queued');
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

  // Group-level actions: set all parts in group to TProged or Cut (Inspection)
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
      // Move to inspection (after cut)
      for (const p of group.parts) {
        await updateRouterMeta(p, { step: 'inspection' });
      }
    }
    await loadParts();
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
  function getStock(part) { return part.stock_assignment || part.material || ''; }
  function makeGroupName(part) {
    const base = (getStock(part).split(' ')[0] || 'Group').replace(/[^A-Za-z0-9]/g,'');
    const rand = Math.floor(10 + Math.random()*90); // 2 digits
    return `${base}${rand}`;
  }

  // (Status chip display removed in favor of dropdown editing)

  async function updateStatus(part, value) {
    if (!part) return;
    if (value === 'Pending') {
      // set status pending and clear travis flag
      await supabase.from('parts').update({ status: 'pending', updated_at: new Date().toISOString() }).eq('id', part.id);
      const meta = parseMeta(part);
      if (meta.travis_progged || meta.router_group_name) {
        if (meta.travis_progged) delete meta.travis_progged;
        await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', part.id);
      }
    } else if (value === 'Cammed') {
      // status cammed & remove travis flag
      await supabase.from('parts').update({ status: 'cammed', updated_at: new Date().toISOString() }).eq('id', part.id);
      const meta = parseMeta(part);
      if (meta.travis_progged) {
        delete meta.travis_progged;
        await supabase.from('parts').update({ file_url: JSON.stringify(meta), updated_at: new Date().toISOString() }).eq('id', part.id);
      }
    } else if (value === 'Travis Progged') {
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
  }
  function handleDragOver(event, targetPart) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    event.currentTarget.classList.add('drag-over');
  }
  function handleDragLeave(event) {
    event.currentTarget.classList.remove('drag-over');
  }
  async function handleDrop(event, targetPart) {
    event.preventDefault();
    event.currentTarget.classList.remove('drag-over');
    if (!dragPart || dragPart.id === targetPart.id) return;

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
  <a href="/manufacture" class:active={$page.url.pathname === '/manufacture'}>All</a>
  <a href="/manufacture/router" class:active={$page.url.pathname === '/manufacture/router'}>Router</a>
</div>

{#if loading}
  <div class="card"><p>Loading...</p></div>
{:else}
  <div class="group-list">
    {#if Object.keys(groupMap).length > 0}
      <h2 class="subheading">Groups</h2>
      {#each Object.values(groupMap) as g}
        {#if !groupIsCut(g)}
  <div class="group-table-wrapper" role="group" aria-label="Router group" on:dragover={(e)=>{e.preventDefault();}} on:drop={(e)=>{ if(dragPart){ handleDrop(e, g.parts[0] || dragPart); } }}>
          <div class="group-table-header">
            {#if editingGroupId === g.id}
              <input class="group-name-input" bind:value={editingGroupName} on:keydown={(e)=>{ if(e.key==='Enter'){ saveGroupName(g.id); } else if (e.key==='Escape'){ editingGroupId=null; editingGroupName=''; } }} on:blur={()=>saveGroupName(g.id)} />
            {:else}
              <button class="group-name-btn" on:click={()=>{ editingGroupId=g.id; editingGroupName=g.name || g.id; }}>{g.name || g.id}</button>
              {#if groupIsReadyForTProged(g)}
                <button class="btn btn-primary btn-sm" on:click={() => applyGroupAction(g.id, 'tproged')}>TProged</button>
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
                <th>Action</th>
                <th></th>
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
                        <span class="source-tag">{p.file_format === 'stl' ? 'STL' : 'STEP'}</span>
                        <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click={()=>downloadFile(p)}><Download size={14} /></button>
                      </div>
                    {:else if p.file_name}
                      <div class="source-cell">
                        <span class="file-label">{p.file_name}</span>
                        <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click={()=>downloadFile(p)}><Download size={14} /></button>
                      </div>
                    {:else}-{/if}
                  </td>
                  <td>
                    {#key p.id}
                      {#await Promise.resolve(parseMeta(p)) then meta}
                        {#if p.status === 'pending'}
                          <button class="btn btn-secondary btn-sm" on:click={async () => { await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', p.id); await updateRouterMeta(p, { step: 'cam_ing' }); await loadParts(); }}>Start</button>
                        {:else if p.status === 'in-progress' && (!meta.router_meta || meta.router_meta.step === 'cam_ing')}
                          <button class="btn btn-secondary btn-sm" on:click={async () => { await supabase.from('parts').update({ status:'cammed', updated_at: new Date().toISOString() }).eq('id', p.id); await updateRouterMeta(p, { step: 'layout' }); await loadParts(); }}>CAMed</button>
                        {:else if p.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'layout'}
                          <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(p, { travis_progged: true, step: 'queued' })}>TProged</button>
                        {:else if p.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'queued'}
                          <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(p, { step: 'inspection' })}>Cut</button>
                        {:else if p.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'inspection'}
                          <div class="kitting-inline">
                            <input type="text" placeholder="Bin ID" class="form-input kitting-input"
                              on:keydown={async (e) => { if (e.key === 'Enter' && e.target.value.trim()) {
                                await supabase.from('parts').update({ kitting_bin: e.target.value.trim(), updated_at: new Date().toISOString(), status: 'complete' }).eq('id', p.id);
                                await loadParts();
                              }}} />
                            <button class="btn btn-secondary btn-sm btn-nowrap"
                              on:click={async (e) => {
                                const input = e.target.previousElementSibling;
                                if (input && input.value.trim()) {
                                  await supabase.from('parts').update({ kitting_bin: input.value.trim(), updated_at: new Date().toISOString(), status: 'complete' }).eq('id', p.id);
                                  await loadParts();
                                }
                              }}>
                              <Package size={14} />
                              Kit
                            </button>
                          </div>
                        {:else}
                          <span class="status-badge status-table">{(meta.router_meta && ROUTER_FLOW.labels[meta.router_meta.step]) || p.status}</span>
                        {/if}
                      {/await}
                    {/key}
                  </td>
                  <td><button class="remove-inline" on:click={()=>removeFromGroup(p)} title="Remove">×</button></td>
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
                    <span class="source-tag">{part.file_format === 'stl' ? 'STL' : 'STEP'}</span>
                    <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click={()=>downloadFile(part)}><Download size={14} /></button>
                  </div>
                {:else if part.file_name}
                  <div class="source-cell">
                    <span class="file-label">{part.file_name}</span>
                    <button class="btn btn-secondary btn-icon" aria-label="Download" title="Download" on:click={()=>downloadFile(part)}><Download size={14} /></button>
                  </div>
                {:else}-{/if}
              </td>
              <td>
                {#key part.id}
                  {#await Promise.resolve(parseMeta(part)) then meta}
                    {#if part.status === 'pending'}
                      <button class="btn btn-secondary btn-sm" on:click={async () => { await supabase.from('parts').update({ status: 'in-progress', updated_at: new Date().toISOString() }).eq('id', part.id); await updateRouterMeta(part, { step: 'cam_ing' }); await loadParts(); }}>Start</button>
                    {:else if part.status === 'in-progress' && (!meta.router_meta || meta.router_meta.step === 'cam_ing')}
                      <button class="btn btn-secondary btn-sm" on:click={async () => { await supabase.from('parts').update({ status:'cammed', updated_at: new Date().toISOString() }).eq('id', part.id); await updateRouterMeta(part, { step: 'layout' }); await loadParts(); }}>CAMed</button>
                    {:else if part.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'layout'}
                      <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(part, { travis_progged: true, step: 'queued' })}>TProged</button>
                    {:else if part.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'queued'}
                      <button class="btn btn-secondary btn-sm" on:click={() => updateRouterMeta(part, { step: 'inspection' })}>Cut</button>
                    {:else if part.status === 'cammed' && meta.router_meta && meta.router_meta.step === 'inspection'}
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
                      <span class="status-badge status-table">{(meta.router_meta && ROUTER_FLOW.labels[meta.router_meta.step]) || part.status}</span>
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
  .subtabs { display:flex; gap:0.5rem; margin:0 0 1rem 0; }
  .subtabs a { text-decoration:none; padding:0.5rem 0.85rem; background:var(--background); border:1px solid var(--border); border-radius:4px; font-size:0.85rem; color:var(--text); }
  .subtabs a.active { background: var(--accent); color: var(--secondary); }
  .group-list { display:flex; flex-direction:column; gap:1.5rem; }
  .subheading { margin:0; font-size:1rem; font-weight:600; }
  .group-table-header { font-size:1.2rem; font-weight:600; margin:-0.25em 0 0.5rem 0; display:flex; align-items:center; }
  .group-name-btn { background:none; border:none; font:inherit; padding:0.25rem 0.5rem; border-radius:4px; cursor:pointer; }
  .group-name-btn:hover { background: #f3f4f6; }
  .group-name-input { padding:0.35rem 0.5rem; border:1px solid var(--border); border-radius:4px; font-size:0.8rem; width:160px; }
  .remove-inline { background:none; border:1px solid var(--border); border-radius:4px; padding:0 6px; cursor:pointer; font-size:0.7rem; }
  :global(.router-table tr.drag-over), :global(.group-table tr.drag-over) { outline:2px dashed var(--accent); }
  .parts-table-wrapper { position:relative; }
  .hint { font-size:0.7rem; color:#555; margin-top:0.5rem; }
  /* Mirror CAD build table styles */
  .bom-table-container { overflow-x:auto; border:1px solid var(--border); border-radius:8px; }
  .bom-table { width:100%; border-collapse:collapse; font-size:0.875rem; }
  .bom-table th, .bom-table td { padding:0.75rem; text-align:left; border-bottom:1px solid var(--border); }
  .bom-table th { background: var(--background); font-weight:600; color: var(--text); }
  .bom-table tbody tr.row.even { background:#fff; }
  .bom-table tbody tr.row.odd { background:#fcfcfd; }
  .bom-table tbody tr:hover { background:#f6f7f9; }
  .bom-table tbody tr:last-child td { border-bottom:none; }
  .part-name { font-weight:600; color: var(--text); }
  .status-select { padding:0.375rem 0.5rem; border:1px solid var(--border); border-radius:4px; font-size:0.75rem; background:white; }
  .source-cell { display:flex; align-items:center; gap:0.35rem; }
  .source-tag { display:inline-block; padding:0.25rem 0.5rem; background:#f3f4f6; border:1px solid var(--border); border-radius:4px; font-size:0.65rem; font-weight:500; }
  .file-label { max-width:110px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-size:0.65rem; }
  .btn-icon { display:inline-flex; align-items:center; justify-content:center; padding:0.25rem; height:28px; width:28px; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono','Courier New', monospace; font-size:0.7rem; }
</style>
