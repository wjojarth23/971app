import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'app-theme';

// 'light'  = Legacy (default, original design)
// 'modern' = Modern Light (prototype)
// 'modern-dark' = Modern Dark (prototype)
export const THEMES = ['light', 'modern', 'modern-dark'];

export const THEME_LABELS = {
  light: 'Legacy (default)',
  modern: 'Modern Light',
  'modern-dark': 'Modern Dark'
};

function initialTheme() {
  if (!browser) return 'light';
  const saved = localStorage.getItem(STORAGE_KEY);
  // Legacy dark was removed — migrate users who had it saved to Modern Dark
  if (saved === 'dark') return 'modern-dark';
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

// Toggle between the modern light/dark pair; from legacy light it enters
// Modern Dark (legacy has no dark counterpart anymore).
export function toggleTheme() {
  theme.update((v) => (v === 'modern-dark' ? 'modern' : 'modern-dark'));
}
