CREATE TABLE IF NOT EXISTS public.planner_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  kind text NOT NULL CHECK (kind IN ('task', 'milestone')),
  title text NOT NULL,
  notes text,
  category text CHECK (category IS NULL OR category IN ('assembly', 'electrical', 'software', 'manufacturing', 'cad')),
  status text NOT NULL DEFAULT 'green' CHECK (status IN ('green', 'yellow', 'red')),
  critical_level integer NOT NULL DEFAULT 3 CHECK (critical_level BETWEEN 1 AND 4),
  duration_minutes integer CHECK (duration_minutes IS NULL OR duration_minutes > 0),
  min_duration_minutes integer NOT NULL DEFAULT 30 CHECK (min_duration_minutes > 0),
  manual_override boolean NOT NULL DEFAULT false,
  manual_start_at timestamptz,
  scheduled_start_at timestamptz,
  scheduled_end_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_planner_items_team_sort ON public.planner_items (frc_team, sort_order, created_at);
CREATE INDEX IF NOT EXISTS idx_planner_items_schedule ON public.planner_items (frc_team, scheduled_start_at, scheduled_end_at);

CREATE TABLE IF NOT EXISTS public.planner_item_owners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  planner_item_id uuid NOT NULL REFERENCES public.planner_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  owner_type text NOT NULL CHECK (owner_type IN ('owner', 'accountable')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planner_item_id, user_id, owner_type)
);

CREATE INDEX IF NOT EXISTS idx_planner_item_owners_item ON public.planner_item_owners (planner_item_id);
CREATE INDEX IF NOT EXISTS idx_planner_item_owners_user ON public.planner_item_owners (user_id);

CREATE TABLE IF NOT EXISTS public.planner_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  predecessor_item_id uuid NOT NULL REFERENCES public.planner_items(id) ON DELETE CASCADE,
  successor_item_id uuid NOT NULL REFERENCES public.planner_items(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (predecessor_item_id <> successor_item_id),
  UNIQUE (predecessor_item_id, successor_item_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_dependencies_successor ON public.planner_dependencies (successor_item_id);
CREATE INDEX IF NOT EXISTS idx_planner_dependencies_predecessor ON public.planner_dependencies (predecessor_item_id);

CREATE TABLE IF NOT EXISTS public.planner_calendar_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  rule_type text NOT NULL CHECK (rule_type IN ('work_window', 'blocked')),
  label text NOT NULL,
  weekday integer CHECK (weekday IS NULL OR weekday BETWEEN 0 AND 6),
  specific_date date,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  is_default boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (weekday IS NOT NULL OR specific_date IS NOT NULL),
  CHECK (starts_at < ends_at)
);

CREATE INDEX IF NOT EXISTS idx_planner_calendar_rules_team ON public.planner_calendar_rules (frc_team, rule_type, weekday, specific_date);

CREATE TABLE IF NOT EXISTS public.planner_slack_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  planner_item_id uuid NOT NULL REFERENCES public.planner_items(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  checkpoint text NOT NULL CHECK (checkpoint IN ('start', 'midpoint', 'end')),
  scheduled_for timestamptz NOT NULL,
  sent_at timestamptz,
  slack_channel text,
  slack_ts text,
  responded_status text CHECK (responded_status IS NULL OR responded_status IN ('green', 'yellow', 'red')),
  responded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planner_item_id, owner_id, checkpoint)
);

CREATE INDEX IF NOT EXISTS idx_planner_slack_prompts_due ON public.planner_slack_prompts (scheduled_for, sent_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_slack_prompts_message ON public.planner_slack_prompts (slack_channel, slack_ts) WHERE slack_channel IS NOT NULL AND slack_ts IS NOT NULL;

CREATE OR REPLACE FUNCTION public.planner_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_planner_items_set_updated_at ON public.planner_items;
CREATE TRIGGER trg_planner_items_set_updated_at
BEFORE UPDATE ON public.planner_items
FOR EACH ROW
EXECUTE FUNCTION public.planner_set_updated_at();

DROP TRIGGER IF EXISTS trg_planner_calendar_rules_set_updated_at ON public.planner_calendar_rules;
CREATE TRIGGER trg_planner_calendar_rules_set_updated_at
BEFORE UPDATE ON public.planner_calendar_rules
FOR EACH ROW
EXECUTE FUNCTION public.planner_set_updated_at();

DROP TRIGGER IF EXISTS trg_planner_slack_prompts_set_updated_at ON public.planner_slack_prompts;
CREATE TRIGGER trg_planner_slack_prompts_set_updated_at
BEFORE UPDATE ON public.planner_slack_prompts
FOR EACH ROW
EXECUTE FUNCTION public.planner_set_updated_at();

ALTER TABLE public.planner_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_item_owners ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_calendar_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.planner_slack_prompts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_item_owners TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_dependencies TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_calendar_rules TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_slack_prompts TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_items TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_item_owners TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_dependencies TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_calendar_rules TO service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_slack_prompts TO service_role;

DROP POLICY IF EXISTS planner_items_select_team ON public.planner_items;
CREATE POLICY planner_items_select_team
ON public.planner_items
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_items.frc_team
  )
);

DROP POLICY IF EXISTS planner_items_insert_team ON public.planner_items;
CREATE POLICY planner_items_insert_team
ON public.planner_items
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_items.frc_team
  )
);

DROP POLICY IF EXISTS planner_items_update_team ON public.planner_items;
CREATE POLICY planner_items_update_team
ON public.planner_items
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_items.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_items.frc_team
  )
);

DROP POLICY IF EXISTS planner_items_delete_team ON public.planner_items;
CREATE POLICY planner_items_delete_team
ON public.planner_items
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_items.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_owners_select_team ON public.planner_item_owners;
CREATE POLICY planner_item_owners_select_team
ON public.planner_item_owners
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_owners.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_owners_insert_team ON public.planner_item_owners;
CREATE POLICY planner_item_owners_insert_team
ON public.planner_item_owners
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_owners.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_owners_update_team ON public.planner_item_owners;
CREATE POLICY planner_item_owners_update_team
ON public.planner_item_owners
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_owners.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_owners.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_owners_delete_team ON public.planner_item_owners;
CREATE POLICY planner_item_owners_delete_team
ON public.planner_item_owners
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_owners.frc_team
  )
);

DROP POLICY IF EXISTS planner_dependencies_select_team ON public.planner_dependencies;
CREATE POLICY planner_dependencies_select_team
ON public.planner_dependencies
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_dependencies.frc_team
  )
);

DROP POLICY IF EXISTS planner_dependencies_insert_team ON public.planner_dependencies;
CREATE POLICY planner_dependencies_insert_team
ON public.planner_dependencies
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_dependencies.frc_team
  )
);

DROP POLICY IF EXISTS planner_dependencies_delete_team ON public.planner_dependencies;
CREATE POLICY planner_dependencies_delete_team
ON public.planner_dependencies
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_dependencies.frc_team
  )
);

DROP POLICY IF EXISTS planner_calendar_rules_select_team ON public.planner_calendar_rules;
CREATE POLICY planner_calendar_rules_select_team
ON public.planner_calendar_rules
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rules.frc_team
  )
);

DROP POLICY IF EXISTS planner_calendar_rules_insert_team ON public.planner_calendar_rules;
CREATE POLICY planner_calendar_rules_insert_team
ON public.planner_calendar_rules
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rules.frc_team
  )
);

DROP POLICY IF EXISTS planner_calendar_rules_update_team ON public.planner_calendar_rules;
CREATE POLICY planner_calendar_rules_update_team
ON public.planner_calendar_rules
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rules.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rules.frc_team
  )
);

DROP POLICY IF EXISTS planner_calendar_rules_delete_team ON public.planner_calendar_rules;
CREATE POLICY planner_calendar_rules_delete_team
ON public.planner_calendar_rules
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_calendar_rules.frc_team
  )
);

DROP POLICY IF EXISTS planner_slack_prompts_select_team ON public.planner_slack_prompts;
CREATE POLICY planner_slack_prompts_select_team
ON public.planner_slack_prompts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_slack_prompts.frc_team
  )
);

DROP POLICY IF EXISTS planner_slack_prompts_insert_team ON public.planner_slack_prompts;
CREATE POLICY planner_slack_prompts_insert_team
ON public.planner_slack_prompts
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_slack_prompts.frc_team
  )
);

DROP POLICY IF EXISTS planner_slack_prompts_update_team ON public.planner_slack_prompts;
CREATE POLICY planner_slack_prompts_update_team
ON public.planner_slack_prompts
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_slack_prompts.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_slack_prompts.frc_team
  )
);

WITH default_rules (weekday, starts_at, ends_at, label) AS (
  VALUES
    (3, '16:00'::time, '21:30'::time, 'Wednesday Work Window'),
    (4, '16:00'::time, '21:30'::time, 'Thursday Work Window'),
    (5, '15:00'::time, '23:00'::time, 'Friday Work Window'),
    (6, '12:00'::time, '23:00'::time, 'Saturday Work Window'),
    (0, '12:00'::time, '21:30'::time, 'Sunday Work Window')
),
teams (frc_team) AS (
  VALUES ('971'), ('9584')
)
INSERT INTO public.planner_calendar_rules (
  frc_team,
  rule_type,
  label,
  weekday,
  starts_at,
  ends_at,
  enabled,
  is_default
)
SELECT
  teams.frc_team,
  'work_window',
  default_rules.label,
  default_rules.weekday,
  default_rules.starts_at,
  default_rules.ends_at,
  true,
  true
FROM teams
CROSS JOIN default_rules
WHERE NOT EXISTS (
  SELECT 1
  FROM public.planner_calendar_rules existing
  WHERE existing.frc_team = teams.frc_team
    AND existing.rule_type = 'work_window'
    AND existing.weekday = default_rules.weekday
    AND existing.starts_at = default_rules.starts_at
    AND existing.ends_at = default_rules.ends_at
    AND existing.specific_date IS NULL
);
