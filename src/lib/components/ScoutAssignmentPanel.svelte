<script>
  import { onMount } from 'svelte';
  import { userStore } from '$lib/stores/auth.js';
  import { getAuthHeader } from '$lib/supabase.js';
  import notescoutConfig from '$lib/notescout.json';
  let user; userStore.subscribe(v=> user=v);

  export let scoutingType = 'data'; // 'data' | 'note'
  export let permissionAdmin = 'DATA_SCOUT_ADMIN';
  export let memberPerm = 'DATA_SCOUT_MEMBER';

  let matches = []; // simplified structure: { key, red:[], blue:[] }
  let assignments = {}; // key: match_key -> { team_key: { user_id, user_name } }
  let users = []; // eligible users
  let loading = false;
  let saving = false;
  let errorMsg = '';

  let showModal = false;
  let modalContext = { match_key:'', team_key:'', team_number:'', robot_color:'', alliance_index:0 };
  let selectedUserId = '';

  async function authFetch(url, options = {}) {
    const headers = {
      ...(options.headers || {}),
      ...(await getAuthHeader())
    };
    return fetch(url, { ...options, headers });
  }

  function canAdmin(){
    if(!user) return false;
    // Require explicit per-scouting-type permission (no admin bypass)
    const needed = scoutingType === 'note' ? 'NOTE_SCOUT_ADMIN' : 'DATA_SCOUT_ADMIN';
    return Array.isArray(user.permissions) && user.permissions.includes(needed);
  }
  $: isAdmin = canAdmin();
  let bootstrapped = false;
  // Debug admin gating in local console to verify visibility logic
  $: (typeof window !== 'undefined') && console.debug('[ScoutAssignmentPanel]', {
    scoutingType,
    isAdmin,
    role: user?.role,
    permissions: Array.isArray(user?.permissions) ? user.permissions : user?.permissions
  });

  async function loadEligibleUsers(){
    try {
      const res = await authFetch('/api/admin?action=list-users');
      const data = await res.json();
      if(data?.success){
        // filter by memberPerm
        users = (data.data||[]).filter(u => (u.role==='admin') || (Array.isArray(u.permissions) && u.permissions.includes(memberPerm)));
      }
    }catch(e){ /* ignore */ }
  }

  async function loadMatches(){
    if(!notescoutConfig?.event_key){ errorMsg='No event configured'; return; }
    try {
      loading = true; errorMsg='';
      const res = await fetch(`/api/tba/event-matches?event_key=${encodeURIComponent(notescoutConfig.event_key)}&comp_level=qm`);
      let data;
      try { data = await res.json(); } catch(parseErr){
        const text = await res.text();
        errorMsg = 'Non-JSON response ('+res.status+'): '+text.slice(0,100);
        return;
      }
      if(!data?.success){ errorMsg=data?.error||'Failed to load matches'; return; }
      matches = (data.data||[]).map(m=>({
        key: m.key,
        match_number: m.match_number,
        red: m.alliances?.red?.team_keys||[],
        blue: m.alliances?.blue?.team_keys||[]
      }));
    }catch(e){ errorMsg=e.message||'Load error'; }
    finally{ loading=false; }
  }

  async function loadAssignments(){
    try {
      const qs = new URLSearchParams({ scouting_type: scoutingType });
      const res = await authFetch(`/api/scout-assignments?${qs}`);
      const data = await res.json();
      if(data?.success){
        assignments = {};
        for(const row of data.data){
          if(!assignments[row.match_key]) assignments[row.match_key]={};
            assignments[row.match_key][row.team_key] = { user_id: row.assigned_user, user_name: row.user_name };
        }
      }
    }catch(e){ /* ignore */ }
  }

  function displayTeam(t){ return t? String(t).replace(/^frc/i,''):''; }

  function openAssign(match_key, team_key){
    modalContext = { match_key, team_key, team_number: displayTeam(team_key) };
    selectedUserId = assignments?.[match_key]?.[team_key]?.user_id || '';
    showModal=true;
  }

  async function saveAssignment(applyToAll=false){
    if(!selectedUserId){ return; }
    saving=true;
    try {
      if (applyToAll) {
        // Build items for every match where this team appears (use loaded matches from TBA)
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
          const res = await authFetch('/api/scout-assignments', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) });
          const data = await res.json();
          if(!data?.success){ alert('Save failed: '+(data?.error||'unknown')); }
          else { await loadAssignments(); showModal=false; }
        }
      } else {
        const body={ action: 'assign-single', scouting_type: scoutingType, match_key: modalContext.match_key, team_key: modalContext.team_key, user_id: selectedUserId };
  const res = await authFetch('/api/scout-assignments', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if(!data?.success){ alert('Save failed: '+(data?.error||'unknown')); }
        else { await loadAssignments(); showModal=false; }
      }
    }catch(e){ alert('Error: '+e.message); }
    finally{ saving=false; }
  }

  function randomize(){
    // Flatten all cells; assign eligible users round-robin ensuring per-match uniqueness
    const eligible = [...users];
    if(eligible.length===0) return;
    const newAssignments = {};
    for(const m of matches){
      const usedInMatch = new Set();
      const teams = [...m.blue, ...m.red];
      for(const t of teams){
        // pick a user not yet used this match
        const shuffled = [...eligible].sort(()=> Math.random()-0.5);
        const u = shuffled.find(x=> !usedInMatch.has(x.id));
        const chosen = u || shuffled[0];
        usedInMatch.add(chosen.id);
        if(!newAssignments[m.key]) newAssignments[m.key]={};
        newAssignments[m.key][t] = { user_id: chosen.id, user_name: chosen.full_name || chosen.email };
      }
    }
    // Bulk save via API
    bulkPersist(newAssignments);
  }

  async function bulkPersist(map){
    try{
      const list=[];
      for(const mk of Object.keys(map)){
        for(const tk of Object.keys(map[mk])){
          list.push({ match_key: mk, team_key: tk, user_id: map[mk][tk].user_id });
        }
      }
      const body={ action:'bulk-assign', scouting_type: scoutingType, items:list };
  const res = await authFetch('/api/scout-assignments', { method:'POST', headers:{ 'content-type':'application/json' }, body: JSON.stringify(body) });
      const data = await res.json();
      if(!data?.success){ alert('Bulk save failed: '+(data?.error||'unknown')); }
      else { await loadAssignments(); }
    }catch(e){ alert('Error: '+e.message); }
  }

  onMount(()=>{ if(isAdmin){ loadEligibleUsers(); loadMatches().then(loadAssignments); } });
  $: if (!bootstrapped && isAdmin) {
    bootstrapped = true;
    // Run loads once when admin status becomes true (after auth/profile arrives)
    loadEligibleUsers();
    loadMatches().then(loadAssignments);
  }
</script>

{#if canAdmin()}
  <div class="panel-header">
    <h3 style="margin:0">{scoutingType==='note'?'Note':'Data'} Scouting Assignments</h3>
    <div class="actions">
      <button class="btn btn-secondary" on:click={randomize} disabled={matches.length===0 || users.length===0}>Randomize</button>
      <button class="btn btn-outline" on:click={loadAssignments}>Refresh</button>
    </div>
  </div>
  {#if errorMsg}<div class="note" style="margin-bottom:0.5rem">{errorMsg}</div>{/if}
  <div class="scroll-x">
    <table class="assignment-table">
      <thead>
        <tr>
          <th colspan="3" class="alliance blue">Blue Alliance</th>
          <th colspan="3" class="alliance red">Red Alliance</th>
        </tr>
        <tr>
          {#each [1,2,3] as i}<th class="blue">B{i}</th>{/each}
          {#each [1,2,3] as i}<th class="red">R{i}</th>{/each}
        </tr>
      </thead>
      <tbody>
        {#each matches as m}
          <tr>
            {#each m.blue as t}
              <td class="cell blue" on:click={() => openAssign(m.key, t)}>
                <div class="team">{displayTeam(t)}</div>
                <div class="scout">{assignments?.[m.key]?.[t]?.user_name || '-'}</div>
              </td>
            {/each}
            {#each m.red as t}
              <td class="cell red" on:click={() => openAssign(m.key, t)}>
                <div class="team">{displayTeam(t)}</div>
                <div class="scout">{assignments?.[m.key]?.[t]?.user_name || '-'}</div>
              </td>
            {/each}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if showModal}
  <div class="modal-backdrop" role="button" tabindex="0" aria-label="Close assignment dialog" on:click={() => { if(!saving) showModal=false; }} on:keydown={(e)=> { if(e.key==='Escape' || e.key==='Enter' || e.key===' ') { e.preventDefault(); if(!saving) showModal=false; } }}></div>
  <div class="modal">
    <h4>Assign Scout – {modalContext.team_number}</h4>
    <select class="form-select" bind:value={selectedUserId} disabled={saving}>
      <option value="">-- choose user --</option>
      {#each users as u}
        <option value={u.id}>{u.full_name || u.email}</option>
      {/each}
    </select>
    <div class="btn-row" style="margin-top:0.75rem">
      <button class="btn btn-primary" disabled={!selectedUserId||saving} on:click={() => saveAssignment(false)}>Set for this Match</button>
      <button class="btn btn-secondary" disabled={!selectedUserId||saving} on:click={() => saveAssignment(true)}>Set for Robot</button>
      <button class="btn btn-outline" on:click={() => { if(!saving) showModal=false; }}>Close</button>
    </div>
  </div>
{/if}

<style>
  .panel-header{ display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; }
  .actions{ display:flex; gap:0.5rem; }
  .assignment-table{ border-collapse:separate; border-spacing:2px; }
  .assignment-table th, .assignment-table td{ padding:0.4rem; font-size:0.75rem; text-align:center; background:#fff; border:1px solid var(--border); min-width:70px; cursor:pointer; }
  .assignment-table th.alliance{ font-size:0.65rem; }
  .assignment-table .blue{ background:#e6f0ff; }
  .assignment-table .red{ background:#ffe6e6; }
  .assignment-table .team{ font-weight:700; }
  .assignment-table .scout{ font-size:0.6rem; margin-top:0.25rem; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; }
  .scroll-x{ overflow-x:auto; }
  .empty{ color:var(--secondary); padding:0.5rem; }
  .modal-backdrop{ position:fixed; left:0; top:0; right:0; bottom:0; background:rgba(0,0,0,0.4); }
  .modal{ position:fixed; top:50%; left:50%; transform:translate(-50%,-50%); background:#fff; padding:1rem; border-radius:8px; width:300px; box-shadow:0 4px 20px rgba(0,0,0,0.25); }
  .btn-row{ display:flex; flex-wrap:wrap; gap:0.5rem; }
</style>
