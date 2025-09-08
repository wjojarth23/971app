<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';

  let bins = [];
  let partsByBin = {};
  let loading = true;
  let newBinName = '';
  let newBinId = '';
  let creating = false;

  async function loadBins() {
    const { data, error } = await supabase.from('kitting_bins').select('bin_id, name').order('name', { ascending: true });
    if (!error) bins = data || []; else bins = [];
  }

  async function loadParts() {
    // Load all parts that have a kitting_bin set
    const { data, error } = await supabase
      .from('parts')
      .select('id, name, project_id, quantity, workflow, status, kitting_bin')
      .not('kitting_bin', 'is', null)
      .order('created_at', { ascending: false });
    if (error) { partsByBin = {}; return; }
    const map = {};
    for (const p of data || []) {
      const bin = p.kitting_bin || '';
      if (!map[bin]) map[bin] = [];
      map[bin].push(p);
    }
    partsByBin = map;
  }

  async function createBin() {
    const name = newBinName.trim();
    const bin_id = newBinId.trim();
    if (!name || !bin_id) return;
    creating = true;
    try {
      const { error } = await supabase.from('kitting_bins').insert({ bin_id, name });
      if (error) throw error;
      newBinName = '';
      newBinId = '';
      await loadBins();
    } catch (e) {
      alert('Failed to create bin: ' + (e?.message || e));
    } finally { creating = false; }
  }

  onMount(async () => {
    await loadBins();
    await loadParts();
    loading = false;
  });

  function getBinLabel(id) {
    const b = bins.find(x => x.bin_id === id);
    return b ? `${b.name} (${b.bin_id})` : id;
  }
</script>

<svelte:head><title>Kitting</title></svelte:head>

<div class="page-header">
  <h1>Kitting</h1>
  <div class="page-actions">
    <a href="/manufacture" class="btn btn-secondary">Back</a>
  </div>
  
</div>
<div class="subtabs">
  <a href="/manufacture" class:active={$page.url.pathname === '/manufacture'}>ToDo</a>
  <a href="/manufacture/completed" class:active={$page.url.pathname === '/manufacture/completed'}>Completed</a>
  <a href="/manufacture/router" class:active={$page.url.pathname === '/manufacture/router'}>Router</a>
  <a href="/manufacture/kitting" class:active={$page.url.pathname === '/manufacture/kitting'}>Kitting</a>
</div>

<div class="card">
  <h2 style="margin: 0 0 0.75rem 0; font-size: 1rem;">Create Bin</h2>
  <div class="create-bin">
    <input class="form-input" placeholder="Bin name" bind:value={newBinName} />
    <input class="form-input" placeholder="Bin ID" bind:value={newBinId} />
    <button class="btn btn-primary" on:click={createBin} disabled={creating || !newBinName.trim() || !newBinId.trim()}>Add Bin</button>
  </div>
</div>

{#if loading}
  <div class="card"><p>Loading...</p></div>
{:else}
  <div class="table-container">
    <table class="table">
      <thead><tr><th>Bin</th><th>Parts</th></tr></thead>
      <tbody>
        {#if bins.length === 0}
          <tr><td colspan="2" class="text-muted">No bins yet. Create one above.</td></tr>
        {/if}
        {#each bins as b}
          <tr>
            <td class="mono">{b.name} <span class="text-muted">({b.bin_id})</span></td>
            <td>
              {#if (partsByBin[b.bin_id] || []).length === 0}
                <span class="text-muted">No parts</span>
              {:else}
                <ul class="parts-list">
                  {#each partsByBin[b.bin_id] as p}
                    <li>
                      <strong>{p.name}</strong>
                      <span class="mono">{p.project_id}</span>
                      <span class="tag">x{p.quantity || 1}</span>
                      <span class="tag">{p.workflow}</span>
                      <span class="tag">{p.status}</span>
                    </li>
                  {/each}
                </ul>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .create-bin { display: flex; gap: 0.5rem; }
  .create-bin .form-input { width: 200px; }
  .parts-list { list-style: none; padding: 0; margin: 0; display: flex; flex-wrap: wrap; gap: 0.25rem 0.5rem; }
  .parts-list li { display: inline-flex; align-items: center; gap: 0.5rem; }
  .tag { border: 1px solid var(--border); border-radius: 4px; padding: 2px 6px; font-size: 0.75rem; }
  .mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 0.85rem; }
  .text-muted { color: #6b7280; }

  /* Subtabs styling to match other manufacture pages */
  .subtabs { display: flex; gap: 0.5rem; margin: 0 0 1rem 0; }
  .subtabs a { text-decoration: none; padding: 0.5rem 0.85rem; background: var(--background); border: 1px solid var(--border); border-radius: 4px; font-size: 0.85rem; color: var(--text); }
  .subtabs a.active { background: var(--accent); color: var(--secondary); }
</style>
