# AutoCAM router tool-change G-code (.tap files) — implementation plan (not built)

**Scope: router only.** Turning/lathe jobs stay single-tool as they are today - this plan does not touch `turning.js`.

## Why this doesn't exist today

`src/lib/cam/routing.js` assumes exactly one bit for the entire program - it doesn't emit a tool word at all, and assumes a single bit is already loaded before the program runs.

`cam_tools` / the Tool dropdown on a job today is *tool selection* (what diameter to assume for offset math), not a mechanism to switch tools mid-program. Real router jobs frequently need more than one bit in a single run - a large bit to clear bulk material fast, then a smaller bit for tight-radius edges/corners the large bit can't reach - and right now that's not possible without manually splitting a part into two separate AutoCAM jobs and running them back-to-back by hand.

## What "tool swapping" needs to actually do

Support an ordered list of tool operations within one routing program - e.g. rough-clear with a 1/4" bit, then finish tight corners with a 1/8" bit. Between steps, the program must: retract to a safe height, stop the spindle, emit a tool-change block, and give the operator a clear, unambiguous instruction about which physical bit to load next.

## The `.tap` extension

`.tap` is the file extension Mach3/Mach4 controllers conventionally expect (functionally identical G-code content to `.ngc` - same text format, different file extension convention). The rest of this app currently hard-requires `gcode_format = 'ngc'` everywhere (`CAM_GCODE_FORMAT` in `src/lib/camJobs.js`, documented as a hard rule in `autocam-runner/README.md`).

Plan: make the output extension a **router machine-profile setting** (`cam_machines.gcode_extension`, defaulting to `'ngc'`), rather than a global rename - so this only changes behavior for router profiles that explicitly opt into `.tap`, and nothing else in the app (lathe jobs, existing router jobs already in the queue) is affected.

## Data model changes

- `cam_tools`: add `tool_number integer` - the fixed slot/number a bit physically corresponds to (whatever the router's tool table or the operator's own labeling uses), so generated tool-change blocks reference a consistent, real number.
- `cam_jobs.params`: add an explicit ordered list, e.g. `params.toolSequence = [{ toolId, role: 'rough'|'finish', targetDepth, stepDown, feedRate, plungeRate, spindleSpeed, ... }, ...]`. `tool_id` on the job row stays as-is (first/primary tool, for filtering and backward compatibility); generation reads `params.toolSequence` when present and falls back to today's single-tool behavior otherwise, so existing jobs keep working unmodified.
- `cam_machines.default_params`: gains an optional default `toolSequence` template so a router profile can pre-fill "this router always roughs with the 1/4" bit, finishes with the 1/8"."
- `cam_machines`: add `gcode_extension text default 'ngc'`.
- Migration: extend `migrations/20260817_cam_studio_system.sql` in place (same safe-to-rerun pattern already established there) rather than a new file, since it's the same table set.

## G-code generation changes (LinuxCNC / Mach dialect)

This is the part that needs a real answer before it gets built (see below): **routers almost never have a tool-length setter**, which means a tool change usually also needs a new Z-zero - swapping bits changes the effective tool length, and if the program just keeps cutting at the old Z offset it will plunge to the wrong depth (too deep into the spoilboard, or not deep enough to actually cut through). Planned block between tool steps, assuming no automatic length compensation:

```
G00 Z<safe height>
M05                       (spindle off)
M00 (TOOL CHANGE: load 1/8" finishing bit, then RE-TOUCH OFF Z0 before resuming)
M03 S<spindleSpeed>       (spindle back on after operator resumes)
```

`M00` is a genuine program pause requiring the operator to press cycle-start to continue (unlike `M01`, which is skippable and easy to blow through by habit) - deliberate, since skipping the re-touch-off is the actual hazard here. The generated file's header comment block should also list every tool the program needs, in order, so the operator can stage bits before starting the run at all.

**If the router does have a tool setter / can do automatic per-tool Z compensation**, this gets simpler and safer: a `G43`-style length offset per tool number, no manual pause needed, no re-touch-off risk. This one fact changes the actual G-code emitted, so it needs a real answer before writing generation code - not guessed.

## Generator architecture changes

`routing.js` currently produces one continuous program in a single pass. Restructure into:
1. A per-tool-step generator function (reuses the existing contour-offset + step-down + tab logic, parameterized by tool diameter/depth/feeds for that step).
2. A top-level assembler that stitches steps together with the tool-change block between each, emitting the header/footer once.

Real rewrite of the file's internals, not a small patch - budget it as such.

## UI changes

- New Job / Edit Job modals (routing only): replace the single Tool dropdown with a **tool sequence builder** - add/remove/reorder steps, each picking a tool + role + that step's params. `CamParamFields.svelte` needs either a repeating-group mode or a sibling component for this.
- Router Machine Profile editor: same tool-sequence builder, saved as the profile's default sequence.
- `ToolpathViewer.svelte`: color-code segments by which tool/step produced them (currently only distinguishes rapid vs. feed), so a multi-tool preview stays legible instead of looking like one undifferentiated path.
- Job list / Edit Job header: show the tool sequence at a glance (e.g. "1/4in rough → 1/8in finish") instead of a single tool name.

## Safety / verification (non-negotiable)

- Every generated tool-change program gets a header block listing each tool needed, in order, so the operator can stage bits before pressing start.
- The existing "run this through a simulator, do a supervised air-cut" warning gets stronger, specific wording for tool-change programs: the air-cut must actually exercise every tool change (not stop after the first tool "because it looked fine"), since the tool-change block itself is the new, unverified part.
- Do not implement the re-touch-off block from a guess - the open question below needs a real answer from whoever runs the router, before writing the G-code emission code. Getting it wrong produces a program that looks plausible and either crashes or cuts to the wrong depth.

## Phased implementation order

1. **Data model**: `tool_number` on `cam_tools`, `gcode_extension` on `cam_machines`, `toolSequence` shape in `params` - migration + no behavior change yet (existing single-tool jobs keep working).
2. **Routing generator rewrite**: per-tool-step assembler, rough+finish as the first concrete case, using a real (not guessed) tool-change block based on the answer below.
3. **`.tap` extension plumbing**: router machine-profile setting → `gcode_file_name` extension → download filename, defaulting to `.ngc` unless explicitly turned on.
4. **UI**: tool sequence builder in New Job / Edit Job / router Machine Profile; toolpath viewer color-coding by tool.
5. **Testing**: extend `scripts/test-cam-extraction.mjs` to exercise a multi-tool sequence; a real end-to-end run (same method used earlier in this project - real STEP upload, real job, real HTTP call) against a multi-tool routing job; manual review of the actual tool-change block against the real answer to the open question below.

## Before starting: the one answer that's actually needed

**Does the router have a tool setter / touch-off probe that can set a per-tool Z length offset automatically, or does every tool change require the operator to manually re-touch-off Z0?** This single fact determines which of the two G-code blocks above is correct - everything else in this plan can proceed either way.
