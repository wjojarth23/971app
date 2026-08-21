<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID } from '$lib/stores/user.js';
  import { canManageCamProfiles } from '$lib/permissions.js';
  import { Layers, Package, Box, ListChecks } from 'lucide-svelte';
  import PartsTab from './PartsTab.svelte';
  import PlatesTab from './PlatesTab.svelte';
  import BoxTubesTab from './BoxTubesTab.svelte';
  import JobQueueTab from './JobQueueTab.svelte';

  let user = null;
  let activeTab = 'plates';

  $: canManage = canManageCamProfiles(user);

  function setActiveTab(tab) {
    activeTab = tab;
  }

  onMount(() => {
    const unsub = userStore.subscribe((v) => { user = v; });
    (async () => {
      await loadUserFromUUID(supabase);
    })();
    return unsub;
  });
</script>

<svelte:head><title>Fusion CAM | Spartans Hub</title></svelte:head>

<div class="page-header">
  <h1><Layers size={28} /> Fusion CAM</h1>
</div>
<p class="page-subtitle">
  Real 3-axis milling via Fusion 360's own CAM engine - a separate pipeline from the code-based
  <a href="/autocam">AutoCAM</a> turning/routing generator, for parts that need genuine contoured toolpaths a
  flat 2.5D profile can't represent. Nest parts onto plates or queue box-tube jobs here; a Fusion 360 Runner
  (see <code>valor6800-autocam-runner-setup.md</code>) claims queued jobs and reports G-code back.
</p>

<nav class="tab-nav" role="tablist" aria-label="Fusion CAM sections">
  <button type="button" class:active={activeTab === 'plates'} on:click={() => setActiveTab('plates')}>
    <Layers size={16} /> Plates
  </button>
  <button type="button" class:active={activeTab === 'parts'} on:click={() => setActiveTab('parts')}>
    <Package size={16} /> Parts
  </button>
  <button type="button" class:active={activeTab === 'box-tubes'} on:click={() => setActiveTab('box-tubes')}>
    <Box size={16} /> Box Tubes
  </button>
  <button type="button" class:active={activeTab === 'queue'} on:click={() => setActiveTab('queue')}>
    <ListChecks size={16} /> Job Queue
  </button>
</nav>

{#if activeTab === 'plates'}
  <PlatesTab {user} {canManage} />
{:else if activeTab === 'parts'}
  <PartsTab {user} {canManage} />
{:else if activeTab === 'box-tubes'}
  <BoxTubesTab {user} {canManage} />
{:else if activeTab === 'queue'}
  <JobQueueTab />
{/if}

<style>
  .page-subtitle a {
    color: var(--primary, #4f7cff);
  }
  .tab-nav {
    display: flex;
    gap: 0.5rem;
    border-bottom: 1px solid var(--border, #333);
    margin: 1rem 0 1.5rem;
    overflow-x: auto;
  }
  .tab-nav button {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 1rem;
    background: none;
    border: none;
    border-bottom: 2px solid transparent;
    color: var(--text-muted, #888);
    cursor: pointer;
    white-space: nowrap;
    font-size: 0.95rem;
  }
  .tab-nav button:hover {
    color: var(--text, #eee);
  }
  .tab-nav button.active {
    color: var(--primary, #4f7cff);
    border-bottom-color: var(--primary, #4f7cff);
  }
</style>
