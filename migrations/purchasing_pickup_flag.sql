ALTER TABLE public.purchasing
ADD COLUMN IF NOT EXISTS is_pickup boolean NOT NULL DEFAULT false;
