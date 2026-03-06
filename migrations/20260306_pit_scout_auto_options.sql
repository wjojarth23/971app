-- Adds named autonomous routine options to pit scouting entries

ALTER TABLE public.pit_scout_entries
  ADD COLUMN IF NOT EXISTS auto_options jsonb;

UPDATE public.pit_scout_entries
SET auto_options = '[]'::jsonb
WHERE auto_options IS NULL;

ALTER TABLE public.pit_scout_entries
  ALTER COLUMN auto_options SET DEFAULT '[]'::jsonb;

ALTER TABLE public.pit_scout_entries
  ALTER COLUMN auto_options SET NOT NULL;

ALTER TABLE public.pit_scout_entries
  DROP CONSTRAINT IF EXISTS pit_scout_entries_auto_options_array_check;

ALTER TABLE public.pit_scout_entries
  ADD CONSTRAINT pit_scout_entries_auto_options_array_check
  CHECK (jsonb_typeof(auto_options) = 'array');
