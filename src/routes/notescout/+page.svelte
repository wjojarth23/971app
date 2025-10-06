<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore } from '$lib/stores/auth.js';
  import notescoutConfig from '$lib/notescout.json';
  let user;
  userStore.subscribe((v) => (user = v));

  let matches = [];
  let noteText = '';
  let selectedMatch = null;
  let selectedMatchKey = '';
  let selectedTeam = '';
  let viewMode = 'editor'; // 'editor' or 'view-notes'
  let teams = [];
  let teamsWithNotes = [];
  let selectedTeamWithNotes = '';
  let teamNotes = [];
  let saving = false;
  let apiNote = '';

  function displayTeam(t) {
    if (!t) return '';
    return String(t).replace(/^frc/i, '');
  }

  // Predict API was removed; we cannot fetch upcoming matches here.
  async function loadMatches() {
    apiNote = '';
    if (!notescoutConfig?.event_key) {
      apiNote = 'No event configured for Note Scouting.';
      matches = [];
      return;
    }
    // Inform user that the Predict backend was removed
    apiNote = 'Match loading is unavailable: Predict feature has been removed from this deployment.';
    matches = [];
  }

  function onSelectMatch(m) {
    selectedMatch = m || null;
    selectedMatchKey = m?.match_key || '';
    teams = m ? [...(m.red_team_keys || []), ...(m.blue_team_keys || [])] : [];
    // convert team keys (e.g. "frc971") to team numbers if needed
    selectedTeam = teams[0] || '';
  }

  function onSelectMatchByKey() {
    const m = matches.find((x) => x.match_key === selectedMatchKey);
    onSelectMatch(m);
  }

  // Load list of teams that have notes
  async function loadTeamsWithNotes() {
    try {
      const res = await fetch('/notescout?list_teams=1');
      const data = await res.json();
      if (data?.success) {
        teamsWithNotes = data.data || [];
        selectedTeamWithNotes = teamsWithNotes[0] || '';
      }
    } catch (e) {
      // ignore
    }
  }

  async function viewNotesForSelectedTeam() {
    if (!selectedTeamWithNotes) return;
    apiNote = '';
    try {
      const res = await fetch('/notescout?team_key=' + encodeURIComponent(selectedTeamWithNotes));
      const data = await res.json();
      if (!data?.success) {
        apiNote = data?.error || 'Failed to load notes';
        teamNotes = [];
        return;
      }
      teamNotes = data.data || [];
      viewMode = 'view-notes';
    } catch (e) {
      apiNote = e.message || 'Failed to load notes';
    }
  }

  async function saveNote() {
    if (!selectedMatch || !selectedTeam) return;
    saving = true;
    try {
      const payload = {
        action: 'save-note',
        match_key: selectedMatch.match_key,
        match_number: selectedMatch.match_number,
        team_key: selectedTeam,
        notes: noteText || '',
        user_id: user?.id || null
      };
      const res = await fetch('/notescout', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await res.json();
      if (!data?.success) {
        alert('Save failed: ' + (data?.error || 'unknown'));
      } else {
        noteText = '';
        alert('Saved');
      }
    } catch (e) {
      alert('Save error: ' + e.message);
    } finally {
      saving = false;
    }
  }

  onMount(() => { loadMatches(); });
  onMount(() => { loadTeamsWithNotes(); });
</script>

<div class="page-header card">
  <div>
    <h2 style="margin:0">Note Scouting</h2>
    {#if notescoutConfig?.event_key}
      <div class="form-label" style="margin-top:0.25rem">Event: {notescoutConfig.event_key}</div>
    {/if}
    {#if apiNote}
      <div class="note" style="margin-top:0.5rem">{apiNote}</div>
    {/if}
  </div>

  <div class="page-actions">
    <div class="form-group" style="min-width:220px">
      <label class="form-label">Match</label>
      <select class="form-select" id="matchSelect" bind:value={selectedMatchKey} on:change={onSelectMatchByKey}>
        <option value="">-- choose match --</option>
        {#each matches as m}
          {#key m.match_key}
            <option value={m.match_key}>{m.match_key?.split('_').pop() || m.match_key}</option>
          {/key}
        {/each}
      </select>
    </div>

    <div class="form-group" style="min-width:200px">
      <label class="form-label">View notes for</label>
      <div style="display:flex; gap:0.5rem; align-items:center">
        <select class="form-select" bind:value={selectedTeamWithNotes}>
          <option value="">-- choose team --</option>
          {#each teamsWithNotes as t}
            <option value={t}>{displayTeam(t)}</option>
          {/each}
        </select>
        <button class="btn btn-secondary" on:click={viewNotesForSelectedTeam} disabled={!selectedTeamWithNotes}>View</button>
      </div>
    </div>
  </div>
</div>

<div class="grid grid-2">
  <div class="card">
    <h3 style="margin-top:0">Scouting Editor</h3>
    {#if selectedMatch}
      <div class="form-group">
        <div class="form-label">Match</div>
        <div><strong>{selectedMatch.match_key?.split('_').pop() || selectedMatch.match_key}</strong></div>
      </div>

      <div class="form-group">
        <label class="form-label">Team</label>
        <select class="form-select" bind:value={selectedTeam}>
          {#each teams as t}
            <option value={t}>{displayTeam(t)}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label">Notes</label>
        <textarea class="form-input" rows="10" bind:value={noteText} placeholder="Enter scouting notes here (plain text)."></textarea>
      </div>

      <div class="page-actions">
        <button class="btn btn-primary" on:click={saveNote} disabled={saving || !selectedTeam}>Save</button>
        <button class="btn btn-outline" on:click={() => { noteText=''; }} disabled={!noteText}>Clear</button>
      </div>
    {:else}
      <div class="empty">Select a match to start</div>
    {/if}
  </div>

  <div class="card">
    <h3 style="margin-top:0">Notes Viewer</h3>
    {#if viewMode === 'view-notes'}
      <div style="margin-bottom:0.5rem">
        <button class="btn btn-secondary" on:click={() => { viewMode = 'editor'; }}>Back</button>
      </div>
      {#if teamNotes.length === 0}
        <div class="empty">No notes for {displayTeam(selectedTeamWithNotes)}</div>
      {/if}
      <div>
        {#each teamNotes as n}
          <div style="border-bottom:1px solid var(--border); padding:0.75rem 0">
            <div style="font-size:0.9rem; color:var(--secondary); font-weight:700">{n.match_number ? ' #' + n.match_number : ''}</div>
            <div style="white-space:pre-wrap; margin-top:0.25rem">{n.notes}</div>
          </div>
        {/each}
      </div>
    {:else}
      <div class="empty">Select a team above and click View to see notes, or save notes for the selected match.</div>
    {/if}
  </div>
</div>

<style>
  .two-col { display:flex; gap:1rem; }
  .matches { width:320px; border:1px solid var(--border); padding:0.5rem; border-radius:8px; background:#fff }
  .editor { flex:1; border:1px solid var(--border); padding:0.5rem; border-radius:8px; background:#fff }
  .empty { color:var(--secondary); padding:0.5rem }
  .viewer-controls { margin-bottom: 0.75rem; }
  .viewer-row { display:flex; gap:0.5rem; align-items:center; }
</style>
