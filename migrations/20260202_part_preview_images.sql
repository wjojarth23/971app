-- Migration: Add preview_image_url column to parts table for caching Onshape part previews
-- Date: 2026-02-02
-- Description: Stores preview image URLs (from Supabase Storage) to avoid repeated Onshape API calls
-- 
-- PREREQUISITE: Create a storage bucket named 'part-previews' in Supabase Dashboard
--   - Go to Storage > New Bucket
--   - Name: part-previews
--   - Public bucket: Yes (so images can be displayed without auth)

-- Add preview_image_url column to store the storage path
ALTER TABLE public.parts 
ADD COLUMN IF NOT EXISTS preview_image_url text;

-- Add timestamp to track when the preview was last fetched
ALTER TABLE public.parts 
ADD COLUMN IF NOT EXISTS preview_image_updated_at timestamp with time zone;

-- Add index for faster queries when checking if preview exists
CREATE INDEX IF NOT EXISTS idx_parts_preview_image_exists 
ON public.parts ((preview_image_url IS NOT NULL));

-- Note: Run this migration after backing up your database
-- Example: psql 'postgresql://...' -f 20260202_part_preview_images.sql
