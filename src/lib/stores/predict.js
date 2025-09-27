import { writable } from 'svelte/store';

export const predictSettings = writable({
  // Show the Predict tab by default in the header and use 2025cc
  // as the single active event code unless server overrides it.
  tab_visible: true,
  demo: false,
  competitions: ['2025cc']
});
