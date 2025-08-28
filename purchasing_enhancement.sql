-- Enhancement SQL for purchasing system
-- Run this to add missing columns and update the purchasing workflow

-- Add missing columns to purchasing table
ALTER TABLE public.purchasing ADD COLUMN IF NOT EXISTS vendor text;
ALTER TABLE public.purchasing ADD COLUMN IF NOT EXISTS url text;
ALTER TABLE public.purchasing ADD COLUMN IF NOT EXISTS price numeric(10,2);
ALTER TABLE public.purchasing ADD COLUMN IF NOT EXISTS final_price numeric(10,2);
ALTER TABLE public.purchasing ADD COLUMN IF NOT EXISTS part_number text;
ALTER TABLE public.purchasing ADD COLUMN IF NOT EXISTS kitting_bin text;
ALTER TABLE public.purchasing ADD COLUMN IF NOT EXISTS delivered boolean DEFAULT false;
ALTER TABLE public.purchasing ADD COLUMN IF NOT EXISTS workflow text DEFAULT 'purchase';

-- Update status check constraint to include new statuses
ALTER TABLE public.purchasing DROP CONSTRAINT IF EXISTS purchasing_status_check;
ALTER TABLE public.purchasing ADD CONSTRAINT purchasing_status_check 
  CHECK (status = ANY (ARRAY['pending'::text, 'ordered'::text, 'delivered'::text, 'kitted'::text]));

-- Add workflow constraint
ALTER TABLE public.purchasing ADD CONSTRAINT purchasing_workflow_check 
  CHECK (workflow = 'purchase');

-- Add missing columns to builds table if not exists
ALTER TABLE public.builds ADD COLUMN IF NOT EXISTS part_ids integer[] DEFAULT '{}';

-- Create indexes for better performance
CREATE INDEX IF NOT EXISTS idx_purchasing_status ON public.purchasing(status);
CREATE INDEX IF NOT EXISTS idx_purchasing_vendor ON public.purchasing(vendor);
CREATE INDEX IF NOT EXISTS idx_purchasing_kitting_bin ON public.purchasing(kitting_bin);

-- Function to add a purchasing item to a build
CREATE OR REPLACE FUNCTION add_purchasing_to_build(build_uuid uuid, purchasing_id integer)
RETURNS void AS $$
BEGIN
    -- Add the purchasing ID to the build's part_ids array
    UPDATE public.builds 
    SET part_ids = array_append(part_ids, purchasing_id)
    WHERE id = build_uuid 
    AND NOT (purchasing_id = ANY(part_ids)); -- Avoid duplicates
END;
$$ LANGUAGE plpgsql;

-- Function to get build with all related parts and purchasing
CREATE OR REPLACE FUNCTION get_build_with_all_items(build_uuid uuid)
RETURNS TABLE(
    build_data jsonb,
    parts_data jsonb,
    purchasing_data jsonb
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        to_jsonb(b.*) as build_data,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', p.id,
                    'name', p.name,
                    'requester', p.requester,
                    'project_id', p.project_id,
                    'workflow', p.workflow,
                    'status', p.status,
                    'quantity', p.quantity,
                    'material', p.material,
                    'kitting_bin', p.kitting_bin,
                    'delivered', p.delivered,
                    'created_at', p.created_at,
                    'updated_at', p.updated_at
                )
            ) FILTER (WHERE p.id IS NOT NULL),
            '[]'::jsonb
        ) as parts_data,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', pur.id,
                    'name', pur.name,
                    'requester', pur.requester,
                    'project_id', pur.project_id,
                    'workflow', pur.workflow,
                    'status', pur.status,
                    'quantity', pur.quantity,
                    'material', pur.material,
                    'vendor', pur.vendor,
                    'url', pur.url,
                    'price', pur.price,
                    'final_price', pur.final_price,
                    'part_number', pur.part_number,
                    'kitting_bin', pur.kitting_bin,
                    'delivered', pur.delivered,
                    'created_at', pur.created_at,
                    'updated_at', pur.updated_at
                )
            ) FILTER (WHERE pur.id IS NOT NULL),
            '[]'::jsonb
        ) as purchasing_data
    FROM public.builds b
    LEFT JOIN public.parts p ON p.id = ANY(b.part_ids)
    LEFT JOIN public.purchasing pur ON pur.id = ANY(b.part_ids)
    WHERE b.id = build_uuid
    GROUP BY b.id, b.subsystem_id, b.release_id, b.release_name, b.build_hash, 
             b.status, b.created_by, b.created_at, b.assembled_at, b.assembled_by, b.part_ids;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions
GRANT EXECUTE ON FUNCTION add_purchasing_to_build(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_build_with_all_items(uuid) TO authenticated;

-- Update existing policies if needed
DROP POLICY IF EXISTS "Users can access purchasing" ON public.purchasing;
CREATE POLICY "Users can access purchasing" ON public.purchasing 
FOR ALL USING (true) WITH CHECK (true);

-- Ensure RLS is enabled
ALTER TABLE public.purchasing ENABLE ROW LEVEL SECURITY;

-- Grant table permissions
GRANT ALL ON public.purchasing TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

-- Add trigger to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_purchasing_updated_at ON public.purchasing;
CREATE TRIGGER update_purchasing_updated_at
    BEFORE UPDATE ON public.purchasing
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Update the purchasing table to use integer IDs like parts table for consistency
-- Note: This will recreate the purchasing table with integer IDs
DO $$
BEGIN
    -- Check if we need to migrate from UUID to integer IDs
    IF EXISTS (
        SELECT 1 FROM information_schema.columns 
        WHERE table_name = 'purchasing' 
        AND column_name = 'id' 
        AND data_type = 'uuid'
    ) THEN
        -- Create a new purchasing table with integer IDs
        CREATE SEQUENCE IF NOT EXISTS purchasing_id_seq;
        
        -- Create temporary table with new structure
        CREATE TABLE purchasing_new (
            id bigint NOT NULL DEFAULT nextval('purchasing_id_seq'::regclass),
            name text NOT NULL,
            requester text NOT NULL,
            project_id text NOT NULL,
            quantity integer NOT NULL DEFAULT 1,
            material text DEFAULT '',
            status text NOT NULL DEFAULT 'pending',
            vendor text,
            url text,
            price numeric(10,2),
            final_price numeric(10,2),
            part_number text,
            kitting_bin text,
            delivered boolean DEFAULT false,
            workflow text DEFAULT 'purchase',
            created_at timestamp with time zone DEFAULT now(),
            updated_at timestamp with time zone DEFAULT now(),
            CONSTRAINT purchasing_new_pkey PRIMARY KEY (id),
            CONSTRAINT purchasing_new_status_check CHECK (status = ANY (ARRAY['pending'::text, 'ordered'::text, 'delivered'::text, 'kitted'::text])),
            CONSTRAINT purchasing_new_workflow_check CHECK (workflow = 'purchase')
        );
        
        -- Copy existing data (excluding id to get new integer IDs)
        INSERT INTO purchasing_new (name, requester, project_id, quantity, material, status, created_at, updated_at)
        SELECT name, requester, project_id, quantity, material, status, created_at, updated_at
        FROM purchasing;
        
        -- Drop old table and rename new one
        DROP TABLE purchasing CASCADE;
        ALTER TABLE purchasing_new RENAME TO purchasing;
        
        -- Recreate indexes
        CREATE INDEX idx_purchasing_status ON public.purchasing(status);
        CREATE INDEX idx_purchasing_project_id ON public.purchasing(project_id);
        CREATE INDEX idx_purchasing_vendor ON public.purchasing(vendor);
        CREATE INDEX idx_purchasing_kitting_bin ON public.purchasing(kitting_bin);
        
        -- Recreate policies
        ALTER TABLE public.purchasing ENABLE ROW LEVEL SECURITY;
        CREATE POLICY "Users can access purchasing" ON public.purchasing 
        FOR ALL USING (true) WITH CHECK (true);
        
        -- Grant permissions
        GRANT ALL ON public.purchasing TO authenticated;
        GRANT USAGE, SELECT ON purchasing_id_seq TO authenticated;
        
        -- Recreate trigger
        CREATE TRIGGER update_purchasing_updated_at
            BEFORE UPDATE ON public.purchasing
            FOR EACH ROW
            EXECUTE FUNCTION update_updated_at_column();
            
        RAISE NOTICE 'Purchasing table migrated to integer IDs successfully';
    ELSE
        RAISE NOTICE 'Purchasing table already uses integer IDs or does not exist';
    END IF;
END $$;
