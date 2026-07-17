import * as Sentry from '@sentry/sveltekit';
import { sequence } from '@sveltejs/kit/hooks';
import { env } from '$env/dynamic/public';

// Error monitoring: no-op unless PUBLIC_SENTRY_DSN is set (locally and in
// Vercel). With no DSN, init is skipped and behavior is unchanged.
const dsn = env.PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: process.env.VERCEL_ENV || process.env.NODE_ENV || 'development'
  });
}

export const handle = sequence(Sentry.sentryHandle());

export const handleError = Sentry.handleErrorWithSentry(({ error }) => {
  console.error('Server error:', error);
});
