-- Pit scouting profile additions and the cross-scout robot problem queue.

ALTER TABLE public.pit_scout_entries
  ADD COLUMN IF NOT EXISTS robot_archetype text,
  ADD COLUMN IF NOT EXISTS additional_notes text;

ALTER TABLE public.pit_scout_entries
  DROP CONSTRAINT IF EXISTS pit_scout_entries_robot_archetype_check;

ALTER TABLE public.pit_scout_entries
  ADD CONSTRAINT pit_scout_entries_robot_archetype_check
  CHECK (
    robot_archetype IS NULL OR robot_archetype IN (
      'Shooter', 'Shuttler', 'Defender', 'Climber', 'Hybrid', 'Support / Feeder', 'Unknown'
    )
  );

CREATE TABLE IF NOT EXISTS public.scouting_problem_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  match_key text,
  match_number integer,
  team_key text NOT NULL,
  alliance_color text,
  source text NOT NULL DEFAULT 'pit_scout',
  severity text NOT NULL DEFAULT 'medium',
  summary text NOT NULL,
  details text,
  status text NOT NULL DEFAULT 'open',
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  resolved_at timestamptz,
  CONSTRAINT scouting_problem_reports_alliance_check
    CHECK (alliance_color IS NULL OR alliance_color IN ('red', 'blue')),
  CONSTRAINT scouting_problem_reports_source_check
    CHECK (source IN ('pit_scout', 'match_scout', 'manual')),
  CONSTRAINT scouting_problem_reports_severity_check
    CHECK (severity IN ('low', 'medium', 'high', 'critical')),
  CONSTRAINT scouting_problem_reports_status_check
    CHECK (status IN ('open', 'acknowledged', 'resolved', 'dismissed'))
);

CREATE INDEX IF NOT EXISTS scouting_problem_reports_event_status_idx
  ON public.scouting_problem_reports(event_key, status, created_at DESC);
CREATE INDEX IF NOT EXISTS scouting_problem_reports_team_idx
  ON public.scouting_problem_reports(event_key, team_key, created_at DESC);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'touch_updated_at'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'trg_touch_scouting_problem_reports'
  ) THEN
    EXECUTE '
      CREATE TRIGGER trg_touch_scouting_problem_reports
      BEFORE UPDATE ON public.scouting_problem_reports
      FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at()
    ';
  END IF;
END $$;

ALTER TABLE public.scouting_problem_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scouting_problem_reports_read ON public.scouting_problem_reports;
CREATE POLICY scouting_problem_reports_read ON public.scouting_problem_reports
  FOR SELECT TO authenticated
  USING (public.approved_user());

DROP POLICY IF EXISTS scouting_problem_reports_insert ON public.scouting_problem_reports;
CREATE POLICY scouting_problem_reports_insert ON public.scouting_problem_reports
  FOR INSERT TO authenticated
  WITH CHECK (public.approved_user() AND (reported_by IS NULL OR reported_by = auth.uid()));

DROP POLICY IF EXISTS scouting_problem_reports_update ON public.scouting_problem_reports;
CREATE POLICY scouting_problem_reports_update ON public.scouting_problem_reports
  FOR UPDATE TO authenticated
  USING (public.approved_user())
  WITH CHECK (public.approved_user());

DROP POLICY IF EXISTS scouting_problem_reports_service ON public.scouting_problem_reports;
CREATE POLICY scouting_problem_reports_service ON public.scouting_problem_reports
  TO service_role USING (true) WITH CHECK (true);

REVOKE ALL ON public.scouting_problem_reports FROM anon;
GRANT SELECT, INSERT, UPDATE ON public.scouting_problem_reports TO authenticated;
GRANT ALL ON public.scouting_problem_reports TO service_role;
