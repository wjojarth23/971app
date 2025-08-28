-- Migration: add approved and approver columns to purchasing table
-- Run this against your database (e.g. psql or Supabase SQL editor)

BEGIN;

-- Add a boolean approved flag (default false) and a text approver field
ALTER TABLE IF EXISTS purchasing
  ADD COLUMN IF NOT EXISTS approved boolean NOT NULL DEFAULT false;

ALTER TABLE IF EXISTS purchasing
  ADD COLUMN IF NOT EXISTS approver text;

COMMIT;
