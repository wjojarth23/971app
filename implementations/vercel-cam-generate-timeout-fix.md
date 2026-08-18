# AutoCAM generation timing out on Vercel — implementation plan

## Status: real root cause found and fixed, backed by direct evidence (not another guess)

## The actual bug

`src/lib/camJobs.js`'s `triggerGenerationAndRefetch()` calls `/api/cam-generate` with **no `Authorization` header**:
```js
fetch('/api/cam-generate', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ jobId })
})
```
`src/routes/api/cam-generate/+server.js`'s `getClientFromRequest()` builds its Supabase client from whatever `Authorization` header the incoming request carries, with no fallback:
```js
function getClientFromRequest(request) {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
}
```
With no header sent, `auth` is `''` - an explicitly blanked-out Authorization header, not merely a missing one. Every `cam_jobs` RLS policy is scoped `TO authenticated` (see `migrations/20260817_cam_studio_system.sql`) - a request with no valid user identity doesn't satisfy that, so the job-lookup query returns **zero rows**, and the endpoint responds with its normal "job not found" path: `404`, `{"success":false,"error":"JSON object requested, multiple (or no) rows returned"}`.

**Why this produced the exact symptom seen all night** (stuck on "Generating CAM," failing only after the full timeout, generic message): `triggerGenerationAndRefetch` fires that fetch and never checks its response status or body - it only cares whether the *database row* changes state, polling separately. A clean 404 isn't a thrown exception, so the function's `fetchError` never gets set; it just keeps polling a job that can never leave `queued` (the 404 branch returns before ever writing `processing`), until the client's own timeout gives up and writes the generic fallback message. Every fix earlier tonight (DNS resolution, reducing DB round trips, `maxDuration`, the WASM binary loading fix) was real and worth keeping, but none of them could have fixed this - the request was being rejected before any of that code ever ran.

### How this was actually confirmed (not inferred)

Had the user paste a raw `fetch()` call to `/api/cam-generate` directly into their browser console on the deployed site, using a job I created via the service-role key ahead of time. Result:
```
STATUS: 404 | TIME: 1819 ms
BODY: {"success":false,"error":"JSON object requested, multiple (or no) rows returned"}
```
That's the RLS-denial message, returned fast (1.8s, not a hang) - directly confirming the theory instead of extending it.

### Why local testing never caught this

Every local/E2E verification this session used a direct `fetch()` to the endpoint with the Supabase **service-role key** explicitly set as the `Authorization: Bearer` header - which bypasses RLS entirely via the `cam_jobs_service_all` policy (`TO service_role USING (true)`). That path was never broken, so it never revealed this bug. The real user-facing flow (browser → `camJobs.js` → no auth header) was never actually exercised by any of tonight's "successful" tests until this specific console check.

## The fix

`triggerGenerationAndRefetch` now fetches the current session's access token before firing the request, and attaches it as a real `Authorization: Bearer <token>` header:
```js
const { data: sessionData } = await supabase.auth.getSession();
const accessToken = sessionData?.session?.access_token;

fetch('/api/cam-generate', {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    ...(accessToken ? { authorization: `Bearer ${accessToken}` } : {})
  },
  body: JSON.stringify({ jobId })
})
```
This is the only place in the codebase that calls `/api/cam-generate` (confirmed via a full-repo grep), so this single fix covers every job-creation path (New Job, Retry, Save & Regenerate).

## Verification plan

1. ✅ Confirmed the failure mode directly via a real browser console request against the live Vercel deployment (see above).
2. ✅ Applied the fix, confirmed it compiles and the app still loads locally.
3. ⬜ **Still needed**: once deployed, create a job through the real `/autocam` UI on Vercel (not a console/service-key test) and confirm it actually completes. This is the one path that's never successfully been tested end-to-end tonight.
4. If it still fails: get the same browser-console `fetch()` output again post-deploy - if the 404/RLS error is gone but something else appears, that's real new evidence to work from, same as this round.

## Separately (already known, unrelated to this bug, but still blocking multi-tool routing)

The migration still hasn't been re-run since `tool_number` (`cam_tools`) and `gcode_extension` (`cam_machines`) were added - confirmed still missing via direct query. Will start producing "column does not exist" failures the moment anyone uses a linked tool/machine or the multi-tool routing feature. Needs the same `migrations/20260817_cam_studio_system.sql` re-run as before - still safe to re-run regardless of current state.

## Update: the auth fix surfaced the next real bug, also now fixed

Once the Authorization header fix above went out, the request finally got far enough on Vercel to hit the exact WASM-loading problem predicted earlier in this doc - confirmed directly this time, not inferred:
```
Cannot find module 'occt-import-js/dist/occt-import-js.wasm'
Require stack: - /var/task/.svelte-kit/output/server/entries/endpoints/api/cam-generate/_server.js
```
The `require.resolve()`-based fix tried first (see git history) still failed in production: Vercel's build-time file tracer (`@vercel/nft`) doesn't detect a WASM binary only referenced via a *runtime* `require.resolve()` call as a dependency, so it never gets included in the deployed function's bundle at all - `require.resolve` then fails at runtime because the file genuinely isn't there. That fallback still works fine locally (plain Node, or `vite dev`, where nothing is traced/bundled the same way), so it stays as the default for `scripts/test-cam-extraction.mjs` and local dev.

**Real fix**: `src/routes/api/cam-generate/+server.js` now imports the WASM binary the same way `CadViewer.svelte` already does successfully client-side - `import occtWasmUrl from 'occt-import-js/dist/occt-import-js.wasm?url'`, a real Vite-built static asset with a real URL, not a traced filesystem dependency - then fetches it over HTTP at request time (`fetch(new URL(occtWasmUrl, url.origin))`, cached in memory after the first successful fetch per warm function instance) and passes the resulting bytes into `stepProfile.js`'s `readStepMeshes(stepBuffer, wasmBinary)` as an explicit override. `stepProfile.js` uses the override when given one, and only falls back to the filesystem-based approach when called without one (i.e. from the CLI script or anywhere else that doesn't have a request `url` to resolve against).

Verified locally: a real end-to-end run (real STEP upload, real job row, real HTTP call to the actual endpoint) through this new fetch-based path completed in ~2s, and both `scripts/test-cam-extraction.mjs` cases (which exercise the fallback path) still pass unchanged.

**Still needed**: confirm on the actual Vercel deployment - this is now the third fix in this chain (auth header, then this), and the only way to know it's actually resolved is a real job completing through the live `/autocam` UI.

## Also still open (unrelated, from earlier tonight)

Whether the lathe's turning generator needs to support flip-turning / multi-setup programs for long parts (see conversation - waiting on whether the Haas TL-1 has a tailstock, or genuinely needs a re-chuck-and-re-zero pause). Not started - needs that answer first.
