# Pit scouting workflow

`/pitscout` has three sections for an event: robot profiles, robot problems,
and additional notes.

## Robot profiles

Each `pit_scout_entries` row remains unique by event and team. In addition to
the existing pit-entry fields, profiles now store:

- `robot_archetype`: one primary strategic role from the server-validated
  vocabulary.
- `additional_notes`: up to 2,000 characters of freeform pit context.
- `robot_name`, `scoring_roles`, and `profile_notes`: the remaining focused
  profile fields.

All optional columns participate in the existing compatibility loop in
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

`/api/scouting-problems` is authenticated and supports both pit- and
match-originated reports. Finishing Match Scouting with its pit flag enabled
creates a shared queue entry.

## Decision use

Complete reports are persisted in `match_scout_reports`. Power Rankings combines
60% legacy production observations, 30% structured match evaluation (including
pit climb capability), and 10% reliability. Active problem severity reduces
reliability. Missing categories are omitted and remaining weights normalize.
Notes and archetypes stay visible for human review and are not converted into
opaque sentiment scores.

Apply `migrations/20260829_pit_scouting_workflow.sql` and
`migrations/20260829_match_scout_reports.sql` before enabling this workflow.
