-- Secret post-match multi-view computer-vision scouting system.
-- Raw video stays in a private bucket; only explicitly authorized reviewers
-- can read or mutate metadata. ML runners use service_role through a
-- server-side claim/complete API and never receive database credentials.

CREATE TABLE IF NOT EXISTS public.vision_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_key text NOT NULL,
  match_key text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','queued','processing','review','complete','failed')),
  capture_notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (match_key)
);

CREATE TABLE IF NOT EXISTS public.vision_views (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vision_match_id uuid NOT NULL REFERENCES public.vision_matches(id) ON DELETE CASCADE,
  label text NOT NULL,
  storage_path text NOT NULL,
  camera_position text,
  frame_rate numeric,
  width integer,
  height integer,
  sync_offset_ms integer NOT NULL DEFAULT 0,
  homography jsonb,
  calibration_points jsonb NOT NULL DEFAULT '[]'::jsonb,
  calibration_confidence numeric CHECK (calibration_confidence IS NULL OR calibration_confidence BETWEEN 0 AND 1),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vision_match_id uuid NOT NULL REFERENCES public.vision_matches(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','claimed','processing','complete','failed','cancelled')),
  model_name text NOT NULL,
  model_version text NOT NULL,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  claimed_by text,
  claimed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  error text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vision_run_id uuid NOT NULL REFERENCES public.vision_runs(id) ON DELETE CASCADE,
  view_id uuid REFERENCES public.vision_views(id) ON DELETE SET NULL,
  team_key text,
  alliance text CHECK (alliance IS NULL OR alliance IN ('red','blue')),
  started_ms integer NOT NULL,
  ended_ms integer NOT NULL,
  identity_confidence numeric NOT NULL DEFAULT 0 CHECK (identity_confidence BETWEEN 0 AND 1),
  tracking_confidence numeric NOT NULL DEFAULT 0 CHECK (tracking_confidence BETWEEN 0 AND 1),
  trajectory jsonb NOT NULL DEFAULT '[]'::jsonb,
  metrics jsonb NOT NULL DEFAULT '{}'::jsonb,
  needs_review boolean NOT NULL DEFAULT false
);

CREATE TABLE IF NOT EXISTS public.vision_observations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vision_run_id uuid NOT NULL REFERENCES public.vision_runs(id) ON DELETE CASCADE,
  view_id uuid REFERENCES public.vision_views(id) ON DELETE SET NULL,
  track_id uuid REFERENCES public.vision_tracks(id) ON DELETE SET NULL,
  team_key text,
  alliance text CHECK (alliance IS NULL OR alliance IN ('red','blue')),
  phase text CHECK (phase IS NULL OR phase IN ('auto','teleop','endgame')),
  observation_type text NOT NULL CHECK (observation_type IN ('fuel_attempt','fuel_scored','climb_attempt','climb_success','mobility','disabled','identity')),
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_ms integer NOT NULL,
  ended_ms integer NOT NULL,
  confidence numeric NOT NULL CHECK (confidence BETWEEN 0 AND 1),
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  model_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_discrepancies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vision_run_id uuid NOT NULL REFERENCES public.vision_runs(id) ON DELETE CASCADE,
  team_key text,
  alliance text,
  metric text NOT NULL,
  vision_value jsonb,
  reference_value jsonb,
  absolute_difference numeric,
  percent_difference numeric,
  severity text NOT NULL CHECK (severity IN ('info','warning','critical')),
  reason text NOT NULL,
  evidence jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','accepted_vision','accepted_reference','corrected','unobservable','dismissed')),
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vision_reference_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vision_run_id uuid NOT NULL REFERENCES public.vision_runs(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'tba',
  match_key text NOT NULL,
  payload jsonb NOT NULL,
  fetched_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (vision_run_id, source)
);

CREATE INDEX IF NOT EXISTS vision_matches_event_idx ON public.vision_matches(event_key, match_key);
CREATE INDEX IF NOT EXISTS vision_views_match_idx ON public.vision_views(vision_match_id);
CREATE INDEX IF NOT EXISTS vision_runs_queue_idx ON public.vision_runs(status, created_at);
CREATE INDEX IF NOT EXISTS vision_tracks_run_idx ON public.vision_tracks(vision_run_id, team_key);
CREATE INDEX IF NOT EXISTS vision_observations_run_idx ON public.vision_observations(vision_run_id, observation_type);
CREATE INDEX IF NOT EXISTS vision_discrepancies_review_idx ON public.vision_discrepancies(status, severity);
CREATE INDEX IF NOT EXISTS vision_reference_run_idx ON public.vision_reference_snapshots(vision_run_id);

INSERT INTO storage.buckets (id, name, public)
VALUES ('vision-recordings', 'vision-recordings', false)
ON CONFLICT (id) DO UPDATE SET public = false;

ALTER TABLE public.vision_matches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_views ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_tracks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_discrepancies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vision_reference_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['vision_matches','vision_views','vision_runs','vision_tracks','vision_observations','vision_discrepancies','vision_reference_snapshots']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS vision_secret_access ON public.%I', table_name);
    EXECUTE format('CREATE POLICY vision_secret_access ON public.%I TO authenticated USING (public.has_permission(''VISION_REVIEW'')) WITH CHECK (public.has_permission(''VISION_REVIEW''))', table_name);
    EXECUTE format('DROP POLICY IF EXISTS vision_service_access ON public.%I', table_name);
    EXECUTE format('CREATE POLICY vision_service_access ON public.%I TO service_role USING (true) WITH CHECK (true)', table_name);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated, service_role', table_name);
  END LOOP;
END $$;

DROP POLICY IF EXISTS vision_recordings_authenticated ON storage.objects;
CREATE POLICY vision_recordings_authenticated ON storage.objects TO authenticated
  USING (bucket_id = 'vision-recordings' AND public.has_permission('VISION_REVIEW'))
  WITH CHECK (bucket_id = 'vision-recordings' AND public.has_permission('VISION_REVIEW'));
