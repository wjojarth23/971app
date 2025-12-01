<script>
  import { onMount } from 'svelte';
  import { userStore } from '$lib/stores/auth.js';
  import { getAuthHeader } from '$lib/supabase.js';
  import { hasPermission } from '$lib/permissions.js';
  import notescoutConfig from '$lib/notescout.json';
  import ScoutAssignmentPanel from '$lib/components/ScoutAssignmentPanel.svelte';
  let user; userStore.subscribe(v => user = v);
  $: canSeeDataAssignments = !!user && (user.role === 'admin' || hasPermission(user, 'DATA_SCOUT_ADMIN'));

  // Blue Alliance integration (simple client-side fetch). You must supply an API key via env and route proxy if needed.
  // For now we'll attempt direct fetch if a window global BLUE_ALLIANCE_KEY exists; otherwise instruct user.
  let matches = []; // full match objects
  let teamsCurrentMatch = []; // team keys for selected match
  let selectedMatchKey = '';
  let selectedMatch = null;
  let selectedTeam = '';
  let loadNote = '';
  let loadingMatches = false;

  let phase = 'pre'; // pre, auto, teleop, endgame, finished
  let startPosition = '';// center,left,right

  // possession state
  let coralInRobot = true; // starts true per spec
  let algaeInRobot = false;

  // toggles
  let playingDefense = false;
  let broken = false;

  // event log (local + fetched)
  let teamEvents = []; // viewed team events
  let scoutingEvents = []; // events recorded this session for selected match/team

  let teamsWithData = [];
  let selectedTeamForView = '';
  let viewMode = 'scout'; // scout | view

  const endgameOptions = ['Shallow climb','Deep climb','Park','None'];
  let chosenEndgame = '';

  function displayTeam(t){ return t ? String(t).replace(/^frc/i,'') : ''; }

  async function fetchMatches(){
    loadNote='';
    if(!notescoutConfig?.event_key){ loadNote='No event configured.'; return; }
    loadingMatches = true;
    try {
      // Use server-side proxy which reads TBA_API_KEY from server env (.env)
      // Server endpoint: /api/tba/event-matches?event_key=XXXX
      const res = await fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(notescoutConfig.event_key)}&comp_level=qm`);
      if(!res.ok){
        const js = await res.json().catch(()=>null);
        loadNote = js?.error || `Failed to load matches from server (${res.status})`;
        return;
      }
      const js = await res.json();
      if(!js?.success){ loadNote = js?.error || 'Failed to load matches from TBA'; return; }
      matches = (js.data || []).slice();
    }catch(e){ loadNote = e.message||'Load error'; }
    finally{ loadingMatches=false; }
  }

  function onSelectMatchByKey(){
    const m = matches.find(x=> x.key===selectedMatchKey);
    selectedMatch = m||null;
    if(m){
      teamsCurrentMatch = [...(m.alliances?.red?.team_keys||[]), ...(m.alliances?.blue?.team_keys||[])];
      selectedTeam = teamsCurrentMatch[0]||'';
    }else{
      teamsCurrentMatch = []; selectedTeam='';
    }
    resetSessionState();
  }

  function resetSessionState(){
    phase='pre'; startPosition=''; coralInRobot=true; algaeInRobot=false; playingDefense=false; broken=false; chosenEndgame=''; scoutingEvents=[]; }

  async function record(event_type, event_value){
    if(!selectedMatch || !selectedTeam) return;
    const payload={
      action:'record-event',
      match_key: selectedMatch.key,
      match_number: selectedMatch.match_number,
      team_key: selectedTeam,
      phase: phase,
      event_type, event_value,
      coral_in_robot: coralInRobot,
      algae_in_robot: algaeInRobot,
      user_id: user?.id || null
    };
    try{
      const res = await fetch('/datascout',{ method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(payload)});
      const data = await res.json();
      if(data?.success){ scoutingEvents.push(data.data); }
      else{ alert('Event save failed: '+(data?.error||'unknown')); }
    }catch(e){ alert('Event error: '+e.message); }
  }

  function chooseStart(pos){ startPosition=pos; record('auto_start_position', pos); }
  function beginAuto(){ phase='auto'; record('phase','begin_auto'); }
  function endAuto(){ phase='teleop'; record('phase','end_auto'); }
  function beginTeleop(){ if(phase!=='teleop'){ phase='teleop'; record('phase','begin_teleop'); }}
  function beginEndgame(){ if(phase!=='endgame'){ phase='endgame'; record('phase','begin_endgame'); }}
  function finishMatch(){ phase='finished'; record('phase','finish_match'); }

  // Coral actions
  function coralPlacement(level, result){
    // result: hit|miss; both consume coral
    record('coral_place', `${level}_${result}`);
    coralInRobot=false;
  }
  function coralIntake(source){ coralInRobot=true; record('coral_intake', source); }

  // Algae actions
  function algaeAcquire(source){ algaeInRobot=true; record('algae_acquire', source); }
  function algaeScore(target){ if(!algaeInRobot) return; record('algae_score', target); algaeInRobot=false; }

  function toggleDefense(){ playingDefense=!playingDefense; record(playingDefense? 'defense_start':'defense_end', null); }
  function toggleBroken(){ broken=!broken; record(broken? 'break':'fix', null); }
  function foul(type){ record(type==='major'?'foul_major':'foul_minor', null); }
  function setEndgame(opt){ chosenEndgame=opt; record('endgame_selection', opt); }

  async function loadTeamsWithData(){
    try{ const res= await fetch('/datascout?list_teams=1'); const data = await res.json(); if(data?.success){ teamsWithData = data.data||[]; selectedTeamForView=teamsWithData[0]||''; } }catch(e){}
  }

  async function viewTeamEvents(){ if(!selectedTeamForView) return; viewMode='view'; const res= await fetch('/datascout?team_key='+encodeURIComponent(selectedTeamForView)); const data= await res.json(); if(data?.success){ teamEvents=data.data||[]; } }

  function backToScout(){ viewMode='scout'; }

  // Assignment aware state
  let myAssignments = [];
  let nextAssignment = null;
  async function loadMyAssignments(){
    if(!user?.id) return;
    try {
      const res = await fetch(`/api/scout-assignments?scouting_type=data&mine=1&user_id=${encodeURIComponent(user.id)}`,
        { headers: await getAuthHeader() });
      const js = await res.json();
      if(js?.success){
        myAssignments = (js.data||[]).filter(r=> !r.completed_at);
        nextAssignment = myAssignments[0] || null;
      }
    }catch(e){ /* ignore */ }
  }
  function gotoNextAssignment(){ if(!nextAssignment) return; selectedMatchKey=nextAssignment.match_key; onSelectMatchByKey(); selectedTeam=nextAssignment.team_key; }
  onMount(()=>{ fetchMatches(); loadTeamsWithData(); loadMyAssignments(); });
</script>

<!-- Admin Assignment Panel -->
{#if canSeeDataAssignments}
  <ScoutAssignmentPanel scoutingType="data" permissionAdmin="DATA_SCOUT_ADMIN" memberPerm="DATA_SCOUT_MEMBER" />
{/if}
 
<div class="page-header card">
  <div>
    <h2 style="margin:0">Data Scouting</h2>
    {#if notescoutConfig?.event_key}
      <div class="form-label" style="margin-top:0.25rem">Event: {notescoutConfig.event_key}</div>
    {/if}
    {#if loadNote}<div class="note" style="margin-top:0.5rem">{loadNote}</div>{/if}
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
      <select id="matchSelect" class="form-select" bind:value={selectedMatchKey} on:change={onSelectMatchByKey} disabled={loadingMatches}>
        <option value="">-- choose match --</option>
        {#each matches as m}
          <option value={m.key}>{m.key.split('_').pop() || m.key}</option>
        {/each}
      </select>
    </div>
    <div class="form-group" style="min-width:200px">
      <label class="form-label" for="viewTeamSelect">View data for</label>
      <div style="display:flex; gap:0.5rem; align-items:center">
        <select id="viewTeamSelect" class="form-select" bind:value={selectedTeamForView}>
          <option value="">-- choose team --</option>
          {#each teamsWithData as t}<option value={t}>{displayTeam(t)}</option>{/each}
        </select>
        <button class="btn btn-secondary" on:click={viewTeamEvents} disabled={!selectedTeamForView}>View</button>
      </div>
    </div>
  </div>
</div>

{#if viewMode==='view'}
  <div class="card">
    <button class="btn btn-secondary" on:click={backToScout}>Back</button>
    <h3 style="margin:0.75rem 0 0">Events for {displayTeam(selectedTeamForView)}</h3>
    {#if teamEvents.length===0}<div class="empty">No events</div>{/if}
    <div>{#each teamEvents as e}
      <div style="border-bottom:1px solid var(--border); padding:0.5rem 0; font-size:0.9rem">
        <strong>{e.phase}</strong> – {e.event_type}{#if e.event_value}: {e.event_value}{/if}
        <span style="color:var(--secondary)"> ({new Date(e.created_at).toLocaleTimeString()})</span>
        <div style="font-size:0.7rem; opacity:0.7">C:{String(e.coral_in_robot)} A:{String(e.algae_in_robot)}</div>
      </div>
    {/each}</div>
  </div>
{:else}
  <div class="card">
    <h3 style="margin-top:0">Scouting Console</h3>
    {#if !selectedMatch}
      <div class="empty">Select a match above</div>
    {:else}
      <div class="grid grid-2" style="gap:1rem">
        <div>
          <div class="form-group">
            <div class="form-label">Match</div>
            <div><strong>{selectedMatch.key.split('_').pop()}</strong></div>
          </div>
          <div class="form-group">
            <label class="form-label" for="teamSelect">Team</label>
            <select id="teamSelect" class="form-select" bind:value={selectedTeam}>
              {#each teamsCurrentMatch as t}<option value={t}>{displayTeam(t)}</option>{/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="phaseDisplay">Phase</label>
            <div id="phaseDisplay" style="font-weight:600">{phase}</div>
          </div>

          {#if phase==='pre'}
            <div class="form-group">
              <div class="form-label">Autonomous Start Position</div>
              <div class="btn-row">
                {#each ['center','left','right'] as p}
                  <button class="btn {startPosition===p?'btn-primary':'btn-outline'}" on:click={() => chooseStart(p)}>{p}</button>
                {/each}
              </div>
            </div>
            <button class="btn btn-primary" disabled={!startPosition} on:click={beginAuto}>Begin Autonomous</button>
          {/if}

          {#if phase==='auto'}
            <div class="section">
              <h4>Coral (In Robot: {coralInRobot?'Yes':'No'})</h4>
              <div class="btn-row">
                {#each ['L1','L2','L3','L4'] as lvl}
                  <div class="btn-group">
                    <button class="btn btn-outline" disabled={!coralInRobot} on:click={() => coralPlacement(lvl,'hit')}>{lvl} Hit</button>
                    <button class="btn btn-outline" disabled={!coralInRobot} on:click={() => coralPlacement(lvl,'miss')}>{lvl} Miss</button>
                  </div>
                {/each}
              </div>
              <div class="btn-row">
                <button class="btn btn-secondary" on:click={() => coralIntake('hp')}>Coral HP</button>
                <button class="btn btn-secondary" on:click={() => coralIntake('ground')}>Coral Ground Intake</button>
              </div>
            </div>
            <div class="section">
              <h4>Algae (In Robot: {algaeInRobot?'Yes':'No'})</h4>
              <div class="btn-row">
                <button class="btn btn-outline" disabled={algaeInRobot} on:click={() => algaeAcquire('lollipop')}>Lollipop</button>
                <button class="btn btn-outline" disabled={algaeInRobot} on:click={() => algaeAcquire('ground')}>Ground</button>
                <button class="btn btn-outline" disabled={algaeInRobot} on:click={() => algaeAcquire('reef')}>Reef</button>
              </div>
              <div class="btn-row">
                <button class="btn btn-secondary" disabled={!algaeInRobot} on:click={() => algaeScore('processor')}>Processor</button>
                <button class="btn btn-secondary" disabled={!algaeInRobot} on:click={() => algaeScore('barge')}>Barge</button>
              </div>
            </div>
            <div class="section">
              <h4>Misc</h4>
              <div class="btn-row">
                <button class="btn {playingDefense?'btn-primary':'btn-outline'}" on:click={toggleDefense}>{playingDefense? 'End Defense':'Begin Defense'}</button>
                <button class="btn {broken?'btn-primary':'btn-outline'}" on:click={toggleBroken}>{broken? 'Fixed':'Break'}</button>
                <button class="btn btn-outline" on:click={() => foul('minor')}>Minor Foul</button>
                <button class="btn btn-outline" on:click={() => foul('major')}>Major Foul</button>
              </div>
            </div>
            <button class="btn btn-primary" on:click={endAuto}>End Auto</button>
          {/if}

          {#if phase==='teleop'}
            <div class="section">
              <h4>Coral (In Robot: {coralInRobot?'Yes':'No'})</h4>
              <div class="btn-row">
                {#each ['L1','L2','L3','L4'] as lvl}
                  <div class="btn-group">
                    <button class="btn btn-outline" disabled={!coralInRobot} on:click={() => coralPlacement(lvl,'hit')}>{lvl} Hit</button>
                    <button class="btn btn-outline" disabled={!coralInRobot} on:click={() => coralPlacement(lvl,'miss')}>{lvl} Miss</button>
                  </div>
                {/each}
              </div>
              <div class="btn-row">
                <button class="btn btn-secondary" on:click={() => coralIntake('hp')}>Coral HP</button>
                <button class="btn btn-secondary" on:click={() => coralIntake('ground')}>Coral Ground Intake</button>
              </div>
            </div>
            <div class="section">
              <h4>Algae (In Robot: {algaeInRobot?'Yes':'No'})</h4>
              <div class="btn-row">
                <button class="btn btn-outline" disabled={algaeInRobot} on:click={() => algaeAcquire('lollipop')}>Lollipop</button>
                <button class="btn btn-outline" disabled={algaeInRobot} on:click={() => algaeAcquire('ground')}>Ground</button>
                <button class="btn btn-outline" disabled={algaeInRobot} on:click={() => algaeAcquire('reef')}>Reef</button>
              </div>
              <div class="btn-row">
                <button class="btn btn-secondary" disabled={!algaeInRobot} on:click={() => algaeScore('processor')}>Processor</button>
                <button class="btn btn-secondary" disabled={!algaeInRobot} on:click={() => algaeScore('barge')}>Barge</button>
              </div>
            </div>
            <div class="section">
              <h4>Misc</h4>
              <div class="btn-row">
                <button class="btn {playingDefense?'btn-primary':'btn-outline'}" on:click={toggleDefense}>{playingDefense? 'End Defense':'Begin Defense'}</button>
                <button class="btn {broken?'btn-primary':'btn-outline'}" on:click={toggleBroken}>{broken? 'Fixed':'Break'}</button>
                <button class="btn btn-outline" on:click={() => foul('minor')}>Minor Foul</button>
                <button class="btn btn-outline" on:click={() => foul('major')}>Major Foul</button>
                <button class="btn btn-primary" on:click={beginEndgame}>Begin Endgame</button>
              </div>
            </div>
          {/if}

          {#if phase==='endgame'}
            <div class="section">
              <h4>Endgame Selection</h4>
              <div class="btn-row">
                {#each endgameOptions as opt}
                  <button class="btn {chosenEndgame===opt?'btn-primary':'btn-outline'}" on:click={() => setEndgame(opt)}>{opt}</button>
                {/each}
              </div>
            </div>
            <div class="btn-row">
              <button class="btn btn-outline" on:click={() => foul('minor')}>Minor Foul</button>
              <button class="btn btn-outline" on:click={() => foul('major')}>Major Foul</button>
              <button class="btn {broken?'btn-primary':'btn-outline'}" on:click={toggleBroken}>{broken? 'Fixed':'Break'}</button>
            </div>
            <button class="btn btn-primary" style="margin-top:0.75rem" on:click={finishMatch} disabled={!chosenEndgame}>End Game</button>
          {/if}

          {#if phase==='finished'}
            <div class="empty">Match finished. You can change match to start new session.</div>
          {/if}
        </div>
        <div>
          <h4 style="margin-top:0">Session Events</h4>
          {#if scoutingEvents.length===0}<div class="empty">No events yet</div>{/if}
          <div style="max-height:420px; overflow:auto; font-size:0.8rem">
            {#each [...scoutingEvents].reverse() as e}
              <div style="border-bottom:1px solid var(--border); padding:0.35rem 0">
                <strong>{e.phase}</strong> – {e.event_type}{#if e.event_value}: {e.event_value}{/if}
                <div style="font-size:0.65rem; opacity:0.7">C:{String(e.coral_in_robot)} A:{String(e.algae_in_robot)}</div>
              </div>
            {/each}
          </div>
        </div>
      </div>
    {/if}
  </div>
{/if}

<style>
  .btn-group { display: flex; gap: 0.25rem; }
  .section { margin-bottom: 1rem; padding-bottom: 0.5rem; border-bottom: 1px solid var(--border); }
  
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
    
    .btn-row {
      flex-wrap: wrap;
    }
    
    .btn-group {
      flex-direction: column;
      width: 100%;
    }
    
    .btn-group .btn {
      width: 100%;
    }
    
    .section h4 {
      font-size: 0.9rem;
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
    
    .btn-row .btn {
      flex: 1 1 calc(50% - 0.25rem);
      min-width: 0;
      font-size: 0.75rem;
      padding: var(--space-2);
    }
    
    .section {
      margin-bottom: 0.75rem;
    }
  }
</style>
