<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID } from '$lib/stores/user.js';
  import { canManageCamProfiles } from '$lib/permissions.js';
  import { formatPacificDateTimeWithZone } from '$lib/timezone.js';
  import { getSeasonBucket, getCurrentSeasonBucket, getAllSeasonBuckets, passesSeasonFilter } from '$lib/frcSeason.js';
  import { passesTeamFilter } from '$lib/frcTeams.js';
  import TeamFilter from '$lib/components/TeamFilter.svelte';
  import SeasonFilter from '$lib/components/SeasonFilter.svelte';
  import CamParamFields from '$lib/components/CamParamFields.svelte';
  import RoutingToolSequence from '$lib/components/RoutingToolSequence.svelte';
  import CadViewer from '$lib/components/CadViewer.svelte';
  import ToolpathViewer from '$lib/components/ToolpathViewer.svelte';
  import { toastActions } from '$lib/toast.js';
  import {
    queueCamJobForPart,
    queueCamJobFromUpload,
    retryCamJob,
    cancelStuckCamJob,
    renameCamJob,
    deleteCamJob,
    updateCamJobAndRegenerate,
    isCamJobActive,
    WORKFLOW_OPERATION_TYPE,
    camJobStatusLabel,
    jobDisplayName,
    downloadGcodeBlob,
    downloadStepFile,
    partHasStepFile,
    CAM_GCODE_FORMAT
  } from '$lib/camJobs.js';
  import { Cpu, Upload, Package, Settings, Download, AlertTriangle, X, Link as LinkIcon, Plus, Wrench, Layers, CheckCircle2, Loader2, Search, Filter, Box, Route } from 'lucide-svelte';

  let user = null;
  let loading = true;
  let jobs = [];
  let materials = [];
  let tools = [];
  let machines = [];

  // Jobs list filters - mirrors the filter bar on /manufacture (search,
  // status, project-like dropdowns, season) adapted to what a CAM job
  // actually has: operation/material/tool/machine/creator instead of
  // workflow/project.
  const JOB_STATUSES = [
    { value: 'queued', label: 'Queued' },
    { value: 'claimed', label: 'Claimed' },
    { value: 'processing', label: 'Processing' },
    { value: 'completed', label: 'Completed' },
    { value: 'failed', label: 'Failed' },
    { value: 'rejected', label: 'Rejected' }
  ];
  let jobSearchTerm = '';
  let jobFilterOperation = '';
  let jobFilterStatus = '';
  let jobFilterMaterial = '';
  let jobFilterTool = '';
  let jobFilterMachine = '';
  let jobFilterCreatedBy = '';
  let jobFilterSeason = '';
  $: jobSeasonOptions = getAllSeasonBuckets(jobs);
  $: jobCreators = [...new Map(jobs.filter((j) => j.requester).map((j) => [j.requester.id, j.requester])).values()]
    .sort((a, b) => (a.full_name || a.email || '').localeCompare(b.full_name || b.email || ''));
  $: filteredJobs = jobs.filter((j) => {
    const name = jobDisplayName(j).toLowerCase();
    const matchesSearch = !jobSearchTerm || name.includes(jobSearchTerm.toLowerCase()) || (j.parts?.name || '').toLowerCase().includes(jobSearchTerm.toLowerCase());
    const matchesOperation = !jobFilterOperation || j.operation_type === jobFilterOperation;
    const matchesStatus = !jobFilterStatus || j.status === jobFilterStatus;
    const matchesMaterial = !jobFilterMaterial || j.material_id === jobFilterMaterial;
    const matchesTool = !jobFilterTool || j.tool_id === jobFilterTool;
    const matchesMachine = !jobFilterMachine || j.machine_id === jobFilterMachine;
    const matchesCreatedBy = !jobFilterCreatedBy || j.requested_by === jobFilterCreatedBy;
    const matchesSeason = passesSeasonFilter(j.created_at, jobFilterSeason);
    return matchesSearch && matchesOperation && matchesStatus && matchesMaterial && matchesTool && matchesMachine && matchesCreatedBy && matchesSeason;
  });

  // Same status set shown on /manufacture's filter bar (combined across all workflows).
  const PART_STATUSES = [
    { value: 'pending', label: 'Pending' },
    { value: 'in-progress', label: 'In Progress' },
    { value: 'drawing', label: 'Drawing In Progress' },
    { value: 'machining', label: 'Machining' },
    { value: 'inspection', label: 'Inspection' },
    { value: 'cammed', label: 'CAM Reviewed' },
    { value: 'cam_review', label: 'CAM Review Pending' },
    { value: 'machined', label: 'Machined' },
    { value: 'complete', label: 'Complete' }
  ];

  function emptyTurningParams() {
    return { stockDiameter: '', stepDown: 0.05, finishAllowance: 0.02, feedRough: 0.008, feedFinish: 0.004, surfaceSpeed: 150, maxRpm: 2500 };
  }
  function emptyRoutingParams() {
    return { toolDiameter: 0.25, stepDown: 0.1, targetDepth: '', tabWidth: 0.25, tabHeight: 0.06, tabSpacing: 6, feedRate: 40, plungeRate: 15, spindleSpeed: 16000, toolSequence: [] };
  }

  let showNewJobModal = false;
  let newJobName = '';
  let newJobOperation = 'routing'; // 'turning' | 'routing' - milling has no generator yet
  let newJobSource = 'upload';
  let newJobFile = null;
  let partSearchTerm = '';
  let eligibleParts = [];
  let partsLoading = false;
  let selectedPartId = '';
  let selectedMaterialId = '';
  let selectedToolId = '';
  let selectedMachineId = '';
  let submitting = false;
  let retryingJobId = null;
  let cancellingJobId = null;

  let showJobDetailModal = false;
  let editingJob = null;
  let editJobName = '';
  let editMaterialId = '';
  let editToolId = '';
  let editMachineId = '';
  let editParams = {};
  let editRenaming = false;
  let editSubmitting = false;
  let editDeleting = false;
  let showJobCadModal = false;
  let showJobToolpathModal = false;

  // Part-picker filters - mirrors the filter bar on /manufacture so parts are
  // easy to find the same way they are there.
  let partFilterStatus = '';
  let partFilterProject = '';
  let partFilterSeason = getCurrentSeasonBucket()?.value || '';
  let partShow971 = true;
  let partShow9584 = true;

  // Parameter form fields - only the fields relevant to newJobOperation get sent.
  let turningParams = emptyTurningParams();
  let routingParams = emptyRoutingParams();

  let showProfilesPanel = false;
  let newMaterialName = '';
  let newToolName = '';
  let newToolDiameter = '';
  let newToolNoseRadius = '';

  // Machine profile editor
  let showMachineModal = false;
  let editingMachineId = null;
  let machineForm = { name: '', description: '', operation_type: 'routing', default_material_id: '', default_tool_id: '', gcode_extension: 'ngc', params: emptyRoutingParams() };
  let savingMachine = false;

  $: canManageProfiles = canManageCamProfiles(user);
  $: partProjectIds = Array.from(new Set(eligibleParts.filter((p) => p.project_id).map((p) => p.project_id))).sort();
  $: partSeasonOptions = getAllSeasonBuckets(eligibleParts);
  $: filteredEligibleParts = eligibleParts
    .filter((p) => WORKFLOW_OPERATION_TYPE[p.workflow] === newJobOperation)
    .filter(partHasStepFile) // only parts with an attached STEP can actually be CAM'd
    .filter((p) => !partSearchTerm || (p.name || '').toLowerCase().includes(partSearchTerm.toLowerCase()))
    .filter((p) => !partFilterStatus || p.status === partFilterStatus)
    .filter((p) => !partFilterProject || p.project_id === partFilterProject)
    .filter((p) => passesSeasonFilter(p.created_at, partFilterSeason))
    .filter((p) => passesTeamFilter(p.frc_team, partShow971, partShow9584));
  $: machinesForOperation = machines.filter((mc) => mc.enabled && mc.operation_type === newJobOperation);
  $: jobStats = {
    total: jobs.length,
    generating: jobs.filter((j) => ['queued', 'claimed', 'processing'].includes(j.status)).length,
    completed: jobs.filter((j) => j.status === 'completed').length,
    failed: jobs.filter((j) => j.status === 'failed').length
  };

  onMount(() => {
    const unsub = userStore.subscribe((v) => { user = v; });
    (async () => {
      await loadUserFromUUID(supabase);
      await Promise.all([loadJobs(), loadReferenceData()]);
      loading = false;
    })();
    return unsub;
  });

  // Live-patches one job's changing fields (status/progress/gcode/etc) into
  // the jobs list in place, preserving the joined display fields (part/
  // material/tool/machine/requester names) that a bare progress-poll row
  // doesn't carry - used so a job's row animates live while generating,
  // without needing a full loadJobs() round-trip on every poll tick.
  function patchJobInList(update) {
    jobs = jobs.map((j) => (j.id === update.id
      ? { ...j, status: update.status, progress: update.progress, progress_message: update.progress_message, gcode: update.gcode, errors: update.errors, stats: update.stats, gcode_file_name: update.gcode_file_name }
      : j));
  }

  async function loadJobs() {
    const { data, error } = await supabase
      .from('cam_jobs')
      .select('*, parts(name, project_id), cam_materials(name), cam_tools(name), cam_machines(name)')
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) return;

    // requested_by is a FK to auth.users, not public.user_profiles, so
    // PostgREST can't embed a join for it directly - resolve display names
    // with a separate batch lookup instead.
    const requesterIds = [...new Set((data || []).map((j) => j.requested_by).filter(Boolean))];
    let requesterById = new Map();
    if (requesterIds.length) {
      const { data: profiles } = await supabase.from('user_profiles').select('id, full_name, email').in('id', requesterIds);
      requesterById = new Map((profiles || []).map((p) => [p.id, p]));
    }
    jobs = (data || []).map((j) => ({ ...j, requester: j.requested_by ? requesterById.get(j.requested_by) || null : null }));
  }

  async function loadReferenceData() {
    const [m, t, mc] = await Promise.all([
      supabase.from('cam_materials').select('*').order('name'),
      supabase.from('cam_tools').select('*').order('name'),
      supabase.from('cam_machines').select('*').order('name')
    ]);
    materials = m.data || [];
    tools = t.data || [];
    machines = mc.data || [];
  }

  async function loadEligibleParts() {
    partsLoading = true;
    try {
      const { data, error } = await supabase
        .from('parts')
        .select('id, name, project_id, workflow, status, created_at, frc_team, file_name, file_url')
        .order('created_at', { ascending: false })
        .limit(500);
      eligibleParts = error ? [] : (data || []);
    } finally {
      partsLoading = false;
    }
  }

  // Pass a machine to jump straight into a new job pre-loaded with that
  // profile's defaults - the "use this profile" shortcut on each profile card.
  function openNewJobModal(machine = null) {
    newJobName = '';
    newJobOperation = machine?.operation_type || 'routing';
    newJobSource = 'upload';
    newJobFile = null;
    selectedPartId = '';
    selectedMaterialId = '';
    selectedToolId = '';
    selectedMachineId = '';
    turningParams = emptyTurningParams();
    routingParams = emptyRoutingParams();
    partSearchTerm = '';
    partFilterStatus = '';
    partFilterProject = '';
    partFilterSeason = getCurrentSeasonBucket()?.value || '';
    partShow971 = true;
    partShow9584 = true;
    showNewJobModal = true;
    if (eligibleParts.length === 0) loadEligibleParts();
    if (machine) {
      selectedMachineId = machine.id;
      applyMachineDefaults(machine.id);
    }
  }

  function closeNewJobModal() {
    showNewJobModal = false;
  }

  // Selecting a machine profile pulls in its saved defaults so settings
  // don't have to be re-entered every time - the whole point of profiles.
  function applyMachineDefaults(machineId) {
    const machine = machines.find((m) => String(m.id) === String(machineId));
    if (!machine) return;
    newJobOperation = machine.operation_type;
    if (machine.operation_type === 'turning') {
      turningParams = { ...turningParams, ...(machine.default_params || {}) };
    } else {
      routingParams = { ...routingParams, ...(machine.default_params || {}) };
    }
    if (machine.default_material_id) selectedMaterialId = machine.default_material_id;
    if (machine.default_tool_id) selectedToolId = machine.default_tool_id;
  }

  function buildParams() {
    const raw = newJobOperation === 'turning' ? turningParams : routingParams;
    return serializeParams(raw);
  }

  // Numeric fields get coerced to Number(); toolSequence (routing multi-tool,
  // see toolchange-gcode-plan.md) is an array of {toolId, toolDiameter,
  // toolNumber, label} objects and must pass through untouched.
  function serializeParams(raw) {
    const params = {};
    for (const [key, value] of Object.entries(raw)) {
      if (key === 'toolSequence') {
        if (Array.isArray(value) && value.length > 0) params.toolSequence = value;
        continue;
      }
      if (value !== '' && value !== null && value !== undefined) params[key] = Number(value);
    }
    return params;
  }

  async function submitNewJob() {
    submitting = true;
    try {
      const options = {
        name: newJobName.trim() || null,
        operationType: newJobOperation,
        materialId: selectedMaterialId || null,
        toolId: selectedToolId || null,
        machineId: selectedMachineId || null,
        params: buildParams(),
        userId: user?.id || null,
        gcodeExtension: machines.find((m) => m.id === selectedMachineId)?.gcode_extension,
        // As soon as the job is queued (not once generation finishes) - move
        // out of the New Job form and let the jobs list show progress instead.
        onQueued: async () => {
          closeNewJobModal();
          await loadJobs();
        },
        onProgress: patchJobInList
      };

      let result;
      if (newJobSource === 'upload') {
        if (!newJobFile) { toastActions.show('Choose a STEP file first'); return; }
        result = await queueCamJobFromUpload(newJobFile, options);
      } else {
        const part = eligibleParts.find((p) => String(p.id) === String(selectedPartId));
        if (!part) { toastActions.show('Choose a part first'); return; }
        result = await queueCamJobForPart(part, options); // reuses the part's existing STEP file
      }

      toastActions.show(result.success ? 'CAM generated' : (result.error || 'AutoCAM generation failed'));
      await loadJobs(); // final refresh - picks up joined material/tool/machine/requester names the live patch above doesn't carry
    } finally {
      submitting = false;
    }
  }

  async function handleRetryJob(job) {
    retryingJobId = job.id;
    try {
      const result = await retryCamJob(job, { userId: user?.id || null, onProgress: patchJobInList });
      toastActions.show(result.success ? 'CAM generated' : (result.error || 'AutoCAM generation failed'));
      await loadJobs();
    } finally {
      retryingJobId = null;
    }
  }

  async function handleCancelStuckJob(job) {
    cancellingJobId = job.id;
    try {
      await cancelStuckCamJob(job.id);
      await loadJobs();
    } finally {
      cancellingJobId = null;
    }
  }

  function openJobDetail(job) {
    editingJob = job;
    editJobName = job.name || '';
    editMaterialId = job.material_id || '';
    editToolId = job.tool_id || '';
    editMachineId = job.machine_id || '';
    editParams = {
      ...(job.operation_type === 'turning' ? emptyTurningParams() : emptyRoutingParams()),
      ...(job.params || {})
    };
    showJobDetailModal = true;
  }

  // Row-level "View CAD" / "View Toolpath" - open the same preview modals
  // used inside Edit Job, without opening the full edit form.
  function openCadPreview(job) {
    editingJob = job;
    showJobCadModal = true;
  }
  function openToolpathPreview(job) {
    editingJob = job;
    showJobToolpathModal = true;
  }
  async function handleInstallCad(job) {
    const result = await downloadStepFile(job.step_file_name);
    if (!result.success) toastActions.show(result.error || 'Could not download STEP file');
  }

  function closeJobDetailModal() {
    showJobDetailModal = false;
    editingJob = null;
    showJobCadModal = false;
    showJobToolpathModal = false;
  }

  async function saveJobName() {
    if (!editingJob) return;
    editRenaming = true;
    try {
      const result = await renameCamJob(editingJob.id, editJobName.trim());
      if (result.success) {
        toastActions.show('Renamed');
        await loadJobs();
        editingJob = jobs.find((j) => j.id === editingJob.id) || editingJob;
      } else {
        toastActions.show(result.error || 'Rename failed');
      }
    } finally {
      editRenaming = false;
    }
  }

  async function saveJobAndRegenerate() {
    if (!editingJob) return;
    editSubmitting = true;
    try {
      const result = await updateCamJobAndRegenerate(editingJob, {
        name: editJobName.trim() || null,
        materialId: editMaterialId,
        toolId: editToolId,
        machineId: editMachineId,
        params: serializeParams(editParams),
        gcodeExtension: machines.find((m) => m.id === editMachineId)?.gcode_extension,
        // As soon as it's queued (not once generation finishes) - move out of
        // the edit form and let the jobs list show progress instead.
        onQueued: async () => {
          closeJobDetailModal();
          await loadJobs();
        },
        onProgress: patchJobInList
      });
      toastActions.show(result.success ? 'CAM regenerated' : (result.error || 'AutoCAM generation failed'));
      await loadJobs();
    } finally {
      editSubmitting = false;
    }
  }

  async function deleteEditingJob() {
    if (!editingJob) return;
    if (!confirm(`Delete job "${jobDisplayName(editingJob)}"? This cannot be undone.`)) return;
    editDeleting = true;
    try {
      const result = await deleteCamJob(editingJob.id);
      if (result.success) {
        toastActions.show('Job deleted');
        closeJobDetailModal();
        await loadJobs();
      } else {
        toastActions.show(result.error || 'Delete failed');
      }
    } finally {
      editDeleting = false;
    }
  }

  function jobStatusClass(job) {
    if (job.status === 'completed') return 'status-complete';
    if (job.status === 'failed' || job.status === 'rejected') return 'status-error';
    return 'status-running';
  }

  async function addMaterial() {
    if (!newMaterialName.trim()) return;
    const { error } = await supabase.from('cam_materials').insert({ name: newMaterialName.trim() });
    if (error) { toastActions.show('Failed to add material'); return; }
    newMaterialName = '';
    await loadReferenceData();
  }

  async function addTool() {
    if (!newToolName.trim()) return;
    const { error } = await supabase.from('cam_tools').insert({
      name: newToolName.trim(),
      diameter: newToolDiameter ? Number(newToolDiameter) : null,
      nose_radius: newToolNoseRadius ? Number(newToolNoseRadius) : null
    });
    if (error) { toastActions.show('Failed to add tool'); return; }
    newToolName = '';
    newToolDiameter = '';
    newToolNoseRadius = '';
    await loadReferenceData();
  }

  async function toggleEnabled(table, row) {
    const { error } = await supabase.from(table).update({ enabled: !row.enabled }).eq('id', row.id);
    if (!error) await loadReferenceData();
  }

  function openMachineModal(machine = null) {
    if (machine) {
      editingMachineId = machine.id;
      machineForm = {
        name: machine.name,
        description: machine.description || '',
        operation_type: machine.operation_type,
        default_material_id: machine.default_material_id || '',
        default_tool_id: machine.default_tool_id || '',
        gcode_extension: machine.gcode_extension || 'ngc',
        params: {
          ...(machine.operation_type === 'turning' ? emptyTurningParams() : emptyRoutingParams()),
          ...(machine.default_params || {})
        }
      };
    } else {
      editingMachineId = null;
      machineForm = { name: '', description: '', operation_type: 'routing', default_material_id: '', default_tool_id: '', gcode_extension: 'ngc', params: emptyRoutingParams() };
    }
    showMachineModal = true;
  }

  function closeMachineModal() {
    showMachineModal = false;
    editingMachineId = null;
  }

  function setMachineFormOperation(op) {
    machineForm.operation_type = op;
    machineForm.params = op === 'turning' ? emptyTurningParams() : emptyRoutingParams();
  }

  async function saveMachine() {
    if (!machineForm.name.trim()) { toastActions.show('Machine profile needs a name'); return; }
    savingMachine = true;
    try {
      const row = {
        name: machineForm.name.trim(),
        description: machineForm.description.trim() || null,
        operation_type: machineForm.operation_type,
        default_material_id: machineForm.default_material_id || null,
        default_tool_id: machineForm.default_tool_id || null,
        gcode_extension: machineForm.gcode_extension || 'ngc',
        default_params: serializeParams(machineForm.params)
      };
      const { error } = editingMachineId
        ? await supabase.from('cam_machines').update(row).eq('id', editingMachineId)
        : await supabase.from('cam_machines').insert({ ...row, created_by: user?.id || null });
      if (error) { toastActions.show('Failed to save machine profile'); return; }
      toastActions.show('Machine profile saved');
      closeMachineModal();
      await loadReferenceData();
    } finally {
      savingMachine = false;
    }
  }
</script>

<svelte:head><title>AutoCAM | 971 Hub</title></svelte:head>

<div class="page-header">
  <h1><Cpu size={28} /> AutoCAM</h1>
  <div class="page-actions">
    {#if canManageProfiles}
      <button class="btn btn-secondary" on:click={() => (showProfilesPanel = !showProfilesPanel)}>
        <Settings size={16} /> {showProfilesPanel ? 'Hide' : 'Manage'} Profiles
      </button>
    {/if}
    <button class="btn btn-primary" on:click={openNewJobModal}>
      <Upload size={16} /> New Job
    </button>
  </div>
</div>
<p class="page-subtitle">Upload a STEP file — or link an existing part that already has one — and get {CAM_GCODE_FORMAT.toUpperCase()} G-code back immediately for turning (lathe) or routing. Milling isn't implemented yet (see millimplementations.md).</p>

{#if !loading && materials.length === 0 && tools.length === 0 && machines.length === 0}
  <div class="card setup-warning">
    <AlertTriangle size={20} />
    <div>
      <strong>No materials, tools, or machine profiles found.</strong>
      <p>
        This usually means <code>migrations/20260817_cam_studio_system.sql</code> hasn't been run against the
        database yet (or was run before Machine Profiles existed). Re-running that file is safe even if it partially
        ran before - every statement in it checks for existing tables/columns/policies first. Material and Tool are
        optional either way, but Machine Profiles won't show up until this runs.
      </p>
    </div>
  </div>
{/if}

{#if !loading}
  <div class="stats-grid">
    <div class="stat-card">
      <Layers size={20} />
      <div class="stat-info"><h3>{jobStats.total}</h3><p>Total Jobs</p></div>
    </div>
    <div class="stat-card">
      <Loader2 size={20} />
      <div class="stat-info"><h3>{jobStats.generating}</h3><p>Generating</p></div>
    </div>
    <div class="stat-card">
      <CheckCircle2 size={20} />
      <div class="stat-info"><h3>{jobStats.completed}</h3><p>Completed</p></div>
    </div>
    <div class="stat-card">
      <AlertTriangle size={20} />
      <div class="stat-info"><h3>{jobStats.failed}</h3><p>Failed</p></div>
    </div>
  </div>
{/if}

{#if showProfilesPanel && canManageProfiles}
  <div class="card">
    <h2>Machine Profiles</h2>
    <p class="cam-form-hint">Saved settings bundles per physical machine, so parameters don't have to be re-entered for every job.</p>
    <div class="machine-profiles-grid">
      {#each machines as mc}
        <div class="machine-profile-card" class:disabled={!mc.enabled}>
          <div class="machine-profile-header">
            <div>
              <strong>{mc.name}</strong>
              <span class="tag {mc.operation_type === 'turning' ? 'tag-season' : 'tag-971'}">{mc.operation_type}</span>
            </div>
            <button class="btn btn-ghost btn-sm" on:click={() => toggleEnabled('cam_machines', mc)}>{mc.enabled ? 'Disable' : 'Enable'}</button>
          </div>
          {#if mc.description}<p class="machine-profile-desc">{mc.description}</p>{/if}
          <div class="machine-profile-meta">
            {#if mc.default_material_id}<span class="part-picker-tag">{materials.find((m) => m.id === mc.default_material_id)?.name || 'Material set'}</span>{/if}
            {#if mc.default_tool_id}<span class="part-picker-tag">{tools.find((t) => t.id === mc.default_tool_id)?.name || 'Tool set'}</span>{/if}
          </div>
          <div class="machine-profile-actions">
            <button class="btn btn-primary btn-sm" disabled={!mc.enabled} on:click={() => openNewJobModal(mc)}>
              <Upload size={14} /> New Job
            </button>
            <button class="btn btn-secondary btn-sm" on:click={() => openMachineModal(mc)}>
              <Settings size={14} /> Edit
            </button>
          </div>
        </div>
      {/each}
      <button class="machine-profile-add" on:click={() => openMachineModal()}>
        <Plus size={20} /> Add Machine Profile
      </button>
    </div>
  </div>

  <div class="card">
    <h2>Materials &amp; Tools</h2>
    <div class="profiles-grid">
      <div class="profile-col">
        <h3>Materials</h3>
        {#each materials as m}
          <div class="profile-row" class:disabled={!m.enabled}>
            <span>{m.name}</span>
            <button class="btn btn-ghost btn-sm" on:click={() => toggleEnabled('cam_materials', m)}>{m.enabled ? 'Disable' : 'Enable'}</button>
          </div>
        {/each}
        <div class="input-group">
          <input class="form-input" placeholder="New material name" bind:value={newMaterialName} />
          <button class="btn btn-sm btn-nowrap" on:click={addMaterial}>Add</button>
        </div>
      </div>

      <div class="profile-col">
        <h3>Tools</h3>
        {#each tools as t}
          <div class="profile-row" class:disabled={!t.enabled}>
            <span>{t.name}{t.diameter ? ` (${t.diameter}" dia)` : ''}{t.nose_radius ? ` R${t.nose_radius}` : ''}</span>
            <button class="btn btn-ghost btn-sm" on:click={() => toggleEnabled('cam_tools', t)}>{t.enabled ? 'Disable' : 'Enable'}</button>
          </div>
        {/each}
        <div class="input-group">
          <input class="form-input" placeholder="Tool name" bind:value={newToolName} />
          <input class="form-input" placeholder="Diameter (in)" type="number" step="0.0625" bind:value={newToolDiameter} />
          <input class="form-input" placeholder="Nose radius (in, lathe only)" type="number" step="0.001" bind:value={newToolNoseRadius} />
          <button class="btn btn-sm btn-nowrap" on:click={addTool}>Add</button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if !loading && jobs.length > 0}
  <div class="card">
    <div class="filters" style="--filters-columns: 2fr 1fr 1fr 1fr 1fr 1fr 1fr;">
      <div class="form-group">
        <label class="form-label"><Search size={16} /> Search</label>
        <input type="text" class="form-input" placeholder="Search by job or part name..." bind:value={jobSearchTerm} />
      </div>
      <div class="form-group">
        <label class="form-label"><Filter size={16} /> Operation</label>
        <select class="form-select" bind:value={jobFilterOperation}>
          <option value="">All Operations</option>
          <option value="turning">Turning</option>
          <option value="routing">Routing</option>
          <option value="milling">Milling</option>
        </select>
      </div>
      <div class="form-group">
        <label class="form-label"><Filter size={16} /> Status</label>
        <select class="form-select" bind:value={jobFilterStatus}>
          <option value="">All Statuses</option>
          {#each JOB_STATUSES as s}
            <option value={s.value}>{s.label}</option>
          {/each}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label"><Filter size={16} /> Material</label>
        <select class="form-select" bind:value={jobFilterMaterial}>
          <option value="">All Materials</option>
          {#each materials as m}
            <option value={m.id}>{m.name}</option>
          {/each}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label"><Filter size={16} /> Tool</label>
        <select class="form-select" bind:value={jobFilterTool}>
          <option value="">All Tools</option>
          {#each tools as t}
            <option value={t.id}>{t.name}</option>
          {/each}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label"><Filter size={16} /> Machine</label>
        <select class="form-select" bind:value={jobFilterMachine}>
          <option value="">All Machines</option>
          {#each machines as mc}
            <option value={mc.id}>{mc.name}</option>
          {/each}
        </select>
      </div>
      <div class="form-group">
        <label class="form-label"><Filter size={16} /> Created By</label>
        <select class="form-select" bind:value={jobFilterCreatedBy}>
          <option value="">Everyone</option>
          {#each jobCreators as c}
            <option value={c.id}>{c.full_name || c.email}</option>
          {/each}
        </select>
      </div>
      <SeasonFilter options={jobSeasonOptions} bind:value={jobFilterSeason} />
    </div>
  </div>
{/if}

{#if loading}
  <div class="card"><p>Loading...</p></div>
{:else if jobs.length === 0}
  <div class="card empty-state">
    <Cpu size={48} />
    <h3>No AutoCAM jobs yet</h3>
    <p>Click "New Job" to generate your first G-code file.</p>
  </div>
{:else if filteredJobs.length === 0}
  <div class="card empty-state">
    <Filter size={48} />
    <h3>No jobs match these filters</h3>
  </div>
{:else}
  <div class="table-container">
    <table class="table">
      <thead>
        <tr>
          <th>Job</th>
          <th>Operation</th>
          <th>Material</th>
          <th>Tool</th>
          <th>Machine</th>
          <th>Status</th>
          <th>Created</th>
          <th>Created By</th>
          <th>Output</th>
        </tr>
      </thead>
      <tbody>
        {#each filteredJobs as job (job.id)}
          {@const bucket = getSeasonBucket(job.created_at)}
          <tr class="job-row" on:click={() => openJobDetail(job)} tabindex="0" role="button" on:keydown={(e) => { if (e.key === 'Enter') openJobDetail(job); }}>
            <td>
              <div class="name-line">
                {#if job.source_type === 'part'}<Package size={14} />{:else}<Upload size={14} />{/if}
                <strong>{jobDisplayName(job)}</strong>
              </div>
              {#if job.source_type === 'part' && job.part_id}
                <a class="job-part-link" href="/manufacture?part={job.part_id}" on:click|stopPropagation>
                  <LinkIcon size={12} /> {job.parts?.name || `Part #${job.part_id}`}
                </a>
              {/if}
            </td>
            <td>
              <span class="tag {job.operation_type === 'turning' ? 'tag-season' : 'tag-971'}">{job.operation_type}</span>
            </td>
            <td>{job.cam_materials?.name || '—'}</td>
            <td>{job.cam_tools?.name || '—'}</td>
            <td>{job.cam_machines?.name || '—'}</td>
            <td>
              <span class="status-badge {jobStatusClass(job)}">{camJobStatusLabel(job.status)}</span>
              {#if isCamJobActive(job)}
                <div class="job-row-progress">
                  <div class="job-row-progress-bar"><div class="job-row-progress-fill" style="width: {job.progress || 0}%"></div></div>
                  {#if job.progress_message}<span class="job-row-progress-label">{job.progress_message}</span>{/if}
                </div>
              {/if}
            </td>
            <td>
              {formatPacificDateTimeWithZone(job.created_at)}
              {#if bucket}
                <span class="tag season-tag {bucket.isOffseason ? 'tag-offseason' : 'tag-season'}">{bucket.label}</span>
              {/if}
            </td>
            <td>{job.requester?.full_name || job.requester?.email || '—'}</td>
            <td on:click|stopPropagation class="output-cell">
              <div class="output-actions">
                {#if job.step_file_name}
                  <button class="btn btn-secondary btn-sm" title="View 3D CAD" on:click={() => openCadPreview(job)}>
                    <Box size={14} /> View CAD
                  </button>
                  <button class="btn btn-secondary btn-sm" title="Download the source STEP file" on:click={() => handleInstallCad(job)}>
                    <Download size={14} /> Install CAD
                  </button>
                {/if}
                {#if job.status === 'completed' && job.gcode}
                  <button class="btn btn-secondary btn-sm" title="View toolpath simulation" on:click={() => openToolpathPreview(job)}>
                    <Route size={14} /> View Toolpath
                  </button>
                  <button class="btn btn-secondary btn-sm" title={job.gcode_file_name || 'output.ngc'} on:click={() => downloadGcodeBlob(job)}>
                    <Download size={14} /> Install NGC
                  </button>
                {/if}
              </div>
              {#if job.status === 'failed' && job.errors?.length}
                <div class="job-output-failed">
                  <span class="job-error" title={job.errors.join('; ')}><AlertTriangle size={14} /> {job.errors[0]}</span>
                  {#if job.step_file_name}
                    <button class="btn btn-secondary btn-sm" on:click={() => handleRetryJob(job)} disabled={retryingJobId === job.id}>
                      {retryingJobId === job.id ? 'Retrying…' : 'Retry'}
                    </button>
                  {/if}
                </div>
              {:else if isCamJobActive(job)}
                <button class="btn btn-secondary btn-sm" on:click={() => handleCancelStuckJob(job)} disabled={cancellingJobId === job.id} title="Stuck? Mark this job as failed so you can retry.">
                  {cancellingJobId === job.id ? 'Cancelling…' : 'Cancel'}
                </button>
              {:else if !job.step_file_name}
                <span class="text-muted">—</span>
              {/if}
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

{#if showNewJobModal}
  <div class="modal-backdrop" on:click|self={closeNewJobModal} role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Escape') closeNewJobModal(); }}>
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>New AutoCAM Job</h3>
        <button type="button" class="modal-close-button" aria-label="Close" on:click={closeNewJobModal}><X size={18} /></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label" for="job-name">Job Name <span class="text-muted">(optional)</span></label>
          <input id="job-name" class="form-input" placeholder="e.g. Gearbox side plate" bind:value={newJobName} />
        </div>

        <div class="form-row two-col">
          <div class="form-group">
            <label class="form-label" for="job-operation">Operation</label>
            <div class="source-toggle" id="job-operation">
              <button class="btn btn-sm" class:btn-primary={newJobOperation === 'turning'} class:btn-secondary={newJobOperation !== 'turning'} on:click={() => (newJobOperation = 'turning')}>Turning</button>
              <button class="btn btn-sm" class:btn-primary={newJobOperation === 'routing'} class:btn-secondary={newJobOperation !== 'routing'} on:click={() => (newJobOperation = 'routing')}>Routing</button>
              <button class="btn btn-sm btn-secondary" disabled title="Not implemented yet - see millimplementations.md">Milling</button>
            </div>
          </div>
          <div class="form-group">
            <label class="form-label" for="job-source-toggle">Source</label>
            <div class="source-toggle" id="job-source-toggle">
              <button class="btn btn-sm" class:btn-primary={newJobSource === 'upload'} class:btn-secondary={newJobSource !== 'upload'} on:click={() => (newJobSource = 'upload')}>Standalone Upload</button>
              <button class="btn btn-sm" class:btn-primary={newJobSource === 'part'} class:btn-secondary={newJobSource !== 'part'} on:click={() => (newJobSource = 'part')}>Link to Existing Part</button>
            </div>
          </div>
        </div>

        {#if newJobSource === 'part'}
          <div class="part-picker-filters">
            <div class="filters">
              <div class="form-group">
                <label class="form-label" for="part-search">Search ({newJobOperation === 'turning' ? 'lathe' : 'router'} workflow)</label>
                <input id="part-search" class="form-input" placeholder="Part name..." bind:value={partSearchTerm} />
              </div>
              <div class="form-group">
                <label class="form-label" for="part-status">Status</label>
                <select id="part-status" class="form-select" bind:value={partFilterStatus}>
                  <option value="">All Statuses</option>
                  {#each PART_STATUSES as s}
                    <option value={s.value}>{s.label}</option>
                  {/each}
                </select>
              </div>
              <div class="form-group">
                <label class="form-label" for="part-project">Project</label>
                <select id="part-project" class="form-select" bind:value={partFilterProject}>
                  <option value="">All Projects</option>
                  {#each partProjectIds as pid}
                    <option value={pid}>{pid}</option>
                  {/each}
                </select>
              </div>
              <SeasonFilter options={partSeasonOptions} bind:value={partFilterSeason} />
            </div>
            <div class="team-filter-row">
              <TeamFilter bind:show971={partShow971} bind:show9584={partShow9584} />
            </div>
          </div>
          <div class="part-picker">
            {#if partsLoading}
              <p class="text-muted">Loading parts…</p>
            {:else if filteredEligibleParts.length === 0}
              <p class="text-muted">No {newJobOperation === 'turning' ? 'lathe' : 'router'} parts with a STEP file match these filters.</p>
            {:else}
              {#each filteredEligibleParts as p (p.id)}
                <label class="part-picker-row">
                  <input type="radio" name="part-pick" value={p.id} bind:group={selectedPartId} />
                  <span class="part-picker-name">{p.name}</span>
                  {#if p.project_id}<span class="part-picker-tag mono">{p.project_id}</span>{/if}
                  <span class="part-picker-tag">{PART_STATUSES.find((s) => s.value === p.status)?.label || p.status || 'Pending'}</span>
                </label>
              {/each}
            {/if}
          </div>
        {/if}

        {#if newJobSource === 'upload'}
          <div class="form-group">
            <label class="form-label" for="step-upload">STEP File</label>
            <input id="step-upload" class="form-input" type="file" accept=".step,.stp" on:change={(e) => (newJobFile = e.target.files?.[0] || null)} />
            <p class="cam-form-hint">
              {#if newJobOperation === 'turning'}
                Modeled with the spindle axis along the STEP file's Z axis, centered at X=0, Y=0 (lathe parts are
                physically solids of revolution, so the profile is read straight off the geometry).
              {:else}
                Modeled as a flat profile extruded along the STEP file's Z axis - the flat top/bottom face becomes
                the outline, holes included, and material thickness is read straight off the model.
              {/if}
            </p>
          </div>
        {:else}
          <p class="cam-form-hint">Uses the STEP file already attached to this part - nothing else to upload.</p>
        {/if}

        {#if newJobOperation === 'turning'}
          <CamParamFields operation="turning" bind:params={turningParams} mode="job" />
        {:else}
          <CamParamFields operation="routing" bind:params={routingParams} mode="job" />
          <RoutingToolSequence {tools} bind:sequence={routingParams.toolSequence} />
        {/if}

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="job-material">Material</label>
            <select id="job-material" class="form-select" bind:value={selectedMaterialId}>
              <option value="">Unspecified</option>
              {#each materials.filter((m) => m.enabled) as m}
                <option value={m.id}>{m.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="job-tool">Tool</label>
            <select id="job-tool" class="form-select" bind:value={selectedToolId}>
              <option value="">Unspecified</option>
              {#each tools.filter((t) => t.enabled) as t}
                <option value={t.id}>{t.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="job-machine">Machine Profile</label>
            <select id="job-machine" class="form-select" bind:value={selectedMachineId} on:change={() => applyMachineDefaults(selectedMachineId)}>
              <option value="">Unspecified</option>
              {#each machinesForOperation as mc}
                <option value={mc.id}>{mc.name}</option>
              {/each}
            </select>
            <p class="cam-form-hint">Loads that machine's saved defaults below.</p>
          </div>
        </div>

        <button class="btn btn-primary" on:click={submitNewJob} disabled={submitting}>
          {submitting ? 'Queuing…' : 'Generate G-code'}
        </button>
        <p class="cam-form-hint">Closes automatically once queued - track progress in the jobs list below.</p>
      </div>
    </div>
  </div>
{/if}

{#if showJobDetailModal && editingJob}
  <div class="modal-backdrop" on:click|self={closeJobDetailModal} role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Escape') closeJobDetailModal(); }}>
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>Edit Job</h3>
        <button type="button" class="modal-close-button" aria-label="Close" on:click={closeJobDetailModal}><X size={18} /></button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label class="form-label" for="edit-job-name">Job Name</label>
          <div class="input-group">
            <input id="edit-job-name" class="form-input" placeholder="e.g. Gearbox side plate" bind:value={editJobName} />
            <button class="btn btn-secondary btn-sm btn-nowrap" on:click={saveJobName} disabled={editRenaming || editJobName.trim() === (editingJob.name || '')}>
              {editRenaming ? 'Saving…' : 'Save Name'}
            </button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <span class="form-label">Operation</span>
            <p class="cam-form-hint">{editingJob.operation_type} (fixed - create a new job to change this)</p>
          </div>
          <div class="form-group">
            <span class="form-label">Status</span>
            <p class="cam-form-hint"><span class="status-badge {jobStatusClass(editingJob)}">{camJobStatusLabel(editingJob.status)}</span></p>
          </div>
        </div>

        <div class="view-buttons-row">
          <button class="btn btn-secondary btn-sm" on:click={() => (showJobCadModal = true)} disabled={!editingJob.step_file_name}>
            <Box size={14} /> View CAD
          </button>
          <button class="btn btn-secondary btn-sm" on:click={() => (showJobToolpathModal = true)} disabled={editingJob.status !== 'completed' || !editingJob.gcode} title={editingJob.status !== 'completed' ? 'Only available once the job has completed' : ''}>
            <Route size={14} /> View {editingJob.operation_type === 'turning' ? 'Turning' : 'Routing'} Toolpath
          </button>
        </div>

        {#if editingJob.operation_type === 'turning'}
          <CamParamFields operation="turning" bind:params={editParams} mode="job" />
        {:else}
          <CamParamFields operation="routing" bind:params={editParams} mode="job" />
          <RoutingToolSequence {tools} bind:sequence={editParams.toolSequence} />
        {/if}

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="edit-job-material">Material</label>
            <select id="edit-job-material" class="form-select" bind:value={editMaterialId}>
              <option value="">Unspecified</option>
              {#each materials.filter((m) => m.enabled) as m}
                <option value={m.id}>{m.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="edit-job-tool">Tool</label>
            <select id="edit-job-tool" class="form-select" bind:value={editToolId}>
              <option value="">Unspecified</option>
              {#each tools.filter((t) => t.enabled) as t}
                <option value={t.id}>{t.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="edit-job-machine">Machine Profile</label>
            <select id="edit-job-machine" class="form-select" bind:value={editMachineId}>
              <option value="">Unspecified</option>
              {#each machines.filter((mc) => mc.enabled && mc.operation_type === editingJob.operation_type) as mc}
                <option value={mc.id}>{mc.name}</option>
              {/each}
            </select>
          </div>
        </div>

        <div class="modal-footer-actions">
          <button class="btn btn-danger" on:click={deleteEditingJob} disabled={editDeleting}>
            {editDeleting ? 'Deleting…' : 'Delete Job'}
          </button>
          <button class="btn btn-primary" on:click={saveJobAndRegenerate} disabled={editSubmitting || !editingJob.step_file_name} title={!editingJob.step_file_name ? 'No stored STEP file to regenerate from' : ''}>
            {editSubmitting ? 'Queuing…' : 'Save & Regenerate'}
          </button>
        </div>
      </div>
    </div>
  </div>
{/if}

{#if showJobCadModal && editingJob}
  <div class="modal-backdrop" on:click|self={() => (showJobCadModal = false)} role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Escape') (showJobCadModal = false); }}>
    <div class="modal cad-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>CAD Preview - {jobDisplayName(editingJob)}</h3>
        <button type="button" class="modal-close-button" aria-label="Close" on:click={() => (showJobCadModal = false)}><X size={18} /></button>
      </div>
      <div class="modal-body">
        <CadViewer part={null} stepFileName={editingJob.step_file_name} />
        <p class="cam-form-hint">Drag to rotate · scroll to zoom · right-drag to pan</p>
      </div>
    </div>
  </div>
{/if}

{#if showJobToolpathModal && editingJob}
  <div class="modal-backdrop" on:click|self={() => (showJobToolpathModal = false)} role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Escape') (showJobToolpathModal = false); }}>
    <div class="modal toolpath-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>{editingJob.operation_type === 'turning' ? 'Turning' : 'Routing'} Toolpath - {jobDisplayName(editingJob)}</h3>
        <button type="button" class="modal-close-button" aria-label="Close" on:click={() => (showJobToolpathModal = false)}><X size={18} /></button>
      </div>
      <div class="modal-body">
        <ToolpathViewer gcode={editingJob.gcode} operationType={editingJob.operation_type} />
      </div>
    </div>
  </div>
{/if}

{#if showMachineModal}
  <div class="modal-backdrop" on:click|self={closeMachineModal} role="button" tabindex="0" on:keydown={(e) => { if (e.key === 'Escape') closeMachineModal(); }}>
    <div class="modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <h3>{editingMachineId ? 'Edit' : 'New'} Machine Profile</h3>
        <button type="button" class="modal-close-button" aria-label="Close" on:click={closeMachineModal}><X size={18} /></button>
      </div>
      <div class="modal-body">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="mp-name">Name</label>
            <input id="mp-name" class="form-input" placeholder="e.g. 971 Lathe" bind:value={machineForm.name} />
          </div>
          <div class="form-group">
            <label class="form-label" for="mp-desc">Description</label>
            <input id="mp-desc" class="form-input" placeholder="e.g. Haas TL-1" bind:value={machineForm.description} />
          </div>
        </div>

        <div class="form-group">
          <label class="form-label" for="mp-operation">Operation Type</label>
          <div class="source-toggle" id="mp-operation">
            <button class="btn btn-sm" class:btn-primary={machineForm.operation_type === 'turning'} class:btn-secondary={machineForm.operation_type !== 'turning'} on:click={() => setMachineFormOperation('turning')}>Turning (Lathe)</button>
            <button class="btn btn-sm" class:btn-primary={machineForm.operation_type === 'routing'} class:btn-secondary={machineForm.operation_type !== 'routing'} on:click={() => setMachineFormOperation('routing')}>Routing (Router)</button>
          </div>
        </div>

        <div class="form-row">
          <div class="form-group">
            <label class="form-label" for="mp-material">Default Material</label>
            <select id="mp-material" class="form-select" bind:value={machineForm.default_material_id}>
              <option value="">None</option>
              {#each materials as m}
                <option value={m.id}>{m.name}</option>
              {/each}
            </select>
          </div>
          <div class="form-group">
            <label class="form-label" for="mp-tool">Default Tool</label>
            <select id="mp-tool" class="form-select" bind:value={machineForm.default_tool_id}>
              <option value="">None</option>
              {#each tools as t}
                <option value={t.id}>{t.name}</option>
              {/each}
            </select>
          </div>
          {#if machineForm.operation_type === 'routing'}
            <div class="form-group">
              <label class="form-label" for="mp-gcode-ext">Output File Type</label>
              <select id="mp-gcode-ext" class="form-select" bind:value={machineForm.gcode_extension}>
                <option value="ngc">.ngc (default)</option>
                <option value="tap">.tap (Mach3/Mach4)</option>
              </select>
            </div>
          {/if}
        </div>

        <CamParamFields operation={machineForm.operation_type} bind:params={machineForm.params} mode="profile" />
        {#if machineForm.operation_type === 'routing'}
          <RoutingToolSequence {tools} bind:sequence={machineForm.params.toolSequence} />
        {/if}

        <button class="btn btn-primary" on:click={saveMachine} disabled={savingMachine}>
          {savingMachine ? 'Saving…' : 'Save Machine Profile'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .page-subtitle {
    color: var(--text-muted);
    margin: -0.5rem 0 1rem;
    font-size: var(--font-sm, 0.9rem);
  }

  .setup-warning {
    display: flex;
    align-items: flex-start;
    gap: 0.75rem;
    background: var(--yellow-soft, #fef9c3);
    color: var(--yellow-strong, #854d0e);
    border: 1px solid var(--yellow-base, #ca8a04);
  }
  .setup-warning p { margin: 0.35rem 0 0; font-size: var(--font-sm, 0.9rem); }
  .setup-warning code {
    background: rgba(0, 0, 0, 0.08);
    padding: 0.05rem 0.3rem;
    border-radius: 3px;
    font-size: 0.85em;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: var(--gap-3, 0.75rem);
    margin-bottom: 1rem;
  }
  .stat-card {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    background: var(--surface-1, var(--primary));
    border: 1px solid var(--border);
    border-radius: var(--radius-lg, 8px);
    padding: 1rem;
  }
  .stat-info h3 { margin: 0; font-size: 1.4rem; line-height: 1.1; }
  .stat-info p { margin: 0.15rem 0 0; font-size: var(--font-xs, 0.75rem); color: var(--text-muted); }

  .machine-profiles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
    gap: 1rem;
    margin-top: 0.75rem;
  }
  .machine-profile-card {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 4px);
    padding: 0.85rem;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .machine-profile-card.disabled { opacity: 0.5; }
  .machine-profile-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 0.5rem; }
  .machine-profile-header > div { display: flex; flex-direction: column; gap: 0.3rem; align-items: flex-start; }
  .machine-profile-desc { margin: 0; font-size: var(--font-xs, 0.75rem); color: var(--text-muted); }
  .machine-profile-meta { display: flex; flex-wrap: wrap; gap: 0.4rem; }
  .machine-profile-actions { display: flex; gap: 0.5rem; margin-top: auto; }
  .machine-profile-actions .btn { flex: 1; justify-content: center; }
  .machine-profile-add {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    min-height: 100px;
    border: 1px dashed var(--border);
    border-radius: var(--radius-sm, 4px);
    background: none;
    color: var(--text-muted);
    cursor: pointer;
    font-size: var(--font-sm, 0.9rem);
  }
  .machine-profile-add:hover { border-color: var(--accent); color: var(--accent); }

  .profiles-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(240px, 1fr));
    gap: 1.5rem;
  }

  .profile-col h3 { margin: 0 0 0.5rem; font-size: 1rem; }

  .profile-row {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.35rem 0;
    border-bottom: 1px solid var(--border);
  }

  .profile-row.disabled { opacity: 0.5; }

  .input-group {
    display: flex;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }

  .name-line {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }

  .job-part-link {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-top: 0.15rem;
    font-size: var(--font-xs, 0.75rem);
    color: var(--accent-strong, #1d4ed8);
    text-decoration: none;
  }
  .job-part-link:hover { text-decoration: underline; }

  .status-badge.status-running { background: var(--purple-soft); color: var(--purple-strong); border-color: var(--purple-soft); }
  .status-badge.status-complete { background: var(--green-soft); color: var(--green-strong); border-color: var(--green-soft); }
  .status-badge.status-error { background: var(--red-soft); color: var(--red-strong); border-color: var(--red-soft); }

  .job-error {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    color: var(--red-strong);
    font-size: var(--font-xs, 0.75rem);
  }

  .job-row {
    cursor: pointer;
  }
  .job-row:hover {
    background: var(--surface-2, var(--background));
  }
  .job-row:focus-visible {
    outline: 2px solid var(--accent-strong, #1d4ed8);
    outline-offset: -2px;
  }

  .view-buttons-row {
    display: flex;
    gap: 0.5rem;
    margin: -0.5rem 0 1rem;
  }

  .cad-modal { width: min(900px, 95vw); max-width: 95vw; }
  .toolpath-modal { width: min(700px, 95vw); max-width: 95vw; }

  .modal-footer-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--border, #e5e5e5);
  }

  .job-output-failed {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    flex-wrap: wrap;
    margin-top: 0.4rem;
  }

  .output-cell { min-width: 260px; }
  .output-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .job-row-progress {
    margin-top: 0.3rem;
    min-width: 120px;
  }
  .job-row-progress-bar {
    height: 4px;
    border-radius: 2px;
    background: var(--surface-2, var(--background));
    overflow: hidden;
  }
  .job-row-progress-fill {
    height: 100%;
    background: var(--purple-strong, #7c3aed);
    transition: width 0.3s ease;
  }
  .job-row-progress-label {
    display: block;
    margin-top: 0.2rem;
    font-size: var(--font-xs, 0.7rem);
    color: var(--text-muted);
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 3rem 1rem;
    color: var(--text-muted);
    text-align: center;
  }
  .empty-state h3 { margin: 0; color: var(--text); }
  .empty-state p { margin: 0; }

  .source-toggle {
    display: flex;
    gap: 0.5rem;
    margin-bottom: 1rem;
  }

  .cam-form-hint {
    font-size: var(--font-xs, 0.75rem);
    color: var(--text-muted);
    margin: 0.35rem 0 0;
  }

  .part-picker-filters {
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 4px);
    padding: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .part-picker {
    max-height: 260px;
    overflow-y: auto;
    border: 1px solid var(--border);
    border-radius: var(--radius-sm, 4px);
    padding: 0.25rem 0.5rem;
    margin-bottom: 1rem;
  }

  .part-picker-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.4rem 0.15rem;
    border-bottom: 1px solid var(--border);
    cursor: pointer;
  }

  .part-picker-row:last-child { border-bottom: none; }

  /* Global .modal input styling (width:100%, fixed height/border/background)
     otherwise stretches these bare radio inputs into full-width boxes and
     wrecks the row layout - reset back to a normal small radio control. */
  .part-picker-row input[type='radio'] {
    flex: 0 0 auto;
    width: 16px;
    height: 16px;
    min-width: 16px;
    padding: 0;
    margin: 0;
    border: none;
    background: none;
  }

  .part-picker-name {
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .part-picker-tag {
    flex: 0 0 auto;
    white-space: nowrap;
    font-size: var(--font-xs, 0.75rem);
    color: var(--text-muted);
  }

  .team-filter-row {
    margin-top: var(--space-3, 0.75rem);
    padding-top: var(--space-3, 0.75rem);
    border-top: 1px solid var(--border);
  }

  .form-row {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }
  .form-row.two-col {
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
  }
</style>
