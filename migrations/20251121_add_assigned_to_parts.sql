ALTER TABLE public.parts
ADD COLUMN IF NOT EXISTS assigned_to uuid REFERENCES public.user_profiles(id);
