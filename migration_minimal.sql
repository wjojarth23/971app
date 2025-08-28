-- Minimal migration - just create the missing build_bom table
-- Run this if the main migration has issues

-- Create the build_bom table (the main missing piece)
CREATE TABLE IF NOT EXISTS public.build_bom (
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
  status character varying DEFAULT 'pending'::character varying,
  added_to_parts_list boolean DEFAULT false,
  added_to_purchasing boolean DEFAULT false,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT build_bom_pkey PRIMARY KEY (id),
  CONSTRAINT build_bom_build_id_fkey FOREIGN KEY (build_id) REFERENCES public.builds(id) ON DELETE CASCADE
);

-- Create purchasing table if missing
CREATE TABLE IF NOT EXISTS public.purchasing (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  requester text NOT NULL,
  project_id text NOT NULL,
  quantity integer NOT NULL DEFAULT 1,
  material text DEFAULT '',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT purchasing_pkey PRIMARY KEY (id)
);

-- Basic indexes
CREATE INDEX IF NOT EXISTS idx_build_bom_build_id ON public.build_bom(build_id);
CREATE INDEX IF NOT EXISTS idx_purchasing_project_id ON public.purchasing(project_id);

-- Enable RLS
ALTER TABLE public.build_bom ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.purchasing ENABLE ROW LEVEL SECURITY;

-- Basic policies (adjust as needed)
DROP POLICY IF EXISTS "Users can access build_bom" ON public.build_bom;
CREATE POLICY "Users can access build_bom" ON public.build_bom USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "Users can access purchasing" ON public.purchasing;
CREATE POLICY "Users can access purchasing" ON public.purchasing USING (true) WITH CHECK (true);

-- Grant permissions
GRANT ALL ON public.build_bom TO authenticated;
GRANT ALL ON public.purchasing TO authenticated;
