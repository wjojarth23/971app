<script>
  import { onMount } from 'svelte';
  import { supabase, getAuthHeader } from '$lib/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';

  const DRIVEBASE_OPTIONS = ['Mechanum', 'Swerve', 'Tank'];
  const SHOOTER_OPTIONS = ['Single Fixed', 'Multi Fixed', 'Wide', 'Turret', 'Double Turret'];
  const HOPPER_OPTIONS = ['Spindexer', 'Dye Rotor', 'Belted'];
  const HUMAN_PLAYER_AUTO_OPTIONS = ['0-10', '10-20', '20+'];

  let eventKey = '';

  let loading = false;
  let saving = false;
  let uploading = false;
  let apiNote = '';

  let teams = [];
  let entriesByTeam = {};
  let selectedTeam = '';
  let teamFilter = 'pending';

  let drivebase_type = '';
  let shooter_type = '';
  let hopper_type = '';
  let human_player_balls_in_auto = '';
  let editablePhotoPaths = [];
  let pendingFiles = [];
  let photoInputKey = 0;

  function displayTeam(t) {
    return t ? String(t).replace(/^frc/i, '') : '';
  }

  function isComplete(entry) {
    if (!entry) return false;
    return Boolean(
      entry.drivebase_type &&
      entry.shooter_type &&
      entry.hopper_type &&
      entry.human_player_balls_in_auto
    );
  }

  function photoUrl(path) {
    if (!path) return '';
    return supabase.storage.from('pit-scout-photos').getPublicUrl(path)?.data?.publicUrl || '';
  }

  function applyTeamEntry(teamKey) {
    const entry = entriesByTeam[teamKey] || null;
    drivebase_type = entry?.drivebase_type || '';
    shooter_type = entry?.shooter_type || '';
    hopper_type = entry?.hopper_type || '';
    human_player_balls_in_auto = entry?.human_player_balls_in_auto || '';
    editablePhotoPaths = [...(entry?.photo_paths || [])];
    pendingFiles = [];
    photoInputKey += 1;
  }

  function chooseInitialTeam() {
    if (!teams.length) {
      selectedTeam = '';
      return;
    }
    if (selectedTeam && teams.includes(selectedTeam)) {
      applyTeamEntry(selectedTeam);
      return;
    }
    const pending = teams.find((team) => !isComplete(entriesByTeam[team]));
    selectedTeam = pending || teams[0];
    applyTeamEntry(selectedTeam);
  }

  async function authFetch(url, options = {}) {
    const headers = {
      ...(options.headers || {}),
      ...(await getAuthHeader())
    };
    return fetch(url, { ...options, headers });
  }

  async function loadTeams() {
    if (!eventKey) {
      teams = [];
      return;
    }
    const res = await fetch(
      `/api/tba/event-matches?event_key=${encodeURIComponent(eventKey)}&comp_level=qm`
    );
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `Failed to load event teams (${res.status})`);
    }

    const set = new Set();
    for (const match of data.data || []) {
      for (const t of match?.alliances?.red?.team_keys || []) set.add(t);
      for (const t of match?.alliances?.blue?.team_keys || []) set.add(t);
    }

    teams = [...set].sort((a, b) => {
      const an = Number(displayTeam(a));
      const bn = Number(displayTeam(b));
      if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
      return String(a).localeCompare(String(b));
    });
  }

  async function loadEntries() {
    if (!eventKey) {
      entriesByTeam = {};
      return;
    }
    const res = await authFetch(`/pitscout?event_key=${encodeURIComponent(eventKey)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `Failed to load pit entries (${res.status})`);
    }

    const next = {};
    for (const row of data.data || []) {
      if (row?.team_key) next[row.team_key] = row;
    }
    entriesByTeam = next;
  }

  async function loadAll() {
    loading = true;
    apiNote = '';
    try {
      eventKey = (await fetchActiveScoutingEventKey()) || '';
      if (!eventKey) {
        apiNote = 'No event configured.';
      } else {
        await Promise.all([loadTeams(), loadEntries()]);
        chooseInitialTeam();
      }
    } catch (e) {
      apiNote = e.message || 'Load error';
    } finally {
      loading = false;
    }
  }

  function onSelectTeam(teamKey) {
    selectedTeam = teamKey;
    applyTeamEntry(teamKey);
  }

  function sanitizeFileName(name) {
    return String(name || 'photo').replace(/[^A-Za-z0-9._-]/g, '_');
  }

  function onFilesSelected(event) {
    const files = Array.from(event.currentTarget?.files || []);
    const slotsRemaining = Math.max(0, 3 - editablePhotoPaths.length);
    pendingFiles = files.slice(0, slotsRemaining);
  }

  function removeExistingPhoto(path) {
    editablePhotoPaths = editablePhotoPaths.filter((p) => p !== path);
  }

  function removePendingPhoto(idx) {
    pendingFiles = pendingFiles.filter((_, i) => i !== idx);
  }

  async function uploadPendingPhotos(teamKey) {
    if (!pendingFiles.length) return [];

    uploading = true;
    const uploadedPaths = [];
    try {
      for (let i = 0; i < pendingFiles.length; i += 1) {
        const file = pendingFiles[i];
        const fileName = `${Date.now()}-${i}-${sanitizeFileName(file.name)}`;
        const path = `${eventKey}/${teamKey}/${fileName}`;

        const { error } = await supabase.storage
          .from('pit-scout-photos')
          .upload(path, file, { upsert: false, contentType: file.type || 'image/jpeg' });

        if (error) throw new Error(error.message || 'Upload failed');
        uploadedPaths.push(path);
      }
      return uploadedPaths;
    } finally {
      uploading = false;
    }
  }

  async function saveEntry() {
    if (!selectedTeam || !eventKey) return;
    if (!drivebase_type || !shooter_type || !hopper_type || !human_player_balls_in_auto) {
      alert('Please fill all pit scout fields before saving.');
      return;
    }
    if (editablePhotoPaths.length + pendingFiles.length > 3) {
      alert('You can only save up to 3 photos.');
      return;
    }

    saving = true;
    apiNote = '';
    try {
      const uploadedPaths = await uploadPendingPhotos(selectedTeam);
      const photo_paths = [...editablePhotoPaths, ...uploadedPaths].slice(0, 3);
      const payload = {
        action: 'save-entry',
        event_key: eventKey,
        team_key: selectedTeam,
        drivebase_type,
        shooter_type,
        hopper_type,
        human_player_balls_in_auto,
        photo_paths
      };

      const res = await authFetch('/pitscout', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Save failed (${res.status})`);
      }

      entriesByTeam[selectedTeam] = data.data;
      entriesByTeam = { ...entriesByTeam };
      applyTeamEntry(selectedTeam);
      apiNote = `Saved pit data for Team ${displayTeam(selectedTeam)}.`;
    } catch (e) {
      apiNote = e.message || 'Save failed';
    } finally {
      saving = false;
    }
  }

  $: pendingCount = teams.filter((team) => !isComplete(entriesByTeam[team])).length;
  $: completeCount = teams.length - pendingCount;
  $: filteredTeams = teams.filter((team) => {
    if (teamFilter === 'all') return true;
    if (teamFilter === 'complete') return isComplete(entriesByTeam[team]);
    return !isComplete(entriesByTeam[team]);
  });
  $: selectedEntry = selectedTeam ? entriesByTeam[selectedTeam] || null : null;

  onMount(() => {
    loadAll();
  });
</script>

<div class="page-header card">
  <div>
    <h2 style="margin:0">Pit Scouting</h2>
    {#if eventKey}
      <div class="form-label" style="margin-top:0.25rem">Event: {eventKey}</div>
    {/if}
    {#if apiNote}
      <div class="note" style="margin-top:0.5rem">{apiNote}</div>
    {/if}
  </div>
  <div class="page-actions">
    <div class="card" style="padding:0.6rem 0.8rem; min-width:130px;">
      <div class="form-label">Pending</div>
      <div style="font-size:1.4rem; font-weight:700">{pendingCount}</div>
    </div>
    <div class="card" style="padding:0.6rem 0.8rem; min-width:130px;">
      <div class="form-label">Complete</div>
      <div style="font-size:1.4rem; font-weight:700">{completeCount}</div>
    </div>
    <button class="btn btn-secondary" on:click={loadAll} disabled={loading}>Refresh</button>
  </div>
</div>

<div class="grid grid-2">
  <div class="card">
    <h3 style="margin-top:0">Teams</h3>
    <div class="page-actions" style="margin-bottom:0.75rem">
      <button class="btn btn-outline" class:btn-primary={teamFilter === 'pending'} on:click={() => (teamFilter = 'pending')}>Pending</button>
      <button class="btn btn-outline" class:btn-primary={teamFilter === 'complete'} on:click={() => (teamFilter = 'complete')}>Complete</button>
      <button class="btn btn-outline" class:btn-primary={teamFilter === 'all'} on:click={() => (teamFilter = 'all')}>All</button>
    </div>
    {#if loading}
      <div class="empty">Loading teams...</div>
    {:else if !filteredTeams.length}
      <div class="empty">No teams in this filter.</div>
    {:else}
      <div class="team-list">
        {#each filteredTeams as team}
          <button
            class="team-row"
            class:active={team === selectedTeam}
            on:click={() => onSelectTeam(team)}
          >
            <span>Team {displayTeam(team)}</span>
            <span class={isComplete(entriesByTeam[team]) ? 'status-complete' : 'status-pending'}>
              {isComplete(entriesByTeam[team]) ? 'Complete' : 'Pending'}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>

  <div class="card">
    <h3 style="margin-top:0">Pit Entry</h3>
    {#if !selectedTeam}
      <div class="empty">Select a team to enter pit data.</div>
    {:else}
      <div class="form-group">
        <div class="form-label">Team</div>
        <div><strong>{displayTeam(selectedTeam)}</strong></div>
      </div>

      <div class="form-group">
        <label class="form-label" for="drivebaseSelect">Drivebase Type</label>
        <select id="drivebaseSelect" class="form-select" bind:value={drivebase_type}>
          <option value="">-- Select --</option>
          {#each DRIVEBASE_OPTIONS as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="shooterSelect">Shooter Type</label>
        <select id="shooterSelect" class="form-select" bind:value={shooter_type}>
          <option value="">-- Select --</option>
          {#each SHOOTER_OPTIONS as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="hopperSelect">Hopper Type</label>
        <select id="hopperSelect" class="form-select" bind:value={hopper_type}>
          <option value="">-- Select --</option>
          {#each HOPPER_OPTIONS as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="humanPlayerBallsSelect">Human Player Balls In Auto</label>
        <select id="humanPlayerBallsSelect" class="form-select" bind:value={human_player_balls_in_auto}>
          <option value="">-- Select --</option>
          {#each HUMAN_PLAYER_AUTO_OPTIONS as option}
            <option value={option}>{option}</option>
          {/each}
        </select>
      </div>

      <div class="form-group">
        <label class="form-label" for="photoUpload">Pit Photos (up to 3)</label>
        {#key photoInputKey}
          <input
            id="photoUpload"
            type="file"
            class="form-input"
            accept="image/*"
            multiple
            disabled={editablePhotoPaths.length >= 3}
            on:change={onFilesSelected}
          />
        {/key}
        <small class="form-help">{editablePhotoPaths.length + pendingFiles.length}/3 selected</small>
      </div>

      {#if editablePhotoPaths.length}
        <div class="photo-grid">
          {#each editablePhotoPaths as path}
            <div class="photo-item">
              <img src={photoUrl(path)} alt="Pit robot" />
              <button class="btn btn-outline" on:click={() => removeExistingPhoto(path)}>Remove</button>
            </div>
          {/each}
        </div>
      {/if}

      {#if pendingFiles.length}
        <div class="card" style="padding:0.6rem">
          <div class="form-label">Pending Upload</div>
          {#each pendingFiles as file, idx}
            <div class="pending-file-row">
              <span>{file.name}</span>
              <button class="btn btn-outline" on:click={() => removePendingPhoto(idx)}>Remove</button>
            </div>
          {/each}
        </div>
      {/if}

      <div class="page-actions" style="margin-top:0.9rem">
        <button class="btn btn-primary" on:click={saveEntry} disabled={saving || uploading}>
          {#if uploading}
            Uploading...
          {:else if saving}
            Saving...
          {:else}
            Save Pit Entry
          {/if}
        </button>
      </div>
    {/if}
  </div>
</div>

<div class="card" style="margin-top:1rem">
  <h3 style="margin-top:0">Saved Data</h3>
  {#if !selectedEntry}
    <div class="empty">No saved data for Team {displayTeam(selectedTeam)} yet.</div>
  {:else}
    <div class="grid grid-2">
      <div>
        <div><strong>Drivebase:</strong> {selectedEntry.drivebase_type || '-'}</div>
        <div><strong>Shooter:</strong> {selectedEntry.shooter_type || '-'}</div>
        <div><strong>Hopper:</strong> {selectedEntry.hopper_type || '-'}</div>
        <div><strong>HP Balls In Auto:</strong> {selectedEntry.human_player_balls_in_auto || '-'}</div>
      </div>
      <div class="photo-grid">
        {#each selectedEntry.photo_paths || [] as path}
          <div class="photo-item">
            <img src={photoUrl(path)} alt="Pit robot saved" />
          </div>
        {/each}
      </div>
    </div>
  {/if}
</div>

<style>
  .team-list {
    display: grid;
    gap: 0.45rem;
    max-height: 520px;
    overflow: auto;
  }

  .team-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    padding: 0.55rem 0.65rem;
    cursor: pointer;
  }

  .team-row.active {
    border-color: var(--brand-gold-base);
    background: var(--brand-gold-soft);
  }

  .status-pending {
    color: var(--danger);
    font-weight: 600;
    font-size: 0.85rem;
  }

  .status-complete {
    color: var(--success);
    font-weight: 600;
    font-size: 0.85rem;
  }

  .photo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(130px, 1fr));
    gap: 0.6rem;
    margin-top: 0.5rem;
  }

  .photo-item {
    display: grid;
    gap: 0.35rem;
  }

  .photo-item img {
    width: 100%;
    height: 130px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .pending-file-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.5rem;
    padding: 0.35rem 0;
  }

  @media (max-width: 768px) {
    .page-actions {
      width: 100%;
    }

    .page-actions > .card {
      flex: 1 1 140px;
      min-width: 0 !important;
    }

    .team-row {
      gap: 0.75rem;
      flex-wrap: wrap;
      align-items: flex-start;
    }

    .photo-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }
  }

  @media (max-width: 480px) {
    .photo-grid {
      grid-template-columns: 1fr;
    }

    .pending-file-row {
      flex-direction: column;
      align-items: flex-start;
    }
  }
</style>
