<script>
  import { onMount } from 'svelte';
  import { Binoculars, ArrowUpDown, RefreshCw } from 'lucide-svelte';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';

  // Base pick-list / team-comparison view: fuses three sources into one
  // sortable table, the same pattern the strongest researched FRC scouting
  // tools (PitPilot, mindScout) converge on rather than any one of them
  // being cloned outright:
  //   1. TBA - the real team roster for the active event (authoritative;
  //      Statbotics/local data only ever narrow or annotate this list, never
  //      define it).
  //   2. Statbotics EPA - Expected Points Added, an Elo-derived per-match
  //      scoring-contribution rating with auto/teleop/endgame components -
  //      the metric most of the ecosystem has converged on for "how good is
  //      this team, before you've scouted them yourself."
  //   3. This team's own local scouting coverage (scout_data_events) - just
  //      "have we actually scouted this team" for now; richer derived
  //      per-team stats from the raw event stream are a real next step, not
  //      in this base version.

  let eventKey = '';
  let loadingEvent = true;
  let loadingTeams = false;

  let teams = []; // merged rows: { key, team_number, nickname, epa, auto_epa, teleop_epa, endgame_epa, rank, wins, losses, ties, locallyScouted }
  let teamsError = '';
  let statboticsError = '';

  let sortKey = 'epa';
  let sortAsc = false; // EPA defaults high-to-low - that's the whole point of a pick list

  function sortBy(key) {
    if (sortKey === key) {
      sortAsc = !sortAsc;
    } else {
      sortKey = key;
      sortAsc = key === 'team_number'; // numeric team # makes more sense ascending by default
    }
  }

  $: sortedTeams = [...teams].sort((a, b) => {
    const av = a[sortKey];
    const bv = b[sortKey];
    // Nulls (e.g. no Statbotics data for a team) always sort last, regardless of direction.
    if (av == null && bv == null) return 0;
    if (av == null) return 1;
    if (bv == null) return -1;
    if (av < bv) return sortAsc ? -1 : 1;
    if (av > bv) return sortAsc ? 1 : -1;
    return 0;
  });

  function fmtEpa(v) {
    return v == null ? '—' : v.toFixed(1);
  }

  async function loadTeams() {
    if (!eventKey) return;
    loadingTeams = true;
    teamsError = '';
    statboticsError = '';

    const [tbaRes, statboticsRes, scoutedRes] = await Promise.all([
      fetch(`/api/tba/event-teams?event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null),
      fetch(`/api/statbotics/team-epas?event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null),
      fetch(`/datascout?list_teams=1&event_key=${encodeURIComponent(eventKey)}`).then((r) => r.json()).catch(() => null)
    ]);

    if (!tbaRes?.success) {
      teamsError = tbaRes?.error || 'Could not load the team list from The Blue Alliance.';
      teams = [];
      loadingTeams = false;
      return;
    }

    if (!statboticsRes?.success) {
      // Degrade gracefully - a real, current condition worth handling, not
      // hypothetical: Statbotics' public API has been returning HTTP 500 on
      // every query while this was built. The roster + local-scouting
      // signal are still useful without EPA layered on top.
      statboticsError = statboticsRes?.error || 'Statbotics EPA data is unavailable right now.';
    }
    const epaByTeamNumber = new Map((statboticsRes?.data || []).map((row) => [row.team, row]));

    const scoutedKeys = new Set(scoutedRes?.success ? scoutedRes.data : []);

    teams = tbaRes.data.map((t) => {
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
    });

    loadingTeams = false;
  }

  onMount(async () => {
    eventKey = await fetchActiveScoutingEventKey();
    loadingEvent = false;
    if (eventKey) await loadTeams();
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
      Statbotics EPA, and your team's own scouting coverage in one sortable table.
    </p>
  </div>
  {#if eventKey}
    <button class="btn btn-sm" on:click={loadTeams} disabled={loadingTeams} title="Refresh">
      <RefreshCw size={14} /> Refresh
    </button>
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
        ⚠ {statboticsError} Showing the team roster and local scouting coverage without EPA for now.
      </p>
    {/if}

    {#if loadingTeams}
      <p class="text-muted">Loading teams...</p>
    {:else if sortedTeams.length === 0}
      <div class="empty-state">
        <Binoculars size={40} />
        <h3>No teams found</h3>
        <p>The Blue Alliance has no team list yet for {eventKey}.</p>
      </div>
    {:else}
      <div class="bom-table-container">
        <table class="bom-table">
          <thead>
            <tr>
              <th><button class="sort-th" on:click={() => sortBy('team_number')}>Team <ArrowUpDown size={11} /></button></th>
              <th>Name</th>
              <th><button class="sort-th" on:click={() => sortBy('epa')}>EPA <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('auto_epa')}>Auto <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('teleop_epa')}>Teleop <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('endgame_epa')}>Endgame <ArrowUpDown size={11} /></button></th>
              <th><button class="sort-th" on:click={() => sortBy('rank')}>Rank <ArrowUpDown size={11} /></button></th>
              <th>Record</th>
              <th>Scouted</th>
            </tr>
          </thead>
          <tbody>
            {#each sortedTeams as t (t.key)}
              <tr>
                <td class="mono">{t.team_number}</td>
                <td>{t.nickname}</td>
                <td class="strong">{fmtEpa(t.epa)}</td>
                <td>{fmtEpa(t.auto_epa)}</td>
                <td>{fmtEpa(t.teleop_epa)}</td>
                <td>{fmtEpa(t.endgame_epa)}</td>
                <td>{t.rank ?? '—'}</td>
                <td class="mono">{t.wins == null ? '—' : `${t.wins}-${t.losses}-${t.ties}`}</td>
                <td>{t.locallyScouted ? '✓' : ''}</td>
              </tr>
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
</style>
