ALTER TABLE public.planner_calendar_rules
  DROP CONSTRAINT IF EXISTS planner_calendar_rules_rule_type_check;

ALTER TABLE public.planner_calendar_rules
  ADD CONSTRAINT planner_calendar_rules_rule_type_check
  CHECK (rule_type IN ('work_window', 'blocked', 'drive_practice'));

CREATE TABLE IF NOT EXISTS public.planner_calendar_rule_recipients (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  planner_calendar_rule_id uuid NOT NULL REFERENCES public.planner_calendar_rules(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planner_calendar_rule_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_calendar_rule_recipients_rule
  ON public.planner_calendar_rule_recipients (planner_calendar_rule_id);

CREATE INDEX IF NOT EXISTS idx_planner_calendar_rule_recipients_user
  ON public.planner_calendar_rule_recipients (user_id);

CREATE TABLE IF NOT EXISTS public.planner_drive_practice_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  planner_calendar_rule_id uuid NOT NULL REFERENCES public.planner_calendar_rules(id) ON DELETE CASCADE,
  recipient_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  slack_channel text,
  slack_ts text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planner_calendar_rule_id, recipient_id, scheduled_for)
);

CREATE INDEX IF NOT EXISTS idx_planner_drive_practice_prompts_due
  ON public.planner_drive_practice_prompts (scheduled_for, sent_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_drive_practice_prompts_message
  ON public.planner_drive_practice_prompts (slack_channel, slack_ts)
  WHERE slack_channel IS NOT NULL AND slack_ts IS NOT NULL;

DROP TRIGGER IF EXISTS trg_planner_drive_practice_prompts_set_updated_at ON public.planner_drive_practice_prompts;
CREATE TRIGGER trg_planner_drive_practice_prompts_set_updated_at
BEFORE UPDATE ON public.planner_drive_practice_prompts
FOR EACH ROW
EXECUTE FUNCTION public.planner_set_updated_at();

ALTER TABLE public.planner_calendar_rule_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_drive_practice_prompts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_calendar_rule_recipients TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_calendar_rule_recipients TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_drive_practice_prompts TO service_role;

DROP POLICY IF EXISTS planner_calendar_rule_recipients_select_team ON public.planner_calendar_rule_recipients;
CREATE POLICY planner_calendar_rule_recipients_select_team
ON public.planner_calendar_rule_recipients
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rule_recipients.frc_team
  )
);

DROP POLICY IF EXISTS planner_calendar_rule_recipients_insert_team ON public.planner_calendar_rule_recipients;
CREATE POLICY planner_calendar_rule_recipients_insert_team
ON public.planner_calendar_rule_recipients
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rule_recipients.frc_team
  )
);

DROP POLICY IF EXISTS planner_calendar_rule_recipients_update_team ON public.planner_calendar_rule_recipients;
CREATE POLICY planner_calendar_rule_recipients_update_team
ON public.planner_calendar_rule_recipients
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rule_recipients.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rule_recipients.frc_team
  )
);

DROP POLICY IF EXISTS planner_calendar_rule_recipients_delete_team ON public.planner_calendar_rule_recipients;
CREATE POLICY planner_calendar_rule_recipients_delete_team
ON public.planner_calendar_rule_recipients
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rule_recipients.frc_team
  )
);
