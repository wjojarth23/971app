-- Add build-level quantity multiplier.
-- This value represents how many copies of a build are being produced.
-- Downstream BOM and generated rows can scale quantities from this value.

ALTER TABLE public.builds
ADD COLUMN IF NOT EXISTS quantity integer;

UPDATE public.builds
SET quantity = 1
WHERE quantity IS NULL OR quantity < 1;

ALTER TABLE public.builds
ALTER COLUMN quantity SET DEFAULT 1;

ALTER TABLE public.builds
ALTER COLUMN quantity SET NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'builds_quantity_check'
      AND conrelid = 'public.builds'::regclass
  ) THEN
    ALTER TABLE public.builds
      ADD CONSTRAINT builds_quantity_check CHECK (quantity > 0);
  END IF;
END $$;
