-- Migration to support an "other" category and editing flow for build BOM items
-- 0) Pre-flight: ensure build_bom exists (run migration_add_build_system.sql first)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'build_bom'
    ) THEN
        RAISE EXCEPTION 'Table public.build_bom not found. Run migration_add_build_system.sql first.';
    END IF;
END $$;
-- 1) Update build_bom.part_type constraint to include 'other'
DO $$
BEGIN
    -- Attempt to drop existing constraint if present; constraint name may vary depending on environment
    -- Try common names first; ignore failures
    BEGIN
        ALTER TABLE public.build_bom DROP CONSTRAINT IF EXISTS build_bom_part_type_check;
    EXCEPTION WHEN others THEN
        NULL;
    END;

    BEGIN
        ALTER TABLE public.build_bom DROP CONSTRAINT IF EXISTS build_bom_part_type_check1;
    EXCEPTION WHEN others THEN
        NULL;
    END;

    -- Add a new constraint that allows COTS, manufactured, and other
    ALTER TABLE public.build_bom 
    ADD CONSTRAINT build_bom_part_type_check CHECK (
        part_type::text = ANY (
            ARRAY['COTS'::character varying::text, 'manufactured'::character varying::text, 'other'::character varying::text]
        )
    );
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Could not update build_bom part_type constraint: %', SQLERRM;
END $$;

-- 2) Optional index to help locate non-progress items quickly
CREATE INDEX IF NOT EXISTS idx_build_bom_other ON public.build_bom(build_id) WHERE part_type = 'other';

-- Note: Application code will treat 'other' items as not added to manufacturing/purchasing yet;
--       when promoted, the app will flip part_type to 'manufactured' or 'COTS' and set the
--       existing flags (added_to_parts_list / added_to_purchasing) accordingly.
