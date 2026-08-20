<claude-mem-context>
# Memory Context

# claude-mem status

This project has no memory yet. The current session will seed it; subsequent sessions will receive auto-injected context for relevant past work.

Memory injection starts on your second session in a project.

`/learn-codebase` is available if the user wants to front-load the entire repo into memory in a single pass (~5 minutes on a typical repo, optional). Otherwise memory builds passively as work happens.

Live activity: http://localhost:37701
How it works: `/how-it-works`

This message disappears once the first observation lands.
</claude-mem-context>

# Project instructions

**Keep `docs/guides/ARCHITECTURE.md` up to date.** It's a living whole-project
overview (stack, module map, data layer, deployment, contribution workflow).
Whenever a change adds a new top-level route, a new major `src/lib` module, a
new external integration, or changes how the app is deployed, update that
file as part of the same change - not as a separate follow-up. See its own
header for the same instruction and for how it relates to feature-specific
docs in `implementations/`.

**Contribution workflow**: `spartanshub` (`frc971/spartanshub`) is the
primary remote - feature work branches off `main`, gets pushed to
`spartanshub`, and goes through a PR there before merging; `origin` and
`stormcoded` are synced afterward. See `docs/guides/ARCHITECTURE.md`'s
"Contribution workflow" section for the full rule set (including: never add
a Claude/AI co-author trailer on commits in this repo).