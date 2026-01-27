-- Autocam System Migration
-- Adds tables and columns for automated CAM processing of sheet stock parts

-- ============================================================================
-- AUTOCAM PROFILES TABLE
-- Maps 971hub stock types to PenguinCAM material profiles and parameters
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.autocam_profiles (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  stock_id text NOT NULL UNIQUE,  -- Matches stock.json id (e.g., 'al_1_8_sheet')
  material_preset text NOT NULL DEFAULT 'aluminum',  -- PenguinCAM preset: 'aluminum', 'plywood', 'polycarbonate'
  tool_diameter numeric NOT NULL DEFAULT 0.25,  -- Tool diameter in inches (e.g., 1/4" = 0.25)
  
  -- Feed/speed overrides (null = use material preset defaults)
  feed_rate numeric,           -- Cutting feed rate (IPM)
  ramp_feed_rate numeric,      -- Ramp feed rate (IPM)
  plunge_rate numeric,         -- Plunge feed rate (IPM)
  spindle_speed integer,       -- RPM
  
  -- Tab parameters
  tab_width numeric DEFAULT 0.25,    -- Tab width (inches)
  tab_height numeric DEFAULT 0.15,   -- Tab height (inches)
  tab_spacing numeric DEFAULT 6.0,   -- Desired spacing between tabs (inches)
  
  -- Ramp parameters
  ramp_angle numeric,               -- Ramp angle in degrees
  stepover_percentage numeric,      -- Radial stepover as fraction of tool diameter (0.0-1.0)
  
  enabled boolean NOT NULL DEFAULT true,  -- Whether autocam is enabled for this stock type
  
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT autocam_profiles_pkey PRIMARY KEY (id)
);

-- ============================================================================
-- AUTOCAM SETTINGS TABLE
-- Global autocam configuration
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.autocam_settings (
  id text NOT NULL DEFAULT 'global',
  enabled boolean NOT NULL DEFAULT true,  -- Master switch for autocam system
  default_tool_diameter numeric NOT NULL DEFAULT 0.25,
  api_endpoint text,  -- URL of the autocam Python backend (null = local)
  updated_at timestamp with time zone DEFAULT now(),
  updated_by uuid,
  CONSTRAINT autocam_settings_pkey PRIMARY KEY (id),
  CONSTRAINT autocam_settings_updated_by_fkey FOREIGN KEY (updated_by) REFERENCES auth.users(id)
);

-- Insert default global settings
INSERT INTO public.autocam_settings (id, enabled, default_tool_diameter)
VALUES ('global', true, 0.25)
ON CONFLICT (id) DO NOTHING;

-- ============================================================================
-- AUTOCAM JOBS TABLE
-- Tracks autocam processing jobs and stores generated G-code
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.autocam_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  part_id bigint NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status = ANY (ARRAY['pending', 'processing', 'completed', 'failed', 'approved', 'rejected'])),
  
  -- Input data
  dxf_source text,             -- 'onshape' or 'storage' or 'url'
  dxf_url text,                -- URL/path to DXF file
  stock_id text,               -- Stock type ID used
  profile_id uuid,             -- Autocam profile used (FK)
  material_thickness numeric,  -- Material thickness in inches
  
  -- Output data
  gcode text,                  -- Generated G-code
  gcode_file_name text,        -- Filename for the G-code
  gcode_file_url text,         -- Storage URL if persisted
  
  -- Processing metadata
  processing_time_ms integer,  -- How long autocam took
  errors text[],               -- Any errors/warnings during processing
  warnings text[],
  stats jsonb,                 -- Processing statistics (holes, perimeters, etc.)
  
  -- Review tracking
  reviewed_by uuid,
  reviewed_at timestamp with time zone,
  rejection_reason text,
  
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  
  CONSTRAINT autocam_jobs_pkey PRIMARY KEY (id),
  CONSTRAINT autocam_jobs_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id) ON DELETE CASCADE,
  CONSTRAINT autocam_jobs_profile_id_fkey FOREIGN KEY (profile_id) REFERENCES public.autocam_profiles(id),
  CONSTRAINT autocam_jobs_reviewed_by_fkey FOREIGN KEY (reviewed_by) REFERENCES auth.users(id)
);

-- ============================================================================
-- ADD AUTOCAM STATUS TO PARTS TABLE
-- ============================================================================
-- Add 'autocammed' to parts status enum if not already present
-- Note: In production, you may need to recreate the constraint
ALTER TABLE public.parts 
  DROP CONSTRAINT IF EXISTS parts_status_check;

ALTER TABLE public.parts 
  ADD CONSTRAINT parts_status_check 
  CHECK (status = ANY (ARRAY[
    'pending'::text, 
    'autocammed'::text,    -- NEW: Part has been auto-CAMmed, awaiting review
    'in-progress'::text, 
    'cammed'::text, 
    'machined'::text, 
    'inspected'::text, 
    'deburred'::text, 
    'complete'::text,
    'kitted'::text
  ]));

-- ============================================================================
-- INSERT DEFAULT AUTOCAM PROFILES
-- Map common stock types to PenguinCAM material presets
-- ============================================================================

-- Aluminum sheets
INSERT INTO public.autocam_profiles (stock_id, material_preset, tool_diameter, enabled)
VALUES 
  ('al_1_16_sheet', 'aluminum', 0.1875, true),  -- 3/16" tool for thin aluminum
  ('al_3_16_sheet', 'aluminum', 0.25, true),
  ('al_1_8_sheet', 'aluminum', 0.25, true),
  ('al_1_4_sheet', 'aluminum', 0.25, true),
  ('al_3_8_sheet', 'aluminum', 0.25, true)
ON CONFLICT (stock_id) DO NOTHING;

-- Polycarbonate sheets (router workflow)
INSERT INTO public.autocam_profiles (stock_id, material_preset, tool_diameter, enabled)
VALUES
  ('pc_1_16_sheet', 'polycarbonate', 0.25, true),
  ('pc_1_8_sheet', 'polycarbonate', 0.25, true),
  ('pc_1_4_sheet', 'polycarbonate', 0.25, true),
  ('pc_3_8_sheet', 'polycarbonate', 0.25, true)
ON CONFLICT (stock_id) DO NOTHING;

-- ============================================================================
-- INDEXES
-- ============================================================================
CREATE INDEX IF NOT EXISTS idx_autocam_jobs_part_id ON public.autocam_jobs(part_id);
CREATE INDEX IF NOT EXISTS idx_autocam_jobs_status ON public.autocam_jobs(status);
CREATE INDEX IF NOT EXISTS idx_autocam_profiles_stock_id ON public.autocam_profiles(stock_id);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.autocam_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autocam_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.autocam_jobs ENABLE ROW LEVEL SECURITY;

-- Everyone can read profiles and settings
CREATE POLICY "autocam_profiles_read" ON public.autocam_profiles
  FOR SELECT USING (true);

CREATE POLICY "autocam_settings_read" ON public.autocam_settings
  FOR SELECT USING (true);

CREATE POLICY "autocam_jobs_read" ON public.autocam_jobs
  FOR SELECT USING (true);

-- Only authenticated users can modify (further restricted by app logic)
CREATE POLICY "autocam_profiles_write" ON public.autocam_profiles
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "autocam_settings_write" ON public.autocam_settings
  FOR ALL USING (auth.role() = 'authenticated');

CREATE POLICY "autocam_jobs_write" ON public.autocam_jobs
  FOR ALL USING (auth.role() = 'authenticated');

-- ============================================================================
-- TRIGGER: Update timestamps
-- ============================================================================
CREATE OR REPLACE FUNCTION update_autocam_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS autocam_profiles_updated_at ON public.autocam_profiles;
CREATE TRIGGER autocam_profiles_updated_at
  BEFORE UPDATE ON public.autocam_profiles
  FOR EACH ROW EXECUTE FUNCTION update_autocam_updated_at();

DROP TRIGGER IF EXISTS autocam_jobs_updated_at ON public.autocam_jobs;
CREATE TRIGGER autocam_jobs_updated_at
  BEFORE UPDATE ON public.autocam_jobs
  FOR EACH ROW EXECUTE FUNCTION update_autocam_updated_at();
