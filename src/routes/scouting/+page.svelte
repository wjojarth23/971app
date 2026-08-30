<script>
  import { onMount } from 'svelte';
  import {
    ListChecks, ArrowUpDown, RefreshCw, Search, Download, Star, X,
    ChevronDown, ChevronRight, ArrowUp, ArrowDown
  } from 'lucide-svelte';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';
  import { getAuthHeader } from '$lib/supabase.js';
  import { summarizeTeamEvents } from '$lib/scoutingStats.js';

  // Team comparison / pick-list workspace: fuses four sources into one
  // page, the same pattern the strongest researched FRC scouting tools
  // (PitPilot, mindScout, Lovat Dashboard) converge on rather than any one
  // of them being cloned outright:
  //   1. TBA - the real team roster for the active event (authoritative;
  //      everything else only narrows or annotates this list, never
  //      defines it).
  //   2. TBA OPR - The Blue Alliance's own computed power rating for the
  //      event (replaces Statbotics EPA - see issue #80; Statbotics'
  //      public API was returning HTTP 500 on every query. TBA doesn't
  //      break OPR down into auto/teleop/endgame components the way EPA
  //      did, so those fields are always null now).
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
  let powerRatingError = '';
  let scoutingDataWarning = '';

  let search = '';

  let sortKey = 'epa';
  let sortAsc = false; // OPR defaults high-to-low - that's the whole point of a pick list

  function sortBy(key) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = key === 'team_number';
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
    const header = ['Team', 'Name', 'OPR', 'Official Rank', 'Wins', 'Losses', 'Ties'];
    const rows = filteredTeams.map((t) =>
      [t.team_number, t.nickname, t.epa ?? '', t.rank ?? '', t.wins ?? '', t.losses ?? '', t.ties ?? '']);
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
    powerRatingError = '';
    scoutingDataWarning = '';
    const authHeaders = await getAuthHeader();

    const [tbaRes, oprRes, scoutedRes] = await Promise.all([
      fetch(`/api/tba/event-teams?event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/tba/event-oprs?event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null),
      fetch(`/datascout?all_teams=1&event_key=${encodeURIComponent(eventKey)}`, { headers: authHeaders }).then((r) => r.json()).catch(() => null)
    ]);

    if (!oprRes?.success) {
      // Degrade gracefully - the roster + local-scouting signal are still
      // useful without OPR layered on top (e.g. a transient TBA outage).
      powerRatingError = oprRes?.error || 'TBA power rating data is unavailable right now.';
    }
    const epaByTeamNumber = new Map((oprRes?.data || []).map((row) => [row.team, row]));

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
      for (const row of oprRes?.data || []) {
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
        scoutingDataWarning = `${tbaRes?.error || 'The Blue Alliance roster is unavailable.'} Using TBA OPR and locally scouted teams as the roster.`;
      } else {
        teamsError = tbaRes?.error || 'Could not load an event team roster.';
        teams = [];
        loadingTeams = false;
        return;
      }
    }

    teams = roster.map((t) => {
      const epaRow = epaByTeamNumber.get(t.team_number);
      return {
        key: t.key,
        team_number: t.team_number,
        nickname: t.nickname,
        epa: epaRow?.epa ?? null,
        rank: epaRow?.rank ?? null,
        wins: epaRow?.wins ?? null,
        losses: epaRow?.losses ?? null,
        ties: epaRow?.ties ?? null,
        locallyScouted: scoutedKeys.has(t.key)
      };
    });

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
  <title>Pick List</title>
</svelte:head>

<div class="page-header">
  <div class="header-content">
    <h1><ListChecks size={22} style="vertical-align:-3px; margin-right:6px" /> Pick List</h1>
    <p>
      Team comparison / pick list{eventKey ? ` for ${eventKey}` : ''} - The Blue Alliance roster,
      TBA OPR, your team's own scouting coverage, and a shared pick list in one workspace.
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
    {#if powerRatingError}
      <p class="text-muted" style="margin-bottom: var(--space-3)">
        ⚠ {powerRatingError} Showing the team roster, local scouting coverage, and pick list without OPR for now.
      </p>
    {/if}
    {#if scoutingDataWarning}
      <p class="text-muted" style="margin-bottom: var(--space-3)">⚠ {scoutingDataWarning}</p>
    {/if}

    <!-- Pick list -->
    <div class="surface-card picklist-card">
      <div class="flex-row-between">
        <h3 style="margin:0">Ranked picks{picklist.length ? ` (${picklist.length})` : ''}</h3>
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
              <th><button class="sort-th" on:click={() => sortBy('team_number')}>Team <ArrowUpDown size={11} /></button></th>
              <th>Name</th>
              <th><button class="sort-th" on:click={() => sortBy('epa')}>OPR <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('rank')}>Rank <ArrowUpDown size={11} /></button></th>
              <th>Record</th>
              <th>Scouted</th>
              <th>Pick</th>
            </tr>
          </thead>
          <tbody>
            {#each filteredTeams as t (t.key)}
              <tr class="team-row" on:click={() => toggleExpand(t)}>
                <td class="expand-cell">
                  {#if expandedTeamKey === t.key}<ChevronDown size={14} />{:else}<ChevronRight size={14} />{/if}
                </td>
                <td class="mono">{t.team_number}</td>
                <td>{t.nickname}</td>
                <td class="strong">{fmtEpa(t.epa)}</td>
                <td>{t.rank ?? '—'}</td>
                <td class="mono">{t.wins == null ? '—' : `${t.wins}-${t.losses}-${t.ties}`}</td>
                <td>{t.locallyScouted ? '✓' : ''}</td>
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
                  <td colspan="8">
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
