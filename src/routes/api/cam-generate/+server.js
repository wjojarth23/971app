import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { readStepMeshes, extractTurningProfileFromMeshes, extractRoutingContoursFromMeshes } from '$lib/cam/stepProfile.js';
import { generateTurningGcode } from '$lib/cam/turning.js';
import { generateRoutingGcode } from '$lib/cam/routing.js';

// Vercel serverless functions default to a short execution limit (as low as
// 10s on some plans) - this route does a STEP file download, WASM parser
// load (occt-import-js, slow on a cold start), geometry extraction, and
// several Supabase round trips, which can plausibly exceed that default.
// Raises the ceiling on Vercel; harmless everywhere else (adapter-auto only
// applies Vercel-specific route config when actually deploying to Vercel).
export const config = { maxDuration: 60 };

function getClientFromRequest(request) {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
}

class CancelledError extends Error {}

// Combines the progress write AND the cancellation check into one round
// trip (conditioned on status still being 'processing' - if 0 rows match,
// something else, like the "Cancel" button, already moved this job out of
// "processing", so bail immediately instead of continuing to grind on a job
// nobody's waiting on). This used to be two separate calls (a select to
// check, an update to write) - serverless functions (Vercel) have a real
// execution time budget, and every extra network round trip to Supabase
// eats into it, so cutting this in half matters more here than it would on
// a long-running local Node process.
async function setProgress(supabase, jobId, progress, progress_message) {
  const { data, error } = await supabase
    .from('cam_jobs')
    .update({ progress, progress_message })
    .eq('id', jobId)
    .eq('status', 'processing')
    .select('id');
  if (error) {
    console.error('CAM progress update failed (non-fatal)', error);
    return; // best-effort - a network blip on a progress update must not take down generation
  }
  if (!data?.length) throw new CancelledError('Job was cancelled before generation finished');
}

// Best-effort terminal-failure write - also never allowed to throw. This is
// the single most important guarantee in this file: no matter what breaks
// above (a thrown exception, a bad STEP file, a Supabase hiccup), the job
// must always end up in a terminal status instead of sitting at "queued" /
// "processing" forever with the UI spinning indefinitely.
async function markFailed(supabase, jobId, message) {
  try {
    await supabase.from('cam_jobs').update({
      status: 'failed',
      errors: [message],
      progress_message: message
    }).eq('id', jobId);
  } catch (e) {
    console.error('CAM job failed AND the failure write itself failed - job may be stuck', jobId, e);
  }
}

// Synchronous, server-side G-code generation. Called right after a job is
// queued (auto-trigger on upload, or the /autocam manual flow) - there is no
// external Runner/queue-poller for turning or routing, since both are pure
// geometry math that finishes in well under a second for realistic profiles.
//
// Everything from the job load onward is inside one try/catch so a job can
// never get stuck at "queued"/"processing" - any failure, anywhere, gets
// written back as a specific `failed` status + error message.
export async function POST({ request }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ success: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const jobId = body?.jobId;
  if (!jobId) return json({ success: false, error: 'jobId is required' }, { status: 400 });

  const supabase = getClientFromRequest(request);

  try {
    const { data: job, error: loadError } = await supabase
      .from('cam_jobs')
      .select('*, cam_tools(nose_radius, diameter)')
      .eq('id', jobId)
      .single();

    if (loadError || !job) {
      return json({ success: false, error: loadError?.message || 'Job not found' }, { status: 404 });
    }
    if (job.status !== 'queued') {
      return json({ success: false, error: `Job is already ${job.status}, not generating again` }, { status: 409 });
    }
    if (job.operation_type === 'milling') {
      await supabase.from('cam_jobs').update({
        status: 'rejected',
        errors: ['Milling is not implemented yet - see millimplementations.md']
      }).eq('id', jobId);
      return json({ success: false, error: 'Milling is not implemented yet' }, { status: 400 });
    }
    if (!job.step_file_name) {
      await markFailed(supabase, jobId, 'No STEP file attached to this job');
      return json({ success: false, error: 'No STEP file attached to this job' }, { status: 400 });
    }

    const { data: claimData, error: claimError } = await supabase
      .from('cam_jobs')
      .update({ status: 'processing', progress: 5, progress_message: 'Downloading STEP file...' })
      .eq('id', jobId)
      .eq('status', 'queued') // compare-and-swap: only one caller can ever win the claim
      .select('id');
    if (claimError) throw new Error(`Could not claim job for processing: ${claimError.message}`);
    if (!claimData?.length) throw new CancelledError('Job was already claimed or cancelled before processing started');

    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('manufacturing-files')
      .download(job.step_file_name);
    if (downloadError || !fileBlob) {
      throw new Error(downloadError?.message || 'Could not download the STEP file from storage');
    }

    await setProgress(supabase, jobId, 20, 'Loading STEP geometry parser...');
    const stepBuffer = new Uint8Array(await fileBlob.arrayBuffer());
    const meshes = await readStepMeshes(stepBuffer);

    await setProgress(supabase, jobId, 55, 'Extracting toolpath geometry...');
    const params = { ...(job.params || {}) };
    if (job.cam_tools?.nose_radius && params.noseRadius === undefined) params.noseRadius = job.cam_tools.nose_radius;
    if (job.cam_tools?.diameter && params.toolDiameter === undefined) params.toolDiameter = job.cam_tools.diameter;

    let result;
    if (job.operation_type === 'turning') {
      const profile = extractTurningProfileFromMeshes(meshes);
      await setProgress(supabase, jobId, 80, 'Generating turning G-code...');
      result = generateTurningGcode(profile, params);
    } else {
      const { contours, thickness } = extractRoutingContoursFromMeshes(meshes);
      if (params.targetDepth === undefined && thickness) params.targetDepth = thickness;
      await setProgress(supabase, jobId, 80, 'Generating routing G-code...');
      result = generateRoutingGcode(contours, params);
    }

    // Conditioned on status still being 'processing' (compare-and-swap) so a
    // cancel that lands in the split second between the last check above and
    // this write can never get silently clobbered back to "completed". No
    // separate 95%-progress write first - it's this same write, one round
    // trip instead of two.
    const { data: updateData, error: updateError } = await supabase
      .from('cam_jobs')
      .update({
        status: 'completed',
        gcode: result.gcode,
        gcode_file_name: job.gcode_file_name || 'output.ngc',
        params, // includes any auto-derived values (e.g. targetDepth from STEP thickness)
        stats: result.stats,
        progress: 100,
        progress_message: 'Done'
      })
      .eq('id', jobId)
      .eq('status', 'processing')
      .select('id');
    if (updateError) throw new Error(updateError.message);
    if (!updateData?.length) throw new CancelledError('Job was cancelled just before it finished');

    return json({ success: true, jobId, stats: result.stats });
  } catch (e) {
    if (e instanceof CancelledError) {
      // The job's status already reflects whatever cancelled it (set by the
      // "Cancel" button, a delete, etc.) - don't overwrite that with a
      // generic failure message.
      return json({ success: false, error: e.message, cancelled: true }, { status: 409 });
    }
    const message = e?.message || String(e) || 'CAM generation failed';
    await markFailed(supabase, jobId, message);
    return json({ success: false, error: message }, { status: 500 });
  }
}
