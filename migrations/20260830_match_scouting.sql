-- Server-side storage for match scouting and the pit-problem handoff.
--
-- Match scouting had no backend at all: the workspace was a page with no
-- +server.js, so a completed match existed only in the scout's browser tab
-- and was gone on refresh.
--
-- The pit-problem handoff was worse than missing - it was actively broken.
-- A match scout flagging "this robot has a mechanical issue" wrote it to
-- window.localStorage, which is per-browser and per-device. The pit crew, who
-- are the entire audience for that report, are on a different device and
-- could never see it. The feature could not work as built.
--
-- Both tables follow the RLS convention the scouting tables actually run with
-- in production - see the note above the policy block below, which is not the
-- convention the checked-in 20260306_scouting_rls.sql describes.

CREATE TABLE IF NOT EXISTS public.match_scout_entries (
  id bigserial PRIMARY KEY,
  event_key text NOT NULL,
  match_key text NOT NULL,
  team_key text NOT NULL,
  alliance text,
  -- Assignment
  starting_position text,
  -- Auto
  auto_start_zone text,
  auto_points_band text,
  auto_finish text,
  auto_moved text,
  ball_sources text[] NOT NULL DEFAULT '{}'::text[],
  -- Normalized 0-100 percentages of the field diagram, so the drawn path
  -- survives a different screen size. Stored as jsonb rather than a typed
  -- point array because it is drawn freehand and only ever read back whole.
  auto_path jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- Teleop / post
  ratings jsonb NOT NULL DEFAULT '{}'::jsonb,
  teleop_notes text,
  crash_or_break boolean NOT NULL DEFAULT false,
  robot_disabled text,
  card text,
  driver_skill integer,
  post_notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One scout's report per robot per match. A second scout covering the same
  -- robot is a real scenario, so this keys on the author too rather than
  -- silently overwriting someone else's observations.
  CONSTRAINT match_scout_entries_unique_scout UNIQUE (event_key, match_key, team_key, created_by),
  CONSTRAINT match_scout_entries_alliance_check CHECK (
    alliance IS NULL OR alliance IN ('red', 'blue')
  ),
  CONSTRAINT match_scout_entries_card_check CHECK (
    card IS NULL OR card IN ('', 'yellow', 'red')
  ),
  CONSTRAINT match_scout_entries_driver_skill_check CHECK (
    driver_skill IS NULL OR (driver_skill >= 0 AND driver_skill <= 5)
  )
);

CREATE INDEX IF NOT EXISTS match_scout_entries_event_match_idx
  ON public.match_scout_entries (event_key, match_key);
CREATE INDEX IF NOT EXISTS match_scout_entries_team_idx
  ON public.match_scout_entries (event_key, team_key);

CREATE TABLE IF NOT EXISTS public.pit_problem_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  team_key text NOT NULL,
  match_key text,
  source text NOT NULL DEFAULT 'Match scout',
  summary text NOT NULL,
  detail text,
  severity text NOT NULL DEFAULT 'watch',
  resolved boolean NOT NULL DEFAULT false,
  resolved_by uuid,
  resolved_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pit_problem_reports_severity_check CHECK (severity IN ('urgent', 'watch'))
);

-- The pit crew's working query is "what is still open at this event", so the
-- index leads with that rather than with the team.
CREATE INDEX IF NOT EXISTS pit_problem_reports_open_idx
  ON public.pit_problem_reports (event_key, resolved, created_at DESC);
CREATE INDEX IF NOT EXISTS pit_problem_reports_team_idx
  ON public.pit_problem_reports (event_key, team_key);

-- RLS follows the convention the scouting tables actually run with in
-- production (scout_notes / scout_data_events): approved_user() to read and
-- insert, author-or-admin to change, service_role unrestricted. Note this is
-- deliberately NOT the shape written in 20260306_scouting_rls.sql, which
-- references a can_manage_scouting() function that does not exist in the
-- database and grants anon read - that file is stale and was superseded.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['match_scout_entries', 'pit_problem_reports']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select_authenticated', table_name);
    EXECUTE format('
      CREATE POLICY %I ON public.%I
      FOR SELECT TO authenticated USING (public.approved_user())
    ', table_name || '_select_authenticated', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_insert_authenticated', table_name);
    EXECUTE format('
      CREATE POLICY %I ON public.%I
      FOR INSERT TO authenticated WITH CHECK (public.approved_user())
    ', table_name || '_insert_authenticated', table_name);

    -- A scout can revise their own report; a data-scouting admin can fix
    -- anyone's. Resolving a pit problem is an update, and the pit crew are
    -- not the report's author, so this is what lets them close one.
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_modify_authenticated', table_name);
    EXECUTE format('
      CREATE POLICY %I ON public.%I
      FOR UPDATE TO authenticated
      USING (public.has_permission(''DATA_SCOUT_ADMIN'') OR auth.uid() = created_by)
      WITH CHECK (public.has_permission(''DATA_SCOUT_ADMIN'') OR auth.uid() = created_by)
    ', table_name || '_modify_authenticated', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_delete_authenticated', table_name);
    EXECUTE format('
      CREATE POLICY %I ON public.%I
      FOR DELETE TO authenticated
      USING (public.has_permission(''DATA_SCOUT_ADMIN'') OR auth.uid() = created_by)
    ', table_name || '_delete_authenticated', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_service_all', table_name);
    EXECUTE format('
      CREATE POLICY %I ON public.%I TO service_role USING (true) WITH CHECK (true)
    ', table_name || '_service_all', table_name);

    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', table_name);
  END LOOP;
END $$;

-- pit_scout_entries shipped with RLS never enabled and zero policies, so the
-- table is currently readable and writable by anyone holding the public anon
-- key. The app itself is unaffected either way: pitscout/+server.js resolves
-- its client through getDbClient(), which prefers the service-role client and
-- so bypasses RLS entirely. Closing this only removes the direct-client hole.
ALTER TABLE public.pit_scout_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pit_scout_entries_select_authenticated ON public.pit_scout_entries;
CREATE POLICY pit_scout_entries_select_authenticated ON public.pit_scout_entries
  FOR SELECT TO authenticated USING (public.approved_user());

DROP POLICY IF EXISTS pit_scout_entries_insert_authenticated ON public.pit_scout_entries;
CREATE POLICY pit_scout_entries_insert_authenticated ON public.pit_scout_entries
  FOR INSERT TO authenticated WITH CHECK (public.approved_user());

-- Pit entries are a shared per-team record that several scouts add to across
-- an event, so any approved scout may revise one - unlike a personal note.
DROP POLICY IF EXISTS pit_scout_entries_modify_authenticated ON public.pit_scout_entries;
CREATE POLICY pit_scout_entries_modify_authenticated ON public.pit_scout_entries
  FOR UPDATE TO authenticated
  USING (public.approved_user()) WITH CHECK (public.approved_user());

DROP POLICY IF EXISTS pit_scout_entries_delete_authenticated ON public.pit_scout_entries;
CREATE POLICY pit_scout_entries_delete_authenticated ON public.pit_scout_entries
  FOR DELETE TO authenticated
  USING (public.has_permission('DATA_SCOUT_ADMIN') OR auth.uid() = created_by);

DROP POLICY IF EXISTS pit_scout_entries_service_all ON public.pit_scout_entries;
CREATE POLICY pit_scout_entries_service_all ON public.pit_scout_entries
  TO service_role USING (true) WITH CHECK (true);

DO $$
BEGIN
  IF to_regclass('public.match_scout_entries_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.match_scout_entries_id_seq TO authenticated, service_role';
  END IF;
END $$;
