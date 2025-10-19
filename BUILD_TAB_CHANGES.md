# Build Tab Modifications - Version BOM Refetch

## Summary of Changes

Modified the build detail page (`src/routes/cad/build/[id]/+page.svelte`) to reorganize the tables and add version-based BOM refetch functionality.

## Key Changes

### 1. **Reorganized Tables**
   - **Top Table (Build Components)**: Now shows only parts that have been **added** to the build
   - **Bottom Table (Full BOM)**: Now shows only parts that have **not been added** yet
   - Parts are filtered based on the `added` flag and whether they have `parts_id`, `purchasing_id`, or `kitting_id`

### 2. **Version Selector Button**
   - Added "Change Version" button at the top of the unadded BOM section
   - Button opens a modal showing a timeline of available versions (last 15 versions)
   - Similar UI/UX to the build creation flow

### 3. **Version Selection Modal**
   - Displays version timeline with names and dates
   - Users can select a version by clicking on it
   - Selected version is highlighted with a checkmark
   - "Load BOM from Version" button to confirm selection

### 4. **Smart BOM Refetch Logic**
   - When a version is selected, the system:
     1. Fetches the BOM from OnShape for that specific version
     2. Analyzes the BOM (classifies parts as COTS/manufactured)
     3. Cross-checks new parts against already added parts by **name** and **part_number**
     4. Filters out any parts that match existing parts (by either name OR part number)
     5. Inserts only the new, non-duplicate parts into `build_bom` table
     6. Marks new parts as `added: false` so they appear in the unadded BOM section

### 5. **Duplicate Prevention**
   - Parts are considered duplicates if either:
     - The part name matches (case-insensitive)
     - The part number matches (case-insensitive)
   - Existing parts (already added to build) are preserved
   - Only new parts are added to the BOM

## Technical Details

### New State Variables
```javascript
let showVersionModal = false;
let versionTimeline = [];
let loadingVersions = false;
let selectedVersionForRefetch = null;
```

### New Functions

1. **`openVersionSelector()`**
   - Loads the version timeline from OnShape
   - Displays the last 15 versions
   - Opens the version selection modal

2. **`refetchBOMFromVersion()`**
   - Fetches BOM for the selected version
   - Filters out duplicate parts
   - Inserts new parts into `build_bom`
   - Reloads the build details

### UI Changes

- Added "Change Version" button with Download icon
- Added version selection modal with:
  - Version timeline list
  - Selection highlighting
  - Loading states
  - Cancel/Confirm actions

### Styling

- Added `.version-modal` styles
- Added `.version-timeline` styles for scrollable list
- Added `.version-item` styles for selectable version entries
- Added hover and selected states

## User Flow

1. User opens a build detail page
2. Top table shows all parts that have been added to the build
3. Bottom table shows all parts that haven't been added yet
4. User clicks "Change Version" button to load BOM from a different version
5. Modal opens showing available versions
6. User selects a version from the timeline
7. User clicks "Load BOM from Version"
8. System fetches BOM, filters duplicates, and adds new parts
9. New parts appear in the bottom "Unadded Parts" table
10. User can then add these parts to the build using the existing "Add" buttons

## Benefits

- ✅ Clear separation between added and unadded parts
- ✅ Easy version switching without losing existing parts
- ✅ Automatic duplicate prevention
- ✅ Preserves existing part configurations
- ✅ Consistent UI with existing build creation flow
- ✅ Non-destructive updates (existing parts are never modified)

## Notes

- The system cross-checks by both name AND part number to maximize duplicate detection
- If either field matches, the part is considered a duplicate
- All existing parts remain unchanged when loading a new version
- The version ID is stored in `onshape_wvmid` field for reference
