-- Runtime scouting event setting (single-row table)

CREATE TABLE IF NOT EXISTS public.scouting_settings (
  id integer PRIMARY KEY,
  event_key text,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scouting_settings_single_row CHECK (id = 1)
);

INSERT INTO public.scouting_settings (id, event_key)
VALUES (1, NULL)
ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON TABLE public.scouting_settings TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.scouting_settings TO service_role;
