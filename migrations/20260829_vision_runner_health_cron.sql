-- Scheduled sweep behind api/notifications/vision-stale-runners.
--
-- !!! APPLY THIS ONE ON MERGE, NOT BEFORE !!!
-- Unlike the other vision migrations (additive schema that deployed code
-- simply ignores), this schedules a job that actively calls a route which
-- only exists on the Vision Scouting branch. Applying it while PR #84 is
-- still unmerged just 404s every 5 minutes against production. Apply it
-- immediately after that PR merges and the deploy completes.
--
-- A runner that loses its Qwen service stops claiming work entirely and
-- records that fact nowhere but its own vision_runners row, so queued runs
-- would sit unprocessed with nobody told. This is what turns that into a
-- Slack alert.
--
-- Deliberately reuses the existing planner_notifications_* vault secrets and
-- the same cron_auth.js trust boundary as the other notification sweeps
-- rather than provisioning a new token - it is another scheduled first-party
-- sweep, not a new external caller.

CREATE OR REPLACE FUNCTION public.invoke_vision_runner_health_cron()
 RETURNS bigint
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  app_url text;
  cron_token text;
  request_id bigint;
BEGIN
  SELECT decrypted_secret
  INTO app_url
  FROM vault.decrypted_secrets
  WHERE name = 'planner_notifications_app_url'
  ORDER BY created_at DESC
  LIMIT 1;

  SELECT decrypted_secret
  INTO cron_token
  FROM vault.decrypted_secrets
  WHERE name = 'planner_notifications_cron_token'
  ORDER BY created_at DESC
  LIMIT 1;

  app_url := regexp_replace(COALESCE(trim(app_url), ''), '/+$', '');
  cron_token := trim(COALESCE(cron_token, ''));

  IF app_url = '' OR cron_token = '' THEN
    RETURN NULL;
  END IF;

  SELECT net.http_get(
    url := app_url || '/api/notifications/vision-stale-runners?token=' || cron_token,
    timeout_milliseconds := 15000
  )
  INTO request_id;

  RETURN request_id;
END;
$function$;

-- Every 5 minutes, against a 15-minute silence threshold, so a dead runner is
-- caught within ~20 minutes. At a competition running a match every ~7
-- minutes the 15-minute sweep the other jobs use would let half an hour of
-- unprocessed matches go by unnoticed. Re-running the sweep is cheap and
-- cannot spam: dispatchNotification dedups on entityKey, which stays constant
-- for the duration of a single outage.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vision-runner-health-5m') THEN
    PERFORM cron.unschedule('vision-runner-health-5m');
  END IF;
  PERFORM cron.schedule(
    'vision-runner-health-5m',
    '*/5 * * * *',
    'SELECT public.invoke_vision_runner_health_cron();'
  );
END $$;
