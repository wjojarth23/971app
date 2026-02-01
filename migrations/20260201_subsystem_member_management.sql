-- Migration: Add unique constraint for subsystem members and improve subsystem management
-- Date: 2026-02-01
-- Description: Adds unique constraint to prevent duplicate memberships and enables
--              proper member management by subsystem leads

-- Add unique constraint to prevent duplicate memberships
-- This ensures a user can only be a member of a subsystem once
ALTER TABLE public.subsystem_members 
ADD CONSTRAINT subsystem_members_unique_membership 
UNIQUE (subsystem_id, user_id);

-- Add index for faster lookups on subsystem membership queries
CREATE INDEX IF NOT EXISTS idx_subsystem_members_subsystem_id 
ON public.subsystem_members(subsystem_id);

CREATE INDEX IF NOT EXISTS idx_subsystem_members_user_id 
ON public.subsystem_members(user_id);

-- Add RLS policies for subsystem member management
-- Allow subsystem leads to manage members in their subsystems

-- Policy: Subsystem leads can view all members in their subsystem
CREATE POLICY "Subsystem leads can view their members"
ON public.subsystem_members
FOR SELECT
USING (
  EXISTS (
    SELECT 1 FROM public.subsystems s
    WHERE s.id = subsystem_members.subsystem_id
    AND s.lead_user_id = auth.uid()
  )
  OR user_id = auth.uid()  -- Users can always see their own membership
);

-- Policy: Subsystem leads can add members to their subsystems
CREATE POLICY "Subsystem leads can add members"
ON public.subsystem_members
FOR INSERT
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.subsystems s
    WHERE s.id = subsystem_members.subsystem_id
    AND s.lead_user_id = auth.uid()
  )
  OR user_id = auth.uid()  -- Users can add themselves (join)
);

-- Policy: Subsystem leads can remove members from their subsystems
-- (but not themselves if they're the lead)
CREATE POLICY "Subsystem leads can remove members"
ON public.subsystem_members
FOR DELETE
USING (
  EXISTS (
    SELECT 1 FROM public.subsystems s
    WHERE s.id = subsystem_members.subsystem_id
    AND s.lead_user_id = auth.uid()
    AND subsystem_members.user_id != s.lead_user_id  -- Can't remove the lead
  )
  OR (user_id = auth.uid() AND NOT EXISTS (
    SELECT 1 FROM public.subsystems s
    WHERE s.id = subsystem_members.subsystem_id
    AND s.lead_user_id = auth.uid()
  ))  -- Non-leads can remove themselves (leave)
);

-- Policy: Subsystem leads can update their subsystem's lead_user_id (transfer leadership)
CREATE POLICY "Subsystem leads can transfer leadership"
ON public.subsystems
FOR UPDATE
USING (lead_user_id = auth.uid())
WITH CHECK (true);

-- Note: Run this migration after backing up your database
-- Example: psql 'postgresql://...' -f 20260201_subsystem_member_management.sql
