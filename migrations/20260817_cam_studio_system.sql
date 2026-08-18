-- AutoCAM (CAM Studio) system
-- STEP -> G-code job queue, distinct from the legacy DXF/PenguinCAM
-- autocam_* tables (which only handle 2D sheet-cutting for the router
-- workflow and are currently disabled via DISABLE_AUTOCAM).
--
-- Turning and routing are generated synchronously, server-side, by pure
-- geometry math (src/lib/cam/turning.js, src/lib/cam/routing.js) driven off
-- geometry extracted directly from the part's STEP file (src/lib/cam/stepProfile.js,
-- via occt-import-js) - no DXF, no separate 2D drawing, no external CAM
-- software involved. Milling is not implemented (see millimplementations.md)
-- but 'milling' stays a valid operation_type for forward-compatibility.
--
-- SAFE TO RE-RUN: this file was revised several times while being built, so
-- every table/column/policy/index below is written to be safely re-applied
-- no matter which earlier revision (if any) already ran against this
-- database - CREATE ... IF NOT EXISTS for tables/indexes, explicit
-- ALTER TABLE ... ADD COLUMN IF NOT EXISTS for every column so an older,
-- partially-applied version gets brought fully up to date, DROP POLICY IF
-- EXISTS before every CREATE POLICY, and DROP TRIGGER IF EXISTS before every
-- CREATE TRIGGER. If AutoCAM is failing with empty material/tool/machine
-- dropdowns or "relation does not exist" errors, just re-run this whole file.

-- ============================================================================
-- REFERENCE TABLES: materials, tools, machines
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cam_materials (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  category text, -- e.g. 'aluminum', 'polycarbonate', 'plywood', 'delrin'
  notes text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cam_materials_pkey PRIMARY KEY (id)
);
ALTER TABLE public.cam_materials ADD COLUMN IF NOT EXISTS category text;
ALTER TABLE public.cam_materials ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.cam_materials ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.cam_materials ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.cam_materials ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DO $$ BEGIN
  ALTER TABLE public.cam_materials ADD CONSTRAINT cam_materials_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS public.cam_tools (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  tool_type text, -- e.g. 'endmill', 'ball-nose', 'router-bit', 'drill', 'turning-insert'
  diameter numeric, -- inches
  flutes integer,
  nose_radius numeric, -- inches; lathe insert nose radius, used for a simplified finishing-pass offset
  notes text,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cam_tools_pkey PRIMARY KEY (id)
);
ALTER TABLE public.cam_tools ADD COLUMN IF NOT EXISTS tool_type text;
ALTER TABLE public.cam_tools ADD COLUMN IF NOT EXISTS diameter numeric;
ALTER TABLE public.cam_tools ADD COLUMN IF NOT EXISTS flutes integer;
ALTER TABLE public.cam_tools ADD COLUMN IF NOT EXISTS nose_radius numeric;
ALTER TABLE public.cam_tools ADD COLUMN IF NOT EXISTS notes text;
ALTER TABLE public.cam_tools ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.cam_tools ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.cam_tools ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DO $$ BEGIN
  ALTER TABLE public.cam_tools ADD CONSTRAINT cam_tools_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Machine profiles: a named, reusable bundle of default settings for a
-- specific physical machine, so parameters don't have to be re-entered for
-- every job. Each profile is locked to one operation_type (a lathe profile
-- only makes sense for turning, a router profile only for routing).
CREATE TABLE IF NOT EXISTS public.cam_machines (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  operation_type text NOT NULL DEFAULT 'routing', -- 'turning' | 'routing' | 'milling'
  post_processor text, -- Fusion post-processor identifier (milling only, reserved for a future Runner)
  default_material_id uuid,
  default_tool_id uuid,
  default_params jsonb NOT NULL DEFAULT '{}'::jsonb, -- same shape as cam_jobs.params, see src/lib/cam/*.js
  enabled boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cam_machines_pkey PRIMARY KEY (id)
);
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS description text;
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS operation_type text NOT NULL DEFAULT 'routing';
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS post_processor text;
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS default_material_id uuid;
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS default_tool_id uuid;
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS default_params jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.cam_machines ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
DO $$ BEGIN
  ALTER TABLE public.cam_machines ADD CONSTRAINT cam_machines_name_key UNIQUE (name);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_machines ADD CONSTRAINT cam_machines_operation_type_check CHECK (operation_type = ANY (ARRAY['turning'::text, 'routing'::text, 'milling'::text]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_machines ADD CONSTRAINT cam_machines_default_material_id_fkey FOREIGN KEY (default_material_id) REFERENCES public.cam_materials(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_machines ADD CONSTRAINT cam_machines_default_tool_id_fkey FOREIGN KEY (default_tool_id) REFERENCES public.cam_tools(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_machines ADD CONSTRAINT cam_machines_created_by_fkey FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- CAM JOBS: the queue
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.cam_jobs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  name text,
  source_type text NOT NULL DEFAULT 'upload',
  part_id bigint,
  step_file_name text,
  operation_type text NOT NULL DEFAULT 'routing',
  params jsonb NOT NULL DEFAULT '{}'::jsonb,
  material_id uuid,
  tool_id uuid,
  machine_id uuid,
  status text NOT NULL DEFAULT 'queued',
  claimed_by text,
  claimed_at timestamp with time zone,
  gcode text,
  gcode_file_name text,
  gcode_format text NOT NULL DEFAULT 'ngc',
  errors text[],
  warnings text[],
  stats jsonb,
  progress integer NOT NULL DEFAULT 0, -- 0-100, written incrementally during generation so the UI can show real progress instead of an indefinite spinner
  progress_message text, -- short human-readable stage label, e.g. "Extracting toolpath geometry..."
  requested_by uuid,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT cam_jobs_pkey PRIMARY KEY (id)
);
-- Every column added explicitly too, in case an earlier revision of this
-- table already exists without some of them.
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS name text; -- user-given job name; falls back to the part/file name in the UI when blank
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS source_type text NOT NULL DEFAULT 'upload';
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS part_id bigint;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS step_file_name text; -- storage path of the STEP file - both the 3D viewer AND CAM generation read this
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS operation_type text NOT NULL DEFAULT 'routing';
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS params jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS material_id uuid;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS tool_id uuid;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS machine_id uuid;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'queued';
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS claimed_by text; -- reserved for a future external Runner (milling only - see autocam-runner/README.md)
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS claimed_at timestamp with time zone;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS gcode text;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS gcode_file_name text;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS gcode_format text NOT NULL DEFAULT 'ngc'; -- must stay 'ngc'
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS errors text[];
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS warnings text[];
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS stats jsonb;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS progress integer NOT NULL DEFAULT 0;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS progress_message text;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS requested_by uuid;
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS created_at timestamp with time zone DEFAULT now();
ALTER TABLE public.cam_jobs ADD COLUMN IF NOT EXISTS updated_at timestamp with time zone DEFAULT now();
-- A very early revision of this table had a separate `profile_file_name`
-- column before it was merged into `step_file_name` - drop it if present.
ALTER TABLE public.cam_jobs DROP COLUMN IF EXISTS profile_file_name;

DO $$ BEGIN
  ALTER TABLE public.cam_jobs ADD CONSTRAINT cam_jobs_source_type_check CHECK (source_type = ANY (ARRAY['upload'::text, 'part'::text]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_jobs ADD CONSTRAINT cam_jobs_operation_type_check CHECK (operation_type = ANY (ARRAY['turning'::text, 'routing'::text, 'milling'::text]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_jobs ADD CONSTRAINT cam_jobs_status_check CHECK (status = ANY (ARRAY['queued'::text, 'claimed'::text, 'processing'::text, 'completed'::text, 'failed'::text, 'rejected'::text]));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_jobs ADD CONSTRAINT cam_jobs_part_id_fkey FOREIGN KEY (part_id) REFERENCES public.parts(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_jobs ADD CONSTRAINT cam_jobs_material_id_fkey FOREIGN KEY (material_id) REFERENCES public.cam_materials(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_jobs ADD CONSTRAINT cam_jobs_tool_id_fkey FOREIGN KEY (tool_id) REFERENCES public.cam_tools(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_jobs ADD CONSTRAINT cam_jobs_machine_id_fkey FOREIGN KEY (machine_id) REFERENCES public.cam_machines(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE public.cam_jobs ADD CONSTRAINT cam_jobs_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES auth.users(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_cam_jobs_status ON public.cam_jobs(status);
CREATE INDEX IF NOT EXISTS idx_cam_jobs_part_id ON public.cam_jobs(part_id);
CREATE INDEX IF NOT EXISTS idx_cam_jobs_created_at ON public.cam_jobs(created_at);

-- ============================================================================
-- ROW LEVEL SECURITY
-- ============================================================================
ALTER TABLE public.cam_materials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cam_tools ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cam_machines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cam_jobs ENABLE ROW LEVEL SECURITY;

-- Reference tables: readable by any approved user, writable by any
-- authenticated user (mirrors the existing autocam_profiles/autocam_settings
-- policy shape - the manufacturing-lead gate for editing is enforced in the
-- frontend, same as /manufacture/autocam today).
DROP POLICY IF EXISTS "cam_materials_select" ON public.cam_materials;
CREATE POLICY "cam_materials_select" ON public.cam_materials FOR SELECT TO authenticated USING (public.approved_user());
DROP POLICY IF EXISTS "cam_materials_write" ON public.cam_materials;
CREATE POLICY "cam_materials_write" ON public.cam_materials FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "cam_tools_select" ON public.cam_tools;
CREATE POLICY "cam_tools_select" ON public.cam_tools FOR SELECT TO authenticated USING (public.approved_user());
DROP POLICY IF EXISTS "cam_tools_write" ON public.cam_tools;
CREATE POLICY "cam_tools_write" ON public.cam_tools FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "cam_machines_select" ON public.cam_machines;
CREATE POLICY "cam_machines_select" ON public.cam_machines FOR SELECT TO authenticated USING (public.approved_user());
DROP POLICY IF EXISTS "cam_machines_write" ON public.cam_machines;
CREATE POLICY "cam_machines_write" ON public.cam_machines FOR ALL TO authenticated USING (auth.role() = 'authenticated') WITH CHECK (auth.role() = 'authenticated');

-- Jobs: same approved_user() gate the purchasing/parts tables use.
DROP POLICY IF EXISTS "cam_jobs_select" ON public.cam_jobs;
CREATE POLICY "cam_jobs_select" ON public.cam_jobs FOR SELECT TO authenticated USING (public.approved_user());
DROP POLICY IF EXISTS "cam_jobs_insert" ON public.cam_jobs;
CREATE POLICY "cam_jobs_insert" ON public.cam_jobs FOR INSERT TO authenticated WITH CHECK (public.approved_user());
DROP POLICY IF EXISTS "cam_jobs_update" ON public.cam_jobs;
CREATE POLICY "cam_jobs_update" ON public.cam_jobs FOR UPDATE TO authenticated USING (public.approved_user()) WITH CHECK (public.approved_user());
DROP POLICY IF EXISTS "cam_jobs_delete" ON public.cam_jobs;
CREATE POLICY "cam_jobs_delete" ON public.cam_jobs FOR DELETE TO authenticated USING (public.approved_user());

DROP POLICY IF EXISTS "cam_materials_service_all" ON public.cam_materials;
CREATE POLICY "cam_materials_service_all" ON public.cam_materials TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cam_tools_service_all" ON public.cam_tools;
CREATE POLICY "cam_tools_service_all" ON public.cam_tools TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cam_machines_service_all" ON public.cam_machines;
CREATE POLICY "cam_machines_service_all" ON public.cam_machines TO service_role USING (true) WITH CHECK (true);
DROP POLICY IF EXISTS "cam_jobs_service_all" ON public.cam_jobs;
CREATE POLICY "cam_jobs_service_all" ON public.cam_jobs TO service_role USING (true) WITH CHECK (true);

-- ============================================================================
-- TRIGGER: updated_at
-- ============================================================================
CREATE OR REPLACE FUNCTION public.update_cam_studio_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cam_materials_updated_at ON public.cam_materials;
CREATE TRIGGER cam_materials_updated_at BEFORE UPDATE ON public.cam_materials FOR EACH ROW EXECUTE FUNCTION public.update_cam_studio_updated_at();

DROP TRIGGER IF EXISTS cam_tools_updated_at ON public.cam_tools;
CREATE TRIGGER cam_tools_updated_at BEFORE UPDATE ON public.cam_tools FOR EACH ROW EXECUTE FUNCTION public.update_cam_studio_updated_at();

DROP TRIGGER IF EXISTS cam_machines_updated_at ON public.cam_machines;
CREATE TRIGGER cam_machines_updated_at BEFORE UPDATE ON public.cam_machines FOR EACH ROW EXECUTE FUNCTION public.update_cam_studio_updated_at();

DROP TRIGGER IF EXISTS cam_jobs_updated_at ON public.cam_jobs;
CREATE TRIGGER cam_jobs_updated_at BEFORE UPDATE ON public.cam_jobs FOR EACH ROW EXECUTE FUNCTION public.update_cam_studio_updated_at();

-- ============================================================================
-- ACTIVITY LOG INTEGRATION - INTENTIONALLY DEFERRED
-- ============================================================================
-- The Admin Activity Log (src/routes/admin/ActivityLogTab.svelte) reads from
-- a generic `activity_log` table populated by a trigger that is NOT checked
-- into this repo (not in schema.sql or any migrations/*.sql file - it only
-- exists live in Supabase). Attaching these tables to it requires knowing
-- that trigger function's real name/definition first, to avoid guessing and
-- risking a broken or duplicate logger on a table shared by the whole app.
--
-- TODO once the trigger function name/definition is known, add here:
--   DROP TRIGGER IF EXISTS cam_jobs_activity_log ON public.cam_jobs;
--   CREATE TRIGGER cam_jobs_activity_log AFTER INSERT OR UPDATE OR DELETE
--     ON public.cam_jobs FOR EACH ROW EXECUTE FUNCTION public.<real_function_name>();
--   (repeat for cam_materials / cam_tools / cam_machines)

-- ============================================================================
-- SEED DATA (idempotent - ON CONFLICT (name) needs the UNIQUE constraints above)
-- ============================================================================
INSERT INTO public.cam_materials (name, category) VALUES
  ('Aluminum 6061', 'aluminum'),
  ('Polycarbonate (Lexan)', 'polycarbonate'),
  ('Baltic Birch Plywood', 'plywood'),
  ('Delrin (Acetal)', 'delrin')
ON CONFLICT (name) DO NOTHING;

-- Machine profiles. Defaults are reasonable starting points (documented as
-- such in the generators themselves) - edit them from the AutoCAM "Manage
-- Profiles" panel once real values for these machines are known.
INSERT INTO public.cam_machines (name, description, operation_type, default_params) VALUES
  ('971 Lathe', 'Haas TL-1', 'turning', '{
    "stepDown": 0.05, "finishAllowance": 0.02, "feedRough": 0.008,
    "feedFinish": 0.004, "surfaceSpeed": 150, "maxRpm": 2500
  }'::jsonb),
  ('UNC Router', 'Router #1', 'routing', '{
    "toolDiameter": 0.25, "stepDown": 0.1, "tabWidth": 0.25, "tabHeight": 0.06,
    "tabSpacing": 6, "feedRate": 40, "plungeRate": 15, "spindleSpeed": 16000
  }'::jsonb),
  ('New Router', 'Router #2', 'routing', '{
    "toolDiameter": 0.25, "stepDown": 0.1, "tabWidth": 0.25, "tabHeight": 0.06,
    "tabSpacing": 6, "feedRate": 40, "plungeRate": 15, "spindleSpeed": 16000
  }'::jsonb)
ON CONFLICT (name) DO NOTHING;
