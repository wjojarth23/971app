# Attendance Three-Octet System Migration

## Overview
This migration converts the attendance system from using PostgreSQL `inet` types to a text-based three-octet matching system for improved privacy.

## What Changed
- `attendance_locations.network_cidr` column changed from `inet` to `text`
- `log_user_attendance()` function now accepts `text` instead of `inet`
- All matching is done via simple text equality on three-octet prefixes
- Existing data is automatically normalized to three-octet format

## How to Apply

### Option 1: Via Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Copy the contents of `attendance_three_octet_system.sql`
4. Paste and run the SQL

### Option 2: Via Supabase CLI
```bash
# If you have supabase CLI installed
supabase db push
```

### Option 3: Via psql
```bash
psql "your-connection-string" < migrations/attendance_three_octet_system.sql
```

## Verification

After running the migration, verify it worked:

```sql
-- Check that network_cidr is now text type
SELECT column_name, data_type 
FROM information_schema.columns 
WHERE table_name = 'attendance_locations' 
  AND column_name = 'network_cidr';
-- Should show: data_type = 'text'

-- Check that existing data is normalized
SELECT id, name, network_cidr 
FROM attendance_locations;
-- Should show three-octet format like "205.167.46"

-- Test the function
SELECT log_user_attendance(
  'your-user-id'::uuid, 
  '205.167.46'
);
```

## Rollback (if needed)

If you need to rollback:

```sql
-- Restore inet type (will lose three-octet data)
ALTER TABLE public.attendance_locations 
  ALTER COLUMN network_cidr TYPE inet USING (network_cidr || '.0')::inet;

-- Recreate old function (you'll need the original definition)
```

## Notes
- The column name `network_cidr` is kept for backward compatibility, but it now stores text prefixes, not CIDR notation
- All existing location data will be automatically normalized to three-octet format
- The API code has been updated to work with this new system
