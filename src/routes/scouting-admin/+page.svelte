<script>
  import { onMount } from 'svelte';
  import { userStore } from '$lib/stores/auth.js';
  import { getAuthHeader } from '$lib/supabase.js';
  import { FRC_TEAMS } from '$lib/permissions.js';
  import ScoutAssignmentPanel from '$lib/components/ScoutAssignmentPanel.svelte';

  let user;
  let loading = false;
  const autosaveTimers = new Map();
  let errorMsg = '';
  let successMsg = '';
  let warning = '';
  let eventKey = '';
  let upcomingEvents = [];
  let selectedEventKey = '';
  let savingEvent = false;

  let metrics = {
    pit: { percent: 0, scouted_teams: 0, total_teams: 0 },
    data: { assigned_percent: 0, scouted_percent: 0, missed_shift_percent: 0, missed_shifts: 0, assigned_matches: 0, scouted_matches: 0, total_matches: 0 },
    note: { assigned_percent: 0, scouted_percent: 0, missed_shift_percent: 0, missed_shifts: 0, assigned_matches: 0, scouted_matches: 0, total_matches: 0 },
    overall: { assigned_percent: 0, scouted_percent: 0, missed_shift_percent: 0 }
  };

  let users = [];
  let missedMatches = [];
  let smartFuelModel = {
    enabled: false,
    match_count: 0,
    residual_rmse: 0,
    residual_mae: 0,
    warning: '',
    by_scout: []
  };
  let savingSmartFuel = false;
  let userSearch = '';

  let competitionRoleOptions = [];
  const frcTeamOptions = Object.values(FRC_TEAMS);

  let drafts = {};
  let lastUserId = null;
  let canAccess = null;

  userStore.subscribe((v) => {
    user = v;
  });

  $: filteredUsers = users.filter((u) => {
    const q = String(userSearch || '').trim().toLowerCase();
    if (!q) return true;
    return (
      String(u.full_name || '').toLowerCase().includes(q) ||
      String(u.email || '').toLowerCase().includes(q)
    );
  });

  async function authFetch(url, options = {}) {
    const headers = {
      ...(options.headers || {}),
      ...(await getAuthHeader())
    };
    return fetch(url, { ...options, headers });
  }

  function initDrafts(list) {
    const next = {};
    for (const row of list || []) {
      next[row.id] = {
        competition_role: row.competition_role || '',
        frc_team: row.frc_team || ''
      };
    }
    drafts = next;
  }

  async function loadDashboard(options = {}) {
    const { silent = false } = options;
    if (!user?.id) return;

    if (!silent) {
      loading = true;
      errorMsg = '';
      successMsg = '';
      warning = '';
    }

    try {
      const res = await authFetch('/api/scouting-admin');
      const data = await res.json().catch(() => null);
      if (res.status === 403) {
        canAccess = false;
        return;
      }
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to load (${res.status})`);
      }

      canAccess = true;
      eventKey = data.data?.event_key || '';
      upcomingEvents = data.data?.upcoming_events || [];
      selectedEventKey = eventKey || upcomingEvents[0]?.key || '';
      warning = data.data?.warning || '';
      metrics = data.data?.metrics || metrics;
      competitionRoleOptions = data.data?.competition_role_options || [];
      users = data.data?.users || [];
      missedMatches = data.data?.missed_matches || [];
      smartFuelModel = data.data?.smart_fuel_model || smartFuelModel;
      initDrafts(users);
    } catch (e) {
      errorMsg = e.message || 'Failed to load scouting admin dashboard.';
    } finally {
      if (!silent) {
        loading = false;
      }
    }
  }

  async function saveRole(userRow) {
    const draft = drafts[userRow.id];
    if (!draft) return;
    const saved = users.find((u) => u.id === userRow.id);
    const nextCompetitionRole = draft.competition_role || null;
    const nextFrcTeam = draft.frc_team || null;
    const savedCompetitionRole = saved?.competition_role || null;
    const savedFrcTeam = saved?.frc_team || null;
    if (nextCompetitionRole === savedCompetitionRole && nextFrcTeam === savedFrcTeam) return;

    errorMsg = '';
    successMsg = '';

    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'update-competition-role',
          target_user_id: userRow.id,
          competition_role: nextCompetitionRole,
          frc_team: nextFrcTeam
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to save (${res.status})`);
      }

      users = users.map((u) => {
        if (u.id !== userRow.id) return u;
        return {
          ...u,
          competition_role: data.data?.competition_role ?? nextCompetitionRole,
          frc_team: data.data?.frc_team || nextFrcTeam
        };
      });
      drafts = {
        ...drafts,
        [userRow.id]: {
          competition_role: data.data?.competition_role || '',
          frc_team: data.data?.frc_team || ''
        }
      };
      successMsg = `Updated role for ${userRow.full_name || userRow.email}.`;
    } catch (e) {
      errorMsg = e.message || 'Failed to save role.';
    }
  }

  function queueSaveRole(userRow) {
    const key = userRow.id;
    const existing = autosaveTimers.get(key);
    if (existing) clearTimeout(existing);
    const timer = setTimeout(() => {
      autosaveTimers.delete(key);
      saveRole(userRow);
    }, 220);
    autosaveTimers.set(key, timer);
  }

  async function saveEventKey() {
    if (!selectedEventKey) return;
    savingEvent = true;
    errorMsg = '';
    successMsg = '';
    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'update-event-key',
          event_key: selectedEventKey
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to save event (${res.status})`);
      }
      eventKey = data.data?.event_key || selectedEventKey;
      selectedEventKey = eventKey;
      successMsg = `Scouting event set to ${eventKey}.`;
      await loadDashboard({ silent: true });
    } catch (e) {
      errorMsg = e.message || 'Failed to update event key.';
    } finally {
      savingEvent = false;
    }
  }

  async function setSmartFuelAlgorithmEnabled(enabled) {
    savingSmartFuel = true;
    errorMsg = '';
    successMsg = '';
    try {
      const res = await authFetch('/api/scouting-admin', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          action: 'update-smart-fuel-algorithm',
          enabled
        })
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.success) {
        throw new Error(data?.error || `Failed to save smart algorithm setting (${res.status})`);
      }
      smartFuelModel = {
        ...smartFuelModel,
        enabled: !!data.data?.smart_fuel_algorithm_enabled
      };
      successMsg = `Smart fuel calibration ${enabled ? 'enabled' : 'disabled'}.`;
      await loadDashboard({ silent: true });
    } catch (e) {
      errorMsg = e.message || 'Failed to update smart fuel calibration.';
    } finally {
      savingSmartFuel = false;
    }
  }

  onMount(() => {
    loadDashboard();
  });

  $: if (user?.id && user.id !== lastUserId) {
    lastUserId = user.id;
    loadDashboard();
  }

  $: if (!user?.id) {
    canAccess = null;
  }
</script>

{#if canAccess === false}
  <div class="scouting-admin-page">
    <div class="card denied-card">
      <h2>Scouting Admin</h2>
      <p class="text-muted">Access denied.</p>
    </div>
  </div>
{:else}
  <div class="scouting-admin-page">
    <div class="page-header scouting-header">
      <div class="header-content scouting-header-content">
        <div>
          <h1>Scouting Admin</h1>
          <p class="sub-label">
            Current event:
            <span class="mono">{eventKey || 'Not set'}</span>
          </p>
        </div>
      </div>
      <div class="page-actions">
        <button class="btn btn-secondary" disabled={loading} on:click={loadDashboard}>Refresh Dashboard</button>
      </div>
    </div>

    <div class="card event-card">
      <div class="event-controls">
        <div class="form-group event-control">
          <label class="form-label" for="eventSelect">Competition Code</label>
          <select id="eventSelect" class="form-select" bind:value={selectedEventKey}>
            {#if eventKey && !upcomingEvents.find((e) => e.key === eventKey)}
              <option value={eventKey}>{eventKey} (Current)</option>
            {/if}
            {#each upcomingEvents as ev}
              <option value={ev.key}>
                {ev.key} - {ev.name}{ev.start_date ? ` (${ev.start_date})` : ''}
              </option>
            {/each}
          </select>
        </div>
        <button class="btn btn-primary btn-nowrap" disabled={!selectedEventKey || savingEvent || selectedEventKey === eventKey} on:click={saveEventKey}>
          {savingEvent ? 'Saving...' : 'Set Event'}
        </button>
      </div>

      {#if warning || errorMsg || successMsg}
        <div class="status-stack">
          {#if warning}
            <div class="status-message status-warning">{warning}</div>
          {/if}
          {#if errorMsg}
            <div class="status-message status-error">{errorMsg}</div>
          {/if}
          {#if successMsg}
            <div class="status-message status-success">{successMsg}</div>
          {/if}
        </div>
      {/if}
    </div>

    <div class="stats-grid">
      <div class="card stat-card">
        <div class="stat-content">
          <div class="stat-label">Pit Scouted</div>
          <div class="stat-value">{metrics.pit.percent}%</div>
          <div class="stat-sub">{metrics.pit.scouted_teams}/{metrics.pit.total_teams} teams</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-content">
          <div class="stat-label">Data Assigned</div>
          <div class="stat-value">{metrics.data.assigned_percent}%</div>
          <div class="stat-sub">{metrics.data.assigned_matches}/{metrics.data.total_matches} matches</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-content">
          <div class="stat-label">Note Assigned</div>
          <div class="stat-value">{metrics.note.assigned_percent}%</div>
          <div class="stat-sub">{metrics.note.assigned_matches}/{metrics.note.total_matches} matches</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-content">
          <div class="stat-label">Data Scouted</div>
          <div class="stat-value">{metrics.data.scouted_percent}%</div>
          <div class="stat-sub">{metrics.data.scouted_matches}/{metrics.data.total_matches} matches</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-content">
          <div class="stat-label">Note Scouted</div>
          <div class="stat-value">{metrics.note.scouted_percent}%</div>
          <div class="stat-sub">{metrics.note.scouted_matches}/{metrics.note.total_matches} matches</div>
        </div>
      </div>
      <div class="card stat-card">
        <div class="stat-content">
          <div class="stat-label">Missed Shifts</div>
          <div class="stat-value">{metrics.overall.missed_shift_percent}%</div>
          <div class="stat-sub">Data {metrics.data.missed_shifts} / Note {metrics.note.missed_shifts}</div>
        </div>
      </div>
    </div>

    <div class="card section-card">
      <div class="section-header">
        <h3>Missed Matches</h3>
      </div>
      {#if !missedMatches.length}
        <div class="empty-state compact-empty">No missed matches detected yet.</div>
      {:else}
        <div class="table-wrap">
          <div class="table-container">
            <table class="table">
              <thead>
                <tr>
                  <th>Match</th>
                  <th>Data Misses</th>
                  <th>Note Misses</th>
                  <th>Missed Assignments</th>
                </tr>
              </thead>
              <tbody>
                {#each missedMatches as m}
                  <tr>
                    <td>#{m.match_number}</td>
                    <td>{m.data_missed_count}</td>
                    <td>{m.note_missed_count}</td>
                    <td>
                      <div class="missed-list">
                        {#each m.missed_assignments as a}
                          <div>{a.scouting_type} - {String(a.team_key || '').replace(/^frc/i, '')} - {a.user_name || a.assigned_user}</div>
                        {/each}
                      </div>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>
      {/if}
    </div>

    <div class="assignment-section">
      <ScoutAssignmentPanel scoutingType="data" />
      <ScoutAssignmentPanel scoutingType="note" />
    </div>

    <details class="role-accordion">
      <summary class="role-summary">
        <span class="role-summary-title">Smart Fuel Calibration</span>
      </summary>
      <div class="role-body">
        <div class="smart-toolbar">
          <div class="smart-toggle-copy">
            <div class="smart-title">Smart regression model</div>
            <div class="text-muted">
              Fits per-scout adjustment factors to reduce blue alliance fuel residual.
            </div>
          </div>
          <button
            class="btn btn-secondary"
            disabled={savingSmartFuel}
            on:click={() => setSmartFuelAlgorithmEnabled(!smartFuelModel.enabled)}
          >
            {savingSmartFuel
              ? 'Saving...'
              : smartFuelModel.enabled
                ? 'Disable Algorithm'
                : 'Enable Algorithm'}
          </button>
        </div>

        <div class="smart-stats">
          <div class="smart-stat"><span>Status</span><strong>{smartFuelModel.enabled ? 'Enabled' : 'Disabled'}</strong></div>
          <div class="smart-stat"><span>Matches Fit</span><strong>{smartFuelModel.match_count || 0}</strong></div>
          <div class="smart-stat"><span>Residual RMSE</span><strong>{smartFuelModel.residual_rmse || 0}</strong></div>
          <div class="smart-stat"><span>Residual MAE</span><strong>{smartFuelModel.residual_mae || 0}</strong></div>
        </div>

        {#if smartFuelModel.warning}
          <div class="status-message status-warning">{smartFuelModel.warning}</div>
        {/if}

        <div class="table-wrap">
          <div class="table-container">
            <table class="table">
              <thead>
                <tr>
                  <th>Scout</th>
                  <th>Adjustment Factor</th>
                  <th>Residual RMSE</th>
                  <th>Residual MAE</th>
                  <th>Residual Bias</th>
                  <th>Sample Matches</th>
                </tr>
              </thead>
              <tbody>
                {#if !smartFuelModel.by_scout?.length}
                  <tr>
                    <td colspan="6" class="empty">No scout calibration rows available yet.</td>
                  </tr>
                {:else}
                  {#each smartFuelModel.by_scout as row}
                    <tr>
                      <td>{row.scout_name || row.scout_id}</td>
                      <td>{row.adjustment_factor}</td>
                      <td>{row.residual_rmse}</td>
                      <td>{row.residual_mae}</td>
                      <td>{row.residual_bias}</td>
                      <td>{row.sample_matches}</td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </details>

    <details class="role-accordion">
      <summary class="role-summary">
        <span class="role-summary-title">Competition Roles</span>
      </summary>
      <div class="role-body">
        <div class="role-search">
          <input class="form-input user-search" placeholder="Search name or email" bind:value={userSearch} />
        </div>

        <div class="table-wrap">
          <div class="table-container">
            <table class="table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Email</th>
                  <th>Competition Role</th>
                  <th>FRC Team</th>
                </tr>
              </thead>
              <tbody>
                {#if !filteredUsers.length}
                  <tr>
                    <td colspan="4" class="empty">No users match your search.</td>
                  </tr>
                {:else}
                  {#each filteredUsers as row}
                    <tr>
                      <td>{row.full_name || '-'}</td>
                      <td>{row.email || '-'}</td>
                      <td>
                        <select class="form-select" bind:value={drafts[row.id].competition_role} on:change={() => queueSaveRole(row)}>
                          <option value="">Not Assigned</option>
                          {#each competitionRoleOptions as opt}
                            <option value={opt}>{opt}</option>
                          {/each}
                        </select>
                      </td>
                      <td>
                        <select class="form-select" bind:value={drafts[row.id].frc_team} on:change={() => queueSaveRole(row)}>
                          <option value="">Not Set</option>
                          {#each frcTeamOptions as opt}
                            <option value={opt}>{opt}</option>
                          {/each}
                        </select>
                      </td>
                    </tr>
                  {/each}
                {/if}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </details>
  </div>
{/if}

<style>
  .scouting-admin-page {
    display: flex;
    flex-direction: column;
    gap: var(--gap-6);
    padding-bottom: var(--space-7);
  }

  .scouting-admin-page :global(.card) {
    margin: 0;
  }

  .denied-card h2 {
    margin: 0;
  }

  .sub-label {
    margin: var(--space-1) 0 0;
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .scouting-header {
    margin: 0;
  }

  .scouting-header-content {
    min-width: 260px;
  }

  /* Event card */
  .event-card {
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }

  .event-controls {
    display: flex;
    align-items: flex-end;
    gap: var(--gap-3);
    flex-wrap: wrap;
  }

  .event-control {
    flex: 1;
    min-width: min(100%, 420px);
    margin: 0;
  }

  /* Status messages */
  .status-stack {
    display: flex;
    flex-direction: column;
    gap: var(--gap-2);
  }

  .status-message {
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    padding: var(--space-2) var(--space-3);
    font-size: var(--font-xs);
    line-height: 1.4;
  }

  .status-warning {
    background: var(--status-pending-bg);
    border-color: var(--status-pending-border);
    color: var(--status-pending-text);
  }

  .status-error {
    background: var(--status-risk-bg);
    border-color: var(--status-risk-border);
    color: var(--status-risk-text);
  }

  .status-success {
    background: var(--status-ready-bg);
    border-color: var(--status-ready-border);
    color: var(--status-ready-text);
  }

  /* Stat cards */
  .stat-content {
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
  }

  .stat-label {
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .stat-value {
    font-size: var(--font-2xl);
    font-weight: 700;
    line-height: 1;
  }

  .stat-sub {
    font-size: var(--font-xs);
    color: var(--text-muted);
  }

  /* Missed matches */
  .compact-empty {
    padding: var(--space-4);
  }

  .table-wrap {
    overflow-x: auto;
  }

  .missed-list {
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
    font-size: var(--font-xs);
  }

  /* Shift assignments */
  .assignment-section {
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }

  /* Competition roles accordion */
  .role-accordion {
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    box-shadow: var(--shadow-sm);
    overflow: hidden;
  }

  .role-summary {
    list-style: none;
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    cursor: pointer;
    padding: var(--space-3) var(--space-4);
    font-weight: 600;
  }

  .role-summary::-webkit-details-marker {
    display: none;
  }

  .role-summary-title {
    font-size: var(--font-md);
  }

  .role-accordion[open] .role-summary {
    border-bottom: 1px solid var(--border);
  }

  .role-body {
    padding: var(--space-4);
    display: flex;
    flex-direction: column;
    gap: var(--gap-3);
  }

  .user-search {
    min-width: 220px;
    max-width: 320px;
  }

  .smart-toolbar {
    display: flex;
    gap: var(--gap-3);
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .smart-title {
    font-size: var(--font-sm);
    font-weight: 700;
  }

  .smart-stats {
    display: grid;
    gap: var(--gap-2);
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
  }

  .smart-stat {
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-2) var(--space-3);
    display: flex;
    flex-direction: column;
    gap: var(--gap-1);
    font-size: var(--font-xs);
  }

  @media (max-width: 768px) {
    .scouting-admin-page {
      gap: var(--gap-4);
    }

    .event-controls {
      flex-direction: column;
      align-items: stretch;
    }

    .event-controls .btn {
      width: 100%;
    }

    .user-search {
      max-width: 100%;
    }
  }
</style>

