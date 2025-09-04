-- Router workflow cleanup and schema updates

-- 1) Remove 'deburred' from parts.status check constraint (and recreate without it)
DO $$
BEGIN
  ALTER TABLE public.parts DROP CONSTRAINT IF EXISTS parts_status_check;
EXCEPTION WHEN undefined_object THEN
  -- ignore if constraint name differs or doesn't exist
  NULL;
END$$;

ALTER TABLE public.parts
  ADD CONSTRAINT parts_status_check
  CHECK (status IN ('pending', 'in-progress', 'cammed', 'machined', 'inspected', 'complete'));

-- 2) Migrate any rows still using 'deburred' to a supported status (choose 'inspected')
UPDATE public.parts
SET status = 'inspected',
    updated_at = timezone('utc', now())
WHERE status = 'deburred';

-- 3) Drop any legacy columns related to bends/countersinks if they exist
-- (These do not exist in the current schema, but this is safe to run)
ALTER TABLE public.parts DROP COLUMN IF EXISTS has_bends;
ALTER TABLE public.parts DROP COLUMN IF EXISTS needs_bends;
ALTER TABLE public.parts DROP COLUMN IF EXISTS needs_countersink;
ALTER TABLE public.parts DROP COLUMN IF EXISTS countersinks;

ALTER TABLE public.build_bom DROP COLUMN IF EXISTS has_bends;
ALTER TABLE public.build_bom DROP COLUMN IF EXISTS needs_bends;
ALTER TABLE public.build_bom DROP COLUMN IF EXISTS needs_countersink;
ALTER TABLE public.build_bom DROP COLUMN IF EXISTS countersinks;

-- 4) Purge legacy router JSON flags (needs_bends / needs_countersink) and migrate sub-steps
--    Old sub-steps: needs_countersink, countersunk, needs_bends, bent, cut
--    New sub-steps: cam_ing, layout, queued, inspection, complete
--    Mappings:
--      cut -> inspection
--      needs_countersink, countersunk, needs_bends, bent -> layout
WITH t AS (
  SELECT id,
         file_url::jsonb AS j,
         (file_url::jsonb -> 'router_meta')::jsonb AS rm
  FROM public.parts
  WHERE workflow = 'router'
)
UPDATE public.parts p
SET file_url = CASE
  WHEN t.rm IS NULL THEN p.file_url
  ELSE (
    jsonb_set(
      (t.j - 'router_meta') || jsonb_build_object('router_meta', (t.rm - 'needs_countersink' - 'needs_bends')),
      '{router_meta,step}',
      to_jsonb(
        CASE COALESCE(t.rm->>'step','')
          WHEN 'cut' THEN 'inspection'
          WHEN 'needs_countersink' THEN 'layout'
          WHEN 'countersunk' THEN 'layout'
          WHEN 'needs_bends' THEN 'layout'
          WHEN 'bent' THEN 'layout'
          ELSE COALESCE(t.rm->>'step','')
        END
      ),
      true
    )::text
  )
END,
updated_at = timezone('utc', now())
FROM t
WHERE p.id = t.id;

-- 5) Normalize router Pending -> In Progress if already in CAMing sub-step
UPDATE public.parts
SET status = 'in-progress',
    updated_at = timezone('utc', now())
WHERE workflow = 'router'
  AND status = 'pending'
  AND (file_url::jsonb -> 'router_meta' ->> 'step') = 'cam_ing';
