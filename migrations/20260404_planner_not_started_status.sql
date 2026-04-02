ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_status_check;

ALTER TABLE public.planner_items
  ALTER COLUMN status SET DEFAULT 'not_started';

ALTER TABLE public.planner_items
  ADD CONSTRAINT planner_items_status_check
  CHECK (status IN ('not_started', 'green', 'yellow', 'red', 'completed'));

ALTER TABLE public.planner_slack_prompts
  DROP CONSTRAINT IF EXISTS planner_slack_prompts_responded_status_check;

ALTER TABLE public.planner_slack_prompts
  ADD CONSTRAINT planner_slack_prompts_responded_status_check
  CHECK (responded_status IS NULL OR responded_status IN ('green', 'yellow', 'red', 'completed'));
