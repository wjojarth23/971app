-- Migration SQL to add build_bom table and missing fields
-- Run this in your Supabase SQL editor

-- 1. Create the build_bom table
CREATE TABLE public.build_bom (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  build_id uuid NOT NULL,
  part_name character varying NOT NULL,
  part_number character varying,
  quantity integer NOT NULL DEFAULT 1,
  part_type character varying NOT NULL CHECK (part_type::text = ANY (ARRAY['COTS'::character varying, 'manufactured'::character varying]::text[])),
  material character varying,
  stock_assignment character varying,
  workflow character varying,
  bounding_box_x numeric,
  bounding_box_y numeric,
  bounding_box_z numeric,
  onshape_part_id character varying,
  status character varying DEFAULT 'pending'::character varying CHECK (status::text = ANY (ARRAY['pending'::character varying, 'ordered'::character varying, 'delivered'::character varying, 'manufactured'::character varying, 'in-progress'::character varying, 'cammed'::character varying, 'complete'::character varying]::text[])),
  added_to_parts_list boolean DEFAULT false,
  added_to_purchasing boolean DEFAULT false,
  onshape_document_id character varying,
  onshape_wvm character varying,
  onshape_wvmid character varying,
  onshape_element_id character varying,
  file_format character varying CHECK (file_format::text = ANY (ARRAY['stl'::character varying, 'parasolid'::character varying, 'step'::character varying, 'iges'::character varying]::text[])),
  is_onshape_part boolean DEFAULT false,
  file_url text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT build_bom_pkey PRIMARY KEY (id),
  CONSTRAINT build_bom_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.builds(id) ON DELETE CASCADE
);

-- 2. Update the builds table to add the manufacturing status (only if constraint doesn't exist)
DO $$ 
BEGIN
    -- Drop existing constraint if it exists and add the updated one
    ALTER TABLE public.builds DROP CONSTRAINT IF EXISTS builds_status_check;
    ALTER TABLE public.builds 
    ADD CONSTRAINT builds_status_check CHECK (status::text = ANY (ARRAY['pending'::character varying, 'manufacturing'::character varying, 'ready_to_assemble'::character varying, 'assembled'::character varying]::text[]));
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Could not update builds status constraint: %', SQLERRM;
END $$;

-- 3. Update the parts table workflow constraint to include 'purchase'
DO $$ 
BEGIN
    -- Drop existing constraint if it exists and add the updated one
    ALTER TABLE public.parts DROP CONSTRAINT IF EXISTS parts_workflow_check;
    ALTER TABLE public.parts 
    ADD CONSTRAINT parts_workflow_check CHECK (workflow = ANY (ARRAY['laser-cut'::text, 'router'::text, 'lathe'::text, 'mill'::text, '3d-print'::text, 'purchase'::text]));
EXCEPTION
    WHEN others THEN
        RAISE NOTICE 'Could not update parts workflow constraint: %', SQLERRM;
END $$;

-- 4. Create indexes for better performance (only if they don't exist)
CREATE INDEX IF NOT EXISTS idx_build_bom_build_id ON public.build_bom(build_id);
CREATE INDEX IF NOT EXISTS idx_build_bom_part_type ON public.build_bom(part_type);
CREATE INDEX IF NOT EXISTS idx_build_bom_status ON public.build_bom(status);
CREATE INDEX IF NOT EXISTS idx_builds_status ON public.builds(status);
CREATE INDEX IF NOT EXISTS idx_builds_subsystem_id ON public.builds(subsystem_id);
CREATE INDEX IF NOT EXISTS idx_builds_build_hash ON public.builds(build_hash);

-- 5. Create the purchasing table if it doesn't exist
CREATE TABLE IF NOT EXISTS public.purchasing (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  requester text NOT NULL,
  project_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  material text DEFAULT '',
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending'::text, 'ordered'::text, 'delivered'::text])),
  supplier text,
  cost numeric,
  order_date timestamp with time zone,
  delivery_date timestamp with time zone,
  notes text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT purchasing_pkey PRIMARY KEY (id)
);

-- 6. Create indexes for purchasing table
CREATE INDEX IF NOT EXISTS idx_purchasing_status ON public.purchasing(status);
CREATE INDEX IF NOT EXISTS idx_purchasing_project_id ON public.purchasing(project_id);

-- 7. Enable Row Level Security (RLS) if needed
ALTER TABLE public.build_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchasing ENABLE ROW LEVEL SECURITY;

-- 8. Create RLS policies (only if they don't exist)
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'build_bom' AND policyname = 'Users can view all build_bom') THEN
        CREATE POLICY "Users can view all build_bom" ON public.build_bom FOR SELECT USING (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'build_bom' AND policyname = 'Users can insert build_bom') THEN
        CREATE POLICY "Users can insert build_bom" ON public.build_bom FOR INSERT WITH CHECK (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'build_bom' AND policyname = 'Users can update build_bom') THEN
        CREATE POLICY "Users can update build_bom" ON public.build_bom FOR UPDATE USING (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchasing' AND policyname = 'Users can view all purchasing') THEN
        CREATE POLICY "Users can view all purchasing" ON public.purchasing FOR SELECT USING (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchasing' AND policyname = 'Users can insert purchasing') THEN
        CREATE POLICY "Users can insert purchasing" ON public.purchasing FOR INSERT WITH CHECK (true);
    END IF;
    
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'purchasing' AND policyname = 'Users can update purchasing') THEN
        CREATE POLICY "Users can update purchasing" ON public.purchasing FOR UPDATE USING (true);
    END IF;
END $$;

-- 9. Grant permissions (adjust role as needed)
GRANT ALL ON public.build_bom TO authenticated;
GRANT ALL ON public.purchasing TO authenticated;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO authenticated;
