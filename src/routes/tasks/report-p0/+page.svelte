<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID } from '$lib/stores/user.js';

  const GENERAL_TYPES = ['CAD', 'Mechanical', 'Electrical', 'Software', 'Other'];

  let loading = true;
  let saving = false;
  let user = null;
  let tasks = [];
  let subsystems = [];
  let subsystemMembers = {};
  let generalCandidates = {};
  let apiError = '';
  let info = '';
  let uploadingDescriptionImage = false;
  let descriptionImageError = '';
  let reportContext = null;

  function createDefaultForm() {
    return {
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
  }

  let form = createDefaultForm();

  function formatPerson(person) {
    if (!person) return '';
    return person.full_name || person.email || person.id || 'Unknown';
  }

  function toDatetimeLocalString(date) {
    const safeDate = date instanceof Date ? date : new Date(date);
    if (!Number.isFinite(safeDate.getTime())) return '';
    return new Date(safeDate.getTime() - safeDate.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  }

  function formatReportMoment(value) {
    if (!value) return '';
    try {
      return new Intl.DateTimeFormat('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }).format(new Date(value));
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

  function buildP0ReportForm(context = reportContext) {
    const base = createDefaultForm();
    base.general_type = 'Other';
    base.assignee_id = user?.id || '';
    base.reviewer_id = user?.id || '';
    base.deadline_at = toDatetimeLocalString(new Date(Date.now() + 24 * 60 * 60 * 1000));
    base.description = buildP0ReportDescription(context);
    return base;
  }

  function parseReportContext() {
    if (typeof window === 'undefined') return null;
    const url = new URL(window.location.href);
    return {
      source: url.searchParams.get('source') || '',
      plannerItemId: url.searchParams.get('planner_item_id') || '',
      practiceRuleId: url.searchParams.get('practice_rule_id') || '',
      practiceLabel: url.searchParams.get('practice_label') || 'Drive Practice',
      scheduledFor: url.searchParams.get('scheduled_for') || ''
    };
  }

  function applyReportContext(context) {
    reportContext = context;
    form = buildP0ReportForm(context);
    info = `P0 bug report form ready for ${context?.practiceLabel || 'drive practice'}.`;
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

  async function loadFormData() {
    loading = true;
    apiError = '';
    try {
      const payload = await apiRequest('GET');
      hydrateBundle(payload?.data || {});
      applyReportContext(parseReportContext());
    } catch (error) {
      apiError = error.message || 'Failed to load P0 bug form.';
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
    await loadFormData();
    return () => unsub?.();
  });

  $: assigneeOptions = (() => {
    const base =
      form.scope === 'subsystem'
        ? (subsystemMembers?.[form.subsystem_id] || [])
        : (generalCandidates?.[form.general_type] || []);
    if (!user?.id) return base;
    if (base.some((member) => member.id === user.id)) return base;
    return [
      { id: user.id, full_name: user.full_name, email: user.email },
      ...base
    ];
  })();

  $: reviewerOptions = (() => {
    const map = new Map();
    for (const task of tasks) {
      const options = [task?.assignee, task?.reviewer, task?.creator];
      for (const person of options) {
        if (person?.id && !map.has(person.id)) map.set(person.id, person);
      }
    }
    for (const sid of Object.keys(subsystemMembers || {})) {
      for (const person of subsystemMembers[sid] || []) {
        if (person?.id && !map.has(person.id)) map.set(person.id, person);
      }
    }
    for (const key of Object.keys(generalCandidates || {})) {
      for (const person of generalCandidates[key] || []) {
        if (person?.id && !map.has(person.id)) map.set(person.id, person);
      }
    }
    if (user?.id && !map.has(user.id)) {
      map.set(user.id, { id: user.id, full_name: user.full_name, email: user.email });
    }
    return [...map.values()].sort((a, b) => formatPerson(a).localeCompare(formatPerson(b), undefined, { sensitivity: 'base' }));
  })();

  function syncAssigneeSelection() {
    const options = assigneeOptions;
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

  $: if (reportContext && user?.id && !form.assignee_id) {
    form = { ...form, assignee_id: user.id, reviewer_id: form.reviewer_id || user.id };
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
      info = 'P0 bug created. Add another if you found more issues.';
      form = buildP0ReportForm(reportContext);
      descriptionImageError = '';
    } catch (error) {
      apiError = error.message || 'Failed to create P0 bug.';
    } finally {
      saving = false;
    }
  }

  function setQuickDeadline(hours) {
    const date = new Date(Date.now() + hours * 60 * 60 * 1000);
    const tzAdjusted = new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
    form = { ...form, deadline_at: tzAdjusted };
  }
</script>

<svelte:head>
  <title>Report P0 Bug - 971 Hub</title>
</svelte:head>

<div class="container tasks-page report-page">
  <div class="report-header">
    <div>
      <h1>Report P0 Bug</h1>
      <p class="tasks-subtitle">
        Drive practice: {reportContext?.practiceLabel || 'Drive Practice'}{reportContext?.scheduledFor ? ` - ended ${formatReportMoment(reportContext.scheduledFor)}` : ''}
      </p>
    </div>
    <div class="report-actions">
      {#if reportContext?.plannerItemId}
        <a class="btn btn-secondary btn-sm" href={`/planner?item=${reportContext.plannerItemId}`}>Open Planner Item</a>
      {/if}
      <a class="btn btn-secondary btn-sm" href="/tasks">Open Tasks</a>
    </div>
  </div>

  {#if apiError}
    <div class="task-feedback task-feedback-error">{apiError}</div>
  {/if}
  {#if info}
    <div class="task-feedback task-feedback-success">{info}</div>
  {/if}

  <section class="section-card report-card">
    {#if loading}
      <p>Loading P0 bug form...</p>
    {:else}
      <div class="task-feedback task-feedback-success">
        Use this form to log each P0 bug you found. Each submission creates a new item that will also appear on the planner P0 bug list.
      </div>

      <div class="form-grid">
        <label class="form-group">
          <span class="form-label">Bug Title</span>
          <input class="form-input" bind:value={form.title} placeholder="Short summary of the bug" />
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

      <label class="form-group description-group">
        <span class="form-label">Description</span>
        <textarea class="form-input" rows="10" bind:value={form.description} placeholder="What happened, how to reproduce it, and what was affected"></textarea>
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
        <div class="task-feedback task-feedback-error">{descriptionImageError}</div>
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

      <div class="report-footer">
        <button class="btn btn-primary btn-sm" type="button" disabled={saving} on:click={createTask}>
          {saving ? 'Creating...' : 'Add P0 Bug'}
        </button>
      </div>
    {/if}
  </section>
</div>

<style>
  .report-page {
    padding-top: var(--space-6);
    padding-bottom: var(--space-7);
    display: grid;
    gap: var(--gap-4);
  }
  .report-header {
    display: flex;
    justify-content: space-between;
    gap: var(--gap-3);
    align-items: flex-start;
    flex-wrap: wrap;
  }
  .report-actions {
    display: flex;
    gap: var(--gap-2);
    flex-wrap: wrap;
  }
  .tasks-subtitle {
    margin: var(--space-1) 0 0 0;
    color: var(--text-muted);
    font-size: var(--font-sm);
  }
  .report-card {
    display: grid;
    gap: var(--gap-3);
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
  .description-group {
    display: grid;
    gap: var(--gap-2);
  }
  .description-group textarea.form-input {
    min-height: 220px;
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
  .muted {
    color: var(--text-muted);
  }
  .report-footer {
    display: flex;
    justify-content: flex-end;
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
    .report-page {
      padding-top: var(--space-4);
    }
    .check-row {
      flex-direction: column;
      align-items: flex-start;
      gap: var(--gap-2);
    }
    .report-footer {
      justify-content: stretch;
    }
    .report-footer .btn {
      width: 100%;
    }
  }
</style>
