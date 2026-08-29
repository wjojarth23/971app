# Pit scouting workflow

`/pitscout` has three sections for an event: robot profiles, robot problems,
and additional notes.

## Robot profiles

Each `pit_scout_entries` row remains unique by event and team. In addition to
the existing pit-entry fields, profiles now store:

- `robot_archetype`: one primary strategic role from the server-validated
  vocabulary.
- `additional_notes`: up to 2,000 characters of freeform pit context.

Both columns participate in the existing optional-column compatibility loop in
`src/lib/server/pitScoutingSchema.js`. A deployment missing the newest migration
therefore hides the fields and returns a warning instead of breaking the whole
pit page.

## Problem queue

`scouting_problem_reports` is a separate event-scoped queue because a match
failure is an incident, not a permanent property of the robot profile. Reports
carry team, optional match context, source, severity, summary/details, reporter,
and acknowledgement/resolution audit fields.

The Pit Scouting Problems tab creates shared reports and can resolve or dismiss
them. The API supports the complete lifecycle:

`open → acknowledged → resolved`

Reports may also be dismissed or reopened. Open and acknowledged reports sort
ahead of closed work.

`/api/scouting-problems` is authenticated and supports both pit-originated and
future match-scout-originated reports. This change deliberately does not modify
the Data Scouting UI; its future Problems button can submit `source:
'match_scout'` to the same endpoint without another schema.

Apply `migrations/20260829_pit_scouting_workflow.sql` before enabling the new
fields in production.
