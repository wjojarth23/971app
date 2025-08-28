-- Migration: Add attendance tracking functionality
-- This migration adds tables and columns to track user attendance based on external IP addresses

-- Create table to store allowed external IP addresses
CREATE TABLE public.allowed_external_ips (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  ip_address inet NOT NULL,
  location_name character varying NOT NULL,
  description text,
  created_at timestamp with time zone DEFAULT now(),
  updated_at timestamp with time zone DEFAULT now(),
  CONSTRAINT allowed_external_ips_pkey PRIMARY KEY (id),
  CONSTRAINT allowed_external_ips_ip_address_unique UNIQUE (ip_address)
);

-- Create table to track user login sessions from external IPs
CREATE TABLE public.user_attendance_logs (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  external_ip inet NOT NULL,
  location_name character varying,
  login_time timestamp with time zone DEFAULT now(),
  session_duration_minutes integer,
  created_at timestamp with time zone DEFAULT now(),
  CONSTRAINT user_attendance_logs_pkey PRIMARY KEY (id),
  CONSTRAINT user_attendance_logs_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id),
  CONSTRAINT user_attendance_logs_external_ip_fkey FOREIGN KEY (external_ip) REFERENCES public.allowed_external_ips(ip_address)
);

-- Add last_attendance_date to user_profiles table
ALTER TABLE public.user_profiles 
ADD COLUMN last_attendance_date timestamp with time zone,
ADD COLUMN total_attendance_days integer DEFAULT 0;

-- Create index for better performance on attendance queries
CREATE INDEX idx_user_attendance_logs_user_id_login_time ON public.user_attendance_logs(user_id, login_time);
CREATE INDEX idx_user_attendance_logs_login_time ON public.user_attendance_logs(login_time);
CREATE INDEX idx_user_attendance_logs_external_ip ON public.user_attendance_logs(external_ip);

-- Create view for attendance leaderboard (last 30 days)
CREATE OR REPLACE VIEW public.attendance_leaderboard_30_days AS
SELECT 
  up.id as user_id,
  up.full_name,
  up.email,
  COUNT(DISTINCT DATE(ual.login_time)) as days_attended,
  COUNT(ual.id) as total_logins,
  MAX(ual.login_time) as last_login,
  MIN(ual.login_time) as first_login_in_period,
  ARRAY_AGG(DISTINCT aei.location_name) as locations_visited
FROM public.user_profiles up
LEFT JOIN public.user_attendance_logs ual ON up.id = ual.user_id
LEFT JOIN public.allowed_external_ips aei ON ual.external_ip = aei.ip_address
WHERE ual.login_time >= NOW() - INTERVAL '30 days'
  OR ual.login_time IS NULL
GROUP BY up.id, up.full_name, up.email
ORDER BY days_attended DESC, total_logins DESC;

-- Create view for daily attendance summary
CREATE OR REPLACE VIEW public.daily_attendance_summary AS
SELECT 
  DATE(ual.login_time) as attendance_date,
  COUNT(DISTINCT ual.user_id) as unique_users,
  COUNT(ual.id) as total_logins,
  ARRAY_AGG(DISTINCT aei.location_name) as locations_used
FROM public.user_attendance_logs ual
JOIN public.allowed_external_ips aei ON ual.external_ip = aei.ip_address
WHERE ual.login_time >= NOW() - INTERVAL '30 days'
GROUP BY DATE(ual.login_time)
ORDER BY attendance_date DESC;

-- Insert some example allowed external IPs (you can modify these)
INSERT INTO public.allowed_external_ips (ip_address, location_name, description) VALUES
('192.168.1.100', 'Main Workshop', 'Primary workshop location with team workstations'),
('192.168.1.101', 'Design Lab', 'CAD and design workstation area'),
('192.168.1.102', 'Meeting Room', 'Conference room with shared computer'),
('10.0.1.50', 'Manufacturing Floor', 'Shop floor computer terminal');

-- Enable Row Level Security (RLS) for the new tables
ALTER TABLE public.allowed_external_ips ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_attendance_logs ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY "Allow all authenticated users to read allowed IPs" ON public.allowed_external_ips
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow all authenticated users to read attendance logs" ON public.user_attendance_logs
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "Allow users to insert their own attendance logs" ON public.user_attendance_logs
  FOR INSERT TO authenticated WITH CHECK (auth.uid() = user_id);

-- Function to log user attendance when they access from an allowed external IP
CREATE OR REPLACE FUNCTION public.log_user_attendance(
  p_user_id uuid,
  p_external_ip inet
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  ip_exists boolean;
  location_name_var character varying;
BEGIN
  -- Check if the external IP is in our allowed list
  SELECT EXISTS(
    SELECT 1 FROM public.allowed_external_ips 
    WHERE ip_address = p_external_ip
  ), location_name
  INTO ip_exists, location_name_var
  FROM public.allowed_external_ips 
  WHERE ip_address = p_external_ip;
  
  -- If IP is allowed, log the attendance
  IF ip_exists THEN
    -- Insert attendance log
    INSERT INTO public.user_attendance_logs (user_id, external_ip, location_name)
    VALUES (p_user_id, p_external_ip, location_name_var);
    
    -- Update user profile with last attendance date
    UPDATE public.user_profiles 
    SET 
      last_attendance_date = NOW(),
      total_attendance_days = (
        SELECT COUNT(DISTINCT DATE(login_time))
        FROM public.user_attendance_logs 
        WHERE user_id = p_user_id
      ),
      updated_at = NOW()
    WHERE id = p_user_id;
    
    RETURN true;
  END IF;
  
  RETURN false;
END;
$$;
