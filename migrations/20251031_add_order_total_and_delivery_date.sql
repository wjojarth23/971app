-- Migration: add order_total and delivery_date columns
-- Adds order_total to orders table and delivery_date to orders and purchasing tables.

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS order_total numeric NOT NULL DEFAULT 0;

ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS delivery_date date;

ALTER TABLE public.purchasing
  ADD COLUMN IF NOT EXISTS delivery_date date;

-- Backfill: if any existing orders have shipping_cost > 0 and total_cost exists, we cannot reliably
-- compute order_total unless you want to set it to total_cost + shipping_cost. Optionally backfill as:
-- UPDATE public.orders SET order_total = total_cost + shipping_cost WHERE order_total = 0;

-- Note: Make sure to review any application code (insert/update) to populate these columns when creating orders.
