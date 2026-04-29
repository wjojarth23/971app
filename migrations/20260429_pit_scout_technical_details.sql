-- Adds organized technical pit scouting answers.

ALTER TABLE public.pit_scout_entries
  ADD COLUMN IF NOT EXISTS technical_details jsonb;

UPDATE public.pit_scout_entries
SET technical_details = '{}'::jsonb
WHERE technical_details IS NULL;

ALTER TABLE public.pit_scout_entries
  ALTER COLUMN technical_details SET DEFAULT '{}'::jsonb;

ALTER TABLE public.pit_scout_entries
  ALTER COLUMN technical_details SET NOT NULL;

ALTER TABLE public.pit_scout_entries
  DROP CONSTRAINT IF EXISTS pit_scout_entries_technical_details_object_check;

ALTER TABLE public.pit_scout_entries
  ADD CONSTRAINT pit_scout_entries_technical_details_object_check
  CHECK (jsonb_typeof(technical_details) = 'object');
