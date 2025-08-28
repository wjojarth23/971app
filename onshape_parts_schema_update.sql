-- Update database schema to support on-demand Onshape API calls for manufacturing parts
-- This eliminates the need for storage bucket intermediate files

-- First, let's add Onshape API parameters to the parts table
ALTER TABLE public.parts 
ADD COLUMN onshape_document_id character varying,
ADD COLUMN onshape_wvm character varying, -- 'w' for workspace, 'v' for version, 'm' for microversion
ADD COLUMN onshape_wvmid character varying, -- the actual workspace/version/microversion ID
ADD COLUMN onshape_element_id character varying,
ADD COLUMN onshape_part_id character varying,
ADD COLUMN file_format character varying CHECK (file_format IN ('stl', 'parasolid', 'step', 'iges')),
ADD COLUMN is_onshape_part boolean DEFAULT false;

-- Update the build_bom table to include Onshape parameters for consistency
ALTER TABLE public.build_bom 
ADD COLUMN onshape_document_id character varying,
ADD COLUMN onshape_wvm character varying, -- 'w' for workspace, 'v' for version, 'm' for microversion  
ADD COLUMN onshape_wvmid character varying, -- the actual workspace/version/microversion ID
ADD COLUMN onshape_element_id character varying,
ADD COLUMN file_format character varying CHECK (file_format IN ('stl', 'parasolid', 'step', 'iges')),
ADD COLUMN is_onshape_part boolean DEFAULT false;

-- Create an index for faster lookups by Onshape parameters
CREATE INDEX idx_parts_onshape_params ON public.parts(onshape_document_id, onshape_wvmid, onshape_element_id, onshape_part_id) 
WHERE is_onshape_part = true;

CREATE INDEX idx_build_bom_onshape_params ON public.build_bom(onshape_document_id, onshape_wvmid, onshape_element_id, onshape_part_id) 
WHERE is_onshape_part = true;

-- Create a function to construct the Onshape API URL for downloading files
CREATE OR REPLACE FUNCTION get_onshape_download_url(
    document_id text,
    wvm text,
    wvmid text,
    element_id text,
    part_id text,
    file_format text
) RETURNS text AS $$
BEGIN
    -- Construct the Onshape API URL based on file format
    IF file_format = 'stl' THEN
        RETURN '/parts/d/' || document_id || '/' || wvm || '/' || wvmid || '/e/' || element_id || '/partid/' || part_id || '/stl';
    ELSIF file_format = 'parasolid' THEN
        RETURN '/parts/d/' || document_id || '/' || wvm || '/' || wvmid || '/e/' || element_id || '/partid/' || part_id || '/parasolid';
    ELSIF file_format = 'step' THEN
        RETURN '/parts/d/' || document_id || '/' || wvm || '/' || wvmid || '/e/' || element_id || '/partid/' || part_id || '/step';
    ELSIF file_format = 'iges' THEN
        RETURN '/parts/d/' || document_id || '/' || wvm || '/' || wvmid || '/e/' || element_id || '/partid/' || part_id || '/iges';
    ELSE
        RETURN NULL;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Create a view that includes the constructed download URL for easy access
CREATE OR REPLACE VIEW parts_with_download_urls AS
SELECT 
    p.*,
    CASE 
        WHEN p.is_onshape_part = true THEN 
            get_onshape_download_url(
                p.onshape_document_id, 
                p.onshape_wvm, 
                p.onshape_wvmid, 
                p.onshape_element_id, 
                p.onshape_part_id, 
                p.file_format
            )
        ELSE p.file_url
    END AS download_url,
    CASE 
        WHEN p.is_onshape_part = true THEN 'onshape_api'
        ELSE 'storage_bucket'
    END AS source_type
FROM public.parts p;

-- Create a similar view for build_bom
CREATE OR REPLACE VIEW build_bom_with_download_urls AS
SELECT 
    bb.*,
    CASE 
        WHEN bb.is_onshape_part = true THEN 
            get_onshape_download_url(
                bb.onshape_document_id, 
                bb.onshape_wvm, 
                bb.onshape_wvmid, 
                bb.onshape_element_id, 
                bb.onshape_part_id, 
                bb.file_format
            )
        ELSE bb.file_url
    END AS download_url,
    CASE 
        WHEN bb.is_onshape_part = true THEN 'onshape_api'
        ELSE 'storage_bucket'
    END AS source_type
FROM public.build_bom bb;

-- Add comments to document the new approach
COMMENT ON COLUMN public.parts.onshape_document_id IS 'Onshape document ID for on-demand file retrieval';
COMMENT ON COLUMN public.parts.onshape_wvm IS 'Onshape workspace/version/microversion type (w/v/m)';
COMMENT ON COLUMN public.parts.onshape_wvmid IS 'Onshape workspace/version/microversion ID - CRITICAL for version consistency';
COMMENT ON COLUMN public.parts.onshape_element_id IS 'Onshape element ID containing the part';
COMMENT ON COLUMN public.parts.onshape_part_id IS 'Onshape part ID for the specific part';
COMMENT ON COLUMN public.parts.file_format IS 'File format to request from Onshape API (stl for 3D printing, parasolid for router)';
COMMENT ON COLUMN public.parts.is_onshape_part IS 'True if this part should be downloaded via Onshape API, false if using storage bucket';

COMMENT ON COLUMN public.build_bom.onshape_document_id IS 'Onshape document ID for on-demand file retrieval';
COMMENT ON COLUMN public.build_bom.onshape_wvm IS 'Onshape workspace/version/microversion type (w/v/m)';
COMMENT ON COLUMN public.build_bom.onshape_wvmid IS 'Onshape workspace/version/microversion ID - CRITICAL for version consistency';
COMMENT ON COLUMN public.build_bom.onshape_element_id IS 'Onshape element ID containing the part';
COMMENT ON COLUMN public.build_bom.file_format IS 'File format to request from Onshape API (stl for 3D printing, parasolid for router)';
COMMENT ON COLUMN public.build_bom.is_onshape_part IS 'True if this part should be downloaded via Onshape API, false if using storage bucket';

-- Create a trigger to automatically set file_format based on workflow for new parts
CREATE OR REPLACE FUNCTION set_onshape_file_format()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.is_onshape_part = true AND NEW.file_format IS NULL THEN
        CASE NEW.workflow
            WHEN '3d-print' THEN
                NEW.file_format := 'stl';
            WHEN 'router' THEN
                NEW.file_format := 'parasolid';
            WHEN 'laser-cut' THEN
                NEW.file_format := 'parasolid';
            WHEN 'mill' THEN
                NEW.file_format := 'parasolid';
            WHEN 'lathe' THEN
                NEW.file_format := 'parasolid';
            ELSE
                NEW.file_format := 'step'; -- Default fallback
        END CASE;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_parts_onshape_file_format
    BEFORE INSERT OR UPDATE ON public.parts
    FOR EACH ROW
    EXECUTE FUNCTION set_onshape_file_format();
