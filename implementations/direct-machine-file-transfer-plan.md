# Direct machine file transfer (skip the download step) — implementation plan (not built)

## Scope and honesty up front

This is real/lift, hardware- and network-dependent work that cannot be built or tested from this environment - no access to either machine's network, filesystem, or physical location. Everything below is grounded in what could actually be confirmed (the two controllers' own documentation, read this session - see `src/lib/cam/turning.js` and `routing.js` file headers for the sourcing) plus explicit open questions that need real answers from whoever has hands on the machines, not guesses.

**The two real machines, and how each one currently gets a file today:**
- **Lathe: Haas TL-1** (Fanuc-dialect control) - operator currently downloads the `.ngc` from `/autocam`'s "Install NGC" button and walks it over on a USB drive (implied by "Install NGC" being a browser download - no evidence of any other transfer path in this app).
- **Router "New Router": ShopSabre Pro 408, WinCNC control** - confirmed via WinCNC's own manual (`HD WinCNC Manual`, read directly this session): the control is a PC running WinCNC software, and per the manual's own words, "Files are transferred from a Cam system via a USB memory stick." That's not a limitation of this app - it's the documented, default WinCNC workflow.
- **Router "UNC Router": LinuxCNC control** - no specific documentation read this session; LinuxCNC's own file model is "open a file on the machine's own filesystem," so whatever gets it there (USB, network share, direct copy) is a deployment detail of that specific machine, not something discoverable from this repo.

## What "direct transfer" would actually require, per machine

### ShopSabre Pro 408 (WinCNC)
WinCNC's controller **is a full PC** (the manual walks through Windows-level install/driver steps for the motion-control card). That means, in principle, network file transfer is possible **if and only if that PC is actually on a network** - nothing in the manual confirms or denies this for this shop's specific installation. Two real options if it is:
1. **SMB/network share**: if the WinCNC PC has file sharing enabled and is reachable from wherever this app's server runs (only realistic if the shop's network topology allows a Vercel-hosted serverless function to reach a machine on the shop's LAN, which normally means either a VPN/tunnel or the WinCNC PC exposing itself to the internet - the latter is a real security exposure to think through, not just plumb through)
2. **A small local "drop agent"**: a lightweight process running ON the WinCNC PC (or another PC on the same LAN) that polls this app's API for new completed jobs targeting that machine and copies the file into WinCNC's watched folder itself - inverts the connection direction (the shop-side agent calls out to the cloud app, not the other way around), which avoids exposing the shop's network to the internet at all. This is the same shape of idea as the already-deferred `autocam-runner/README.md` external Runner concept for milling, reused for a much simpler job (copy a file, not run Fusion).

Option 2 is the one worth taking seriously - it needs zero changes to the shop's network/firewall posture, and this app already has the `cam_jobs` table as a natural queue to poll (`status = 'completed', machine_id = <this machine>, delivered_to_machine IS NULL` - one new boolean/timestamp column).

### Haas TL-1
Real Haas lathes have shipped with different networking capabilities across generations - older classic-control machines are USB/RS-232 (DNC "drip-feed") only, current-generation NGC controls have Ethernet and can be configured for network drives or FTP-like transfer. **Which generation this specific TL-1's control is has not been confirmed** - this determines whether network transfer is even physically possible before any of the software side matters. If it's Ethernet-capable, the same "local drop agent" shape as the router applies (agent polls the app, writes the file to wherever the Haas control's network drive/USB-emulation setup expects it).

## Data model

- `cam_jobs.delivered_to_machine_at timestamptz` (nullable) - set by whichever transfer path actually delivers the file; null means "still needs a manual download," non-null feeds a "Delivered ✓" state in the UI so operators know a file already made it to the machine without them touching a USB drive.
- If the local-drop-agent path is chosen: a small `machine_agents` table (`machine_id`, `agent_token`, `last_seen_at`) so each shop-side agent authenticates as a specific machine, and the jobs list can show "last synced Xs ago" per machine - the same staleness-visibility problem `runtime_leases` already solves for cron, reused here.

## API surface (agent-poll model)

- `GET /api/machine-agent/next-job` (agent-token authenticated, one token per machine/agent - not the same bearer-token cron gate `cron_auth.js` uses, since this is a different trust boundary: a physical device on the shop network, not a server-to-server cron call) - returns the oldest completed, undelivered job for that agent's mapped machine, or `204 No Content`.
- `POST /api/machine-agent/mark-delivered` - agent confirms it actually wrote the file, sets `delivered_to_machine_at`.
- The agent itself: not part of this app's codebase - a small standalone script (Python or Node, whichever is easier to get running unattended on a shop PC) that shows up as a genuinely separate small project, not a route in this SvelteKit app.

## Real open questions (need actual answers before design, not guesses)

1. **Is either machine's controller PC ever on a network at all today?** If neither is, this whole feature has no path forward except "put a network cable in" - a physical/IT decision, not a software one.
2. **If networked, is it airgapped from the internet (shop LAN only) or does it have outbound internet access?** Determines whether the agent-poll model (needs outbound HTTPS to reach this app) is even possible, or whether it'd need to be an inbound push from a machine on the same LAN as a local relay.
3. **Which Haas TL-1 control generation is this** (classic vs. NGC)? Determines if Ethernet transfer is physically available at all.
4. **Who would maintain a small always-on agent process on a shop PC?** This is real ongoing infrastructure (needs to survive PC restarts, Windows updates, etc.) - worth confirming there's appetite for that before designing around it.
5. **Is "operator walks a USB drive over" actually a real bottleneck in practice**, or is it a minor inconvenience not worth the security/maintenance tradeoff of a network path? Worth a genuine gut-check before building this - the honest answer might be "the download button is fine."

## Recommendation

Don't start building until question 5 has a real answer. If it's worth doing, the agent-poll model (shop-side agent calls out, nothing inbound to the shop network) is the only approach here that doesn't create a new attack surface on the shop's network - worth insisting on that shape even under time pressure, since "just open a port to the CNC PC" is the kind of shortcut that's easy to regret.
