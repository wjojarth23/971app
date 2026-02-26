<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';
  import { Download, Upload } from 'lucide-svelte';

  let parts = [];
  let filteredParts = [];
  let loading = true;
  let searchTerm = '';
  let filterWorkflow = '';

  const workflows = [
    { value: 'laser-cut', label: 'Laser Cut' },
    { value: 'router', label: 'Router' },
    { value: 'lathe', label: 'Lathe' },
    { value: 'mill', label: 'Mill' },
    { value: '3d-print', label: '3D Print' }
  ];

  onMount(loadParts);

  async function loadParts() {
    const { data, error } = await supabase
      .from('parts')
      .select('*')
      .eq('status', 'complete')
      .order('updated_at', { ascending: false });
    parts = !error ? (data || []) : [];
    loading = false;
  }

  function formatDate(dateString) { return new Date(dateString).toLocaleDateString(); }

  $: filteredParts = parts.filter(p => {
    const matchesSearch = !searchTerm ||
      (p.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.requester || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (p.project_id || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchesWorkflow = !filterWorkflow || p.workflow === filterWorkflow;
    return matchesSearch && matchesWorkflow;
  });
</script>

<svelte:head><title>Completed Parts</title></svelte:head>

<div class="page-header">
  <h1>Completed Parts</h1>
  <div class="page-actions">
    <a href="/manufacture/create" class="btn btn-primary" style="text-decoration:none;display:inline-flex;align-items:center;gap:8px;">
      <Upload size={16} />
      Create New Part
    </a>
  </div>
  
</div>
<div class="subtabs">
  <a href="/manufacture" class:active={$page.url.pathname === '/manufacture'}>ToDo</a>
  <a href="/manufacture/completed" class:active={$page.url.pathname === '/manufacture/completed'}>Completed</a>
  <a href="/manufacture/router" class:active={$page.url.pathname === '/manufacture/router'}>Router</a>
  <a href="/manufacture/post-processing" class:active={$page.url.pathname === '/manufacture/post-processing'}>Post Processing</a>
  <a href="/manufacture/bins" class:active={$page.url.pathname === '/manufacture/bins'}>Bins</a>
  
</div>

<div class="card">
  <div class="filters" style="--filters-columns: 2fr 1fr;">
    <div class="form-group">
      <label class="form-label" for="completed-search">Search</label>
      <input id="completed-search" class="form-input" placeholder="Search by name, requester, or project ID..." bind:value={searchTerm} />
    </div>
    <div class="form-group">
      <label class="form-label" for="completed-workflow">Workflow</label>
      <select id="completed-workflow" class="form-select" bind:value={filterWorkflow}>
        <option value="">All Workflows</option>
        {#each workflows as w}
          <option value={w.value}>{w.label}</option>
        {/each}
      </select>
    </div>
  </div>
</div>

{#if loading}
  <div class="card"><p>Loading...</p></div>
{:else if filteredParts.length === 0}
  <div class="card"><p>No completed parts found.</p></div>
{:else}
  <div class="table-container">
    <table class="table">
      <thead>
        <tr>
          <th>Name</th>
          <th>Workflow</th>
          <th class="mono">Project ID</th>
          <th>Qty</th>
          <th>Bin / Delivery</th>
          <th>Completed</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredParts as part (part.id)}
          <tr>
            <td><strong>{part.name}</strong></td>
            <td class="text-muted">{part.workflow}</td>
            <td class="mono">{part.project_id}</td>
            <td>{part.quantity || 1}</td>
            <td>{part.kitting_bin ? part.kitting_bin : (part.delivered ? 'Delivered' : '-')}</td>
            <td>{formatDate(part.updated_at || part.created_at)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>

  <div class="mobile-completed-list">
    {#each filteredParts as part (part.id)}
      <div class="card mobile-completed-card">
        <div><strong>{part.name}</strong></div>
        <div class="text-muted">{part.workflow}</div>
        <div class="mono">{part.project_id}</div>
        <div>Qty: {part.quantity || 1}</div>
        <div>{part.kitting_bin ? part.kitting_bin : (part.delivered ? 'Delivered' : '-')}</div>
        <div>{formatDate(part.updated_at || part.created_at)}</div>
      </div>
    {/each}
  </div>
{/if}

<style>
  .mobile-completed-list {
    display: none;
  }

  .mobile-completed-card {
    display: grid;
    gap: var(--gap-1);
  }

  @media (max-width: 768px) {
    .table-container {
      display: none;
    }

    .mobile-completed-list {
      display: grid;
      gap: var(--gap-3);
    }
  }
</style>
