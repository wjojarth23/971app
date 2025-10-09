-- Data scouting events table
CREATE TABLE IF NOT EXISTS public.scout_data_events (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  match_key text NOT NULL,
  match_number integer,
  team_key text NOT NULL,
  phase text, -- pre, auto, teleop, endgame, finished
  event_type text NOT NULL, -- coral_place, coral_intake, algae_acquire, algae_score, defense_start, defense_end, break, fix, foul_major, foul_minor, phase, endgame_selection
  event_value text, -- e.g. L3_hit, L2_miss, hp, ground, processor, barge, begin_auto
  coral_in_robot boolean,
  algae_in_robot boolean,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scout_data_events_pkey PRIMARY KEY (id)
);

CREATE INDEX IF NOT EXISTS scout_data_events_team_idx ON public.scout_data_events(team_key);
CREATE INDEX IF NOT EXISTS scout_data_events_match_idx ON public.scout_data_events(match_key);
