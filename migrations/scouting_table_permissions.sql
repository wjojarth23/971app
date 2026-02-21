-- Ensure scouting tables are writable/readable by authenticated users.
-- This helps avoid "permission denied for table scout_data_events" when RLS policies allow access.
DO $$
BEGIN
  IF to_regclass('public.scout_data_events') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_data_events TO authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_data_events TO service_role';
  END IF;

  IF to_regclass('public.scout_notes') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_notes TO authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_notes TO service_role';
  END IF;

  IF to_regclass('public.scout_match_assignments') IS NOT NULL THEN
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_match_assignments TO authenticated';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_match_assignments TO service_role';
  END IF;

  IF to_regclass('public.scout_data_events_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.scout_data_events_id_seq TO authenticated';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.scout_data_events_id_seq TO service_role';
  END IF;

  IF to_regclass('public.scout_notes_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.scout_notes_id_seq TO authenticated';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.scout_notes_id_seq TO service_role';
  END IF;

  IF to_regclass('public.scout_match_assignments_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.scout_match_assignments_id_seq TO authenticated';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.scout_match_assignments_id_seq TO service_role';
  END IF;
END $$;
