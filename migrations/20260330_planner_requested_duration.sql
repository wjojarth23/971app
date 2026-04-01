ALTER TABLE public.planner_items
ADD COLUMN IF NOT EXISTS requested_duration_minutes integer
CHECK (requested_duration_minutes IS NULL OR requested_duration_minutes > 0);

UPDATE public.planner_items
SET requested_duration_minutes = duration_minutes
WHERE kind = 'task'
  AND requested_duration_minutes IS NULL;
