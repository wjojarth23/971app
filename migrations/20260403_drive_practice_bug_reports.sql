CREATE TABLE IF NOT EXISTS public.planner_drive_practice_bug_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  planner_item_id uuid NOT NULL REFERENCES public.planner_items(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  report_area text NOT NULL CHECK (report_area IN ('vision', 'software', 'electrical', 'mechanical', 'brownout')),
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planner_item_id, task_id, report_area)
);

CREATE INDEX IF NOT EXISTS idx_drive_practice_bug_reports_item
  ON public.planner_drive_practice_bug_reports (planner_item_id);

CREATE INDEX IF NOT EXISTS idx_drive_practice_bug_reports_task
  ON public.planner_drive_practice_bug_reports (task_id);

ALTER TABLE public.planner_drive_practice_bug_reports ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_drive_practice_bug_reports TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_drive_practice_bug_reports TO service_role;

DROP POLICY IF EXISTS planner_drive_practice_bug_reports_select_team ON public.planner_drive_practice_bug_reports;
CREATE POLICY planner_drive_practice_bug_reports_select_team
ON public.planner_drive_practice_bug_reports
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_drive_practice_bug_reports.frc_team
  )
);

DROP POLICY IF EXISTS planner_drive_practice_bug_reports_insert_team ON public.planner_drive_practice_bug_reports;
CREATE POLICY planner_drive_practice_bug_reports_insert_team
ON public.planner_drive_practice_bug_reports
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_drive_practice_bug_reports.frc_team
  )
);

DROP POLICY IF EXISTS planner_drive_practice_bug_reports_update_team ON public.planner_drive_practice_bug_reports;
CREATE POLICY planner_drive_practice_bug_reports_update_team
ON public.planner_drive_practice_bug_reports
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_drive_practice_bug_reports.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_drive_practice_bug_reports.frc_team
  )
);

DROP POLICY IF EXISTS planner_drive_practice_bug_reports_delete_team ON public.planner_drive_practice_bug_reports;
CREATE POLICY planner_drive_practice_bug_reports_delete_team
ON public.planner_drive_practice_bug_reports
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_drive_practice_bug_reports.frc_team
  )
);
