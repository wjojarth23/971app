<script>
  import { onMount } from 'svelte';
  import { ArrowUpDown, RefreshCw, Search, Swords, Trophy } from 'lucide-svelte';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';
  import { getAuthHeader } from '$lib/supabase.js';
  import { buildPowerRankings } from '$lib/scoutingStats.js';

  let eventKey = '';
  let teams = [];
  let loading = true;
  let error = '';
  let warning = '';
  let search = '';
  let sortKey = 'scoutPower';
  let sortAsc = false;
  let compareLeftKey = '';
  let compareRightKey = '';

  const fmt = (value) => value == null ? '—' : Number(value).toFixed(1);
  const fmtPercent = (value) => value == null ? '—' : `${Math.round(value * 100)}%`;

  $: sortedTeams = [...teams].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return a.team_number - b.team_number;
    if (av == null) return 1;
    if (bv == null) return -1;
    return (av < bv ? -1 : av > bv ? 1 : 0) * (sortAsc ? 1 : -1);
  });
  $: filteredTeams = search.trim()
    ? sortedTeams.filter((team) => {
        const query = search.trim().toLowerCase();
        return String(team.team_number).includes(query) || (team.nickname || '').toLowerCase().includes(query);
      })
    : sortedTeams;
  $: compareLeft = teams.find((team) => team.key === compareLeftKey) || null;
  $: compareRight = teams.find((team) => team.key === compareRightKey) || null;

  function sortBy(key) {
    if (sortKey === key) sortAsc = !sortAsc;
    else {
      sortKey = key;
      sortAsc = key === 'team_number' || key === 'powerRank';
    }
  }

  async function loadRankings() {
    if (!eventKey) return;
    loading = true;
    error = '';
    warning = '';
    const authHeaders = await getAuthHeader();
    const [rosterResult, scoutResult, matchResult, pitResult, problemResult] = await Promise.all([
      fetch(`/api/tba/event-teams?event_key=${encodeURIComponent(eventKey)}`).then((response) => response.json()).catch(() => null),
      fetch(`/datascout?all_teams=1&event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((response) => response.json()).catch(() => null),
      fetch(`/api/match-scout-reports?event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((response) => response.json()).catch(() => null),
      fetch(`/pitscout?event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((response) => response.json()).catch(() => null),
      fetch(`/api/scouting-problems?event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((response) => response.json()).catch(() => null)
    ]);

    const scoutEvents = scoutResult?.success ? scoutResult.data : [];
    if (!scoutResult?.success) warning = scoutResult?.error || 'Local scouting data is unavailable.';
    else if (scoutResult.truncated) warning = 'Only the first 50,000 scouting observations were loaded.';

    let roster = rosterResult?.success ? rosterResult.data : [];
    if (!roster.length) {
      const keys = [...new Set(scoutEvents.map((row) => row.team_key).filter(Boolean))];
      roster = keys.map((key) => ({
        key,
        team_number: Number(String(key).replace(/^frc/i, '')),
        nickname: ''
      }));
    }
    if (!roster.length) {
      error = rosterResult?.error || 'No event teams are available.';
      teams = [];
      loading = false;
      return;
    }

    teams = buildPowerRankings(roster, scoutEvents, {
      matchReports: matchResult?.success ? matchResult.data : [],
      pitEntries: pitResult?.success ? pitResult.data : [],
      problemReports: problemResult?.success ? problemResult.data : []
    });
    const missing = [];
    if (!matchResult?.success) missing.push('match reports');
    if (!pitResult?.success) missing.push('pit profiles');
    if (!problemResult?.success) missing.push('problem reports');
    if (missing.length) warning = `${warning ? `${warning} ` : ''}Unavailable inputs: ${missing.join(', ')}.`;
    const ranked = [...teams].sort((a, b) => (b.scoutPower ?? -1) - (a.scoutPower ?? -1));
    if (!compareLeftKey && ranked[0]) compareLeftKey = ranked[0].key;
    if (!compareRightKey && ranked[1]) compareRightKey = ranked[1].key;
    loading = false;
  }

  onMount(async () => {
    eventKey = await fetchActiveScoutingEventKey();
    if (!eventKey) {
      loading = false;
      return;
    }
    await loadRankings();
  });
</script>

<svelte:head><title>Power Rankings</title></svelte:head>

<div class="page-header">
  <div class="header-content">
    <h1><Trophy size={22} /> Power Rankings</h1>
    <p>Combined 971 scout observations{eventKey ? ` for ${eventKey}` : ''}. No Statbotics or third-party rating is included.</p>
  </div>
  {#if eventKey}
    <button class="btn btn-sm" on:click={loadRankings} disabled={loading}><RefreshCw size={14} /> Refresh</button>
  {/if}
</div>

{#if loading}
  <p class="text-muted">Loading power rankings...</p>
{:else if !eventKey}
  <div class="empty-state"><Trophy size={40} /><h3>No active scouting event</h3><p>Set one in <a href="/scouting-admin">Scouting Admin</a>.</p></div>
{:else if error}
  <div class="error-container"><p>{error}</p></div>
{:else}
  {#if warning}<p class="text-muted">⚠ {warning}</p>{/if}
  <p class="formula">Combined score: 60% legacy match production, 30% structured Match Scouting evaluation (including pit climb capability), and 10% reliability. Open pit problems reduce reliability. Missing categories are omitted and remaining weights are rebalanced.</p>

  <section class="surface-card comparison-card">
    <h2><Swords size={18} /> Head to Head</h2>
    <div class="comparison-selectors">
      <label>Team A<select class="form-input" bind:value={compareLeftKey}>{#each [...teams].sort((a, b) => a.team_number - b.team_number) as team}<option value={team.key}>#{team.team_number} {team.nickname}</option>{/each}</select></label>
      <span>VS</span>
      <label>Team B<select class="form-input" bind:value={compareRightKey}>{#each [...teams].sort((a, b) => a.team_number - b.team_number) as team}<option value={team.key}>#{team.team_number} {team.nickname}</option>{/each}</select></label>
    </div>
    {#if compareLeft && compareRight}
      <div class="comparison-grid">
        <strong>#{compareLeft.team_number}</strong><span>Metric</span><strong>#{compareRight.team_number}</strong>
        <b>{compareLeft.powerRank ?? '—'}</b><span>Power rank</span><b>{compareRight.powerRank ?? '—'}</b>
        <b>{fmt(compareLeft.scoutPower)}</b><span>Scout power</span><b>{fmt(compareRight.scoutPower)}</b>
        <b>{fmt(compareLeft.scoreBreakdown.matchEvaluationScore)}</b><span>Match evaluation</span><b>{fmt(compareRight.scoreBreakdown.matchEvaluationScore)}</b>
        <b>{fmt(compareLeft.scoreBreakdown.reliabilityScore)}</b><span>Reliability</span><b>{fmt(compareRight.scoreBreakdown.reliabilityScore)}</b>
        <b>{compareLeft.decisionSummary.openProblemCount}</b><span>Open pit problems</span><b>{compareRight.decisionSummary.openProblemCount}</b>
        <b>{compareLeft.decisionSummary.noteCount}</b><span>Notes for review</span><b>{compareRight.decisionSummary.noteCount}</b>
        <b>{compareLeft.scoutSummary.matchesScouted}</b><span>Matches scouted</span><b>{compareRight.scoutSummary.matchesScouted}</b>
        <b>{fmt(compareLeft.scoutSummary.avgFuel)}</b><span>Avg fuel</span><b>{fmt(compareRight.scoutSummary.avgFuel)}</b>
        <b>{fmt(compareLeft.scoutSummary.avgDrivingRank)}</b><span>Driving</span><b>{fmt(compareRight.scoutSummary.avgDrivingRank)}</b>
        <b>{fmt(compareLeft.scoutSummary.avgAccuracy)}</b><span>Accuracy</span><b>{fmt(compareRight.scoutSummary.avgAccuracy)}</b>
        <b>{fmt(compareLeft.scoutSummary.avgSpeed)}</b><span>Speed</span><b>{fmt(compareRight.scoutSummary.avgSpeed)}</b>
        <b>{fmtPercent(compareLeft.scoutSummary.climbSuccessRate)}</b><span>Climb success</span><b>{fmtPercent(compareRight.scoutSummary.climbSuccessRate)}</b>
      </div>
    {/if}
  </section>

  <div class="search"><Search size={16} /><input class="form-input" placeholder="Filter teams..." bind:value={search} /></div>
  <div class="bom-table-container">
    <table class="bom-table">
      <thead><tr>
        <th><button on:click={() => sortBy('powerRank')}># <ArrowUpDown size={11} /></button></th>
        <th><button on:click={() => sortBy('team_number')}>Team <ArrowUpDown size={11} /></button></th>
        <th>Name</th><th><button on:click={() => sortBy('scoutPower')}>Scout Power <ArrowUpDown size={11} /></button></th>
        <th>Matches</th><th>Match Eval</th><th>Reliability</th><th>Problems</th><th>Notes</th><th>Avg Fuel</th><th>Driving</th><th>Accuracy</th><th>Speed</th><th>Climb</th>
      </tr></thead>
      <tbody>{#each filteredTeams as team (team.key)}<tr>
        <td class="strong">{team.powerRank ?? '—'}</td><td class="mono">{team.team_number}</td><td>{team.nickname}</td>
        <td class="strong">{fmt(team.scoutPower)}</td><td>{team.scoutSummary.matchesScouted + team.decisionSummary.matchReports}</td>
        <td>{fmt(team.decisionSummary.matchEvaluationScore)}</td><td>{fmt(team.decisionSummary.reliabilityScore)}</td><td>{team.decisionSummary.openProblemCount}</td><td>{team.decisionSummary.noteCount}</td><td>{fmt(team.scoutSummary.avgFuel)}</td>
        <td>{fmt(team.scoutSummary.avgDrivingRank)}</td><td>{fmt(team.scoutSummary.avgAccuracy)}</td><td>{fmt(team.scoutSummary.avgSpeed)}</td><td>{fmtPercent(team.scoutSummary.climbSuccessRate)}</td>
      </tr>{/each}</tbody>
    </table>
  </div>
{/if}

<style>
  h1, h2, .search { display:flex; align-items:center; gap:var(--gap-2); }
  .formula { color:var(--text-muted); font-size:.85rem; }
  .comparison-card { padding:var(--space-4); margin:var(--space-4) 0; }
  .comparison-card h2 { margin-top:0; font-size:1rem; }
  .comparison-selectors { display:grid; grid-template-columns:1fr auto 1fr; align-items:end; gap:var(--gap-4); }
  .comparison-selectors label { display:grid; gap:var(--space-1); }
  .comparison-selectors > span { padding-bottom:var(--space-2); font-weight:700; color:var(--text-muted); }
  .comparison-grid { display:grid; grid-template-columns:1fr 1.25fr 1fr; text-align:center; margin-top:var(--space-4); }
  .comparison-grid > * { padding:var(--space-2); border-bottom:1px solid var(--border); }
  .comparison-grid > span { color:var(--text-muted); }
  .search { margin:var(--space-4) 0 var(--space-3); }
  .search input { flex:1; }
  th button { display:inline-flex; align-items:center; gap:4px; background:none; border:0; padding:0; color:inherit; font:inherit; cursor:pointer; }
  @media (max-width:640px) { .comparison-selectors { grid-template-columns:1fr; } .comparison-selectors > span { text-align:center; padding:0; } }
</style>
