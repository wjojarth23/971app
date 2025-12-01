<script>
  import { onMount } from 'svelte';
  import { supabase, getAuthHeader } from '$lib/supabase.js';
  import { hasPermission } from '$lib/permissions.js';
  import { userStore } from '$lib/stores/auth.js';
  import notescoutConfig from '$lib/notescout.json';
  import ScoutAssignmentPanel from '$lib/components/ScoutAssignmentPanel.svelte';
  let user;
  userStore.subscribe((v) => (user = v));

  // Reactive permission gate for assignment panel (explicit perm; admin does not auto-bypass)
  $: canSeeNoteAssignments = !!user && Array.isArray(user.permissions) && user.permissions.includes('NOTE_SCOUT_ADMIN');
  // Debug (reactive; logs when values change)
  $: if (typeof window !== 'undefined') {
    console.log('[notescout]', { permissions: user?.permissions, role: user?.role, canSeeNoteAssignments });
  }

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
  // assignment awareness
  let myAssignments = [];
  let nextAssignment = null;
  async function loadMyAssignments(){
    if(!user?.id) return;
    try{
      const res = await fetch(`/api/scout-assignments?scouting_type=note&mine=1&user_id=${encodeURIComponent(user.id)}`, {
        headers: await getAuthHeader()
      });
      const js = await res.json();
      if(js?.success){ myAssignments = (js.data||[]).filter(r=> !r.completed_at); nextAssignment = myAssignments[0]||null; }
    }catch(e){ /* ignore */ }
  }
  function gotoNextAssignment(){ if(!nextAssignment) return; selectedMatchKey = nextAssignment.match_key; onSelectMatchByKey(); selectedTeam = nextAssignment.team_key; }

  function displayTeam(t) {
    if (!t) return '';
    return String(t).replace(/^frc/i, '');
  }

  // Load qualification matches via server proxy to The Blue Alliance
  async function loadMatches() {
    apiNote = '';
    if (!notescoutConfig?.event_key) {
      apiNote = 'No event configured for Note Scouting.';
      matches = [];
      return;
    }
    try {
      const res = await fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(notescoutConfig.event_key)}&comp_level=qm`);
      let data;
      try { data = await res.json(); } catch(parseErr){
        const text = await res.text();
        apiNote = 'Non-JSON response from server (status '+res.status+'): '+ text.slice(0,120);
        matches=[]; return;
      }
      if (!data?.success) {
        apiNote = data?.error || 'Failed to load matches';
        matches = [];
        return;
      }
      matches = (data.data || []).map(m => ({
        match_key: m.key,
        match_number: m.match_number,
        red_team_keys: m.alliances?.red?.team_keys || [],
        blue_team_keys: m.alliances?.blue?.team_keys || []
      }));
    } catch (e) { apiNote = e.message || 'Failed to load matches'; matches = []; }
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

  onMount(() => { loadMatches(); loadTeamsWithNotes(); loadMyAssignments(); });
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
    {#if nextAssignment}
      <div class="form-group" style="min-width:140px">
        <div class="form-label">Next Up</div>
        <button class="btn btn-primary" style="width:100%" on:click={gotoNextAssignment}>Match {nextAssignment.match_key.split('_').pop()}</button>
      </div>
    {/if}
    <div class="form-group" style="min-width:220px">
      <label class="form-label" for="matchSelect">Match</label>
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
      <label class="form-label" for="notesTeamSelect">View notes for</label>
      <div style="display:flex; gap:0.5rem; align-items:center">
        <select class="form-select" id="notesTeamSelect" bind:value={selectedTeamWithNotes}>
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
  <label class="form-label" for="teamSelect">Team</label>
  <select id="teamSelect" class="form-select" bind:value={selectedTeam}>
          {#each teams as t}
            <option value={t}>{displayTeam(t)}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
  <label class="form-label" for="notesArea">Notes</label>
  <textarea id="notesArea" class="form-input" rows="10" bind:value={noteText} placeholder="Enter scouting notes here (plain text)."></textarea>
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

{#if canSeeNoteAssignments}
  <ScoutAssignmentPanel scoutingType="note" permissionAdmin="NOTE_SCOUT_ADMIN" memberPerm="DATA_SCOUT_MEMBER" />
{/if}

<style>
  /* Uses global .empty */
  
  /* Mobile Responsive Styles */
  @media (max-width: 768px) {
    .page-header.card {
      flex-direction: column;
      gap: var(--gap-3);
    }
    
    .page-actions {
      flex-direction: column;
      width: 100%;
    }
    
    .page-actions .form-group {
      min-width: unset !important;
      width: 100%;
    }
    
    .grid.grid-2 {
      grid-template-columns: 1fr;
    }
    
    :global(.form-input[rows]),
    textarea.form-input {
      min-height: 150px;
    }
  }
  
  @media (max-width: 480px) {
    .page-header h2 {
      font-size: 1.25rem;
    }
    
    .page-actions {
      gap: var(--gap-2);
    }
    
    .page-actions .form-group div {
      flex-direction: column;
      gap: var(--gap-2) !important;
    }
    
    .page-actions .form-group div .btn {
      width: 100%;
    }
  }
</style>
