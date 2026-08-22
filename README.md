# Spartans Hub has moved

This repository is no longer in use. Spartan Robotics' team hub now lives at:

**https://spartanshub.spartanrobotics.org**

This repo now contains a minimal SvelteKit app whose only page redirects
visitors to that URL (meta refresh + JS fallback) - `@sveltejs/adapter-vercel`
with an explicit `nodejs20.x` runtime (see `svelte.config.js`'s comment for
why that's pinned explicitly rather than left to auto-detection). Everything
else has been removed.
