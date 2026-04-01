<script>
  import { onMount, tick } from 'svelte';
  import { goto } from '$app/navigation';
  import { Gantt, Willow } from 'wx-svelte-gantt';
  import { supabase, getAuthHeader } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID } from '$lib/stores/user.js';
  import PlannerBar from '$lib/components/planner/PlannerBar.svelte';
  import {
    createPlannerGanttScales,
    getPlannerGanttBounds,
    PLANNER_GANTT_ZOOM_LEVELS,
    setPlannerGanttCalendarRules
  } from '$lib/planner/gantt.js';
  import {
    PLANNER_CATEGORIES,
    PLANNER_CATEGORY_LABELS,
    PLANNER_CRITICAL_LABELS,
    PLANNER_CRITICAL_LEVELS,
    PLANNER_DEFAULT_TASK_DURATION_MINUTES,
    PLANNER_DRIVE_PRACTICE_CATEGORY,
    PLANNER_FIXING_TASK_MODE,
    PLANNER_RULE_TYPES,
    PLANNER_STANDARD_TASK_MODE,
    PLANNER_STATUSES,
    PLANNER_TIME_ZONE,
    PLANNER_TASK_MODE_LABELS,
    isPlannerDrivePracticeTask,
    isPlannerFixingTask
  } from '$lib/planner/constants.js';
  import { buildPlannerTaskUpdatePayload } from '$lib/planner/interaction.js';
  import {
    buildFullCycleTaskSteps,
    PLANNER_FULL_CYCLE_DEFAULT_TOTAL_MINUTES,
    PLANNER_FULL_CYCLE_MIN_TOTAL_MINUTES,
    PLANNER_FULL_CYCLE_TASK_TEMPLATE,
    PLANNER_SINGLE_STEP_TASK_TEMPLATE
  } from '$lib/planner/multi_step.js';
  import { formatPlannerDateTimeInputValue } from '$lib/planner/timezone.js';
  import { workingMinutesBetween } from '$lib/planner/schedule.js';
  import { toastActions } from '$lib/toast.js';

  const ganttTaskTypes = [
    { id: 'task', label: 'Task' },
    { id: 'milestone', label: 'Milestone' },
    { id: 'planner-green', label: 'Green Task' },
    { id: 'planner-yellow', label: 'Yellow Task' },
    { id: 'planner-red', label: 'Red Task' }
  ];

  const ganttColumns = [
    { id: 'text', header: 'Item', width: 240, flexgrow: 1 },
    { id: 'kind', header: 'Kind', width: 110, template: (_value, row) => row.kind === 'milestone' ? 'Milestone' : formatPlannerTaskType(row) },
    { id: 'owners_label', header: 'Owners / Bugs', width: 190, template: (_value, row) => row.kind === 'milestone' ? (row.accountable_name || 'Unassigned') : (row.owners_label || 'Unassigned') },
    { id: 'status', header: 'Status', width: 90, template: (_value, row) => String(row.status || 'green').replace(/^\w/, (char) => char.toUpperCase()) }
  ];
  const OWNER_SEARCH_RESULT_LIMIT = 8;
  const WEEKDAY_LABELS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const plannerDateTimeFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: PLANNER_TIME_ZONE,
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
  const plannerTaskWorkflowOptions = [
    { value: PLANNER_STANDARD_TASK_MODE, label: 'Single Step' },
    { value: PLANNER_FULL_CYCLE_TASK_TEMPLATE, label: 'Full Cycle' },
    { value: PLANNER_FIXING_TASK_MODE, label: 'Fixing' }
  ];

  let ganttApi = null;
  let loading = true;
  let saving = false;
  let user = null;
  let items = [];
  let dependencies = [];
  let calendarRules = [];
  let people = [];
  let p0Bugs = [];
  let warnings = [];
  let error = '';
  let info = '';
  let activeView = 'gantt';
  let showItemModal = false;
  let editingItemId = null;
  let dependencyTargetId = '';
  let showRuleModal = false;
  let editingRuleId = null;
  let pendingOpenItemId = null;
  let ganttZoomIndex = 1;
  let draft = createItemDraft('task');
  let ruleDraft = createRuleDraft('blocked');
  let ownerSearchQuery = '';
  let p0BugSearchQuery = '';

  function createItemDraft(kind = 'task') {
    return {
      kind,
      title: '',
      notes: '',
      task_mode: PLANNER_STANDARD_TASK_MODE,
      task_template: kind === 'task' ? PLANNER_SINGLE_STEP_TASK_TEMPLATE : '',
      category: kind === 'task' ? PLANNER_CATEGORIES[0] : '',
      status: 'green',
      critical_level: 3,
      duration_hours: 2,
      min_duration_hours: 0.5,
      manual_start_at: '',
      owner_ids: [],
      p0_bug_ids: [],
      accountable_user_id: ''
    };
  }

  function createRuleDraft(ruleType = 'blocked') {
    const normalizedRuleType = ruleType === 'blocked' ? 'blocked' : 'work_window';
    const isWorkWindow = normalizedRuleType === 'work_window';
    return {
      rule_type: normalizedRuleType,
      label: '',
      weekday: '',
      specific_date: '',
      starts_at: isWorkWindow ? '08:00' : '18:00',
      ends_at: isWorkWindow ? '17:00' : '19:00',
      enabled: true
    };
  }

  function formatPerson(person) {
    if (!person) return 'Unassigned';
    return person.full_name || person.email || person.id || 'Unknown';
  }

  function getPersonSearchText(person) {
    return [
      person?.full_name || '',
      person?.email || '',
      person?.id || ''
    ]
      .join(' ')
      .trim()
      .toLowerCase();
  }

  function formatStatus(status) {
    return String(status || 'green').replace(/^\w/, (char) => char.toUpperCase());
  }

  function formatCategory(category) {
    return PLANNER_CATEGORY_LABELS[category] || 'Unspecified';
  }

  function formatCritical(level) {
    return PLANNER_CRITICAL_LABELS[level] || `Level ${level || 3}`;
  }

  function formatRuleMode(ruleType) {
    if (ruleType === 'blocked') return 'Blocked Meeting';
    return 'Work Window';
  }

  function formatTimeValue(value) {
    const timeValue = String(value || '').slice(0, 5);
    return timeValue || '--:--';
  }

  function formatRuleWhen(rule) {
    if (rule?.specific_date) return rule.specific_date;
    if (rule?.weekday === 0 || rule?.weekday) return WEEKDAY_LABELS[rule.weekday] || 'Custom';
    return 'Custom';
  }

  function formatRuleWindow(rule) {
    return `${formatTimeValue(rule?.starts_at)} to ${formatTimeValue(rule?.ends_at)}`;
  }

  function isDrivePracticeItem(item) {
    return isPlannerDrivePracticeTask(item);
  }

  function isFixingItem(item) {
    return isPlannerFixingTask(item);
  }

  function formatPlannerTaskType(item) {
    if (!item || item.kind === 'milestone') return 'Milestone';
    if (isFixingItem(item)) return PLANNER_TASK_MODE_LABELS[PLANNER_FIXING_TASK_MODE];
    if (isDrivePracticeItem(item)) return formatCategory(item.category);
    return formatCategory(item.category);
  }

  function formatFixingBugSummary(item, maxTitles = 2) {
    const bugs = item?.p0_bugs || [];
    if (!bugs.length) return 'No linked P0 bugs';
    if (bugs.length === 1) return bugs[0]?.title || '1 P0 bug';
    const titles = bugs
      .map((bug) => String(bug?.title || '').trim())
      .filter(Boolean)
      .slice(0, maxTitles);
    if (bugs.length > maxTitles) {
      return `${titles.join(', ')} +${bugs.length - maxTitles} more`;
    }
    return titles.join(', ');
  }

  function getP0BugSearchText(bug) {
    return [
      bug?.title || '',
      formatP0BugType(bug),
      formatPerson(bug?.assignee),
      formatPerson(bug?.reviewer),
      bug?.id || ''
    ]
      .join(' ')
      .trim()
      .toLowerCase();
  }

  function formatBlockedRuleType(rule) {
    return rule?.rule_type === 'drive_practice' ? 'Legacy Drive Practice' : 'Meeting';
  }

  function formatHours(minutes) {
    const hours = Number(minutes || 0) / 60;
    return `${hours % 1 === 0 ? hours.toFixed(0) : hours.toFixed(1)}h`;
  }

  function formatTaskDuration(item) {
    const scheduledMinutes = Number(item?.duration_minutes || 0);
    const requestedMinutes = Number(item?.requested_duration_minutes || scheduledMinutes || 0);
    const scheduledLabel = formatHours(scheduledMinutes);
    if (requestedMinutes <= scheduledMinutes) return scheduledLabel;
    return `${scheduledLabel} of ${formatHours(requestedMinutes)} target`;
  }

  function formatDateTime(value) {
    if (!value) return 'Not scheduled';
    try {
      return plannerDateTimeFormatter.format(new Date(value));
    } catch {
      return value;
    }
  }

  function toDebugDate(value) {
    if (!value) return null;
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (!Number.isFinite(date.getTime())) return { raw: value };
    return {
      local: formatDateTime(date),
      iso: date.toISOString(),
      unix_ms: date.getTime()
    };
  }

  function toDebugDuration(minutes) {
    if (minutes === null || minutes === undefined || Number.isNaN(Number(minutes))) return null;
    const normalized = Number(minutes);
    return {
      minutes: normalized,
      hours: normalized / 60,
      label: formatHours(normalized)
    };
  }

  function createPlannerTaskDebugSnapshot(task, mode = 'source') {
    if (!task) return null;

    const isGanttTask = mode === 'gantt';
    const startValue = isGanttTask
      ? task.start
      : (task.scheduled_start_at || task.manual_start_at || null);
    const endValue = isGanttTask
      ? task.end
      : (task.scheduled_end_at || task.scheduled_start_at || task.manual_start_at || null);
    const computedDuration = startValue && endValue
      ? Math.max(30, workingMinutesBetween(startValue, endValue, calendarRules))
      : null;

    return {
      id: task.id,
      title: task.title || task.text || 'Untitled',
      kind: task.kind || task.type || 'task',
      status: task.status || null,
      manual_start_at: isGanttTask ? null : toDebugDate(task.manual_start_at),
      scheduled_start_at: isGanttTask ? null : toDebugDate(task.scheduled_start_at),
      scheduled_end_at: isGanttTask ? null : toDebugDate(task.scheduled_end_at),
      start: toDebugDate(startValue),
      end: toDebugDate(endValue),
      duration_minutes: toDebugDuration(isGanttTask ? computedDuration : Number(task.duration_minutes || 0)),
      requested_duration_minutes: isGanttTask ? null : toDebugDuration(Number(task.requested_duration_minutes || task.duration_minutes || 0))
    };
  }

  function getPlannerGanttUpdateType(payload) {
    const hasManualStart = Object.prototype.hasOwnProperty.call(payload || {}, 'manual_start_at');
    const hasDuration = Object.prototype.hasOwnProperty.call(payload || {}, 'duration_minutes');
    if (hasManualStart && hasDuration) return 'move+resize';
    if (hasManualStart) return 'move';
    if (hasDuration) return 'resize';
    return 'unknown';
  }

  function datesMatchForDebug(leftValue, rightValue) {
    if (!leftValue && !rightValue) return true;
    if (!leftValue || !rightValue) return false;
    const left = new Date(leftValue);
    const right = rightValue instanceof Date ? rightValue : new Date(rightValue);
    if (!Number.isFinite(left.getTime()) || !Number.isFinite(right.getTime())) return false;
    return left.getTime() === right.getTime();
  }

  function buildPlannerUpdatePersistenceCheck(updatedItem, payload) {
    const durationTarget = Number(payload?.duration_minutes);
    const requestedDuration = Number(updatedItem?.requested_duration_minutes ?? updatedItem?.duration_minutes ?? 0);

    return {
      item_found_in_response: !!updatedItem,
      manual_start_matched:
        !Object.prototype.hasOwnProperty.call(payload || {}, 'manual_start_at') ||
        datesMatchForDebug(updatedItem?.manual_start_at, payload?.manual_start_at),
      requested_duration_matched:
        !Object.prototype.hasOwnProperty.call(payload || {}, 'duration_minutes') ||
        requestedDuration === durationTarget
    };
  }

  function logPlannerGanttUpdate(stage, details = {}) {
    const label = `[Planner Gantt] ${stage}`;
    if (typeof console.groupCollapsed === 'function') {
      console.groupCollapsed(label);
      Object.entries(details).forEach(([key, value]) => console.log(key, value));
      console.groupEnd();
      return;
    }
    console.log(label, details);
  }

  function formatDeadline(value) {
    if (!value) return 'No deadline';
    try {
      return plannerDateTimeFormatter.format(new Date(value));
    } catch {
      return value;
    }
  }

  function formatP0BugType(bug) {
    if (bug?.scope === 'subsystem') return `Subsystem: ${bug?.subsystem?.name || 'Unknown'}`;
    return bug?.general_type || 'General';
  }

  function formatP0BugStatus(status) {
    const labels = {
      open: 'Open',
      in_progress: 'In Progress',
      file_uploaded: 'File Uploaded',
      under_review: 'Under Review',
      changes_requested: 'Changes Requested',
      approved: 'Approved',
      done: 'Done',
      closed: 'Closed'
    };
    return labels[String(status || '').trim().toLowerCase()] || status || 'Unknown';
  }

  function formatP0BugStatusTone(status) {
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
    return tones[String(status || '').trim().toLowerCase()] || 'pending';
  }

  function formatP0BugFlags(bug) {
    const flags = [];
    if (bug?.needs_review) flags.push('Review required');
    if (bug?.needs_manufacturing) flags.push('Manufacturing required');
    return flags;
  }

  function isPastDue(value) {
    if (!value) return false;
    const dueAt = new Date(value);
    if (!Number.isFinite(dueAt.getTime())) return false;
    return dueAt.getTime() < Date.now();
  }

  function toDatetimeLocal(value) {
    return value ? formatPlannerDateTimeInputValue(value) : '';
  }

  function handleTableRowKeydown(event, itemId) {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openItemModal(itemId);
  }

  async function plannerRequest(method = 'GET', body = null) {
    const headers = {
      ...(await getAuthHeader())
    };
    if (body) headers['content-type'] = 'application/json';

    const response = await fetch('/api/planner', {
      method,
      headers,
      ...(body ? { body: JSON.stringify(body) } : {})
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(payload?.error || `Planner request failed (${response.status})`);
    }
    return payload;
  }

  function hydrateBundle(data) {
    items = data?.items || [];
    dependencies = data?.dependencies || [];
    calendarRules = data?.calendar_rules || [];
    people = data?.people || [];
    p0Bugs = data?.p0_bugs || [];
    warnings = data?.warnings || [];
  }

  async function loadPlanner() {
    loading = true;
    error = '';
    try {
      const payload = await plannerRequest('GET');
      hydrateBundle(payload?.data || {});
    } catch (loadError) {
      error = loadError.message || 'Failed to load planner.';
    } finally {
      loading = false;
    }
  }

  async function submitPlannerAction(body, successMessage = '') {
    saving = true;
    error = '';
    info = '';
    try {
      const payload = await plannerRequest('POST', body);
      hydrateBundle(payload?.data || {});
      if (successMessage) info = successMessage;
      return payload;
    } catch (submitError) {
      error = submitError.message || 'Planner action failed.';
      throw submitError;
    } finally {
      saving = false;
    }
  }

  function openCreateItem(kind, overrides = {}) {
    editingItemId = null;
    dependencyTargetId = '';
    draft = {
      ...createItemDraft(kind),
      ...overrides
    };
    ownerSearchQuery = '';
    p0BugSearchQuery = '';
    if (kind === 'task' && user?.id && !(draft.owner_ids || []).length) draft.owner_ids = [user.id];
    if (kind === 'milestone' && user?.id) draft.accountable_user_id = user.id;
    showItemModal = true;
  }

  function openDrivePracticeItem() {
    openCreateItem('task', {
      title: 'Drive Practice',
      task_template: PLANNER_SINGLE_STEP_TASK_TEMPLATE,
      category: PLANNER_DRIVE_PRACTICE_CATEGORY
    });
  }

  function openItemModal(itemId) {
    const item = itemMap.get(itemId);
    if (!item) return;
    editingItemId = item.id;
    dependencyTargetId = '';
    draft = {
      kind: item.kind,
      title: item.title || '',
      notes: item.notes || '',
      task_mode: item.task_mode || PLANNER_STANDARD_TASK_MODE,
      task_template: item.kind === 'task' ? PLANNER_SINGLE_STEP_TASK_TEMPLATE : '',
      category: item.category || 'assembly',
      status: item.raw_status || item.status || 'green',
      critical_level: item.critical_level || 3,
      duration_hours: item.kind === 'task' ? Number(item.requested_duration_minutes || item.duration_minutes || 0) / 60 : 0,
      min_duration_hours: item.kind === 'task' ? Number(item.min_duration_minutes || 0) / 60 : 0.5,
      manual_start_at: toDatetimeLocal(item.manual_start_at),
      owner_ids: item.owner_ids || [],
      p0_bug_ids: item.p0_bug_ids || [],
      accountable_user_id: item.accountable_user_id || ''
    };
    ownerSearchQuery = '';
    p0BugSearchQuery = '';
    showItemModal = true;
  }

  function closeItemModal() {
    showItemModal = false;
    editingItemId = null;
    dependencyTargetId = '';
    ownerSearchQuery = '';
    p0BugSearchQuery = '';
  }

  function openMeetingModal() {
    openRuleModal(null, 'blocked');
  }

  function openWorkWindowModal() {
    openRuleModal(null, 'work_window');
  }

  function openRuleModal(rule = null, defaultRuleType = 'blocked') {
    editingRuleId = rule?.id || null;
    ruleDraft = rule
      ? {
        rule_type: rule.rule_type === 'drive_practice' ? 'blocked' : (rule.rule_type || 'blocked'),
        label: rule.label || '',
        weekday: rule.weekday === null || rule.weekday === undefined ? '' : String(rule.weekday),
        specific_date: rule.specific_date || '',
        starts_at: String(rule.starts_at || '').slice(0, 5),
        ends_at: String(rule.ends_at || '').slice(0, 5),
        enabled: rule.enabled !== false
      }
      : createRuleDraft(defaultRuleType);
    showRuleModal = true;
  }

  function closeRuleModal() {
    showRuleModal = false;
    editingRuleId = null;
  }

  function addOwner(personId) {
    if (!personId || (draft.owner_ids || []).includes(personId)) {
      ownerSearchQuery = '';
      return;
    }
    draft = {
      ...draft,
      owner_ids: [...(draft.owner_ids || []), personId]
    };
    ownerSearchQuery = '';
  }

  function removeOwner(personId) {
    draft = {
      ...draft,
      owner_ids: (draft.owner_ids || []).filter((ownerId) => ownerId !== personId)
    };
  }

  function handleOwnerSearchKeydown(event) {
    if (event.key === 'Enter' && ownerSearchResults.length > 0) {
      event.preventDefault();
      addOwner(ownerSearchResults[0].id);
      return;
    }
    if (event.key === 'Backspace' && !ownerSearchQuery && (draft.owner_ids || []).length > 0) {
      removeOwner(draft.owner_ids[draft.owner_ids.length - 1]);
    }
  }

  function toggleP0Bug(bugId) {
    if (!bugId) return;
    const selectedIds = draft.p0_bug_ids || [];
    const nextIds = selectedIds.includes(bugId)
      ? selectedIds.filter((currentId) => currentId !== bugId)
      : [...selectedIds, bugId];
    draft = {
      ...draft,
      p0_bug_ids: nextIds
    };
  }

  function setTaskWorkflow(nextWorkflow) {
    const normalizedWorkflow = String(nextWorkflow || '').trim();
    const currentHours = Number(draft.duration_hours);
    const nextDraft = {
      ...draft,
      task_mode: normalizedWorkflow === PLANNER_FIXING_TASK_MODE ? PLANNER_FIXING_TASK_MODE : PLANNER_STANDARD_TASK_MODE,
      task_template: normalizedWorkflow === PLANNER_FULL_CYCLE_TASK_TEMPLATE
        ? PLANNER_FULL_CYCLE_TASK_TEMPLATE
        : PLANNER_SINGLE_STEP_TASK_TEMPLATE
    };

    if (normalizedWorkflow === PLANNER_FIXING_TASK_MODE) {
      nextDraft.category = '';
      nextDraft.notes = '';
      nextDraft.owner_ids = [];
      if (!Array.isArray(nextDraft.p0_bug_ids)) nextDraft.p0_bug_ids = [];
    } else {
      if (!nextDraft.category) nextDraft.category = PLANNER_CATEGORIES[0];
      if (!(nextDraft.owner_ids || []).length && user?.id) nextDraft.owner_ids = [user.id];
    }

    if (normalizedWorkflow === PLANNER_FULL_CYCLE_TASK_TEMPLATE) {
      const singleStepDefaultHours = PLANNER_DEFAULT_TASK_DURATION_MINUTES / 60;
      if (!Number.isFinite(currentHours) || Math.abs(currentHours - singleStepDefaultHours) < 0.001) {
        nextDraft.duration_hours = PLANNER_FULL_CYCLE_DEFAULT_TOTAL_MINUTES / 60;
      } else {
        nextDraft.duration_hours = Math.max(currentHours, PLANNER_FULL_CYCLE_MIN_TOTAL_MINUTES / 60);
      }
    }

    draft = nextDraft;
  }

  async function saveItem() {
    const action = editingItemId ? 'update-item' : 'create-item';
    const isFixingDraft = draft.kind === 'task' && draft.task_mode === PLANNER_FIXING_TASK_MODE;
    const isFullCycleDraft =
      draft.kind === 'task' &&
      draft.task_mode !== PLANNER_FIXING_TASK_MODE &&
      draft.task_template === PLANNER_FULL_CYCLE_TASK_TEMPLATE;
    const payload = {
      action,
      ...(editingItemId ? { item_id: editingItemId } : {}),
      kind: draft.kind,
      title: draft.title,
      notes: isFixingDraft ? null : draft.notes,
      task_mode: draft.kind === 'task' ? draft.task_mode : null,
      task_template: draft.kind === 'task' ? draft.task_template : null,
      category: draft.kind === 'task' && !isFullCycleDraft && !isFixingDraft ? draft.category : null,
      status: draft.status,
      critical_level: draft.critical_level,
      duration_hours: draft.kind === 'task' ? draft.duration_hours : null,
      min_duration_hours: draft.kind === 'task' && !isFullCycleDraft ? draft.min_duration_hours : null,
      manual_start_at: draft.manual_start_at || null,
      owner_ids: draft.kind === 'task' && !isFixingDraft ? draft.owner_ids : [],
      p0_bug_ids: draft.kind === 'task' && isFixingDraft ? draft.p0_bug_ids : [],
      accountable_user_id: draft.kind === 'milestone' ? draft.accountable_user_id : null
    };
    const successMessage = editingItemId
      ? (isFixingDraft
        ? 'Fixing task updated.'
        : drivePracticeDraft ? 'Drive practice updated.' : 'Planner item updated.')
      : (isFixingDraft
        ? 'Fixing task created.'
        : drivePracticeDraft
        ? 'Drive practice created.'
        : isFullCycleDraft
          ? 'Full-cycle tasks created.'
          : 'Planner item created.');
    await submitPlannerAction(payload, successMessage);
    closeItemModal();
  }

  async function deleteItem() {
    if (!editingItemId || !confirm('Delete this planner item?')) return;
    await submitPlannerAction({
      action: 'delete-item',
      item_id: editingItemId
    }, 'Planner item deleted.');
    closeItemModal();
  }

  async function addDependency(mode) {
    if (!editingItemId || !dependencyTargetId) return;
    const payload = mode === 'incoming'
      ? {
        action: 'add-dependency',
        predecessor_item_id: dependencyTargetId,
        successor_item_id: editingItemId
      }
      : {
        action: 'add-dependency',
        predecessor_item_id: editingItemId,
        successor_item_id: dependencyTargetId
      };
    await submitPlannerAction(payload, 'Dependency added.');
    dependencyTargetId = '';
  }

  async function removeDependency(dependencyId) {
    await submitPlannerAction({
      action: 'delete-dependency',
      dependency_id: dependencyId
    }, 'Dependency removed.');
  }

  async function saveRule() {
    const action = editingRuleId ? 'update-calendar-rule' : 'create-calendar-rule';
    const payload = {
      action,
      ...(editingRuleId ? { rule_id: editingRuleId } : {}),
      ...ruleDraft,
      weekday: ruleDraft.weekday === '' ? null : Number(ruleDraft.weekday),
      specific_date: ruleDraft.specific_date || null
    };
    await submitPlannerAction(payload, editingRuleId ? 'Calendar rule updated.' : 'Calendar rule created.');
    closeRuleModal();
  }

  async function deleteRule(ruleId) {
    if (!confirm('Delete this calendar rule?')) return;
    await submitPlannerAction({
      action: 'delete-calendar-rule',
      rule_id: ruleId
    }, 'Calendar rule deleted.');
  }

  async function handleGanttTaskUpdate(event) {
    if (event?.inProgress) return;
    const source = itemMap.get(event?.id);
    const current = ganttApi?.getTask?.(event?.id);
    if (!source || !current) return;
    const beforeSnapshot = createPlannerTaskDebugSnapshot(source, 'source');
    const draggedSnapshot = createPlannerTaskDebugSnapshot(current, 'gantt');

    if (source.kind === 'milestone') {
      const payload = {
        action: 'update-item',
        item_id: source.id,
        manual_start_at: current.start
      };

      logPlannerGanttUpdate('Submitting milestone drag update', {
        event,
        item_id: source.id,
        before: beforeSnapshot,
        after_drag: draggedSnapshot,
        payload
      });

      try {
        const response = await submitPlannerAction(payload, 'Milestone moved.');
        const updatedItem = response?.data?.items?.find((item) => item.id === source.id);
        logPlannerGanttUpdate('Milestone drag update saved', {
          success: true,
          item_id: source.id,
          payload,
          before: beforeSnapshot,
          after_drag: draggedSnapshot,
          persisted: createPlannerTaskDebugSnapshot(updatedItem, 'source'),
          persisted_check: buildPlannerUpdatePersistenceCheck(updatedItem, payload)
        });
      } catch (submitError) {
        logPlannerGanttUpdate('Milestone drag update failed', {
          success: false,
          item_id: source.id,
          payload,
          before: beforeSnapshot,
          after_drag: draggedSnapshot,
          error: submitError?.message || submitError
        });
        throw submitError;
      }
      return;
    }

    const payload = buildPlannerTaskUpdatePayload(source, event?.task, current, calendarRules);
    if (!payload) {
      logPlannerGanttUpdate('Skipped drag update with no timing change', {
        event,
        item_id: source.id,
        before: beforeSnapshot,
        after_drag: draggedSnapshot
      });
      return;
    }

    const successMessage = Object.prototype.hasOwnProperty.call(payload, 'manual_start_at')
      ? 'Task updated.'
      : 'Task duration updated.';

    logPlannerGanttUpdate('Submitting task drag update', {
      event,
      update_type: getPlannerGanttUpdateType(payload),
      item_id: source.id,
      before: beforeSnapshot,
      after_drag: draggedSnapshot,
      payload
    });

    try {
      const response = await submitPlannerAction(payload, '');
      toastActions.show(successMessage);
      const updatedItem = response?.data?.items?.find((item) => item.id === source.id);
      logPlannerGanttUpdate('Task drag update saved', {
        success: true,
        update_type: getPlannerGanttUpdateType(payload),
        item_id: source.id,
        payload,
        before: beforeSnapshot,
        after_drag: draggedSnapshot,
        persisted: createPlannerTaskDebugSnapshot(updatedItem, 'source'),
        persisted_check: buildPlannerUpdatePersistenceCheck(updatedItem, payload)
      });
    } catch (submitError) {
      logPlannerGanttUpdate('Task drag update failed', {
        success: false,
        update_type: getPlannerGanttUpdateType(payload),
        item_id: source.id,
        payload,
        before: beforeSnapshot,
        after_drag: draggedSnapshot,
        error: submitError?.message || submitError
      });
      throw submitError;
    }
  }

  async function handleGanttLinkAdd(event) {
    await submitPlannerAction({
      action: 'add-dependency',
      predecessor_item_id: event?.link?.source,
      successor_item_id: event?.link?.target
    }, 'Dependency added.');
  }

  async function handleGanttReorder(event) {
    if (event?.inProgress || !ganttApi?.serialize) return;
    const orderedIds = ganttApi.serialize().map((task) => task.id);
    await submitPlannerAction({
      action: 'reorder-items',
      item_ids: orderedIds
    });
  }

  function handleGanttSelect(event) {
    if (event?.id) openItemModal(event.id);
  }

  function ganttInit(api) {
    ganttApi = api;
  }

  async function setGanttZoom(nextIndex) {
    const boundedIndex = Math.max(0, Math.min(PLANNER_GANTT_ZOOM_LEVELS.length - 1, nextIndex));
    if (boundedIndex === ganttZoomIndex) return;

    const previousWidth = PLANNER_GANTT_ZOOM_LEVELS[ganttZoomIndex].cellWidth;
    const nextWidth = PLANNER_GANTT_ZOOM_LEVELS[boundedIndex].cellWidth;
    const previousLeft = Number(ganttApi?.getState?.()?.scrollLeft || 0);

    ganttZoomIndex = boundedIndex;
    await tick();

    if (ganttApi?.exec) {
      ganttApi.exec('scroll-chart', {
        left: Math.max(0, Math.round(previousLeft * (nextWidth / previousWidth)))
      });
    }
  }

  function zoomGantt(direction) {
    return setGanttZoom(ganttZoomIndex + direction);
  }

  onMount(async () => {
    const unsubscribe = userStore.subscribe((value) => {
      user = value;
    });
    await loadUserFromUUID(supabase);
    const { data } = await supabase.auth.getSession();
    if (!data?.session?.user) {
      goto('/');
      return () => unsubscribe?.();
    }
    pendingOpenItemId = new URL(window.location.href).searchParams.get('item');
    await loadPlanner();
    return () => unsubscribe?.();
  });

  $: peopleById = new Map((people || []).map((person) => [person.id, person]));
  $: itemMap = new Map((items || []).map((item) => [item.id, item]));
  $: ownerSearchTerm = String(ownerSearchQuery || '').trim().toLowerCase();
  $: p0BugSearchTerm = String(p0BugSearchQuery || '').trim().toLowerCase();
  $: selectedOwners = (draft.owner_ids || []).map((ownerId) => peopleById.get(ownerId) || { id: ownerId });
  $: ownerSearchResults = ownerSearchTerm
    ? (people || [])
      .filter((person) => !(draft.owner_ids || []).includes(person.id))
      .filter((person) => getPersonSearchText(person).includes(ownerSearchTerm))
      .slice(0, OWNER_SEARCH_RESULT_LIMIT)
    : [];
  $: knownP0BugRows = (() => {
    const map = new Map();
    for (const item of items || []) {
      for (const bug of item?.p0_bugs || []) {
        if (bug?.id && !map.has(bug.id)) map.set(bug.id, bug);
      }
    }
    for (const bug of p0Bugs || []) {
      if (bug?.id) map.set(bug.id, bug);
    }
    return [...map.values()];
  })();
  $: knownP0BugById = new Map(knownP0BugRows.map((bug) => [bug.id, bug]));
  $: selectedP0Bugs = (draft.p0_bug_ids || []).map((bugId) => knownP0BugById.get(bugId) || { id: bugId, title: 'Unknown P0 bug' });
  $: fixingBugOptions = (() => {
    const map = new Map((p0BugRows || []).map((bug) => [bug.id, bug]));
    for (const bug of selectedP0Bugs) {
      if (bug?.id && !map.has(bug.id)) map.set(bug.id, bug);
    }
    const list = [...map.values()];
    return p0BugSearchTerm
      ? list.filter((bug) => getP0BugSearchText(bug).includes(p0BugSearchTerm))
      : list;
  })();
  $: incomingDependencies = (() => {
    const map = new Map((items || []).map((item) => [item.id, []]));
    for (const dependency of dependencies || []) {
      if (map.has(dependency.successor_item_id)) map.get(dependency.successor_item_id).push(dependency);
    }
    return map;
  })();
  $: outgoingDependencies = (() => {
    const map = new Map((items || []).map((item) => [item.id, []]));
    for (const dependency of dependencies || []) {
      if (map.has(dependency.predecessor_item_id)) map.get(dependency.predecessor_item_id).push(dependency);
    }
    return map;
  })();
  $: taskRows = (items || []).filter((item) => item.kind === 'task');
  $: fixingTaskRows = taskRows.filter((item) => isFixingItem(item));
  $: drivePracticeTaskRows = taskRows.filter((item) => isDrivePracticeItem(item));
  $: p0BugRows = p0Bugs || [];
  $: redItems = (items || []).filter((item) => item.status === 'red');
  $: dependencyCandidateItems = (items || []).filter((item) => item.id !== editingItemId);
  $: blockedRules = (calendarRules || []).filter((rule) => rule.rule_type === 'blocked' || rule.rule_type === 'drive_practice');
  $: legacyDrivePracticeRules = blockedRules.filter((rule) => rule.rule_type === 'drive_practice');
  $: workWindowRules = (calendarRules || []).filter((rule) => rule.rule_type === 'work_window');
  $: ruleModeLabel =
    ruleDraft?.rule_type === 'work_window'
      ? 'Work Window'
      : 'Meeting';
  $: ruleModeHelp =
    ruleDraft?.rule_type === 'work_window'
      ? 'Work windows create the hours the scheduler can use. Use Weekday for a repeating block or Specific Date for a one-time shift.'
      : 'Blocked meetings remove time from the schedule. Drive practice now belongs on the task list. For a one-off meeting, leave Weekday on Specific date instead and set the Specific Date.';
  $: setPlannerGanttCalendarRules(calendarRules);
  $: ganttZoom = PLANNER_GANTT_ZOOM_LEVELS[ganttZoomIndex];
  $: ganttScales = createPlannerGanttScales({ timeScaleStep: ganttZoom.timeScaleStep });
  $: ganttBounds = getPlannerGanttBounds(items);
  $: ganttTasks = (items || []).map((item) => ({
    id: item.id,
    text: item.title,
    start: new Date(item.scheduled_start_at || item.manual_start_at || new Date()),
    ...(item.kind === 'task'
      ? { end: new Date(item.scheduled_end_at || item.scheduled_start_at || item.manual_start_at || new Date()) }
      : {}),
    type: item.kind === 'milestone' ? 'milestone' : `planner-${item.status || 'green'}`,
    kind: item.kind,
    status: item.status,
    critical_level: item.critical_level,
    owners_label: item.kind === 'milestone'
      ? formatPerson(item.accountable)
      : isFixingItem(item)
        ? formatFixingBugSummary(item)
        : (item.owners || []).map(formatPerson).join(', '),
    accountable_name: formatPerson(item.accountable),
    ...item
  }));
  $: ganttLinks = (dependencies || []).map((dependency) => ({
    id: dependency.id,
    source: dependency.predecessor_item_id,
    target: dependency.successor_item_id,
    type: 'e2s'
  }));
  $: selectedItem = editingItemId ? itemMap.get(editingItemId) : null;
  $: fixingDraft = draft.kind === 'task' && draft.task_mode === PLANNER_FIXING_TASK_MODE;
  $: fullCycleDraft =
    draft.kind === 'task' &&
    draft.task_mode !== PLANNER_FIXING_TASK_MODE &&
    draft.task_template === PLANNER_FULL_CYCLE_TASK_TEMPLATE;
  $: drivePracticeDraft =
    draft.kind === 'task' &&
    !fixingDraft &&
    !fullCycleDraft &&
    draft.category === PLANNER_DRIVE_PRACTICE_CATEGORY;
  $: fullCyclePreview = (() => {
    if (!fullCycleDraft) return [];
    const totalMinutes = Number(draft.duration_hours || 0) * 60;
    try {
      return buildFullCycleTaskSteps(totalMinutes);
    } catch {
      return [];
    }
  })();
  $: selectedItemHasRolledUpStatus = !!selectedItem?.status_is_rolled_up && selectedItem?.status !== selectedItem?.raw_status;
  $: if (pendingOpenItemId && itemMap.has(pendingOpenItemId)) {
    openItemModal(pendingOpenItemId);
    pendingOpenItemId = null;
  }
</script>

<svelte:head>
  <title>Planner - 971 Hub</title>
</svelte:head>

<div class="container planner-page planner-shell">
  <div class="planner-header">
    <div class="planner-header-copy">
      <span class="planner-kicker">Scheduling Workspace</span>
      <h1>Planner</h1>
      <p class="planner-subtitle">Track milestones, sequence dependencies, and keep work aligned with real team availability.</p>
    </div>
    <div class="planner-header-actions">
      <div class="planner-view-toggle planner-view-toggle--3" role="tablist" aria-label="Planner views">
        <button
          class="planner-view-button"
          class:planner-view-button--active={activeView === 'gantt'}
          type="button"
          aria-pressed={activeView === 'gantt'}
          on:click={() => (activeView = 'gantt')}
        >
          Gantt
        </button>
        <button
          class="planner-view-button"
          class:planner-view-button--active={activeView === 'table'}
          type="button"
          aria-pressed={activeView === 'table'}
          on:click={() => (activeView = 'table')}
        >
          Task List
        </button>
        <button
          class="planner-view-button"
          class:planner-view-button--active={activeView === 'meetings'}
          type="button"
          aria-pressed={activeView === 'meetings'}
          on:click={() => (activeView = 'meetings')}
        >
          Calendar
        </button>
      </div>
      <div class="planner-actions">
        <button class="btn btn-primary btn-sm btn-nowrap" type="button" on:click={openDrivePracticeItem}>New Drive Practice</button>
        <button class="btn btn-primary btn-sm btn-nowrap" type="button" on:click={() => openCreateItem('milestone')}>New Milestone</button>
        <button class="btn btn-primary btn-sm btn-nowrap" type="button" on:click={() => openCreateItem('task')}>New Task</button>
      </div>
    </div>
  </div>

  {#if error}
    <div class="planner-banner planner-banner--error">{error}</div>
  {/if}
  {#if info}
    <div class="planner-banner planner-banner--success">{info}</div>
  {/if}
  {#if warnings.length > 0}
    <div class="planner-banner planner-banner--warning">
      {#each warnings as warning}
        <div>{warning}</div>
      {/each}
    </div>
  {/if}
  {#if redItems.length > 0}
    <div class="planner-banner planner-banner--red">
      <strong>Red items need attention:</strong>
      {redItems.map((item) => item.title).join(', ')}
    </div>
  {/if}

  {#if loading}
    <section class="section-card"><p>Loading planner...</p></section>
  {:else}
    {#if activeView === 'gantt'}
      <section class="section-card planner-gantt-card">
        <div class="section-head planner-gantt-toolbar">
          <div class="planner-section-copy">
            <span class="planner-section-kicker">Timeline</span>
            <h2>Gantt Schedule</h2>
            <p class="muted">Timeline is compressed to work windows only. To add a one-off meeting, create a blocked calendar rule with a specific date.</p>
          </div>
          <div class="planner-gantt-actions">
            <div class="planner-zoom-controls">
              <button class="btn btn-secondary btn-sm" type="button" on:click={() => zoomGantt(1)} disabled={ganttZoomIndex === PLANNER_GANTT_ZOOM_LEVELS.length - 1}>Zoom Out</button>
              <span class="planner-zoom-label">{ganttZoom.label}</span>
              <button class="btn btn-secondary btn-sm" type="button" on:click={() => zoomGantt(-1)} disabled={ganttZoomIndex === 0}>Zoom In</button>
            </div>
          </div>
        </div>
        {#if items.length === 0}
          <div class="empty-state planner-empty-state">
            <h3>No planner items yet</h3>
            <p>Create a task or milestone to start shaping the schedule.</p>
            <div class="planner-empty-actions">
              <button class="btn btn-primary btn-sm" type="button" on:click={() => openCreateItem('task')}>New Task</button>
              <button class="btn btn-secondary btn-sm" type="button" on:click={() => openCreateItem('milestone')}>New Milestone</button>
            </div>
          </div>
        {:else}
          <div class="planner-gantt-surface">
            <Willow>
              <Gantt
                tasks={ganttTasks}
                links={ganttLinks}
                scales={ganttScales}
                columns={ganttColumns}
                start={ganttBounds.start}
                end={ganttBounds.end}
                autoScale={false}
                durationUnit="hour"
                lengthUnit="workslot"
                cellWidth={ganttZoom.cellWidth}
                cellHeight={42}
                taskTemplate={PlannerBar}
                taskTypes={ganttTaskTypes}
                zoom={false}
                init={ganttInit}
                onupdatetask={handleGanttTaskUpdate}
                onaddlink={handleGanttLinkAdd}
                onmovetask={handleGanttReorder}
                onselecttask={handleGanttSelect}
              />
            </Willow>
          </div>
        {/if}
      </section>
    {:else if activeView === 'table'}
      <section class="section-card planner-table-card">
        <div class="section-head">
          <div class="planner-section-copy">
            <span class="planner-section-kicker">Details</span>
            <h2>Task List</h2>
            <p class="muted">Use the list when you want a faster scan of scheduled work, including drive practice sessions, plus unresolved items from the separate tasks system.</p>
          </div>
          <div class="planner-badge-cluster">
            <span class="planner-count-pill">{taskRows.length} planner task{taskRows.length === 1 ? '' : 's'}</span>
            <span class="planner-count-pill">{fixingTaskRows.length} fixing task{fixingTaskRows.length === 1 ? '' : 's'}</span>
            <span class="planner-count-pill">{drivePracticeTaskRows.length} drive practice{drivePracticeTaskRows.length === 1 ? '' : 's'}</span>
            <span class="planner-count-pill planner-count-pill--alert">{p0BugRows.length} P0 bug{p0BugRows.length === 1 ? '' : 's'}</span>
          </div>
        </div>

        <div class="planner-list-group">
          <div class="planner-list-group-head">
            <div class="planner-subsection-head">
              <h3>Scheduled Tasks</h3>
              <p>Open any row to edit schedule details, owners, or dependencies.</p>
            </div>
          </div>
          {#if taskRows.length === 0}
            <div class="empty-state planner-empty-state">
              <h3>No tasks yet</h3>
              <p>Create a task or drive practice session to start building the schedule.</p>
              <div class="planner-empty-actions">
                <button class="btn btn-secondary btn-sm" type="button" on:click={openDrivePracticeItem}>New Drive Practice</button>
                <button class="btn btn-primary btn-sm" type="button" on:click={() => openCreateItem('task')}>New Task</button>
              </div>
            </div>
          {:else}
            <div class="table-container planner-table-surface">
              <table class="table">
                <thead>
                  <tr>
                    <th>Name</th>
                    <th>Status</th>
                    <th>Type</th>
                    <th>Owners / Bugs</th>
                    <th>Dependencies</th>
                    <th>Duration</th>
                    <th>Scheduled</th>
                    <th>Critical</th>
                  </tr>
                </thead>
                <tbody>
                  {#each taskRows as item (item.id)}
                    <tr
                      class:red-row={item.status === 'red'}
                      class="planner-table-row"
                      tabindex="0"
                      role="button"
                      on:click={() => openItemModal(item.id)}
                      on:keydown={(event) => handleTableRowKeydown(event, item.id)}
                    >
                      <td>
                        <div class="planner-table-primary">
                          <strong class="planner-row-title">{item.title}</strong>
                          <span class="planner-table-secondary">
                            {#if isFixingItem(item)}
                              {formatFixingBugSummary(item)}
                            {:else if isDrivePracticeItem(item)}
                              Open drive practice details
                            {:else}
                              Open task details
                            {/if}
                          </span>
                        </div>
                      </td>
                      <td>
                        <span class={`planner-status-badge planner-status-badge--${item.status}`}>
                          <span class={`status-dot status-dot--${item.status}`}></span>
                          {formatStatus(item.status)}
                        </span>
                      </td>
                      <td><span class="planner-type-chip">{formatPlannerTaskType(item)}</span></td>
                      <td>{isFixingItem(item) ? formatFixingBugSummary(item) : ((item.owners || []).map(formatPerson).join(', ') || 'Unassigned')}</td>
                      <td><span class="planner-count-pill">{(incomingDependencies.get(item.id) || []).length}</span></td>
                      <td>{formatTaskDuration(item)}</td>
                      <td>
                        <div class="planner-table-secondary-stack">
                          <span>{formatDateTime(item.scheduled_start_at)}</span>
                          <span>{formatDateTime(item.scheduled_end_at)}</span>
                        </div>
                      </td>
                      <td><span class="planner-critical-chip">{formatCritical(item.critical_level)}</span></td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>

        <div class="planner-list-group">
          <div class="planner-list-group-head">
            <div class="planner-subsection-head">
              <h3>P0 Bugs</h3>
              <p>These unresolved items come from the separate `/tasks` list and stay read-only here for planning visibility.</p>
            </div>
            <a class="btn btn-secondary btn-sm btn-nowrap" href="/tasks">Open Tasks</a>
          </div>
          {#if p0BugRows.length === 0}
            <div class="empty-state planner-empty-state">
              <h3>No P0 bugs right now</h3>
              <p>The separate tasks system has no unresolved items for Team {user?.frc_team || 'your team'}.</p>
            </div>
          {:else}
            <div class="table-container planner-table-surface">
              <table class="table">
                <thead>
                  <tr>
                    <th>Bug</th>
                    <th>Type</th>
                    <th>Assignee</th>
                    <th>Deadline</th>
                    <th>Status</th>
                    <th>Flags</th>
                  </tr>
                </thead>
                <tbody>
                  {#each p0BugRows as bug (bug.id)}
                    {@const flags = formatP0BugFlags(bug)}
                    <tr class:planner-p0-bug-row--overdue={isPastDue(bug.deadline_at)}>
                      <td>
                        <div class="planner-table-primary">
                          <strong class="planner-row-title">{bug.title}</strong>
                          <span class="planner-table-secondary">From the tasks system</span>
                        </div>
                      </td>
                      <td><span class="planner-type-chip">{formatP0BugType(bug)}</span></td>
                      <td>
                        <div class="planner-table-secondary-stack">
                          <span>{formatPerson(bug.assignee)}</span>
                          {#if bug.needs_review}
                            <span>Reviewer: {formatPerson(bug.reviewer)}</span>
                          {/if}
                        </div>
                      </td>
                      <td>{formatDeadline(bug.deadline_at)}</td>
                      <td>
                        <div class="planner-table-secondary-stack">
                          <span class={`status-chip status-chip--${formatP0BugStatusTone(bug.status)}`}>{formatP0BugStatus(bug.status)}</span>
                          {#if bug.review_notes}
                            <span>{bug.review_notes}</span>
                          {/if}
                        </div>
                      </td>
                      <td>
                        {#if flags.length > 0}
                          <div class="planner-flags">
                            {#each flags as flag}
                              <span class="planner-count-pill">{flag}</span>
                            {/each}
                          </div>
                        {:else}
                          <span class="planner-table-secondary">None</span>
                        {/if}
                      </td>
                    </tr>
                  {/each}
                </tbody>
              </table>
            </div>
          {/if}
        </div>
      </section>
    {:else if activeView === 'meetings'}
      <section class="section-card planner-table-card">
        <div class="section-head">
          <div class="planner-section-copy">
            <span class="planner-section-kicker">Drive Practice</span>
            <h2>Drive Practice Tasks</h2>
            <p class="muted">Drive practice now lives on the task list and Gantt, so it shares owners, dependencies, and scheduler behavior with the rest of the planner. Owners get the end-of-practice P0 bug prompt automatically.</p>
          </div>
          <div class="calendar-actions">
            <span class="planner-count-pill">{drivePracticeTaskRows.length} session{drivePracticeTaskRows.length === 1 ? '' : 's'}</span>
            <button class="btn btn-primary btn-sm btn-nowrap" type="button" on:click={openDrivePracticeItem}>New Drive Practice</button>
          </div>
        </div>
        <div class="planner-banner planner-banner--success">
          Create or edit drive practice from the planner task flow. It stays visible in the Gantt, can depend on other work, and pings task owners with the dedicated P0 report form when it ends.
        </div>
      </section>

      <section class="section-card planner-table-card">
        <div class="section-head">
          <div class="planner-section-copy">
            <span class="planner-section-kicker">Blocked Time</span>
            <h2>Calendar Blocks</h2>
            <p class="muted">Meetings and other manual blocks remove time from the schedule. Add recurring weekly meetings or one-off blocks for specific dates.</p>
          </div>
          <div class="calendar-actions">
            <span class="planner-count-pill">{blockedRules.length} block{blockedRules.length === 1 ? '' : 's'}</span>
            <button class="btn btn-primary btn-sm btn-nowrap" type="button" on:click={openMeetingModal}>Add Meeting</button>
          </div>
        </div>

        {#if legacyDrivePracticeRules.length > 0}
          <div class="planner-banner planner-banner--warning">
            {legacyDrivePracticeRules.length} legacy drive practice block{legacyDrivePracticeRules.length === 1 ? '' : 's'} still exist in the calendar. Recreate them as tasks when you get a chance.
          </div>
        {/if}

        {#if blockedRules.length === 0}
          <div class="empty-state planner-empty-state">
            <h3>No calendar blocks yet</h3>
            <p>Add a recurring weekly meeting or a one-off block to carve out time from the schedule.</p>
            <div class="planner-empty-actions">
              <button class="btn btn-primary btn-sm" type="button" on:click={openMeetingModal}>Add Meeting</button>
            </div>
          </div>
        {:else}
          <div class="table-container planner-table-surface">
            <table class="table">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Type</th>
                  <th>Recurrence</th>
                  <th>When</th>
                  <th>Time</th>
                  <th>Enabled</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {#each blockedRules as rule (rule.id)}
                  <tr>
                    <td>
                      <div class="planner-table-primary">
                        <strong class="planner-row-title">{rule.label}</strong>
                      </div>
                    </td>
                    <td><span class="planner-type-chip">{formatBlockedRuleType(rule)}</span></td>
                    <td>
                      <span class={`planner-rule-chip planner-rule-chip--${rule.specific_date ? 'oneoff' : 'recurring'}`}>
                        {rule.specific_date ? 'One-off' : 'Weekly'}
                      </span>
                    </td>
                    <td>{formatRuleWhen(rule)}</td>
                    <td><span class="planner-time-range">{formatRuleWindow(rule)}</span></td>
                    <td>
                      <span class={`planner-enabled-chip planner-enabled-chip--${rule.enabled ? 'on' : 'off'}`}>
                        {rule.enabled ? 'Enabled' : 'Paused'}
                      </span>
                    </td>
                    <td class="calendar-actions">
                      <button class="btn btn-outline btn-sm" type="button" on:click={() => openRuleModal(rule)}>Edit</button>
                      <button class="btn btn-outline-danger btn-sm" type="button" on:click={() => deleteRule(rule.id)}>Delete</button>
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </section>
    {/if}
  {/if}
</div>

{#if showItemModal}
  <div class="modal-backdrop" role="button" tabindex="0" on:click|self={closeItemModal}>
    <section class="modal modal--wide planner-modal" role="dialog" aria-modal="true">
      <div class="modal-header planner-modal-header">
        <div>
          <p class="planner-modal-kicker">{editingItemId ? 'Planner Item' : 'New Planner Item'}</p>
          <h2>{editingItemId ? `Edit ${draft.kind === 'milestone' ? 'Milestone' : fixingDraft ? 'Fixing Task' : drivePracticeDraft ? 'Drive Practice' : 'Task'}` : `Create ${draft.kind === 'milestone' ? 'Milestone' : fixingDraft ? 'Fixing Task' : drivePracticeDraft ? 'Drive Practice' : 'Task'}`}</h2>
          <p class="planner-modal-subtitle">
            {#if draft.kind === 'milestone'}
              Milestones mark key checkpoints and accountability without adding duration.
            {:else if fixingDraft}
              Fixing tasks reserve time for a selected set of P0 bugs instead of assigning owners or adding notes.
            {:else if fullCycleDraft}
              Full-cycle tasks create linked CAD, manufacturing, and assembly blocks that stay chained together by default.
            {:else if drivePracticeDraft}
              Drive practice schedules like any other task and pings owners with the dedicated P0 bug form when it ends.
            {:else}
              Tasks carry duration, ownership, and dependency-aware scheduling in the Gantt.
            {/if}
          </p>
        </div>
        <button class="modal-close-button" type="button" aria-label="Close" on:click={closeItemModal}>&times;</button>
      </div>
      <div class="modal-body planner-modal-body">
        <section class="planner-modal-panel">
          <div class="planner-modal-panel-head">
            <div>
              <h3>Basics</h3>
              <p>{fixingDraft ? 'Pick the timeframe for bug-fixing work, then attach the P0 bugs that belong in that block.' : drivePracticeDraft ? 'Set up the session so it lands in the main schedule instead of living in a separate calendar flow.' : 'Keep names, status, and priority consistent so the schedule stays easy to scan.'}</p>
            </div>
            <span class={`planner-kind-chip planner-kind-chip--${draft.kind}`}>{draft.kind === 'milestone' ? 'Milestone' : fixingDraft ? 'Fixing' : 'Task'}</span>
          </div>
          <div class="planner-form-grid">
            <label class="form-group">
              <span class="form-label">Name</span>
              <input
                class="form-input"
                bind:value={draft.title}
                placeholder={draft.kind === 'milestone' ? 'Machine sign-off' : drivePracticeDraft ? 'Wednesday drive practice' : 'Wire intake rollers'}
              />
            </label>
            <label class="form-group">
              <span class="form-label">Status</span>
              <select class="form-select" bind:value={draft.status}>
                {#each PLANNER_STATUSES as status}
                  <option value={status}>{formatStatus(status)}</option>
                {/each}
              </select>
              {#if selectedItemHasRolledUpStatus}
                <small class="form-help">Planner is currently showing this item as {formatStatus(selectedItem.status)} because dependency status rolls up recursively. This field still edits the item&apos;s own status.</small>
              {/if}
            </label>
            <label class="form-group">
              <span class="form-label">Critical</span>
              <select class="form-select" bind:value={draft.critical_level}>
                {#each PLANNER_CRITICAL_LEVELS as level}
                  <option value={level}>{formatCritical(level)}</option>
                {/each}
              </select>
            </label>
            {#if draft.kind === 'task'}
              {#if !editingItemId}
                <label class="form-group">
                  <span class="form-label">Task Type</span>
                  <select
                    class="form-select"
                    value={fixingDraft ? PLANNER_FIXING_TASK_MODE : fullCycleDraft ? PLANNER_FULL_CYCLE_TASK_TEMPLATE : PLANNER_STANDARD_TASK_MODE}
                    on:change={(event) => setTaskWorkflow(event.currentTarget.value)}
                  >
                    {#each plannerTaskWorkflowOptions as option}
                      <option value={option.value} disabled={drivePracticeDraft && option.value !== PLANNER_STANDARD_TASK_MODE}>{option.label}</option>
                    {/each}
                  </select>
                  <small class="form-help">
                    {#if drivePracticeDraft}
                      Drive practice stays a single scheduled task.
                    {:else if fixingDraft}
                      Fixing tasks stay single-step, hide owners and notes, and track a chosen P0 bug list instead.
                    {:else}
                      Full cycle creates CAD, manufacturing, and assembly tasks with default dependencies.
                    {/if}
                  </small>
                </label>
              {/if}
              {#if fullCycleDraft}
                <label class="form-group">
                  <span class="form-label">Total Duration (hours)</span>
                  <input
                    class="form-input"
                    type="number"
                    min={PLANNER_FULL_CYCLE_MIN_TOTAL_MINUTES / 60}
                    step="0.5"
                    bind:value={draft.duration_hours}
                  />
                  <small class="form-help">Above 8 hours, extra time goes to CAD. Below 8 hours, all three steps scale proportionally.</small>
                </label>
              {:else}
                {#if !fixingDraft}
                  <label class="form-group">
                    <span class="form-label">Workstream</span>
                    <select class="form-select" bind:value={draft.category}>
                      {#each PLANNER_CATEGORIES as category}
                        <option value={category}>{formatCategory(category)}</option>
                      {/each}
                    </select>
                  </label>
                {/if}
                <label class="form-group">
                  <span class="form-label">Duration (hours)</span>
                  <input class="form-input" type="number" min="0.5" step="0.5" bind:value={draft.duration_hours} />
                </label>
                <label class="form-group">
                  <span class="form-label">Minimum Duration (hours)</span>
                  <input class="form-input" type="number" min="0.5" step="0.5" bind:value={draft.min_duration_hours} />
                </label>
              {/if}
              <label class="form-group">
                <span class="form-label">Requested Start</span>
                <input class="form-input" type="datetime-local" bind:value={draft.manual_start_at} />
                <small class="form-help">Optional. Dependencies and calendar blocks can still push this later.</small>
              </label>
            {:else}
              <label class="form-group">
                <span class="form-label">Milestone Date</span>
                <input class="form-input" type="datetime-local" bind:value={draft.manual_start_at} />
                <small class="form-help">Leave blank to keep the milestone snapped to its dependencies.</small>
              </label>
              <label class="form-group">
                <span class="form-label">Accountable Person</span>
                <select class="form-select" bind:value={draft.accountable_user_id}>
                  <option value="">Select a person</option>
                  {#each people as person}
                    <option value={person.id}>{formatPerson(person)}</option>
                  {/each}
                </select>
              </label>
            {/if}
          </div>

          {#if fullCycleDraft}
            <div class="planner-subsection-head">
              <div class="form-label">Generated Blocks</div>
              <p>CAD feeds manufacturing, then manufacturing feeds assembly by default.</p>
            </div>
            <div class="task-template-preview">
              {#each fullCyclePreview as step, index}
                <div class="task-template-preview-row">
                  <div class="task-template-preview-copy">
                    <strong>{draft.title.trim() || 'New task'} - {step.label}</strong>
                    <small>{index === 0 ? 'Starts the chain' : `Depends on ${fullCyclePreview[index - 1]?.label || 'the previous step'}`}</small>
                  </div>
                  <span class="planner-count-pill">{formatHours(step.duration_minutes)}</span>
                </div>
              {/each}
            </div>
          {/if}

        </section>

        <section class="planner-modal-panel">
          <div class="planner-modal-panel-head">
            <div>
              <h3>{draft.kind === 'task' ? (fixingDraft ? 'Linked P0 Bugs' : 'Context and ownership') : 'Context'}</h3>
              <p>
                {#if draft.kind === 'task'}
                  {#if fixingDraft}
                    Choose the unresolved P0 bugs this time block should cover. The raw P0 bug list still stays in its own table below the planner tasks.
                  {:else if fullCycleDraft}
                    Capture the overall context once, then assign the owners who should carry all three blocks forward.
                  {:else if drivePracticeDraft}
                    Capture the session details, then assign the owners who should get the end-of-practice P0 prompt.
                  {:else}
                    Capture the why, then assign the people who are actively responsible for the work.
                  {/if}
                {:else}
                  Use notes to explain the milestone, handoff, or completion criteria.
                {/if}
              </p>
            </div>
          </div>

          {#if draft.kind === 'task' && fixingDraft}
            <div class="owner-picker">
              <div class="planner-modal-panel-head">
                <div class="planner-subsection-head">
                  <div class="form-label">P0 Bugs</div>
                  <p class="muted">Select every unresolved P0 bug that should be worked during this scheduled block.</p>
                </div>
                <span class="planner-count-pill">{(draft.p0_bug_ids || []).length} bug{(draft.p0_bug_ids || []).length === 1 ? '' : 's'}</span>
              </div>

              {#if selectedP0Bugs.length > 0}
                <div class="owner-tag-list" aria-label="Selected P0 bugs">
                  {#each selectedP0Bugs as bug (bug.id)}
                    <span class="chip chip-soft owner-tag">
                      <span class="owner-tag-label">{bug.title || 'Untitled P0 bug'}</span>
                      <button
                        class="chip-remove"
                        type="button"
                        aria-label={`Remove ${bug.title || 'P0 bug'}`}
                        on:click={() => toggleP0Bug(bug.id)}
                      >
                        x
                      </button>
                    </span>
                  {/each}
                </div>
              {:else}
                <div class="planner-empty-inline">No P0 bugs selected yet.</div>
              {/if}

              <label class="form-group planner-form-group--flush">
                <span class="form-label">Filter P0 bugs</span>
                <input
                  class="form-input"
                  type="search"
                  bind:value={p0BugSearchQuery}
                  autocomplete="off"
                  placeholder="Search by bug title, type, or assignee"
                />
                <small class="form-help">Closed bugs only appear here if this task is already linked to them.</small>
              </label>

              {#if fixingBugOptions.length > 0}
                <div class="planner-p0-picker" aria-label="Available P0 bugs">
                  {#each fixingBugOptions as bug (bug.id)}
                    <label class="planner-p0-option">
                      <input
                        type="checkbox"
                        checked={(draft.p0_bug_ids || []).includes(bug.id)}
                        on:change={() => toggleP0Bug(bug.id)}
                      />
                      <div class="planner-p0-option-copy">
                        <strong>{bug.title || 'Untitled P0 bug'}</strong>
                        <span>{formatP0BugType(bug)}</span>
                        <span>{formatPerson(bug.assignee)}</span>
                      </div>
                      <span class={`status-chip status-chip--${formatP0BugStatusTone(bug.status)}`}>{formatP0BugStatus(bug.status)}</span>
                    </label>
                  {/each}
                </div>
              {:else}
                <div class="planner-empty-inline">
                  {p0BugSearchTerm ? `No P0 bugs match "${p0BugSearchQuery.trim()}".` : 'No unresolved P0 bugs are available right now.'}
                </div>
              {/if}
            </div>
          {:else}
            <label class="form-group planner-form-group--flush">
              <span class="form-label">Notes</span>
              <textarea class="form-input" rows="4" bind:value={draft.notes} placeholder="Context, blockers, or handoff notes..."></textarea>
            </label>
          {/if}

          {#if draft.kind === 'task' && !fixingDraft}
            <div class="owner-picker">
              <div class="planner-modal-panel-head">
                <div class="planner-subsection-head">
                  <div class="form-label">Owners</div>
                  <p class="muted">
                    {#if fullCycleDraft}
                      These owners will be copied onto the CAD, manufacturing, and assembly tasks created from this full-cycle plan.
                    {:else if drivePracticeDraft}
                      These owners will get the dedicated P0 bug report prompt when the scheduled session ends.
                    {:else}
                      Search and add the people directly moving this task forward.
                    {/if}
                  </p>
                </div>
                <span class="planner-count-pill">{(draft.owner_ids || []).length} owner{(draft.owner_ids || []).length === 1 ? '' : 's'}</span>
              </div>
              <div class="owner-selection">
                {#if selectedOwners.length > 0}
                  <div class="owner-tag-list" aria-label="Selected owners">
                    {#each selectedOwners as owner (owner.id)}
                      <span class="chip chip-soft owner-tag">
                        <span class="owner-tag-label">{formatPerson(owner)}</span>
                        <button
                          class="chip-remove"
                          type="button"
                          aria-label={`Remove ${formatPerson(owner)}`}
                          on:click={() => removeOwner(owner.id)}
                        >
                          x
                        </button>
                      </span>
                    {/each}
                  </div>
                {:else}
                  <div class="planner-empty-inline">No owners selected yet.</div>
                {/if}

                <label class="form-group planner-form-group--flush">
                  <span class="form-label">Add owner</span>
                  <input
                    class="form-input"
                    type="search"
                    bind:value={ownerSearchQuery}
                    autocomplete="off"
                    placeholder="Search by name or email"
                    on:keydown={handleOwnerSearchKeydown}
                  />
                  <small class="form-help">Type to filter team members, then click a result or press Enter to add the top match.</small>
                </label>

                {#if ownerSearchTerm}
                  <div class="owner-search-results" aria-label="Matching owners">
                    {#if ownerSearchResults.length > 0}
                      {#each ownerSearchResults as person (person.id)}
                        <button class="owner-search-result" type="button" on:click={() => addOwner(person.id)}>
                          <span class="owner-search-result-copy">
                            <strong>{formatPerson(person)}</strong>
                            <small>{person.email || 'No email on file'}</small>
                          </span>
                          <span class="planner-count-pill">Add</span>
                        </button>
                      {/each}
                    {:else}
                      <div class="planner-empty-inline">No team members match "{ownerSearchQuery.trim()}".</div>
                    {/if}
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </section>

        {#if selectedItem}
          <section class="planner-modal-panel">
            <div class="planner-modal-panel-head">
              <div>
                <h3>Dependencies</h3>
                <p>Use prerequisites and downstream links to keep schedule order clean and understandable.</p>
              </div>
              <span class="planner-count-pill">{(incomingDependencies.get(selectedItem.id) || []).length + (outgoingDependencies.get(selectedItem.id) || []).length} links</span>
            </div>

            <div class="dependency-panel">
              <div class="dependency-column">
                <div class="dependency-section-head">
                  <h4>Depends On</h4>
                  <span class="planner-count-pill">{(incomingDependencies.get(selectedItem.id) || []).length}</span>
                </div>
                {#if (incomingDependencies.get(selectedItem.id) || []).length === 0}
                  <div class="planner-empty-inline">No prerequisites yet.</div>
                {:else}
                  {#each incomingDependencies.get(selectedItem.id) || [] as dependency}
                    {@const item = itemMap.get(dependency.predecessor_item_id)}
                    <div class="dependency-row">
                      <div class="dependency-copy">
                        <button class="link-button" type="button" on:click={() => item?.id && openItemModal(item.id)}>{item?.title || 'Unknown item'}</button>
                        <span class="dependency-meta">{item?.kind === 'milestone' ? 'Milestone' : formatPlannerTaskType(item)}</span>
                      </div>
                      <div class="dependency-row-actions">
                        <span class={`status-chip status-chip--${item?.status || 'green'}`}>{formatStatus(item?.status)}</span>
                        <button class="btn btn-outline btn-sm" type="button" on:click={() => removeDependency(dependency.id)}>Remove</button>
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>
              <div class="dependency-column">
                <div class="dependency-section-head">
                  <h4>Blocks</h4>
                  <span class="planner-count-pill">{(outgoingDependencies.get(selectedItem.id) || []).length}</span>
                </div>
                {#if (outgoingDependencies.get(selectedItem.id) || []).length === 0}
                  <div class="planner-empty-inline">No downstream items yet.</div>
                {:else}
                  {#each outgoingDependencies.get(selectedItem.id) || [] as dependency}
                    {@const item = itemMap.get(dependency.successor_item_id)}
                    <div class="dependency-row">
                      <div class="dependency-copy">
                        <button class="link-button" type="button" on:click={() => item?.id && openItemModal(item.id)}>{item?.title || 'Unknown item'}</button>
                        <span class="dependency-meta">{item?.kind === 'milestone' ? 'Milestone' : formatPlannerTaskType(item)}</span>
                      </div>
                      <div class="dependency-row-actions">
                        <span class={`status-chip status-chip--${item?.status || 'green'}`}>{formatStatus(item?.status)}</span>
                        <button class="btn btn-outline btn-sm" type="button" on:click={() => removeDependency(dependency.id)}>Remove</button>
                      </div>
                    </div>
                  {/each}
                {/if}
              </div>
            </div>

            <div class="planner-subsection-head">
              <div class="form-label">Add dependency</div>
              <p class="muted">Choose another planner item, then add it as a prerequisite or a dependent item.</p>
            </div>
            <div class="dependency-create">
              <select class="form-select" bind:value={dependencyTargetId}>
                <option value="">Select planner item</option>
                {#each dependencyCandidateItems as candidate}
                  <option value={candidate.id}>{candidate.title}</option>
                {/each}
              </select>
              <button class="btn btn-secondary btn-sm btn-nowrap" type="button" disabled={!dependencyTargetId} on:click={() => addDependency('incoming')}>Add As Prerequisite</button>
              <button class="btn btn-secondary btn-sm btn-nowrap" type="button" disabled={!dependencyTargetId} on:click={() => addDependency('outgoing')}>Add As Dependent</button>
            </div>
          </section>
        {/if}
      </div>
      <div class="modal-footer">
        {#if editingItemId}
          <button class="btn btn-outline-danger btn-sm planner-danger-action" type="button" on:click={deleteItem}>Delete</button>
        {/if}
        <button class="btn btn-secondary btn-sm" type="button" on:click={closeItemModal}>Cancel</button>
        <button class="btn btn-primary btn-sm" type="button" disabled={saving || !draft.title.trim() || (fullCycleDraft && fullCyclePreview.length === 0) || (fixingDraft && (draft.p0_bug_ids || []).length === 0)} on:click={saveItem}>
          {saving ? 'Saving...' : editingItemId ? 'Save Changes' : 'Create'}
        </button>
      </div>
    </section>
  </div>
{/if}

{#if showRuleModal}
  <div class="modal-backdrop" role="button" tabindex="0" on:click|self={closeRuleModal}>
    <section class="modal planner-rule-modal" role="dialog" aria-modal="true">
      <div class="modal-header planner-modal-header">
        <div>
          <p class="planner-modal-kicker">Calendar Availability</p>
          <h2>{editingRuleId ? `Edit ${ruleModeLabel}` : `Add ${ruleModeLabel}`}</h2>
          <p class="planner-modal-subtitle">{ruleModeHelp}</p>
        </div>
        <button class="modal-close-button" type="button" aria-label="Close" on:click={closeRuleModal}>&times;</button>
      </div>
      <div class="modal-body planner-modal-body">
        <section class="planner-modal-panel">
          <div class="planner-modal-panel-head">
            <div>
              <h3>Rule details</h3>
              <p>Choose whether the rule creates available time or blocks the schedule.</p>
            </div>
          </div>
            <div class="planner-form-grid">
              <label class="form-group">
                <span class="form-label">Label</span>
                <input class="form-input" bind:value={ruleDraft.label} placeholder={ruleDraft.rule_type === 'work_window' ? 'Weekday shop hours' : 'Wednesday build meeting'} />
            </label>
            <label class="form-group">
              <span class="form-label">Type</span>
              <select class="form-select" bind:value={ruleDraft.rule_type}>
                {#each PLANNER_RULE_TYPES as ruleType}
                  <option value={ruleType}>{formatRuleMode(ruleType)}</option>
                {/each}
              </select>
            </label>
              <label class="form-group">
                <span class="form-label">Weekday</span>
                <select class="form-select" bind:value={ruleDraft.weekday}>
                  <option value="">Specific date instead</option>
                <option value="0">Sunday</option>
                <option value="1">Monday</option>
                <option value="2">Tuesday</option>
                <option value="3">Wednesday</option>
                <option value="4">Thursday</option>
                <option value="5">Friday</option>
                <option value="6">Saturday</option>
                </select>
                <small class="form-help">Use this for repeating weekly rules.</small>
              </label>
              <label class="form-group">
                <span class="form-label">Specific Date</span>
                <input class="form-input" type="date" bind:value={ruleDraft.specific_date} />
                <small class="form-help">For a one-off meeting, leave Weekday empty and set this date.</small>
              </label>
            <label class="form-group">
              <span class="form-label">Starts</span>
              <input class="form-input" type="time" bind:value={ruleDraft.starts_at} />
            </label>
            <label class="form-group">
              <span class="form-label">Ends</span>
              <input class="form-input" type="time" bind:value={ruleDraft.ends_at} />
            </label>
          </div>
          <label class="checkbox-line planner-inline-note">
            <input type="checkbox" bind:checked={ruleDraft.enabled} />
            Rule enabled
          </label>
        </section>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary btn-sm" type="button" on:click={closeRuleModal}>Cancel</button>
        <button class="btn btn-primary btn-sm" type="button" disabled={saving || !ruleDraft.label.trim()} on:click={saveRule}>
          {saving ? 'Saving...' : editingRuleId ? 'Save Rule' : 'Create Rule'}
        </button>
      </div>
    </section>
  </div>
{/if}

<style>
  .planner-shell {
    --planner-border-soft: rgba(15, 23, 42, 0.08);
    --planner-border-strong: rgba(15, 23, 42, 0.14);
    --planner-surface-soft: var(--surface-1);
    --planner-surface-muted: var(--surface-2);
    --planner-green-soft: #ecfdf3;
    --planner-green-strong: #15803d;
    --planner-yellow-soft: #fff8e1;
    --planner-yellow-strong: #a16207;
    --planner-red-soft: #fff1f2;
    --planner-red-strong: #be123c;
    --planner-green-solid: #15803d;
    --planner-green-border: #166534;
    --planner-green-accent: #bbf7d0;
    --planner-yellow-solid: #eab308;
    --planner-yellow-border: #ca8a04;
    --planner-yellow-accent: #422006;
    --planner-yellow-text: #422006;
    --planner-red-solid: #be123c;
    --planner-red-border: #9f1239;
    --planner-red-accent: #fecdd3;
    --planner-status-text: #f8fafc;
    --planner-shadow: var(--shadow-sm);
    --wx-background: #ffffff;
    --wx-background-alt: #fbfcfd;
    --wx-color-font: #0f172a;
    --wx-font-size: 13px;
    --wx-font-size-sm: 11px;
    --wx-font-weight: 500;
    --wx-font-weight-md: 700;
    --wx-border: 1px solid var(--planner-border-soft);
    --wx-gantt-border-color: #0f172a09;
    --wx-gantt-border: 1px solid #0f172a09;
    --wx-timescale-border: 1px solid #0f172a08;
    --wx-timescale-font: 700 0.72rem/1.1 system-ui, sans-serif;
    --wx-timescale-font-color: #475569;
    --wx-timescale-text-transform: none;
    --wx-grid-header-font: 700 0.72rem/1.1 system-ui, sans-serif;
    --wx-grid-header-font-color: #334155;
    --wx-grid-header-shadow: none;
    --wx-grid-body-font: 500 0.78rem/1.2 system-ui, sans-serif;
    --wx-grid-body-font-color: #0f172a;
    --wx-grid-body-row-border: 1px solid #0f172a08;
    --wx-grid-body-cell-border: 1px solid #0f172a04;
    --wx-gantt-select-color: rgba(241, 195, 49, 0.06);
    --wx-gantt-link-color: rgba(100, 116, 139, 0.22);
    --wx-gantt-link-marker-background: rgba(255, 255, 255, 0.98);
    --wx-gantt-link-marker-color: #64748b;
    --wx-gantt-holiday-background: rgba(15, 23, 42, 0.015);
    --wx-gantt-holiday-color: #94a3b8;
    --wx-gantt-marker-color: rgba(241, 195, 49, 0.55);
    --wx-gantt-marker-font: 700 0.68rem/1.1 system-ui, sans-serif;
    --wx-gantt-bar-border-radius: 4px;
    --wx-gantt-milestone-border-radius: 4px;
    --wx-gantt-bar-shadow: none;
  }

  .planner-page {
    padding-top: var(--space-6);
    padding-bottom: var(--space-7);
    display: grid;
    gap: var(--gap-4);
  }

  .planner-header,
  .section-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-4);
    flex-wrap: wrap;
  }

  .planner-header {
    padding: clamp(var(--space-4), 2vw, var(--space-6));
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    box-shadow: var(--shadow-sm);
  }

  .planner-header h1,
  .section-head h2 {
    margin: 0;
  }

  .planner-header-copy,
  .planner-section-copy {
    display: grid;
    gap: 0.45rem;
  }

  .planner-header-copy {
    max-width: 44rem;
  }

  .planner-header-actions,
  .planner-gantt-actions {
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: var(--gap-3);
  }

  .planner-kicker,
  .planner-section-kicker,
  .planner-modal-kicker {
    color: var(--accent-strong);
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.12em;
    text-transform: uppercase;
  }

  .planner-subtitle,
  .muted {
    color: var(--text-muted);
  }

  .planner-subtitle {
    margin: 0;
    max-width: 40rem;
    font-size: 0.95rem;
    line-height: 1.6;
  }

  .form-help {
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .planner-actions,
  .calendar-actions,
  .planner-badge-cluster {
    display: flex;
    gap: var(--gap-2);
    flex-wrap: wrap;
    align-items: center;
  }

  .planner-view-toggle {
    display: inline-grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 0.25rem;
    padding: 0.25rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  .planner-view-toggle--3 {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .planner-view-button {
    border: 0;
    background: transparent;
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: 700;
    padding: 0.6rem 0.95rem;
    border-radius: var(--radius-sm);
    cursor: pointer;
    transition: background 0.2s ease, color 0.2s ease, box-shadow 0.2s ease;
  }

  .planner-view-button:hover,
  .planner-view-button:focus-visible {
    outline: none;
    color: var(--text);
    background: rgba(255, 255, 255, 0.72);
  }

  .planner-view-button--active {
    background: var(--surface-1);
    color: var(--text);
    box-shadow: var(--shadow-sm);
  }

  .planner-banner {
    border-radius: var(--radius-lg);
    padding: var(--space-3) var(--space-4);
    border: 1px solid var(--planner-border-soft);
    background: var(--surface-1);
    box-shadow: var(--shadow-sm);
    font-weight: 500;
  }

  .planner-banner--error {
    background: var(--red-soft);
    border-color: var(--red-base);
    color: var(--red-strong);
  }

  .planner-banner--success {
    background: var(--green-soft);
    border-color: var(--green-base);
    color: var(--green-strong);
  }

  .planner-banner--warning {
    background: var(--brand-gold-soft);
    border-color: var(--brand-gold-base);
    color: var(--brand-gold-strong);
  }

  .planner-banner--red {
    background: #fff4f5;
    border-color: var(--red-base);
    color: var(--red-strong);
  }

  .planner-gantt-card {
    overflow: hidden;
    display: grid;
    gap: var(--gap-2);
  }

  .planner-gantt-toolbar {
    align-items: center;
  }

  .planner-empty-actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
    align-items: center;
  }

  .planner-count-pill,
  .planner-status-badge,
  .planner-type-chip,
  .planner-rule-chip,
  .planner-enabled-chip,
  .planner-critical-chip,
  .status-chip,
  .planner-kind-chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    min-height: var(--control-height-sm);
    padding: 0 0.65rem;
    border-radius: var(--radius-sm);
    border: 1px solid transparent;
    font-size: 0.74rem;
    font-weight: 700;
    line-height: 1;
    white-space: nowrap;
  }

  .planner-count-pill,
  .planner-type-chip,
  .planner-critical-chip,
  .planner-kind-chip {
    background: rgba(248, 250, 252, 0.92);
    border-color: var(--planner-border-soft);
    color: var(--text);
  }

  .planner-count-pill--alert {
    background: rgba(255, 237, 213, 0.82);
    border-color: rgba(180, 83, 9, 0.18);
    color: #9a3412;
  }

  .planner-kind-chip--task {
    background: rgba(241, 195, 49, 0.12);
    border-color: rgba(241, 195, 49, 0.28);
  }

  .planner-kind-chip--milestone {
    background: rgba(219, 234, 254, 0.58);
    border-color: rgba(29, 78, 216, 0.16);
  }

  .planner-status-badge--green,
  .status-chip--green {
    background: var(--planner-green-solid);
    border-color: var(--planner-green-border);
    color: var(--planner-status-text);
  }

  .planner-status-badge--yellow,
  .status-chip--yellow {
    background: var(--planner-yellow-solid);
    border-color: var(--planner-yellow-border);
    color: var(--planner-yellow-text);
  }

  .planner-status-badge--red,
  .status-chip--red {
    background: var(--planner-red-solid);
    border-color: var(--planner-red-border);
    color: var(--planner-status-text);
  }

  .planner-rule-chip--work {
    background: rgba(219, 234, 254, 0.58);
    border-color: rgba(29, 78, 216, 0.16);
    color: var(--blue-strong);
  }

  .planner-rule-chip--blocked {
    background: rgba(255, 237, 213, 0.82);
    border-color: rgba(180, 83, 9, 0.18);
    color: #9a3412;
  }

  .planner-rule-chip--oneoff {
    background: rgba(254, 249, 195, 0.82);
    border-color: rgba(161, 98, 7, 0.18);
    color: #854d0e;
  }

  .planner-rule-chip--recurring {
    background: rgba(219, 234, 254, 0.58);
    border-color: rgba(29, 78, 216, 0.16);
    color: var(--blue-strong);
  }

  .planner-enabled-chip--on {
    background: rgba(220, 252, 231, 0.86);
    border-color: rgba(22, 101, 52, 0.14);
    color: var(--planner-green-strong);
  }

  .planner-enabled-chip--off {
    background: rgba(241, 245, 249, 0.92);
    border-color: var(--planner-border-soft);
    color: var(--text-muted);
  }

  .status-chip--pending {
    background: rgba(254, 249, 195, 0.92);
    border-color: rgba(161, 98, 7, 0.16);
    color: #854d0e;
  }

  .status-chip--progress {
    background: rgba(219, 234, 254, 0.72);
    border-color: rgba(29, 78, 216, 0.16);
    color: var(--blue-strong);
  }

  .status-chip--risk {
    background: rgba(254, 226, 226, 0.92);
    border-color: rgba(185, 28, 28, 0.14);
    color: #b91c1c;
  }

  .status-chip--ready {
    background: rgba(220, 252, 231, 0.86);
    border-color: rgba(22, 101, 52, 0.14);
    color: var(--planner-green-strong);
  }

  .planner-zoom-controls {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    padding: 0.25rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-sm);
    background: var(--surface-1);
  }

  .planner-zoom-label {
    min-width: 5.75rem;
    text-align: center;
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: 700;
  }

  .planner-gantt-surface {
    height: min(72vh, 680px);
    min-height: 26rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    overflow: hidden;
    background: var(--surface-1);
    box-shadow: var(--planner-shadow);
  }

  .planner-table-card,
  .planner-calendar-card {
    gap: var(--gap-4);
  }

  .planner-list-group {
    display: grid;
    gap: var(--gap-3);
  }

  .planner-list-group-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--gap-3);
    flex-wrap: wrap;
  }

  .planner-table-surface {
    overflow: hidden;
    border-radius: var(--radius-lg);
  }

  .planner-empty-state {
    gap: var(--gap-3);
    padding: clamp(var(--space-6), 4vw, var(--space-8));
    border-style: solid;
    background: var(--surface-1);
  }

  .red-row {
    background: #fff4f5;
  }

  .planner-p0-bug-row--overdue {
    background: #fff7ed;
  }

  .planner-table-row {
    cursor: pointer;
    transition: background 0.2s ease, box-shadow 0.2s ease;
  }

  .planner-table-row:focus-visible {
    outline: none;
    background: rgba(241, 195, 49, 0.12);
    box-shadow: inset 0 0 0 2px rgba(241, 195, 49, 0.28);
  }

  .planner-table-primary,
  .planner-table-secondary-stack {
    display: grid;
    gap: 0.2rem;
  }

  .planner-row-title {
    color: var(--text);
  }

  .planner-table-secondary,
  .dependency-meta {
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .planner-table-secondary-stack {
    color: var(--text-secondary);
    font-size: var(--font-xs);
    line-height: 1.45;
  }

  .planner-flags {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-1);
  }

  .planner-time-range {
    font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
    color: #334155;
    font-size: 0.76rem;
    font-weight: 600;
  }

  .planner-form-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-3) var(--gap-4);
  }

  .planner-form-grid .form-group {
    margin-bottom: 0;
  }

  .planner-form-group--wide {
    grid-column: 1 / -1;
  }

  .planner-form-group--flush {
    margin-bottom: 0;
  }

  .owner-picker,
  .dependency-panel,
  .dependency-create {
    margin-top: var(--space-3);
  }

  .planner-modal,
  .planner-rule-modal {
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    border-color: var(--planner-border-soft);
    box-shadow: var(--shadow-lg);
  }

  .planner-rule-modal {
    --modal-width: 720px;
  }

  .planner-modal-header {
    align-items: flex-start;
  }

  .planner-modal-kicker {
    margin: 0 0 0.35rem;
  }

  .planner-modal-subtitle {
    margin: 0.45rem 0 0;
    color: var(--text-muted);
    max-width: 40rem;
    line-height: 1.55;
  }

  .planner-modal-body {
    gap: var(--gap-4);
  }

  .planner-modal-panel {
    display: grid;
    gap: var(--gap-3);
    padding: var(--space-4);
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }

  .planner-modal-panel-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-3);
    flex-wrap: wrap;
  }

  .planner-modal-panel-head h3,
  .dependency-section-head h4 {
    margin: 0;
  }

  .planner-modal-panel-head p,
  .planner-subsection-head p {
    margin: 0.35rem 0 0;
    color: var(--text-muted);
    font-size: var(--font-xs);
    line-height: 1.5;
  }

  .planner-subsection-head {
    display: grid;
    gap: 0.2rem;
  }

  .task-template-preview {
    display: grid;
    gap: var(--gap-2);
  }

  .task-template-preview-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    padding: 0.85rem 1rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }

  .task-template-preview-copy {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  .task-template-preview-copy strong {
    color: var(--text);
  }

  .task-template-preview-copy small {
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .owner-selection {
    display: grid;
    gap: var(--gap-3);
  }

  .owner-tag-list {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
  }

  .owner-tag {
    max-width: 100%;
  }

  .owner-tag-label {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .owner-search-results {
    display: grid;
    gap: var(--gap-2);
  }

  .planner-p0-picker {
    display: grid;
    gap: var(--gap-2);
  }

  .planner-p0-option {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-3);
    padding: 0.85rem 0.95rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    cursor: pointer;
  }

  .planner-p0-option input {
    margin-top: 0.2rem;
    accent-color: var(--accent-strong);
  }

  .planner-p0-option-copy {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
    flex: 1;
  }

  .planner-p0-option-copy strong,
  .planner-p0-option-copy span {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .planner-p0-option-copy span {
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .owner-search-result {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-3);
    width: 100%;
    padding: 0.85rem 0.95rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    color: var(--text);
    text-align: left;
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
  }

  .owner-search-result:hover,
  .owner-search-result:focus-visible {
    border-color: rgba(241, 195, 49, 0.32);
    background: rgba(241, 195, 49, 0.06);
    transform: translateY(-1px);
    outline: none;
  }

  .owner-search-result-copy {
    display: grid;
    gap: 0.2rem;
    min-width: 0;
  }

  .owner-search-result-copy strong,
  .owner-search-result-copy small {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .owner-search-result-copy small {
    color: var(--text-muted);
  }

  .owner-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-2);
  }

  .owner-chip {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    padding: 0.85rem 0.95rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
    cursor: pointer;
    transition: border-color 0.2s ease, background 0.2s ease, transform 0.15s ease, box-shadow 0.2s ease;
  }

  .owner-chip:hover {
    border-color: rgba(241, 195, 49, 0.32);
    transform: translateY(-1px);
  }

  .owner-chip--selected {
    border-color: rgba(241, 195, 49, 0.4);
    background: rgba(241, 195, 49, 0.08);
    box-shadow: none;
  }

  .owner-chip input,
  .checkbox-line input {
    margin: 0;
    accent-color: var(--accent-strong);
  }

  .owner-chip span {
    font-weight: 600;
    color: var(--text);
  }

  .checkbox-line {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-2);
    margin-top: var(--space-2);
    padding: 0.9rem 1rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    font-weight: 600;
  }

  .dependency-panel {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: var(--gap-4);
  }

  .dependency-column {
    display: grid;
    gap: var(--gap-2);
    padding: var(--space-3);
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }

  .dependency-section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-2);
  }

  .planner-empty-inline {
    padding: var(--space-3);
    border: 1px dashed var(--planner-border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .dependency-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: var(--gap-3);
    padding: 0.85rem 0.95rem;
    border: 1px solid var(--planner-border-soft);
    border-radius: var(--radius-lg);
    background: var(--surface-1);
  }

  .dependency-copy {
    display: grid;
    gap: 0.25rem;
    min-width: 0;
  }

  .dependency-row-actions {
    display: flex;
    flex-wrap: wrap;
    justify-content: flex-end;
    align-items: center;
    gap: var(--gap-2);
  }

  .dependency-create {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto auto;
    gap: var(--gap-2);
    align-items: end;
    padding: var(--space-4);
    border: 1px dashed var(--planner-border-strong);
    border-radius: var(--radius-lg);
    background: var(--surface-2);
  }

  .link-button {
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--text);
    cursor: pointer;
    text-align: left;
    font-weight: 700;
    min-width: 0;
  }

  .link-button:hover,
  .link-button:focus-visible {
    color: var(--accent-strong);
    outline: none;
    text-decoration: underline;
  }

  .status-chip,
  .status-dot {
    display: inline-flex;
    align-items: center;
  }

  .status-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 50%;
    margin-right: 0.35rem;
    box-shadow: none;
  }

  .status-dot--green {
    background: var(--planner-green-accent);
  }

  .status-dot--yellow {
    background: var(--planner-yellow-accent);
  }

  .status-dot--red {
    background: var(--planner-red-accent);
  }

  .planner-danger-action {
    margin-right: auto;
  }

  :global(.planner-shell .wx-gantt) {
    border-radius: inherit;
    background: transparent;
  }

  :global(.planner-shell .wx-layout) {
    background: transparent;
  }

  :global(.planner-shell .wx-scale) {
    background: var(--surface-1);
  }

  :global(.planner-shell .wx-scale .wx-row:first-child .wx-cell) {
    font-weight: 600;
    color: #475569;
  }

  :global(.planner-shell .wx-scale .wx-row:last-child .wx-cell) {
    color: #64748b;
  }

  :global(.planner-shell .wx-chart) {
    background: var(--surface-1);
  }

  :global(.planner-shell .wx-chart .wx-selected) {
    background: rgba(241, 195, 49, 0.08);
    border-top: 1px solid rgba(241, 195, 49, 0.12);
    border-bottom: 1px solid rgba(241, 195, 49, 0.12);
  }

  :global(.planner-shell .wx-line) {
    stroke-width: 1.25;
    stroke: rgba(100, 116, 139, 0.22);
    stroke-linecap: round;
    stroke-linejoin: round;
  }

  :global(.planner-shell .wx-table-container) {
    background: var(--surface-1);
  }

  :global(.planner-shell .wx-table .wx-header) {
    background: var(--surface-2);
  }

  :global(.planner-shell .wx-table .wx-body .wx-row:hover) {
    background: rgba(15, 23, 42, 0.03);
  }

  :global(.planner-shell .wx-bar.planner-green),
  :global(.planner-shell .wx-bar.planner-yellow),
  :global(.planner-shell .wx-bar.planner-red),
  :global(.planner-shell .wx-bar.planner-green:hover),
  :global(.planner-shell .wx-bar.planner-yellow:hover),
  :global(.planner-shell .wx-bar.planner-red:hover),
  :global(.planner-shell .wx-bar.planner-green.wx-selected),
  :global(.planner-shell .wx-bar.planner-yellow.wx-selected),
  :global(.planner-shell .wx-bar.planner-red.wx-selected),
  :global(.planner-shell .wx-bar.wx-milestone),
  :global(.planner-shell .wx-bar.wx-milestone:hover),
  :global(.planner-shell .wx-bar.wx-milestone.wx-selected) {
    background: transparent !important;
    border: 0 !important;
    box-shadow: none !important;
  }

  :global(.planner-shell .wx-bar .wx-progress-wrapper),
  :global(.planner-shell .wx-bar .wx-progress-marker) {
    display: none;
  }

  :global(.planner-shell .wx-bar.wx-milestone .wx-content) {
    opacity: 0;
  }

  :global(.planner-shell .wx-bar.wx-selected) {
    outline: 1px solid rgba(15, 23, 42, 0.18);
    outline-offset: 1px;
  }

  @media (max-width: 1100px) {
    .planner-header-actions,
    .planner-gantt-actions {
      width: 100%;
      align-items: flex-start;
    }
  }

  @media (max-width: 900px) {
    .planner-form-grid,
    .dependency-panel,
    .owner-grid,
    .dependency-create {
      grid-template-columns: 1fr;
    }

    .planner-gantt-surface {
      height: min(70vh, 560px);
      min-height: 24rem;
    }

    .dependency-row,
    .dependency-row-actions {
      align-items: stretch;
      flex-direction: column;
    }
  }

  @media (max-width: 640px) {
    .planner-header,
    .section-card,
    .planner-modal,
    .planner-rule-modal {
      padding: var(--space-4);
    }

    .planner-view-toggle {
      width: 100%;
    }

    .planner-view-button {
      justify-content: center;
    }

    .planner-zoom-controls {
      width: 100%;
      justify-content: space-between;
    }

    .planner-actions .btn,
    .calendar-actions .btn,
    .planner-empty-actions .btn {
      flex: 1 1 auto;
    }
  }
</style>
