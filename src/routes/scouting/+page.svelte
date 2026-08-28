<script>
  import { onMount } from 'svelte';
  import {
    Binoculars, ArrowUpDown, RefreshCw, Search, Download, Star, X,
    ChevronDown, ChevronRight, ArrowUp, ArrowDown
  } from 'lucide-svelte';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';
  import { getAuthHeader } from '$lib/supabase.js';
  import { summarizeTeamEvents, buildPowerRankings } from '$lib/scoutingStats.js';

  // Team comparison / pick-list workspace: fuses four sources into one
  // page, the same pattern the strongest researched FRC scouting tools
  // (PitPilot, mindScout, Lovat Dashboard) converge on rather than any one
  // of them being cloned outright:
  //   1. TBA - the real team roster for the active event (authoritative;
  //      everything else only narrows or annotates this list, never
  //      defines it).
  //   2. Statbotics EPA - per-match scoring-contribution rating with
  //      auto/teleop/endgame components.
  //   3. This team's own local scouting coverage (scout_data_events) +
  //      derived summary stats (driving/accuracy/speed/climb) + free-text
  //      notes (scout_notes) - reads from datascout/notescout, doesn't
  //      duplicate their collection UI.
  //   4. A shared, persisted pick list (scouting_picklist) - the actual
  //      payoff: turning all of the above into a decision, visible to the
  //      whole team, not just this one browser tab.

  let eventKey = '';
  let loadingEvent = true;
  let loadingTeams = false;

  let teams = []; // merged rows
  let teamsError = '';
  let statboticsError = '';
  let scoutingDataWarning = '';

  let search = '';

  let sortKey = 'scoutPower';
  let sortAsc = false; // EPA defaults high-to-low - that's the whole point of a pick list
  let viewMode = 'basic';
  let compareLeftKey = '';
  let compareRightKey = '';

  function sortBy(key) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = key === 'team_number';
    }
  }

  function setViewMode(mode) {
    viewMode = mode;
    if (mode === 'power') {
      sortKey = 'scoutPower';
      sortAsc = false;
    } else if (mode === 'basic') {
      sortKey = 'epa';
      sortAsc = false;
    }
  }

  $: sortedTeams = [...teams].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  $: filteredTeams = search.trim()
    ? sortedTeams.filter((t) => {
        const q = search.trim().toLowerCase();
        return String(t.team_number).includes(q) || (t.nickname || '').toLowerCase().includes(q);
      })
    : sortedTeams;

  function fmtEpa(v) {
    return v == null ? '—' : v.toFixed(1);
  }

  function fmtPercent(v) {
    return v == null ? '—' : `${Math.round(v)}%`;
  }

  $: compareLeft = teams.find((team) => team.key === compareLeftKey) || null;
  $: compareRight = teams.find((team) => team.key === compareRightKey) || null;

  // --- Pick list --------------------------------------------------------

  let picklist = []; // ordered rows from scouting_picklist: { id, team_key, team_number, nickname, note, position }
  let picklistError = '';
  $: picklistTeamKeys = new Set(picklist.map((p) => p.team_key));

  async function loadPicklist() {
    if (!eventKey) return;
    const res = await fetch(`/api/scouting-picklist?event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null);
    if (res?.success) {
      picklist = res.data;
      picklistError = '';
    } else {
      picklistError = res?.error || 'Could not load the pick list.';
    }
  }

  async function addToPicklist(team) {
    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
    const res = await fetch('/api/scouting-picklist', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        action: 'add',
        event_key: eventKey,
        team_key: team.key,
        team_number: team.team_number,
        nickname: team.nickname
      })
    }).then((r) => r.json()).catch(() => null);
    if (res?.success) await loadPicklist();
  }

  async function removeFromPicklist(id) {
    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
    const res = await fetch('/api/scouting-picklist', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'remove', id })
    }).then((r) => r.json()).catch(() => null);
    if (res?.success) await loadPicklist();
  }

  async function movePicklistItem(index, delta) {
    const target = index + delta;
    if (target < 0 || target >= picklist.length) return;
    const reordered = [...picklist];
    [reordered[index], reordered[target]] = [reordered[target], reordered[index]];
    picklist = reordered; // optimistic - reorder locally first, persist after
    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
    await fetch('/api/scouting-picklist', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'reorder', event_key: eventKey, ordered_ids: reordered.map((p) => p.id) })
    }).catch(() => {});
  }

  let noteDrafts = {}; // id -> in-progress note text, so typing doesn't fight the loaded value
  async function saveNote(id) {
    const note = noteDrafts[id] ?? '';
    const headers = { 'Content-Type': 'application/json', ...(await getAuthHeader()) };
    await fetch('/api/scouting-picklist', {
      method: 'POST',
      headers,
      body: JSON.stringify({ action: 'note', id, note })
    }).catch(() => {});
    picklist = picklist.map((p) => (p.id === id ? { ...p, note } : p));
  }

  // --- Team detail expand -------------------------------------------------

  let expandedTeamKey = null;
  let teamDetails = {}; // team_key -> { loading, summary, notes }

  async function toggleExpand(team) {
    if (expandedTeamKey === team.key) {
      expandedTeamKey = null;
      return;
    }
    expandedTeamKey = team.key;
    if (teamDetails[team.key]) return; // already loaded

    teamDetails = { ...teamDetails, [team.key]: { loading: true, summary: null, notes: [] } };
    const [eventsRes, notesRes] = await Promise.all([
      fetch(`/datascout?team_key=${encodeURIComponent(team.key)}&event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null),
      fetch(`/notescout?team_key=${encodeURIComponent(team.key)}&event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null)
    ]);
    teamDetails = {
      ...teamDetails,
      [team.key]: {
        loading: false,
        summary: eventsRes?.success ? summarizeTeamEvents(eventsRes.data) : null,
        notes: notesRes?.success ? notesRes.data : []
      }
    };
  }

  // --- CSV export -----------------------------------------------------

  function exportCsv() {
    const power = viewMode === 'power';
    const header = power
      ? ['Power Rank', 'Team', 'Name', 'Scout Power', 'Matches Scouted', 'Avg Fuel', 'Driving', 'Accuracy', 'Speed', 'Climb Success']
      : ['Team', 'Name', 'EPA', 'Auto EPA', 'Teleop EPA', 'Endgame EPA', 'Official Rank', 'Wins', 'Losses', 'Ties'];
    const rows = filteredTeams.map((t) => power
      ? [t.powerRank ?? '', t.team_number, t.nickname, t.scoutPower ?? '', t.scoutSummary?.matchesScouted ?? 0,
          t.scoutSummary?.avgFuel ?? '', t.scoutSummary?.avgDrivingRank ?? '', t.scoutSummary?.avgAccuracy ?? '',
          t.scoutSummary?.avgSpeed ?? '', t.scoutSummary?.climbSuccessRate ?? '']
      : [t.team_number, t.nickname, t.epa ?? '', t.auto_epa ?? '', t.teleop_epa ?? '', t.endgame_epa ?? '',
          t.rank ?? '', t.wins ?? '', t.losses ?? '', t.ties ?? '']);
    const escapeCell = (c) => {
      const s = String(c);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [header, ...rows].map((r) => r.map(escapeCell).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${eventKey || 'scouting'}-teams.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // --- Load ---------------------------------------------------------------

  async function loadTeams() {
    if (!eventKey) return;
    loadingTeams = true;
    teamsError = '';
    statboticsError = '';
    scoutingDataWarning = '';
    const authHeaders = await getAuthHeader();

    const [tbaRes, statboticsRes, scoutedRes] = await Promise.all([
      fetch(`/api/tba/event-teams?event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/statbotics/team-epas?event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null),
      fetch(`/datascout?all_teams=1&event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((r) => r.json()).catch(() => null)
    ]);

    if (!statboticsRes?.success) {
      // Degrade gracefully - a real, current condition worth handling, not
      // hypothetical: Statbotics' public API has been returning HTTP 500 on
      // every query while this was built. The roster + local-scouting
      // signal are still useful without EPA layered on top.
      statboticsError = statboticsRes?.error || 'Statbotics EPA data is unavailable right now.';
    }
    const epaByTeamNumber = new Map((statboticsRes?.data || []).map((row) => [row.team, row]));

    const scoutEvents = scoutedRes?.success ? scoutedRes.data : [];
    if (scoutedRes?.truncated) {
      scoutingDataWarning = 'Scouting data exceeded the 50,000-event safety limit; rankings may be incomplete.';
    } else if (!scoutedRes?.success) {
      scoutingDataWarning = scoutedRes?.error || 'Local scouting data is unavailable; rankings are using EPA only.';
    }
    const scoutedKeys = new Set(scoutEvents.map((row) => row.team_key));

    let roster = tbaRes?.success ? tbaRes.data : [];
    if (!roster.length) {
      const fallback = new Map();
      for (const row of statboticsRes?.data || []) {
        fallback.set(`frc${row.team}`, {
          key: `frc${row.team}`,
          team_number: row.team,
          nickname: row.team_name || ''
        });
      }
      for (const row of scoutEvents) {
        if (!row?.team_key || fallback.has(row.team_key)) continue;
        const teamNumber = Number(String(row.team_key).replace(/^frc/i, ''));
        fallback.set(row.team_key, { key: row.team_key, team_number: teamNumber, nickname: '' });
      }
      roster = [...fallback.values()];
      if (roster.length) {
        scoutingDataWarning = `${tbaRes?.error || 'The Blue Alliance roster is unavailable.'} Using Statbotics and locally scouted teams as the roster.`;
      } else {
        teamsError = tbaRes?.error || 'Could not load an event team roster.';
        teams = [];
        loadingTeams = false;
        return;
      }
    }

    teams = buildPowerRankings(roster.map((t) => {
      const epaRow = epaByTeamNumber.get(t.team_number);
      return {
        key: t.key,
        team_number: t.team_number,
        nickname: t.nickname,
        epa: epaRow?.epa ?? null,
        auto_epa: epaRow?.auto_epa ?? null,
        teleop_epa: epaRow?.teleop_epa ?? null,
        endgame_epa: epaRow?.endgame_epa ?? null,
        rank: epaRow?.rank ?? null,
        wins: epaRow?.wins ?? null,
        losses: epaRow?.losses ?? null,
        ties: epaRow?.ties ?? null,
        locallyScouted: scoutedKeys.has(t.key)
      };
    }), scoutEvents);

    const ranked = [...teams].sort((a, b) => (b.scoutPower ?? -1) - (a.scoutPower ?? -1));
    if (!compareLeftKey && ranked[0]) compareLeftKey = ranked[0].key;
    if (!compareRightKey && ranked[1]) compareRightKey = ranked[1].key;

    loadingTeams = false;
  }

  onMount(async () => {
    eventKey = await fetchActiveScoutingEventKey();
    loadingEvent = false;
    if (eventKey) {
      await Promise.all([loadTeams(), loadPicklist()]);
    }
  });
</script>

<svelte:head>
  <title>Scouting</title>
</svelte:head>

<div class="page-header">
  <div class="header-content">
    <h1><Binoculars size={22} style="vertical-align:-3px; margin-right:6px" /> Scouting</h1>
    <p>
      Team comparison / pick list{eventKey ? ` for ${eventKey}` : ''} - The Blue Alliance roster,
      Statbotics EPA, your team's own scouting coverage, and a shared pick list in one workspace.
    </p>
  </div>
  {#if eventKey}
    <div class="actions">
      <button class="btn btn-sm" on:click={exportCsv} title="Export the visible table as CSV">
        <Download size={14} /> Export CSV
      </button>
      <button class="btn btn-sm" on:click={loadTeams} disabled={loadingTeams} title="Refresh">
        <RefreshCw size={14} /> Refresh
      </button>
    </div>
  {/if}
</div>

{#if loadingEvent}
  <p class="text-muted">Loading...</p>
{:else if !eventKey}
  <div class="empty-state">
    <Binoculars size={40} />
    <h3>No active scouting event set</h3>
    <p>
      Set the current event in <a href="/scouting-admin">Scouting Admin</a> to load a team list here.
    </p>
  </div>
{:else}
  {#if teamsError}
    <div class="error-container">
      <p>{teamsError}</p>
    </div>
  {:else}
    {#if statboticsError}
      <p class="text-muted" style="margin-bottom: var(--space-3)">
        ⚠ {statboticsError} Showing the team roster, local scouting coverage, and pick list without EPA for now.
      </p>
    {/if}
    {#if scoutingDataWarning}
      <p class="text-muted" style="margin-bottom: var(--space-3)">⚠ {scoutingDataWarning}</p>
    {/if}

    <!-- Pick list -->
    <div class="surface-card picklist-card">
      <div class="flex-row-between">
        <h3 style="margin:0">Pick List{picklist.length ? ` (${picklist.length})` : ''}</h3>
      </div>
      {#if picklistError}
        <p class="text-error">{picklistError}</p>
      {:else if picklist.length === 0}
        <p class="text-muted">No teams picked yet - use the star on any row below to add one.</p>
      {:else}
        <ol class="picklist">
          {#each picklist as p, i (p.id)}
            <li class="picklist-item">
              <span class="picklist-rank mono">{i + 1}</span>
              <span class="picklist-team">
                <span class="mono">#{p.team_number}</span> {p.nickname}
              </span>
              <input
                class="form-input picklist-note"
                placeholder="Note..."
                value={p.note || ''}
                on:input={(e) => (noteDrafts[p.id] = e.currentTarget.value)}
                on:blur={() => saveNote(p.id)}
              />
              <span class="picklist-controls">
                <button class="icon-btn" on:click={() => movePicklistItem(i, -1)} disabled={i === 0} title="Move up">
                  <ArrowUp size={14} />
                </button>
                <button class="icon-btn" on:click={() => movePicklistItem(i, 1)} disabled={i === picklist.length - 1} title="Move down">
                  <ArrowDown size={14} />
                </button>
                <button class="icon-btn" on:click={() => removeFromPicklist(p.id)} title="Remove from pick list">
                  <X size={14} />
                </button>
              </span>
            </li>
          {/each}
        </ol>
      {/if}
    </div>

    <div class="view-tabs" aria-label="Scouting analysis view">
      <button class:active={viewMode === 'basic'} on:click={() => setViewMode('basic')}>Basic Rankings</button>
      <a class="ranking-link" href="/scouting/powerrankings">Power Rankings &amp; Head to Head</a>
    </div>

    {#if viewMode === 'compare'}
      <div class="surface-card comparison-card">
        <div class="comparison-selectors">
          <label>Team A
            <select class="form-input" bind:value={compareLeftKey}>
              {#each [...teams].sort((a, b) => a.team_number - b.team_number) as team}
                <option value={team.key}>#{team.team_number} {team.nickname}</option>
              {/each}
            </select>
          </label>
          <span class="versus">VS</span>
          <label>Team B
            <select class="form-input" bind:value={compareRightKey}>
              {#each [...teams].sort((a, b) => a.team_number - b.team_number) as team}
                <option value={team.key}>#{team.team_number} {team.nickname}</option>
              {/each}
            </select>
          </label>
        </div>
        {#if compareLeft && compareRight}
          <div class="comparison-grid">
            <strong>#{compareLeft.team_number}</strong><span>Metric</span><strong>#{compareRight.team_number}</strong>
            <b>{compareLeft.powerRank ?? '—'}</b><span>Combined rank</span><b>{compareRight.powerRank ?? '—'}</b>
            <b>{fmtEpa(compareLeft.scoutPower)}</b><span>Scout power</span><b>{fmtEpa(compareRight.scoutPower)}</b>
            <b>{fmtEpa(compareLeft.epa)}</b><span>Statbotics EPA</span><b>{fmtEpa(compareRight.epa)}</b>
            <b>{compareLeft.scoutSummary.matchesScouted}</b><span>Matches scouted</span><b>{compareRight.scoutSummary.matchesScouted}</b>
            <b>{fmtEpa(compareLeft.scoutSummary.avgFuel)}</b><span>Avg fuel / match</span><b>{fmtEpa(compareRight.scoutSummary.avgFuel)}</b>
            <b>{fmtEpa(compareLeft.scoutSummary.avgDrivingRank)}</b><span>Driving (1–3)</span><b>{fmtEpa(compareRight.scoutSummary.avgDrivingRank)}</b>
            <b>{fmtEpa(compareLeft.scoutSummary.avgAccuracy)}</b><span>Accuracy (1–5)</span><b>{fmtEpa(compareRight.scoutSummary.avgAccuracy)}</b>
            <b>{fmtEpa(compareLeft.scoutSummary.avgSpeed)}</b><span>Speed</span><b>{fmtEpa(compareRight.scoutSummary.avgSpeed)}</b>
            <b>{fmtPercent(compareLeft.scoutSummary.climbSuccessRate)}</b><span>Climb success</span><b>{fmtPercent(compareRight.scoutSummary.climbSuccessRate)}</b>
          </div>
        {/if}
      </div>
    {/if}

    {#if viewMode === 'power'}
    <div class="ranking-explainer text-muted">
      Scout power combines your team's observations only: fuel 40%, driving 20%, accuracy 15%, climb 15%, and speed 10%. Missing metrics are omitted and remaining weights are rebalanced. Statbotics EPA is kept separately under Basic Rankings.
    </div>
    {/if}
    {#if viewMode !== 'compare'}
    <div class="docs-search" style="margin: var(--space-4) 0 var(--space-3) 0">
      <Search size={16} />
      <input class="form-input" type="text" placeholder="Filter by team number or name..." bind:value={search} />
    </div>

    {#if loadingTeams}
      <p class="text-muted">Loading teams...</p>
    {:else if filteredTeams.length === 0}
      <div class="empty-state">
        <Binoculars size={40} />
        <h3>No teams found</h3>
        <p>{search.trim() ? `No teams match "${search}".` : `The Blue Alliance has no team list yet for ${eventKey}.`}</p>
      </div>
    {:else}
      <div class="bom-table-container">
        <table class="bom-table">
          <thead>
            <tr>
              <th></th>
              {#if viewMode === 'power'}<th><button class="sort-th" on:click={() => sortBy('powerRank')}># <ArrowUpDown size={11} /></button></th>{/if}
              <th><button class="sort-th" on:click={() => sortBy('team_number')}>Team <ArrowUpDown size={11} /></button></th>
              <th>Name</th>
              {#if viewMode === 'power'}
              <th><button class="sort-th" on:click={() => sortBy('scoutPower')}>Scout Power <ArrowUpDown size={11} /></button></th>
              <th>Matches</th><th>Avg Fuel</th><th>Driving</th><th>Accuracy</th><th>Speed</th><th>Climb</th>
              {:else}
              <th><button class="sort-th" on:click={() => sortBy('epa')}>EPA <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('auto_epa')}>Auto <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('teleop_epa')}>Teleop <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('endgame_epa')}>Endgame <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('rank')}>Rank <ArrowUpDown size={11} /></button></th>
              <th>Record</th>
              <th>Scouted</th>
              {/if}
              <th>Pick</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredTeams as t (t.key)}
              <tr class="team-row" on:click={() => toggleExpand(t)}>
                <td class="expand-cell">
                  {#if expandedTeamKey === t.key}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
                </td>
                {#if viewMode === 'power'}<td class="strong">{t.powerRank ?? '—'}</td>{/if}
                <td class="mono">{t.team_number}</td>
                <td>{t.nickname}</td>
                {#if viewMode === 'power'}
                <td class="strong">{fmtEpa(t.scoutPower)}</td>
                <td>{t.scoutSummary.matchesScouted}</td><td>{fmtEpa(t.scoutSummary.avgFuel)}</td>
                <td>{fmtEpa(t.scoutSummary.avgDrivingRank)}</td><td>{fmtEpa(t.scoutSummary.avgAccuracy)}</td>
                <td>{fmtEpa(t.scoutSummary.avgSpeed)}</td><td>{fmtPercent(t.scoutSummary.climbSuccessRate)}</td>
                {:else}
                <td class="strong">{fmtEpa(t.epa)}</td>
                <td>{fmtEpa(t.auto_epa)}</td>
                <td>{fmtEpa(t.teleop_epa)}</td>
                <td>{fmtEpa(t.endgame_epa)}</td>
                <td>{t.rank ?? '—'}</td>
                <td class="mono">{t.wins == null ? '—' : `${t.wins}-${t.losses}-${t.ties}`}</td>
                <td>{t.locallyScouted ? '✓' : ''}</td>
                {/if}
                <td>
                  <button
                    class="icon-btn"
                    class:picked={picklistTeamKeys.has(t.key)}
                    on:click|stopPropagation={() => addToPicklist(t)}
                    disabled={picklistTeamKeys.has(t.key)}
                    title={picklistTeamKeys.has(t.key) ? 'Already on pick list' : 'Add to pick list'}
                  >
                    <Star size={14} fill={picklistTeamKeys.has(t.key) ? 'currentColor' : 'none'} />
                  </button>
                </td>
              </tr>
              {#if expandedTeamKey === t.key}
                <tr class="detail-row">
                  <td colspan={viewMode === 'power' ? 12 : 11}>
                    {#if teamDetails[t.key]?.loading}
                      <p class="text-muted">Loading team detail...</p>
                    {:else if teamDetails[t.key]}
                      {@const s = teamDetails[t.key].summary}
                      <div class="team-detail">
                        <div class="team-detail-stats">
                          <div><span class="text-muted">Matches scouted:</span> {s?.matchesScouted ?? 0}</div>
                          <div><span class="text-muted">Avg driving (1-3):</span> {s?.avgDrivingRank != null ? s.avgDrivingRank.toFixed(1) : '—'}</div>
                          <div><span class="text-muted">Avg accuracy (1-5):</span> {s?.avgAccuracy != null ? s.avgAccuracy.toFixed(1) : '—'}</div>
                          <div><span class="text-muted">Avg speed:</span> {s?.avgSpeed != null ? s.avgSpeed.toFixed(2) : '—'}</div>
                          <div><span class="text-muted">Most common climb:</span> {s?.mostCommonClimb ?? '—'}</div>
                        </div>
                        {#if teamDetails[t.key].notes.length > 0}
                          <div class="team-detail-notes">
                            <span class="text-muted">Scout notes:</span>
                            <ul>
                              {#each teamDetails[t.key].notes as n}
                                <li>{n.notes}</li>
                              {/each}
                            </ul>
                          </div>
                        {:else}
                          <p class="text-muted" style="margin: var(--space-2) 0 0 0">No scout notes for this team yet.</p>
                        {/if}
                      </div>
                    {/if}
                  </td>
                </tr>
              {/if}
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {/if}
  {/if}
{/if}

<style>
  .sort-th {
    display: inline-flex;
    align-items: center;
    gap: 4px;
    background: none;
    border: none;
    padding: 0;
    font: inherit;
    color: inherit;
    text-transform: inherit;
    letter-spacing: inherit;
    cursor: pointer;
  }
  .sort-th:hover {
    color: var(--text);
  }

  .view-tabs {
    display: flex;
    gap: var(--gap-2);
    margin: var(--space-4) 0;
  }
  .view-tabs button {
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-muted);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    cursor: pointer;
  }
  .view-tabs .ranking-link {
    border: 1px solid var(--border);
    background: var(--surface-1);
    color: var(--text-muted);
    padding: var(--space-2) var(--space-3);
    border-radius: var(--radius-md);
    text-decoration: none;
  }
  .view-tabs .ranking-link:hover { color: var(--text); border-color: var(--brand-primary, #d9a413); }
  .view-tabs button.active {
    color: var(--text);
    border-color: var(--brand-primary, #d9a413);
    background: var(--surface-2);
  }
  .ranking-explainer {
    font-size: 0.82rem;
    line-height: 1.5;
  }
  .comparison-card { padding: var(--space-4); }
  .comparison-selectors {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: end;
    gap: var(--gap-4);
  }
  .comparison-selectors label { display: grid; gap: var(--space-1); }
  .versus { padding-bottom: var(--space-2); font-weight: 700; color: var(--text-muted); }
  .comparison-grid {
    display: grid;
    grid-template-columns: minmax(5rem, 1fr) minmax(9rem, 1.25fr) minmax(5rem, 1fr);
    margin-top: var(--space-4);
    text-align: center;
  }
  .comparison-grid > * { padding: var(--space-2); border-bottom: 1px solid var(--border); }
  .comparison-grid > span { color: var(--text-muted); }
  @media (max-width: 640px) {
    .comparison-selectors { grid-template-columns: 1fr; }
    .versus { text-align: center; padding: 0; }
  }

  .docs-search {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    color: var(--text-muted);
  }
  .docs-search .form-input {
    flex: 1;
  }

  .team-row {
    cursor: pointer;
  }

  .expand-cell {
    color: var(--text-muted);
    width: 1.5em;
  }

  .detail-row td {
    background: var(--surface-1);
    padding: var(--space-3) var(--space-4) !important;
  }

  .team-detail-stats {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-4);
    font-size: 0.85rem;
    margin-bottom: var(--space-2);
  }

  .team-detail-notes ul {
    margin: var(--space-1) 0 0 0;
    padding-left: var(--space-5);
  }

  .icon-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    background: none;
    border: none;
    padding: 4px;
    border-radius: var(--radius-sm);
    color: var(--text-muted);
    cursor: pointer;
  }
  .icon-btn:hover:not(:disabled) {
    background: var(--surface-2);
    color: var(--text);
  }
  .icon-btn:disabled {
    opacity: 0.4;
    cursor: default;
  }
  .icon-btn.picked {
    color: var(--brand-gold-base, #d9a413);
  }

  .picklist-card {
    padding: var(--space-4);
    margin-bottom: var(--space-2);
  }

  .picklist {
    list-style: none;
    margin: var(--space-2) 0 0 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .picklist-item {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    padding: var(--space-2);
    border-bottom: 1px solid var(--border);
  }
  .picklist-item:last-child {
    border-bottom: none;
  }

  .picklist-rank {
    color: var(--text-muted);
    width: 1.5em;
    flex-shrink: 0;
  }

  .picklist-team {
    flex-shrink: 0;
    min-width: 12em;
  }

  .picklist-note {
    flex: 1;
    min-width: 0;
  }

  .picklist-controls {
    display: flex;
    gap: 2px;
    flex-shrink: 0;
  }
</style>
