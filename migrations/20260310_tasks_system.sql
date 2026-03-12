-- Tasks system for hub: team-scoped task tracking, review workflow, and attachments

CREATE TABLE IF NOT EXISTS public.tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  frc_team text NOT NULL CHECK (frc_team IN ('971', '9584')),
  title text NOT NULL,
  description text,
  scope text NOT NULL CHECK (scope IN ('general', 'subsystem')),
  general_type text CHECK (general_type IS NULL OR general_type IN ('CAD', 'Mechanical', 'Electrical', 'Software', 'Other')),
  subsystem_id uuid REFERENCES public.subsystems(id) ON DELETE SET NULL,
  assignee_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewer_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  needs_review boolean NOT NULL DEFAULT false,
  needs_manufacturing boolean NOT NULL DEFAULT false,
  deadline_at timestamptz,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'file_uploaded', 'under_review', 'changes_requested', 'approved', 'done', 'closed')),
  review_decision text CHECK (review_decision IS NULL OR review_decision IN ('approved', 'changes_requested')),
  review_notes text,
  reviewed_at timestamptz,
  attachment_path text,
  attachment_name text,
  attachment_uploaded_at timestamptz,
  parts_id bigint REFERENCES public.parts(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tasks_team_created_at ON public.tasks (frc_team, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee ON public.tasks (assignee_id);
CREATE INDEX IF NOT EXISTS idx_tasks_reviewer ON public.tasks (reviewer_id);
CREATE INDEX IF NOT EXISTS idx_tasks_deadline_status ON public.tasks (deadline_at, status);

CREATE OR REPLACE FUNCTION public.tasks_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_tasks_set_updated_at ON public.tasks;
CREATE TRIGGER trg_tasks_set_updated_at
BEFORE UPDATE ON public.tasks
FOR EACH ROW
EXECUTE FUNCTION public.tasks_set_updated_at();

ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tasks TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.tasks TO service_role;

DROP POLICY IF EXISTS tasks_select_team ON public.tasks;
CREATE POLICY tasks_select_team
ON public.tasks
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = tasks.frc_team
  )
);

DROP POLICY IF EXISTS tasks_insert_team ON public.tasks;
CREATE POLICY tasks_insert_team
ON public.tasks
FOR INSERT
TO authenticated
WITH CHECK (
  created_by = auth.uid()
  AND EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = tasks.frc_team
  )
);

DROP POLICY IF EXISTS tasks_update_team ON public.tasks;
CREATE POLICY tasks_update_team
ON public.tasks
FOR UPDATE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = tasks.frc_team
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = tasks.frc_team
  )
);

DROP POLICY IF EXISTS tasks_delete_team ON public.tasks;
CREATE POLICY tasks_delete_team
ON public.tasks
FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.user_profiles up
    WHERE up.id = auth.uid()
      AND up.frc_team = tasks.frc_team
  )
);

INSERT INTO storage.buckets (id, name, public)
VALUES ('task-files', 'task-files', false)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'task_files_select_authenticated'
  ) THEN
    EXECUTE 'CREATE POLICY task_files_select_authenticated ON storage.objects FOR SELECT TO authenticated USING (bucket_id = ''task-files'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'task_files_insert_authenticated'
  ) THEN
    EXECUTE 'CREATE POLICY task_files_insert_authenticated ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''task-files'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'task_files_update_authenticated'
  ) THEN
    EXECUTE 'CREATE POLICY task_files_update_authenticated ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''task-files'') WITH CHECK (bucket_id = ''task-files'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'task_files_delete_authenticated'
  ) THEN
    EXECUTE 'CREATE POLICY task_files_delete_authenticated ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''task-files'')';
  END IF;
END $$;
