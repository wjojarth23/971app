<script>
  import { onMount } from 'svelte';
  import { ArrowLeft, LayoutDashboard, RefreshCw, Server } from 'lucide-svelte';
  import { getAuthHeader } from '$lib/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';

  let eventKey = '';
  let data = null;
  let loading = true;
  let error = '';

  const RUNNER_STALE_WARN_MS = 5 * 60 * 1000; // last_seen_at older than this but not "just started" reads as a real gap, not a rounding blip

  async function load() {
    if (!eventKey) return;
    loading = true;
    error = '';
    try {
      const headers = await getAuthHeader();
      const response = await fetch(`/api/vision?dashboard=${encodeURIComponent(eventKey)}`, { headers });
      const payload = await response.json().catch(() => null);
      if (!response.ok || !payload?.success) throw new Error(payload?.error || `Dashboard load failed (${response.status})`);
      data = payload.data;
    } catch (exception) {
      error = exception.message;
    } finally {
      loading = false;
    }
  }

  function formatAge(iso) {
    if (!iso) return 'never';
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return `${Math.round(ms / 1000)}s ago`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m ago`;
    return `${Math.round(ms / 3_600_000)}h ago`;
  }

  onMount(async () => {
    const params = new URLSearchParams(window.location.search);
    eventKey = params.get('event_key') || (await fetchActiveScoutingEventKey()) || '';
    if (eventKey) await load();
    else loading = false;
  });
</script>

<svelte:head><title>Vision Dashboard | Scouting</title></svelte:head>

<div class="page-header">
  <div class="header-content">
    <a class="back-link" href="/scouting/vision"><ArrowLeft size={14} /> Vision Scouting</a>
    <h1><LayoutDashboard size={22} /> Vision Event Dashboard</h1>
    <p>Rollup across every match in an event - processing throughput, discrepancy rate, and runner fleet health, instead of clicking through matches one at a time.</p>
  </div>
  <div class="actions">
    <input class="form-input" placeholder="Event key (e.g. 2026casf)" bind:value={eventKey} on:keydown={(e) => e.key === 'Enter' && load()} />
    <button class="btn btn-sm btn-primary" on:click={load} disabled={loading || !eventKey}><RefreshCw size={14} /> Load</button>
  </div>
</div>

{#if error}<div class="error-container"><p>{error}</p></div>{/if}

{#if loading}
  <p class="text-muted">Loading...</p>
{:else if !eventKey}
  <div class="empty-state"><LayoutDashboard size={40} /><h3>No event selected</h3><p>Enter an event key above.</p></div>
{:else if data}
  <div class="stat-grid">
    <div class="surface-card stat-card">
      <span class="stat-label">Matches</span>
      <span class="stat-value">{data.matches_complete}<span class="stat-of">/ {data.matches_total}</span></span>
      <span class="stat-sub">complete</span>
    </div>
    <div class="surface-card stat-card">
      <span class="stat-label">Runs</span>
      <span class="stat-value">{data.runs.complete}<span class="stat-of">/ {data.runs.total}</span></span>
      <span class="stat-sub">{data.runs.failed} failed · {data.runs.in_progress} in progress · {data.runs.released} released</span>
    </div>
    <div class="surface-card stat-card">
      <span class="stat-label">Discrepancies</span>
      <span class="stat-value" class:warn={data.discrepancies.open_critical > 0}>{data.discrepancies.open}</span>
      <span class="stat-sub">open ({data.discrepancies.open_critical} critical) · {data.discrepancies.resolved} resolved</span>
    </div>
    <div class="surface-card stat-card">
      <span class="stat-label">Queue depth</span>
      <span class="stat-value">{data.queue_depth}</span>
      <span class="stat-sub">runs waiting on a runner</span>
    </div>
  </div>

  <section class="surface-card section">
    <h2><Server size={18} /> Runner fleet</h2>
    {#if !data.runners.length}
      <p class="text-muted">No runner has ever reported in for this deployment.</p>
    {:else}
      <div class="table-wrap">
        <table>
          <thead><tr><th>Runner</th><th>Status</th><th>Last seen</th><th>Current run</th><th>Model</th><th>Last error</th></tr></thead>
          <tbody>
            {#each data.runners as runner}
              <tr>
                <td class="mono">{runner.runner_id}</td>
                <td>
                  <span class={`fleet-status ${runner.online ? 'online' : 'offline'}`}>{runner.online ? 'Online' : 'Offline'}</span>
                </td>
                <td class:stale={Date.now() - new Date(runner.last_seen_at).getTime() > RUNNER_STALE_WARN_MS}>{formatAge(runner.last_seen_at)}</td>
                <td>{runner.current_run_id ? runner.current_run_id.slice(0, 8) : '—'}</td>
                <td class="mono">{runner.model_path || '—'}</td>
                <td class="error-cell">{runner.last_error || '—'}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
{/if}

<style>
  .back-link { display:flex; align-items:center; gap:var(--gap-2); color:var(--text-muted); text-decoration:none; font-size:.85rem; margin:var(--space-2) 0; }
  h1 { display:flex; gap:var(--gap-2); align-items:center; }
  h2 { display:flex; gap:var(--gap-2); align-items:center; font-size:1rem; margin:0 0 var(--space-3); }
  .section { padding:var(--space-4); margin-top:var(--space-4); }

  .stat-grid { display:grid; grid-template-columns:repeat(auto-fit, minmax(11rem, 1fr)); gap:var(--gap-3); margin-top:var(--space-4); }
  .stat-card { padding:var(--space-4); display:flex; flex-direction:column; gap:4px; }
  .stat-label { color:var(--text-muted); font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; }
  .stat-value { font-size:1.6rem; font-weight:700; }
  .stat-value.warn { color:var(--red,#c33); }
  .stat-of { font-size:1rem; font-weight:400; color:var(--text-muted); margin-left:2px; }
  .stat-sub { font-size:.78rem; color:var(--text-muted); }

  .table-wrap { overflow:auto; }
  table { width:100%; border-collapse:collapse; }
  th, td { padding:var(--space-2); border-bottom:1px solid var(--border); text-align:left; white-space:nowrap; }
  .error-cell { white-space:normal; color:var(--red,#c33); max-width:20rem; }
  .stale { color:var(--red,#c33); }

  .fleet-status { padding:2px var(--space-2); border-radius:var(--radius-sm); font-size:.78rem; }
  .fleet-status.online { background:color-mix(in srgb, #16a34a 18%, transparent); color:#16a34a; }
  .fleet-status.offline { background:color-mix(in srgb, #c33 18%, transparent); color:#c33; }

  @media (max-width:640px) {
    .actions { flex-direction:column; align-items:stretch; }
  }
</style>
