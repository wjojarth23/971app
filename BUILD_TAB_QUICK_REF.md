# Build Tab - Quick Reference

## What Changed?

### BEFORE:
```
┌─────────────────────────────────────┐
│  Build Components                   │
│  (All parts mixed together)         │
│  - Added parts                      │
│  - Unadded parts                    │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Full BOM                           │
│  (All BOM items, no version button) │
└─────────────────────────────────────┘
```

### AFTER:
```
┌─────────────────────────────────────┐
│  Build Components (Added Parts)    │
│  - Only shows parts that have been  │
│    added to the build               │
│  - These are the actual work items  │
└─────────────────────────────────────┘

┌─────────────────────────────────────┐
│  Full BOM (Unadded Parts)           │
│  [Change Version] button            │
│  - Only shows parts NOT yet added   │
│  - Can refetch from new version     │
└─────────────────────────────────────┘
```

## Version Refetch Flow

1. **Click "Change Version" button**
   ```
   User clicks button → Modal opens
   ```

2. **Select Version from Timeline**
   ```
   ┌────────────────────────────────┐
   │ Select Version to Load BOM     │
   ├────────────────────────────────┤
   │ ○ Version 2024-12-15 (Today)   │
   │ ✓ Version 2024-12-10 ← Selected│
   │ ○ Version 2024-12-05           │
   │ ○ Version 2024-11-30           │
   ├────────────────────────────────┤
   │ [Cancel] [Load BOM from Ver.]  │
   └────────────────────────────────┘
   ```

3. **System Processes BOM**
   ```
   Fetch BOM → Analyze Parts → Filter Duplicates → Insert New Parts
   ```

4. **Smart Duplicate Detection**
   ```
   For each new part:
     IF (name matches existing part) → SKIP
     OR (part_number matches existing) → SKIP
     ELSE → ADD to unadded BOM
   ```

## Example Scenario

### Initial State:
- Build has 5 parts added
- Full BOM shows 3 unadded parts

### User loads new version:
- New version has 10 parts total
- 4 parts match existing (by name/part number)
- 1 part is already added
- **Result: 5 new parts added to unadded BOM**

### After Refetch:
- Build Components: Still shows 5 added parts (unchanged)
- Full BOM: Now shows 8 unadded parts (3 old + 5 new)

## Code Locations

### Modified File:
`src/routes/cad/build/[id]/+page.svelte`

### New Functions:
- `openVersionSelector()` - Opens version modal
- `refetchBOMFromVersion()` - Fetches and merges BOM

### New State:
- `showVersionModal` - Controls modal visibility
- `versionTimeline` - List of available versions
- `selectedVersionForRefetch` - Currently selected version

### UI Changes:
- Split tables by added/unadded status
- Added "Change Version" button
- Added version selection modal
- Added duplicate filtering logic

## Key Features

✨ **Non-destructive**: Existing parts never modified
🔍 **Smart filtering**: Detects duplicates by name OR part number
🎯 **Focused tables**: Clear separation of added vs. unadded
🔄 **Easy updates**: Load new versions without losing work
📊 **Version history**: See last 15 versions
