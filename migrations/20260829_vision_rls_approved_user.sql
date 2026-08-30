-- Tighten Vision RLS from "any authenticated session" to "any approved team
-- member", matching every sibling scouting table (see
-- 20260822_scouting_picklist.sql and 20260820_fusion_cam.sql).
--
-- The original policies used USING (true) / WITH CHECK (true), which reads as
-- "open to everyone" but actually means open to every authenticated Supabase
-- session - including accounts still pending approval and accounts that have
-- been banned. The app UI gates those out, but RLS is what protects a direct
-- client using the public anon key, and it was letting them read, modify, or
-- delete Vision records and recordings.
--
-- public.approved_user() is admin OR CAN_SEE_ROUTES, which is exactly the
-- grant the admin panel's Approve action confers - so this preserves the
-- intent ("open to every approved user, no special permission needed") while
-- closing the hole. VISION_RELEASE remains a separate, app-level gate on the
-- one action that writes real scouting data.

-- Read/write tables: the working surface of the tool.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'vision_matches','vision_views','vision_runs','vision_tracks',
    'vision_observations','vision_discrepancies','vision_reference_snapshots'
  ]
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS vision_authenticated_access ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY vision_authenticated_access ON public.%I TO authenticated '
      'USING (public.approved_user()) WITH CHECK (public.approved_user())',
      table_name
    );
  END LOOP;
END $$;

-- Read-only tables: written only by service_role (runner heartbeats, the
-- release bridge), so approved users need SELECT and nothing more.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['vision_release_log','vision_runners']
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS vision_fleet_read ON public.%I', table_name);
    EXECUTE format(
      'CREATE POLICY vision_fleet_read ON public.%I FOR SELECT TO authenticated '
      'USING (public.approved_user())',
      table_name
    );
  END LOOP;
END $$;

DROP POLICY IF EXISTS vision_qwen_clips_authenticated ON public.vision_qwen_clips;
CREATE POLICY vision_qwen_clips_authenticated ON public.vision_qwen_clips
  FOR SELECT TO authenticated USING (public.approved_user());

-- Match recordings. Same reasoning, and more consequential: these are raw
-- video files, and the old policy let any authenticated session overwrite or
-- delete them.
DROP POLICY IF EXISTS vision_recordings_authenticated ON storage.objects;
CREATE POLICY vision_recordings_authenticated ON storage.objects TO authenticated
  USING (bucket_id = 'vision-recordings' AND public.approved_user())
  WITH CHECK (bucket_id = 'vision-recordings' AND public.approved_user());
