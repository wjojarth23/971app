-- Migration: Add orders table and update purchasing for order management
-- Created: 2025-10-22

-- Create orders table to track batch orders
CREATE TABLE IF NOT EXISTS public.orders (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  order_number text NOT NULL UNIQUE,
  vendor text,
  total_items integer NOT NULL DEFAULT 0,
  total_cost numeric NOT NULL DEFAULT 0,
  shipping_cost numeric NOT NULL DEFAULT 0,
  placed_by uuid,
  placed_at timestamp with time zone NOT NULL DEFAULT now(),
  notes text,
  CONSTRAINT orders_pkey PRIMARY KEY (id),
  CONSTRAINT orders_placed_by_fkey FOREIGN KEY (placed_by) REFERENCES auth.users(id)
);

-- Add order tracking to purchasing table
ALTER TABLE public.purchasing 
  ADD COLUMN IF NOT EXISTS order_id bigint REFERENCES public.orders(id),
  ADD COLUMN IF NOT EXISTS shipping_cost_allocated numeric DEFAULT 0;

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS orders_vendor_idx ON public.orders(vendor);
CREATE INDEX IF NOT EXISTS orders_placed_by_idx ON public.orders(placed_by);
CREATE INDEX IF NOT EXISTS orders_placed_at_idx ON public.orders(placed_at);
CREATE INDEX IF NOT EXISTS purchasing_order_id_idx ON public.purchasing(order_id);

-- Update updated_at trigger if needed
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Add trigger to orders table
DROP TRIGGER IF EXISTS update_orders_updated_at ON public.orders;
CREATE TRIGGER update_orders_updated_at 
  BEFORE UPDATE ON public.orders 
  FOR EACH ROW 
  EXECUTE FUNCTION update_updated_at_column();
