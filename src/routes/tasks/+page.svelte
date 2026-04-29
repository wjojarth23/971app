<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID } from '$lib/stores/user.js';
  import {
    formatPacific
  } from '$lib/timezone.js';
  import { goto } from '$app/navigation';

  const GENERAL_TYPES = ['CAD', 'Mechanical', 'Electrical', 'Software', 'Other'];
  const STATUS_OPTIONS = [
    { value: 'red', label: 'Red' },
    { value: 'yellow', label: 'Yellow' },
    { value: 'green', label: 'Green' },
    { value: 'completed', label: 'Completed' }
  ];

  let loading = true;
  let saving = false;
  let user = null;
  let tasks = [];
  let subsystems = [];
  let subsystemMembers = {};
  let generalCandidates = {};
  let apiError = '';
  let info = '';
  let uploadingByTask = {};
  let showCreateModal = false;
  let selectedTask = null;
  let uploadingDescriptionImage = false;
  let descriptionImageError = '';
  let p0ReportContext = null;

  function createDefaultForm() {
    return {
      title: '',
      description: '',
      scope: 'general',
      general_type: 'CAD',
      subsystem_id: '',
      owner_id: '',
      needs_manufacturing: false,
      status: 'red'
    };
  }

  let form = createDefaultForm();

  function formatPerson(person) {
    if (!person) return '';
    return person.full_name || person.email || person.id || 'Unknown';
  }

  function statusLabel(status) {
    return STATUS_OPTIONS.find((item) => item.value === status)?.label || status || 'Unknown';
  }

  function statusTone(status) {
    const tones = {
      red: 'risk',
      yellow: 'pending',
      green: 'ready',
      completed: 'ready'
    };
    return tones[status] || 'pending';
  }

  function formatReportMoment(value) {
    if (!value) return '';
    try {
      const formatted = formatPacific(value, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      });
      return formatted ? `${formatted} PT` : '';
    } catch {
      return String(value || '');
    }
  }

  function buildP0ReportDescription(context) {
    const practiceLabel = context?.practiceLabel || 'Drive Practice';
    const scheduledFor = formatReportMoment(context?.scheduledFor);
    const lines = [
      `P0 bug reported after ${practiceLabel}.`
    ];
    if (scheduledFor) lines.push(`Drive practice end: ${scheduledFor}`);
    lines.push('');
    lines.push('What happened?');
    lines.push('- ');
    lines.push('');
    lines.push('How can we reproduce it?');
    lines.push('- ');
    lines.push('');
    lines.push('What subsystem or workflow is affected?');
    lines.push('- ');
    return lines.join('\n');
  }

  function buildP0ReportForm(context = p0ReportContext) {
    const base = createDefaultForm();
    base.general_type = 'Other';
    base.owner_id = user?.id || '';
    base.description = buildP0ReportDescription(context);
    return base;
  }

  function parseP0ReportContext() {
    if (typeof window === 'undefined') return null;
    const url = new URL(window.location.href);
    if (url.searchParams.get('report_p0') !== '1') return null;
    return {
      source: url.searchParams.get('source') || '',
      practiceRuleId: url.searchParams.get('practice_rule_id') || '',
      practiceLabel: url.searchParams.get('practice_label') || 'Drive Practice',
      scheduledFor: url.searchParams.get('scheduled_for') || ''
    };
  }

  function applyP0ReportContext(context) {
    if (!context) return;
    p0ReportContext = context;
    form = buildP0ReportForm(context);
    showCreateModal = true;
    info = `P0 bug report form ready for ${context.practiceLabel || 'drive practice'}.`;
  }

  async function authHeader() {
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function apiRequest(method, body = null) {
    const headers = {
      'content-type': 'application/json',
      ...(await authHeader())
    };
    const response = await fetch('/api/tasks', {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Request failed (${response.status})`);
    }
    return payload;
  }

  function hydrateBundle(data) {
    tasks = data?.tasks || [];
    subsystems = data?.subsystems || [];
    subsystemMembers = data?.subsystem_members || {};
    generalCandidates = data?.general_candidates || {};
    syncOwnerSelection();
  }

  async function loadTasks() {
    loading = true;
    apiError = '';
    try {
      const payload = await apiRequest('GET');
      hydrateBundle(payload?.data || {});
    } catch (error) {
      apiError = error.message || 'Failed to load P0 bugs.';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    const unsub = userStore.subscribe((value) => {
      user = value;
    });
    await loadUserFromUUID(supabase);
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user) {
      goto('/');
      return () => unsub?.();
    }
    const legacyP0Context = parseP0ReportContext();
    if (legacyP0Context) {
      const params = new URLSearchParams({
        source: legacyP0Context.source || 'drive_practice',
        practice_rule_id: legacyP0Context.practiceRuleId || '',
        practice_label: legacyP0Context.practiceLabel || 'Drive Practice',
        scheduled_for: legacyP0Context.scheduledFor || ''
      });
      params.set('report_p0', '1');
      goto(`/tasks?${params.toString()}`, { replaceState: true });
      return () => unsub?.();
    }
    await loadTasks();
    applyP0ReportContext(parseP0ReportContext());
    return () => unsub?.();
  });

  $: ownerOptions = (() => {
    const base =
      form.scope === 'subsystem'
        ? (subsystemMembers?.[form.subsystem_id] || [])
        : (generalCandidates?.[form.general_type] || []);
    if (!p0ReportContext || !user?.id) return base;
    if (base.some((member) => member.id === user.id)) return base;
    return [
      { id: user.id, full_name: user.full_name, email: user.email },
      ...base
    ];
  })();

  function syncOwnerSelection() {
    const options = ownerOptions;
    if (form.scope === 'subsystem' && !form.subsystem_id && subsystems.length > 0) {
      form = { ...form, subsystem_id: subsystems[0].id };
      return;
    }
    if (options.length > 0 && !options.some((opt) => opt.id === form.owner_id)) {
      form = { ...form, owner_id: options[0].id };
      return;
    }
    if (options.length === 0 && form.owner_id) {
      form = { ...form, owner_id: '' };
    }
  }

  $: if (p0ReportContext && user?.id && !form.owner_id) {
    form = { ...form, owner_id: user.id };
  }

  function extractImageUrls(text) {
    const raw = String(text || '');
    const urlRegex = /https?:\/\/[^\s)]+/gi;
    const allowedExt = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.heic', '.heif'];
    const seen = new Set();
    const results = [];
    for (const match of raw.match(urlRegex) || []) {
      const cleaned = match.replace(/[),.;!?]+$/, '');
      const lower = cleaned.toLowerCase();
      const hasImageExt = allowedExt.some((ext) => lower.includes(ext));
      if (!hasImageExt) continue;
      if (seen.has(cleaned)) continue;
      seen.add(cleaned);
      results.push(cleaned);
    }
    return results;
  }

  function descriptionWithoutImageUrls(text) {
    const raw = String(text || '');
    const urls = extractImageUrls(raw);
    let cleaned = raw;
    for (const url of urls) {
      cleaned = cleaned.replaceAll(url, '').replaceAll(`Photo:`, 'Photo:');
    }
    return cleaned
      .split('\n')
      .map((line) => line.trimEnd())
      .filter((line, idx, arr) => line || (idx > 0 && arr[idx - 1]))
      .join('\n')
      .trim();
  }

  function addPhotoUrlToDescription(url) {
    const line = `Photo: ${url}`;
    const current = String(form.description || '').trim();
    const next = current ? `${current}\n${line}` : line;
    form = { ...form, description: next };
  }

  async function handleDescriptionPhotos(event) {
    const files = Array.from(event?.target?.files || []);
    if (!files.length || !user?.id || !user?.frc_team) return;
    uploadingDescriptionImage = true;
    descriptionImageError = '';

    try {
      for (const file of files) {
        if (!String(file.type || '').startsWith('image/')) continue;
        const safeName = String(file.name || 'task-photo').replace(/[^a-zA-Z0-9._-]/g, '_');
        const path = `${user.frc_team}/drafts/${user.id}/${Date.now()}_${safeName}`;
        const { error: uploadError } = await supabase.storage
          .from('task-description-images')
          .upload(path, file, {
            upsert: false,
            contentType: file.type || 'image/jpeg'
          });
        if (uploadError) throw uploadError;
        const { data: urlData } = supabase.storage.from('task-description-images').getPublicUrl(path);
        const publicUrl = String(urlData?.publicUrl || '').trim();
        if (publicUrl) addPhotoUrlToDescription(publicUrl);
      }
    } catch (error) {
      descriptionImageError = error?.message || 'Failed to upload image.';
    } finally {
      uploadingDescriptionImage = false;
      if (event?.target) event.target.value = '';
    }
  }

  async function createTask() {
    saving = true;
    apiError = '';
    info = '';
    try {
      const payload = await apiRequest('POST', {
        action: 'create',
        ...form
      });
      hydrateBundle(payload?.data || {});
      if (p0ReportContext) {
        info = 'P0 bug created. Add another if you found more issues.';
        form = buildP0ReportForm(p0ReportContext);
        showCreateModal = true;
      } else {
        info = 'P0 bug created.';
        form = createDefaultForm();
        showCreateModal = false;
      }
      descriptionImageError = '';
    } catch (error) {
      apiError = error.message || 'Failed to create P0 bug.';
    } finally {
      saving = false;
    }
  }

  async function setTaskStatus(task, status) {
    try {
      const payload = await apiRequest('POST', {
        action: 'set-status',
        task_id: task.id,
        status
      });
      hydrateBundle(payload?.data || {});
    } catch (error) {
      apiError = error.message || 'Failed to update status.';
    }
  }

  async function handleFileUpload(task, event) {
    const file = event?.target?.files?.[0];
    if (!file) return;
    uploadingByTask = { ...uploadingByTask, [task.id]: true };
    apiError = '';
    try {
      const safeName = String(file.name || 'task-file').replace(/[^a-zA-Z0-9._-]/g, '_');
      const path = `${task.frc_team}/${task.id}/${Date.now()}_${safeName}`;
      const { error: uploadError } = await supabase.storage
        .from('task-files')
        .upload(path, file, { upsert: false });
      if (uploadError) throw uploadError;

      const payload = await apiRequest('POST', {
        action: 'upload-file',
        task_id: task.id,
        attachment_path: path,
        attachment_name: file.name
      });
      hydrateBundle(payload?.data || {});
      info = 'P0 bug file uploaded.';
    } catch (error) {
      apiError = error.message || 'Failed to upload P0 bug file.';
    } finally {
      uploadingByTask = { ...uploadingByTask, [task.id]: false };
      if (event?.target) event.target.value = '';
    }
  }

  async function downloadTaskFile(task) {
    if (!task?.attachment_path) return;
    apiError = '';
    try {
      const { data, error } = await supabase.storage
        .from('task-files')
        .createSignedUrl(task.attachment_path, 3600);
      if (error) throw error;
      if (data?.signedUrl) window.open(data.signedUrl, '_blank', 'noopener,noreferrer');
    } catch (error) {
      apiError = error.message || 'Failed to open file.';
    }
  }

  async function addToParts(task) {
    apiError = '';
    const workflowByType = {
      CAD: 'mill',
      Mechanical: 'mill',
      Electrical: 'laser-cut',
      Software: '3d-print',
      Other: 'mill'
    };
    try {
      const payload = await apiRequest('POST', {
        action: 'add-to-parts',
        task_id: task.id,
        workflow: workflowByType[task.general_type] || 'mill'
      });
      hydrateBundle(payload?.data || {});
      info = 'Linked part created from this P0 bug.';
    } catch (error) {
      apiError = error.message || 'Failed to add this P0 bug to parts.';
    }
  }

  function canUpload(task) {
    return task.needs_manufacturing && (task.owner_id || task.assignee_id) === user?.id && !task.attachment_path;
  }

  function canAddToParts(task) {
    return !!task.needs_manufacturing && !!task.attachment_path && !task.parts_id;
  }

  function openTaskDetails(task) {
    selectedTask = task;
  }

  function closeTaskDetails() {
    selectedTask = null;
  }

  function rowCanOpenModal(target) {
    return !target?.closest?.('button, a, input, select, textarea, label');
  }

  function handleRowClick(event, task) {
    if (!rowCanOpenModal(event.target)) return;
    openTaskDetails(task);
  }

  function handleRowKeydown(event, task) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (!rowCanOpenModal(event.target)) return;
    event.preventDefault();
    openTaskDetails(task);
  }
</script>

<svelte:head>
  <title>P0 Bugs - 971 Hub</title>
</svelte:head>

<div class="container tasks-page">
  <div class="page-header">
    <div>
      <h1>P0 Bugs</h1>
      {#if user?.frc_team}
        <p class="tasks-subtitle">Team-scoped view: Team {user.frc_team}</p>
      {/if}
    </div>
    <button class="btn btn-primary btn-sm" type="button" on:click={() => p0ReportContext ? applyP0ReportContext(p0ReportContext) : (showCreateModal = true)}>{p0ReportContext ? 'Report P0 Bug' : 'Create P0 Bug'}</button>
  </div>

  {#if apiError}
    <div class="task-feedback task-feedback-error">{apiError}</div>
  {/if}
  {#if info}
    <div class="task-feedback task-feedback-success">{info}</div>
  {/if}

  {#if showCreateModal}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close create P0 bug dialog"
      on:click|self={() => (showCreateModal = false)}
      on:keydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
    >
      <section class="modal modal--wide" role="dialog" aria-modal="true" tabindex="0" on:click|stopPropagation>
        <div class="modal-header">
          <div>
            <h2>{p0ReportContext ? 'Report P0 Bug' : 'Create P0 Bug'}</h2>
            {#if p0ReportContext}
              <p class="tasks-subtitle">Drive practice: {p0ReportContext.practiceLabel}{p0ReportContext.scheduledFor ? ` - ended ${formatReportMoment(p0ReportContext.scheduledFor)}` : ''}</p>
            {/if}
          </div>
          <button
            type="button"
            class="modal-close-button"
            aria-label="Close create P0 bug dialog"
            on:click={() => (showCreateModal = false)}
          >
            x
          </button>
        </div>

        <div class="modal-body">
          {#if p0ReportContext}
            <div class="task-feedback task-feedback-success">
              Use this form to log each P0 bug you found. Each submission creates a new item that will also appear on the planner P0 bug list.
            </div>
          {/if}
            <div class="form-grid">
            <label class="form-group">
              <span class="form-label">Bug Title</span>
            <input class="form-input" bind:value={form.title} placeholder="Short summary of the bug" />
          </label>
            <label class="form-group">
              <span class="form-label">Type Mode</span>
              <select class="form-select" bind:value={form.scope} on:change={syncOwnerSelection}>
                <option value="general">General Type</option>
                <option value="subsystem">Subsystem</option>
              </select>
            </label>

            {#if form.scope === 'general'}
              <label class="form-group">
                <span class="form-label">General Type</span>
                <select class="form-select" bind:value={form.general_type} on:change={syncOwnerSelection}>
                  {#each GENERAL_TYPES as type}
                    <option value={type}>{type}</option>
                  {/each}
                </select>
              </label>
            {:else}
              <label class="form-group">
                <span class="form-label">Subsystem</span>
                <select class="form-select" bind:value={form.subsystem_id} on:change={syncOwnerSelection}>
                  {#if subsystems.length === 0}
                    <option value="">No subsystems on your team</option>
                  {:else}
                    {#each subsystems as subsystem}
                      <option value={subsystem.id}>{subsystem.name}</option>
                    {/each}
                  {/if}
                </select>
              </label>
            {/if}

            <label class="form-group">
              <span class="form-label">Owner</span>
              <select class="form-select" bind:value={form.owner_id}>
                {#if ownerOptions.length === 0}
                  <option value="">No eligible members</option>
                {:else}
                  {#each ownerOptions as member}
                    <option value={member.id}>{formatPerson(member)}</option>
                  {/each}
                {/if}
              </select>
            </label>
            <label class="form-group">
              <span class="form-label">Status</span>
              <select class="form-select" bind:value={form.status}>
                {#each STATUS_OPTIONS as option}
                  <option value={option.value}>{option.label}</option>
                {/each}
              </select>
            </label>
          </div>

          <label class="form-group">
            <span class="form-label">Description</span>
            <textarea class="form-input" rows="3" bind:value={form.description} placeholder={p0ReportContext ? 'What happened, how to reproduce it, and what was affected' : 'Task description'}></textarea>
          </label>
          <div class="photo-upload-row">
            <label class="btn btn-secondary btn-sm" class:disabled={uploadingDescriptionImage}>
              {uploadingDescriptionImage ? 'Uploading Photo...' : 'Attach / Take Photos'}
              <input
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                multiple
                disabled={uploadingDescriptionImage}
                on:change={handleDescriptionPhotos}
              />
            </label>
            <span class="meta-text muted">Photos are added to the description as links and shown inline on P0 bugs.</span>
          </div>
          {#if descriptionImageError}
            <div class="error-message">{descriptionImageError}</div>
          {/if}

          <div class="check-row">
            <label class="checkbox-line">
              <input type="checkbox" bind:checked={form.needs_manufacturing} />
              Needs Manufacturing
            </label>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary btn-sm" type="button" on:click={() => (showCreateModal = false)}>Cancel</button>
          <button class="btn btn-primary btn-sm" type="button" disabled={saving} on:click={createTask}>
            {saving ? 'Creating...' : 'Create P0 Bug'}
          </button>
        </div>
      </section>
    </div>
  {/if}

  {#if selectedTask}
    <div
      class="modal-backdrop"
      role="button"
      tabindex="0"
      aria-label="Close P0 bug details dialog"
      on:click|self={closeTaskDetails}
      on:keydown={(e) => e.key === 'Escape' && closeTaskDetails()}
    >
      <section class="modal" role="dialog" aria-modal="true" tabindex="0" on:click|stopPropagation>
        <div class="modal-header">
          <h2>{selectedTask.title}</h2>
          <button
            type="button"
            class="modal-close-button"
            aria-label="Close P0 bug details dialog"
            on:click={closeTaskDetails}
          >
            x
          </button>
        </div>
        <div class="modal-body">
          {#if descriptionWithoutImageUrls(selectedTask.description)}
            <p class="task-modal-description">{descriptionWithoutImageUrls(selectedTask.description)}</p>
          {:else}
            <p class="meta-text muted">No description provided.</p>
          {/if}
          {#if extractImageUrls(selectedTask.description).length > 0}
            <div class="task-photo-grid">
              {#each extractImageUrls(selectedTask.description) as imageUrl}
                <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                  <img src={imageUrl} alt="P0 bug photo" loading="lazy" />
                </a>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    </div>
  {/if}

  <section class="section-card task-list-section">
    <h2>P0 Bug List</h2>
    {#if loading}
      <p>Loading P0 bugs...</p>
    {:else if tasks.length === 0}
      <div class="empty-state">
        <h3>No P0 bugs yet</h3>
        <p>Team {user?.frc_team || 'your team'} has no P0 bugs yet.</p>
      </div>
    {:else}
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>P0 Bug</th>
              <th>Type</th>
              <th>Owner</th>
              <th>Created By</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each tasks as task (task.id)}
              <tr
                class="task-row"
                tabindex="0"
                role="button"
                aria-label={`Open details for ${task.title}`}
                on:click={(event) => handleRowClick(event, task)}
                on:keydown={(event) => handleRowKeydown(event, task)}
              >
                <td>
                  <strong>{task.title}</strong>
                  {#if task.needs_manufacturing}
                    <div class="meta-text muted">
                      Manufacturing required
                    </div>
                  {/if}
                </td>
                <td>
                  {#if task.scope === 'subsystem'}
                    Subsystem: {task.subsystem?.name || 'Unknown'}
                  {:else}
                    {task.general_type || 'General'}
                  {/if}
                </td>
                <td>
                  <div>{formatPerson(task.owner || task.assignee)}</div>
                </td>
                <td>{formatPerson(task.creator)}</td>
                <td>
                  <span class="status-pill status-{statusTone(task.status)}">{statusLabel(task.status)}</span>
                  {#if task.parts_id || (task.part_ids || []).length > 0}
                    <div class="meta-text muted">{(task.part_ids || []).length || 1} linked part{((task.part_ids || []).length || 1) === 1 ? '' : 's'}</div>
                  {/if}
                </td>
                <td>
                  <div class="action-stack">
                    {#if task.needs_manufacturing}
                      <label class="btn btn-secondary btn-sm" class:disabled={!canUpload(task) || !!uploadingByTask[task.id]}>
                        {uploadingByTask[task.id] ? 'Uploading...' : 'Upload File'}
                        <input
                          type="file"
                          hidden
                          disabled={!canUpload(task) || !!uploadingByTask[task.id]}
                          on:change={(event) => handleFileUpload(task, event)}
                        />
                      </label>
                    {/if}

                    {#if task.attachment_path}
                      <button class="btn btn-secondary btn-sm" type="button" on:click={() => downloadTaskFile(task)}>Open File</button>
                    {/if}

                    {#if canAddToParts(task)}
                      <button class="btn btn-primary btn-sm" type="button" on:click={() => addToParts(task)}>Add To Parts List</button>
                    {/if}

                    {#if user?.id === (task.owner_id || task.assignee_id) || user?.id === task.created_by}
                      <select class="form-select status-select" value={task.status} on:change={(event) => setTaskStatus(task, event.currentTarget.value)}>
                        {#each STATUS_OPTIONS as option}
                          <option value={option.value}>{option.label}</option>
                        {/each}
                      </select>
                    {/if}
                  </div>
                </td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
  </section>
</div>

<style>
  .tasks-page {
    padding-top: var(--space-6);
    padding-bottom: var(--space-7);
    display: grid;
    gap: var(--gap-4);
  }
  .tasks-subtitle {
    margin: var(--space-1) 0 0 0;
    color: var(--text-muted);
    font-size: var(--font-xs);
  }
  .muted {
    color: var(--text-muted);
  }
  .task-feedback {
    border-radius: var(--radius-lg);
    border: 1px solid var(--border);
    padding: var(--space-3) var(--space-4);
    font-size: var(--font-xs);
  }
  .task-feedback-error {
    background: var(--red-soft);
    border-color: var(--red-base);
    color: var(--red-strong);
  }
  .task-feedback-success {
    background: var(--green-soft);
    border-color: var(--green-base);
    color: var(--green-strong);
  }
  .form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-3);
  }
  .form-group {
    margin-bottom: 0;
  }
  .form-group textarea.form-input {
    min-height: 96px;
    padding-top: var(--space-3);
    padding-bottom: var(--space-3);
  }
  .deadline-row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--gap-2);
    align-items: center;
  }
  .check-row {
    display: flex;
    gap: var(--gap-4);
    align-items: center;
    flex-wrap: wrap;
  }
  .photo-upload-row {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    flex-wrap: wrap;
  }
  .checkbox-line {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    color: var(--text);
  }
  .meta-text {
    font-size: var(--font-xs);
  }
  .action-stack {
    display: grid;
    gap: var(--gap-2);
  }
  .status-select {
    min-width: 9rem;
  }
  .task-list-section h2 {
    margin: 0;
  }
  tr.overdue td {
    background: var(--brand-gold-soft);
  }
  .task-row {
    cursor: pointer;
  }
  .task-row:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
  }
  .task-modal-description {
    margin: 0;
    white-space: pre-wrap;
    line-height: 1.45;
  }
  .task-photo-grid {
    margin-top: var(--space-2);
    display: flex;
    gap: var(--gap-2);
    flex-wrap: wrap;
  }
  .task-photo-grid a {
    display: inline-flex;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    overflow: hidden;
    background: var(--surface-2);
  }
  .task-photo-grid img {
    width: 80px;
    height: 80px;
    object-fit: cover;
    display: block;
  }
  .status-pill {
    display: inline-flex;
    align-items: center;
    height: var(--control-height-sm);
    padding: 0 var(--space-2);
    border-radius: var(--radius-sm);
    font-size: var(--font-xs);
    font-weight: 600;
    border: 1px solid transparent;
  }
  .status-pending {
    background: var(--status-pending-bg);
    border-color: var(--status-pending-border);
    color: var(--status-pending-text);
  }
  .status-progress {
    background: var(--status-progress-bg);
    border-color: var(--status-progress-border);
    color: var(--status-progress-text);
  }
  .status-ready {
    background: var(--status-ready-bg);
    border-color: var(--status-ready-border);
    color: var(--status-ready-text);
  }
  .status-risk {
    background: var(--status-risk-bg);
    border-color: var(--status-risk-border);
    color: var(--status-risk-text);
  }
  @media (max-width: 900px) {
    .form-grid {
      grid-template-columns: 1fr;
    }
    .deadline-row {
      grid-template-columns: 1fr;
    }
  }
  @media (max-width: 768px) {
    .tasks-page {
      padding-top: var(--space-4);
    }
    .check-row {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--gap-2);
    }
  }
</style>
