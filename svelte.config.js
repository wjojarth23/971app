import adapter from '@sveltejs/adapter-node';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		adapter: adapter(),
		// AutoCAM's engine/components/docs live in a dedicated top-level
		// autocam/ folder (not under src/lib) - +page.svelte/+server.js files
		// can't move there themselves (SvelteKit's routing is determined by
		// their location under src/routes/), but everything else that isn't
		// routing-bound does, and imports it via this alias instead of a
		// relative path.
		alias: {
			$autocam: 'autocam',
			'$autocam/*': 'autocam/*'
		}
	}
};

export default config;
