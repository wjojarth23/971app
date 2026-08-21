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
	},
	test: {
		// autocam/fusion/_upstream/ and autocam/fusion/runner/_upstream/ are
		// vendored copies of Team Valor 6800's original AutoCAM source
		// (reference-only, never built - see autocam/fusion/README.md), not
		// part of this app. Vitest's default include glob is broad enough to
		// otherwise pick up their own *.test.ts files, which fail outright -
		// they depend on next/server and other Next.js-only modules this
		// project doesn't (and shouldn't) have.
		exclude: ['**/node_modules/**', '**/autocam/fusion/**/_upstream/**']
	}
});
