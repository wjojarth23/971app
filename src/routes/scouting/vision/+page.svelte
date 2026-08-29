<script>
  import { onMount } from 'svelte';
  import { Camera, ChevronRight, Eye, RefreshCw, ShieldAlert, Upload, Video, LayoutDashboard, UploadCloud } from 'lucide-svelte';
  import { getAuthHeader, supabase } from '$lib/supabase.js';
  import { fetchActiveScoutingEventKey } from '$lib/scoutingEvent.js';
  import { userStore } from '$lib/stores/auth.js';
  import { hasPermission } from '$lib/permissions.js';

  let user = null;
  userStore.subscribe((v) => { user = v; });
  $: canRelease = hasPermission(user, 'VISION_RELEASE');

  let matches = [];
  let selectedId = '';
  let detail = null;
  let loading = true;
  let error = '';
  let eventKey = '';
  let matchKey = '';
  let captureNotes = '';
  let cameraLabel = 'Full field';
  let cameraPosition = 'Elevated fixed tripod';
  let syncOffsetMs = 0;
  let homographyText = '';
  let files = [];
  let modelName = 'frc-vision-yolo';
  let modelVersion = 'v1';
  let confidenceFloor = 0.35;
  let busy = false;
  let reviewNotes = {};
  let trackTeamDraft = {};

  async function api(path = '', options = {}) {
    const headers = { ...(await getAuthHeader()), ...(options.headers || {}) };
    const response = await fetch(`/api/vision${path}`, { ...options, headers });
    const payload = await response.json().catch(() => null);
    if (!response.ok || !payload?.success) throw new Error(payload?.error || `Vision API failed (${response.status})`);
    return payload.data;
  }

  async function loadMatches() {
    loading = true;
    error = '';
    try {
      matches = await api();
      if (selectedId) await loadDetail(selectedId);
    } catch (exception) {
      error = exception.message;
    } finally {
      loading = false;
    }
  }

  async function loadDetail(id) {
    selectedId = id;
    detail = await api(`?id=${encodeURIComponent(id)}`);
    for (const track of detail.tracks || []) trackTeamDraft[track.id] = track.team_key || '';
  }

  async function post(body) {
    return api('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  }

  async function createMatch() {
    if (!eventKey || !matchKey) return;
    busy = true;
    try {
      const created = await post({ action: 'create-match', event_key: eventKey, match_key: matchKey, capture_notes: captureNotes });
      matchKey = '';
      captureNotes = '';
      await loadMatches();
      await loadDetail(created.id);
    } catch (exception) { error = exception.message; }
    finally { busy = false; }
  }

  async function uploadViews() {
    if (!selectedId || !files.length) return;
    busy = true;
    error = '';
    try {
      let homography = null;
      if (homographyText.trim()) {
        homography = JSON.parse(homographyText);
        if (!Array.isArray(homography) || homography.flat(Infinity).length !== 9) throw new Error('Homography must contain exactly nine numbers.');
      }
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const result = await post({
          action: 'add-view', vision_match_id: selectedId,
          label: files.length > 1 ? `${cameraLabel} ${index + 1}` : cameraLabel,
          camera_position: cameraPosition, file_name: file.name,
          sync_offset_ms: Number(syncOffsetMs) || 0, homography
        });
        const { error: uploadError } = await supabase.storage.from('vision-recordings').uploadToSignedUrl(result.upload.path, result.upload.token, file, { contentType: file.type || 'video/quicktime' });
        if (uploadError) throw uploadError;
      }
      files = [];
      await loadDetail(selectedId);
    } catch (exception) { error = exception.message; }
    finally { busy = false; }
  }

  async function queueRun() {
    busy = true;
    try {
      await post({ action: 'queue-run', vision_match_id: selectedId, model_name: modelName, model_version: modelVersion, config: { confidence_floor: Number(confidenceFloor) } });
      await loadMatches();
    } catch (exception) { error = exception.message; }
    finally { busy = false; }
  }

  let releasingRunId = '';
  async function releaseRun(run) {
    if (!confirm(`Release ${run.model_name} ${run.model_version}'s results into real scouting data? This cannot be undone.`)) return;
    releasingRunId = run.id;
    error = '';
    try {
      const result = await post({ action: 'release-run', run_id: run.id });
      await loadDetail(selectedId);
      import('$lib/toast.js').then((m) => m.toastActions.show(`Released ${result.released_count} scout_data_events row(s).`));
    } catch (exception) {
      error = exception.message;
    } finally {
      releasingRunId = '';
    }
  }

  async function resolveFlag(flag, status) {
    await post({ action: 'review', id: flag.id, status, review_notes: reviewNotes[flag.id] || '' });
    await loadDetail(selectedId);
  }

  async function saveTrackIdentity(track) {
    await post({ action: 'update-track', id: track.id, team_key: trackTeamDraft[track.id] });
    await loadDetail(selectedId);
  }

  onMount(async () => {
    eventKey = (await fetchActiveScoutingEventKey()) || '';
    await loadMatches();
  });
</script>

<svelte:head><title>Vision Review | Scouting</title></svelte:head>

<div class="page-header">
  <div class="header-content">
    <div class="secret-label"><ShieldAlert size={14} /> Restricted project</div>
    <h1><Eye size={22} /> Vision Scouting</h1>
    <p>Post-match multi-view ML processing, TBA reconciliation, and evidence-backed human review.</p>
  </div>
  <div class="actions">
    <a class="btn btn-sm" href="/scouting/vision/dashboard{eventKey ? `?event_key=${encodeURIComponent(eventKey)}` : ''}"><LayoutDashboard size={14} /> Event dashboard</a>
    <button class="btn btn-sm" on:click={loadMatches} disabled={loading}><RefreshCw size={14} /> Refresh</button>
  </div>
</div>

{#if error}<div class="error-container"><p>{error}</p></div>{/if}

<div class="vision-layout">
  <aside class="surface-card sidebar">
    <h2>Recordings</h2>
    <div class="create-form">
      <input class="form-input" placeholder="Event key" bind:value={eventKey} />
      <input class="form-input" placeholder="Match key (event_qm1)" bind:value={matchKey} />
      <textarea class="form-input" placeholder="Capture notes" bind:value={captureNotes}></textarea>
      <button class="btn btn-primary btn-sm" on:click={createMatch} disabled={busy || !eventKey || !matchKey}><Camera size={14} /> New match</button>
    </div>
    {#if loading}<p class="text-muted">Loading...</p>{/if}
    <div class="match-list">
      {#each matches as match}
        <button class:active={selectedId === match.id} on:click={() => loadDetail(match.id)}>
          <span><b>{match.match_key}</b><small>{match.status} · {match.vision_views?.[0]?.count || 0} views</small></span><ChevronRight size={14} />
        </button>
      {/each}
    </div>
  </aside>

  <main class="vision-main">
    {#if !detail}
      <div class="empty-state"><Video size={40} /><h3>Select or create a match</h3><p>Raw recordings and results are permission-restricted.</p></div>
    {:else}
      <section class="surface-card section">
        <h2>{detail.match.match_key} · Camera views</h2>
        <div class="view-list">{#each detail.views as view}<div><Video size={16} /><span><b>{view.label}</b><small>{view.camera_position || 'Position not recorded'} · offset {view.sync_offset_ms}ms</small></span>{#if view.signed_url}<video controls muted preload="metadata" src={view.signed_url} aria-label={`${view.label} evidence recording`}></video>{/if}</div>{/each}</div>
        <div class="upload-grid">
          <input class="form-input" placeholder="View label" bind:value={cameraLabel} />
          <input class="form-input" placeholder="Camera position" bind:value={cameraPosition} />
          <input class="form-input" type="number" bind:value={syncOffsetMs} title="Synchronization offset in milliseconds" />
          <input class="form-input" placeholder="3×3 homography JSON (optional)" bind:value={homographyText} />
          <input class="form-input" type="file" accept="video/*" multiple on:change={(event) => files = [...event.currentTarget.files]} />
          <button class="btn btn-sm" on:click={uploadViews} disabled={busy || !files.length}><Upload size={14} /> Upload {files.length || ''} view{files.length === 1 ? '' : 's'}</button>
        </div>
      </section>

      <section class="surface-card section">
        <h2>ML processing</h2>
        <div class="run-controls"><input class="form-input" bind:value={modelName} /><input class="form-input" bind:value={modelVersion} /><label>Confidence <input class="form-input" type="number" min="0" max="1" step="0.05" bind:value={confidenceFloor} /></label><button class="btn btn-primary btn-sm" on:click={queueRun} disabled={busy || !detail.views.length}>Queue run</button></div>
        <div class="run-list">{#each detail.runs as run}<span class={`status ${run.status}`}>
          {run.model_name} {run.model_version} · {run.status}{run.error ? ` · ${run.error}` : ''}
          {#if run.released_at}<em class="released-tag">released</em>
          {:else if run.status === 'complete' && canRelease}<button class="btn btn-sm btn-primary" on:click={() => releaseRun(run)} disabled={releasingRunId === run.id}><UploadCloud size={12} /> Release to scouting data</button>{/if}
        </span>{/each}</div>
      </section>

      {#if detail.tracks.length}
        <section class="surface-card section">
          <h2>Robot tracks & mobility</h2>
          <div class="table-wrap"><table><thead><tr><th>Team identity</th><th>Alliance</th><th>Confidence</th><th>Distance</th><th>P90 speed</th><th>Turn rate</th></tr></thead><tbody>
            {#each detail.tracks as track}<tr>
              <td><div class="identity-editor"><input class="form-input" placeholder="frc971" bind:value={trackTeamDraft[track.id]} /><button class="btn btn-sm" on:click={() => saveTrackIdentity(track)}>Save</button></div></td>
              <td>{track.alliance || '—'}</td><td>{Math.round(track.tracking_confidence * 100)}%</td>
              <td>{track.metrics?.distanceMeters?.toFixed?.(1) ?? '—'} m</td><td>{track.metrics?.p90SpeedMps?.toFixed?.(2) ?? '—'} m/s</td><td>{track.metrics?.p90TurnRateRadS?.toFixed?.(2) ?? '—'} rad/s</td>
            </tr>{/each}
          </tbody></table></div>
        </section>
      {/if}

      {#if detail.observations.length}
        <section class="surface-card section"><h2>Detected actions</h2><div class="observation-list">{#each detail.observations as observation}<div><b>{observation.observation_type.replaceAll('_', ' ')}</b><span>{observation.team_key || observation.alliance || 'unattributed'} · {(observation.started_ms / 1000).toFixed(1)}s · {Math.round(observation.confidence * 100)}%</span><code>{JSON.stringify(observation.value)}</code></div>{/each}</div></section>
      {/if}

      <section class="surface-card section">
        <h2>Human review ({detail.discrepancies.filter((flag) => flag.status === 'open').length} open)</h2>
        {#if !detail.discrepancies.length}<p class="text-muted">No discrepancies generated yet.</p>{/if}
        <div class="flag-list">{#each detail.discrepancies as flag}<article class:resolved={flag.status !== 'open'}><header><b>{flag.metric.replaceAll('_', ' ')}</b><span class={`severity ${flag.severity}`}>{flag.severity}</span></header><p>{flag.reason}</p><div class="values"><span>Vision: {JSON.stringify(flag.vision_value)}</span><span>TBA: {JSON.stringify(flag.reference_value)}</span></div><textarea class="form-input" placeholder="Review notes" bind:value={reviewNotes[flag.id]} disabled={flag.status !== 'open'}></textarea>{#if flag.status === 'open'}<div class="review-actions"><button class="btn btn-sm" on:click={() => resolveFlag(flag, 'accepted_vision')}>Accept Vision</button><button class="btn btn-sm" on:click={() => resolveFlag(flag, 'accepted_reference')}>Accept TBA</button><button class="btn btn-sm" on:click={() => resolveFlag(flag, 'unobservable')}>Unobservable</button><button class="btn btn-sm" on:click={() => resolveFlag(flag, 'dismissed')}>Dismiss</button></div>{:else}<small>Resolved: {flag.status}</small>{/if}</article>{/each}</div>
      </section>
    {/if}
  </main>
</div>

<style>
  .secret-label { display:inline-flex; gap:6px; align-items:center; color:var(--red, #c33); font-size:.75rem; text-transform:uppercase; letter-spacing:.08em; }
  h1 { display:flex; gap:var(--gap-2); align-items:center; }
  h2 { font-size:1rem; margin:0 0 var(--space-3); }
  .vision-layout { display:grid; grid-template-columns:18rem minmax(0,1fr); gap:var(--gap-4); }
  .sidebar,.section { padding:var(--space-4); }
  .create-form,.match-list,.vision-main,.view-list,.run-list,.observation-list,.flag-list { display:grid; gap:var(--space-2); }
  .match-list button { display:flex; justify-content:space-between; align-items:center; text-align:left; border:1px solid var(--border); border-radius:var(--radius-md); padding:var(--space-2); background:transparent; color:var(--text); cursor:pointer; }
  .match-list button.active { border-color:var(--brand-primary,#d9a413); background:var(--surface-2); }
  .match-list span,.view-list span { display:grid; }
  small { color:var(--text-muted); }
  .view-list > div { display:flex; align-items:center; gap:var(--gap-2); padding:var(--space-2); border-bottom:1px solid var(--border); }
  .view-list video { margin-left:auto; width:min(18rem,40%); max-height:10rem; background:#000; }
  .upload-grid,.run-controls { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:var(--gap-2); margin-top:var(--space-3); }
  .run-controls { grid-template-columns:1fr 1fr 10rem auto; align-items:end; }
  .run-controls label { display:grid; gap:var(--space-1); }
  .status { padding:var(--space-1) var(--space-2); border-radius:var(--radius-sm); background:var(--surface-2); display:inline-flex; align-items:center; gap:var(--gap-2); }
  .status.failed { color:var(--red,#c33); }
  .status button { display:inline-flex; align-items:center; gap:4px; }
  .released-tag { color:var(--brand-gold-base,#d9a413); font-style:normal; font-size:.75rem; text-transform:uppercase; letter-spacing:.05em; }
  .table-wrap { overflow:auto; } table { width:100%; border-collapse:collapse; } th,td { padding:var(--space-2); border-bottom:1px solid var(--border); text-align:left; white-space:nowrap; }
  .identity-editor { display:flex; gap:var(--gap-1); }
  .observation-list > div { display:grid; grid-template-columns:1fr 1fr auto; gap:var(--gap-2); padding:var(--space-2); border-bottom:1px solid var(--border); }
  .flag-list article { border:1px solid var(--border); border-left:4px solid var(--brand-gold-base,#d9a413); border-radius:var(--radius-md); padding:var(--space-3); }
  .flag-list article.resolved { opacity:.65; }
  .flag-list header,.values,.review-actions { display:flex; flex-wrap:wrap; justify-content:space-between; gap:var(--gap-2); }
  .severity { text-transform:uppercase; font-size:.7rem; } .severity.critical { color:var(--red,#c33); }
  .values { justify-content:flex-start; color:var(--text-muted); margin-bottom:var(--space-2); }
  .review-actions { justify-content:flex-start; margin-top:var(--space-2); }
  @media (max-width:900px) { .vision-layout { grid-template-columns:1fr; } .run-controls,.upload-grid { grid-template-columns:1fr; } }
</style>
