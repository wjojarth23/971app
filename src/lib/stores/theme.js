import { writable } from 'svelte/store';
import { browser } from '$app/environment';

const STORAGE_KEY = 'app-theme';
const DEFAULT_THEME = 'modern';

// 'light'  = Legacy (original design)
// 'modern' = Modern Light (default)
// 'modern-dark' = Modern Dark
export const THEMES = ['light', 'modern', 'modern-dark'];

export const THEME_LABELS = {
  light: 'Legacy',
  modern: 'Modern Light (default)',
  'modern-dark': 'Modern Dark'
};

function initialTheme() {
  if (!browser) return DEFAULT_THEME;
  const saved = localStorage.getItem(STORAGE_KEY);
  // Legacy dark was removed — migrate users who had it saved to Modern Dark
  if (saved === 'dark') return 'modern-dark';
  return THEMES.includes(saved) ? saved : DEFAULT_THEME;
}

export const theme = writable(initialTheme());

// Apply the theme to <html> and persist it whenever it changes.
export function applyTheme(value) {
  if (!browser) return;
  const v = THEMES.includes(value) ? value : DEFAULT_THEME;
  document.documentElement.setAttribute('data-theme', v);
  try { localStorage.setItem(STORAGE_KEY, v); } catch {}
}

if (browser) {
  theme.subscribe(applyTheme);
}

export function setTheme(value) {
  theme.set(THEMES.includes(value) ? value : DEFAULT_THEME);
}

// Toggle between the modern light/dark pair; from legacy light it enters
// Modern Dark (legacy has no dark counterpart anymore).
export function toggleTheme() {
  theme.update((v) => (v === 'modern-dark' ? 'modern' : 'modern-dark'));
}
