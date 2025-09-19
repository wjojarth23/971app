-- Migration: add build approval gating and Slack mapping columns; fix build_bom stock custom

BEGIN;

-- 1) builds: approval columns and optional Slack mapping for approval messages
ALTER TABLE IF EXISTS public.builds
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS approver text,
  ADD COLUMN IF NOT EXISTS slack_channel text,
  ADD COLUMN IF NOT EXISTS slack_ts text;

-- 2) build_bom: custom stock column used by UI editors
ALTER TABLE IF EXISTS public.build_bom
  ADD COLUMN IF NOT EXISTS stock_assignment_custom text;

-- 3) purchasing: store Slack channel/ts so emoji reactions can approve in events handler
ALTER TABLE IF EXISTS public.purchasing
  ADD COLUMN IF NOT EXISTS slack_channel text,
  ADD COLUMN IF NOT EXISTS slack_ts text;

COMMIT;
