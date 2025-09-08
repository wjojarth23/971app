import { writable } from 'svelte/store';

export const predictSettings = writable({
  tab_visible: false,
  demo: false,
  competitions: []
});
