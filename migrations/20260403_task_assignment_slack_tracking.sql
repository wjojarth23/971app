ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS assignment_slack_channel text,
  ADD COLUMN IF NOT EXISTS assignment_slack_ts text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_assignment_slack_message
  ON public.tasks (assignment_slack_channel, assignment_slack_ts)
  WHERE assignment_slack_channel IS NOT NULL AND assignment_slack_ts IS NOT NULL;
