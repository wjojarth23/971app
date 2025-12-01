<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { page } from '$app/stores';

  let loading = true;
  let items = [];
  let errorMsg = '';

  async function loadKitting() {
    try {
      const { data, error } = await supabase
        .from('kitting')
        .select('id, name, project_id, requester, quantity, status, created_at')
        .eq('status', 'pending')
        .order('created_at', { ascending: true });

      if (error) throw error;
      items = data || [];
    } catch (e) {
      errorMsg = e?.message || String(e);
      items = [];
    }
  }

  async function markKitted(id) {
    try {
      const { error } = await supabase
        .from('kitting')
        .update({ status: 'kitted', updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
      await loadKitting();
    } catch (e) {
      alert('Failed to mark as kitted: ' + (e?.message || e));
    }
  }

  onMount(async () => {
    await loadKitting();
    loading = false;
  });
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

{#if loading}
  <div class="card"><p>Loading...</p></div>
{:else}
  {#if errorMsg}
    <div class="card"><p class="text-error">Error: {errorMsg}</p></div>
  {/if}
  <div class="table-container">
    <table class="table">
      <thead>
        <tr>
          <th>Part</th>
          <th>Project</th>
          <th>Requester</th>
          <th>Qty</th>
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        {#if (items || []).length === 0}
          <tr><td colspan="5" class="text-muted">No items to kit.</td></tr>
        {:else}
          {#each items as it}
            <tr>
              <td class="strong">{it.name}</td>
              <td class="mono">{it.project_id}</td>
              <td>{it.requester}</td>
              <td class="mono">x{it.quantity || 1}</td>
              <td>
                <button class="btn btn-primary btn-sm" on:click={() => markKitted(it.id)}>Kit</button>
              </td>
            </tr>
          {/each}
        {/if}
      </tbody>
    </table>
  </div>
{/if}

<style>
  /* Uses global .subtabs, .mono, .text-error, .strong, .page-header, .table styles */
</style>
