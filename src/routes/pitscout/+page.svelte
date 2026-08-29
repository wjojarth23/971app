<script>
  import { onMount } from 'svelte';
  import { AlertTriangle, Bot, Check, ClipboardPlus, FileText, Plus, Trash2, Wrench } from 'lucide-svelte';

  const PIT_PROBLEM_KEY = '971app.pit-problems';
  const PIT_DRAFT_KEY = '971app.pit-scout-draft';
  const ARCHETYPES = ['Cycle robot', 'Shooter', 'Defender', 'Climber', 'Hybrid'];
  const DRIVEBASES = ['Swerve', 'Tank', 'Other'];
  const SCORING_ROLES = ['Floor intake', 'Human player', 'Speaker', 'Amp', 'Defense'];

  let activeTab = 'profile';
  let teamNumber = '';
  let robotName = '';
  let archetype = '';
  let drivebase = '';
  let scoringRoles = [];
  let climb = '';
  let profileNotes = '';
  let additionalNotes = '';
  let problems = [];
  let saved = false;
  let newProblem = { summary: '', detail: '', severity: 'watch' };

  $: hasTeam = teamNumber.trim().length > 0;
  $: activeProblems = problems.filter((problem) => !problem.resolved);
  $: resolvedProblems = problems.filter((problem) => problem.resolved);

  function toggleRole(role) {
    scoringRoles = scoringRoles.includes(role)
      ? scoringRoles.filter((item) => item !== role)
      : [...scoringRoles, role];
  }

  function saveDraft() {
    const draft = { teamNumber, robotName, archetype, drivebase, scoringRoles, climb, profileNotes, additionalNotes };
    window.localStorage.setItem(PIT_DRAFT_KEY, JSON.stringify(draft));
    saved = true;
    window.setTimeout(() => saved = false, 2200);
  }

  function loadProblems() {
    try {
      const stored = JSON.parse(window.localStorage.getItem(PIT_PROBLEM_KEY) || '[]');
      problems = Array.isArray(stored) ? stored : [];
    } catch {
      problems = [];
    }
  }

  function loadDraft() {
    try {
      const draft = JSON.parse(window.localStorage.getItem(PIT_DRAFT_KEY) || '{}');
      if (!draft || typeof draft !== 'object') return;
      teamNumber = String(draft.teamNumber || '');
      robotName = String(draft.robotName || '');
      archetype = ARCHETYPES.includes(draft.archetype) ? draft.archetype : '';
      drivebase = DRIVEBASES.includes(draft.drivebase) ? draft.drivebase : '';
      scoringRoles = Array.isArray(draft.scoringRoles) ? SCORING_ROLES.filter((role) => draft.scoringRoles.includes(role)) : [];
      climb = ['None', 'Level 1', 'Level 2', 'Level 3'].includes(draft.climb) ? draft.climb : '';
      profileNotes = String(draft.profileNotes || '');
      additionalNotes = String(draft.additionalNotes || '');
    } catch {
      // A malformed local draft should not block a new pit record.
    }
  }

  function persistProblems(nextProblems) {
    problems = nextProblems;
    window.localStorage.setItem(PIT_PROBLEM_KEY, JSON.stringify(nextProblems));
  }

  function addProblem() {
    if (!newProblem.summary.trim()) return;
    persistProblems([{
      id: crypto.randomUUID(),
      source: 'Pit scout',
      team: teamNumber.trim() || 'Unassigned',
      match: '',
      summary: newProblem.summary.trim(),
      detail: newProblem.detail.trim(),
      severity: newProblem.severity,
      createdAt: new Date().toISOString(),
      resolved: false
    }, ...problems]);
    newProblem = { summary: '', detail: '', severity: 'watch' };
  }

  function setResolved(id, resolved) {
    persistProblems(problems.map((problem) => problem.id === id ? { ...problem, resolved } : problem));
  }

  function removeProblem(id) {
    persistProblems(problems.filter((problem) => problem.id !== id));
  }

  function formatTime(value) {
    return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
  }

  onMount(() => {
    loadDraft();
    loadProblems();
    const onStorage = (event) => {
      if (event.key === PIT_PROBLEM_KEY) loadProblems();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  });
</script>

<svelte:head><title>Pit Scouting</title></svelte:head>

<main class="pit-page">
  <header class="page-header">
    <div class="header-content">
      <h1><Wrench size={22} /> Pit Scouting</h1>
      <p>Start a fresh robot profile, triage breakdown reports, and keep the pit crew aligned.</p>
    </div>
    <div class="team-status" class:ready={hasTeam}>
      <Bot size={17} />
      <span>{hasTeam ? `Team ${teamNumber}` : 'No robot selected'}</span>
    </div>
  </header>

  <div class="pit-layout">
    <aside class="pit-nav" aria-label="Pit scouting sections">
      <button class:active={activeTab === 'profile'} on:click={() => activeTab = 'profile'}>
        <ClipboardPlus size={18} /><span>Robot profile</span><small>01</small>
      </button>
      <button class:active={activeTab === 'problems'} on:click={() => activeTab = 'problems'}>
        <AlertTriangle size={18} /><span>Problems</span>{#if activeProblems.length}<b>{activeProblems.length}</b>{/if}
      </button>
      <button class:active={activeTab === 'notes'} on:click={() => activeTab = 'notes'}>
        <FileText size={18} /><span>Additional notes</span><small>03</small>
      </button>
    </aside>

    <section class="pit-workspace">
      {#if activeTab === 'profile'}
        <div class="section-heading">
          <div><span class="eyebrow">Robot profile</span></div>
          <span class="blank-chip">Blank record</span>
        </div>

        <div class="identity-grid">
          <label>Team number<input class="form-input" inputmode="numeric" placeholder="971" bind:value={teamNumber} /></label>
          <label>Robot name <span class="optional">optional</span><input class="form-input" placeholder="Robot nickname" bind:value={robotName} /></label>
        </div>

        <div class="form-section">
          <span class="field-label">Robot archetype</span>
          <p>Choose the role the robot is built to play most often.</p>
          <div class="choice-grid archetypes">
            {#each ARCHETYPES as option}
              <button class:chosen={archetype === option} on:click={() => archetype = option}>{option}</button>
            {/each}
          </div>
        </div>

        <div class="form-section split-section">
          <div>
            <span class="field-label">Drivetrain</span>
            <div class="choice-grid compact">{#each DRIVEBASES as option}<button class:chosen={drivebase === option} on:click={() => drivebase = option}>{option}</button>{/each}</div>
          </div>
          <div>
            <span class="field-label">Climb</span>
            <div class="choice-grid compact">{#each ['None', 'Level 1', 'Level 2', 'Level 3'] as option}<button class:chosen={climb === option} on:click={() => climb = option}>{option}</button>{/each}</div>
          </div>
        </div>

        <div class="form-section">
          <span class="field-label">Scoring capabilities</span>
          <div class="choice-grid">{#each SCORING_ROLES as option}<button class:chosen={scoringRoles.includes(option)} on:click={() => toggleRole(option)}>{option}</button>{/each}</div>
        </div>

        <label class="notes-field">Pit notes<textarea class="form-input" rows="6" placeholder="Mechanisms, strengths, limitations, and anything worth remembering." bind:value={profileNotes}></textarea></label>
        <footer class="workspace-footer"><span>{saved ? 'Draft kept in this browser.' : 'No team data is sent to the server.'}</span><button class="btn btn-primary" on:click={saveDraft}><Check size={16} /> Save local draft</button></footer>

      {:else if activeTab === 'problems'}
        <div class="section-heading">
          <div><span class="eyebrow">Problem desk</span><h2>Keep breakdowns visible</h2></div>
          <span class="problem-count">{activeProblems.length} open</span>
        </div>

        <div class="report-banner"><AlertTriangle size={18} /><div><strong>Match scout handoff</strong><span>Reports created in Match Scouting appear here on this device.</span></div></div>

        <div class="problem-list">
          {#if activeProblems.length}
            {#each activeProblems as problem}
              <article class="problem-card" class:urgent={problem.severity === 'urgent'}>
                <div class="problem-meta"><span class="severity {problem.severity}">{problem.severity}</span><span>{problem.source} · Team {problem.team}{problem.match ? ` · Match ${problem.match}` : ''}</span><time>{formatTime(problem.createdAt)}</time></div>
                <h3>{problem.summary}</h3>
                {#if problem.detail}<p>{problem.detail}</p>{/if}
                <div class="problem-actions"><button class="btn btn-sm" on:click={() => setResolved(problem.id, true)}><Check size={14} /> Mark resolved</button><button class="icon-button" title="Delete report" on:click={() => removeProblem(problem.id)}><Trash2 size={16} /></button></div>
              </article>
            {/each}
          {:else}
            <div class="empty-state"><AlertTriangle size={28} /><h3>No active problems</h3><p>Match scout reports and pit issues will collect here.</p></div>
          {/if}
        </div>

        <div class="manual-problem">
          <div><span class="eyebrow">Pit report</span><h3>Add a problem directly</h3></div>
          <div class="manual-grid"><label>Problem<input class="form-input" placeholder="Example: intake belt slipping" bind:value={newProblem.summary} /></label><label>Severity<select class="form-input" bind:value={newProblem.severity}><option value="watch">Watch</option><option value="urgent">Urgent</option></select></label></div>
          <label class="notes-field">Details<textarea class="form-input" rows="3" placeholder="What failed, and what should the pit crew check?" bind:value={newProblem.detail}></textarea></label>
          <button class="btn btn-primary" on:click={addProblem} disabled={!newProblem.summary.trim()}><Plus size={16} /> Add problem</button>
        </div>

        {#if resolvedProblems.length}<div class="resolved-list"><span class="field-label">Resolved today</span>{#each resolvedProblems as problem}<div><Check size={15} /> Team {problem.team}: {problem.summary}<button class="icon-button" title="Delete report" on:click={() => removeProblem(problem.id)}><Trash2 size={15} /></button></div>{/each}</div>{/if}

      {:else}
        <div class="section-heading"><div><span class="eyebrow">Additional notes</span><h2>What else should the drive team know?</h2></div><FileText size={20} /></div>
        <label class="large-notes">Freeform notes<textarea class="form-input" rows="14" placeholder="Add observations, strategic notes, pit conversations, or follow-up questions." bind:value={additionalNotes}></textarea></label>
        <footer class="workspace-footer"><span>{saved ? 'Draft kept in this browser.' : 'No team data is sent to the server.'}</span><button class="btn btn-primary" on:click={saveDraft}><Check size={16} /> Save local draft</button></footer>
      {/if}
    </section>
  </div>
</main>

<style>
  .pit-page { max-width:1160px; margin:0 auto; padding:var(--space-4); }
  h1,h2,h3,p { margin-top:0; } h1 { display:flex; align-items:center; gap:var(--gap-2); } h2 { margin-bottom:0; font-size:1.3rem; } h3 { margin-bottom:var(--space-2); font-size:1rem; }
  .team-status { display:flex; align-items:center; gap:var(--gap-2); border:1px solid var(--border); padding:var(--space-2) var(--space-3); color:var(--text-muted); font-size:.84rem; background:var(--surface-1); } .team-status.ready { border-color:var(--brand-gold-strong); color:var(--text); background:var(--brand-gold-soft); }
  .pit-layout { display:grid; grid-template-columns:13.5rem minmax(0,1fr); gap:var(--space-4); align-items:start; } .pit-nav { position:sticky; top:var(--space-4); display:grid; gap:var(--space-1); padding:var(--space-2); border:1px solid var(--border); background:var(--surface-1); } .pit-nav button { min-height:3.2rem; display:grid; grid-template-columns:1.4rem 1fr auto; align-items:center; gap:var(--gap-2); padding:var(--space-2); border:0; background:transparent; text-align:left; color:var(--text-muted); cursor:pointer; } .pit-nav button:hover,.pit-nav button.active { color:var(--text); background:var(--brand-gold-soft); } .pit-nav button.active { box-shadow:inset 3px 0 0 var(--brand-gold-strong); } .pit-nav small { font-size:.7rem; } .pit-nav b { min-width:1.35rem; height:1.35rem; display:grid; place-items:center; border-radius:50%; background:var(--red-base); color:white; font-size:.7rem; }
  .pit-workspace { min-height:42rem; padding:var(--space-5); border:1px solid var(--border); background:var(--surface-1); } .section-heading { display:flex; align-items:start; justify-content:space-between; gap:var(--gap-3); margin-bottom:var(--space-5); } .eyebrow,.field-label { color:var(--text-muted); font-size:.73rem; font-weight:700; letter-spacing:.04em; text-transform:uppercase; } .blank-chip,.problem-count { padding:.3rem .55rem; border:1px solid var(--border); color:var(--text-muted); font-size:.75rem; } .optional { font-weight:400; color:var(--text-muted); }
  label { display:grid; gap:var(--space-2); color:var(--text-muted); font-size:.8rem; } .identity-grid,.manual-grid { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-4); } .form-section { margin-top:var(--space-5); } .form-section p { margin:.35rem 0 var(--space-3); color:var(--text-muted); font-size:.86rem; } .split-section { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--space-5); } .choice-grid { display:flex; flex-wrap:wrap; gap:var(--gap-2); margin-top:var(--space-2); } .choice-grid button { min-height:var(--control-height); padding:0 var(--space-3); border:1px solid var(--border); border-radius:var(--radius-sm); background:var(--surface-1); color:var(--text); cursor:pointer; } .choice-grid button.chosen { border-color:var(--brand-gold-strong); background:var(--brand-gold-soft); font-weight:600; } .archetypes button { min-width:8.5rem; } .compact button { min-width:5rem; } .notes-field { margin-top:var(--space-5); } textarea { min-height:7rem; resize:vertical; } .workspace-footer { display:flex; align-items:center; justify-content:space-between; gap:var(--gap-3); margin-top:var(--space-6); padding-top:var(--space-4); border-top:1px solid var(--border); color:var(--text-muted); font-size:.82rem; } .workspace-footer .btn,.problem-actions .btn,.manual-problem .btn { display:inline-flex; align-items:center; gap:var(--gap-2); }
  .report-banner { display:flex; gap:var(--gap-3); align-items:start; padding:var(--space-3); border-left:3px solid var(--brand-gold-strong); background:var(--brand-gold-soft); margin-bottom:var(--space-4); } .report-banner strong,.report-banner span { display:block; } .report-banner span { margin-top:.15rem; color:var(--text-muted); font-size:.82rem; } .problem-list { display:grid; gap:var(--space-3); } .problem-card { padding:var(--space-4); border:1px solid var(--border); } .problem-card.urgent { border-left:3px solid var(--red-base); } .problem-card p { margin-bottom:var(--space-3); color:var(--text-muted); } .problem-meta { display:flex; flex-wrap:wrap; align-items:center; gap:var(--gap-2); margin-bottom:var(--space-3); color:var(--text-muted); font-size:.75rem; } .problem-meta time { margin-left:auto; } .severity { padding:.15rem .45rem; text-transform:uppercase; font-size:.65rem; font-weight:700; background:var(--surface-2); } .severity.urgent { background:var(--red-soft); color:var(--red-strong); } .severity.watch { background:var(--brand-gold-soft); } .problem-actions { display:flex; justify-content:space-between; align-items:center; } .icon-button { display:grid; place-items:center; width:2rem; height:2rem; border:0; background:transparent; color:var(--text-muted); cursor:pointer; } .icon-button:hover { color:var(--red-base); background:var(--surface-2); }
  .empty-state { min-height:12rem; display:grid; place-content:center; justify-items:center; text-align:center; border:1px dashed var(--border); color:var(--text-muted); } .empty-state h3 { margin:var(--space-2) 0 .2rem; color:var(--text); } .empty-state p { margin:0; font-size:.84rem; } .manual-problem { margin-top:var(--space-5); padding-top:var(--space-5); border-top:1px solid var(--border); } .manual-problem .btn { margin-top:var(--space-4); } .resolved-list { display:grid; gap:var(--space-2); margin-top:var(--space-5); } .resolved-list > div { display:flex; align-items:center; gap:var(--gap-2); color:var(--text-muted); font-size:.85rem; } .resolved-list .icon-button { margin-left:auto; }
  .large-notes textarea { min-height:24rem; } @media (max-width:760px) { .pit-page { padding:var(--space-3); } .pit-layout { grid-template-columns:1fr; } .pit-nav { position:static; grid-template-columns:repeat(3,1fr); } .pit-nav button { grid-template-columns:1fr; justify-items:center; text-align:center; min-height:4rem; } .pit-nav small,.pit-nav b { display:none; } .pit-workspace { padding:var(--space-4); } } @media (max-width:520px) { .page-header { align-items:flex-start; } .team-status { width:100%; justify-content:center; } .identity-grid,.manual-grid,.split-section { grid-template-columns:1fr; } .pit-nav span { font-size:.75rem; } .workspace-footer { align-items:stretch; flex-direction:column; } .workspace-footer .btn { justify-content:center; } .problem-meta time { width:100%; margin-left:0; } }
</style>
