UPDATE public.planner_items
SET manual_override = false
WHERE manual_override IS TRUE;

UPDATE public.planner_slack_prompts
SET checkpoint = CASE checkpoint
  WHEN 'start' THEN 'task_start'
  WHEN 'midpoint' THEN 'session_midpoint'
  WHEN 'end' THEN 'task_end'
  ELSE checkpoint
END
WHERE checkpoint IN ('start', 'midpoint', 'end');

ALTER TABLE public.planner_slack_prompts
  DROP CONSTRAINT IF EXISTS planner_slack_prompts_checkpoint_check;

ALTER TABLE public.planner_slack_prompts
  DROP CONSTRAINT IF EXISTS planner_slack_prompts_planner_item_id_owner_id_checkpoint_key;

ALTER TABLE public.planner_slack_prompts
  DROP CONSTRAINT IF EXISTS planner_slack_prompts_planner_item_owner_checkpoint_scheduled_for_key;

ALTER TABLE public.planner_slack_prompts
  ADD CONSTRAINT planner_slack_prompts_checkpoint_check
  CHECK (checkpoint IN ('task_start', 'session_start', 'session_midpoint', 'session_end', 'task_end'));

ALTER TABLE public.planner_slack_prompts
  ADD CONSTRAINT planner_slack_prompts_planner_item_owner_checkpoint_scheduled_for_key
  UNIQUE (planner_item_id, owner_id, checkpoint, scheduled_for);
