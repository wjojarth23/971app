/**
 * Google Drive auto-trigger sweep for AutoCAM - see
 * implementations/drive-watcher-cron-plan.md for the full design.
 *
 * STATUS: built, wired up, and safe to ship with zero configuration - but
 * genuinely untested against a real Google Drive folder, because this
 * environment has no Google credentials. runDriveWatcherSweep() below is a
 * deliberate no-op ({ ok: true, skipped: true, reason: 'not_configured' })
 * until GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY is set AND at least one
 * cam_machines row has a drive_folder_id. The first real sweep against a
 * real folder should be treated as unverified - watch it closely, same as
 * every G-code file this app produces gets a "run it in a simulator first"
 * warning.
 *
 * No googleapis npm dependency - this repo has had no npm install access at
 * points in its history (see the DXF/Clipper decisions in turning.js /
 * routing.js) and Drive API v3 + a service-account OAuth2 token exchange is
 * a small enough surface to hand-roll with plain fetch() and Node's built-in
 * crypto (RS256 JWT signing) - same zero-dependency approach already used
 * elsewhere in this CAM system.
 *
 * Scope: drive.readonly only - this only ever reads/downloads files, never
 * writes to Drive. Per the plan's security notes, the service account
 * should only ever be shared with the specific folders being watched.
 */

import crypto from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { env } from '$env/dynamic/private';
import { gcodeFileNameFor } from '$lib/camJobs.js';

const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.readonly';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const MAX_FILES_PER_SWEEP_PER_MACHINE = 10;
const STEP_NAME_RE = /\.(step|stp)$/i;

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// Signs and exchanges a service-account JWT for a short-lived Drive API
// access token (standard Google OAuth2 "JWT Bearer" flow - RFC 7523). Not
// cached across invocations - this runs in a serverless function with no
// guaranteed warm state between sweeps, and a token exchange is cheap
// (one extra request every ~5 minutes at most).
async function getServiceAccountAccessToken(serviceAccountJson) {
  let key;
  try {
    key = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY is not valid JSON');
  }
  if (!key.client_email || !key.private_key) {
    throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY is missing client_email/private_key');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: key.client_email,
    scope: DRIVE_SCOPE,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const signature = base64url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key.private_key));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google OAuth2 token exchange failed: ${body.error_description || body.error || res.status}`);
  }
  return body.access_token;
}

async function driveFetch(accessToken, path) {
  const res = await fetch(`${DRIVE_API}${path}`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!res.ok) throw new Error(`Drive API request failed (${res.status}): ${path}`);
  return res;
}

async function getStartPageToken(accessToken) {
  const res = await driveFetch(accessToken, '/changes/startPageToken');
  const body = await res.json();
  return body.startPageToken;
}

// Walks the Changes API from `pageToken` to the end, returning every
// candidate file change plus the cursor to persist for next time. Multiple
// changes.list pages are followed within one sweep (bounded by Drive's own
// page size, not by our batch cap - the per-file batch cap below limits how
// much work one sweep actually DOES, not how much cursor-walking it needs).
async function listChangesSince(accessToken, pageToken) {
  let token = pageToken;
  const changes = [];
  for (let guard = 0; guard < 50; guard += 1) { // hard stop - never loop forever on a misbehaving response
    const fields = 'newStartPageToken,nextPageToken,changes(fileId,removed,file(id,name,mimeType,parents,trashed))';
    const res = await driveFetch(accessToken, `/changes?pageToken=${encodeURIComponent(token)}&fields=${encodeURIComponent(fields)}&pageSize=100`);
    const body = await res.json();
    changes.push(...(body.changes || []));
    if (body.newStartPageToken) return { changes, nextPageToken: body.newStartPageToken };
    if (!body.nextPageToken) return { changes, nextPageToken: token }; // shouldn't happen per Drive's API contract, but don't lose the cursor if it does
    token = body.nextPageToken;
  }
  return { changes, nextPageToken: token };
}

async function downloadFile(accessToken, fileId) {
  const res = await driveFetch(accessToken, `/files/${fileId}?alt=media`);
  return new Uint8Array(await res.arrayBuffer());
}

// Cheap sanity check, not a real parse - real validation happens inside
// /api/cam-generate (readStepMeshes), which already has a hardened error
// path for garbage input. This just avoids queuing an obviously-not-a-STEP
// file (e.g. someone drops a PDF in the wrong folder) before that point.
function looksLikeStepFile(bytes) {
  const head = Buffer.from(bytes.slice(0, 256)).toString('utf8', 0, 256);
  return /ISO-10303/i.test(head);
}

function getServiceSupabase() {
  const url = env.SUPABASE_URL || env.PUBLIC_SUPABASE_URL;
  const serviceKey = env.SUPABASE_SERVICE_KEY;
  if (!url || !serviceKey) throw new Error('Missing SUPABASE_URL/SUPABASE_SERVICE_KEY for the Drive watcher');
  return createClient(url, serviceKey);
}

async function notifyFailure(message) {
  // Best-effort only - a Slack outage must never take down the sweep itself.
  try {
    const { postUserApprovalNeeded } = await import('$lib/server/971bot.js');
    // Reuses the same approver-DM channel every other background failure in
    // this app posts to - there's no separate "ops alerts" channel today.
    await postUserApprovalNeeded(`[Drive Watcher] ${message}`);
  } catch (e) {
    console.warn('Drive watcher: Slack failure notification itself failed (non-fatal)', e?.message || e);
  }
}

// Inserts the cam_jobs row for one newly-discovered file, using the
// mapped machine's operation_type/defaults - the exact same mechanism the
// manual "select a Machine Profile" dropdown already uses. Turning lands as
// a draft (status stays 'queued', generation is never triggered) since
// stockDiameter is a real stock-selection decision this can't guess safely -
// see the plan doc. Routing calls the existing /api/cam-generate endpoint,
// unmodified, via a service-role-authenticated internal request - no
// generation logic is duplicated here.
async function queueJobForDriveFile(supabase, machine, file, bytes, appOrigin) {
  const storagePath = `cam-jobs/drive-${file.id}-${file.name}`;
  const { error: uploadError } = await supabase.storage
    .from('manufacturing-files')
    .upload(storagePath, bytes, { contentType: 'application/step', upsert: false });
  if (uploadError) throw new Error(`Storage upload failed: ${uploadError.message}`);

  const { data: job, error: insertError } = await supabase
    .from('cam_jobs')
    .insert({
      name: file.name.replace(STEP_NAME_RE, ''),
      source_type: 'upload',
      operation_type: machine.operation_type,
      step_file_name: storagePath,
      material_id: machine.default_material_id || null,
      tool_id: machine.default_tool_id || null,
      machine_id: machine.id,
      params: machine.default_params || {},
      gcode_file_name: gcodeFileNameFor(file.name.replace(STEP_NAME_RE, ''), machine.gcode_extension),
      gcode_format: 'ngc',
      status: 'queued'
    })
    .select()
    .single();
  if (insertError) throw new Error(`cam_jobs insert failed: ${insertError.message}`);

  if (machine.operation_type === 'routing') {
    const res = await fetch(`${appOrigin}/api/cam-generate`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        // Service-role key as the bearer token, not a user JWT - there is no
        // logged-in user for a background sweep. Supabase evaluates RLS off
        // the JWT's own role claim regardless of which apikey built the
        // client, so this grants the same access cam-generate's service-role
        // RLS policies already allow - see migrations/20260817_cam_studio_system.sql.
        authorization: `Bearer ${env.SUPABASE_SERVICE_KEY}`
      },
      body: JSON.stringify({ jobId: job.id })
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`/api/cam-generate returned ${res.status}: ${body.error || 'unknown error'}`);
    }
  }
  // Turning: intentionally left at status='queued' - a human opens it, sets
  // stock diameter, and clicks "Save & Regenerate" from /autocam.

  return job;
}

/**
 * Runs one sweep across every cam_machines row with a drive_folder_id set.
 * Safe to call with zero configuration (returns a clear skip reason instead
 * of throwing). Never throws for a single bad file/machine - every failure
 * is caught, recorded in drive_watcher_files, and reported via Slack, so one
 * corrupt file can't take down the rest of the sweep.
 */
export async function runDriveWatcherSweep({ appOrigin } = {}) {
  const serviceAccountJson = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) {
    return { ok: true, skipped: true, reason: 'not_configured', detail: 'GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY is not set' };
  }

  const supabase = getServiceSupabase();
  const { data: machines, error: machinesError } = await supabase
    .from('cam_machines')
    .select('*')
    .eq('enabled', true)
    .not('drive_folder_id', 'is', null);
  if (machinesError) throw new Error(`Could not load cam_machines: ${machinesError.message}`);
  if (!machines?.length) {
    return { ok: true, skipped: true, reason: 'no_mapped_folders', detail: 'No enabled machine has a drive_folder_id set' };
  }

  const accessToken = await getServiceAccountAccessToken(serviceAccountJson);
  const resolvedOrigin = appOrigin || env.PUBLIC_APP_ORIGIN || env.APP_ORIGIN || env.SITE_URL;
  if (!resolvedOrigin) throw new Error('No app origin available (PUBLIC_APP_ORIGIN/APP_ORIGIN/SITE_URL) - required to call /api/cam-generate');

  const results = [];
  for (const machine of machines) {
    const folderId = machine.drive_folder_id;
    try {
      const { data: state } = await supabase.from('drive_watcher_state').select('page_token').eq('folder_id', folderId).maybeSingle();
      const startToken = state?.page_token || (await getStartPageToken(accessToken));

      const { changes, nextPageToken } = await listChangesSince(accessToken, startToken);

      const candidates = changes.filter((c) =>
        !c.removed &&
        c.file &&
        !c.file.trashed &&
        STEP_NAME_RE.test(c.file.name || '') &&
        (c.file.parents || []).includes(folderId)
      );

      let queuedCount = 0;
      for (const change of candidates.slice(0, MAX_FILES_PER_SWEEP_PER_MACHINE)) {
        const file = change.file;
        const { data: already } = await supabase.from('drive_watcher_files').select('drive_file_id').eq('drive_file_id', file.id).maybeSingle();
        if (already) continue; // idempotency - never process the same Drive file twice

        try {
          const bytes = await downloadFile(accessToken, file.id);
          if (!looksLikeStepFile(bytes)) throw new Error('Downloaded file does not look like a STEP file (no ISO-10303 header)');
          const job = await queueJobForDriveFile(supabase, machine, file, bytes, resolvedOrigin);
          await supabase.from('drive_watcher_files').insert({ drive_file_id: file.id, cam_job_id: job.id, status: 'queued' });
          queuedCount += 1;
        } catch (fileError) {
          const message = fileError?.message || String(fileError);
          await supabase.from('drive_watcher_files').insert({ drive_file_id: file.id, status: 'failed', error: message });
          await notifyFailure(`"${file.name}" in folder mapped to "${machine.name}" failed to queue: ${message}`);
        }
      }

      await supabase.from('drive_watcher_state').upsert({ folder_id: folderId, page_token: nextPageToken, updated_at: new Date().toISOString() });
      results.push({ machineId: machine.id, machineName: machine.name, folderId, candidates: candidates.length, queued: queuedCount });
    } catch (machineError) {
      const message = machineError?.message || String(machineError);
      console.error(`Drive watcher: sweep failed for machine "${machine.name}"`, message);
      await notifyFailure(`Sweep failed for machine "${machine.name}" (folder ${folderId}): ${message}`);
      results.push({ machineId: machine.id, machineName: machine.name, folderId, error: message });
    }
  }

  return { ok: true, skipped: false, results };
}
