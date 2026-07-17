import * as Sentry from '@sentry/sveltekit';
import { env } from '$env/dynamic/public';

// Error monitoring: no-op unless PUBLIC_SENTRY_DSN is set (locally and in
// Vercel). With no DSN, init is skipped and behavior is unchanged.
const dsn = env.PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    tracesSampleRate: 0.1,
    environment: import.meta.env.MODE
  });
}

export const handleError = Sentry.handleErrorWithSentry(({ error }) => {
  console.error('Client error:', error);
});
