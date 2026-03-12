<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID } from '$lib/stores/user.js';
  import { goto } from '$app/navigation';

  const GENERAL_TYPES = ['CAD', 'Mechanical', 'Electrical', 'Software', 'Other'];
  const STATUS_OPTIONS = [
    { value: 'open', label: 'Open' },
    { value: 'in_progress', label: 'In Progress' },
    { value: 'file_uploaded', label: 'File Uploaded' },
    { value: 'under_review', label: 'Under Review' },
    { value: 'changes_requested', label: 'Changes Requested' },
    { value: 'approved', label: 'Approved' },
    { value: 'done', label: 'Done' },
    { value: 'closed', label: 'Closed' }
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
  let reviewingTask = null;
  let showCreateModal = false;
  let selectedTask = null;
  let uploadingDescriptionImage = false;
  let descriptionImageError = '';

  let form = {
    title: '',
    description: '',
    scope: 'general',
    general_type: 'CAD',
    subsystem_id: '',
    assignee_id: '',
    reviewer_id: '',
    needs_review: false,
    needs_manufacturing: false,
    deadline_at: ''
  };

  function formatPerson(person) {
    if (!person) return '';
    return person.full_name || person.email || person.id || 'Unknown';
  }

  function statusLabel(status) {
    return STATUS_OPTIONS.find((item) => item.value === status)?.label || status || 'Unknown';
  }

  function statusTone(status) {
    const tones = {
      open: 'pending',
      in_progress: 'progress',
      file_uploaded: 'progress',
      under_review: 'pending',
      changes_requested: 'risk',
      approved: 'ready',
      done: 'ready',
      closed: 'ready'
    };
    return tones[status] || 'pending';
  }

  function deadlineDisplay(value) {
    if (!value) return 'No deadline';
    try {
      return new Date(value).toLocaleString();
    } catch {
      return value;
    }
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
    syncAssigneeSelection();
  }

  async function loadTasks() {
    loading = true;
    apiError = '';
    try {
      const payload = await apiRequest('GET');
      hydrateBundle(payload?.data || {});
      if (!form.reviewer_id && user?.id) {
        form.reviewer_id = user.id;
      }
    } catch (error) {
      apiError = error.message || 'Failed to load tasks.';
    } finally {
      loading = false;
    }
  }

  onMount(async () => {
    const unsub = userStore.subscribe((value) => {
      user = value;
      if (!form.reviewer_id && user?.id) form.reviewer_id = user.id;
    });
    await loadUserFromUUID(supabase);
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user) {
      goto('/');
      return () => unsub?.();
    }
    await loadTasks();
    return () => unsub?.();
  });

  $: assigneeOptions =
    form.scope === 'subsystem'
      ? (subsystemMembers?.[form.subsystem_id] || [])
      : (generalCandidates?.[form.general_type] || []);

  $: reviewerOptions = (() => {
    const map = new Map();
    for (const t of tasks) {
      const options = [t?.assignee, t?.reviewer, t?.creator];
      for (const p of options) {
        if (p?.id && !map.has(p.id)) map.set(p.id, p);
      }
    }
    for (const sid of Object.keys(subsystemMembers || {})) {
      for (const p of subsystemMembers[sid] || []) {
        if (p?.id && !map.has(p.id)) map.set(p.id, p);
      }
    }
    for (const key of Object.keys(generalCandidates || {})) {
      for (const p of generalCandidates[key] || []) {
        if (p?.id && !map.has(p.id)) map.set(p.id, p);
      }
    }
    if (user?.id && !map.has(user.id)) {
      map.set(user.id, { id: user.id, full_name: user.full_name, email: user.email });
    }
    return [...map.values()].sort((a, b) => formatPerson(a).localeCompare(formatPerson(b), undefined, { sensitivity: 'base' }));
  })();

  function syncAssigneeSelection() {
    const options =
      form.scope === 'subsystem'
        ? (subsystemMembers?.[form.subsystem_id] || [])
        : (generalCandidates?.[form.general_type] || []);
    if (form.scope === 'subsystem' && !form.subsystem_id && subsystems.length > 0) {
      form = { ...form, subsystem_id: subsystems[0].id };
      return;
    }
    if (options.length > 0 && !options.some((opt) => opt.id === form.assignee_id)) {
      form = { ...form, assignee_id: options[0].id };
      return;
    }
    if (options.length === 0 && form.assignee_id) {
      form = { ...form, assignee_id: '' };
    }
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
        ...form,
        reviewer_id: form.needs_review ? form.reviewer_id : ''
      });
      hydrateBundle(payload?.data || {});
      info = 'Task created.';
      form = {
        ...form,
        title: '',
        description: '',
        needs_review: false,
        needs_manufacturing: false,
        deadline_at: ''
      };
      descriptionImageError = '';
      showCreateModal = false;
    } catch (error) {
      apiError = error.message || 'Failed to create task.';
    } finally {
      saving = false;
    }
  }

  function setQuickDeadline(hours) {
    const date = new Date(Date.now() + hours * 60 * 60 * 1000);
    const tzAdjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    form = { ...form, deadline_at: tzAdjusted };
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
      info = 'Task file uploaded.';
    } catch (error) {
      apiError = error.message || 'Failed to upload task file.';
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

  async function reviewTask(task, decision) {
    apiError = '';
    const shouldPromptForNotes = decision === 'changes_requested';
    const notes = shouldPromptForNotes ? prompt('Review notes (optional):') || '' : '';
    reviewingTask = task.id;
    try {
      const payload = await apiRequest('POST', {
        action: 'review',
        task_id: task.id,
        decision,
        notes
      });
      hydrateBundle(payload?.data || {});
      info = decision === 'approve' ? 'Task approved.' : 'Changes requested.';
    } catch (error) {
      apiError = error.message || 'Failed to submit review.';
    } finally {
      reviewingTask = null;
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
      info = 'Task attachment added to parts list.';
    } catch (error) {
      apiError = error.message || 'Failed to add task to parts list.';
    }
  }

  function canUpload(task) {
    return (task.needs_review || task.needs_manufacturing) && task.assignee_id === user?.id && !task.attachment_path;
  }

  function canReview(task) {
    return task.needs_review && task.reviewer_id === user?.id && task.status === 'under_review';
  }

  function canAddToParts(task) {
    if (!task.needs_manufacturing || !task.attachment_path || task.parts_id) return false;
    if (task.needs_review) return task.status === 'approved';
    return true;
  }

  function isOverdue(task) {
    if (!task?.deadline_at) return false;
    const due = new Date(task.deadline_at).getTime();
    if (!Number.isFinite(due)) return false;
    const finished = new Set(['approved', 'done', 'closed']);
    return Date.now() > due && !finished.has(task.status);
  }

  function openTaskDetails(task) {
    selectedTask = task;
  }

  function closeTaskDetails() {
    selectedTask = null;
  }
</script>

<svelte:head>
  <title>Tasks - 971 Hub</title>
</svelte:head>

<div class="container tasks-page">
  <div class="page-header">
    <div>
      <h1>Tasks</h1>
      {#if user?.frc_team}
        <p class="tasks-subtitle">Team-scoped view: Team {user.frc_team}</p>
      {/if}
    </div>
    <button class="btn btn-primary btn-sm" type="button" on:click={() => (showCreateModal = true)}>Create Task</button>
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
      aria-label="Close create task dialog"
      on:click|self={() => (showCreateModal = false)}
      on:keydown={(e) => e.key === 'Escape' && (showCreateModal = false)}
    >
      <section class="modal modal--wide" role="dialog" aria-modal="true" tabindex="0" on:click|stopPropagation>
        <div class="modal-header">
          <h2>Create Task</h2>
          <button
            type="button"
            class="modal-close-button"
            aria-label="Close create task dialog"
            on:click={() => (showCreateModal = false)}
          >
            x
          </button>
        </div>

        <div class="modal-body">
          <div class="form-grid">
            <label class="form-group">
              <span class="form-label">Task Name</span>
            <input class="form-input" bind:value={form.title} placeholder="Task title" />
          </label>
            <label class="form-group">
              <span class="form-label">Type Mode</span>
              <select class="form-select" bind:value={form.scope} on:change={syncAssigneeSelection}>
                <option value="general">General Type</option>
                <option value="subsystem">Subsystem</option>
              </select>
            </label>

            {#if form.scope === 'general'}
              <label class="form-group">
                <span class="form-label">General Type</span>
                <select class="form-select" bind:value={form.general_type} on:change={syncAssigneeSelection}>
                  {#each GENERAL_TYPES as type}
                    <option value={type}>{type}</option>
                  {/each}
                </select>
              </label>
            {:else}
              <label class="form-group">
                <span class="form-label">Subsystem</span>
                <select class="form-select" bind:value={form.subsystem_id} on:change={syncAssigneeSelection}>
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
              <span class="form-label">Assignee</span>
              <select class="form-select" bind:value={form.assignee_id}>
                {#if assigneeOptions.length === 0}
                  <option value="">No eligible members</option>
                {:else}
                  {#each assigneeOptions as member}
                    <option value={member.id}>{formatPerson(member)}</option>
                  {/each}
                {/if}
              </select>
            </label>

            {#if form.needs_review}
              <label class="form-group">
                <span class="form-label">Reviewer</span>
                <select class="form-select" bind:value={form.reviewer_id}>
                  {#each reviewerOptions as member}
                    <option value={member.id}>{formatPerson(member)}</option>
                  {/each}
                </select>
              </label>
            {/if}

            <label class="form-group">
              <span class="form-label">Deadline</span>
              <div class="deadline-row">
                <input class="form-input" type="datetime-local" bind:value={form.deadline_at} />
                <button class="btn btn-secondary btn-sm" type="button" on:click={() => setQuickDeadline(24)}>+24h</button>
                <button class="btn btn-secondary btn-sm" type="button" on:click={() => setQuickDeadline(48)}>+48h</button>
              </div>
            </label>
          </div>

          <label class="form-group">
            <span class="form-label">Description</span>
            <textarea class="form-input" rows="3" bind:value={form.description} placeholder="Task description"></textarea>
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
            <span class="meta-text muted">Photos are added to the description as links and shown inline on tasks.</span>
          </div>
          {#if descriptionImageError}
            <div class="error-message">{descriptionImageError}</div>
          {/if}

          <div class="check-row">
            <label class="checkbox-line">
              <input type="checkbox" bind:checked={form.needs_review} />
              Needs Review
            </label>
            <label class="checkbox-line">
              <input type="checkbox" bind:checked={form.needs_manufacturing} />
              Needs Manufacturing
            </label>
          </div>
        </div>

        <div class="modal-footer">
          <button class="btn btn-secondary btn-sm" type="button" on:click={() => (showCreateModal = false)}>Cancel</button>
          <button class="btn btn-primary btn-sm" type="button" disabled={saving} on:click={createTask}>
            {saving ? 'Creating...' : 'Create Task'}
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
      aria-label="Close task details dialog"
      on:click|self={closeTaskDetails}
      on:keydown={(e) => e.key === 'Escape' && closeTaskDetails()}
    >
      <section class="modal" role="dialog" aria-modal="true" tabindex="0" on:click|stopPropagation>
        <div class="modal-header">
          <h2>{selectedTask.title}</h2>
          <button
            type="button"
            class="modal-close-button"
            aria-label="Close task details dialog"
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
                  <img src={imageUrl} alt="Task photo" loading="lazy" />
                </a>
              {/each}
            </div>
          {/if}
        </div>
      </section>
    </div>
  {/if}

  <section class="section-card task-list-section">
    <h2>Task List</h2>
    {#if loading}
      <p>Loading tasks...</p>
    {:else if tasks.length === 0}
      <div class="empty-state">
        <h3>No tasks yet</h3>
        <p>Team {user?.frc_team || 'your team'} has no tasks yet.</p>
      </div>
    {:else}
      <div class="table-container">
        <table class="table">
          <thead>
            <tr>
              <th>Task</th>
              <th>Type</th>
              <th>Assignee</th>
              <th>Deadline</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {#each tasks as task (task.id)}
              <tr class:overdue={isOverdue(task)}>
                <td>
                  <button class="task-open-button" type="button" on:click={() => openTaskDetails(task)}>
                    <strong>{task.title}</strong>
                  </button>
                  {#if extractImageUrls(task.description).length > 0}
                    <div class="task-photo-grid">
                      {#each extractImageUrls(task.description) as imageUrl}
                        <a href={imageUrl} target="_blank" rel="noopener noreferrer">
                          <img src={imageUrl} alt="Task photo" loading="lazy" />
                        </a>
                      {/each}
                    </div>
                  {/if}
                  <div class="meta-text muted">Created by {formatPerson(task.creator)}</div>
                  {#if task.needs_review || task.needs_manufacturing}
                    <div class="meta-text muted">
                      {task.needs_review ? 'Review required' : ''}
                      {task.needs_review && task.needs_manufacturing ? ' | ' : ''}
                      {task.needs_manufacturing ? 'Manufacturing required' : ''}
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
                  <div>{formatPerson(task.assignee)}</div>
                  {#if task.needs_review}
                    <div class="meta-text muted">Reviewer: {formatPerson(task.reviewer)}</div>
                  {/if}
                </td>
                <td>{deadlineDisplay(task.deadline_at)}</td>
                <td>
                  <span class="status-pill status-{statusTone(task.status)}">{statusLabel(task.status)}</span>
                  {#if task.review_notes}
                    <div class="meta-text muted">Review notes: {task.review_notes}</div>
                  {/if}
                </td>
                <td>
                  <div class="action-stack">
                    {#if task.needs_review || task.needs_manufacturing}
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

                    {#if canReview(task)}
                      <button class="btn btn-primary btn-sm" type="button" on:click={() => reviewTask(task, 'approve')}>Approve</button>
                      <button class="btn btn-secondary btn-sm" type="button" on:click={() => reviewTask(task, 'changes_requested')}>Request Changes</button>
                    {/if}

                    {#if canAddToParts(task)}
                      <button class="btn btn-primary btn-sm" type="button" on:click={() => addToParts(task)}>Add To Parts List</button>
                    {/if}

                    {#if user?.id === task.assignee_id || user?.id === task.created_by || user?.id === task.reviewer_id}
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
  .task-open-button {
    all: unset;
    display: inline-flex;
    cursor: pointer;
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  .task-open-button:focus-visible {
    outline: 2px solid var(--focus-ring);
    outline-offset: 2px;
    border-radius: var(--radius-xs);
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
