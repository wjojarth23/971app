# AutoCAM Runner - milling only (not implemented)

Turning and routing no longer need this — both generate G-code synchronously,
server-side, from pure geometry math (`src/lib/cam/turning.js`,
`src/lib/cam/routing.js`) driven off geometry extracted directly from the
part's STEP file (`src/lib/cam/stepProfile.js`, via `occt-import-js`) in
`src/routes/api/cam-generate/+server.js`. There is no external process to
poll or claim jobs for those two operations anymore, and no separate 2D
drawing to upload - just the STEP file the part already has.

This file now only describes what a **milling** Runner would need to do,
since real 3D milling toolpath generation is a different scale of problem
than 2D turning/routing — see `millimplementations.md` at the repo root for
the fuller writeup and options. In short: Option C there (a local Fusion 360
add-in polling `cam_jobs` where `operation_type = 'milling'`) is the most
capable path, and it would follow the same job lifecycle already defined in
the schema (`queued -> claimed -> processing -> completed/failed`, using
`claimed_by`/`claimed_at` on `cam_jobs`) — claim a queued milling job, run
real CAM in Fusion against the part's STEP file (`cam_jobs.step_file_name`),
write back `gcode` (still must be NGC format) and `status`.

Not built. `src/routes/api/cam-generate/+server.js` currently rejects any
job with `operation_type = 'milling'` immediately (`status = 'rejected'`)
rather than leaving it queued forever with nothing to pick it up.
