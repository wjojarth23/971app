# July 2026 Updates

Change record for the work landed between `c7d4f5f` and `36f8b65`
(July 13–16, 2026). Newest work last.

Commits, in order:

```
262ec40  Add Purchasing Lead role; auth fixes (forgot password, banned guard, login flash)
e60a0ad  Restrict order creation to Purchasing Leads, mentors, and admins
87ddd88  Approve via status dropdown when pending; let mentors approve/reject
ec4e4c1  Stop attendance/Onshape request floods; fix two a11y warnings
43204fc  Support per-budget project exclusions for the offseason grant budget
36f8b65  Add opt-in Modern theme; remove legacy dark; shared design fixes
```

---

## 1. Auth fixes (`262ec40`)

**Files:** `src/routes/+page.svelte`, `src/routes/+layout.svelte`

- **Login-form flash after sign-in** — the spinner dropped when `authReady`
  fired, before the profile arrived, briefly showing the login form to a
  signed-in user. The page now also waits for the profile
  (`isLoading = loading || (authUser !== null && user === null)`).
- **Forgot password** — new third auth mode alongside login/register.
  Calls `supabase.auth.resetPasswordForEmail`, pre-fills the email from the
  login form, hides the Sign In/Register tabs while active.
- **Banned users are actually blocked** — a reactive guard in the layout
  signs out any profile with `banned = true` and shows a suspension toast.

## 2. Purchasing roles & permissions rework (`262ec40`, `e60a0ad`, `87ddd88`)

**Files:** `src/lib/permissions.js`, `src/routes/cad/purchasing/+page.svelte`,
`src/routes/api/admin/+server.js`, `src/routes/admin/+page.svelte`

### New team role: Purchasing Lead

- Added to `TEAM_ROLES`; appears automatically in the admin team-role
  dropdown (teal badge).
- New `TEAM_ROLE_PERMISSIONS` map grants it the full purchasing set:
  `CAN_SEE_ROUTES`, `PLACE_ORDERS_MISC`, `APPROVE_PURCHASES`,
  `VIEW_PURCHASING_ADMIN`, `ADD_VENDORS`, `EDIT_BUDGETS`.
- `team_role` is now checked live in `hasPermission()` and included in
  `getRoleDerivedPermissions()` + the admin server's permission
  materialization, so stored `permissions[]` stays consistent on role change.
- First assignee: Keira Lazareva.

### Who can do what in purchasing (current state)

| Action | Gate | Who qualifies |
|---|---|---|
| Request items (Add Custom Item) | `PLACE_ORDERS_MISC` | any approved member |
| Approve / reject requests | `canApprovePurchases()` | admins, mentors (`frc_team = 'Mentor'`), `APPROVE_PURCHASES` holders |
| **Create orders** (bundle + total) | `canCreateOrders()` | admins, mentors, Purchasing Lead team role **only** |
| Change post-order status | `PLACE_ORDERS_MISC` | any approved member |
| Manage/delete any entry | `canManagePurchasing()` | admins, `VIEW_PURCHASING_ADMIN` holders |

Key decision: **order creation was decoupled from purchase approval.**
`APPROVE_PURCHASES` used to gate both the Create Order button and the
approve/reject step; purchasing `approver`/`lead` roles now approve but can
no longer place orders.

### Approval UX

- The status dropdown offers **Approved** while an item is pending (for
  users who can approve); selecting it runs the real approval flow. It was
  previously only a dead placeholder shown after approval.
- `approvePart`/`rejectPart` carry their own permission guards
  (defense in depth, since the dropdown is a second entry point).

## 3. Request-flood and a11y fixes (`ec4e4c1`)

**Files:** `src/routes/+layout.svelte`, `src/routes/api/onshape/+server.js`,
`src/lib/onshape.js`, `src/routes/manufacture/+page.svelte`,
`src/lib/components/PartNotes.svelte`

- **Attendance** — was POSTing 2+ times per navigation (subscribe callback +
  `afterNavigate`, compounded by `refreshOwnProfile()` re-firing the
  subscribe). Now records **once per session** when the profile first loads;
  the server still dedupes per day.
- **Onshape 402 flood** — `document-info` responses are cached server-side
  for 60s (keyed by documentId), and the client stops calling for 60s after
  any 402 (circuit breaker) instead of retrying into the rate limit.
- **A11y** — `PartNotes` dialog got `tabindex="-1"`; the manufacture
  due-date `<td>` lost its invalid `role="presentation"`.

## 4. Offseason budget + per-budget exclusions (`43204fc`)

**Files:** `src/routes/cad/purchasing/+page.svelte`,
`src/routes/admin/BudgetsTab.svelte` — plus DB data

- Budget spend calculators now honor `metadata.exclude_projects` (jsonb) on
  any budget row: listed Project IDs are excluded from that budget's spend.
  Backward compatible; survives admin edits (the edit form doesn't touch
  `metadata`).
- Created the **"Offseason 2026"** budget: overall scope, **$8,500**,
  starts 2026-05-01, no end date, excludes the `Competition` project per the
  grant terms. Pinning is per-user (`user_budget_pins`) — each member pins
  it from the purchasing page.
- Reminder (existing behavior): budget bars count `price × quantity` of
  non-rejected items; shipping is not included.

## 5. Modern theme + design fixes (`36f8b65`)

**Files:** `src/app.css`, `src/app.html`, `src/lib/stores/theme.js`,
`src/routes/+page.svelte`, `src/routes/profile/+page.svelte`,
`src/routes/admin/+page.svelte`, `src/routes/cad/purchasing/+page.svelte`,
`src/routes/cots-stocking/+page.svelte`, `src/lib/components/CadViewer.svelte`,
`src/lib/components/RouterStatusSelector.svelte`, `src/routes/+layout.svelte`

### Theme lineup

| Theme | `data-theme` | Notes |
|---|---|---|
| Legacy | *(none)* / `light` | Default. Original palette. |
| Modern Light | `modern` | Prototype look, opt-in. |
| Modern Dark | `modern-dark` | Prototype look, opt-in. |

- **Legacy Dark was removed entirely.** Saved `dark` preferences migrate to
  `modern-dark` automatically (handled in both the `app.html` pre-render
  script and the theme store, so there is no flash and no broken state).
- Theme pickers live on the login page footer and profile settings.
  Preference is stored in `localStorage` (`app-theme`), per device.

### Modern design language (scoped to `modern` / `modern-dark`)

Deliberately avoids the recognizable "AI-generated" defaults (cool
gray-blue neutrals, soft-shadow rounded cards, unchosen fonts, gradients):

- **Palette** — warm paper neutrals in light; warm charcoal in dark;
  refined deeper gold (`#d9a413` light / `#e9b830` dark).
- **Type** — Space Grotesk headings, JetBrains Mono for table headers and
  data readouts, system stack body. Tabular numerals in tables.
- **Surfaces** — flat, border-driven; shadows only on floating layers.
- **Tables** — ledger style: mono uppercase header labels over a strong
  rule, hairline row separators, no zebra, faint gold row hover.
- **Motion** — functional ~100ms transitions only.

### Shared fixes (all themes, including Legacy)

- Defined design tokens that were referenced but never existed
  (`--space-5`, `--font-sm`, `--font-lg`, `--font-mono`, `--purple-base`,
  orange family) — these were producing invalid declarations and collapsing
  paddings to zero in places.
- Sharp radii (2–4px), flat shadow tokens, 28px controls, and the
  heading/mono type treatment apply across all themes.
- Dark-theme legibility: status chips and admin role selects render as
  translucent tints with light text (via `color-mix`); purchasing
  status-select glare ring dimmed; RouterStatusSelector and the CadViewer
  scene background now key on `modern-dark`.
- Gradient progress fills replaced with solid colors; cots-stocking page
  header padding restored.

### Known follow-ups

- The profile page's attendance summary section was replaced by the theme
  picker; `getUserAttendanceStats` / `getUserAttendanceHistory` in
  `src/lib/attendance.js` are currently unused (dead code) and the profile
  page still contains orphaned attendance CSS.
- `toggleTheme()` in the theme store has no callers.
