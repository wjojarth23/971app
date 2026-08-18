import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_ANON_KEY, PUBLIC_SUPABASE_URL } from '$env/static/public';
import { readStepMeshes, extractTurningProfileFromMeshes, extractRoutingContoursFromMeshes } from '$lib/cam/stepProfile.js';
import { generateTurningGcode } from '$lib/cam/turning.js';
import { generateRoutingGcode } from '$lib/cam/routing.js';

function getClientFromRequest(request) {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
}

// Synchronous, server-side G-code generation. Called right after a job is
// queued (auto-trigger on upload, or the /autocam manual flow) - there is no
// external Runner/queue-poller for turning or routing, since both are pure
// geometry math that finishes in well under a second for realistic profiles.
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
    await supabase.from('cam_jobs').update({ status: 'failed', errors: ['No STEP file attached to this job'] }).eq('id', jobId);
    return json({ success: false, error: 'No STEP file attached to this job' }, { status: 400 });
  }

  await supabase.from('cam_jobs').update({ status: 'processing' }).eq('id', jobId);

  try {
    const { data: fileBlob, error: downloadError } = await supabase.storage
      .from('manufacturing-files')
      .download(job.step_file_name);
    if (downloadError || !fileBlob) {
      throw new Error(downloadError?.message || 'Could not download the STEP file from storage');
    }
    const stepBuffer = new Uint8Array(await fileBlob.arrayBuffer());
    const meshes = await readStepMeshes(stepBuffer);

    const params = { ...(job.params || {}) };
    if (job.cam_tools?.nose_radius && params.noseRadius === undefined) params.noseRadius = job.cam_tools.nose_radius;
    if (job.cam_tools?.diameter && params.toolDiameter === undefined) params.toolDiameter = job.cam_tools.diameter;

    let result;
    if (job.operation_type === 'turning') {
      const profile = extractTurningProfileFromMeshes(meshes);
      result = generateTurningGcode(profile, params);
    } else {
      const { contours, thickness } = extractRoutingContoursFromMeshes(meshes);
      if (params.targetDepth === undefined && thickness) params.targetDepth = thickness;
      result = generateRoutingGcode(contours, params);
    }

    const { error: updateError } = await supabase
      .from('cam_jobs')
      .update({
        status: 'completed',
        gcode: result.gcode,
        gcode_file_name: job.gcode_file_name || 'output.ngc',
        params, // includes any auto-derived values (e.g. targetDepth from STEP thickness)
        stats: result.stats
      })
      .eq('id', jobId);
    if (updateError) throw new Error(updateError.message);

    return json({ success: true, jobId, stats: result.stats });
  } catch (e) {
    const message = e?.message || 'CAM generation failed';
    await supabase.from('cam_jobs').update({ status: 'failed', errors: [message] }).eq('id', jobId);
    return json({ success: false, error: message }, { status: 500 });
  }
}
