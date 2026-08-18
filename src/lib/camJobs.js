/**
 * Shared helpers for the AutoCAM (CAM Studio) job queue.
 * Used by both /manufacture (queue-from-existing-part) and /autocam
 * (queue-from-upload or queue-from-existing-part) so job creation stays
 * consistent in one place.
 */

import { supabase } from '$lib/supabase.js';

export const ACTIVE_CAM_JOB_STATUSES = ['queued', 'claimed', 'processing'];
export const TERMINAL_CAM_JOB_STATUSES = ['completed', 'failed', 'rejected'];

// All cam_jobs.gcode_format must stay 'ngc' - see autocam-runner/README.md.
export const CAM_GCODE_FORMAT = 'ngc';

const CAM_STATUS_DISPLAY = {
  queued: 'Generating CAM',
  claimed: 'Generating CAM',
  processing: 'Generating CAM',
  completed: 'Completed',
  failed: 'Autocam Failed',
  rejected: 'Job Rejected'
};

/** Collapsed, user-facing label for a job status (queued/claimed/processing all read as "Generating CAM"). */
export function camJobStatusLabel(status) {
  return CAM_STATUS_DISPLAY[status] || status || '';
}

export function isCamJobActive(job) {
  return !!job && ACTIVE_CAM_JOB_STATUSES.includes(job.status);
}

/** User-given job name if set, else a sensible fallback (linked part name or uploaded filename). */
export function jobDisplayName(job) {
  if (job?.name) return job.name;
  if (job?.source_type === 'part') return job?.parts?.name || (job?.part_id ? `Part #${job.part_id}` : 'Untitled job');
  return job?.step_file_name?.split('/').pop() || 'Untitled job';
}

/** Turn a part/file name into a safe `<slug>.ngc` filename. */
export function gcodeFileNameFor(name) {
  const slug = String(name || 'part')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'part';
  return `${slug}.ngc`;
}

// router/lathe workflow -> the operation_type generation dispatches on.
export const WORKFLOW_OPERATION_TYPE = { router: 'routing', lathe: 'turning' };

function isStepFile(name) {
  return /\.(step|stp)$/i.test(name || '');
}

async function uploadStepFile(file) {
  if (!file) return { error: 'No STEP file provided' };
  if (!isStepFile(file.name)) return { error: 'CAM input must be a .step or .stp file' };
  const storagePath = `cam-jobs/${crypto.randomUUID()}-${file.name}`;
  const { error } = await supabase.storage
    .from('manufacturing-files')
    .upload(storagePath, file, { cacheControl: '3600', upsert: false });
  return error ? { error: error.message } : { path: storagePath };
}

// Calls the server-side generator immediately after a job is queued - there
// is no external Runner for turning/routing, generation is synchronous math
// that finishes in well under a second. Returns the job row after generation
// (status will be 'completed' or 'failed' by the time this resolves).
async function triggerGenerationAndRefetch(jobId) {
  try {
    await fetch('/api/cam-generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId })
    });
  } catch (e) {
    console.error('CAM generation request failed', e);
  }
  const { data } = await supabase.from('cam_jobs').select('*').eq('id', jobId).single();
  return data;
}

/**
 * Queue + immediately generate a CAM job from a part. Uses the part's
 * already-uploaded STEP file (getPartStepFileName) by default - no separate
 * CAM-specific upload needed, since router and lathe parts both require a
 * STEP file at creation time now. Pass `profileFile` only to attach/replace
 * the STEP for a part that doesn't have one yet (e.g. a legacy lathe part
 * created before STEP was required for that workflow).
 * @param {Object} part - part row (needs id, name, workflow, file_name/file_url for its STEP)
 * @param {Object} options - { operationType, materialId, toolId, machineId, params, userId, name, profileFile }
 */
export async function queueCamJobForPart(part, options = {}) {
  if (!part?.id) return { success: false, error: 'Missing part' };
  const operationType = options.operationType || WORKFLOW_OPERATION_TYPE[part.workflow];
  if (!operationType) return { success: false, error: `No CAM operation type for workflow "${part.workflow}"` };

  let stepPath;
  if (options.profileFile) {
    const upload = await uploadStepFile(options.profileFile);
    if (upload.error) return { success: false, error: upload.error };
    stepPath = upload.path;
  } else {
    stepPath = getPartStepFileName(part);
    if (!stepPath) return { success: false, error: 'This part has no STEP file attached yet' };
  }

  const { data, error } = await supabase
    .from('cam_jobs')
    .insert({
      name: options.name || null,
      source_type: 'part',
      part_id: part.id,
      operation_type: operationType,
      step_file_name: stepPath,
      material_id: options.materialId || null,
      tool_id: options.toolId || null,
      machine_id: options.machineId || null,
      params: options.params || {},
      gcode_file_name: gcodeFileNameFor(part.name),
      gcode_format: CAM_GCODE_FORMAT,
      status: 'queued',
      requested_by: options.userId || null
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  const finalJob = await triggerGenerationAndRefetch(data.id);
  return { success: finalJob?.status === 'completed', job: finalJob || data, error: finalJob?.errors?.[0] };
}

/**
 * Upload a fresh STEP file and queue + generate a CAM job from it (no
 * existing part) - used by the /autocam page's manual "New Job" flow.
 * @param {File} profileFile - the .step/.stp file
 * @param {Object} options - { operationType (required), materialId, toolId, machineId, params, userId, baseName }
 */
export async function queueCamJobFromUpload(profileFile, options = {}) {
  if (!options.operationType) return { success: false, error: 'operationType is required (turning or routing)' };

  const upload = await uploadStepFile(profileFile);
  if (upload.error) return { success: false, error: upload.error };

  const baseName = options.baseName || (profileFile?.name || 'part').replace(/\.(step|stp)$/i, '');
  const { data, error } = await supabase
    .from('cam_jobs')
    .insert({
      name: options.name || null,
      source_type: 'upload',
      operation_type: options.operationType,
      step_file_name: upload.path,
      material_id: options.materialId || null,
      tool_id: options.toolId || null,
      machine_id: options.machineId || null,
      params: options.params || {},
      gcode_file_name: gcodeFileNameFor(baseName),
      gcode_format: CAM_GCODE_FORMAT,
      status: 'queued',
      requested_by: options.userId || null
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  const finalJob = await triggerGenerationAndRefetch(data.id);
  return { success: finalJob?.status === 'completed', job: finalJob || data, error: finalJob?.errors?.[0] };
}

/**
 * Re-queue + regenerate from a failed (or completed) job's already-uploaded
 * STEP file - no re-upload needed, the file is still in storage.
 * @param {Object} job - a cam_jobs row (needs step_file_name, operation_type)
 * @param {Object} options - { userId } - other fields (material/tool/machine/params) carry over from the job
 */
export async function retryCamJob(job, options = {}) {
  if (!job?.step_file_name) return { success: false, error: 'No stored CAM profile to retry from' };

  const { data, error } = await supabase
    .from('cam_jobs')
    .insert({
      name: job.name || null,
      source_type: job.source_type,
      part_id: job.part_id || null,
      operation_type: job.operation_type,
      step_file_name: job.step_file_name,
      material_id: job.material_id || null,
      tool_id: job.tool_id || null,
      machine_id: job.machine_id || null,
      params: job.params || {},
      gcode_file_name: job.gcode_file_name || null,
      gcode_format: CAM_GCODE_FORMAT,
      status: 'queued',
      requested_by: options.userId || job.requested_by || null
    })
    .select()
    .single();

  if (error) return { success: false, error: error.message };
  const finalJob = await triggerGenerationAndRefetch(data.id);
  return { success: finalJob?.status === 'completed', job: finalJob || data, error: finalJob?.errors?.[0] };
}

/**
 * Storage path of an uploaded STEP file for a part, if any. Mirrors the
 * getStepFileName() logic already used in the manufacture pages.
 */
export function getPartStepFileName(part) {
  let meta = {};
  try { meta = JSON.parse(part?.file_url || '{}') || {}; } catch { meta = {}; }
  if (meta.step_file) return meta.step_file;
  if (part?.file_name && /\.(step|stp)$/i.test(part.file_name)) return part.file_name;
  return null;
}

export function partHasStepFile(part) {
  return !!getPartStepFileName(part);
}

/** Trigger a browser download of a completed job's G-code (always .ngc). */
export function downloadGcodeBlob(job) {
  if (!job?.gcode) return;
  const blob = new Blob([job.gcode], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = job.gcode_file_name || `output.${CAM_GCODE_FORMAT}`;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Load the most recent cam_jobs row for each of the given part IDs.
 * Returns a Map keyed by part_id -> job row.
 */
export async function loadLatestCamJobsForParts(partIds = []) {
  const ids = [...new Set((partIds || []).filter((id) => id !== null && id !== undefined))];
  if (ids.length === 0) return new Map();

  const { data, error } = await supabase
    .from('cam_jobs')
    .select('*')
    .in('part_id', ids)
    .order('created_at', { ascending: false });

  const map = new Map();
  if (error || !data) return map;
  for (const job of data) {
    if (!map.has(job.part_id)) map.set(job.part_id, job); // first hit per part_id is the newest (already ordered desc)
  }
  return map;
}
