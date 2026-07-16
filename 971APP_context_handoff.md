# 971APP — Full Session Handoff Context

**Project**: 971 Hub — Spartan Robotics internal web app  
**Repo path**: `/Users/yuvan/Desktop/Robotics/971APP`  
**Stack**: SvelteKit + Supabase + Vite  
**Date**: 2026-07-09  
**Git user**: Lightningcode222  
**User email**: lightningai20@gmail.com  

---

## Push Reminders
- On every commit/push, push `main` to **both**:
  - `wjojarth23/971app`
  - `stormcoded/971APP`
- **Never** add `Co-Authored-By` trailers to commit messages.

---

## Dev Server Commands
```bash
npm run dev          # local only (localhost:5173)
npm run dev -- --host  # expose to network (note: double dash required)
```

---

## What Was Done This Session

### 1. Auth System Fixes (`src/routes/+page.svelte` + `src/routes/+layout.svelte`)

**Problem A — Flash of login form after sign-in (race condition)**  
Root cause: `onAuthStateChange` sets `authReady = true` immediately, but `userProfile` is fetched via `queueMicrotask` after. The page used `authReady` alone as the signal to stop the spinner — so the spinner dropped before the profile arrived, briefly rendering the login form even though the user just signed in.

Fix applied in `src/routes/+page.svelte`:
- Imported `user as authUserStore` from `$lib/stores/auth.js`
- Added `authUser = null` variable, subscribed to the raw Supabase auth user in `onMount`
- Added reactive: `$: isLoading = loading || (authUser !== null && user === null)`
- Changed `{#if loading}` → `{#if isLoading}` in template

**Problem B — No forgot password**  
Fix applied in `src/routes/+page.svelte`:
- Added `authMode = 'forgot'` as a third mode (alongside `'login'` and `'register'`)
- Added `forgotEmail`, `forgotLoading`, `forgotError`, `forgotSuccess` state variables
- Added `handleForgotPassword()` function — calls `supabase.auth.resetPasswordForEmail(forgotEmail)`
- Pre-fills email from the login form when user clicks "Forgot password?"
- Added forgot-mode UI in the template (form with email input, success/error states, "Back to Sign In" link)
- Added "Forgot password?" link below the password field in login mode
- Hid the Sign In / Register tabs when in forgot mode
- Added CSS for `.forgot-link` and `.forgot-header`

**Problem C — Banned users never blocked**  
Fix applied in `src/routes/+layout.svelte`:
- Imported `signOut` from `$lib/stores/auth.js`
- Added reactive guard:
  ```js
  let _bannedHandled = false;
  $: if (authReady && activeProfile?.banned && !_bannedHandled) {
    _bannedHandled = true;
    toastActions.show('Your account has been suspended. Please contact an administrator.');
    void signOut();
  }
  $: if (!activeProfile) _bannedHandled = false;
  ```

---

### 2. Unfinished — API Flooding (NOT yet fixed)

The user reported repeated API failures in the terminal. Two separate runaway loop issues were identified but the session ended before fixes were applied.

#### Issue A — Onshape 402 "API limit exceeded" flood

**Symptom**: Dozens of `document-info` requests firing in rapid succession for the same document IDs. Onshape returns `402 API limit exceeded`. The client keeps retrying, making it worse.

**Root cause traced to**: `src/routes/cad/+page.svelte` calls `onShapeAPI.getDocumentInfo(subsystem.onshape_document_id)` for each subsystem that has an Onshape URL. These calls are made without any caching or deduplication. When the page re-renders (reactive updates), the fetch loop runs again, hitting the same documents repeatedly.

**Server code**: `src/routes/api/onshape/+server.js` — the `document-info` case hits `/api/v11/documents/${documentId}` with no server-side cache.

**Fix needed**:
- Add an in-memory cache (Map keyed by documentId) in the `cad/+page.svelte` fetch loop — don't re-fetch the same documentId twice per page load
- In the server route (`api/onshape/+server.js`), add a short-lived cache (e.g. 60s) for `document-info` responses keyed by documentId
- On the client side: when Onshape returns a 402, stop retrying immediately and surface an error rather than continuing the loop
- The fetch loop in `cad/+page.svelte` around line 247-260 runs `for` each subsystem — wrap it with a `seen` Set to skip duplicate documentIds

#### Issue B — Attendance check firing on every navigation

**Symptom**: `Attendance check for user: 0b6f27f7...` logged ~15+ times in seconds, once per navigation.

**Root cause**: Two separate triggers in `src/routes/+layout.svelte`:

1. `userStore.subscribe` callback calls `checkAttendance(v)` every time the profile updates:
   ```js
   const unsubProfile = userStore.subscribe((v) => {
     profile = v;
     if (v) {
       void checkAttendance(v);  // ← fires every profile update
     }
   });
   ```

2. `afterNavigate` calls BOTH `refreshOwnProfile()` AND `checkAttendance(profile)`:
   ```js
   afterNavigate(() => {
     refreshOwnProfile();      // ← triggers profile update → fires subscribe above
     if (profile) {
       void checkAttendance(profile);  // ← fires again directly
     }
   });
   ```

   So each navigation = 2+ attendance checks. `refreshOwnProfile` fetches the profile and updates the store, which fires the subscribe, which calls `checkAttendance` again.

**Fix needed**:
- Remove `checkAttendance` from the `userStore.subscribe` callback — that callback should only update the local `profile` variable
- Move the initial attendance check to a separate `$: if (profile && !hasCheckedAttendance)` reactive that fires once when profile first becomes available
- In `afterNavigate`, only call `checkAttendance` directly (not triggered again by the subscribe)
- Optionally add a session-level flag to avoid even the `afterNavigate` check firing more than once per session (since the server already deduplicates per day per user)

---

## Key Files Reference

| File | Purpose |
|------|---------|
| `src/routes/+page.svelte` | Login/register/forgot-password + user dashboard (home page) |
| `src/routes/+layout.svelte` | Nav header, auth guards, banned user check, attendance tracking |
| `src/lib/stores/auth.js` | Auth stores: `user` (raw Supabase auth user), `userProfile`, `authReady`, `initAuth()`, `signOut()`, `fetchUserProfile()` |
| `src/lib/supabase.js` | Supabase client + `getAuthHeader()` helper |
| `src/lib/permissions.js` | `hasPermission()`, role/permission constants, `FRC_TEAMS`, `PERMISSIONS` list |
| `src/lib/attendance.js` | `trackUserAttendance()` — POSTs to `/api/attendance` |
| `src/routes/api/onshape/+server.js` | Onshape API proxy — all actions including `document-info`, `assembly-bom`, `download-stl`, `translate-part`, `shaded-views`, etc. |
| `src/routes/cad/+page.svelte` | CAD subsystems page — fetches Onshape `document-info` per subsystem |
| `src/lib/onshape.js` | `onShapeAPI` client helper (wraps fetch to `/api/onshape`) |
| `src/routes/profile/+page.svelte` | User profile page |
| `src/routes/admin/+page.svelte` | Admin panel |
| `src/routes/cad/purchasing/+page.svelte` | Purchasing requests |
| `src/routes/cad/build/+page.svelte` | Build tracking |
| `src/routes/manufacture/+page.svelte` | Manufacturing hub |
| `docs/` | Documentation files (BUDGET_SYSTEM_GUIDE.md, BUILD_TAB_CHANGES.md, etc.) |

---

## Auth System Architecture

### Stores (`src/lib/stores/auth.js`)
- `user` — raw Supabase auth user (null when signed out)
- `userProfile` — row from `user_profiles` table (null when signed out or profile not loaded)
- `userStore` — alias for `userProfile` (back-compat)
- `authReady` — boolean, true once initial session check is complete

### Flow
1. `initAuth()` called from both `+layout.svelte` and `+page.svelte` (reference-counted, only runs once)
2. Calls `supabase.auth.getSession()` to get current session
3. If session exists, calls `fetchUserProfile(userId)` to load the `user_profiles` row
4. Registers `onAuthStateChange` listener — on `SIGNED_IN` fetches profile via `queueMicrotask`, on `SIGNED_OUT` clears profile
5. Sets `authReady = true` after session check

### Profile fields loaded
`id, email, full_name, role, permissions, header_tabs, dashboard_layout, created_at, updated_at, banned, general_role, purchasing_role, team_role, frc_team, notification_settings, slack_user_id, slack_dm_channel`

### Permissions
- `hasPermission(user, perm)` in `src/lib/permissions.js`
- Checks `role === 'admin'` (superuser), then `general_role` permissions, then `purchasing_role` permissions, then `permissions[]` array
- Key permission: `CAN_SEE_ROUTES` — users without this see "Account Pending Approval"

---

## Database (Supabase)
- `user_profiles` — user info, roles, permissions, UI config
- `subsystems` — CAD subsystems
- `subsystem_members` — user ↔ subsystem membership
- `builds` — build records linked to subsystems
- `purchasing` — purchase requests (has both `purchaser` UUID column and legacy `requester` text)
- `attendance_locations`, `attendance_schedules`, `attendance_schedule_locations`, `user_attendance_logs` — attendance system
- `attendance_leaderboard_30_days` — view for leaderboard

---

## Recent Git History (at session start)
```
c7d4f5f  Removing a user now deletes their auth account so they can re-register
5618dbd  Polish dark mode: fix legibility across core tabs
cbed6d3  Add opt-in dark theme with toggle in account settings
ced8145  Remove purchasing totals summary bar (item count + total)
a5a5620  Visual polish pass + purchasing totals
```

---

## Pending / Didn't Get To
1. **Onshape API 402 flood** — needs client-side deduplication cache + server-side response cache + stop-on-402 logic in `cad/+page.svelte` and `api/onshape/+server.js`
2. **Attendance double-firing** — needs `checkAttendance` removed from `userStore.subscribe` callback in `+layout.svelte`
3. Two Svelte a11y warnings (non-breaking):
   - `src/routes/manufacture/+page.svelte:2072` — `<td>` cannot have role 'presentation'
   - `src/lib/components/PartNotes.svelte:74` — dialog element needs tabindex
