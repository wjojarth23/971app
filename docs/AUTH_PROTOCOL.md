# 971 Hub Auth Protocol (UUID-Only Local Persistence)

This document describes the updated authentication protocol and integration patterns across the app.

Goal:
- Only persist the authenticated user’s UUID in localStorage.
- Never persist roles, permissions, or other profile details locally.
- On each route, use the UUID to fetch the current profile (and any route-specific membership/role checks) from the database.

## Storage Contract

- Key: `user_uuid`
- Value: the Supabase auth user ID (UUID string)
- No other user-related data must be written to localStorage.

Helpers (from `src/lib/stores/user.js`):
- `getUserUUID(): string | null` — returns UUID from localStorage
- `setUserUUID(uuid: string): void` — writes UUID to localStorage
- `clearUserUUID(): void` — removes UUID from localStorage
- `fetchUserProfileByUUID(supabase, uuid)` — fetch `user_profiles` row and normalize fields
- `loadUserFromUUID(supabase)` — hydrates `userStore` from UUID, or null if missing/invalid
- `upsertProfileIfMissing(supabase, { id, email, name })` — ensures a minimal `user_profiles` row exists

In-memory store:
- `userStore: writable(null | { id, email, full_name, role, permissions[] })`
- This store should be the sole source of user metadata in the UI.

## App Startup Flow

- In `+layout.svelte`:
  1. Subscribe to `userStore` to keep a local `user` variable up to date.
  2. Call `loadUserFromUUID(supabase)` to hydrate from any existing UUID in localStorage (works even without an active Supabase session if RLS allows public reads).
  3. Check `supabase.auth.getSession()`:
     - If there is a session, call `handleSignedIn(authUser)`:
       - `setUserUUID(authUser.id)`
       - `upsertProfileIfMissing(...)`
       - `loadUserFromUUID(supabase)` to refresh the `userStore` from DB
  4. Register `supabase.auth.onAuthStateChange`:
     - On `SIGNED_IN`: same as above (`handleSignedIn`)
     - On `SIGNED_OUT`: DO NOT clear UUID automatically; call `loadUserFromUUID(supabase)` so the app continues to function if UUID remains. For explicit user-initiated logout, call `clearUserUUID()`.

## Login / Logout

- Login (e.g. on `/` landing page):
  - After Supabase signs in the user, do not write any roles/permissions to local storage.
  - Call `setUserUUID(authUser.id)`, ensure profile row exists, and hydrate profile via `loadUserFromUUID(supabase)`.

- Logout:
  - Explicit logout must call `clearUserUUID()` and `userStore.set(null)` and then `supabase.auth.signOut()`.

- Automatic re-auth / refresh:
  - The presence of `user_uuid` allows `loadUserFromUUID` to hydrate the UI even if the Supabase session expires. The user should only have to log back in if `user_uuid` is missing.

## Route Integration Pattern

For routes requiring a user:
1. Subscribe to `userStore`, or call `loadUserFromUUID(supabase)` at mount to ensure the store is hydrated.
2. Retrieve the current Supabase session:
   - If no session and no `userStore` user, redirect to login.
   - If there is a session, call `setUserUUID(session.user.id)`, `upsertProfileIfMissing(...)`, then `loadUserFromUUID(supabase)`.
3. Use the `userStore` data (fetched from `user_profiles`) for UI and authorization checks.
4. For membership checks (e.g., subsystem membership), fetch from route-specific tables like `subsystem_members`.

Example snippet:
```svelte
onMount(async () => {
  const unsub = userStore.subscribe((v) => { user = v; });
  await loadUserFromUUID(supabase);

  const { data: { session } } = await supabase.auth.getSession();
  if (!session && !user) {
    goto('/');
    return;
  }
  if (session?.user?.id) {
    setUserUUID(session.user.id);
    await upsertProfileIfMissing(supabase, {
      id: session.user.id,
      email: session.user.email,
      name: session.user.user_metadata?.full_name || (session.user.email ? session.user.email.split('@')[0] : '')
    });
    await loadUserFromUUID(supabase);
  }
});
```

## Database Lookups

- User Profile:
  - `from('user_profiles').select('id, email, full_name, display_name, role, permissions').eq('id', uuid).single()`
  - Normalize to `{ id, email, full_name, role, permissions[] }` and only store in-memory.

- Membership / Role at route:
  - Fetch metadata as needed (e.g., `subsystem_members(user_id)`).
  - Always base checks on `userStore` (which is hydrated from `user_profiles`), and route-specific tables.

## Security and RLS

- Since only UUID persists locally, role/permission data is always fetched server-side via Supabase, honoring RLS.
- Ensure RLS policies allow:
  - Reading the current user’s `user_profiles` row by their UUID.
  - Reading route-specific membership (e.g., restrict to subsystem members).

## Summary of Changes Implemented

- `src/lib/stores/user.js` now:
  - Exposes UUID helpers, profile fetch, profile upsert, in-memory user store hydration.
  - Only UUID is persisted in localStorage.

- `src/routes/+layout.svelte`:
  - Hydrates user from UUID on load.
  - On auth sign-in: saves UUID, ensures profile exists, re-fetches user profile into `userStore`.
  - Explicit logout clears UUID and `userStore`.

- `src/routes/+page.svelte` (login/register):
  - After sign-in/sign-up, only UUID is saved; profile is fetched from DB.

- `src/routes/cad/bom/+page.svelte` and `src/routes/cad/[id]/+page.svelte`:
  - Hydrate from UUID and use `userStore` as the source of truth.
  - If session exists, persist UUID + upsert profile, then re-hydrate from DB.
  - Membership checks and per-route queries use DB data, not localStorage.

## Migration Guidance for Other Routes

When updating any remaining pages:
- Replace any direct session-to-user-object local persistence with:
  1. Subscribe to `userStore` (or call `loadUserFromUUID` first).
  2. If session exists: `setUserUUID(session.user.id)` → `upsertProfileIfMissing` → `loadUserFromUUID`.
  3. Use `userStore` in components to derive `user.id`, `full_name`, `role`, `permissions`.

Do not serialize or cache roles/permissions locally. Always fetch from DB via UUID.

## Edge Cases

- No UUID in localStorage: `loadUserFromUUID` yields null; route should redirect to login unless the route permits anonymous access.
- Stale UUID (no profile row): `upsertProfileIfMissing` ensures minimal profile row exists after sign-in; routes should hydrate after that.
- Session expired: if `user_uuid` persists, `loadUserFromUUID` can still render profile app-side if your RLS allows it; otherwise the route should prompt login.
