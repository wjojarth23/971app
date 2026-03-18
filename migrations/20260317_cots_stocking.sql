-- COTS stocking inventory table
-- Stores shared stock counts plus learned search aliases.

CREATE TABLE IF NOT EXISTS public.cots_stock_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canonical_name text NOT NULL,
  canonical_key text NOT NULL,
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  aliases text[] NOT NULL DEFAULT '{}'::text[],
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT cots_stock_items_key_unique UNIQUE (canonical_key)
);

CREATE INDEX IF NOT EXISTS idx_cots_stock_items_name
  ON public.cots_stock_items (canonical_name);

CREATE OR REPLACE FUNCTION public.cots_stock_items_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_cots_stock_items_set_updated_at ON public.cots_stock_items;
CREATE TRIGGER trg_cots_stock_items_set_updated_at
BEFORE UPDATE ON public.cots_stock_items
FOR EACH ROW
EXECUTE FUNCTION public.cots_stock_items_set_updated_at();

ALTER TABLE public.cots_stock_items ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cots_stock_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.cots_stock_items TO service_role;

DROP POLICY IF EXISTS cots_stock_items_select_authenticated ON public.cots_stock_items;
CREATE POLICY cots_stock_items_select_authenticated
ON public.cots_stock_items
FOR SELECT
TO authenticated
USING (true);

DROP POLICY IF EXISTS cots_stock_items_insert_authenticated ON public.cots_stock_items;
CREATE POLICY cots_stock_items_insert_authenticated
ON public.cots_stock_items
FOR INSERT
TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS cots_stock_items_update_authenticated ON public.cots_stock_items;
CREATE POLICY cots_stock_items_update_authenticated
ON public.cots_stock_items
FOR UPDATE
TO authenticated
USING (true)
WITH CHECK (true);

DROP POLICY IF EXISTS cots_stock_items_delete_authenticated ON public.cots_stock_items;
CREATE POLICY cots_stock_items_delete_authenticated
ON public.cots_stock_items
FOR DELETE
TO authenticated
USING (true);
