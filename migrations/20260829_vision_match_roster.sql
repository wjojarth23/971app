-- Cache the six teams actually in a match, per alliance.
--
-- Identifying which tracked robot is which team is the single slowest step in
-- review, and it was a free-text field: someone typed "frc971" once per track,
-- with nothing stopping a typo, a team not in this match, or a red team typed
-- onto a blue track. Every established FRC scouting app instead pre-populates
-- team numbers from the match schedule, which turns an open-ended text entry
-- into a choice between three.
--
-- The Blue Alliance already gives us this in the payload
-- fetchTbaMatchReference() reads (alliances.{red,blue}.team_keys, in driver
-- station order), so the roster costs one extra field off a call the pipeline
-- already makes. Cached on the match rather than re-fetched per page load, and
-- refreshable, since a schedule can change before a match is played.
--
-- Shape: {"red": ["frc971", ...], "blue": [...], "fetched_at": "..."}
-- Empty object means "not fetched yet" - the UI falls back to free text so a
-- missing TBA key or an offline venue never blocks review.

ALTER TABLE public.vision_matches
  ADD COLUMN IF NOT EXISTS team_roster jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.vision_matches.team_roster IS
  'Cached TBA match roster per alliance, in driver station order. Constrains track identity assignment during review.';
