# 971app Manufacture Hub Features Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 8 manufacturing workflow improvements to the 971app: status renames/additions, due dates, notes, team section separation, no-reload actions, restricted CAM review permission, step file validation, and a Machine button after CAM Review.

**Architecture:** Changes span `src/lib/statuses.js`, `src/lib/router_progress.js`, `src/lib/permissions.js`, and `src/routes/manufacture/+page.svelte` (the main hub — large file, ~2000 lines). Two new DB columns on `parts` via a migration SQL file. No new routes or components.

**Tech Stack:** SvelteKit 5, Supabase (Postgres), plain JS. Migration SQL run directly in Supabase dashboard or via CLI.

---

## File Map

| File | What Changes |
|---|---|
| `src/lib/statuses.js` | Rename TravisProgged → Jprogged, CAM Review Ready → CAM Review Pending, add Postprocessed |
| `src/lib/router_progress.js` | Add `postprocessed` router stage between `inspecting` and `kitted` |
| `src/lib/permissions.js` | Add `CAM_REVIEW_LEADS` allowlist and `canCamReview(user)` function |
| `migrations/20260617_parts_due_date_notes.sql` | ADD COLUMN `due_date date`, ADD COLUMN `notes text` on `parts` |
| `src/routes/manufacture/+page.svelte` | All 8 visible changes (buttons, sections, fields, reload fix) |
| `src/routes/manufacture/router/+page.svelte` | Update `canCamReview`, rename Jprogged labels in group status selector |

---

## Task 1: Rename statuses and add Postprocessed

**Files:**
- Modify: `src/lib/statuses.js`
- Modify: `src/lib/router_progress.js`

### What to change in `src/lib/statuses.js`

- [ ] **Step 1:** Replace `DISPLAY_ORDER` array — swap `'TravisProgged'` → `'Jprogged'`, `'CAM Review Ready'` → `'CAM Review Pending'`, add `'Postprocessed'` between `'Machined'` and `'Kitted'`:

```js
export const DISPLAY_ORDER = [
  'Pending', 'Autocammed', 'In Progress', 'CAM Review Pending',
  'CAM Reviewed', 'Jprogged', 'Machined', 'Postprocessed', 'Kitted'
];
```

- [ ] **Step 2:** Update `BUTTONS` object:

```js
export const BUTTONS = {
  PENDING: 'Pending',
  AUTOCAMMED: 'Autocammed',
  IN_PROGRESS: 'In Progress',
  CAM_REVIEW_PENDING: 'CAM Review Pending',   // was CAM_REVIEW_READY: 'CAM Review Ready'
  CAM_REVIEWED: 'CAM Reviewed',
  JPROGGED: 'Jprogged',                        // was TRAVIS: 'TravisProgged'
  MACHINED: 'Machined',
  POSTPROCESSED: 'Postprocessed',              // NEW
  KITTED: 'Kitted'
};
```

- [ ] **Step 3:** Update `WORKFLOW_STATUSES.router` array — rename labels:

```js
'router': [
  { value: 'pending', label: 'Pending' },
  { value: 'autocammed', label: 'Autocammed' },
  { value: 'in-progress', label: 'In Progress' },
  { value: 'cam_review', label: 'CAM Review Pending' },  // was 'CAM Review Ready'
  { value: 'cammed', label: 'CAM Reviewed' },
  { value: 'machined', label: 'Machined' },
  { value: 'postprocessed', label: 'Postprocessed' },    // NEW
  { value: 'complete', label: 'Kitted' }
],
```

- [ ] **Step 4:** Update `getDisplayStatus()` — replace TRAVIS with JPROGGED, CAM_REVIEW_READY with CAM_REVIEW_PENDING, add postprocessed:

```js
export function getDisplayStatus(status, meta) {
  const step = meta?.step ?? meta?.router_meta?.step;

  if (step === 'cam_review') return BUTTONS.CAM_REVIEW_PENDING;

  if (status === 'pending') return BUTTONS.PENDING;
  if (status === 'autocammed') return BUTTONS.AUTOCAMMED;
  if (status === 'in-progress') return BUTTONS.IN_PROGRESS;
  if (status === 'cam_review') return BUTTONS.CAM_REVIEW_PENDING;
  if (status === 'cammed') return BUTTONS.CAM_REVIEWED;
  if (status === 'postprocessed') return BUTTONS.POSTPROCESSED;
  if (status === 'machined' || status === 'inspected') return BUTTONS.MACHINED;
  if (status === 'kitted' || status === 'complete') return BUTTONS.KITTED;
  if (typeof status === 'string') return status.charAt(0).toUpperCase() + status.slice(1);
  return '';
}
```

- [ ] **Step 5:** Update `getBadgeClass()` — add postprocessed case:

```js
export function getBadgeClass(status, meta) {
  const step = meta?.step ?? meta?.router_meta?.step;

  if (step === 'cam_review') return 'status-cammed';
  if (status === 'autocammed') return 'status-autocammed';
  if (status === 'cam_review' || status === 'cammed') return 'status-cammed';
  if (status === 'in-progress') return 'status-progress';
  if (status === 'postprocessed') return 'status-progress';
  if (status === 'machined' || status === 'inspected') return 'status-progress';
  if (status === 'complete' || status === 'kitted') return 'status-complete';
  return 'status-pending';
}
```

### What to change in `src/lib/router_progress.js`

- [ ] **Step 6:** Add `postprocessed` to `ROUTER_STAGES` between `inspecting` and `kitted`:

```js
export const ROUTER_STAGES = [
  'pending', 'cam_ing', 'cam_review', 'cammed', 'queued',
  'cut', 'jigsawed', 'countersinking', 'deburred', 'inspecting',
  'postprocessed',   // NEW
  'kitted'
];
```

- [ ] **Step 7:** Add label to `ROUTER_STAGE_LABELS`:

```js
export const ROUTER_STAGE_LABELS = {
  // ... existing entries ...
  postprocessed: 'Postprocessed',   // NEW
  kitted: 'Kitted'
};
```

- [ ] **Step 8:** Update `ROUTER_POST_PROCESSING_STAGES` to include `postprocessed`:

```js
export const ROUTER_POST_PROCESSING_STAGES = [
  'cut', 'jigsawed', 'countersinking', 'deburred', 'inspecting', 'postprocessed', 'kitted'
];
```

- [ ] **Step 9:** Update `getLegacyStatusForStageCounts()` — add postprocessed to the machined branch:

```js
export function getLegacyStatusForStageCounts(counts) {
  if ((counts.kitted || 0) > 0 && Object.keys(counts).length === 1) return 'complete';
  if ((counts.cut || 0) > 0 || (counts.jigsawed || 0) > 0 ||
      (counts.countersinking || 0) > 0 || (counts.deburred || 0) > 0 ||
      (counts.inspecting || 0) > 0 || (counts.postprocessed || 0) > 0 ||
      (counts.kitted || 0) > 0) {
    return 'machined';
  }
  if ((counts.queued || 0) > 0 || (counts.cammed || 0) > 0) return 'cammed';
  if ((counts.cam_review || 0) > 0 || (counts.cam_ing || 0) > 0) return 'in-progress';
  return 'pending';
}
```

- [ ] **Step 10:** Update `getLegacyStepForStageCounts()` — add postprocessed between inspecting and kitted:

```js
export function getLegacyStepForStageCounts(counts) {
  if ((counts.kitted || 0) > 0) return 'kitted';
  if ((counts.postprocessed || 0) > 0) return 'postprocessed';  // NEW
  if ((counts.inspecting || 0) > 0) return 'inspecting';
  if ((counts.deburred || 0) > 0) return 'deburred';
  if ((counts.countersinking || 0) > 0) return 'countersinking';
  if ((counts.jigsawed || 0) > 0) return 'jigsawed';
  if ((counts.cut || 0) > 0) return 'cut';
  if ((counts.queued || 0) > 0) return 'queued';
  if ((counts.cammed || 0) > 0) return 'cammed';
  if ((counts.cam_review || 0) > 0) return 'cam_review';
  if ((counts.cam_ing || 0) > 0) return 'cam_ing';
  return 'pending';
}
```

---

## Task 2: Database migration — due_date and notes

**Files:**
- Create: `migrations/20260617_parts_due_date_notes.sql`

- [ ] **Step 1:** Create migration file:

```sql
-- Migration: Add due_date and notes to parts table
-- Run in Supabase dashboard > SQL Editor, or via CLI: supabase db push

ALTER TABLE public.parts
  ADD COLUMN IF NOT EXISTS due_date date,
  ADD COLUMN IF NOT EXISTS notes text;

COMMENT ON COLUMN public.parts.due_date IS 'Target completion date for this part';
COMMENT ON COLUMN public.parts.notes IS 'Free-text notes about this part (issues, instructions, context)';
```

- [ ] **Step 2:** Run this SQL in the Supabase dashboard SQL editor for the project. Verify with:

```sql
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'parts' AND column_name IN ('due_date', 'notes');
```

Expected: 2 rows returned.

---

## Task 3: CAM review permission allowlist

**Files:**
- Modify: `src/lib/permissions.js`

- [ ] **Step 1:** Add the allowlist constant and helper function at the bottom of `permissions.js`, before the `export default` or after the last export:

```js
// Temporary CAM review allowlist — replace with role-based check when ready
export const CAM_REVIEW_LEADS = ['Liam', 'Caden', 'Arya', 'Arnav', 'David'];

export function canCamReview(user) {
  if (!user) return false;
  const firstName = (user.full_name || '').trim().split(/\s+/)[0];
  return CAM_REVIEW_LEADS.includes(firstName);
}
```

Note: This file already exports `isManufacturingLead`. Keep that — it's used elsewhere for broader lead checks.

---

## Task 4: No-reload fix + Machine button + CAM Review permission update

**Files:**
- Modify: `src/routes/manufacture/+page.svelte`

This is the biggest task. Work through it section by section.

### 4a: Import `canCamReview` from permissions

- [ ] **Step 1:** Find the import line for `isManufacturingLead` (around line 14):

```js
import { isManufacturingLead } from '$lib/permissions.js';
```

Replace with:

```js
import { isManufacturingLead, canCamReview as camReviewAllowed } from '$lib/permissions.js';
```

- [ ] **Step 2:** Find the reactive declarations for `canCamReview` (around lines 53–54):

```js
$: canUseAssignMode = isManufacturingLead(user);
$: canCamReview = isManufacturingLead(user);
```

Change `canCamReview` line to:

```js
$: canCamReview = camReviewAllowed(user);
```

(Leave `canUseAssignMode` as-is — assign mode is separate from CAM review.)

### 4b: Remove loadParts() from updatePartStatus and updateRouterMeta

- [ ] **Step 3:** In `updatePartStatus` (around line 685), remove the `await loadParts()` call. The function should end like this:

```js
async function updatePartStatus(partId, newStatus) {
  try {
    const { error } = await supabase
      .from('parts')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', partId);
    if (error) throw error;
    if (newStatus === 'complete') {
      await sendNotification('part-complete', { part_id: partId });
    }
    // NOTE: No loadParts() here — callers use setLocalStatus for optimistic update
  } catch (error) {
    console.error('Error updating part status:', error);
    alert('Error updating part status. Please try again.');
  }
}
```

- [ ] **Step 4:** In `updateRouterMeta` (around line 770), remove the `await loadParts()` call:

```js
async function updateRouterMeta(part, updates) {
  try {
    let root = {};
    try { root = JSON.parse(part.file_url || '{}') || {}; } catch { root = {}; }
    root.router_meta = { ...(root.router_meta || {}), ...updates };
    const { error } = await supabase
      .from('parts')
      .update({ file_url: JSON.stringify(root), updated_at: new Date().toISOString() })
      .eq('id', part.id);
    if (error) console.warn('updateRouterMeta error:', error.message);
    // NOTE: No loadParts() here — callers use setLocalRouterMeta for optimistic update
  } catch (e) {
    console.warn('updateRouterMeta exception:', e?.message || e);
  }
}
```

### 4c: Add Machine button for cammed parts — card view

- [ ] **Step 5:** In the card view actions block (around line 1703), find the condition chain:

```svelte
{:else if part.status === 'in-progress'}
  {#if part.workflow === 'router'}
    ...CAM Done / CAM Reviewed buttons...
  {/if}
{/if}
```

After the closing `{/if}` of the `in-progress` block (around line 1723), add:

```svelte
{:else if part.status === 'cammed'}
  {#if part.workflow === 'router'}
    <button
      class="btn btn-primary btn-sm"
      on:click|stopPropagation={async () => {
        await updatePartStatus(part.id, 'machined');
        setLocalStatus(part.id, 'machined');
      }}
    >
      <Wrench size={14} /> Machine
    </button>
  {/if}
```

Note: `Wrench` is already imported from `lucide-svelte` (line ~22).

### 4d: Update table view action buttons — add setLocalStatus calls and Machine button

- [ ] **Step 6:** Find the table view's "Start" button for router parts (around line 1890). Its current `on:click`:

```js
on:click={async () => { await updatePartStatus(part.id, 'in-progress'); await updateRouterMeta(part, { step: 'cam_ing' }); }}
```

Replace with:

```js
on:click={async () => {
  await updatePartStatus(part.id, 'in-progress');
  await updateRouterMeta(part, { step: 'cam_ing' });
  setLocalStatus(part.id, 'in-progress');
  setLocalRouterMeta(part.id, { step: 'cam_ing' });
}}
```

- [ ] **Step 7:** Find the table view's "CAM Done" button (around line 1906). Its `on:click`:

```js
on:click={async () => { await updateRouterMeta(part, { step: 'cam_review' }); }}
```

Replace with:

```js
on:click={async () => {
  await updateRouterMeta(part, { step: 'cam_review' });
  setLocalRouterMeta(part.id, { step: 'cam_review' });
}}
```

- [ ] **Step 8:** Find the table view's "CAM Reviewed" button for `cam_review` step (around line 1922). Its `on:click`:

```js
on:click={async () => { await updatePartStatus(part.id, 'cammed'); await updateRouterMeta(part, { step: 'cammed' }); setLocalStatus(part.id, 'cammed'); setLocalRouterMeta(part.id, { step: 'cammed' }); }}
```

This already has setLocal calls — keep as-is.

- [ ] **Step 9:** After the `in-progress` block's closing `{/if}` in the table view (around line 1935), add the Machine button for cammed parts:

```svelte
{:else if part.status === 'cammed'}
  {#if part.workflow === 'router'}
    <button
      class="btn btn-secondary btn-sm"
      on:click={async () => {
        await updatePartStatus(part.id, 'machined');
        setLocalStatus(part.id, 'machined');
      }}
      title="Machine"
    >
      <Wrench size={14} />
      Machine
    </button>
  {/if}
```

---

## Task 5: Due dates display and edit in manufacture hub

**Files:**
- Modify: `src/routes/manufacture/+page.svelte`

- [ ] **Step 1:** Import `Calendar` from lucide-svelte if not already imported. Find:

```js
import { Search, Filter, Clock, Truck, Package, Download, Zap, Wrench, FileText, Upload, ExternalLink, Pencil, Trash2, X, Users } from 'lucide-svelte';
```

Add `Calendar` to this import (it's already used in the router page, verify if it's in this file).

- [ ] **Step 2:** In the card view's `part-card-details` section (around line 1640), add due date display after the "Created" row:

```svelte
{#if part.due_date}
  <div class="part-card-detail">
    <span class="detail-label">Due</span>
    <span class="detail-value" style="color: new Date(part.due_date) < new Date() ? 'var(--red-strong)' : 'inherit'">
      {formatDate(part.due_date)}
    </span>
  </div>
{/if}
```

- [ ] **Step 3:** In the table `<thead>`, add a "Due" column header after "Created":

```svelte
<th class:hidden={assignMode}>Due</th>
```

- [ ] **Step 4:** In the table `<tbody>` row, add corresponding `<td>` after the "Created" cell:

```svelte
<td class:hidden={assignMode}>{part.due_date ? formatDate(part.due_date) : '—'}</td>
```

- [ ] **Step 5:** Find the preview modal's editable fields (around the `previewStatus` / `previewWorkflow` section, ~line 1130). Add a `let previewDueDate = '';` variable in the state declarations:

```js
let previewDueDate = '';
```

- [ ] **Step 6:** In `openPreviewModal()` (around line 1108), initialize `previewDueDate`:

```js
previewDueDate = part.due_date || '';
```

- [ ] **Step 7:** In the preview modal save logic (around line 1236), include `due_date` in the update payload:

```js
const updatePayload = {
  status: previewStatus === 'cam_review' ? 'in-progress' : previewStatus,
  workflow: previewWorkflow,
  stock_assignment: previewStock || null,
  quantity: previewQuantity,
  due_date: previewDueDate || null,    // ADD THIS
  updated_at: new Date().toISOString()
};
```

- [ ] **Step 8:** In the preview modal HTML (find the `<div class="modal-body">` section of the preview modal), add a due date field in the editable section:

```svelte
<div class="form-group">
  <label class="form-label" for="preview-due-date">Due Date</label>
  <input
    id="preview-due-date"
    type="date"
    class="form-input"
    bind:value={previewDueDate}
  />
</div>
```

- [ ] **Step 9:** Similarly add `editDueDate` state for the edit modal, initialize in `openEditModal()`, include in save payload, and add `<input type="date">` in the edit modal HTML. Follow the exact same pattern as Steps 5–8 but for the `edit` prefix variables.

---

## Task 6: Notes section in modals

**Files:**
- Modify: `src/routes/manufacture/+page.svelte`

- [ ] **Step 1:** Add `let previewNotes = '';` to preview modal state variables.

- [ ] **Step 2:** In `openPreviewModal()`, initialize `previewNotes = part.notes || '';`

- [ ] **Step 3:** In the preview modal save payload, add `notes: previewNotes || null`.

- [ ] **Step 4:** In the preview modal HTML (edit section), add a notes textarea:

```svelte
<div class="form-group">
  <label class="form-label" for="preview-notes">Notes</label>
  <textarea
    id="preview-notes"
    class="form-input"
    rows="3"
    placeholder="Add notes about this part..."
    bind:value={previewNotes}
    style="resize: vertical;"
  ></textarea>
</div>
```

- [ ] **Step 5:** In card view, show notes when present (below `part-card-progress`):

```svelte
{#if part.notes}
  <div class="part-card-notes">
    <FileText size={12} />
    <span>{part.notes}</span>
  </div>
{/if}
```

Add matching CSS for `.part-card-notes`:

```css
.part-card-notes {
  display: flex;
  align-items: flex-start;
  gap: 4px;
  font-size: var(--font-xs);
  color: var(--text-muted);
  margin-top: var(--space-1);
  padding-top: var(--space-1);
  border-top: 1px solid var(--border);
}
```

- [ ] **Step 6:** Repeat Steps 1–3 for the edit modal (`editNotes`, `openEditModal`, save payload), and add the same textarea in the edit modal HTML.

---

## Task 7: Team section separator (971 vs 9584)

**Files:**
- Modify: `src/routes/manufacture/+page.svelte`

- [ ] **Step 1:** Add two reactive computed arrays in the `$:` declarations block (near the `filteredParts` declaration):

```js
$: team971Parts = filteredParts.filter(p => !isTeam9584(p.frc_team));
$: team9584Parts = filteredParts.filter(p => isTeam9584(p.frc_team));
```

- [ ] **Step 2:** In the **card view** (the `{#each filteredParts as part}` loop, around line 1592), replace the single `{#each filteredParts}` loop with two sections:

```svelte
<!-- Team 971 Section -->
{#if team971Parts.length > 0}
  <div class="team-section-header team-971-header">
    <span class="team-section-label">Team 971</span>
    <span class="team-section-count">{team971Parts.length}</span>
  </div>
  {#each team971Parts as part (part.id)}
    <!-- existing part-card markup, unchanged -->
  {/each}
{/if}

<!-- Divider -->
{#if team971Parts.length > 0 && team9584Parts.length > 0}
  <div class="team-section-divider"></div>
{/if}

<!-- Team 9584 Section -->
{#if team9584Parts.length > 0}
  <div class="team-section-header team-9584-header">
    <span class="team-section-label">Team 9584</span>
    <span class="team-section-count">{team9584Parts.length}</span>
  </div>
  {#each team9584Parts as part (part.id)}
    <!-- same part-card markup as above -->
  {/each}
{/if}
```

- [ ] **Step 3:** In the **table view** (`{#each filteredParts as part (part.id)}` in the `<tbody>`, around line 1751), replace with the same split pattern:

```svelte
{#each team971Parts as part (part.id)}
  <!-- existing <tr> markup unchanged -->
{/each}
{#if team971Parts.length > 0 && team9584Parts.length > 0}
  <tr class="team-section-divider-row">
    <td colspan="99">
      <div class="team-section-header team-9584-header">
        <span class="team-section-label">Team 9584</span>
        <span class="team-section-count">{team9584Parts.length}</span>
      </div>
    </td>
  </tr>
{/if}
{#each team9584Parts as part (part.id)}
  <!-- existing <tr> markup unchanged -->
{/each}
```

- [ ] **Step 4:** Add CSS for the new section elements:

```css
.team-section-header {
  display: flex;
  align-items: center;
  gap: var(--gap-2);
  padding: var(--space-2) var(--space-3);
  margin-top: var(--space-2);
  border-radius: var(--radius-sm);
  font-size: var(--font-xs);
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.05em;
}

.team-971-header {
  background: var(--brand-gold-soft);
  color: var(--brand-gold-strong);
  border: 1px solid var(--brand-gold-base);
}

.team-9584-header {
  background: var(--blue-soft);
  color: var(--blue-strong);
  border: 1px solid var(--blue-base);
}

.team-section-label { flex: 1; }
.team-section-count {
  font-size: var(--font-xs);
  background: rgba(0,0,0,0.08);
  border-radius: 999px;
  padding: 0 6px;
  line-height: 1.6;
}

.team-section-divider {
  height: 1px;
  background: var(--border);
  margin: var(--space-3) 0;
}

.team-section-divider-row td { padding: 0; border: none; }
```

---

## Task 8: Step file validation warning

**Files:**
- Modify: `src/routes/manufacture/+page.svelte`

- [ ] **Step 1:** Add a helper function that returns true when a part needs a step file but doesn't have one:

```js
function isMissingStepFile(part) {
  if (part.workflow !== 'router') return false;
  // Onshape parts: step is downloadable on-demand — not missing
  if (part.source_type === 'onshape_api') return false;
  // Manually uploaded router parts: check if step_file is set in meta
  const meta = getFileMeta(part);
  return !meta.step_file && !part.file_name;
}
```

- [ ] **Step 2:** In the card view part-card-header (around line 1607), after the name/team badge, add a warning icon for missing step files:

```svelte
{#if isMissingStepFile(part)}
  <span class="tag tag-warning" title="No step file uploaded">⚠ No STEP</span>
{/if}
```

- [ ] **Step 3:** In the table view's name cell (around line 1773), add the same warning after the 9584 badge:

```svelte
{#if isMissingStepFile(part)}
  <span class="tag tag-warning" title="No step file uploaded">⚠ No STEP</span>
{/if}
```

- [ ] **Step 4:** Add CSS for `tag-warning` (only if it doesn't already exist in the file):

```css
.tag-warning {
  background: var(--yellow-soft, #fef9c3);
  color: var(--yellow-strong, #713f12);
  border-color: var(--yellow-base, #ca8a04);
}
```

---

## Task 9: Router page — rename Jprogged, update canCamReview

**Files:**
- Modify: `src/routes/manufacture/router/+page.svelte`

- [ ] **Step 1:** Add import for `canCamReview`:

```js
import { isManufacturingLead, canCamReview as camReviewAllowed } from '$lib/permissions.js';
```

- [ ] **Step 2:** Change the reactive declaration (around line 19):

```js
$: canCamReview = camReviewAllowed(user);
```

- [ ] **Step 3:** In the group status `<select>` (around line 896), update options to use new labels:

```svelte
<option value={BUTTONS.PENDING}>{BUTTONS.PENDING}</option>
<option value={BUTTONS.CAM_REVIEWED}>{BUTTONS.CAM_REVIEWED}</option>
<option value={BUTTONS.JPROGGED}>{BUTTONS.JPROGGED}</option>
<option value={BUTTONS.MACHINED}>{BUTTONS.MACHINED}</option>
```

- [ ] **Step 4:** In `handleGroupStatusChange()` (around line 569), update the condition that sets parts to queued stage — find the `BUTTONS.TRAVIS` reference and replace with `BUTTONS.JPROGGED`:

```js
} else if (newStatus === BUTTONS.JPROGGED) {
  for (const p of group.parts) {
    const update = buildRouterProgressUpdate(p, { queued: p.quantity || 1 });
    await supabase.from('parts').update(update).eq('id', p.id);
    updatePartInGroups(p.id, update);
  }
}
```

- [ ] **Step 5:** In `getGroupDisplayStatus()` (around line 89), update all `BUTTONS.TRAVIS` references to `BUTTONS.JPROGGED`:

```js
if (allTravis) return BUTTONS.JPROGGED;
```

- [ ] **Step 6:** In `getStatusColors()` (around line 66), update the Travis entry:

```js
if (status === BUTTONS.JPROGGED || status === 'Jprogged') return { bg: 'var(--green-soft)', text: 'var(--green-strong)', border: 'var(--green-base)' };
```

- [ ] **Step 7:** In the part-row action buttons (around line 800–815), rename the "Travis 1" button label to "Jprogg 1":

```svelte
{#if getPartStageCount(p, 'cammed') > 0}
  <button type="button" class="btn btn-secondary btn-sm" on:click={() => movePartStage(p, 'cammed', 'queued')}>Jprogg 1</button>
{/if}
```

---

## Self-Review

**Spec coverage check:**
- ✅ New statuses (Pending, CAM Reviewed, CAM Review Pending, Postprocessed, Jprogged, In Progress, Machined, Kitted) — Tasks 1 and 9
- ✅ Due dates for parts — Tasks 2 and 5
- ✅ Step file validation — Task 8
- ✅ Notes section — Task 6
- ✅ Clear 971/9584 section separator — Task 7
- ✅ Machine button after CAM Review — Task 4c/4d
- ✅ No hub reload on action — Task 4b
- ✅ Only allowlisted users can CAM review — Tasks 3 and 4a

**Key invariants to verify:**
- `BUTTONS.TRAVIS` is removed; grep for remaining references before marking done: `grep -r "TRAVIS\|TravisProgged" src/`
- `BUTTONS.CAM_REVIEW_READY` is removed; grep: `grep -r "CAM_REVIEW_READY\|CAM Review Ready" src/`
- `loadParts()` is still called from: modal saves (~line 1251, 1307), batch delete (~line 1356), initial `onMount` (~line 204). Do not remove those.
- The `canCamReview` variable name in `+page.svelte` stays the same (just its value changes), so all template `{#if canCamReview}` conditionals don't need to change.
