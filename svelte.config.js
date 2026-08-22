import adapter from '@sveltejs/adapter-vercel';

/** @type {import('@sveltejs/kit').Config} */
const config = {
	kit: {
		// adapter-vercel directly (not adapter-auto) with an explicit
		// runtime: adapter-auto's runtime auto-detection reads the LOCAL
		// Node version at build time and throws if it doesn't recognize it
		// as a supported Vercel runtime - confirmed locally (Node v24 here
		// isn't in its known-good list, "Unsupported Node.js version" is a
		// real, reproducible error, not a guess). Vercel's own build
		// environment could hit the exact same failure depending on which
		// Node version it runs, which would explain every prior deployment
		// failure on this project, including the original app's, before
		// this became a redirect page. Pinning nodejs20.x explicitly
		// sidesteps the detection entirely.
		adapter: adapter({ runtime: 'nodejs20.x' })
	}
};

export default config;
