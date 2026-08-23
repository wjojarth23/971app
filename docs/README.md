# Spartans Hub Documentation

**The whole-project architecture overview lives at the repo root -
[`README.md`](../README.md)** - stack, module map, data layer, deployment,
contribution workflow. Deliberately not in this folder so it's the first
thing anyone sees landing on the repo, not something to go looking for.

Docs are split by purpose:

## `guides/` — living reference

How a system works **today**. Update these when the system changes.

| Doc | Covers |
|---|---|
| [AUTH_PROTOCOL.md](guides/AUTH_PROTOCOL.md) | Authentication flow, UUID-only local persistence, profile fetching |
| [BUDGET_SYSTEM_GUIDE.md](guides/BUDGET_SYSTEM_GUIDE.md) | Purchasing budgets: scopes, Project ID matching, pinning |

## `changes/` — historical change records

Point-in-time summaries of feature work, newest first. These describe what
changed and why; they are **not** kept up to date afterward.

| Doc | Date | Covers |
|---|---|---|
| [AUG_2026_NAV_REORG.md](changes/AUG_2026_NAV_REORG.md) | Aug 2026 | Nav regrouped into Purchasing/Manufacturing/Competition/CAD folders, dropdown-clipping fix, AutoCAM dev-server 403 fix |
| [JULY_2026_UPDATES.md](changes/JULY_2026_UPDATES.md) | Jul 2026 | Purchasing roles/permissions rework, offseason budget, request-flood fixes, Modern theme |
| [PURCHASING_ADMIN_README.md](changes/PURCHASING_ADMIN_README.md) | — | Purchasing admin subtab, vendors table, analytics |
| [PROFILE_UI_IMPROVEMENTS.md](changes/PROFILE_UI_IMPROVEMENTS.md) | — | Profile header customization, drag-and-drop nav, live preview |
| [BUILD_TAB_CHANGES.md](changes/BUILD_TAB_CHANGES.md) | — | Build detail page reorganization, version-based BOM refetch |
| [BUILD_TAB_QUICK_REF.md](changes/BUILD_TAB_QUICK_REF.md) | — | Visual before/after reference for the build tab work |
| [BUILD_TAB_TESTING.md](changes/BUILD_TAB_TESTING.md) | — | Testing checklist for the build tab work |
| [MIGRATION_README.md](changes/MIGRATION_README.md) | — | Removal of the build approval workflow (DB migration) |
