-- Capture FRC team ownership on subsystems, builds, parts, and purchasing rows
-- so UI can highlight work coming from Team 9584 students.
BEGIN;

-- Subsystems inherit the lead's FRC affiliation
ALTER TABLE public.subsystems
  ADD COLUMN IF NOT EXISTS frc_team text;
ALTER TABLE public.subsystems
  DROP CONSTRAINT IF EXISTS subsystems_frc_team_check;
ALTER TABLE public.subsystems
  ADD CONSTRAINT subsystems_frc_team_check
  CHECK (frc_team IS NULL OR frc_team IN ('971', '9584', 'Mentor'));
COMMENT ON COLUMN public.subsystems.frc_team IS 'Originating FRC team (971, 9584, Mentor) based on the student who created the subsystem.';

-- Builds inherit the creator's FRC affiliation
ALTER TABLE public.builds
  ADD COLUMN IF NOT EXISTS frc_team text;
ALTER TABLE public.builds
  DROP CONSTRAINT IF EXISTS builds_frc_team_check;
ALTER TABLE public.builds
  ADD CONSTRAINT builds_frc_team_check
  CHECK (frc_team IS NULL OR frc_team IN ('971', '9584', 'Mentor'));
COMMENT ON COLUMN public.builds.frc_team IS 'Originating FRC team (971, 9584, Mentor) based on the student who created the build.';

-- Manufactured parts inherit the requester affiliation at creation time
ALTER TABLE public.parts
  ADD COLUMN IF NOT EXISTS frc_team text;
ALTER TABLE public.parts
  DROP CONSTRAINT IF EXISTS parts_frc_team_check;
ALTER TABLE public.parts
  ADD CONSTRAINT parts_frc_team_check
  CHECK (frc_team IS NULL OR frc_team IN ('971', '9584', 'Mentor'));
COMMENT ON COLUMN public.parts.frc_team IS 'FRC team of the student who requested the part.';

-- Purchasing items inherit the requester affiliation at creation time
ALTER TABLE public.purchasing
  ADD COLUMN IF NOT EXISTS frc_team text;
ALTER TABLE public.purchasing
  DROP CONSTRAINT IF EXISTS purchasing_frc_team_check;
ALTER TABLE public.purchasing
  ADD CONSTRAINT purchasing_frc_team_check
  CHECK (frc_team IS NULL OR frc_team IN ('971', '9584', 'Mentor'));
COMMENT ON COLUMN public.purchasing.frc_team IS 'FRC team of the student who submitted the purchase request.';

-- Backfill what we can from user profile metadata
UPDATE public.subsystems s
SET frc_team = up.frc_team
FROM public.user_profiles up
WHERE s.frc_team IS NULL
  AND s.lead_user_id = up.id
  AND up.frc_team IS NOT NULL;

UPDATE public.builds b
SET frc_team = up.frc_team
FROM public.user_profiles up
WHERE b.frc_team IS NULL
  AND b.created_by = up.id
  AND up.frc_team IS NOT NULL;

COMMIT;
