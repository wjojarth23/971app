# Connecting your Fusion 360 to Spartans Hub's Fusion CAM

Practical, step-by-step walkthrough for setting up the Fusion CAM Runner on your own machine. Written from actually doing this, including the real gotchas that aren't obvious from the code or the main README.

## What you're setting up

A Fusion 360 add-in that polls Spartans Hub (`/autocam/fusion`) for queued milling jobs, claims them, and (once real CAM templates exist for your machine — see `cam-engineering-plan.md` if that's not done yet) runs the actual toolpath generation. You can set this up and confirm the connection works even before real templates exist — see "What to expect" at the end.

## 1. Copy the add-in in — and rename the folder

```bash
cp -R autocam/fusion/runner "$HOME/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/SpartanRoboticsAutoCAM"
```

**The destination folder must be named `SpartanRoboticsAutoCAM`, not `runner`.** Fusion requires the AddIns folder name, the main `.py` file name, and the `.manifest` file name to all match exactly — the files inside are `SpartanRoboticsAutoCAM.py`/`SpartanRoboticsAutoCAM.manifest`, so the folder has to match too, or Fusion won't even list it as an add-in. This is the single most common thing to get stuck on. (No spaces in the name, even though the add-in itself is "Spartan Robotics AutoCAM" — Fusion loads this folder as a Python package, and package names can't contain spaces.)

(Windows path: `%APPDATA%\Autodesk\Autodesk Fusion 360\API\AddIns\SpartanRoboticsAutoCAM`)

## 2. Install `requests` for Fusion's bundled Python

Fusion's own Python has no third-party packages:

```bash
pip install --target=~/fusion-runner-deps requests
echo ~/fusion-runner-deps > "$HOME/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/SpartanRoboticsAutoCAM/.overridepath"
```

**Known risk, not yet root-caused:** this installs packages built for whatever Python your system's `pip` defaults to, which may not exactly match Fusion's bundled interpreter's ABI. If the add-in fails to load with an error mentioning `charset_normalizer`, that's the likely cause — ask for help rather than assuming your setup is broken.

## 3. Configure it

```bash
cd "$HOME/Library/Application Support/Autodesk/Autodesk Fusion 360/API/AddIns/SpartanRoboticsAutoCAM"
cp .env.example .env
```

Edit `.env`:
```
API_KEY="ask whoever manages the deployment for the current value"
BASE_URL="https://spartanshub.spartanrobotics.org"
RUNNER_ID="something identifying your machine, e.g. your-name-laptop"
RUNNER_MACHINE_ID=""
```

Leave `RUNNER_MACHINE_ID` blank unless you're connecting this to real shop hardware that already has a machine profile in Spartans Hub (Manage Profiles on the main `/autocam` page) — blank is correct and expected for testing.

## 4. Enable it in Fusion

1. Open Fusion 360, make sure you're in the **Design** workspace (workspace switcher, top-left).
2. **Utilities** tab → **Add-Ins** → **Scripts and Add-Ins**. (Fusion renamed "Tools" to "Utilities" in a 2022 update — if you're following an old tutorial that says "Tools tab," this is the same place.)
3. **Add-Ins** tab inside that dialog (not "My Scripts") → find **SpartanRoboticsAutoCAM** → select it → **Run**.
4. It'll be listed as **SpartanRoboticsAutoCAM** (one word, no spaces) — matches the internal file names from step 1.

## 5. Confirm it's actually running

Open the **Text Command** window — **Option+Cmd+C** on Mac, or View menu → Show/Hide Text Commands. With logging on by default, you should see it polling every few seconds.

## 6. Prove the connection works

- In the browser: `spartanshub.spartanrobotics.org/autocam/fusion` → **Plates** tab → **Add Plate** (needs a material/thickness category first — add one via **Manage Profiles** on the main `/autocam` page if none exist).
- Click **Queue CAM Job**.
- Watch the Text Command window — it should claim the job within about 10 seconds.

## What to expect

| Stage | Should work today |
| --- | --- |
| Add-in shows up and runs | Yes |
| Text Command shows polling activity | Yes |
| Queued job gets claimed | Yes |
| Part geometry actually imports into Fusion | Yes |
| Real, correct toolpaths / G-code | **Not yet** — needs real per-machine CAM templates, see `cam-engineering-plan.md` |

If something fails before the "claimed" stage, that's a real setup problem worth debugging. If it gets that far and then fails or produces garbage during the actual CAM step, that's expected until real templates exist for your machine — not your setup being broken.

## Running on more than one machine at once

Safe to do — the claim step is a compare-and-swap, so two Runners can never grab the same job. Just give each machine its own `RUNNER_ID`. If more than one machine will be polling *and* has real hardware behind it, each should also get its own `RUNNER_MACHINE_ID` (matching its `cam_machines` row) so jobs route to the right physical machine instead of whichever one happens to poll first.
