import { writable } from 'svelte/store';

// Create a writable store for user data
export const userStore = writable(null);

// Helper function to update user profile
export function updateUserProfile(profileData) {
  userStore.update(user => {
    if (user) {
      return { ...user, ...profileData };
    }
    return profileData;
  });
}

// Helper function to clear user data
export function clearUser() {
  userStore.set(null);
}
