# RosterManager App integration — secure add/remove API (not built)

## Scope

The RosterManager App itself (Google Groups / GitHub / OnShape provisioning,
replacing the Google Forms onboarding flow) is a **separate app**, out of
scope for this repo. This plan covers exactly one thing: a secure API on
SpartansHub that RosterManager can call to add or remove a student here,
so SpartansHub access stays in sync with the real roster instead of
depending on a human remembering to also update this app. Google
Groups/GitHub/OnShape sync itself lives entirely in RosterManager and isn't
addressed here.

## How to read this

Grounded in what's actually live in this repo (checked directly via
Supabase MCP and repo reads this session, not assumed) plus explicit open
questions that need real answers - same discipline as every other plan in
this folder. Two things below aren't just style choices, they're
determined by real constraints found while researching (a NOT NULL foreign
key, and what "remove" already does today) - flagged clearly so they don't
get glossed over during implementation.

## Current footprint (confirmed, not assumed)

**External-caller auth already has an established pattern in this
codebase** - not something to invent from scratch:
- `src/lib/server/cron_auth.js` and `src/lib/server/fusion_runner_auth.js`
  both do the same thing: a shared-secret bearer token (`Authorization:
  Bearer <token>` or `?token=`), checked against an env var, own module per
  external trust boundary rather than one shared secret for everything.
  `fusion_runner_auth.js`'s own header comment argues for exactly this
  separation: *"The Runner is a different trust boundary... so it gets its
  own secret/env var, even though the underlying technique is identical."*
  The RosterManager integration should follow this exact template - its
  own module, own env var, not reusing the cron or Fusion Runner secret.
- **Real gap in the existing pattern, already flagged elsewhere in this
  repo**: both `cron_auth.js` and `fusion_runner_auth.js` are **fail-open
  when the secret env var isn't set** (`if (!expectedSecrets.length) return
  true`). `README.md` and `docs/deployment/google-cloud-run.md` both call
  this out as intentional-for-local-dev-but-a-real-production-risk. A
  notification cron sweep firing unauthenticated is low stakes. An endpoint
  that creates and deletes real user accounts is not - this integration
  must **not** inherit fail-open behavior. Reject by default if the secret
  isn't configured.
- Every existing external-caller endpoint does its DB writes through a
  **service-role client** (`getSupabase()` in `src/lib/server/971bot.js`,
  or local equivalents in `fusion-runner`/`drive-watcher`'s own
  `+server.js` files) - there's no `auth.uid()` session for an external
  caller to present, so per-user RLS policies are structurally
  inapplicable. `user_profiles` already has a `service_role`-only RLS
  policy (`user_profiles_service_all`, unconditional read/write) built for
  exactly this. Reuse `971bot.js`'s `getSupabase()` rather than adding a
  fourth near-duplicate copy of the same client-construction code.

**How a student gets added/removed today, in detail:**
- Self-registration (`src/routes/+page.svelte`) calls
  `supabase.auth.signUp(...)`, which fires the DB trigger
  `handle_new_user()` (`SECURITY DEFINER`) that auto-inserts a
  `user_profiles` row with `general_role: 'none'` (pending approval, no
  `CAN_SEE_ROUTES`). A human admin then approves via `/api/admin`
  (`action: 'approve'`), which sets `role: 'member'`, `general_role:
  'member'`, adds `CAN_SEE_ROUTES` to `permissions`.
- **Critical constraint**: `user_profiles.id` is `NOT NULL`, foreign-keyed
  to `auth.users.id` `ON DELETE CASCADE`. There is no way to create a
  `user_profiles` row without a real, corresponding `auth.users` row first
  - not a policy choice, a schema constraint. This directly shapes the
  central open question below.
- Removal (`/api/admin`, `action: 'remove'`) is a **hard delete**: deletes
  the `user_profiles` row, then best-effort deletes the `auth.users` row
  too via `auth.admin.deleteUser()`, specifically so the email frees up
  and the person can re-register from scratch. This existing behavior was
  designed for "this account is broken, let them start over" - not for
  "this student graduated." Reusing it as-is for roster-driven removal
  would silently orphan/blank out that student's historical attribution on
  every table with an `ON DELETE SET NULL`/similar FK to `user_profiles`
  (subsystem membership, purchase requests, scouting data, etc.) - see the
  open question on this below.
- A second, independently-maintained "approve"-shaped helper already
  exists: `addPermissionCanSeeRoutes()` in `971bot.js`, used by the Slack
  bot's own emoji-approval flow. It does *not* set `general_role`, unlike
  `/api/admin`'s approve action. Two approve code paths already exist and
  already disagree slightly - worth consolidating rather than adding a
  third slightly-different one for RosterManager.

**Not relevant, despite the name**: this app's own `rosters` /
`roster_keys` / `roster_entries` tables are scouting-duty/leadership tag
lists (e.g. "Data Scout Lead"), unrelated to RosterManager's team-roster
concept. Don't reuse them for membership sync - different purpose,
different RLS, different admin UI already built around the existing
meaning.

## The one fact that determines everything else: does "add" create a login-capable account?

Because of the NOT NULL FK above, "add a student" can't just insert a
`user_profiles` row and let them log in whenever they get around to it -
either a real `auth.users` row is created up front, or nothing is created
until the student self-registers.

**Option A - RosterManager's "add" creates a real, login-capable account
immediately.** Use the Supabase Admin API (`auth.admin.createUser()`,
service-role, same trust level `/api/admin`'s remove action already uses
for `deleteUser()`) with a random password and `email_confirm: true`,
then trigger Supabase's password-reset/invite email so the student sets
their own password on first login. `handle_new_user()` fires normally and
creates the `user_profiles` row; the endpoint then immediately marks it
approved (skip the pending-approval step entirely - RosterManager being
the source of truth for "this person is on the team" *is* the approval).
**Recommended** - this is what "streamline onboarding" actually implies:
zero manual admin approval step for anyone RosterManager already vouches
for.

**Option B - "add" just pre-registers intent, student still self-registers
normally.** Store the incoming roster data somewhere else (a small new
table, e.g. `roster_manager_pending(email, full_name, frc_team, ...)`) and
have the *existing* registration flow check it on signup - auto-approve if
the signing-up email matches a pending row. More moving parts (a new
table, a change to the registration trigger/flow to consult it, and a
window where "added in RosterManager" and "usable in SpartansHub" aren't
the same moment), for the benefit of not creating an account before the
student has chosen a password. Given RosterManager is explicitly meant to
*replace* the manual onboarding friction, Option A's immediate-account
approach seems like the actual goal - Option B is here mainly as the
honest alternative, not because it looks better on the merits.

## Should "remove" hard-delete, or soft-deactivate?

**Recommend soft-deactivate, deliberately different from `/api/admin`'s
existing remove action**: set `banned: true` and strip `CAN_SEE_ROUTES`
(and any other `permissions`) rather than deleting the `user_profiles`
row or the `auth.users` row. Reasoning:
- A student leaving the team is not the same situation as "this account is
  broken, let them start fresh" (what the existing hard-delete remove
  action was built for) - there's no reason to free up the email for
  re-registration here.
- Hard-deleting orphans that student's historical attribution across every
  table referencing `user_profiles.id` - subsystem membership, purchase
  history, scouting contributions, planner task ownership. A team wants
  that history to survive someone graduating.
- Soft-deactivation is trivially reversible if RosterManager (or a human)
  made a mistake; a hard delete via `auth.admin.deleteUser()` is not.

If a genuine "purge this person entirely" need shows up later, that's a
separate, deliberate admin action - not what an automated roster-sync
integration should default to.

## Target design (recommended)

1. **New auth module** `src/lib/server/roster_manager_auth.js`, copying
   `fusion_runner_auth.js`'s shape exactly (own env var, e.g.
   `ROSTER_MANAGER_TOKEN`; bearer-token check) with one deliberate change:
   **reject when the secret is unset**, don't fall back to fail-open.
2. **New endpoint** `src/routes/api/roster-manager/+server.js` (or split
   `students`/`+server.js` if the payload shapes diverge enough to want
   separate routes) - `POST` for add, `DELETE` (or a `POST` with
   `action: 'remove'`, matching `/api/admin`'s existing dispatch style for
   consistency) for remove. Auth-checks via the new module first, then
   uses `getSupabase()` from `971bot.js` for every DB write - no session,
   no RLS-scoped client, matching the Fusion Runner/Drive watcher
   precedent exactly.
3. **Refactor, don't duplicate, the add/approve and remove logic.** Pull
   the actual DB-mutation steps out of `/api/admin`'s `approve`/`remove`
   action handlers into shared functions (e.g. in `971bot.js` or a new
   `src/lib/server/roster_manager.js`), called from both the human-admin
   endpoint and this new external one. Two independent copies of "how do
   we approve/remove a user" already exist (`/api/admin` vs
   `addPermissionCanSeeRoutes`) and already disagree slightly - a third
   copy for RosterManager would make that worse, not better.
4. **Add a stable cross-system reference column**: e.g.
   `user_profiles.external_roster_id text`, nullable, set on add. Lets
   RosterManager target a specific SpartansHub account on a later
   remove/update call without relying on email as the only join key (email
   can change; this shouldn't).
5. **Audit trail**: log add/remove calls through this endpoint into the
   existing `activity_log` table (the same mechanism the admin panel's
   Activity Log tab already reads from), tagged distinctly from
   human-admin actions, so "why did this account change" stays answerable
   without cross-referencing RosterManager's own logs.
6. **Payload shape** (add): `email`, `full_name`, `frc_team` at minimum -
   matches the fields the existing registration flow already collects,
   plus `external_roster_id`. (remove): `external_roster_id` (preferred)
   or `email` as a fallback.

## Open questions

1. **Option A vs B above** - does "add" create a real, login-capable
   account immediately, or just pre-register intent for later
   self-registration? This is the one decision that determines the shape
   of everything else in this plan.
2. Does RosterManager need a **read/list endpoint** too (e.g. "who does
   SpartansHub currently think is on the roster," for reconciliation /
   drift-detection), or is this purely one-way push (RosterManager tells
   SpartansHub about changes, never the reverse)?
3. Who owns generating and storing `ROSTER_MANAGER_TOKEN`, and does it need
   to be **rotatable** without redeploying both apps simultaneously (e.g.
   accept a current + previous token during a rotation window)?
4. Should `frc_team`/role defaults for a RosterManager-added student be
   configurable per call, or always land in the same default state (e.g.
   always `general_role: 'member'`, no `team_role` set, left for a human
   to assign later)?
5. Rate limiting / abuse handling - is a bare shared-secret bearer token
   sufficient given this endpoint can create and deactivate real accounts,
   or does the blast radius justify something stronger (IP allowlisting to
   RosterManager's known host, or HMAC-signed request bodies like the
   Slack integration already does in `971bot.js`'s
   `verifySlackSignature()`)? Recommend starting with the bearer-token
   pattern for consistency with the rest of the codebase, revisiting only
   if it's actually operated from an untrusted network path.

## Recommended sequencing

Settle the Option A/B question first - it decides whether this is "one
endpoint that creates real accounts" (smaller, Option A) or "one endpoint
plus a new pending-registration table plus a change to the existing
signup flow" (larger, Option B). Once that's picked, the refactor-first
step (pulling shared add/remove logic out of `/api/admin` into functions
both the human admin UI and this new endpoint call) should happen before
writing the new endpoint itself, not after - otherwise the new endpoint
becomes the third slightly-different copy of this logic instead of fixing
that it already exists twice.
