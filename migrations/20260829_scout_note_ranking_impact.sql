-- Add an explicit, human-selected ranking signal to freeform scouting notes.
-- Existing notes remain neutral and continue to be preserved verbatim.
ALTER TABLE public.scout_notes
  ADD COLUMN IF NOT EXISTS ranking_impact smallint NOT NULL DEFAULT 0;

ALTER TABLE public.scout_notes
  DROP CONSTRAINT IF EXISTS scout_notes_ranking_impact_check;

ALTER TABLE public.scout_notes
  ADD CONSTRAINT scout_notes_ranking_impact_check
  CHECK (ranking_impact BETWEEN -2 AND 2);

