# August 2026: Manufacturing lead Slack notifications + admin Notifications role

Point-in-time summary. Not kept up to date after the fact — see
`src/lib/server/slack_notifications.js` and the admin panel for current
behavior.

## What changed

**New notification**: leads get a Slack DM when a manufacturing request is
created for a workflow they lead (currently: 3D Print, Router). Wired into
every real part-creation path — `manufacture/create`'s three submit
handlers (generic/router/lathe), `manufacture`'s Quick Print Add modal, and
`cad/[id]`'s BOM insert flow — via the existing `POST /api/notifications`
endpoint and `dispatchNotification` machinery already used for every other
notification type (respects per-user settings, dedupes via
`user_notification_logs`).

Message format:
```
{requester} has requested to {workflow label} {part name}, on {date}.
Quantity: {n} · Material: {material}
Note: {note}
```
The quantity/material line and the note line are each only included if
actually present — material isn't collected on every creation path
(`manufacture/create`'s three forms don't ask for it), and notes are
optional, so neither shows a blank label when nothing was typed.

**New: notes on manufacturing requests.** `manufacture/create` now has an
optional Notes textarea, persisted on the part (`parts.notes`, already
existed as a column but wasn't collected at creation). Notes were already
viewable/editable on the `/manufacture` list itself — `PartNotes.svelte`
was already wired into both the card and table views from earlier work,
nothing needed there.

**New: "Notifications" role in the admin panel.** Who gets manufacturing
lead notifications is no longer hardcoded — `/admin` → Roles & Access has a
new "Notifications" field (checkboxes: 3D Print, Router) next to General
Role/Purchasing Role/Team Role, backed by a real
`user_profiles.manufacturing_lead_workflows` column
(`text[]`). Also shown read-only on the user's own profile page as
"Notification Role."

An earlier version of this also auto-included every `is_dev` account
regardless of assignment, meant to cover Yuvan Shankar for permanent
oversight. That silently pulled in unrelated dev accounts too (William
Jojarth), so it was removed — anyone who needs to see everything is now
assigned every current workflow explicitly, the same mechanism as any
other lead.

## Real bugs found and fixed along the way

- **`dashboard_sections`, then `manufacturing_lead_workflows` and `is_dev`,
  missing from profile-fetch column lists.** `src/lib/stores/auth.js` and
  `src/lib/stores/user.js` both select an explicit column list from
  `user_profiles` when hydrating the logged-in user's profile. Several
  columns that genuinely exist in the DB and are written elsewhere in the
  app were never actually being read back — meaning `user.<field>` was
  always `undefined` client-side regardless of what was in the database.
  `is_dev` specifically was being *selected* but never included in the
  *constructed* profile object returned from the fetch, a subtly different
  bug from simply missing the select. Same root-cause class each time:
  adding a DB column doesn't mean the app actually reads it back — check
  both the `.select(...)` list and the object built from its result.
- **Slack bot token was stale/invalid in both `.env` and GCP Secret
  Manager** — `auth.test` returned `invalid_auth` before any real send was
  attempted. Root-caused by testing the token directly against Slack's API
  rather than assuming the failure was on this app's side. Fixed by
  reinstalling the Slack app with a fresh token; verified via a real DM
  send once corrected.

## Verification

Every piece was verified against the real, deployed production app - real
test parts inserted directly via SQL, real Slack DMs confirmed delivered
(with real message timestamps returned from Slack's API), real admin-panel
checkbox toggles confirmed to persist across a reload, and the recipient
list for both `3d-print` and `router` confirmed via direct SQL query
against `manufacturing_lead_workflows` rather than assumed from the code.
All test data (parts, throwaway accounts, notification-log rows) cleaned
up afterward.
