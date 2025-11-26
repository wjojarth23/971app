-- Add frc_team column to user_profiles
-- This column stores the user's FRC team affiliation: '971', '9584', or 'Mentor'
-- Default is NULL (unspecified) for existing users

ALTER TABLE public.user_profiles
  ADD COLUMN IF NOT EXISTS frc_team text DEFAULT NULL;

-- Add a check constraint to ensure only valid values
ALTER TABLE public.user_profiles
  ADD CONSTRAINT user_profiles_frc_team_check 
  CHECK (frc_team IS NULL OR frc_team IN ('971', '9584', 'Mentor'));

-- Add frc_team column to rosters table for filtering roster visibility
-- This allows rosters to be targeted at specific teams or all students
ALTER TABLE public.rosters
  ADD COLUMN IF NOT EXISTS target_frc_team text DEFAULT 'all';

-- Add check constraint for roster target_frc_team
ALTER TABLE public.rosters
  ADD CONSTRAINT rosters_target_frc_team_check
  CHECK (target_frc_team IN ('all', 'students', '971', '9584'));

-- Comment on columns
COMMENT ON COLUMN public.user_profiles.frc_team IS 'FRC team affiliation: 971, 9584, or Mentor';
COMMENT ON COLUMN public.rosters.target_frc_team IS 'Filter for roster visibility: all, students (971+9584), 971, or 9584';
