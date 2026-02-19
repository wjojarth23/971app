-- Migration: Add new columns to router_groups table for enhanced Router Tab functionality
-- Run this migration to support the new Router Tab redesign

-- Add new columns to router_groups table
ALTER TABLE public.router_groups 
  ADD COLUMN IF NOT EXISTS machine text DEFAULT '',
  ADD COLUMN IF NOT EXISTS material text DEFAULT '',
  ADD COLUMN IF NOT EXISTS status text DEFAULT '',
  ADD COLUMN IF NOT EXISTS stock text DEFAULT '',
  ADD COLUMN IF NOT EXISTS queue_position integer DEFAULT 999,
  ADD COLUMN IF NOT EXISTS target_date date,
  ADD COLUMN IF NOT EXISTS post_processing_stage text;

-- Add comments for documentation
COMMENT ON COLUMN public.router_groups.machine IS 'The machine assigned to cut this group (e.g., Avid CNC)';
COMMENT ON COLUMN public.router_groups.material IS 'Material type for the group';
COMMENT ON COLUMN public.router_groups.status IS 'Group-level status (Pending, CAM Reviewed, TravisProgged, Machined)';
COMMENT ON COLUMN public.router_groups.stock IS 'Stock assignment for the group (from stock.json options)';
COMMENT ON COLUMN public.router_groups.queue_position IS 'Position in the router queue (lower = higher priority)';
COMMENT ON COLUMN public.router_groups.target_date IS 'Target date for completing this group';
COMMENT ON COLUMN public.router_groups.post_processing_stage IS 'Current stage in post-processing (Jigsawed, Countersinking, Deburring, Inspecting, Kitted)';

-- Create index for queue ordering
CREATE INDEX IF NOT EXISTS idx_router_groups_queue_position ON public.router_groups(queue_position);
