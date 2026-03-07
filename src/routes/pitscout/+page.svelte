<script>
  import { onMount } from 'svelte';
  import { supabase, getAuthHeader } from '$lib/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';

  const DRIVEBASE_OPTIONS = ['Mechanum', 'Swerve', 'Tank'];
  const SHOOTER_OPTIONS = ['Single Fixed', 'Multi Fixed', 'Wide', 'Turret', 'Double Turret'];
  const HOPPER_OPTIONS = ['Spindexer', 'Dye Rotor', 'Belted'];
  const HUMAN_PLAYER_AUTO_OPTIONS = ['0-10', '10-20', '20+'];
  const NO_CLIMB_OPTION = 'No Climb';
  const CLIMB_OPTIONS = [NO_CLIMB_OPTION, 'L1 Auto', 'L1', 'L2', 'L3'];
  const MAX_AUTO_OPTIONS = 8;
  const MAX_AUTO_NAME_LENGTH = 60;
  const MAX_AUTO_DESCRIPTION_LENGTH = 220;
  const MAX_BREAKING_COMPONENT_LENGTH = 240;

  let eventKey = '';

  let loading = false;
  let saving = false;
  let uploading = false;
  let apiNote = '';

  let teams = [];
  let entriesByTeam = {};
  let selectedTeam = '';
  let teamSearch = '';

  let drivebase_type = '';
  let shooter_type = '';
  let hopper_type = '';
  let human_player_balls_in_auto = '';
  let pitSchema = {
    likely_breaking_component: true,
    estimated_bps: true,
    climb_options: true,
    auto_options: true
  };
  let schemaWarning = '';
  let likely_breaking_component = '';
  let estimated_bps = undefined;
  let climb_options = [];
  let autoOptions = [];
  let editablePhotoPaths = [];
  let pendingFiles = [];
  let photoInputKey = 0;
  let photoInput;
  let prefersCameraCapture = false;

  function normalizeAutoOptions(input) {
    if (!Array.isArray(input)) return [];
    return input.slice(0, MAX_AUTO_OPTIONS).map((option) => ({
      name: String(option?.name || '').trim().slice(0, MAX_AUTO_NAME_LENGTH),
      description: String(option?.description || '').trim().slice(0, MAX_AUTO_DESCRIPTION_LENGTH)
    }));
  }

  function getFilledAutoOptions(input) {
    return normalizeAutoOptions(input).filter((option) => option.name || option.description);
  }

  function normalizeClimbOptions(input) {
    if (!Array.isArray(input)) return [];
    const selected = new Set(
      input
        .map((option) => String(option || '').trim())
        .filter((option) => CLIMB_OPTIONS.includes(option))
    );
    if (selected.has(NO_CLIMB_OPTION)) return [NO_CLIMB_OPTION];
    return CLIMB_OPTIONS.filter((option) => option !== NO_CLIMB_OPTION && selected.has(option));
  }

  function setClimbOption(option, checked) {
    if (option === NO_CLIMB_OPTION) {
      climb_options = checked ? [NO_CLIMB_OPTION] : [];
      return;
    }

    const selected = new Set(normalizeClimbOptions(climb_options));
    selected.delete(NO_CLIMB_OPTION);
    if (checked) selected.add(option);
    else selected.delete(option);
    climb_options = CLIMB_OPTIONS.filter((value) => value !== NO_CLIMB_OPTION && selected.has(value));
  }

  function normalizeLikelyBreakingComponent(value) {
    return String(value || '').trim().slice(0, MAX_BREAKING_COMPONENT_LENGTH);
  }

  function hasEstimatedBps(value) {
    return value !== '' && value !== null && value !== undefined && Number.isFinite(Number(value));
  }

  function displayTeam(teamKey) {
    return teamKey ? String(teamKey).replace(/^frc/i, '') : '';
  }

  function teamSort(a, b) {
    const an = Number(displayTeam(a));
    const bn = Number(displayTeam(b));
    if (!Number.isNaN(an) && !Number.isNaN(bn)) return an - bn;
    return String(a).localeCompare(String(b));
  }

  function teamListSort(a, b) {
    const aComplete = isComplete(entriesByTeam[a]);
    const bComplete = isComplete(entriesByTeam[b]);
    if (aComplete !== bComplete) return aComplete ? 1 : -1;
    return teamSort(a, b);
  }

  function isComplete(entry) {
    if (!entry) return false;
    return Boolean(
      entry.drivebase_type &&
      entry.shooter_type &&
      entry.hopper_type &&
      entry.human_player_balls_in_auto &&
      (!pitSchema.likely_breaking_component || normalizeLikelyBreakingComponent(entry.likely_breaking_component)) &&
      (!pitSchema.estimated_bps || hasEstimatedBps(entry.estimated_bps)) &&
      (!pitSchema.climb_options || normalizeClimbOptions(entry.climb_options).length)
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
    likely_breaking_component = entry?.likely_breaking_component || '';
    estimated_bps = hasEstimatedBps(entry?.estimated_bps) ? Number(entry.estimated_bps) : undefined;
    climb_options = normalizeClimbOptions(entry?.climb_options || []);
    autoOptions = normalizeAutoOptions(entry?.auto_options || []);
    editablePhotoPaths = [...(entry?.photo_paths || [])];
    pendingFiles = [];
    photoInputKey += 1;
  }

  function syncSelectedTeam() {
    if (!teams.length) {
      selectedTeam = '';
      return;
    }

    if (selectedTeam && teams.includes(selectedTeam)) {
      applyTeamEntry(selectedTeam);
      return;
    }

    selectedTeam = '';
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
      return [];
    }

    const [eventTeamsRes, eventMatchesRes] = await Promise.all([
      fetch(`/api/tba/event-teams?event_key=${encodeURIComponent(eventKey)}`).catch(() => null),
      fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(eventKey)}&comp_level=qm`).catch(() => null)
    ]);

    const [eventTeamsData, eventMatchesData] = await Promise.all([
      eventTeamsRes?.json().catch(() => null),
      eventMatchesRes?.json().catch(() => null)
    ]);

    const set = new Set();

    for (const row of eventTeamsData?.success ? eventTeamsData.data || [] : []) {
      if (row?.key) set.add(row.key);
    }

    for (const match of eventMatchesData?.success ? eventMatchesData.data || [] : []) {
      for (const teamKey of match?.alliances?.red?.team_keys || []) set.add(teamKey);
      for (const teamKey of match?.alliances?.blue?.team_keys || []) set.add(teamKey);
    }

    if (!set.size && !eventTeamsData?.success && !eventMatchesData?.success) {
      const error = eventTeamsData?.error || eventMatchesData?.error || 'Failed to load event teams.';
      throw new Error(error);
    }

    return [...set].sort(teamSort);
  }

  async function loadEntries() {
    if (!eventKey) {
      entriesByTeam = {};
      return {};
    }

    const res = await authFetch(`/pitscout?event_key=${encodeURIComponent(eventKey)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success) {
      throw new Error(data?.error || `Failed to load pit entries (${res.status})`);
    }

    pitSchema = {
      ...pitSchema,
      ...(data?.meta?.schema || {})
    };
    schemaWarning = data?.meta?.warning || '';

    const next = {};
    for (const row of data.data || []) {
      if (row?.team_key) next[row.team_key] = row;
    }
    entriesByTeam = next;
    return next;
  }

  async function loadAll() {
    loading = true;
    apiNote = '';

    try {
      eventKey = (await fetchActiveScoutingEventKey()) || '';
      if (!eventKey) {
        teams = [];
        entriesByTeam = {};
        selectedTeam = '';
        schemaWarning = '';
        apiNote = 'No event configured.';
        return;
      }

      const [loadedTeams, loadedEntries] = await Promise.all([loadTeams(), loadEntries()]);
      teams = [...new Set([...loadedTeams, ...Object.keys(loadedEntries)])].sort(teamSort);
      syncSelectedTeam();
    } catch (e) {
      apiNote = e.message || 'Load error';
    } finally {
      loading = false;
    }
  }

  function scrollToTop() {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  function openEntry(teamKey) {
    if (!teamKey) return;
    selectedTeam = teamKey;
    teamSearch = '';
    applyTeamEntry(teamKey);
    scrollToTop();
  }

  function goToTeamPicker() {
    selectedTeam = '';
    teamSearch = '';
    scrollToTop();
  }

  function handleTeamSearchInput(event) {
    const digitsOnly = String(event.currentTarget?.value || '').replace(/\D/g, '').slice(0, 6);
    teamSearch = digitsOnly;

    if (!digitsOnly) return;

    const exactMatch = teams.find((teamKey) => displayTeam(teamKey) === digitsOnly);
    if (exactMatch) openEntry(exactMatch);
  }

  function sanitizeFileName(name) {
    return String(name || 'photo').replace(/[^A-Za-z0-9._-]/g, '_');
  }

  function openPhotoPicker() {
    if (!photoSlotsRemaining) return;
    photoInput?.click();
  }

  function onFilesSelected(event) {
    const files = Array.from(event.currentTarget?.files || []);
    const slotsRemaining = Math.max(0, 3 - editablePhotoPaths.length - pendingFiles.length);

    if (!files.length || !slotsRemaining) {
      photoInputKey += 1;
      return;
    }

    pendingFiles = [...pendingFiles, ...files.slice(0, slotsRemaining)];
    photoInputKey += 1;
  }

  function removeExistingPhoto(path) {
    editablePhotoPaths = editablePhotoPaths.filter((photoPath) => photoPath !== path);
  }

  function removePendingPhoto(idx) {
    pendingFiles = pendingFiles.filter((_, i) => i !== idx);
  }

  function addAutoOption() {
    if (autoOptions.length >= MAX_AUTO_OPTIONS) return;
    autoOptions = [...autoOptions, { name: '', description: '' }];
  }

  function updateAutoOption(idx, field, value) {
    autoOptions = autoOptions.map((option, i) => (
      i === idx
        ? {
            ...option,
            [field]: String(value || '').slice(
              0,
              field === 'name' ? MAX_AUTO_NAME_LENGTH : MAX_AUTO_DESCRIPTION_LENGTH
            )
          }
        : option
    ));
  }

  function removeAutoOption(idx) {
    autoOptions = autoOptions.filter((_, i) => i !== idx);
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

    const normalizedLikelyBreakingComponent = normalizeLikelyBreakingComponent(likely_breaking_component);
    const normalizedEstimatedBps = hasEstimatedBps(estimated_bps) ? Math.round(Number(estimated_bps) * 100) / 100 : null;
    const normalizedClimbOptions = normalizeClimbOptions(climb_options);

    const normalizedAutoOptions = getFilledAutoOptions(autoOptions);
    if (normalizedAutoOptions.some((option) => !option.name || !option.description)) {
      alert('Each auto option needs both a name and description.');
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
        ...(pitSchema.likely_breaking_component
          ? { likely_breaking_component: normalizedLikelyBreakingComponent }
          : {}),
        ...(pitSchema.estimated_bps ? { estimated_bps: normalizedEstimatedBps } : {}),
        ...(pitSchema.climb_options ? { climb_options: normalizedClimbOptions } : {}),
        ...(pitSchema.auto_options ? { auto_options: normalizedAutoOptions } : {}),
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

      pitSchema = {
        ...pitSchema,
        ...(data?.meta?.schema || {})
      };
      schemaWarning = data?.meta?.warning || schemaWarning;
      entriesByTeam[selectedTeam] = data.data;
      entriesByTeam = { ...entriesByTeam };
      apiNote = `Saved pit data for Team ${displayTeam(selectedTeam)}.`;
      goToTeamPicker();
    } catch (e) {
      apiNote = e.message || 'Save failed';
    } finally {
      saving = false;
    }
  }

  function detectCameraCapturePreference() {
    if (typeof navigator === 'undefined') return false;
    const mobileUserAgent = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent || ''
    );
    return Boolean(navigator.userAgentData?.mobile || mobileUserAgent);
  }

  $: pendingCount = teams.filter((teamKey) => !isComplete(entriesByTeam[teamKey])).length;
  $: completeCount = teams.length - pendingCount;
  $: filteredTeams = teams
    .filter((teamKey) => !teamSearch || displayTeam(teamKey).includes(teamSearch))
    .sort(teamListSort);
  $: selectedEntry = selectedTeam ? entriesByTeam[selectedTeam] || null : null;
  $: photoSlotsRemaining = Math.max(0, 3 - editablePhotoPaths.length - pendingFiles.length);
  $: photoButtonLabel = prefersCameraCapture ? 'Take Photo' : 'Add Photos';

  onMount(() => {
    prefersCameraCapture = detectCameraCapturePreference();
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
    {#if schemaWarning}
      <div class="note" style="margin-top:0.5rem">{schemaWarning}</div>
    {/if}
  </div>

  <div class="page-summary">
    <div class="summary-pill">
      <span>Pending</span>
      <strong>{pendingCount}</strong>
    </div>
    <div class="summary-pill">
      <span>Complete</span>
      <strong>{completeCount}</strong>
    </div>
    <button class="btn btn-secondary" type="button" on:click={loadAll} disabled={loading}>
      Refresh
    </button>
  </div>
</div>

{#if !selectedTeam}
  <div class="card picker-card">
    <div class="form-group" style="margin-bottom:0">
      <label class="form-label" for="teamSearch">Team</label>
      <input
        id="teamSearch"
        class="form-input team-search"
        type="text"
        inputmode="numeric"
        pattern="[0-9]*"
        autocomplete="off"
        enterkeyhint="go"
        placeholder="Type team number"
        value={teamSearch}
        on:input={handleTeamSearchInput}
      />
    </div>

    {#if loading}
      <div class="empty">Loading teams...</div>
    {:else if !teams.length}
      <div class="empty">No teams loaded for this event.</div>
    {:else if !filteredTeams.length}
      <div class="empty">No teams match Team {teamSearch}.</div>
    {:else}
      <div class="team-list">
        {#each filteredTeams as teamKey}
          <button class="team-row" type="button" on:click={() => openEntry(teamKey)}>
            <span class="team-row-main">Team {displayTeam(teamKey)}</span>
            <span class={isComplete(entriesByTeam[teamKey]) ? 'status-complete' : 'status-pending'}>
              {isComplete(entriesByTeam[teamKey]) ? 'Complete' : 'Pending'}
            </span>
          </button>
        {/each}
      </div>
    {/if}
  </div>
{:else}
  <form class="card entry-card" on:submit|preventDefault={saveEntry}>
    <div class="entry-header">
      <button class="btn btn-secondary" type="button" on:click={goToTeamPicker}>Back</button>

      <div>
        <h3 style="margin:0">Team {displayTeam(selectedTeam)}</h3>
        <div class="entry-subtitle">
          {#if selectedEntry}
            Existing pit entry loaded. Submitting again will update it.
          {:else}
            New pit entry.
          {/if}
        </div>
      </div>
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

    {#if pitSchema.estimated_bps}
      <div class="form-group">
        <label class="form-label" for="estimatedBpsInput">Estimated BPS</label>
        <input
          id="estimatedBpsInput"
          class="form-input"
          type="number"
          min="0"
          step="0.1"
          bind:value={estimated_bps}
          placeholder="e.g. 2.4"
        />
      </div>
    {/if}

    {#if pitSchema.likely_breaking_component}
      <div class="form-group">
        <label class="form-label" for="likelyBreakingComponentInput">What is most likely to break on the robot?</label>
        <textarea
          id="likelyBreakingComponentInput"
          class="form-input break-risk-input"
          rows="3"
          maxlength={MAX_BREAKING_COMPONENT_LENGTH}
          bind:value={likely_breaking_component}
          placeholder="Describe the most likely failure point"
        />
      </div>
    {/if}

    {#if pitSchema.climb_options}
      <div class="form-group">
        <label class="form-label">Climb Options</label>
        <div class="climb-options-grid">
          {#each CLIMB_OPTIONS as option}
            <label class="form-checkbox climb-option">
              <input
                type="checkbox"
                checked={climb_options.includes(option)}
                disabled={option !== NO_CLIMB_OPTION && climb_options.includes(NO_CLIMB_OPTION)}
                on:change={(event) => setClimbOption(option, event.currentTarget.checked)}
              />
              <span>{option}</span>
            </label>
          {/each}
        </div>
        <small class="form-help">{climb_options.length}/{CLIMB_OPTIONS.length} selected</small>
      </div>
    {/if}

    {#if pitSchema.auto_options}
      <div class="form-group">
        <div class="auto-options-header">
          <label class="form-label">Auto Options</label>
          <button
            class="btn btn-outline"
            type="button"
            on:click={addAutoOption}
            disabled={autoOptions.length >= MAX_AUTO_OPTIONS}
          >
            Add Auto
          </button>
        </div>
        <small class="form-help">{autoOptions.length}/{MAX_AUTO_OPTIONS} autos listed</small>

        {#if !autoOptions.length}
          <div class="auto-options-empty">No named auto options added.</div>
        {:else}
          <div class="auto-option-editor-list">
            {#each autoOptions as option, idx}
              <div class="card auto-option-editor">
                <div class="auto-option-editor-header">
                  <strong>Auto {idx + 1}</strong>
                  <button class="btn btn-outline" type="button" on:click={() => removeAutoOption(idx)}>
                    Remove
                  </button>
                </div>

                <input
                  class="form-input"
                  type="text"
                  maxlength={MAX_AUTO_NAME_LENGTH}
                  placeholder="Auto name"
                  value={option.name}
                  on:input={(event) => updateAutoOption(idx, 'name', event.currentTarget.value)}
                />

                <textarea
                  class="form-input auto-option-description"
                  rows="3"
                  maxlength={MAX_AUTO_DESCRIPTION_LENGTH}
                  placeholder="Short description of the path, starting spot, and scoring plan"
                  value={option.description}
                  on:input={(event) => updateAutoOption(idx, 'description', event.currentTarget.value)}
                />
              </div>
            {/each}
          </div>
        {/if}
      </div>
    {/if}

    <div class="form-group">
      <div class="photo-header">
        <label class="form-label" for="photoUpload">Pit Photos (up to 3)</label>
        <button
          class="btn btn-outline"
          type="button"
          on:click={openPhotoPicker}
          disabled={!photoSlotsRemaining || saving || uploading}
        >
          {photoButtonLabel}
        </button>
      </div>

      {#key photoInputKey}
        <input
          bind:this={photoInput}
          id="photoUpload"
          type="file"
          class="visually-hidden"
          accept="image/*"
          multiple={!prefersCameraCapture}
          capture={prefersCameraCapture ? 'environment' : undefined}
          disabled={!photoSlotsRemaining}
          on:change={onFilesSelected}
        />
      {/key}

      <small class="form-help">{editablePhotoPaths.length + pendingFiles.length}/3 selected</small>
      {#if prefersCameraCapture && photoSlotsRemaining > 0}
        <small class="form-help">Tap the button again to add the next photo.</small>
      {/if}
    </div>

    {#if editablePhotoPaths.length || pendingFiles.length}
      <div class="photo-grid">
        {#each editablePhotoPaths as path}
          <div class="photo-item">
            <img src={photoUrl(path)} alt="Pit robot" />
            <button class="btn btn-outline" type="button" on:click={() => removeExistingPhoto(path)}>
              Remove
            </button>
          </div>
        {/each}

        {#each pendingFiles as file, idx}
          <div class="pending-file-card">
            <div class="form-label">Ready to upload</div>
            <div class="pending-file-name">{file.name || `Photo ${idx + 1}`}</div>
            <button class="btn btn-outline" type="button" on:click={() => removePendingPhoto(idx)}>
              Remove
            </button>
          </div>
        {/each}
      </div>
    {/if}

    <div class="submit-row">
      <button class="btn btn-primary submit-btn" type="submit" disabled={saving || uploading}>
        {#if uploading}
          Uploading...
        {:else if saving}
          Submitting...
        {:else}
          Submit Pit Entry
        {/if}
      </button>
    </div>
  </form>
{/if}

<style>
  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
  }

  .page-summary {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    justify-content: flex-end;
    gap: 0.75rem;
  }

  .summary-pill {
    display: flex;
    align-items: baseline;
    gap: 0.45rem;
    padding: 0.6rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
  }

  .summary-pill strong {
    font-size: 1.1rem;
  }

  .picker-card,
  .entry-card {
    display: grid;
    gap: 1rem;
    max-width: 760px;
    margin: 0 auto;
  }

  .team-search {
    font-size: 1.05rem;
  }

  .team-list {
    display: grid;
    gap: 0.45rem;
    max-height: 70vh;
    overflow: auto;
  }

  .team-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
    width: 100%;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: var(--surface);
    padding: 0.7rem 0.8rem;
    cursor: pointer;
  }

  .team-row-main {
    font-weight: 600;
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

  .entry-header {
    display: flex;
    align-items: flex-start;
    gap: 1rem;
  }

  .entry-subtitle {
    margin-top: 0.3rem;
    color: var(--text-muted);
    font-size: 0.9rem;
  }

  .auto-options-header,
  .auto-option-editor-header,
  .photo-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: 0.75rem;
  }

  .auto-options-empty {
    margin-top: 0.5rem;
    border: 1px dashed var(--border);
    border-radius: 8px;
    padding: 0.8rem;
    color: var(--text-muted);
    background: color-mix(in srgb, var(--surface) 90%, transparent);
  }

  .auto-option-editor-list {
    display: grid;
    gap: 0.75rem;
    margin-top: 0.55rem;
  }

  .auto-option-editor {
    display: grid;
    gap: 0.6rem;
    padding: 0.75rem;
  }

  .auto-option-description {
    min-height: 88px;
    resize: vertical;
  }

  .break-risk-input {
    min-height: 88px;
    resize: vertical;
  }

  .climb-options-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 0.6rem;
    margin-top: 0.5rem;
  }

  .climb-option {
    min-height: 48px;
    padding: 0.7rem 0.8rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: color-mix(in srgb, var(--surface) 94%, transparent);
  }

  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }

  .photo-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: 0.6rem;
  }

  .photo-item,
  .pending-file-card {
    display: grid;
    gap: 0.45rem;
  }

  .photo-item img {
    width: 100%;
    height: 140px;
    object-fit: cover;
    border-radius: 8px;
    border: 1px solid var(--border);
  }

  .pending-file-card {
    border: 1px dashed var(--border);
    border-radius: 8px;
    padding: 0.75rem;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
  }

  .pending-file-name {
    word-break: break-word;
    font-size: 0.92rem;
  }

  .submit-row {
    display: flex;
    justify-content: flex-end;
    margin-top: 0.5rem;
  }

  .submit-btn {
    min-width: 190px;
  }

  @media (max-width: 768px) {
    .page-header,
    .entry-header,
    .auto-options-header,
    .auto-option-editor-header,
    .photo-header {
      flex-direction: column;
      align-items: stretch;
    }

    .page-summary {
      width: 100%;
      justify-content: flex-start;
    }

    .summary-pill {
      flex: 1 1 140px;
      justify-content: space-between;
    }

    .team-list {
      max-height: none;
    }

    .photo-grid {
      grid-template-columns: repeat(2, minmax(0, 1fr));
    }

    .submit-row {
      justify-content: stretch;
    }

    .submit-btn {
      width: 100%;
    }
  }

  @media (max-width: 480px) {
    .team-row {
      flex-wrap: wrap;
      align-items: flex-start;
    }

    .photo-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
