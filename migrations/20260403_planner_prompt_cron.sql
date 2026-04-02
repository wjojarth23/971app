CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

CREATE OR REPLACE FUNCTION public.invoke_planner_notification_cron()
RETURNS bigint
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  SELECT net.http_post(
    url := app_url || '/api/planner/notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || cron_token
    ),
    body := '{}'::jsonb,
    timeout_milliseconds := 10000
  )
  INTO request_id;

  RETURN request_id;
END;
$$;

COMMENT ON FUNCTION public.invoke_planner_notification_cron()
IS 'Calls the planner notification endpoint using Vault secrets planner_notifications_app_url and planner_notifications_cron_token.';

SELECT cron.schedule(
  'planner-notifications-15m',
  '*/15 * * * *',
  $$SELECT public.invoke_planner_notification_cron();$$
);
