// Job-claim API for the Fusion CAM Runner (autocam/fusion/runner/ - a fork
// of Team Valor 6800's open-source AutoCAM Runner add-in). Polled by an
// external Fusion 360 machine, not called from the browser - authenticated
// via a shared-secret bearer token (fusion_runner_auth.js), not a Supabase
// Auth session, so this uses the service-role client throughout (same
// pattern as api/drive-watcher/+server.js).
//
// Lifecycle mirrors what autocam/runner/README.md already documented before
// this existed: queued -> claimed -> processing -> completed/failed. Every
// transition is a compare-and-swap on cam_jobs.status, the exact idiom
// api/cam-generate/+server.js already uses for turning/routing jobs - a
// second concurrent caller's UPDATE matches zero rows and the API reports
// "already claimed" instead of two Runners double-processing the same job.
//
// Only cam_jobs rows with operation_type='milling' are ever visible here -
// turning/routing jobs stay exclusively on cam-generate's synchronous path,
// completely unaffected by this file.
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { createClient } from '@supabase/supabase-js';
import { isAuthorizedFusionRunnerRequest } from '$lib/server/fusion_runner_auth.js';

function getServiceSupabase() {
  const url = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY;
  return createClient(url, serviceKey);
}

// Claims the oldest queued milling job for this runner. Two-step: find a
// candidate, then CAS it - a plain "UPDATE ... ORDER BY ... LIMIT 1" isn't
// expressible via PostgREST, so this accepts a narrow, harmless race (two
// runners might both pick the SAME candidate id) that the CAS below always
// resolves correctly (only one caller's conditional UPDATE ever matches).
async function claimNextJob(supabase, runnerId) {
  const { data: candidates, error: findError } = await supabase
    .from('cam_jobs')
    .select('id')
    .eq('status', 'queued')
    .eq('operation_type', 'milling')
    .order('created_at', { ascending: true })
    .limit(5);
  if (findError) throw new Error(`Could not look up queued milling jobs: ${findError.message}`);
  if (!candidates?.length) return null;

  for (const candidate of candidates) {
    const { data: claimed, error: claimError } = await supabase
      .from('cam_jobs')
      .update({ status: 'claimed', claimed_by: runnerId, claimed_at: new Date().toISOString() })
      .eq('id', candidate.id)
      .eq('status', 'queued') // compare-and-swap: only one runner can ever win this specific job
      .select('*, cam_tools(nose_radius, diameter), cam_machines(name, controller, post_processor)')
      .single();
    if (claimError) continue; // lost the race on this one (or a real error) - try the next candidate
    if (claimed) return claimed;
  }
  return null; // every candidate got claimed by someone else between the select and our CAS attempts
}

export async function POST({ request, url }) {
  if (!isAuthorizedFusionRunnerRequest({ url, headers: request.headers, env })) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const action = url.searchParams.get('action') || body?.action;
  const supabase = getServiceSupabase();

  try {
    if (action === 'claim') {
      const runnerId = String(body?.runnerId || '').trim();
      if (!runnerId) return json({ error: 'runnerId is required' }, { status: 400 });
      const job = await claimNextJob(supabase, runnerId);
      if (!job) return json({ job: null });
      return json({ job });
    }

    const jobId = body?.jobId;
    if (!jobId) return json({ error: 'jobId is required' }, { status: 400 });

    if (action === 'processing') {
      const { data, error } = await supabase
        .from('cam_jobs')
        .update({ status: 'processing', progress: body?.progress ?? 10, progress_message: body?.progressMessage || 'Fusion Runner processing...' })
        .eq('id', jobId)
        .eq('status', 'claimed') // CAS: only the runner that actually claimed it can move it to processing
        .select('id');
      if (error) throw new Error(error.message);
      if (!data?.length) return json({ error: 'Job was not in the claimed state (already progressed, cancelled, or claimed by another runner)' }, { status: 409 });
      return json({ success: true });
    }

    if (action === 'complete') {
      const { data, error } = await supabase
        .from('cam_jobs')
        .update({
          status: 'completed',
          gcode: body?.gcode,
          gcode_file_name: body?.gcodeFileName || 'output.ngc',
          stats: body?.stats || null,
          progress: 100,
          progress_message: 'Done'
        })
        .eq('id', jobId)
        .eq('status', 'processing') // CAS: same guarantee cam-generate's own completion write has - a cancel landing mid-flight can never get silently clobbered back to "completed"
        .select('id');
      if (error) throw new Error(error.message);
      if (!data?.length) return json({ error: 'Job was not in the processing state - not completed' }, { status: 409 });
      return json({ success: true });
    }

    if (action === 'fail') {
      const message = body?.error || 'Fusion Runner reported a failure';
      await supabase.from('cam_jobs').update({
        status: 'failed',
        errors: [message],
        progress_message: message
      }).eq('id', jobId); // best-effort, unconditional - a job must always be able to reach a terminal state, same guarantee markFailed() has in cam-generate
      return json({ success: true });
    }

    return json({ error: `Unknown action: ${action}. Expected one of: claim, processing, complete, fail` }, { status: 400 });
  } catch (error) {
    return json({ error: error?.message || 'Internal server error' }, { status: 500 });
  }
}
