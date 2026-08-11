import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// @sentry/sveltekit's client entry isn't picked up by Vite's static
	// dependency scanner, so it gets discovered lazily on first request and
	// triggers a mid-request "optimized dependencies changed, reloading"
	// cycle — visible as repeated "file does not exist" chunk errors and a
	// page that never finishes loading. Force it into the upfront pre-bundle
	// instead so optimization happens once, before any request is served.
	optimizeDeps: {
		include: ['@sentry/sveltekit']
	}
});
