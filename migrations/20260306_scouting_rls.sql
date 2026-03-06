-- Backstop RLS for scouting tables.
-- This keeps Team View readable to anonymous visitors while requiring auth for writes.

CREATE OR REPLACE FUNCTION public.has_roster_key_any(
  _user_id uuid,
  _wanted_keys text[]
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _normalized_keys text[];
  _result boolean := false;
BEGIN
  IF _user_id IS NULL OR _wanted_keys IS NULL OR array_length(_wanted_keys, 1) IS NULL THEN
    RETURN false;
  END IF;

  _normalized_keys := ARRAY(
    SELECT lower(trim(value))
    FROM unnest(_wanted_keys) AS value
    WHERE value IS NOT NULL AND trim(value) <> ''
  );

  IF array_length(_normalized_keys, 1) IS NULL THEN
    RETURN false;
  END IF;

  IF to_regclass('public.roster_entries') IS NULL OR to_regclass('public.roster_keys') IS NULL THEN
    RETURN false;
  END IF;

  EXECUTE $sql$
    SELECT EXISTS (
      SELECT 1
      FROM public.roster_entries re
      JOIN public.roster_keys rk ON rk.id = re.key_id
      WHERE re.user_id = $1
        AND lower(trim(coalesce(rk.key_name, ''))) = ANY ($2)
    )
  $sql$
  INTO _result
  USING _user_id, _normalized_keys;

  RETURN coalesce(_result, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_scouting_row_owner(
  _created_by uuid,
  _user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT _created_by IS NOT NULL AND _created_by = _user_id;
$$;

CREATE OR REPLACE FUNCTION public.can_manage_scouting(
  _user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = _user_id
          AND (
            coalesce(up.role, '') = 'admin'
            OR lower(trim(coalesce(up.team_role, ''))) = 'competition lead'
            OR 'DATA_SCOUT_ADMIN' = ANY (coalesce(up.permissions, '{}'::text[]))
            OR 'NOTE_SCOUT_ADMIN' = ANY (coalesce(up.permissions, '{}'::text[]))
          )
      )
      OR public.has_roster_key_any(
        _user_id,
        ARRAY['scouting lead', 'data scout lead', 'note scout lead']::text[]
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.can_edit_scout_assignments(
  _scouting_type text,
  _user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    _user_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.user_profiles up
        WHERE up.id = _user_id
          AND (
            coalesce(up.role, '') = 'admin'
            OR lower(trim(coalesce(up.team_role, ''))) = 'competition lead'
            OR (
              lower(coalesce(_scouting_type, '')) = 'data'
              AND 'DATA_SCOUT_ADMIN' = ANY (coalesce(up.permissions, '{}'::text[]))
            )
            OR (
              lower(coalesce(_scouting_type, '')) = 'note'
              AND 'NOTE_SCOUT_ADMIN' = ANY (coalesce(up.permissions, '{}'::text[]))
            )
          )
      )
      OR (
        lower(coalesce(_scouting_type, '')) = 'data'
        AND public.has_roster_key_any(
          _user_id,
          ARRAY['data scout lead', 'scouting lead']::text[]
        )
      )
      OR (
        lower(coalesce(_scouting_type, '')) = 'note'
        AND public.has_roster_key_any(
          _user_id,
          ARRAY['note scout lead', 'data scout lead', 'scouting lead']::text[]
        )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_roster_key_any(uuid, text[]) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_scouting_row_owner(uuid, uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_manage_scouting(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_edit_scout_assignments(text, uuid) TO anon, authenticated, service_role;

DO $$
BEGIN
  IF to_regclass('public.scout_data_events') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.scout_data_events ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.scout_data_events FROM anon';
    EXECUTE 'GRANT SELECT ON TABLE public.scout_data_events TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_data_events TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.scout_data_events TO service_role';

    EXECUTE 'DROP POLICY IF EXISTS scout_data_events_public_read ON public.scout_data_events';
    EXECUTE 'DROP POLICY IF EXISTS scout_data_events_insert_authenticated ON public.scout_data_events';
    EXECUTE 'DROP POLICY IF EXISTS scout_data_events_update_owner_or_manager ON public.scout_data_events';
    EXECUTE 'DROP POLICY IF EXISTS scout_data_events_delete_owner_or_manager ON public.scout_data_events';

    EXECUTE '
      CREATE POLICY scout_data_events_public_read
      ON public.scout_data_events
      FOR SELECT
      TO anon, authenticated
      USING (true)
    ';

    EXECUTE '
      CREATE POLICY scout_data_events_insert_authenticated
      ON public.scout_data_events
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND created_by = auth.uid()
      )
    ';

    EXECUTE '
      CREATE POLICY scout_data_events_update_owner_or_manager
      ON public.scout_data_events
      FOR UPDATE
      TO authenticated
      USING (
        public.is_scouting_row_owner(created_by)
        OR public.can_manage_scouting()
      )
      WITH CHECK (
        (
          public.is_scouting_row_owner(created_by)
          AND created_by = auth.uid()
        )
        OR public.can_manage_scouting()
      )
    ';

    EXECUTE '
      CREATE POLICY scout_data_events_delete_owner_or_manager
      ON public.scout_data_events
      FOR DELETE
      TO authenticated
      USING (
        public.is_scouting_row_owner(created_by)
        OR public.can_manage_scouting()
      )
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.scout_notes') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.scout_notes ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.scout_notes FROM anon';
    EXECUTE 'GRANT SELECT ON TABLE public.scout_notes TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_notes TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.scout_notes TO service_role';

    EXECUTE 'DROP POLICY IF EXISTS scout_notes_public_read ON public.scout_notes';
    EXECUTE 'DROP POLICY IF EXISTS scout_notes_insert_authenticated ON public.scout_notes';
    EXECUTE 'DROP POLICY IF EXISTS scout_notes_update_owner_or_manager ON public.scout_notes';
    EXECUTE 'DROP POLICY IF EXISTS scout_notes_delete_owner_or_manager ON public.scout_notes';

    EXECUTE '
      CREATE POLICY scout_notes_public_read
      ON public.scout_notes
      FOR SELECT
      TO anon, authenticated
      USING (true)
    ';

    EXECUTE '
      CREATE POLICY scout_notes_insert_authenticated
      ON public.scout_notes
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND created_by = auth.uid()
      )
    ';

    EXECUTE '
      CREATE POLICY scout_notes_update_owner_or_manager
      ON public.scout_notes
      FOR UPDATE
      TO authenticated
      USING (
        public.is_scouting_row_owner(created_by)
        OR public.can_manage_scouting()
      )
      WITH CHECK (
        (
          public.is_scouting_row_owner(created_by)
          AND created_by = auth.uid()
        )
        OR public.can_manage_scouting()
      )
    ';

    EXECUTE '
      CREATE POLICY scout_notes_delete_owner_or_manager
      ON public.scout_notes
      FOR DELETE
      TO authenticated
      USING (
        public.is_scouting_row_owner(created_by)
        OR public.can_manage_scouting()
      )
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.pit_scout_entries') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.pit_scout_entries ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.pit_scout_entries FROM anon';
    EXECUTE 'GRANT SELECT ON TABLE public.pit_scout_entries TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pit_scout_entries TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.pit_scout_entries TO service_role';

    IF to_regclass('public.pit_scout_entries_id_seq') IS NOT NULL THEN
      EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.pit_scout_entries_id_seq TO authenticated';
      EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.pit_scout_entries_id_seq TO service_role';
    END IF;

    EXECUTE 'DROP POLICY IF EXISTS pit_scout_entries_public_read ON public.pit_scout_entries';
    EXECUTE 'DROP POLICY IF EXISTS pit_scout_entries_insert_authenticated ON public.pit_scout_entries';
    EXECUTE 'DROP POLICY IF EXISTS pit_scout_entries_update_authenticated ON public.pit_scout_entries';
    EXECUTE 'DROP POLICY IF EXISTS pit_scout_entries_delete_manager ON public.pit_scout_entries';

    EXECUTE '
      CREATE POLICY pit_scout_entries_public_read
      ON public.pit_scout_entries
      FOR SELECT
      TO anon, authenticated
      USING (true)
    ';

    EXECUTE '
      CREATE POLICY pit_scout_entries_insert_authenticated
      ON public.pit_scout_entries
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND created_by = auth.uid()
      )
    ';

    EXECUTE '
      CREATE POLICY pit_scout_entries_update_authenticated
      ON public.pit_scout_entries
      FOR UPDATE
      TO authenticated
      USING (auth.uid() IS NOT NULL)
      WITH CHECK (auth.uid() IS NOT NULL)
    ';

    EXECUTE '
      CREATE POLICY pit_scout_entries_delete_manager
      ON public.pit_scout_entries
      FOR DELETE
      TO authenticated
      USING (public.can_manage_scouting())
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.scout_match_assignments') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.scout_match_assignments ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.scout_match_assignments FROM anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scout_match_assignments TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.scout_match_assignments TO service_role';

    EXECUTE 'DROP POLICY IF EXISTS scout_match_assignments_read_authenticated ON public.scout_match_assignments';
    EXECUTE 'DROP POLICY IF EXISTS scout_match_assignments_insert_manager ON public.scout_match_assignments';
    EXECUTE 'DROP POLICY IF EXISTS scout_match_assignments_update_manager_or_assignee ON public.scout_match_assignments';
    EXECUTE 'DROP POLICY IF EXISTS scout_match_assignments_delete_manager ON public.scout_match_assignments';

    EXECUTE '
      CREATE POLICY scout_match_assignments_read_authenticated
      ON public.scout_match_assignments
      FOR SELECT
      TO authenticated
      USING (auth.uid() IS NOT NULL)
    ';

    EXECUTE '
      CREATE POLICY scout_match_assignments_insert_manager
      ON public.scout_match_assignments
      FOR INSERT
      TO authenticated
      WITH CHECK (
        auth.uid() IS NOT NULL
        AND public.can_edit_scout_assignments(scouting_type)
      )
    ';

    EXECUTE '
      CREATE POLICY scout_match_assignments_update_manager_or_assignee
      ON public.scout_match_assignments
      FOR UPDATE
      TO authenticated
      USING (
        public.can_edit_scout_assignments(scouting_type)
        OR assigned_user = auth.uid()
      )
      WITH CHECK (
        public.can_edit_scout_assignments(scouting_type)
        OR assigned_user = auth.uid()
      )
    ';

    EXECUTE '
      CREATE POLICY scout_match_assignments_delete_manager
      ON public.scout_match_assignments
      FOR DELETE
      TO authenticated
      USING (public.can_edit_scout_assignments(scouting_type))
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('public.scouting_settings') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.scouting_settings ENABLE ROW LEVEL SECURITY';
    EXECUTE 'REVOKE ALL ON TABLE public.scouting_settings FROM anon';
    EXECUTE 'GRANT SELECT ON TABLE public.scouting_settings TO anon';
    EXECUTE 'GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.scouting_settings TO authenticated';
    EXECUTE 'GRANT ALL ON TABLE public.scouting_settings TO service_role';

    EXECUTE 'DROP POLICY IF EXISTS scouting_settings_public_read ON public.scouting_settings';
    EXECUTE 'DROP POLICY IF EXISTS scouting_settings_write_manager ON public.scouting_settings';

    EXECUTE '
      CREATE POLICY scouting_settings_public_read
      ON public.scouting_settings
      FOR SELECT
      TO anon, authenticated
      USING (true)
    ';

    EXECUTE '
      CREATE POLICY scouting_settings_write_manager
      ON public.scouting_settings
      FOR ALL
      TO authenticated
      USING (public.can_manage_scouting())
      WITH CHECK (public.can_manage_scouting())
    ';
  END IF;
END $$;

DO $$
BEGIN
  IF to_regclass('storage.objects') IS NOT NULL THEN
    EXECUTE 'DROP POLICY IF EXISTS pit_scout_photos_select ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS pit_scout_photos_insert ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS pit_scout_photos_update ON storage.objects';
    EXECUTE 'DROP POLICY IF EXISTS pit_scout_photos_delete ON storage.objects';

    EXECUTE '
      CREATE POLICY pit_scout_photos_select
      ON storage.objects
      FOR SELECT
      USING (bucket_id = ''pit-scout-photos'')
    ';

    EXECUTE '
      CREATE POLICY pit_scout_photos_insert
      ON storage.objects
      FOR INSERT
      TO authenticated
      WITH CHECK (bucket_id = ''pit-scout-photos'')
    ';

    EXECUTE '
      CREATE POLICY pit_scout_photos_update
      ON storage.objects
      FOR UPDATE
      TO authenticated
      USING (bucket_id = ''pit-scout-photos'')
      WITH CHECK (bucket_id = ''pit-scout-photos'')
    ';

    EXECUTE '
      CREATE POLICY pit_scout_photos_delete
      ON storage.objects
      FOR DELETE
      TO authenticated
      USING (bucket_id = ''pit-scout-photos'')
    ';
  END IF;
END $$;
