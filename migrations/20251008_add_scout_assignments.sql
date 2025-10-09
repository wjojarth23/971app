-- Scouting assignment tables
-- Note & Data scouting assignment system

CREATE TABLE IF NOT EXISTS public.scout_match_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  scouting_type text NOT NULL, -- 'note' | 'data'
  match_key text NOT NULL,
  team_key text NOT NULL,
  assigned_user uuid, -- references user_profiles.id (nullable until assigned)
  completed_at timestamptz, -- set when scout marks match complete
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS scout_match_assignments_unique ON public.scout_match_assignments (scouting_type, match_key, team_key);
CREATE INDEX IF NOT EXISTS scout_match_assignments_user_idx ON public.scout_match_assignments (assigned_user);

-- Simple trigger to bump updated_at
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_touch_scout_assign ON public.scout_match_assignments;
CREATE TRIGGER trg_touch_scout_assign
BEFORE UPDATE ON public.scout_match_assignments
FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
