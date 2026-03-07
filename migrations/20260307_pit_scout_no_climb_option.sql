-- Adds "No Climb" as an allowed pit scouting climb option.
-- "No Climb" is mutually exclusive with all other climb options.

ALTER TABLE public.pit_scout_entries
  DROP CONSTRAINT IF EXISTS pit_scout_entries_climb_options_check;

ALTER TABLE public.pit_scout_entries
  ADD CONSTRAINT pit_scout_entries_climb_options_check
  CHECK (
    coalesce(array_length(climb_options, 1), 0) <= 5
    AND climb_options <@ ARRAY['No Climb', 'L1 Auto', 'L1', 'L2', 'L3']::text[]
    AND (
      NOT ('No Climb' = ANY(climb_options))
      OR coalesce(array_length(climb_options, 1), 0) = 1
    )
  );
