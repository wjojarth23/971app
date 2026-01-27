-- Extend router_groups with cut metadata and machine selection
ALTER TABLE public.router_groups
  ADD COLUMN stock_type text NOT NULL DEFAULT ''::text,
  ADD COLUMN cut_name text NOT NULL DEFAULT ''::text,
  ADD COLUMN output_folder text NOT NULL DEFAULT ''::text,
  ADD COLUMN machine text NOT NULL DEFAULT 'UNC Router'::text,
  ADD CONSTRAINT router_groups_machine_check CHECK (machine IN ('UNC Router', 'ShopSabre'));

-- Auto-name router groups as {stock_type}_{id} when name is blank or NULL
CREATE OR REPLACE FUNCTION public.router_groups_set_name()
RETURNS trigger AS $$
BEGIN
  IF NEW.name IS NULL OR NEW.name = '' THEN
    NEW.name := concat_ws('_', NEW.stock_type, NEW.id);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_router_group_name ON public.router_groups;
CREATE TRIGGER set_router_group_name
BEFORE INSERT ON public.router_groups
FOR EACH ROW
EXECUTE FUNCTION public.router_groups_set_name();

-- Backfill existing rows with default name pattern where missing
UPDATE public.router_groups
SET name = concat_ws('_', stock_type, id)
WHERE name IS NULL OR name = '';
