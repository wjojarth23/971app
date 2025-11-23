-- Add new role columns to user_profiles
ALTER TABLE public.user_profiles 
ADD COLUMN IF NOT EXISTS general_role text DEFAULT 'member',
ADD COLUMN IF NOT EXISTS purchasing_role text DEFAULT 'basic',
ADD COLUMN IF NOT EXISTS team_role text DEFAULT 'other';

-- Create rosters table
CREATE TABLE IF NOT EXISTS public.rosters (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    name text NOT NULL,
    is_public boolean DEFAULT false,
    is_admin_editable boolean DEFAULT false,
    type text CHECK (type IN ('single', 'multi')),
    created_by uuid REFERENCES public.user_profiles(id),
    created_at timestamp with time zone DEFAULT now(),
    updated_at timestamp with time zone DEFAULT now()
);

-- Create roster_keys table (the options available in a roster)
CREATE TABLE IF NOT EXISTS public.roster_keys (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    roster_id uuid REFERENCES public.rosters(id) ON DELETE CASCADE,
    key_name text NOT NULL,
    category text DEFAULT 'General', -- For accordion folders
    created_at timestamp with time zone DEFAULT now()
);

-- Create roster_entries table (assignments of keys to users)
CREATE TABLE IF NOT EXISTS public.roster_entries (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    roster_id uuid REFERENCES public.rosters(id) ON DELETE CASCADE,
    user_id uuid REFERENCES public.user_profiles(id) ON DELETE CASCADE,
    key_id uuid REFERENCES public.roster_keys(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now(),
    UNIQUE(roster_id, user_id, key_id)
);

-- Enable RLS
ALTER TABLE public.rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roster_entries ENABLE ROW LEVEL SECURITY;

-- Policies for rosters
CREATE POLICY "Rosters are viewable by everyone" ON public.rosters
    FOR SELECT USING (true);

CREATE POLICY "Rosters are editable by Leads and Subsystem Leads" ON public.rosters
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid() 
            AND (general_role = 'lead' OR general_role = 'subsystem_lead')
        )
    );

-- Policies for roster_keys
CREATE POLICY "Roster keys are viewable by everyone" ON public.roster_keys
    FOR SELECT USING (true);

CREATE POLICY "Roster keys are editable by Leads and Subsystem Leads" ON public.roster_keys
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid() 
            AND (general_role = 'lead' OR general_role = 'subsystem_lead')
        )
    );

-- Policies for roster_entries
CREATE POLICY "Roster entries are viewable by everyone" ON public.roster_entries
    FOR SELECT USING (true);

CREATE POLICY "Roster entries are editable by Leads and Subsystem Leads" ON public.roster_entries
    FOR ALL USING (
        EXISTS (
            SELECT 1 FROM public.user_profiles
            WHERE id = auth.uid() 
            AND (general_role = 'lead' OR general_role = 'subsystem_lead')
        )
    );

-- Initial Data Seeding

-- Create "Competition" Roster (assuming it doesn't exist, but we can't easily check in SQL script without PL/PGSQL block for UUIDs, so we'll do it in a block)
DO $$
DECLARE
    comp_roster_id uuid;
    man_roster_id uuid;
    admin_user_id uuid;
BEGIN
    -- Try to find an admin user to be the creator, or just leave null
    SELECT id INTO admin_user_id FROM public.user_profiles WHERE role = 'admin' LIMIT 1;

    -- Create Competition Roster
    INSERT INTO public.rosters (name, is_public, is_admin_editable, type, created_by)
    VALUES ('Competition Roles', true, true, 'multi', admin_user_id)
    RETURNING id INTO comp_roster_id;

    -- Add keys to Competition Roster
    INSERT INTO public.roster_keys (roster_id, key_name, category) VALUES
    (comp_roster_id, 'Video Scout Member', 'Scouting'),
    (comp_roster_id, 'Data Scout Member', 'Scouting'),
    (comp_roster_id, 'Video Scout Lead', 'Scouting'),
    (comp_roster_id, 'Data Scout Lead', 'Scouting');

    -- Create Manufacturing Roles Roster
    INSERT INTO public.rosters (name, is_public, is_admin_editable, type, created_by)
    VALUES ('Manufacturing Roles', true, true, 'multi', admin_user_id)
    RETURNING id INTO man_roster_id;

    -- Add keys to Manufacturing Roles Roster
    INSERT INTO public.roster_keys (roster_id, key_name, category) VALUES
    (man_roster_id, 'Lathe', 'Machining'),
    (man_roster_id, 'Mill', 'Machining'),
    (man_roster_id, 'Run Router', 'Machining'),
    (man_roster_id, 'CAM', 'Programming'),
    (man_roster_id, 'Travis Prog', 'Programming');

END $$;
