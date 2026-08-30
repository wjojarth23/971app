-- Enable RLS on the seven public tables that still had it switched off.
--
-- With RLS disabled a table is fully readable and writable by anyone holding
-- the public anon key, which ships in the client bundle by design. The app
-- itself was never relying on that; these are simply tables that predate the
-- project's RLS convention.
--
-- The most consequential is user_attendance_logs: check-in records for a high
-- school team are personal data about minors, and they were world-readable and
-- world-writable.
--
-- Each policy set below was chosen from how the table is *actually* accessed,
-- verified against the code rather than assumed - getting this wrong either
-- leaves the hole open or breaks a working feature:
--
--   attendance_locations / _schedules / _schedule_locations
--       src/lib/attendance.js does full CRUD from the BROWSER client (anon
--       key + user JWT), reached from the admin page. So reads must stay open
--       to any approved user, while writes - which are event configuration -
--       require the admin permission that already gates that page.
--
--   user_attendance_logs
--       Read-only from app code (own history on the profile, plus an
--       unfiltered team activity feed, both by design). Writes happen inside
--       log_user_attendance(), which is SECURITY DEFINER and therefore
--       bypasses RLS - so no INSERT policy is needed and check-ins are
--       unaffected.
--
--   scouting_settings
--       Only ever touched through /api/scouting-config and /api/scouting-admin,
--       both of which use the service-role client. Approved users still get
--       read access, since that is the active-event key every scouting page
--       needs and it is not sensitive.
--
--   user_notification_logs
--       Only slack_notifications.js, via the service-role client. It is the
--       Slack dedup ledger; no client has any business reading it.
--
--   runtime_leases
--       No runtime references anywhere in the repo - only schema.sql, its own
--       migration, and AutoCAM planning docs. Locked to service_role.

-- Configuration a scout reads and an admin edits.
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'attendance_locations', 'attendance_schedules', 'attendance_schedule_locations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_select_approved', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.approved_user())',
      table_name || '_select_approved', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_write_admin', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated '
      'USING (public.has_permission(''VIEW_ADMIN_PANEL'')) '
      'WITH CHECK (public.has_permission(''VIEW_ADMIN_PANEL''))',
      table_name || '_write_admin', table_name);

    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', table_name || '_service_all', table_name);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I TO service_role USING (true) WITH CHECK (true)',
      table_name || '_service_all', table_name);
  END LOOP;
END $$;

-- Personal check-in records. Readable by the team, written only by the
-- SECURITY DEFINER function that records a check-in.
ALTER TABLE public.user_attendance_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_attendance_logs_select_approved ON public.user_attendance_logs;
CREATE POLICY user_attendance_logs_select_approved ON public.user_attendance_logs
  FOR SELECT TO authenticated USING (public.approved_user());

-- Deliberately no INSERT/UPDATE/DELETE policy for authenticated: nothing in
-- the app writes these directly, and a scout must not be able to forge or
-- erase an attendance record.
DROP POLICY IF EXISTS user_attendance_logs_service_all ON public.user_attendance_logs;
CREATE POLICY user_attendance_logs_service_all ON public.user_attendance_logs
  TO service_role USING (true) WITH CHECK (true);

-- Active-event configuration: read by every scouting page, written by admins
-- through service-role endpoints.
ALTER TABLE public.scouting_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS scouting_settings_select_approved ON public.scouting_settings;
CREATE POLICY scouting_settings_select_approved ON public.scouting_settings
  FOR SELECT TO authenticated USING (public.approved_user());

DROP POLICY IF EXISTS scouting_settings_service_all ON public.scouting_settings;
CREATE POLICY scouting_settings_service_all ON public.scouting_settings
  TO service_role USING (true) WITH CHECK (true);

-- Server-only bookkeeping. No client needs either of these, so neither gets a
-- policy for `authenticated` at all.
ALTER TABLE public.user_notification_logs ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_notification_logs_service_all ON public.user_notification_logs;
CREATE POLICY user_notification_logs_service_all ON public.user_notification_logs
  TO service_role USING (true) WITH CHECK (true);

ALTER TABLE public.runtime_leases ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS runtime_leases_service_all ON public.runtime_leases;
CREATE POLICY runtime_leases_service_all ON public.runtime_leases
  TO service_role USING (true) WITH CHECK (true);
