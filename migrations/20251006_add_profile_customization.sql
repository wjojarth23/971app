-- Migration: add profile customization columns to user_profiles
-- Created: 2025-10-06
-- Run this file against your Supabase/Postgres database (psql or Supabase SQL editor)

BEGIN;

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS header_tabs jsonb DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS dashboard_layout text DEFAULT 'grid';

-- Optional: initialize header_tabs for existing users to a reasonable default manifest
-- This sets visible tabs to those in navigation.json where value is true
-- Update the list below if you prefer a different default

-- Example default manifest (simple):
-- [
--   {"type":"tab","key":"manufacture","label":"Manufacture"},
--   {"type":"tab","key":"cad","label":"CAD"},
--   {"type":"tab","key":"purchasing","label":"Purchasing"}
-- ]

COMMIT;
