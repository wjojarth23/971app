-- Migration: Convert attendance system to use three-octet text matching
-- This migration changes the attendance location matching from inet type to text type
-- for privacy-focused network prefix matching (first 3 octets only)

-- Step 1: Alter the attendance_locations table to use text instead of inet
ALTER TABLE public.attendance_locations 
  ALTER COLUMN network_cidr TYPE text USING network_cidr::text;

-- Step 2: Update any existing data to ensure it's in three-octet format
-- This normalizes any full IPs or CIDR notation to just the first 3 octets
UPDATE public.attendance_locations
SET network_cidr = CASE
  WHEN network_cidr ~ '^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}' THEN 
    regexp_replace(network_cidr, '^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}.*', '\1')
  WHEN network_cidr ~ '^[0-9a-fA-F:]+' THEN
    -- For IPv6, keep first 4 hextets
    regexp_replace(network_cidr, '^([0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+:[0-9a-fA-F]+):.*', '\1')
  ELSE network_cidr
END
WHERE network_cidr IS NOT NULL;

-- Step 3: Drop and recreate the log_user_attendance function to use text matching
DROP FUNCTION IF EXISTS public.log_user_attendance(uuid, inet);
DROP FUNCTION IF EXISTS public.log_user_attendance(uuid, text);

CREATE OR REPLACE FUNCTION public.log_user_attendance(
  p_user_id uuid,
  p_external_ip text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_location_id uuid;
  v_schedule_id uuid;
  v_now timestamptz := now();
  v_current_time time := v_now::time;
  v_current_day int := EXTRACT(DOW FROM v_now)::int;
  v_today_date date := v_now::date;
  v_existing_count int;
BEGIN
  -- Validate input
  IF p_user_id IS NULL OR p_external_ip IS NULL OR p_external_ip = '' THEN
    RETURN false;
  END IF;

  -- Find matching active schedule and location based on:
  -- 1. Current day of week
  -- 2. Current time within schedule window
  -- 3. Network prefix match (text equality)
  -- 4. Both schedule and location are active
  SELECT 
    asl.location_id,
    asl.schedule_id
  INTO 
    v_location_id,
    v_schedule_id
  FROM public.attendance_schedule_locations asl
  INNER JOIN public.attendance_schedules asched 
    ON asl.schedule_id = asched.id
  INNER JOIN public.attendance_locations aloc 
    ON asl.location_id = aloc.id
  WHERE 
    asched.active = true
    AND aloc.active = true
    AND asched.day_of_week = v_current_day
    AND v_current_time >= asched.start_time
    AND v_current_time <= asched.end_time
    AND aloc.network_cidr = p_external_ip  -- Simple text equality match
  LIMIT 1;

  -- If no matching schedule/location found, return false
  IF v_location_id IS NULL OR v_schedule_id IS NULL THEN
    RETURN false;
  END IF;

  -- Check if user already has attendance logged today for this location
  SELECT COUNT(*)
  INTO v_existing_count
  FROM public.user_attendance_logs
  WHERE 
    user_id = p_user_id
    AND location_id = v_location_id
    AND recorded_at::date = v_today_date;

  -- If already logged today at this location, don't log again
  IF v_existing_count > 0 THEN
    RETURN false;
  END IF;

  -- Log the attendance
  INSERT INTO public.user_attendance_logs (
    user_id,
    location_id,
    schedule_id,
    recorded_at
  ) VALUES (
    p_user_id,
    v_location_id,
    v_schedule_id,
    v_now
  );

  RETURN true;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION public.log_user_attendance(uuid, text) TO authenticated;

-- Add comment explaining the three-octet system
COMMENT ON FUNCTION public.log_user_attendance(uuid, text) IS 
'Logs user attendance based on three-octet network prefix matching. 
The p_external_ip parameter should be a three-octet prefix (e.g., "205.167.46") 
for IPv4 or four-hextet prefix for IPv6. This provides privacy by not storing 
or matching full IP addresses.';

COMMENT ON COLUMN public.attendance_locations.network_cidr IS 
'Network prefix for location matching. Should be three octets for IPv4 (e.g., "205.167.46") 
or four hextets for IPv6 (e.g., "2001:db8:1234:5678"). Despite the column name, 
this is NOT CIDR notation - it is a simple text prefix for privacy-focused matching.';
