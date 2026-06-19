import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'app-theme';
export const THEMES = ['light', 'dark'];

function initialTheme() {
  if (!browser) return 'light';
  const saved = localStorage.getItem(STORAGE_KEY);
  return THEMES.includes(saved) ? saved : 'light';
}

export const theme = writable(initialTheme());

// Apply the theme to <html> and persist it whenever it changes.
export function applyTheme(value) {
  if (!browser) return;
  const v = THEMES.includes(value) ? value : 'light';
  document.documentElement.setAttribute('data-theme', v);
  try { localStorage.setItem(STORAGE_KEY, v); } catch {}
}

if (browser) {
  theme.subscribe(applyTheme);
}

export function setTheme(value) {
  theme.set(THEMES.includes(value) ? value : 'light');
}

export function toggleTheme() {
  theme.update((v) => (v === 'dark' ? 'light' : 'dark'));
}
