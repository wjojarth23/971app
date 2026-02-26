<script>
  import { onMount } from 'svelte';
  import { userStore } from '$lib/stores/auth.js';
  import { getAuthHeader } from '$lib/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';

  let user;
  userStore.subscribe((v) => (user = v));

  export let scoutingType = 'data'; // 'data' | 'note'

  let panelOpen = false;
  let matches = []; // { key, red:[], blue:[] }
  let eventKey = '';
  let assignments = {}; // match_key -> team_key -> { user_id, user_name }
  let users = []; // eligible assignees
  let loading = false;
  let saving = false;
  let errorMsg = '';

  let capabilities = {
    can_view: true,
    can_edit: false,
    can_be_assigned: false,
    roster_keys: []
  };

  let showModal = false;
  let modalContext = { match_key: '', team_key: '', team_number: '' };
  let selectedUserId = '';
  let lastUserId = null;

  async function authFetch(url, options = {}) {
    const headers = {
      ...(options.headers || {}),
      ...(await getAuthHeader())
    };
    return fetch(url, { ...options, headers });
  }

  function displayTeam(t) {
    return t ? String(t).replace(/^frc/i, '') : '';
  }

  async function loadCapabilities() {
    try {
      const qs = new URLSearchParams({ scouting_type: scoutingType, capabilities: '1' });
      const res = await authFetch(`/api/scout-assignments?${qs}`);
      const data = await res.json();
      if (data?.success && data?.data) {
        capabilities = { ...capabilities, ...data.data };
      }
    } catch {
      capabilities = { ...capabilities, can_edit: false };
    }
  }

  async function loadEligibleUsers() {
    if (!capabilities.can_edit) {
      users = [];
      return;
    }

    try {
      const qs = new URLSearchParams({ scouting_type: scoutingType, eligible: '1' });
      const res = await authFetch(`/api/scout-assignments?${qs}`);
      const data = await res.json();
      if (data?.success) {
        users = data.data || [];
      }
    } catch {
      users = [];
    }
  }

  async function loadMatches() {
    eventKey = (await fetchActiveScoutingEventKey()) || '';
    if (!eventKey) {
      errorMsg = 'No event configured';
      return;
    }

    try {
      loading = true;
      errorMsg = '';
      const res = await fetch(
        `/api/tba/event-matches?event_key=${encodeURIComponent(eventKey)}&comp_level=qm`
      );

      let data;
      try {
        data = await res.json();
      } catch {
        const text = await res.text();
        errorMsg = `Non-JSON response (${res.status}): ${text.slice(0, 100)}`;
        return;
      }

      if (!data?.success) {
        errorMsg = data?.error || 'Failed to load matches';
        return;
      }

      matches = (data.data || []).map((m) => ({
        key: m.key,
        match_number: m.match_number,
        red: m.alliances?.red?.team_keys || [],
        blue: m.alliances?.blue?.team_keys || []
      }));
    } catch (e) {
      errorMsg = e.message || 'Load error';
    } finally {
      loading = false;
    }
  }

  async function loadAssignments() {
    try {
      const qs = new URLSearchParams({ scouting_type: scoutingType });
      const res = await authFetch(`/api/scout-assignments?${qs}`);
      const data = await res.json();
      if (!data?.success) return;

      assignments = {};
      for (const row of data.data || []) {
        if (!assignments[row.match_key]) assignments[row.match_key] = {};
        assignments[row.match_key][row.team_key] = {
          user_id: row.assigned_user,
          user_name: row.user_name
        };
      }
    } catch {
      assignments = {};
    }
  }

  function openAssign(match_key, team_key) {
    if (!capabilities.can_edit) return;
    modalContext = { match_key, team_key, team_number: displayTeam(team_key) };
    selectedUserId = assignments?.[match_key]?.[team_key]?.user_id || '';
    showModal = true;
  }

  async function saveAssignment(applyToAll = false) {
    if (!selectedUserId || !capabilities.can_edit) return;
    saving = true;

    try {
      if (applyToAll) {
        const team_key = modalContext.team_key;
        const items = [];

        for (const m of matches) {
          if ((m.blue || []).includes(team_key) || (m.red || []).includes(team_key)) {
            items.push({ match_key: m.key, team_key, user_id: selectedUserId });
          }
        }

        if (items.length === 0) {
          alert('No matches found for that robot');
        } else {
          const body = { action: 'bulk-assign', scouting_type: scoutingType, items };
          const res = await authFetch('/api/scout-assignments', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body)
          });
          const data = await res.json();
          if (!data?.success) {
            alert(`Save failed: ${data?.error || 'unknown'}`);
          } else {
            await loadAssignments();
            showModal = false;
          }
        }
      } else {
        const body = {
          action: 'assign-single',
          scouting_type: scoutingType,
          match_key: modalContext.match_key,
          team_key: modalContext.team_key,
          user_id: selectedUserId
        };

        const res = await authFetch('/api/scout-assignments', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        const data = await res.json();
        if (!data?.success) {
          alert(`Save failed: ${data?.error || 'unknown'}`);
        } else {
          await loadAssignments();
          showModal = false;
        }
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    } finally {
      saving = false;
    }
  }

  function randomize() {
    if (!capabilities.can_edit) return;

    const eligible = [...users];
    if (eligible.length === 0) return;

    const newAssignments = {};
    for (const m of matches) {
      const usedInMatch = new Set();
      const teams = [...m.blue, ...m.red];
      for (const t of teams) {
        const shuffled = [...eligible].sort(() => Math.random() - 0.5);
        const u = shuffled.find((x) => !usedInMatch.has(x.id));
        const chosen = u || shuffled[0];
        usedInMatch.add(chosen.id);

        if (!newAssignments[m.key]) newAssignments[m.key] = {};
        newAssignments[m.key][t] = {
          user_id: chosen.id,
          user_name: chosen.full_name || chosen.email
        };
      }
    }

    bulkPersist(newAssignments);
  }

  async function bulkPersist(map) {
    try {
      const list = [];
      for (const mk of Object.keys(map)) {
        for (const tk of Object.keys(map[mk])) {
          list.push({ match_key: mk, team_key: tk, user_id: map[mk][tk].user_id });
        }
      }

      const body = { action: 'bulk-assign', scouting_type: scoutingType, items: list };
      const res = await authFetch('/api/scout-assignments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body)
      });

      const data = await res.json();
      if (!data?.success) {
        alert(`Bulk save failed: ${data?.error || 'unknown'}`);
      } else {
        await loadAssignments();
      }
    } catch (e) {
      alert(`Error: ${e.message}`);
    }
  }

  async function refreshAll() {
    await loadCapabilities();
    await Promise.all([loadMatches(), loadAssignments()]);
    await loadEligibleUsers();
  }

  onMount(() => {
    refreshAll();
  });

  $: if (user?.id && user.id !== lastUserId) {
    lastUserId = user.id;
    refreshAll();
  }
</script>

<details class="assignment-accordion" bind:open={panelOpen}>
  <summary class="summary-row">
    <div class="summary-title">
      {scoutingType === 'note' ? 'Note' : 'Data'} Scouting Assignments
    </div>
    <div class="summary-meta">
      <span class="mode-pill" class:editable={capabilities.can_edit}>
        {capabilities.can_edit ? 'Lead edit mode' : 'View only'}
      </span>
    </div>
  </summary>

  <div class="panel-body">
    <div class="panel-header">
      <div class="hint">
        {#if capabilities.can_edit}
          Click a team cell to reassign. "Set for Robot" applies assignment to all that team's matches.
        {:else}
          Assignments are read-only unless you are a scouting lead in Roster Studio.
        {/if}
      </div>
      <div class="actions">
        {#if capabilities.can_edit}
          <button class="btn btn-secondary" on:click={randomize} disabled={matches.length === 0 || users.length === 0}>Randomize</button>
        {/if}
        <button class="btn btn-outline" on:click={refreshAll} disabled={loading}>Refresh</button>
      </div>
    </div>

    {#if errorMsg}
      <div class="error-note">{errorMsg}</div>
    {/if}

    <div class="scroll-x">
      <table class="assignment-table">
        <thead>
          <tr>
            <th colspan="3" class="alliance blue">Blue Alliance</th>
            <th colspan="3" class="alliance red">Red Alliance</th>
          </tr>
          <tr>
            {#each [1, 2, 3] as i}<th class="blue">B{i}</th>{/each}
            {#each [1, 2, 3] as i}<th class="red">R{i}</th>{/each}
          </tr>
        </thead>
        <tbody>
          {#each matches as m}
            <tr>
              {#each m.blue as t}
                <td class="cell blue" class:editable-cell={capabilities.can_edit} on:click={() => openAssign(m.key, t)}>
                  <div class="team">{displayTeam(t)}</div>
                  <div class="scout">{assignments?.[m.key]?.[t]?.user_name || '-'}</div>
                </td>
              {/each}
              {#each m.red as t}
                <td class="cell red" class:editable-cell={capabilities.can_edit} on:click={() => openAssign(m.key, t)}>
                  <div class="team">{displayTeam(t)}</div>
                  <div class="scout">{assignments?.[m.key]?.[t]?.user_name || '-'}</div>
                </td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  </div>
</details>

{#if showModal}
  <div
    class="modal-backdrop"
    role="button"
    tabindex="0"
    aria-label="Close assignment dialog"
    on:click|self={() => {
      if (!saving) showModal = false;
    }}
    on:keydown={(e) => {
      if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        if (!saving) showModal = false;
      }
    }}
  >
    <div class="modal" style="--modal-width: 360px;">
      <h4>Assign Scout - {modalContext.team_number}</h4>
      <select class="form-select" bind:value={selectedUserId} disabled={saving}>
        <option value="">-- choose user --</option>
        {#each users as u}
          <option value={u.id}>{u.full_name || u.email}</option>
        {/each}
      </select>
      <div class="btn-row modal-actions">
        <button class="btn btn-primary" disabled={!selectedUserId || saving} on:click={() => saveAssignment(false)}>Set for this Match</button>
        <button class="btn btn-secondary" disabled={!selectedUserId || saving} on:click={() => saveAssignment(true)}>Set for Robot</button>
        <button class="btn btn-outline" on:click={() => {
          if (!saving) showModal = false;
        }}>Close</button>
      </div>
    </div>
  </div>
{/if}

<style>
  .assignment-accordion {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    overflow: hidden;
  }

  .summary-row {
    list-style: none;
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--gap-2);
    cursor: pointer;
    padding: var(--space-3) var(--space-4);
    font-weight: 600;
  }

  .assignment-accordion[open] .summary-row {
    border-bottom: 1px solid var(--border);
  }

  .summary-row::-webkit-details-marker {
    display: none;
  }

  .summary-title {
    font-size: var(--font-base);
  }

  .summary-meta {
    display: flex;
    align-items: center;
  }

  .mode-pill {
    font-size: var(--font-xs);
    border: 1px solid var(--border);
    border-radius: var(--radius-full);
    padding: var(--space-1) var(--space-2);
    color: var(--text-muted);
    background: var(--surface-2);
  }

  .mode-pill.editable {
    color: var(--green-strong);
    border-color: var(--green-strong);
    background: var(--green-soft);
  }

  .panel-body {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }

  .panel-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--gap-2);
    flex-wrap: wrap;
  }

  .hint {
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .error-note {
    border-radius: var(--radius-sm);
    border: 1px solid var(--red-base);
    background: var(--red-soft);
    color: var(--red-strong);
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-xs);
    line-height: 1.4;
  }

  .actions {
    display: flex;
    gap: var(--gap-2);
  }

  .assignment-table {
    border-collapse: separate;
    border-spacing: 2px;
    width: 100%;
  }

  .assignment-table th,
  .assignment-table td {
    padding: var(--space-1) var(--space-2);
    font-size: var(--font-xs);
    text-align: center;
    background: var(--color-white);
    border: 1px solid var(--border);
    min-width: 70px;
  }

  .assignment-table th.alliance {
    font-size: var(--font-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .assignment-table .blue {
    background: var(--blue-soft);
  }

  .assignment-table .red {
    background: var(--red-soft);
  }

  .assignment-table .team {
    font-weight: 700;
  }

  .assignment-table .scout {
    font-size: var(--font-xs);
    margin-top: var(--space-1);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 100px;
  }

  .editable-cell {
    cursor: pointer;
    transition: background 0.15s ease;
  }

  .editable-cell:hover {
    filter: brightness(0.95);
  }

  .scroll-x {
    overflow-x: auto;
  }

  .modal-actions {
    margin-top: var(--space-3);
  }

  @media (max-width: 768px) {
    .summary-row {
      padding: var(--space-2) var(--space-3);
    }

    .panel-body {
      padding: var(--space-3);
    }

    .assignment-table th,
    .assignment-table td {
      min-width: 56px;
    }
  }
</style>
