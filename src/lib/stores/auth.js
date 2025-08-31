import { writable } from 'svelte/store';
import { supabase } from '$lib/supabase.js';

/**
 * Minimal auth stores:
 * - user: Supabase auth user (null when signed out)
 * - userProfile: row from user_profiles (null when signed out or missing)
 *
 * IMPORTANT: We never await inside the Supabase auth callback to avoid deadlocks.
 */
export const user = writable(null);
export const userProfile = writable(null);

let subscription = null;
let initialized = false;

async function fetchUserProfile(userId) {
  if (!userId) {
    userProfile.set(null);
    return null;
  }
  try {
    const { data, error } = await supabase
      .from('user_profiles')
      .select('id, email, full_name, role, permissions, created_at, updated_at, banned')
      .eq('id', userId)
      .single();

    if (error) {
      console.warn('user_profiles fetch error:', error.message || error);
      userProfile.set(null);
      return null;
    }
    userProfile.set({
      id: data.id,
      email: data.email || '',
      full_name: data.full_name || '',
      role: data.role || 'member',
      permissions: Array.isArray(data.permissions)
        ? data.permissions.map(String)
        : data.permissions
        ? [String(data.permissions)]
        : [],
      created_at: data.created_at || '',
      updated_at: data.updated_at || '',
      banned: !!data.banned
    });
    return data;
  } catch (e) {
    console.warn('user_profiles fetch exception:', e?.message || e);
    userProfile.set(null);
    return null;
  }
}

/**
 * Initialize auth once per app load.
 * - Sets current auth user on load
 * - Loads user_profiles row when signed in
 * - Clears userProfile when signed out
 *
 * No awaits inside the auth callback; async work is scheduled.
 */
export function initAuth() {
  if (!initialized) {
    initialized = true;

    // Initial session load (safe to await here; not inside callback)
    (async () => {
      const { data, error } = await supabase.auth.getSession();
      if (error) console.warn('getSession error:', error.message || error);
      const authUser = data?.session?.user ?? null;
      user.set(authUser);
      if (authUser) {
        await fetchUserProfile(authUser.id);
      } else {
        userProfile.set(null);
      }
    })();
  }

  if (!subscription) {
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      const authUser = session?.user ?? null;
      user.set(authUser);

      if (event === 'SIGNED_IN' && authUser) {
        // Avoid await inside callback to prevent deadlocks
        queueMicrotask(() => {
          void fetchUserProfile(authUser.id);
        });
      } else if (event === 'SIGNED_OUT') {
        userProfile.set(null);
      }
    });

    subscription = data?.subscription ?? null;
  }

  // Return unsubscribe function
  return () => {
    subscription?.unsubscribe?.();
    subscription = null;
    initialized = false;
  };
}

/**
 * Simple sign-out helper.
 */
export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) console.error('Error logging out:', error);
}

// Back-compat alias for existing code that reads from "userStore"
export const userStore = userProfile;
