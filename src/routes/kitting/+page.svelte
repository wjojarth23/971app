<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';

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

<svelte:head>
  <title>Kitting</title>
</svelte:head>

<div class="page-header">
  <h1>Kitting</h1>
</div>

{#if loading}
  <div class="card"><p>Loading...</p></div>
{:else}
  {#if errorMsg}
    <div class="card"><p class="text-error">Error: {errorMsg}</p></div>
  {/if}
  
  <!-- Mobile Card View -->
  <div class="mobile-kitting-cards">
    {#if (items || []).length === 0}
      <div class="card"><p class="text-muted">No items to kit.</p></div>
    {:else}
      {#each items as it}
        <div class="kitting-card">
          <div class="kitting-card-header">
            <strong class="kitting-card-name">{it.name}</strong>
            <span class="kitting-card-qty">x{it.quantity || 1}</span>
          </div>
          <div class="kitting-card-meta">
            <span class="kitting-card-project">{it.project_id}</span>
            <span class="kitting-card-requester">by {it.requester}</span>
          </div>
          <button class="btn btn-primary" on:click={() => markKitted(it.id)}>Mark as Kitted</button>
        </div>
      {/each}
    {/if}
  </div>
  
  <!-- Desktop Table View -->
  <div class="table-container desktop-kitting-table">
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
  /* Mobile Kitting Cards - Hidden on desktop */
  .mobile-kitting-cards {
    display: none;
  }
  
  .kitting-card {
    background: var(--surface-1);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
    margin-bottom: var(--space-3);
  }
  
  .kitting-card-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    margin-bottom: var(--space-2);
  }
  
  .kitting-card-name {
    font-size: 1rem;
    color: var(--secondary);
    flex: 1;
    word-break: break-word;
  }
  
  .kitting-card-qty {
    font-family: var(--font-mono);
    font-weight: 600;
    color: var(--text);
    background: var(--background);
    padding: var(--space-1) var(--space-2);
    border-radius: var(--radius-sm);
  }
  
  .kitting-card-meta {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-3);
    margin-bottom: var(--space-4);
    font-size: var(--font-xs);
    color: var(--text-muted);
  }
  
  .kitting-card-project {
    font-family: var(--font-mono);
  }
  
  .kitting-card .btn {
    width: 100%;
    justify-content: center;
  }

  @media (max-width: 768px) {
    /* Hide desktop table, show mobile cards */
    .desktop-kitting-table {
      display: none;
    }
    
    .mobile-kitting-cards {
      display: block;
    }
  }
</style>
