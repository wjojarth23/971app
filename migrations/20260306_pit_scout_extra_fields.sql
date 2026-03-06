-- Adds additional pit scouting fields for failure risk, estimated BPS, and climb capabilities

ALTER TABLE public.pit_scout_entries
  ADD COLUMN IF NOT EXISTS likely_breaking_component text,
  ADD COLUMN IF NOT EXISTS estimated_bps numeric,
  ADD COLUMN IF NOT EXISTS climb_options text[];

UPDATE public.pit_scout_entries
SET climb_options = '{}'::text[]
WHERE climb_options IS NULL;

ALTER TABLE public.pit_scout_entries
  ALTER COLUMN climb_options SET DEFAULT '{}'::text[];

ALTER TABLE public.pit_scout_entries
  ALTER COLUMN climb_options SET NOT NULL;

ALTER TABLE public.pit_scout_entries
  DROP CONSTRAINT IF EXISTS pit_scout_entries_estimated_bps_nonnegative_check;

ALTER TABLE public.pit_scout_entries
  ADD CONSTRAINT pit_scout_entries_estimated_bps_nonnegative_check
  CHECK (estimated_bps IS NULL OR estimated_bps >= 0);

ALTER TABLE public.pit_scout_entries
  DROP CONSTRAINT IF EXISTS pit_scout_entries_climb_options_check;

ALTER TABLE public.pit_scout_entries
  ADD CONSTRAINT pit_scout_entries_climb_options_check
  CHECK (
    coalesce(array_length(climb_options, 1), 0) <= 4
    AND climb_options <@ ARRAY['L1 Auto', 'L1', 'L2', 'L3']::text[]
  );
