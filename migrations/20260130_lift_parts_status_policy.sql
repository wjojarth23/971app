-- Migration: Lift parts status CHECK constraint
-- Removes the restrictive status enum constraint to allow any text status value
-- This enables flexible, custom status values for manufacturing workflows

-- ============================================================================
-- DROP RESTRICTIVE STATUS CONSTRAINT
-- ============================================================================
ALTER TABLE public.parts 
  DROP CONSTRAINT IF EXISTS parts_status_check;

-- No replacement constraint - allows any text status value
