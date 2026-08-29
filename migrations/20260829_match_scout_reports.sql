ALTER TABLE public.pit_scout_entries
  ADD COLUMN IF NOT EXISTS robot_name text,
  ADD COLUMN IF NOT EXISTS scoring_roles text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS profile_notes text;

CREATE TABLE IF NOT EXISTS public.match_scout_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  match_key text NOT NULL,
  match_number integer NOT NULL CHECK (match_number > 0),
  team_key text NOT NULL,
  alliance_color text NOT NULL CHECK (alliance_color IN ('red', 'blue')),
  starting_position text NOT NULL,
  auto_start_zone text,
  auto_points_band text,
  auto_end_action text,
  ball_sources text[] NOT NULL DEFAULT '{}',
  auto_moved boolean,
  auto_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  shot_accuracy smallint CHECK (shot_accuracy BETWEEN 1 AND 5),
  driver_awareness smallint CHECK (driver_awareness BETWEEN 1 AND 5),
  cycle_speed smallint CHECK (cycle_speed BETWEEN 1 AND 5),
  defense smallint CHECK (defense BETWEEN 1 AND 5),
  reliability smallint CHECK (reliability BETWEEN 1 AND 5),
  teleop_notes text,
  crash_or_break boolean NOT NULL DEFAULT false,
  robot_status text CHECK (robot_status IN ('active', 'disabled', 'died')),
  card text CHECK (card IN ('none', 'yellow', 'red')),
  driver_skill smallint CHECK (driver_skill BETWEEN 1 AND 5),
  pit_problem boolean NOT NULL DEFAULT false,
  pit_problem_details text,
  post_notes text,
  reported_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_key, match_number, team_key, reported_by)
);

CREATE INDEX IF NOT EXISTS match_scout_reports_event_team_idx
  ON public.match_scout_reports(event_key, team_key, match_number);

ALTER TABLE public.match_scout_reports ENABLE ROW LEVEL SECURITY;
CREATE POLICY match_scout_reports_read ON public.match_scout_reports FOR SELECT TO authenticated USING (public.approved_user());
CREATE POLICY match_scout_reports_insert ON public.match_scout_reports FOR INSERT TO authenticated WITH CHECK (public.approved_user() AND reported_by = auth.uid());
CREATE POLICY match_scout_reports_update ON public.match_scout_reports FOR UPDATE TO authenticated USING (public.approved_user() AND reported_by = auth.uid()) WITH CHECK (public.approved_user() AND reported_by = auth.uid());
CREATE POLICY match_scout_reports_service ON public.match_scout_reports TO service_role USING (true) WITH CHECK (true);
GRANT SELECT, INSERT, UPDATE ON public.match_scout_reports TO authenticated;
GRANT ALL ON public.match_scout_reports TO service_role;
