-- Slack DM notification preferences and logging
ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS notification_settings jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS slack_user_id text,
  ADD COLUMN IF NOT EXISTS slack_dm_channel text;

CREATE TABLE IF NOT EXISTS public.user_notification_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  event_type text NOT NULL,
  entity_key text NOT NULL,
  sent_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS user_notification_logs_key
  ON public.user_notification_logs (user_id, event_type, entity_key);
