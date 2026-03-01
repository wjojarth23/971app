ALTER TABLE public.scouting_settings
ADD COLUMN IF NOT EXISTS smart_fuel_algorithm_enabled boolean NOT NULL DEFAULT false;
