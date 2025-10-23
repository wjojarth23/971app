-- Migration: Add vendors table for purchasing management
-- Created: 2025-10-22

CREATE TABLE IF NOT EXISTS public.vendors (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  name text NOT NULL,
  url_base text NOT NULL,
  free_shipping boolean NOT NULL DEFAULT false,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT vendors_pkey PRIMARY KEY (id),
  CONSTRAINT vendors_name_unique UNIQUE (name)
);

-- Add indexes for better query performance
CREATE INDEX IF NOT EXISTS vendors_name_idx ON public.vendors(name);
CREATE INDEX IF NOT EXISTS vendors_url_base_idx ON public.vendors(url_base);
