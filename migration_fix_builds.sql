-- UNDO MIGRATION - Remove the incorrect build_bom table
-- This restores the correct design where builds reference existing parts by ID

-- 1. Drop the build_bom table (this was wrong!)
DROP TABLE IF EXISTS public.build_bom CASCADE;

-- 2. Add the correct column to builds table to store part IDs
ALTER TABLE public.builds 
ADD COLUMN IF NOT EXISTS part_ids integer[] DEFAULT '{}';

-- 3. Create index for part_ids array
CREATE INDEX IF NOT EXISTS idx_builds_part_ids ON public.builds USING GIN(part_ids);

-- 4. Create a helper function to add parts to a build
CREATE OR REPLACE FUNCTION add_part_to_build(build_uuid uuid, part_id integer)
RETURNS void AS $$
BEGIN
    UPDATE public.builds 
    SET part_ids = array_append(part_ids, part_id)
    WHERE id = build_uuid
    AND NOT (part_id = ANY(part_ids)); -- Don't add duplicates
END;
$$ LANGUAGE plpgsql;

-- 5. Create a helper function to get build with parts
CREATE OR REPLACE FUNCTION get_build_with_parts(build_uuid uuid)
RETURNS TABLE (
    build_id uuid,
    subsystem_id uuid,
    release_id character varying,
    release_name character varying,
    build_hash character varying,
    status character varying,
    created_by uuid,
    created_at timestamp with time zone,
    assembled_at timestamp with time zone,
    assembled_by uuid,
    part_ids integer[],
    parts_data jsonb
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        b.id,
        b.subsystem_id,
        b.release_id,
        b.release_name,
        b.build_hash,
        b.status,
        b.created_by,
        b.created_at,
        b.assembled_at,
        b.assembled_by,
        b.part_ids,
        (
            SELECT jsonb_agg(
                jsonb_build_object(
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
            )
            FROM public.parts p
            WHERE p.id = ANY(b.part_ids)
        ) as parts_data
    FROM public.builds b
    WHERE b.id = build_uuid;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions on the new function
GRANT EXECUTE ON FUNCTION add_part_to_build(uuid, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION get_build_with_parts(uuid) TO authenticated;
