import { writable } from 'svelte/store';

export const userStore = writable(null);

// Only persist the UUID locally. All other user data must be fetched on demand.
const LS_KEY = 'user_uuid';

export function getUserUUID() {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage.getItem(LS_KEY);
  } catch {
    return null;
  }
}

export function setUserUUID(uuid) {
  try {
    if (typeof localStorage === 'undefined') return;
    if (uuid) localStorage.setItem(LS_KEY, uuid);
  } catch {
    // ignore storage errors
  }
}

export function clearUserUUID() {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(LS_KEY);
  } catch {
    // ignore storage errors
  }
}

// Normalize a DB row into the app's in-memory user object
function normalizeProfile(row) {
  if (!row) return null;
  const permissions =
    Array.isArray(row.permissions)
      ? row.permissions.map(String)
      : row.permissions
      ? [String(row.permissions)]
      : [];

  return {
    id: row.id,
    email: row.email || '',
    full_name: row.full_name || row.display_name || '',
    role: row.role || 'member',
    permissions: permissions.length ? permissions : ['basic']
  };
}

// Fetch the user's profile by UUID from user_profiles
export async function fetchUserProfileByUUID(supabase, uuid) {
  if (!supabase || !uuid) return null;
  
  // Add timeout to prevent hanging
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Profile fetch timeout')), 10000)
  );
  
  try {
    const queryPromise = supabase
      .from('user_profiles')
      .select('id, email, full_name, role, permissions')
      .eq('id', uuid)
      .single();
    
    const { data, error } = await Promise.race([queryPromise, timeoutPromise]);
    
    if (error) {
      console.warn('fetchUserProfileByUUID error:', error.message || error);
      return null;
    }
    return normalizeProfile(data);
  } catch (error) {
    console.warn('fetchUserProfileByUUID timeout or error:', error.message || error);
    return null;
  }
}

// Initialize or refresh the in-memory user from localStorage UUID
export async function loadUserFromUUID(supabase) {
  const uuid = getUserUUID();
  if (!uuid) {
    userStore.set(null);
    return null;
  }
  const profile = await fetchUserProfileByUUID(supabase, uuid);
  userStore.set(profile);
  return profile;
}

// Ensure a minimal user_profiles row exists for a given auth user (by id)
export async function upsertProfileIfMissing(supabase, { id, email, name }) {
  if (!supabase || !id) return null;
  
  // Add timeout to prevent hanging
  const timeoutPromise = new Promise((_, reject) => 
    setTimeout(() => reject(new Error('Profile upsert timeout')), 10000)
  );
  
  try {
    // Check if profile exists
    const checkPromise = supabase
      .from('user_profiles')
      .select('id')
      .eq('id', id)
      .single();
    
    const { data, error } = await Promise.race([checkPromise, timeoutPromise]);
    
    // If not found (PostgREST 406 on .single() is typically code 'PGRST116')
    if (!data) {
      const insertTimeoutPromise = new Promise((_, reject) => 
        setTimeout(() => reject(new Error('Profile insert timeout')), 10000)
      );
      
      const insert = {
        id,
        email: email || null,
        full_name: name || (email ? email.split('@')[0] : null)
      };
      const insertPromise = supabase.from('user_profiles').insert([insert]);
      await Promise.race([insertPromise, insertTimeoutPromise]);
    } else if (error && error.code !== 'PGRST116') {
      // Log other unexpected errors
      console.warn('profile check error:', error.message || error);
    }

    return await fetchUserProfileByUUID(supabase, id);
  } catch (error) {
    console.warn('upsertProfileIfMissing timeout or error:', error.message || error);
    return null;
  }
}
