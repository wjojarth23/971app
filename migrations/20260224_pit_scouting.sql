-- Pit scouting data table + storage bucket for pit photos

CREATE TABLE IF NOT EXISTS public.pit_scout_entries (
  id bigserial PRIMARY KEY,
  event_key text NOT NULL,
  team_key text NOT NULL,
  drivebase_type text,
  shooter_type text,
  hopper_type text,
  human_player_balls_in_auto text,
  photo_paths text[] NOT NULL DEFAULT '{}'::text[],
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT pit_scout_entries_unique_event_team UNIQUE (event_key, team_key),
  CONSTRAINT pit_scout_entries_drivebase_check CHECK (
    drivebase_type IS NULL OR drivebase_type IN ('Mechanum', 'Swerve', 'Tank')
  ),
  CONSTRAINT pit_scout_entries_shooter_check CHECK (
    shooter_type IS NULL OR shooter_type IN ('Single Fixed', 'Multi Fixed', 'Wide', 'Turret', 'Double Turret')
  ),
  CONSTRAINT pit_scout_entries_hopper_check CHECK (
    hopper_type IS NULL OR hopper_type IN ('Spindexer', 'Dye Rotor', 'Belted')
  ),
  CONSTRAINT pit_scout_entries_human_player_balls_check CHECK (
    human_player_balls_in_auto IS NULL OR human_player_balls_in_auto IN ('0-10', '10-20', '20+')
  ),
  CONSTRAINT pit_scout_entries_photo_limit_check CHECK (coalesce(array_length(photo_paths, 1), 0) <= 3)
);

CREATE INDEX IF NOT EXISTS pit_scout_entries_event_team_idx ON public.pit_scout_entries (event_key, team_key);
CREATE INDEX IF NOT EXISTS pit_scout_entries_team_idx ON public.pit_scout_entries (team_key);

DO $$
BEGIN
  IF to_regclass('public.pit_scout_entries_id_seq') IS NOT NULL THEN
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.pit_scout_entries_id_seq TO authenticated';
    EXECUTE 'GRANT USAGE, SELECT ON SEQUENCE public.pit_scout_entries_id_seq TO service_role';
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pit_scout_entries TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pit_scout_entries TO service_role;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'touch_updated_at'
  ) THEN
    IF NOT EXISTS (
      SELECT 1
      FROM pg_trigger
      WHERE tgname = 'trg_touch_pit_scout_entries'
    ) THEN
      EXECUTE '
        CREATE TRIGGER trg_touch_pit_scout_entries
        BEFORE UPDATE ON public.pit_scout_entries
        FOR EACH ROW
        EXECUTE FUNCTION public.touch_updated_at()
      ';
    END IF;
  END IF;
END $$;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'pit-scout-photos',
  'pit-scout-photos',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'pit_scout_photos_select'
  ) THEN
    EXECUTE 'CREATE POLICY pit_scout_photos_select ON storage.objects FOR SELECT USING (bucket_id = ''pit-scout-photos'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'pit_scout_photos_insert'
  ) THEN
    EXECUTE 'CREATE POLICY pit_scout_photos_insert ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''pit-scout-photos'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'pit_scout_photos_update'
  ) THEN
    EXECUTE 'CREATE POLICY pit_scout_photos_update ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''pit-scout-photos'') WITH CHECK (bucket_id = ''pit-scout-photos'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'pit_scout_photos_delete'
  ) THEN
    EXECUTE 'CREATE POLICY pit_scout_photos_delete ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''pit-scout-photos'')';
  END IF;
END $$;
