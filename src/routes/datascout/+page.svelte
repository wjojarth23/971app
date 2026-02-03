<script>
  import { onMount } from "svelte";
  import { userStore } from "$lib/stores/auth.js";
  import { getAuthHeader } from "$lib/supabase.js";
  import { hasPermission } from "$lib/permissions.js";
  import notescoutConfig from "$lib/notescout.json";
  import ScoutAssignmentPanel from "$lib/components/ScoutAssignmentPanel.svelte";

  let user;
  userStore.subscribe((v) => (user = v));
  $: canSeeDataAssignments =
    !!user &&
    (user.role === "admin" || hasPermission(user, "DATA_SCOUT_ADMIN"));

  // Match / Team State
  let matches = [];
  let teamsCurrentMatch = [];
  let selectedMatchKey = "";
  let selectedMatch = null;
  let selectedTeam = "";
  let loadNote = "";
  let loadingMatches = false;

  // Session State
  let phase = "pre"; // pre, auto, teleop, endgame, finished
  let startPosition = ""; // center, left, right

  // Teleop Specific State
  let currentRole = "Scoring";
  let shiftOn = true;

  // Endgame State
  let finalClimbPos = "N/A";
  let shootingAccuracy = 3; // 1-5 default 3
  let shootingSpeed = 5; // 1-10 balls/sec default 5
  let drivingRank = 3; // 1-5 default 3

  // History / Logs
  let scoutingEvents = []; // current session events

  // Data Viewing
  let teamsWithData = [];
  let selectedTeamForView = "";
  let viewMode = "scout"; // scout | view
  let teamEvents = [];

  // Animation State
  let animatedBalls = [];
  let shootingTimer;

  $: {
    if (typeof window !== "undefined") {
      clearInterval(shootingTimer);
      // Only animate in scouting phases
      if (phase === "auto" || phase === "teleop") {
        const interval = 1000 / shootingSpeed;
        shootingTimer = setInterval(() => {
          const id = Math.random();
          animatedBalls = [...animatedBalls, { id }];
          // Cleanup ball after animation finishes
          setTimeout(() => {
            animatedBalls = animatedBalls.filter((b) => b.id !== id);
          }, 3000); // Matches --ball-duration
        }, interval);
      }
    }
  }

  const ROLES = ["Scoring", "Shuttling", "Defense", "Counter Defense", "Dead"];
  const CLIMB_POSITIONS = ["N/A", "L1", "L2", "L3"];

  function displayTeam(t) {
    return t ? String(t).replace(/^frc/i, "") : "";
  }

  async function fetchMatches() {
    loadNote = "";
    if (!notescoutConfig?.event_key) {
      loadNote = "No event configured.";
      return;
    }
    loadingMatches = true;
    try {
      const res = await fetch(
        `/api/tba/event-matches?event_key=${encodeURIComponent(notescoutConfig.event_key)}&comp_level=qm`,
      );
      if (!res.ok) {
        const js = await res.json().catch(() => null);
        loadNote = js?.error || `Failed to load matches (${res.status})`;
        return;
      }
      const js = await res.json();
      if (!js?.success) {
        loadNote = js?.error || "Failed to load matches";
        return;
      }
      matches = (js.data || []).slice();
    } catch (e) {
      loadNote = e.message || "Load error";
    } finally {
      loadingMatches = false;
    }
  }

  function onSelectMatchByKey() {
    const m = matches.find((x) => x.key === selectedMatchKey);
    selectedMatch = m || null;
    if (m) {
      teamsCurrentMatch = [
        ...(m.alliances?.red?.team_keys || []),
        ...(m.alliances?.blue?.team_keys || []),
      ];
      selectedTeam = teamsCurrentMatch[0] || "";
    } else {
      teamsCurrentMatch = [];
      selectedTeam = "";
    }
    resetSessionState();
  }

  function resetSessionState() {
    phase = "pre";
    startPosition = "";
    currentRole = "Scoring";
    shiftOn = true;
    finalClimbPos = "N/A";
    shootingAccuracy = 3;
    shootingSpeed = 5;
    drivingRank = 3;
    scoutingEvents = [];
  }

  async function record(event_type, event_value) {
    if (!selectedMatch || !selectedTeam) return;
    const payload = {
      action: "record-event",
      match_key: selectedMatch.key,
      match_number: selectedMatch.match_number,
      team_key: selectedTeam,
      phase: phase,
      event_type,
      event_value,
      user_id: user?.id || null,
      // Add context state to every event for redundancy if needed, or just rely on 'role_update' events
      role: phase === "teleop" ? currentRole : null,
      on_shift: phase === "teleop" ? shiftOn : null,
    };

    // Optimistic UI update
    const tempEvent = { ...payload, created_at: new Date().toISOString() };
    scoutingEvents = [...scoutingEvents, tempEvent]; // append

    try {
      const res = await fetch("/datascout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data?.success) {
        console.error("Failed to save event", data?.error);
      } else if (data.data?.id) {
        // Update the optimistic entry with the real DB ID
        const idx = scoutingEvents.findIndex(
          (e) =>
            e.created_at === tempEvent.created_at &&
            e.event_type === tempEvent.event_type,
        );
        if (idx !== -1) {
          scoutingEvents[idx].id = data.data.id;
          scoutingEvents = [...scoutingEvents];
        }
      }
    } catch (e) {
      console.error(e);
    }
  }

  async function undoLast() {
    if (scoutingEvents.length === 0) return;
    const lastEvent = scoutingEvents[scoutingEvents.length - 1];

    // Remove from local state
    scoutingEvents = scoutingEvents.slice(0, -1);

    // Phase Reversion Logic
    if (lastEvent.event_type === "phase") {
      if (lastEvent.event_value === "begin_auto") phase = "pre";
      else if (lastEvent.event_value === "end_auto") phase = "auto";
      else if (lastEvent.event_value === "finish_match") phase = "teleop";
    }

    if (lastEvent.id) {
      try {
        const res = await fetch("/datascout", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ id: lastEvent.id }),
        });
        const data = await res.json();
        if (!data?.success) {
          console.error("Failed to undo event in DB", data?.error);
        }
      } catch (e) {
        console.error("Undo error", e);
      }
    }

    // Batch Undo for Hold Actions (e.g. shooting_end -> shooting_start)
    if (lastEvent.event_type.endsWith("_end")) {
      undoLast();
      return;
    }

    // Batch Undo for Match Phase Setup
    const nextLast = scoutingEvents[scoutingEvents.length - 1];
    if (nextLast) {
      const isTeleopSetup =
        (lastEvent.event_type === "shift_update" &&
          nextLast.event_type === "role_update") ||
        (lastEvent.event_type === "role_update" &&
          nextLast.event_type === "phase" &&
          nextLast.event_value === "end_auto");

      const isAutoSetup =
        lastEvent.event_type === "phase" &&
        lastEvent.event_value === "begin_auto" &&
        nextLast.event_type === "auto_start_position";

      if (isTeleopSetup || isAutoSetup) {
        undoLast();
      }
    }
  }

  // Phase transitions
  function chooseStart(pos) {
    startPosition = pos;
    record("auto_start_position", pos);
  }
  function beginAuto() {
    phase = "auto";
    record("phase", "begin_auto");
  }
  function endAuto() {
    phase = "teleop";
    record("phase", "end_auto");
    record("role_update", currentRole);
    record("shift_update", String(shiftOn));
  }
  function beginEndgame() {
    phase = "endgame";
    record("phase", "begin_endgame");
  }

  async function submitMatch() {
    await record("climb_pos", finalClimbPos);
    await record("rank_accuracy", shootingAccuracy);
    await record("rank_speed", shootingSpeed);
    await record("rank_driving", drivingRank);
    await record("phase", "finish_match");
    phase = "finished";
  }

  // Actions
  function recordPickup(source) {
    record("pickup", source);
  }
  function recordPushing() {
    record("pushing", "outpost");
  }

  // Hold-to-record Handlers (Shooting, Climbing)
  let holdTimers = {};

  function startAction(actionName, value) {
    const key = `${actionName}_${value}`;
    if (holdTimers[key]) return;

    // Record start
    record(`${actionName}_start`, value);
    holdTimers = { ...holdTimers, [key]: true };
  }

  function endAction(actionName, value) {
    const key = `${actionName}_${value}`;
    if (!holdTimers[key]) return;
    record(`${actionName}_end`, value);
    const newTimers = { ...holdTimers };
    delete newTimers[key];
    holdTimers = newTimers;
  }

  // Teleop Toggles
  function setRole(r) {
    currentRole = r;
    record("role_update", r);
  }
  function setShift(val) {
    if (shiftOn === val) return;
    shiftOn = val;
    record("shift_update", String(val));
  }

  // Viewing Data
  async function loadTeamsWithData() {
    try {
      const res = await fetch("/datascout?list_teams=1");
      const data = await res.json();
      if (data?.success) {
        teamsWithData = data.data || [];
      }
    } catch (e) {}
  }
  async function viewTeamEvents() {
    if (!selectedTeamForView) return;
    viewMode = "view";
    const res = await fetch(
      "/datascout?team_key=" + encodeURIComponent(selectedTeamForView),
    );
    const data = await res.json();
    if (data?.success) {
      teamEvents = data.data || [];
    }
  }
  function backToScout() {
    viewMode = "scout";
  }

  // Assignment Logic
  let myAssignments = [];
  let nextAssignment = null;
  async function loadMyAssignments() {
    if (!user?.id) return;
    try {
      const res = await fetch(
        `/api/scout-assignments?scouting_type=data&mine=1&user_id=${encodeURIComponent(user.id)}`,
        { headers: await getAuthHeader() },
      );
      const js = await res.json();
      if (js?.success) {
        myAssignments = (js.data || []).filter((r) => !r.completed_at);
        nextAssignment = myAssignments[0] || null;
      }
    } catch (e) {}
  }
  function gotoNextAssignment() {
    if (!nextAssignment) return;
    selectedMatchKey = nextAssignment.match_key;
    onSelectMatchByKey();
    selectedTeam = nextAssignment.team_key;
  }

  onMount(() => {
    fetchMatches();
    loadTeamsWithData();
    loadMyAssignments();
  });
</script>

<svelte:window on:contextmenu|preventDefault />

{#if canSeeDataAssignments}
  <ScoutAssignmentPanel
    scoutingType="data"
    permissionAdmin="DATA_SCOUT_ADMIN"
    memberPerm="DATA_SCOUT_MEMBER"
  />
{/if}

<!-- Header -->
<div class="page-header card">
  <div>
    <h2 style="margin:0">Data Scouting</h2>
    {#if notescoutConfig?.event_key}
      <div class="sub-label">{notescoutConfig.event_key}</div>
    {/if}
    {#if loadNote}<div class="note">{loadNote}</div>{/if}
  </div>

  <div class="page-actions">
    {#if nextAssignment}
      <div class="form-group next-up">
        <div class="form-label">Next Up</div>
        <button class="btn btn-primary" on:click={gotoNextAssignment}
          >Match {nextAssignment.match_key.split("_").pop()}</button
        >
      </div>
    {/if}

    <div class="form-group match-select">
      <label class="form-label" for="matchSelect">Match</label>
      <select
        id="matchSelect"
        class="form-select"
        bind:value={selectedMatchKey}
        on:change={onSelectMatchByKey}
        disabled={loadingMatches}
      >
        <option value="">-- choose --</option>
        {#each matches as m}<option value={m.key}
            >{m.key.split("_").pop()}</option
          >{/each}
      </select>
    </div>

    <div class="form-group team-view">
      <label class="form-label" for="viewTeamSelect">View Data</label>
      <div class="row">
        <select
          id="viewTeamSelect"
          class="form-select"
          bind:value={selectedTeamForView}
        >
          <option value="">-- team --</option>
          {#each teamsWithData as t}<option value={t}>{displayTeam(t)}</option
            >{/each}
        </select>
        <button
          class="btn btn-secondary"
          on:click={viewTeamEvents}
          disabled={!selectedTeamForView}>View</button
        >
      </div>
    </div>
  </div>
</div>

{#if viewMode === "view"}
  <!-- View Mode -->
  <div class="card">
    <button
      class="btn btn-secondary"
      style="margin-bottom:1rem"
      on:click={backToScout}>&larr; Back to Scout</button
    >
    <h3>Events: {displayTeam(selectedTeamForView)}</h3>
    {#if teamEvents.length === 0}<div class="empty">No events found.</div>{/if}
    <div class="event-list">
      {#each teamEvents as e}
        <div class="event-item">
          <span class="badg">{e.phase}</span>
          <span class="match-badge"
            >M{e.match_number || e.match_key?.split("_").pop()}</span
          >
          <strong>{e.event_type}</strong>
          <span class="val">{e.event_value || ""}</span>
          {#if e.role}<span class="role-badge">{e.role}</span>{/if}
          {#if e.on_shift !== null && e.on_shift !== undefined}
            <span class="shift-badge {e.on_shift ? 'on' : 'off'}">
              {e.on_shift ? "ON" : "OFF"}
            </span>
          {/if}
          <span class="time">{new Date(e.created_at).toLocaleTimeString()}</span
          >
        </div>
      {/each}
    </div>
  </div>
{:else}
  <!-- Scouting Console -->
  <div class="card console">
    {#if !selectedMatch}
      <div class="empty-state">Please select a match to begin scouting.</div>
    {:else}
      <!-- Header Info -->
      <div class="console-header">
        <div class="info-block">
          <label>Match</label>
          <div class="val">{selectedMatch.key.split("_").pop()}</div>
        </div>
        <div class="info-block" style="flex-grow:1">
          <label for="teamScout">Team</label>
          <select
            id="teamScout"
            class="form-select large"
            bind:value={selectedTeam}
          >
            {#each teamsCurrentMatch as t}<option value={t}
                >{displayTeam(t)}</option
              >{/each}
          </select>
        </div>
        <div class="info-block">
          <label>Phase</label>
          <div class="phase-badge {phase}">{phase.toUpperCase()}</div>
        </div>
        <div class="undo-block">
          <button
            class="btn btn-danger undo-btn"
            on:click={undoLast}
            disabled={scoutingEvents.length === 0}
            title="Undo last action"
          >
            UNDO
          </button>
        </div>
      </div>

      <hr class="divider" />

      <!-- PRE PHASE -->
      {#if phase === "pre"}
        <div class="phase-section pre-state">
          <h4>Auto Start Position</h4>
          <div class="btn-row">
            {#each ["Left", "Center", "Right"] as p}
              <button
                class="btn {startPosition === p.toLowerCase()
                  ? 'btn-selected'
                  : 'btn-outline'} big-btn"
                on:click={() => chooseStart(p.toLowerCase())}>{p}</button
              >
            {/each}
          </div>
          <button
            class="btn btn-success action-btn full-width"
            disabled={!startPosition}
            on:click={beginAuto}
          >
            START MATCH (AUTO)
          </button>
        </div>
      {/if}

      <!-- AUTO PHASE -->
      {#if phase === "auto"}
        <div class="phase-section">
          <h4>Pick Up</h4>
          <div class="btn-row">
            <button
              class="btn btn-outline big-btn"
              on:click={() => recordPickup("ground")}>Ground</button
            >
            <button
              class="btn btn-outline big-btn"
              on:click={() => recordPickup("depot")}>Depot</button
            >
            <button
              class="btn btn-outline big-btn"
              on:click={() => recordPickup("outpost")}>Outpost</button
            >
          </div>

          <h4>Shooting (Hold)</h4>
          <div class="btn-row">
            <button
              class="btn {holdTimers['shooting_shuttling']
                ? 'btn-selected'
                : 'btn-outline'} big-btn"
              on:mousedown={() => startAction("shooting", "shuttling")}
              on:mouseup={() => endAction("shooting", "shuttling")}
              on:touchstart|preventDefault={() =>
                startAction("shooting", "shuttling")}
              on:touchend|preventDefault={() =>
                endAction("shooting", "shuttling")}>Shuttling</button
            >

            <button
              class="btn {holdTimers['shooting_scoring']
                ? 'btn-selected'
                : 'btn-outline'} big-btn"
              on:mousedown={() => startAction("shooting", "scoring")}
              on:mouseup={() => endAction("shooting", "scoring")}
              on:touchstart|preventDefault={() =>
                startAction("shooting", "scoring")}
              on:touchend|preventDefault={() =>
                endAction("shooting", "scoring")}>Scoring</button
            >
          </div>

          <div class="spacer"></div>
          <button
            class="btn btn-success action-btn full-width"
            on:click={endAuto}
          >
            START TELEOP
          </button>
        </div>
      {/if}

      <!-- TELEOP PHASE -->
      {#if phase === "teleop"}
        <div class="phase-section">
          <!-- Roles & Shift -->
          <div class="teleop-config">
            <div class="role-selector">
              <label>Current Robot Role</label>
              <div class="chip-grid">
                {#each ROLES as r}
                  <button
                    class="chip {currentRole === r ? 'active' : ''}"
                    on:click={() => setRole(r)}>{r}</button
                  >
                {/each}
              </div>
            </div>

            <div class="shift-selector">
              <label>Shift Status</label>
              <div class="chip-grid">
                <button
                  class="chip shift-chip {shiftOn ? 'on' : ''}"
                  on:click={() => setShift(true)}>ON SHIFT</button
                >
                <button
                  class="chip shift-chip {!shiftOn ? 'off' : ''}"
                  on:click={() => setShift(false)}>OFF SHIFT</button
                >
              </div>
            </div>
          </div>

          <hr class="divider-sm" />

          <h4>Pick Up</h4>
          <div class="btn-row">
            <button
              class="btn btn-outline big-btn"
              on:click={() => recordPickup("ground")}>Ground</button
            >
            <button
              class="btn btn-outline big-btn"
              on:click={() => recordPickup("depot")}>Depot</button
            >
            <button
              class="btn btn-outline big-btn"
              on:click={() => recordPickup("outpost")}>Outpost</button
            >
          </div>

          <h4>Shooting (Hold)</h4>
          <div class="btn-row">
            <button
              class="btn {holdTimers['shooting_shuttling']
                ? 'btn-selected'
                : 'btn-outline'} big-btn"
              on:mousedown={() => startAction("shooting", "shuttling")}
              on:mouseup={() => endAction("shooting", "shuttling")}
              on:touchstart|preventDefault={() =>
                startAction("shooting", "shuttling")}
              on:touchend|preventDefault={() =>
                endAction("shooting", "shuttling")}>Shuttling</button
            >

            <button
              class="btn {holdTimers['shooting_scoring']
                ? 'btn-selected'
                : 'btn-outline'} big-btn"
              on:mousedown={() => startAction("shooting", "scoring")}
              on:mouseup={() => endAction("shooting", "scoring")}
              on:touchstart|preventDefault={() =>
                startAction("shooting", "scoring")}
              on:touchend|preventDefault={() =>
                endAction("shooting", "scoring")}>Scoring</button
            >
          </div>

          <h4>Pushing</h4>
          <div class="btn-row">
            <button class="btn btn-outline big-btn" on:click={recordPushing}
              >Outpost</button
            >
          </div>
        </div>

        <hr class="divider" />

        <div class="phase-section">
          <h4>Climbing (Hold)</h4>
          <button
            class="btn {holdTimers['climbing_generic']
              ? 'btn-selected'
              : 'btn-outline'} big-btn full-width"
            on:mousedown={() => startAction("climbing", "generic")}
            on:mouseup={() => endAction("climbing", "generic")}
            on:touchstart|preventDefault={() =>
              startAction("climbing", "generic")}
            on:touchend|preventDefault={() => endAction("climbing", "generic")}
            >CLIMBING</button
          >

          <div class="form-group mt-1">
            <label class="form-label">Final Climbing Position</label>
            <div class="btn-row">
              {#each CLIMB_POSITIONS as p}
                <button
                  class="btn {finalClimbPos === p
                    ? 'btn-selected'
                    : 'btn-outline'}"
                  on:click={() => (finalClimbPos = p)}>{p}</button
                >
              {/each}
            </div>
          </div>

          <div class="form-group mt-1">
            <label class="form-label">Robot Shooting Accuracy (1-5)</label>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              list="accuracy-ticks"
              bind:value={shootingAccuracy}
              class="slider"
            />
            <datalist id="accuracy-ticks">
              {#each Array(5) as _, i}<option value={i + 1}></option>{/each}
            </datalist>
            <div class="range-labels">
              <span>1</span><span>5</span>
            </div>
            <div class="current-val">{shootingAccuracy}</div>
          </div>

          <div class="form-group mt-1">
            <label class="form-label"
              >Robot Shooting Speed (1-10 balls/sec)</label
            >

            <!-- Animation -->
            <div class="animation-stage">
              <div class="robot-box">🤖</div>
              {#each animatedBalls as b (b.id)}
                <div
                  class="projectile-x"
                  style="animation-duration: var(--ball-duration);"
                >
                  <div class="projectile-y">🥎</div>
                </div>
              {/each}
            </div>

            <input
              type="range"
              min="1"
              max="10"
              step="1"
              list="speed-ticks"
              bind:value={shootingSpeed}
              class="slider"
            />
            <datalist id="speed-ticks">
              {#each Array(10) as _, i}<option value={i + 1}></option>{/each}
            </datalist>
            <div class="range-labels">
              <span>1</span><span>10</span>
            </div>
            <div class="current-val">{shootingSpeed}</div>
          </div>

          <div class="form-group mt-1">
            <label class="form-label">Driving Rank (1-5)</label>
            <input
              type="range"
              min="1"
              max="5"
              step="1"
              list="rank-ticks"
              bind:value={drivingRank}
              class="slider"
            />
            <datalist id="rank-ticks">
              {#each Array(5) as _, i}<option value={i + 1}></option>{/each}
            </datalist>
            <div class="range-labels">
              <span>1 (Bad)</span><span>3</span><span>5 (Godlike)</span>
            </div>
            <div class="current-val">{drivingRank}</div>
          </div>

          <div class="spacer"></div>
          <button
            class="btn btn-success action-btn full-width"
            style="margin-bottom: 2rem;"
            on:click={submitMatch}
          >
            SUBMIT MATCH
          </button>
        </div>
      {/if}

      <!-- ENDGAME PHASE -->

      <!-- FINISHED PHASE -->
      {#if phase === "finished"}
        <div class="finished-state">
          <h3>Match Submitted!</h3>
          <p>Select a new match or team to scout again.</p>
          <button class="btn btn-outline" on:click={onSelectMatchByKey}
            >Reset for next team</button
          >
        </div>
      {/if}

      <!-- Live Event Feed (Mini) -->
      {#if scoutingEvents.length > 0}
        <div class="mini-log">
          <div class="log-header">Session Log ({scoutingEvents.length})</div>
          <div class="log-entries">
            {#each [...scoutingEvents].reverse().slice(0, 5) as e}
              <div class="log-entry">
                {e.phase.toUpperCase()[0]} - {e.event_type}: {e.event_value ||
                  ""}
                {#if e.role}[{e.role}]{/if}
                {#if e.on_shift !== null && e.on_shift !== undefined}({e.on_shift
                    ? "ON"
                    : "OFF"}){/if}
              </div>
            {/each}
          </div>
        </div>
      {/if}
    {/if}
  </div>
{/if}

<style>
  /* Reuse main variables from global css if available, else standard fallback */
  :global(:root) {
    --primary: #0d6efd;
    --secondary: #6c757d;
    --success: #198754;
    --danger: #dc3545;
    --warning: #ffc107;
    --dark: #212529;
    --light: #f8f9fa;
    --border: #dee2e6;
    --stage-height: 450px;
    --stage-width: 450px; /* Half of 900px */
    --full-travel: 900px;
    --ball-size: 1.5rem;
    --ball-peak: -300px;
    --ball-duration: 3s; /* 900px / 3s = 300px/s */
  }

  @media (max-width: 600px) {
    :global(:root) {
      --stage-height: 250px;
      --stage-width: 300px; /* Half of 600px */
      --full-travel: 600px;
      --ball-size: 1rem;
      --ball-peak: -150px;
      --ball-duration: 2s; /* 600px / 2s = 300px/s */
    }
  }

  .mt-1 {
    margin-top: 1rem;
  }
  .full-width {
    width: 100%;
  }
  .spacer {
    height: 2rem;
  }

  .page-header {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: 1rem;
    padding: 1rem;
  }
  .sub-label {
    font-size: 0.85rem;
    color: var(--secondary);
  }
  .note {
    color: var(--danger);
    font-size: 0.8rem;
    margin-top: 0.25rem;
  }

  .page-actions {
    display: flex;
    gap: 1rem;
    flex-wrap: wrap;
  }
  .form-group {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .row {
    display: flex;
    gap: 0.5rem;
  }

  .card {
    background: white;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    margin-bottom: 1rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  /* Console Header */
  .console-header {
    display: flex;
    gap: 1rem;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  .info-block .label,
  .role-selector .label,
  .shift-selector .label {
    font-size: 0.75rem;
    text-transform: uppercase;
    color: var(--secondary);
    display: block;
  }
  .info-block .val {
    font-size: 1.25rem;
    font-weight: bold;
  }
  .undo-btn,
  .phase-badge {
    padding: 0.25rem 0.6rem;
    border-radius: 6px;
    font-size: 0.75rem;
    font-weight: 800;
    line-height: 1;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    border: 1px solid transparent;
    transition: all 0.2s;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
    width: auto;
    min-width: 50px;
  }
  .undo-btn {
    background: #dc3545; /* Match red */
    color: white;
  }
  .phase-badge {
    color: #fff;
    text-shadow: 0 1px 1px rgba(0, 0, 0, 0.2);
  }
  .phase-badge.pre {
    background: #6c757d; /* Grey */
    border: 1px solid #495057;
  }
  .phase-badge.auto {
    background: #0d6efd; /* Vibrant Blue */
    border: 1px solid #004085;
  }
  .phase-badge.teleop {
    background: #ffc107; /* Vibrant Yellow */
    color: #000;
    border: 1px solid #856404;
    text-shadow: none;
  }
  .phase-badge.endgame {
    background: #dc3545; /* Vibrant Red */
    border: 1px solid #721c24;
  }
  .phase-badge.finished {
    background: #198754; /* Success Green */
    border: 1px solid #0f5132;
  }

  .finished-state {
    background: #e8f5e9; /* Light Green */
    padding: 2rem;
    border-radius: 12px;
    border: 2px dashed #a5d6a7;
    margin: 1rem 0;
    text-align: center;
    animation: fadeIn 0.5s ease-out;
  }
  .pre-state {
    background: #f1f3f5; /* Light Greyish Blue */
    padding: 1.5rem;
    border-radius: 12px;
    border: 1px solid var(--border);
  }
  .finished-state h3 {
    color: #2e7d32;
    margin-bottom: 0.5rem;
  }
  .finished-state p {
    color: #4caf50;
    margin-bottom: 1.5rem;
  }

  @keyframes fadeIn {
    from {
      opacity: 0;
      transform: translateY(10px);
    }
    to {
      opacity: 1;
      transform: translateY(0);
    }
  }

  .phase-title {
    font-size: 1.5rem;
    font-weight: 800;
    margin-bottom: 1rem;
    text-align: center;
    color: var(--dark);
    letter-spacing: 1px;
    border-bottom: 2px solid var(--border);
    padding-bottom: 0.5rem;
  }

  .divider {
    border: 0;
    border-top: 2px solid var(--border);
    margin: 1rem 0;
  }
  .divider-sm {
    border: 0;
    border-top: 1px solid var(--border);
    margin: 1rem 0;
  }

  /* Buttons */
  .btn {
    border: 1px solid transparent;
    border-radius: 6px;
    padding: 0.4rem 0.8rem;
    font-size: 0.95rem;
    cursor: pointer;
    transition: all 0.2s;
    background: #e9ecef;
  }
  .btn:active {
    transform: scale(0.98);
  }
  .btn-primary {
    background: var(--primary);
    color: white;
  }
  .btn-secondary {
    background: var(--secondary);
    color: white;
  }
  .btn-success {
    background: var(--success);
    color: white;
  }
  .btn-danger {
    background: var(--danger);
    color: white;
  }
  .btn-warning {
    background: var(--warning);
    color: black;
  }
  .btn-outline {
    background: white;
    border-color: var(--border);
  }

  .btn-outline-primary {
    background: white;
    border: 1px solid var(--primary);
    color: var(--primary);
  }

  .active {
    background: #e0e0e0 !important;
    color: black !important;
    border-color: #adb5bd !important;
  }

  .btn-selected {
    background: #6c757d !important;
    color: white !important;
  }

  .btn-row {
    display: flex;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-bottom: 0.5rem;
  }
  .big-btn {
    flex: 1;
    min-width: 80px;
    padding: 0.75rem 0.5rem;
    font-size: 0.9rem;
  }
  .action-btn {
    padding: 0.8rem;
    font-size: 1.1rem;
    font-weight: bold;
    text-transform: uppercase;
    letter-spacing: 1px;
  }

  /* Teleop Specific */
  .teleop-config {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .chip-grid {
    display: flex;
    flex-wrap: wrap;
    gap: 0.5rem;
  }
  .chip {
    border: 1px solid var(--border);
    background: white;
    border-radius: 20px;
    padding: 0.25rem 0.75rem;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .shift-chip.on {
    background-color: #5dade2 !important; /* Softer blue */
    color: white !important;
    border-color: var(--border) !important;
  }
  .shift-chip.off {
    background-color: #ec7063 !important; /* Softer red */
    color: white !important;
    border-color: var(--border) !important;
  }

  /* Sliders */
  .range-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.7rem;
    color: var(--secondary);
    margin-top: 0.25rem;
  }
  .current-val {
    text-align: center;
    font-weight: 500;
    font-size: 0.75rem;
    color: var(--secondary);
    margin-top: -0.25rem;
  }
  .slider {
    width: 100%;
    margin: 0.5rem 0;
  }

  /* Logs */
  .mini-log {
    margin-top: 2rem;
    border-top: 1px solid var(--border);
    padding-top: 0.5rem;
    opacity: 0.8;
  }
  .log-header {
    font-size: 0.8rem;
    font-weight: bold;
    text-transform: uppercase;
    color: var(--secondary);
  }
  .log-entries {
    display: flex;
    flex-direction: column;
    gap: 2px;
  }
  .log-entry {
    font-size: 0.75rem;
    font-family: monospace;
  }

  /* Events View */
  .event-list {
    display: flex;
    flex-direction: column;
  }
  .event-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem;
    border-bottom: 1px solid var(--border);
  }
  .badg {
    font-size: 0.7rem;
    background: #eee;
    padding: 2px 4px;
    border-radius: 4px;
    text-transform: uppercase;
  }
  .match-badge {
    font-size: 0.7rem;
    background: var(--dark);
    color: white;
    padding: 2px 4px;
    border-radius: 4px;
  }
  .role-badge {
    font-size: 0.7rem;
    background: #d4e6f1;
    color: #1b4f72;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: bold;
  }
  .shift-badge {
    font-size: 0.7rem;
    padding: 2px 6px;
    border-radius: 10px;
    font-weight: bold;
  }
  .shift-badge.on {
    background: #d5f5e3;
    color: #186a3b;
  }
  .shift-badge.off {
    background: #fadbd8;
    color: #78281f;
  }
  .time {
    margin-left: auto;
    font-size: 0.75rem;
    color: var(--secondary);
  }

  /* Responsive */
  @media (max-width: 600px) {
    .page-header {
      flex-direction: column;
      align-items: stretch;
    }
    .page-actions {
      flex-direction: column;
    }
    .page-actions .form-group,
    .page-actions .row {
      width: 100%;
    }
    .row select,
    .row button {
      flex: 1;
    }

    .console-header {
      flex-wrap: wrap;
      gap: 0.5rem;
      align-items: center;
    }
    .info-block {
      width: auto;
      flex: 1;
    }
    .info-block:nth-child(2) {
      width: 100%;
      order: -1;
      margin-bottom: 0.25rem;
    }
    .undo-block {
      border-left: none;
      padding-left: 0;
      flex: 0 0 auto;
    }
    .undo-btn,
    .phase-badge {
      padding: 0.25rem 0.6rem;
      font-size: 0.75rem;
      width: auto;
      min-width: 50px;
    }
    .info-block .val {
      font-size: 1rem;
    }
    .info-block .label {
      font-size: 0.65rem;
    }

    .big-btn {
      min-width: 45%;
      padding: 0.5rem 0.25rem;
      font-size: 0.85rem;
    }
    .action-btn {
      padding: 0.75rem;
      font-size: 1rem;
    }
    .btn {
      padding: 0.35rem 0.75rem;
      font-size: 0.85rem;
    }
    .spacer {
      height: 1rem;
    }
  }

  /* Animation Styles */
  .animation-stage {
    display: flex;
    align-items: flex-end; /* Align robot to bottom */
    background: #f8f9fa;
    border: 1px solid var(--border);
    border-radius: 4px;
    height: var(--stage-height);
    width: var(--stage-width);
    max-width: 100%;
    margin: 0 auto 0.5rem auto; /* Centered */
    position: relative;
    overflow: hidden;
    margin-bottom: 0.5rem;
    padding: 0;
  }
  .robot-box {
    font-size: 2rem;
    z-index: 2;
    position: absolute;
    bottom: 10px;
    left: 10px;
  }
  .projectile-x {
    position: absolute;
    left: 40px;
    bottom: 30px;
    animation-name: shoot-ball-x;
    animation-timing-function: linear;
    animation-iteration-count: infinite;
    z-index: 1;
  }
  .projectile-y {
    font-size: var(--ball-size);
    animation-name: shoot-ball-y;
    animation-duration: inherit;
    animation-iteration-count: infinite;
  }

  @keyframes shoot-ball-x {
    0% {
      transform: translateX(0);
      opacity: 0;
    }
    10% {
      opacity: 1;
    }
    100% {
      transform: translateX(var(--full-travel));
      opacity: 1; /* Don't fade out, let the container clip it */
    }
  }

  @keyframes shoot-ball-y {
    0% {
      transform: translateY(0);
      animation-timing-function: cubic-bezier(0.33, 1, 0.68, 1); /* Quick up */
    }
    50% {
      transform: translateY(var(--ball-peak));
      animation-timing-function: cubic-bezier(
        0.32,
        0,
        0.67,
        0
      ); /* Gravity fall */
    }
    100% {
      transform: translateY(0);
    }
  }

  .flex-1 {
    flex: 1;
  }
</style>
