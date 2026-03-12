-- Public bucket for task description photos (inline previews in task descriptions)

INSERT INTO storage.buckets (id, name, public)
VALUES ('task-description-images', 'task-description-images', true)
ON CONFLICT (id) DO UPDATE
SET public = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'task_description_images_select_public'
  ) THEN
    EXECUTE 'CREATE POLICY task_description_images_select_public ON storage.objects FOR SELECT TO public USING (bucket_id = ''task-description-images'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'task_description_images_insert_authenticated'
  ) THEN
    EXECUTE 'CREATE POLICY task_description_images_insert_authenticated ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = ''task-description-images'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'task_description_images_update_authenticated'
  ) THEN
    EXECUTE 'CREATE POLICY task_description_images_update_authenticated ON storage.objects FOR UPDATE TO authenticated USING (bucket_id = ''task-description-images'') WITH CHECK (bucket_id = ''task-description-images'')';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND policyname = 'task_description_images_delete_authenticated'
  ) THEN
    EXECUTE 'CREATE POLICY task_description_images_delete_authenticated ON storage.objects FOR DELETE TO authenticated USING (bucket_id = ''task-description-images'')';
  END IF;
END $$;

