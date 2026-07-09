# Build Approval System Removal Migration

This migration removes the build approval workflow and implements immediate build creation.

## What This Migration Does

### ✅ Removes Approval System
- Removes `approved`, `approver`, `slack_channel`, `slack_ts` fields from `builds` table
- Removes old approval flag columns from `build_bom` table
- Eliminates the need for Slack approval notifications

### ✅ Implements Immediate Build Creation
- Builds are created with `approved: true` by default
- Parts, purchasing, and kitting entries are created instantly
- No waiting for approval process

### ✅ Adds Relational Design
- Adds `parts_id`, `purchasing_id`, `kitting_id` foreign keys to `build_bom`
- Links BOM items directly to their created entries
- Maintains data integrity with proper relationships

## How to Run the Migration

### Option 1: Via Supabase Dashboard
1. Go to your Supabase project dashboard
2. Navigate to the SQL Editor
3. Copy and paste the contents of `migration_remove_approval_system.sql`
4. Click "Run" to execute the migration

### Option 2: Via Command Line
```bash
# If using psql
psql -h your-db-host -U your-username -d your-database -f migration_remove_approval_system.sql

# Or if using a Supabase CLI
supabase db push
```

## Migration Safety Features

- **Idempotent**: Can be run multiple times safely
- **Conditional Logic**: Only adds/removes columns if they don't exist/exist
- **No Data Loss**: Preserves all existing data
- **Backward Compatible**: Doesn't break existing functionality

## After Migration

### What Changes:
- ✅ Builds are created immediately when "Create Build" is pressed
- ✅ All selected parts are created instantly in their respective tables
- ✅ No more approval workflow or Slack notifications for builds
- ✅ Build detail page shows parts immediately
- ✅ Can add more parts to existing builds using "Add" buttons

### What Stays the Same:
- ✅ Purchasing approval system remains intact (separate from build approval)
- ✅ All existing data is preserved
- ✅ User permissions and authentication unchanged
- ✅ Other features (CAD integration, etc.) work as before

## Verification

After running the migration, you can verify it worked by:

1. **Check Table Schema**:
```sql
-- Verify builds table no longer has approval fields
SELECT column_name FROM information_schema.columns
WHERE table_name = 'builds' AND table_schema = 'public';

-- Verify build_bom has new relational fields
SELECT column_name FROM information_schema.columns
WHERE table_name = 'build_bom' AND table_schema = 'public';
```

2. **Test Build Creation**:
- Go to CAD → Select a subsystem/version
- Add some parts to the build queue
- Press "Create Build"
- Verify the build is created immediately with all parts

## Rollback (If Needed)

If you need to rollback, you can restore the approval fields:

```sql
-- Add back approval fields to builds table
ALTER TABLE public.builds
ADD COLUMN approved boolean DEFAULT false,
ADD COLUMN approver text,
ADD COLUMN slack_channel text,
ADD COLUMN slack_ts text;
```

But note: The application code has been updated to work without approval, so you'd need to revert those changes too.

## Support

If you encounter any issues with this migration:
1. Check the Supabase logs for error messages
2. Verify your database permissions
3. Ensure no other processes are using the tables during migration