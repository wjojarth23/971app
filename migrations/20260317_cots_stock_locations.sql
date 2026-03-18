-- Add per-location storage for COTS stock and support hardware stock levels.

ALTER TABLE public.cots_stock_items
  ADD COLUMN IF NOT EXISTS item_category text,
  ADD COLUMN IF NOT EXISTS track_mode text NOT NULL DEFAULT 'count'
    CHECK (track_mode IN ('count', 'level'));

UPDATE public.cots_stock_items
SET item_category = COALESCE(
      item_category,
      CASE
        WHEN canonical_key ~ '(^| )(bolt|washer|nut|screw)( |$)' THEN
          regexp_replace(canonical_key, '^.*(?:^| )(bolt|washer|nut|screw)(?: |$).*$','\1')
        ELSE NULL
      END
    ),
    track_mode = CASE
      WHEN canonical_key ~ '(^| )(bolt|washer|nut|screw)( |$)' THEN 'level'
      ELSE track_mode
    END;

CREATE TABLE IF NOT EXISTS public.cots_stock_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.cots_stock_items(id) ON DELETE CASCADE,
  section text,
  drawer text,
  subsection text,
  quantity integer CHECK (quantity IS NULL OR quantity >= 0),
  stock_level text CHECK (stock_level IS NULL OR stock_level IN ('low', 'mid', 'lots')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cots_stock_locations_track_check CHECK (
    (quantity IS NOT NULL AND stock_level IS NULL)
    OR (quantity IS NULL AND stock_level IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS idx_cots_stock_locations_item_id
  ON public.cots_stock_locations (item_id);

CREATE INDEX IF NOT EXISTS idx_cots_stock_locations_lookup
  ON public.cots_stock_locations (item_id, section, drawer, subsection);

CREATE OR REPLACE FUNCTION public.cots_stock_locations_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cots_stock_locations_set_updated_at ON public.cots_stock_locations;
CREATE TRIGGER trg_cots_stock_locations_set_updated_at
BEFORE UPDATE ON public.cots_stock_locations
FOR EACH ROW
EXECUTE FUNCTION public.cots_stock_locations_set_updated_at();

INSERT INTO public.cots_stock_locations (item_id, quantity, created_at, updated_at)
SELECT id, quantity, created_at, updated_at
FROM public.cots_stock_items item
WHERE quantity > 0
  AND NOT EXISTS (
    SELECT 1
    FROM public.cots_stock_locations location
    WHERE location.item_id = item.id
  );

ALTER TABLE public.cots_stock_locations ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cots_stock_locations TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cots_stock_locations TO service_role;

DROP POLICY IF EXISTS cots_stock_locations_select_authenticated ON public.cots_stock_locations;
CREATE POLICY cots_stock_locations_select_authenticated
ON public.cots_stock_locations
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS cots_stock_locations_insert_authenticated ON public.cots_stock_locations;
CREATE POLICY cots_stock_locations_insert_authenticated
ON public.cots_stock_locations
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS cots_stock_locations_update_authenticated ON public.cots_stock_locations;
CREATE POLICY cots_stock_locations_update_authenticated
ON public.cots_stock_locations
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS cots_stock_locations_delete_authenticated ON public.cots_stock_locations;
CREATE POLICY cots_stock_locations_delete_authenticated
ON public.cots_stock_locations
FOR DELETE
TO authenticated
USING (true);
