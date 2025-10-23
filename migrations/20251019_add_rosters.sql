-- Add rosters table for managing groups of users
CREATE TABLE IF NOT EXISTS rosters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  created_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Add roster_members junction table
CREATE TABLE IF NOT EXISTS roster_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  roster_id UUID NOT NULL REFERENCES rosters(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  added_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  added_by UUID REFERENCES auth.users(id),
  UNIQUE(roster_id, user_id)
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_rosters_created_by ON rosters(created_by);
CREATE INDEX IF NOT EXISTS idx_roster_members_roster_id ON roster_members(roster_id);
CREATE INDEX IF NOT EXISTS idx_roster_members_user_id ON roster_members(user_id);

-- Enable RLS
ALTER TABLE rosters ENABLE ROW LEVEL SECURITY;
ALTER TABLE roster_members ENABLE ROW LEVEL SECURITY;

-- Policies for rosters (admins and users with VIEW_ADMIN_PANEL can manage)
CREATE POLICY "Anyone can view rosters" ON rosters FOR SELECT USING (true);
CREATE POLICY "Admins can create rosters" ON rosters FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND (role = 'admin' OR permissions @> ARRAY['VIEW_ADMIN_PANEL'])
  )
);
CREATE POLICY "Admins can update rosters" ON rosters FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND (role = 'admin' OR permissions @> ARRAY['VIEW_ADMIN_PANEL'])
  )
);
CREATE POLICY "Admins can delete rosters" ON rosters FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND (role = 'admin' OR permissions @> ARRAY['VIEW_ADMIN_PANEL'])
  )
);

-- Policies for roster_members
CREATE POLICY "Anyone can view roster members" ON roster_members FOR SELECT USING (true);
CREATE POLICY "Admins can add roster members" ON roster_members FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND (role = 'admin' OR permissions @> ARRAY['VIEW_ADMIN_PANEL'])
  )
);
CREATE POLICY "Admins can remove roster members" ON roster_members FOR DELETE USING (
  EXISTS (
    SELECT 1 FROM user_profiles 
    WHERE id = auth.uid() 
    AND (role = 'admin' OR permissions @> ARRAY['VIEW_ADMIN_PANEL'])
  )
);
