<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';
  import { Package, Group, GripVertical } from 'lucide-svelte';

  let parts = [];
  let loading = true;
  let dragPart = null;
  let groupMap = {}; // group_id => { id, parts: [] }
  let useDedicatedTables = true; // will flip false if queries fail

  // We store grouping metadata inside file_url JSON under router_group_id
  function parseMeta(part) {
    try { return JSON.parse(part.file_url || '{}') || {}; } catch { return {}; }
  }
  async function updateMeta(part, updates) {
    let root = {}; try { root = JSON.parse(part.file_url || '{}') || {}; } catch { root = {}; }
    root = { ...root, ...updates };
    await supabase.from('parts').update({ file_url: JSON.stringify(root), updated_at: new Date().toISOString() }).eq('id', part.id);
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
    if (!error) parts = data || [];
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
        if (!groupMap[meta.router_group_id]) groupMap[meta.router_group_id] = { id: meta.router_group_id, parts: [] };
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
  <div class="group-table-wrapper" role="group" aria-label="Router group" on:dragover={(e)=>{e.preventDefault();}} on:drop={(e)=>{ if(dragPart){ handleDrop(e, g.parts[0] || dragPart); } }}>
          <div class="group-table-header">{g.name || g.id}</div>
          <table class="table group-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Stock</th>
                <th>Project</th>
                <th>Qty</th>
                <th>Source</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {#each g.parts as p}
                <tr draggable="true" on:dragstart={(e)=>handleDragStart(e,p)} on:drop={(e)=>handleDrop(e,p)} on:dragover={(e)=>handleDragOver(e,p)} on:dragleave={handleDragLeave}>
                  <td>{p.name}</td>
                  <td>{getStock(p) || '-'}</td>
                  <td class="mono">{p.project_id}</td>
                  <td>{p.quantity || 1}</td>
                  <td>{p.source_type === 'onshape_api' ? (p.file_format === 'stl' ? 'STL' : (p.file_format || 'STEP')) : (p.file_name ? 'FILE' : '-')}</td>
                  <td>{p.status}</td>
                  <td><button class="remove-inline" on:click={()=>removeFromGroup(p)} title="Remove">×</button></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/each}
    {/if}

  <h2 class="subheading">Ungrouped</h2>
    <div class="parts-table-wrapper">
      <table class="table router-table">
  <thead><tr><th>Name</th><th>Stock</th><th>Project</th><th>Qty</th><th>Source</th><th>Status</th></tr></thead>
        <tbody>
          {#each ungroupedParts as part (part.id)}
            <tr
              draggable="true"
              on:dragstart={(e)=>handleDragStart(e,part)}
              on:dragover={(e)=>handleDragOver(e,part)}
              on:dragleave={handleDragLeave}
              on:drop={(e)=>handleDrop(e,part)}
            >
              <td>{part.name}</td>
              <td>{getStock(part) || '-'}</td>
              <td class="mono">{part.project_id}</td>
              <td>{part.quantity || 1}</td>
              <td>{part.source_type === 'onshape_api' ? (part.file_format === 'stl' ? 'STL' : (part.file_format || 'STEP')) : (part.file_name ? 'FILE' : '-')}</td>
              <td>{part.status}</td>
            </tr>
          {/each}
        </tbody>
      </table>
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
  .group-table-wrapper { border:1px solid var(--border); border-radius:6px; background:white; padding:0.5rem; }
  .group-table-header { font-size:0.85rem; font-weight:600; margin:0 0 0.5rem 0; }
  .group-table td, .group-table th { font-size:0.75rem; }
  .remove-inline { background:none; border:1px solid var(--border); border-radius:4px; padding:0 6px; cursor:pointer; }
  /* Grouped rows are not shown in the ungrouped table */
  :global(.router-table tr.drag-over) { outline:2px dashed var(--accent); }
  .parts-table-wrapper { position:relative; }
  .hint { font-size:0.7rem; color:#555; margin-top:0.5rem; }
</style>
