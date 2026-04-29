BEGIN;

ALTER TABLE public.planner_items
  ADD COLUMN IF NOT EXISTS item_type text,
  ADD COLUMN IF NOT EXISTS details text,
  ADD COLUMN IF NOT EXISTS work_category text,
  ADD COLUMN IF NOT EXISTS scope text,
  ADD COLUMN IF NOT EXISTS general_type text,
  ADD COLUMN IF NOT EXISTS subsystem_id uuid REFERENCES public.subsystems(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS needs_manufacturing boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachment_path text,
  ADD COLUMN IF NOT EXISTS attachment_name text,
  ADD COLUMN IF NOT EXISTS attachment_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS auto_completed_from_parts boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS state_before_auto_complete text;

UPDATE public.planner_items
SET details = notes
WHERE details IS NULL
  AND notes IS NOT NULL;

UPDATE public.planner_items
SET work_category = CASE
  WHEN category IN ('assembly', 'electrical', 'software', 'manufacturing', 'cad') THEN category
  ELSE NULL
END
WHERE work_category IS NULL;

UPDATE public.planner_items
SET item_type = CASE
  WHEN kind = 'milestone' THEN 'milestone'
  WHEN kind = 'task' AND task_mode = 'fixing' THEN 'fixing_block'
  WHEN kind = 'task' AND category = 'drive_practice' THEN 'drive_practice_session'
  ELSE 'task'
END
WHERE item_type IS NULL;

ALTER TABLE public.planner_items
  ALTER COLUMN item_type SET DEFAULT 'task';

ALTER TABLE public.planner_items
  ALTER COLUMN item_type SET NOT NULL;

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_item_type_check;

ALTER TABLE public.planner_items
  ADD CONSTRAINT planner_items_item_type_check
  CHECK (item_type IN ('task', 'milestone', 'drive_practice_session', 'p0_bug', 'fixing_block'));

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_work_category_check;

ALTER TABLE public.planner_items
  ADD CONSTRAINT planner_items_work_category_check
  CHECK (work_category IS NULL OR work_category IN ('assembly', 'electrical', 'software', 'manufacturing', 'cad'));

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_scope_check;

ALTER TABLE public.planner_items
  ADD CONSTRAINT planner_items_scope_check
  CHECK (scope IS NULL OR scope IN ('general', 'subsystem'));

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_general_type_check;

ALTER TABLE public.planner_items
  ADD CONSTRAINT planner_items_general_type_check
  CHECK (general_type IS NULL OR general_type IN ('CAD', 'Mechanical', 'Electrical', 'Software', 'Other'));

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_state_before_auto_complete_check;

ALTER TABLE public.planner_items
  ADD CONSTRAINT planner_items_state_before_auto_complete_check
  CHECK (state_before_auto_complete IS NULL OR state_before_auto_complete IN ('not_started', 'green', 'yellow', 'red', 'completed'));

CREATE TABLE IF NOT EXISTS public.planner_item_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  planner_item_id uuid NOT NULL REFERENCES public.planner_items(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planner_item_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_item_people_item
  ON public.planner_item_people (planner_item_id);

CREATE INDEX IF NOT EXISTS idx_planner_item_people_user
  ON public.planner_item_people (user_id);

ALTER TABLE public.planner_item_people ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_item_people TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_item_people TO service_role;

DROP POLICY IF EXISTS planner_item_people_select_team ON public.planner_item_people;
CREATE POLICY planner_item_people_select_team
ON public.planner_item_people
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_people.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_people_insert_team ON public.planner_item_people;
CREATE POLICY planner_item_people_insert_team
ON public.planner_item_people
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_people.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_people_update_team ON public.planner_item_people;
CREATE POLICY planner_item_people_update_team
ON public.planner_item_people
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_people.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_people.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_people_delete_team ON public.planner_item_people;
CREATE POLICY planner_item_people_delete_team
ON public.planner_item_people
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_people.frc_team
  )
);

INSERT INTO public.planner_item_people (frc_team, planner_item_id, user_id, created_at)
SELECT
  frc_team,
  planner_item_id,
  user_id,
  MIN(created_at) AS created_at
FROM public.planner_item_owners
GROUP BY frc_team, planner_item_id, user_id
ON CONFLICT (planner_item_id, user_id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.planner_item_parts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  planner_item_id uuid NOT NULL REFERENCES public.planner_items(id) ON DELETE CASCADE,
  part_id bigint NOT NULL REFERENCES public.parts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (planner_item_id, part_id),
  UNIQUE (part_id)
);

CREATE INDEX IF NOT EXISTS idx_planner_item_parts_item
  ON public.planner_item_parts (planner_item_id);

CREATE INDEX IF NOT EXISTS idx_planner_item_parts_part
  ON public.planner_item_parts (part_id);

ALTER TABLE public.planner_item_parts ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_item_parts TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.planner_item_parts TO service_role;

DROP POLICY IF EXISTS planner_item_parts_select_team ON public.planner_item_parts;
CREATE POLICY planner_item_parts_select_team
ON public.planner_item_parts
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_parts.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_parts_insert_team ON public.planner_item_parts;
CREATE POLICY planner_item_parts_insert_team
ON public.planner_item_parts
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_parts.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_parts_update_team ON public.planner_item_parts;
CREATE POLICY planner_item_parts_update_team
ON public.planner_item_parts
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_parts.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_parts.frc_team
  )
);

DROP POLICY IF EXISTS planner_item_parts_delete_team ON public.planner_item_parts;
CREATE POLICY planner_item_parts_delete_team
ON public.planner_item_parts
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = planner_item_parts.frc_team
  )
);

CREATE TEMP TABLE task_item_migration_map (
  task_id uuid PRIMARY KEY,
  planner_item_id uuid NOT NULL UNIQUE
) ON COMMIT DROP;

INSERT INTO task_item_migration_map (task_id, planner_item_id)
SELECT
  t.id,
  CASE
    WHEN EXISTS (SELECT 1 FROM public.planner_items pi WHERE pi.id = t.id) THEN gen_random_uuid()
    ELSE t.id
  END AS planner_item_id
FROM public.tasks t;

WITH max_sort AS (
  SELECT COALESCE(MAX(sort_order), 0) AS value
  FROM public.planner_items
),
ordered_tasks AS (
  SELECT
    t.*,
    map.planner_item_id,
    ROW_NUMBER() OVER (ORDER BY t.created_at, t.id) AS ordinal
  FROM public.tasks t
  INNER JOIN task_item_migration_map map
    ON map.task_id = t.id
)
INSERT INTO public.planner_items (
  id,
  frc_team,
  item_type,
  title,
  details,
  work_category,
  status,
  critical_level,
  duration_minutes,
  requested_duration_minutes,
  min_duration_minutes,
  manual_start_at,
  scheduled_start_at,
  scheduled_end_at,
  sort_order,
  created_by,
  created_at,
  updated_at,
  scope,
  general_type,
  subsystem_id,
  needs_manufacturing,
  attachment_path,
  attachment_name,
  attachment_uploaded_at
)
SELECT
  ordered_tasks.planner_item_id,
  ordered_tasks.frc_team,
  'p0_bug',
  ordered_tasks.title,
  ordered_tasks.description,
  NULL,
  CASE ordered_tasks.status
    WHEN 'open' THEN 'red'
    WHEN 'in_progress' THEN 'yellow'
    WHEN 'file_uploaded' THEN 'yellow'
    WHEN 'under_review' THEN 'yellow'
    WHEN 'changes_requested' THEN 'red'
    WHEN 'approved' THEN 'green'
    WHEN 'done' THEN 'completed'
    WHEN 'closed' THEN 'completed'
    ELSE 'red'
  END,
  1,
  120,
  120,
  30,
  NULL,
  NULL,
  NULL,
  max_sort.value + (ordered_tasks.ordinal * 1000),
  ordered_tasks.created_by,
  ordered_tasks.created_at,
  ordered_tasks.updated_at,
  ordered_tasks.scope,
  ordered_tasks.general_type,
  ordered_tasks.subsystem_id,
  ordered_tasks.needs_manufacturing,
  ordered_tasks.attachment_path,
  ordered_tasks.attachment_name,
  ordered_tasks.attachment_uploaded_at
FROM ordered_tasks
CROSS JOIN max_sort;

INSERT INTO public.planner_item_people (frc_team, planner_item_id, user_id, created_at)
SELECT
  t.frc_team,
  map.planner_item_id,
  COALESCE(t.assignee_id, t.created_by),
  t.created_at
FROM public.tasks t
INNER JOIN task_item_migration_map map
  ON map.task_id = t.id
WHERE COALESCE(t.assignee_id, t.created_by) IS NOT NULL
ON CONFLICT (planner_item_id, user_id) DO NOTHING;

INSERT INTO public.planner_item_parts (frc_team, planner_item_id, part_id, created_at)
SELECT
  t.frc_team,
  map.planner_item_id,
  t.parts_id,
  t.created_at
FROM public.tasks t
INNER JOIN task_item_migration_map map
  ON map.task_id = t.id
WHERE t.parts_id IS NOT NULL
ON CONFLICT (part_id) DO NOTHING;

ALTER TABLE public.planner_item_p0_bugs
  DROP CONSTRAINT IF EXISTS planner_item_p0_bugs_planner_item_id_task_id_key;

ALTER TABLE public.planner_item_p0_bugs
  DROP CONSTRAINT IF EXISTS planner_item_p0_bugs_task_id_fkey;

ALTER TABLE public.planner_item_p0_bugs
  RENAME COLUMN task_id TO p0_bug_item_id;

ALTER TABLE public.planner_item_p0_bugs
  ADD COLUMN IF NOT EXISTS report_area text;

UPDATE public.planner_item_p0_bugs link
SET p0_bug_item_id = map.planner_item_id
FROM task_item_migration_map map
WHERE link.p0_bug_item_id = map.task_id;

DO $$
BEGIN
  IF to_regclass('public.planner_drive_practice_bug_reports') IS NOT NULL THEN
    INSERT INTO public.planner_item_p0_bugs (
      frc_team,
      planner_item_id,
      p0_bug_item_id,
      report_area,
      created_by,
      created_at
    )
    SELECT
      reports.frc_team,
      reports.planner_item_id,
      map.planner_item_id,
      reports.report_area,
      reports.created_by,
      reports.created_at
    FROM public.planner_drive_practice_bug_reports reports
    INNER JOIN task_item_migration_map map
      ON map.task_id = reports.task_id
    ON CONFLICT DO NOTHING;
  END IF;
END $$;

ALTER TABLE public.planner_item_p0_bugs
  DROP CONSTRAINT IF EXISTS planner_item_p0_bugs_report_area_check;

ALTER TABLE public.planner_item_p0_bugs
  ADD CONSTRAINT planner_item_p0_bugs_report_area_check
  CHECK (report_area IS NULL OR report_area IN ('vision', 'software', 'electrical', 'mechanical', 'brownout'));

ALTER TABLE public.planner_item_p0_bugs
  ADD CONSTRAINT planner_item_p0_bugs_p0_bug_item_id_fkey
  FOREIGN KEY (p0_bug_item_id) REFERENCES public.planner_items(id) ON DELETE CASCADE;

DROP INDEX IF EXISTS idx_planner_item_p0_bugs_task;

CREATE INDEX IF NOT EXISTS idx_planner_item_p0_bugs_p0_bug
  ON public.planner_item_p0_bugs (p0_bug_item_id);

CREATE INDEX IF NOT EXISTS idx_planner_item_p0_bugs_report_area
  ON public.planner_item_p0_bugs (report_area);

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_item_p0_bugs_fixing_unique
  ON public.planner_item_p0_bugs (planner_item_id, p0_bug_item_id)
  WHERE report_area IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_planner_item_p0_bugs_report_unique
  ON public.planner_item_p0_bugs (planner_item_id, p0_bug_item_id, report_area)
  WHERE report_area IS NOT NULL;

CREATE OR REPLACE FUNCTION public.planner_sync_task_completion_from_parts(p_planner_item_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  item_row public.planner_items%ROWTYPE;
  linked_part_count integer := 0;
  completed_part_count integer := 0;
BEGIN
  IF p_planner_item_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
  INTO item_row
  FROM public.planner_items
  WHERE id = p_planner_item_id;

  IF NOT FOUND OR item_row.item_type <> 'task' THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE parts.status IN ('complete', 'delivered', 'kitted'))
  INTO linked_part_count, completed_part_count
  FROM public.planner_item_parts item_parts
  INNER JOIN public.parts
    ON parts.id = item_parts.part_id
  WHERE item_parts.planner_item_id = p_planner_item_id;

  IF linked_part_count > 0 AND linked_part_count = completed_part_count THEN
    UPDATE public.planner_items
    SET
      state_before_auto_complete = CASE
        WHEN auto_completed_from_parts AND status = 'completed' THEN state_before_auto_complete
        WHEN status = 'completed' THEN COALESCE(state_before_auto_complete, 'not_started')
        ELSE status
      END,
      status = 'completed',
      auto_completed_from_parts = true
    WHERE id = p_planner_item_id
      AND item_type = 'task'
      AND (
        status <> 'completed'
        OR auto_completed_from_parts IS DISTINCT FROM true
        OR state_before_auto_complete IS NULL
      );
  ELSE
    UPDATE public.planner_items
    SET
      status = COALESCE(state_before_auto_complete, 'not_started'),
      auto_completed_from_parts = false,
      state_before_auto_complete = NULL
    WHERE id = p_planner_item_id
      AND item_type = 'task'
      AND auto_completed_from_parts = true;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.planner_item_parts_sync_completion()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM public.planner_sync_task_completion_from_parts(COALESCE(NEW.planner_item_id, OLD.planner_item_id));

  IF TG_OP = 'UPDATE'
     AND NEW.planner_item_id IS DISTINCT FROM OLD.planner_item_id
     AND OLD.planner_item_id IS NOT NULL THEN
    PERFORM public.planner_sync_task_completion_from_parts(OLD.planner_item_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_planner_item_parts_sync_completion ON public.planner_item_parts;
CREATE TRIGGER trg_planner_item_parts_sync_completion
AFTER INSERT OR UPDATE OR DELETE ON public.planner_item_parts
FOR EACH ROW
EXECUTE FUNCTION public.planner_item_parts_sync_completion();

CREATE OR REPLACE FUNCTION public.parts_sync_linked_planner_tasks()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  linked_item_id uuid;
BEGIN
  FOR linked_item_id IN
    SELECT planner_item_id
    FROM public.planner_item_parts
    WHERE part_id = COALESCE(NEW.id, OLD.id)
  LOOP
    PERFORM public.planner_sync_task_completion_from_parts(linked_item_id);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_parts_sync_linked_planner_tasks ON public.parts;
CREATE TRIGGER trg_parts_sync_linked_planner_tasks
AFTER UPDATE OF status ON public.parts
FOR EACH ROW
WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.parts_sync_linked_planner_tasks();

DO $$
DECLARE
  linked_item_id uuid;
BEGIN
  FOR linked_item_id IN
    SELECT DISTINCT planner_item_id
    FROM public.planner_item_parts
  LOOP
    PERFORM public.planner_sync_task_completion_from_parts(linked_item_id);
  END LOOP;
END $$;

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_kind_check;

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_task_mode_check;

ALTER TABLE public.planner_items
  DROP CONSTRAINT IF EXISTS planner_items_category_check;

ALTER TABLE public.planner_items
  DROP COLUMN IF EXISTS kind,
  DROP COLUMN IF EXISTS task_mode,
  DROP COLUMN IF EXISTS notes,
  DROP COLUMN IF EXISTS category;

DROP TABLE IF EXISTS public.planner_drive_practice_bug_reports;
DROP TABLE IF EXISTS public.planner_item_owners;
DROP TABLE IF EXISTS public.tasks;

COMMIT;
