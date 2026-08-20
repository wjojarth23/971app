# Setting up Valor 6800's AutoCAM Fusion 360 Runner

This is a step-by-step setup guide for installing and configuring **Team Valor 6800's open-source AutoCAM Runner** - a Fusion 360 add-in that automates CAM setup and G-code generation. It's a genuinely separate, third-party system from Spartans Hub's own built-in AutoCAM - see **"How this relates to Spartans Hub's own AutoCAM"** near the end before assuming this replaces anything that already works today.

Researched directly from the real source (both repos cloned and read, not just the README):
- **WebUI**: [github.com/AutoCAM-FRC/Website](https://github.com/AutoCAM-FRC/Website) - Next.js + Postgres job-queue dashboard. Hosted publicly at [cam.valor6800.com](https://cam.valor6800.com).
- **Runner**: [github.com/AutoCAM-FRC/Runner](https://github.com/AutoCAM-FRC/Runner) - the Fusion 360 add-in this guide installs.
- Announced by Team Valor 6800 on Chief Delphi, 2026-07-12: ["Presenting AutoCAM, an automated CAMing platform"](https://www.chiefdelphi.com/t/presenting-autocam-an-automated-caming-platform/522488). Both repos are MIT licensed and explicitly described as early/in-progress ("expect some rough edges").

## What it actually does

```
Browser (AutoCAM WebUI)  →  queue a CAM job (a plate or box-tube part)
        ↓
Runner (Fusion 360 add-in)  →  polls the job queue on a background thread
        ↓
Fusion 360's real CAM engine  →  applies a pre-built CAM template, generates toolpaths
        ↓
G-code + screenshots  →  uploaded back to the WebUI, job marked complete
```

**Important nuance not obvious from the README**: the Runner does not intelligently decide *how* to machine a part from scratch. It loads a `.f3dhsm-template` file (a Fusion CAM template - a saved set of toolpath operations, feeds/speeds, and tool assignments, built once by a human inside Fusion's own CAM workspace UI) and re-applies it to the new part's geometry/stock. The templates in their repo are named per machine+material combination (e.g. `AluminumSwift.f3dhsm-template`, `PolycarbIQ.f3dhsm-template`) - **those specific templates are built around Valor 6800's own machines ("Swift", "IQ") and won't apply to Spartan Robotics' equipment as-is.** Getting real toolpaths out of this for our own machines means someone with real Fusion 360 CAM experience builds and exports our own template file(s) first - see Step 6. The Runner automates the *plumbing* (polling, applying a template, exporting G-code, reporting status) - not the CAM strategy itself.

Current scope, confirmed from the workflow files (`camPlate.py`, `camTube.py`, `importPlate.py`): **flat plate and box-tube stock**, with 2D nesting and auto-orientation. This is the same class of problem Spartans Hub's own `autocam/routing.js` already solves without Fusion at all - not, on its own, a general 3-axis contoured-surface milling solution (see the relations section below).

## Prerequisites

- **Autodesk Fusion 360** installed (macOS or Windows - the add-in manifest declares `"supportedOS": "windows|mac"`).
- Fusion 360's own bundled Python runtime (the `adsk` API modules only exist inside Fusion - you cannot test this add-in with a normal standalone Python install).
- Network access from the machine running Fusion 360 to wherever the AutoCAM WebUI is deployed.
- An AutoCAM **runner API key** (see Step 2).
- `git` (or just downloading a ZIP from GitHub) to get the Runner's code onto the machine.

## Step 1 — Decide: hosted WebUI or self-host

Two options for the job-queue dashboard the Runner talks to:

- **Use the hosted app** at [cam.valor6800.com](https://cam.valor6800.com) - fastest to get started, but it's Valor 6800's own infrastructure, not ours. Confirm with them (or check their repo's current terms) whether other teams using the hosted instance is actually supported/intended before relying on it for real production use.
- **Self-host the WebUI** - clone [github.com/AutoCAM-FRC/Website](https://github.com/AutoCAM-FRC/Website), which the README describes as "Multi-tenant CAM workflow platform... parts, plates, tooling, and automated CAM job queues," built on Next.js + Postgres. This means standing up and maintaining a **second, separate web app and database** alongside Spartans Hub (a different stack - Next.js/Postgres vs. this project's SvelteKit/Supabase) - real ongoing infrastructure to own, not a one-time setup cost. Follow that repo's own README/getting-started docs for deployment; this guide only covers the Runner side.

**Recommendation**: start with the hosted app to evaluate whether this is worth adopting at all before committing to self-hosting a second full web application.

## Step 2 — Create a team and generate a runner API key

1. Sign into the WebUI (hosted or self-hosted).
2. Create a team (the WebUI is explicitly multi-tenant/multi-team).
3. Generate a **runner API key** scoped for `jobs` access - this is what the Fusion add-in authenticates with. Treat this like any other credential: don't commit it to any git repo, don't paste it into a shared doc or Slack channel.

## Step 3 — Get the Runner add-in onto the machine running Fusion 360

```bash
git clone https://github.com/AutoCAM-FRC/Runner.git
```

Fusion 360 loads add-ins from a specific per-OS folder. Copy (or clone directly into) the Runner folder there:

```text
macOS:   ~/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/
Windows: %APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\
```

The add-in's internal folder/entry-point name is literally `test` (from `test.py`/`test.manifest` in the repo) - that's what will show up in Fusion's Add-Ins list, not "AutoCAM Runner." Don't be thrown by that; it's the repo's actual current state, not a mistake in this guide.

## Step 4 — Install the `requests` Python package (undocumented gotcha)

**This step is not mentioned in the Runner's own README, but the code will not run without it.** Fusion 360's bundled Python does not include third-party packages like `requests`, which this add-in needs for all its HTTP calls to the WebUI. `config.py` reads a file called `.overridepath` on startup and appends its contents to `sys.path`:

```python
with open(os.path.join(os.path.dirname(__file__), ".overridepath")) as f:
    OVERRIDE_PATH = f.read().strip()
```

`.overridepath` is git-ignored in their repo (never checked in) and **does not exist until you create it yourself** - without it, the add-in fails to even import (`FileNotFoundError` on load, before it gets anywhere near polling for jobs).

To fix this:

1. Install `requests` (and any other third-party dependencies the code imports - check for more with `grep -rn "^import \|^from " workflows/ commands/ lib/` if new ones show up in a future version) into a **separate folder**, not your system Python:
   ```bash
   pip install --target=/path/to/some/folder requests
   ```
2. Create the `.overridepath` file inside the Runner add-in's own folder, containing just that folder's path:
   ```bash
   echo "/path/to/some/folder" > .overridepath
   ```
3. Restart Fusion 360 (or reload the add-in) after this.

This is inferred directly from reading `config.py`'s actual behavior, not confirmed by the Runner's maintainers - if a future version of the repo documents this differently (or ships a bundled `requests`), follow that instead.

## Step 5 — Configure the API key and WebUI URL

Inside the Runner add-in's folder:

```bash
cp .env.example .env
```

Edit `.env`:

```env
API_KEY="the runner API key from Step 2"
BASE_URL="https://cam.valor6800.com"   # or your self-hosted URL, or http://localhost:3000 for local dev
```

(The add-in can also prompt for the key on first launch and write it to `.env` itself, per the README - either path works.)

## Step 6 — Enable the add-in in Fusion 360

1. Open Fusion 360 → **Utilities** tab → **Scripts and Add-Ins**.
2. Under **Add-Ins**, find **test** (see Step 3's note on naming).
3. Click **Run**. Check **Run on Startup** if you want it always active.
4. Watch Fusion's Text Command window for log output confirming it started polling (`DEBUG = True` in `config.py` by default, so this should be verbose).

## Step 7 — Build real CAM templates for Spartan Robotics' machines (the actual hard part)

The templates shipped in the Runner repo (`templates/AluminumSwift.f3dhsm-template`, etc.) are built around **Valor 6800's own named machines and material presets** - they will not produce correct toolpaths for our router(s) or lathe without someone rebuilding equivalent templates for our actual equipment. This requires real hands-on Fusion 360 CAM expertise (setting up stock, WCS orientation, tool library, feeds/speeds, and the actual toolpath operations - contour, pocket, adaptive clearing, whatever the part needs) done once inside Fusion's CAM workspace UI, then exported as a `.f3dhsm-template` file the way `SetupGenerator.py` expects (see the machine/material `if`/`elif` chain in `workflows/camPlate.py` for exactly how template selection is wired - it currently checks for `machine == "Swift"` / `"IQ"` and `material == "AL 6061"` / `"Polycarb"`, all hardcoded to Valor 6800's own naming, which would need updating for ours).

**Do not expect real, usable G-code out of this system until this step is done by someone qualified to do it** - installing the add-in alone does not give you working CAM for our parts.

## Step 8 — Test end to end

1. In the WebUI, queue a test CAM job (a simple flat plate) against a machine/material combination that has a real template.
2. Confirm the Runner picks it up (log output, or the job's status changing in the WebUI).
3. Confirm Fusion actually opens the part, applies the template, and generates toolpaths without errors.
4. Download the resulting G-code and **run it through a simulator (ncviewer.com, CAMotics) before ever cutting real material with it** - same standing practice this team already follows for Spartans Hub's own AutoCAM output.

## How this relates to Spartans Hub's own AutoCAM

Spartans Hub already has a working, from-scratch AutoCAM system (`autocam/turning.js`, `autocam/routing.js`, `autocam/stepProfile.js`) that generates lathe and router G-code **synchronously, server-side, with pure geometry math - no Fusion 360, no external Runner, no per-machine CAM template to build and maintain.** It was deliberately built this way specifically so the logic could be reasoned about, tested, and verified directly (see `autocam/routing.js`'s and `autocam/turning.js`'s own header comments) - see `autocam/docs/router-lathe-validation-2026-08-20.md` for a recent real-parts validation pass against it.

Valor 6800's Runner is genuinely useful for a **different, currently-unfilled gap**: real 3-axis **milling** (contoured 3D surfaces, not flat 2.5D profiles), which `autocam/docs/millimplementations.md` already documents as unbuilt and names "a local Fusion 360 add-in" (its "Option C") as the most capable path for exactly that case. `cam_jobs`/`cam_machines` in this app's own schema already anticipate this (`operation_type = 'milling'` is a valid value today; `claimed_by`/`claimed_at` on `cam_jobs` and `post_processor` on `cam_machines` exist specifically for "a future external Runner" per the schema's own comments) - `src/routes/api/cam-generate/+server.js` currently just rejects any milling job immediately rather than leaving it stuck queued forever.

**Two real integration paths, not decided here:**

1. **Use the Runner + WebUI as a fully separate system**, exactly as this guide sets it up - the simplest to get running, but means maintaining a second web app/database and a second place parts/jobs live, disconnected from this app's own `cam_jobs` table and part-tracking UI.
2. **Fork the Runner and point its networking layer at this app's own backend** instead of the AutoCAM WebUI - reuse the genuinely valuable, hard-to-build part (the Fusion Python automation: template application, toolpath generation, G-code export, status reporting) while keeping one single source of truth for jobs (this app's existing `cam_jobs`/`cam_machines` schema, `claimed_by`/`claimed_at` job-claim lifecycle already designed for this). This needs a new small polling endpoint on this app (something like `GET /api/cam-jobs/claim?operation_type=milling`, `POST /api/cam-jobs/:id/complete`) for the forked Runner to call instead of the WebUI's own API, and rewriting the Runner's `workflows/job_status.py` (and wherever else it calls the WebUI) to match. More upfront work, but avoids running two disconnected systems long-term.

Given plate/tube CAM (the Runner's actual current scope) is already covered by `autocam/routing.js` without any of this, **the strongest case for adopting the Runner at all is specifically for milling** - worth deciding path 1 vs. 2 above with that framing before starting Step 7's real CAM-template work, since building templates twice (once for a throwaway evaluation, once for real) is wasted effort.
