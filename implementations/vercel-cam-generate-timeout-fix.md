# AutoCAM generation timing out on Vercel — implementation plan

## Status: fix applied to `src/lib/cam/stepProfile.js` and verified locally (real end-to-end run through the actual HTTP endpoint, 2.8s). **Not yet verified on the actual Vercel deployment** - that's the one step only a real deploy + test can confirm; see Verification plan below.

## What we know for certain

- The failed `autocam1` job's `created_at` and `updated_at` are **76 seconds apart** - almost exactly matching the client-side 75s poll timeout (`PROGRESS_TIMEOUT_MS` in `src/lib/camJobs.js`). That timeout only fires when the client has been polling the whole time and *never once* saw the job leave `queued`/`processing`.
- The job's `errors` field contains only the client-side fallback message - never a server-written one. If the server-side code's own try/catch had run at all (even to fail), it would have written something more specific (a real Supabase error, a STEP-parsing error, etc. - see the many specific error paths already in `+server.js`).
- Conclusion: the server-side request is not failing fast and not failing with a caught exception - it is genuinely hanging for the server's entire execution budget, then presumably getting killed by the platform with no chance for our own error handling to run.
- This is a *different* failure mode than the "10 sequential DB round trips" theory from earlier tonight (that fix - merging progress checks, raising `maxDuration` to 60s - already shipped and evidently didn't fix it, since this failure happened after that deploy).

## Root cause (high confidence)

`occt-import-js` is an Emscripten-compiled WASM module. Emscripten's generated JS glue code locates its `.wasm` binary via `fs.readFileSync()` relative to `__dirname` **by default**, unless the caller explicitly overrides this with a `locateFile` option.

- **`src/lib/components/CadViewer.svelte`** (browser-side STEP viewing, used today for "View CAD" and already working reliably) explicitly overrides this:
  ```js
  const wasmUrl = (await import('occt-import-js/dist/occt-import-js.wasm?url')).default;
  const occt = await occtimportjs({ locateFile: () => wasmUrl });
  ```
- **`src/lib/cam/stepProfile.js`** (server-side, used by `/api/cam-generate` for actual G-code generation) does **not**:
  ```js
  const occtimportjsFactory = (await import('occt-import-js')).default;
  occtPromise = occtimportjsFactory(); // no locateFile - relies on __dirname guessing
  ```

Locally (`npm run dev`), `__dirname` correctly points into `node_modules/occt-import-js/dist/`, so this has always worked in every test done in this environment. On Vercel, SvelteKit's adapter bundles server code into a different file layout - `__dirname` at runtime almost certainly does not point at the original `node_modules` location anymore, and a dynamically-read 7.6MB binary file referenced only via a runtime `fs.readFileSync(__dirname + ...)` call is exactly the kind of asset a bundler's static dependency analysis can miss and fail to include in the deployed function bundle.

**Why this hangs instead of failing fast** (the detail that fits the 76-second evidence): Emscripten's generated loaders typically have environment-detection logic that tries multiple strategies depending on what globals it detects (Node vs. browser vs. worker). If the expected `readFileSync` path doesn't behave as expected in Vercel's serverless Node runtime, it's plausible the loader falls into a fetch/XHR-based fallback path meant for browser environments - which would have nothing valid to fetch from a serverless function context, and could hang rather than reject cleanly. This is a known category of gotcha for WASM npm packages under serverless bundlers (Vercel, Netlify, Lambda) generally, not specific to this package.

## The fix

Give `stepProfile.js`'s server-side loader an explicit, bundler-proof way to find its WASM binary - the same idea as `CadViewer.svelte`'s fix, adapted for a Node/serverless context instead of a browser:

1. Resolve the real absolute filesystem path to `occt-import-js/dist/occt-import-js.wasm` using Node's own module resolution (`import.meta.resolve()` or an equivalent `fileURLToPath` + relative-to-package-root computation) - not a guessed relative path, so it can't be thrown off by how the bundler rearranges files.
2. Read the file into a buffer ourselves with `fs.readFileSync` at that resolved path, and pass it via Emscripten's `wasmBinary` option instead of `locateFile` - this skips the loader's own file-finding logic entirely (no path-guessing left for Emscripten to get wrong), which is more robust than just supplying a better path via `locateFile`.
3. Fallback: if `wasmBinary` isn't supported by this build of the module, fall back to `locateFile` returning the same resolved absolute path.

Rough shape:
```js
import { createRequire } from 'node:module';
import fs from 'node:fs';

const require = createRequire(import.meta.url);
const wasmPath = require.resolve('occt-import-js/dist/occt-import-js.wasm');

async function getOcct() {
  if (!occtPromise) {
    const occtimportjsFactory = (await import('occt-import-js')).default;
    const wasmBinary = fs.readFileSync(wasmPath);
    occtPromise = occtimportjsFactory({ wasmBinary });
  }
  return occtPromise;
}
```
(`require.resolve` works for resolving a package-relative asset path regardless of ESM/CJS context, via `createRequire` - more portable across bundlers than `import.meta.resolve`, which is newer and has had inconsistent support across Node/bundler versions.)

## Verification plan

1. ✅ Apply the fix locally, confirm `scripts/test-cam-extraction.mjs` still passes for both real STEP files (regression check - must not break the working local case).
2. ✅ Run the same real end-to-end test used throughout tonight (real STEP upload, real job row, real HTTP call to `/api/cam-generate`) against the **local** dev server - passed, 2.8s.
3. ⬜ **Still needed**: push, let Vercel deploy, then actually create a job through the deployed AutoCAM page (or an equivalent direct call to the deployed `/api/cam-generate` URL) - this is the step that was skipped for tonight's earlier fixes and is the only way to actually confirm the Vercel-specific bug is fixed, rather than assuming it from local success again.
4. If step 3 still fails: pull the actual Vercel function logs for that request (Project → Deployments → the deployment → Functions → `/api/cam-generate` → Logs) - at that point a guess-and-patch approach has been tried three times without direct evidence, and the log output becomes the only reliable way to keep narrowing it down instead of continuing to guess.

## Separately (already known, not this bug, but still blocking multi-tool routing)

The migration still hasn't been re-run since `tool_number` (`cam_tools`) and `gcode_extension` (`cam_machines`) were added - confirmed still missing via direct query tonight. Doesn't explain *this* job's failure (a turning job with no linked tool/machine), but will start producing "column does not exist" failures the moment anyone uses a linked tool/machine or the multi-tool routing feature. Needs the same `migrations/20260817_cam_studio_system.sql` re-run as before - still safe to re-run regardless of current state.
