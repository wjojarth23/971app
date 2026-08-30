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

  let officialByTeam = new Map();
  let officialNote = '';

  const officialRank = (team) => officialByTeam.get(team?.team_number)?.rank ?? null;
  const officialOpr = (team) => officialByTeam.get(team?.team_number)?.opr ?? null;

  async function loadRankings() {
    if (!eventKey) return;
    loading = true;
    error = '';
    warning = '';
    officialNote = '';
    const authHeaders = await getAuthHeader();
    const [rosterResult, scoutResult, notesResult, pitResult, problemResult, officialResult] = await Promise.all([
      fetch(`/api/tba/event-teams?event_key=${encodeURIComponent(eventKey)}`).then((response) => response.json()).catch(() => null),
      fetch(`/datascout?all_teams=1&event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((response) => response.json()).catch(() => null),
      fetch(`/notescout?event_key=${encodeURIComponent(eventKey)}&recent=50000`, { headers: authHeaders }).then((response) => response.json()).catch(() => null),
      fetch(`/pitscout?event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((response) => response.json()).catch(() => null),
      fetch(`/api/matchscout?resource=pit-problems&event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((response) => response.json()).catch(() => null),
      fetch(`/api/tba/event-oprs?event_key=${encodeURIComponent(eventKey)}`).then((response) => response.json()).catch(() => null)
    ]);

    const scoutEvents = scoutResult?.success ? scoutResult.data : [];
    const scoutNotes = notesResult?.success ? notesResult.data : [];
    const pitEntries = pitResult?.success ? pitResult.data : [];
    const problemReports = problemResult?.success ? problemResult.data : [];
    if (!scoutResult?.success) warning = scoutResult?.error || 'Local scouting data is unavailable.';
    else if (scoutResult.truncated) warning = 'Only the first 50,000 scouting observations were loaded.';
    if (!notesResult?.success) warning = `${warning ? `${warning} ` : ''}${notesResult?.error || 'Scouting notes are unavailable.'}`;
    if (!pitResult?.success) warning = `${warning ? `${warning} ` : ''}${pitResult?.error || 'Pit profiles are unavailable.'}`;
    if (!problemResult?.success) warning = `${warning ? `${warning} ` : ''}${problemResult?.error || 'Pit problem reports are unavailable.'}`;

    let roster = rosterResult?.success ? rosterResult.data : [];
    if (!roster.length) {
      const keys = [...new Set([...scoutEvents, ...scoutNotes, ...pitEntries, ...problemReports].map((row) => row.team_key).filter(Boolean))];
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

    // Official rank and OPR come from The Blue Alliance and are reference
    // columns only - they never feed buildPowerRankings(). Keyed by bare team
    // number, which is the shape api/tba/event-oprs returns.
    //
    // Note the endpoint's field is named `epa` for backwards compatibility
    // with the Statbotics route it replaced; the value it carries is TBA's
    // OPR, and it is labelled as OPR everywhere it is shown.
    officialByTeam = new Map();
    if (officialResult?.success) {
      for (const row of officialResult.data || []) {
        const teamNumber = Number(row?.team);
        if (Number.isFinite(teamNumber)) {
          officialByTeam.set(teamNumber, { rank: row?.rank ?? null, opr: row?.epa ?? null });
        }
      }
    } else if (officialResult?.error) {
      // Reference data only - a TBA outage must not hide the scouting ranking.
      officialNote = 'Official rank and TBA OPR are unavailable right now.';
    }

    teams = buildPowerRankings(roster, scoutEvents, scoutNotes, { pitEntries, problemReports });
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
    <p>971's own scouting ranking{eventKey ? ` for ${eventKey}` : ''}, shown next to the official event standing for reference.</p>
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
  {#if officialNote}<p class="text-muted">⚠ {officialNote}</p>{/if}

  <section class="measure-key" aria-label="What each measure means">
    <div>
      <h3>971 Scout Power</h3>
      <p>Our own ranking, from our own scouts. 70% observed match performance, 15% explicit note impact, and 15% pit capability/reliability; missing inputs are omitted and the remaining weights rebalanced. Unresolved pit problems reduce the pit score. <strong>Not an FRC ranking</strong> - it exists to inform our picks.</p>
    </div>
    <div>
      <h3>Official Event Rank</h3>
      <p>The real qualification standing from The Blue Alliance, which FIRST computes from Ranking Points earned in qualification matches. This is the only official rank on this page.</p>
    </div>
    <div>
      <h3>TBA OPR</h3>
      <p>Offensive Power Rating: a least-squares estimate of a team's contribution to alliance score, calculated by The Blue Alliance from match results. A statistical estimate, <strong>not an official rank</strong>.</p>
    </div>
  </section>

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
        <b>{compareLeft.powerRank ?? '—'}</b><span>Scout power rank (971)</span><b>{compareRight.powerRank ?? '—'}</b>
        <b>{fmt(compareLeft.scoutPower)}</b><span>Scout power (971)</span><b>{fmt(compareRight.scoutPower)}</b>
        <b>{officialRank(compareLeft) ?? '—'}</b><span>Official event rank</span><b>{officialRank(compareRight) ?? '—'}</b>
        <b>{fmt(officialOpr(compareLeft))}</b><span>TBA OPR</span><b>{fmt(officialOpr(compareRight))}</b>
        <b>{compareLeft.noteSummary.averageImpact ?? '—'}</b><span>Note impact</span><b>{compareRight.noteSummary.averageImpact ?? '—'}</b>
        <b>{compareLeft.noteSummary.noteCount}</b><span>Saved notes</span><b>{compareRight.noteSummary.noteCount}</b>
        <b>{fmt(compareLeft.pitSummary.pitScore)}</b><span>Pit score</span><b>{fmt(compareRight.pitSummary.pitScore)}</b>
        <b>{compareLeft.pitSummary.robotArchetype || '—'}</b><span>Archetype</span><b>{compareRight.pitSummary.robotArchetype || '—'}</b>
        <b>{compareLeft.pitSummary.openProblemCount}</b><span>Open pit problems</span><b>{compareRight.pitSummary.openProblemCount}</b>
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
        <th class="reference" title="Official FRC qualification rank from The Blue Alliance">Official Rank</th>
        <th class="reference" title="The Blue Alliance's Offensive Power Rating - a statistical estimate, not a rank">TBA OPR</th>
        <th>Matches</th><th>Pit Score</th><th>Problems</th><th>Archetype</th><th>Note Impact</th><th>Notes</th><th>Avg Fuel</th><th>Driving</th><th>Accuracy</th><th>Speed</th><th>Climb</th>
      </tr></thead>
      <tbody>{#each filteredTeams as team (team.key)}<tr>
        <td class="strong">{team.powerRank ?? '—'}</td><td class="mono">{team.team_number}</td><td>{team.nickname}</td>
        <td class="strong">{fmt(team.scoutPower)}</td>
        <td class="reference">{officialRank(team) ?? '—'}</td>
        <td class="reference">{fmt(officialOpr(team))}</td>
        <td>{team.scoutSummary.matchesScouted}</td><td>{fmt(team.pitSummary.pitScore)}</td><td>{team.pitSummary.openProblemCount}</td><td>{team.pitSummary.robotArchetype || '—'}</td><td>{team.noteSummary.averageImpact ?? '—'}</td><td>{team.noteSummary.noteCount}</td><td>{fmt(team.scoutSummary.avgFuel)}</td>
        <td>{fmt(team.scoutSummary.avgDrivingRank)}</td><td>{fmt(team.scoutSummary.avgAccuracy)}</td><td>{fmt(team.scoutSummary.avgSpeed)}</td><td>{fmtPercent(team.scoutSummary.climbSuccessRate)}</td>
      </tr>{/each}</tbody>
    </table>
  </div>
{/if}

<style>
  h1, h2, .search { display:flex; align-items:center; gap:var(--gap-2); }
  .comparison-card { padding:var(--space-4); margin:var(--space-4) 0; }
  .comparison-card h2 { margin-top:0; font-size:1rem; }
  .comparison-selectors { display:grid; grid-template-columns:1fr auto 1fr; align-items:end; gap:var(--gap-4); }
  .comparison-selectors label { display:grid; gap:var(--space-1); }
  .comparison-selectors > span { padding-bottom:var(--space-2); font-weight:700; color:var(--text-muted); }
  .comparison-grid { display:grid; grid-template-columns:1fr 1.25fr 1fr; text-align:center; margin-top:var(--space-4); }
  .comparison-grid > * { padding:var(--space-2); border-bottom:1px solid var(--border); }
  .comparison-grid > span { color:var(--text-muted); }
  /* Reference columns are visually recessive so the page reads as our ranking
     with official data alongside, not as a scoreboard of equals. */
  .reference { color:var(--text-muted); }
  .measure-key { display:grid; grid-template-columns:repeat(auto-fit, minmax(15rem, 1fr)); gap:var(--gap-4); margin:var(--space-4) 0; }
  .measure-key h3 { margin:0 0 var(--space-1); font-size:.82rem; text-transform:uppercase; letter-spacing:.04em; }
  .measure-key p { margin:0; color:var(--text-muted); font-size:.82rem; }
  .search { margin:var(--space-4) 0 var(--space-3); }
  .search input { flex:1; }
  th button { display:inline-flex; align-items:center; gap:4px; background:none; border:0; padding:0; color:inherit; font:inherit; cursor:pointer; }
  @media (max-width:640px) { .comparison-selectors { grid-template-columns:1fr; } .comparison-selectors > span { text-align:center; padding:0; } }
</style>
