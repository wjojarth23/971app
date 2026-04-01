ALTER TABLE public.planner_items
  ADD COLUMN IF NOT EXISTS task_mode text;

UPDATE public.planner_items
SET task_mode = 'standard'
WHERE task_mode IS NULL;

ALTER TABLE public.planner_items
  ALTER COLUMN task_mode SET DEFAULT 'standard';

ALTER TABLE public.planner_items
  ALTER COLUMN task_mode SET NOT NULL;

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_task_mode_check;

ALTER TABLE public.planner_items
  ADD CONSTRAINT planner_items_task_mode_check
  CHECK (task_mode IN ('standard', 'fixing'));

CREATE TABLE IF NOT EXISTS public.planner_item_p0_bugs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  planner_item_id uuid NOT NULL REFERENCES public.planner_items(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planner_item_id, task_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_item_p0_bugs_item
  ON public.planner_item_p0_bugs (planner_item_id);

CREATE INDEX IF NOT EXISTS idx_planner_item_p0_bugs_task
  ON public.planner_item_p0_bugs (task_id);

ALTER TABLE public.planner_item_p0_bugs ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_item_p0_bugs TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_item_p0_bugs TO service_role;

DROP POLICY IF EXISTS planner_item_p0_bugs_select_team ON public.planner_item_p0_bugs;
CREATE POLICY planner_item_p0_bugs_select_team
ON public.planner_item_p0_bugs
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_p0_bugs.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_p0_bugs_insert_team ON public.planner_item_p0_bugs;
CREATE POLICY planner_item_p0_bugs_insert_team
ON public.planner_item_p0_bugs
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_p0_bugs.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_p0_bugs_update_team ON public.planner_item_p0_bugs;
CREATE POLICY planner_item_p0_bugs_update_team
ON public.planner_item_p0_bugs
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_p0_bugs.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_p0_bugs.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_p0_bugs_delete_team ON public.planner_item_p0_bugs;
CREATE POLICY planner_item_p0_bugs_delete_team
ON public.planner_item_p0_bugs
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_p0_bugs.frc_team
  )
);
