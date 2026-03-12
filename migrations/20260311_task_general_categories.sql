-- User self-signup categories for general tasks

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS task_general_categories text[] NOT NULL DEFAULT '{}'::text[];

ALTER TABLE public.user_profiles
  DROP CONSTRAINT IF EXISTS user_profiles_task_general_categories_check;

ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_task_general_categories_check
  CHECK (
    task_general_categories <@ ARRAY['CAD', 'Mechanical', 'Electrical', 'Software', 'Other']::text[]
  );
