import { writable } from 'svelte/store';

// Simple global toast store with helper methods
const _toast = writable({ message: '', visible: false });
let _timer = null;

function show(message, duration = 3000) {
  _toast.set({ message, visible: true });
  if (_timer) clearTimeout(_timer);
  _timer = setTimeout(() => {
    _toast.set({ message: '', visible: false });
    _timer = null;
  }, duration);
}

function clear() {
  if (_timer) clearTimeout(_timer);
  _timer = null;
  _toast.set({ message: '', visible: false });
}

export const toast = {
  subscribe: _toast.subscribe
};

export const toastActions = { show, clear };

export default toast;
