import { describe, expect, it } from 'vitest';
import { getCronSecrets, isAuthorizedCronRequest } from './cron_auth.js';

describe('cron auth helpers', () => {
  it('allows requests when no cron secret is configured', () => {
    expect(isAuthorizedCronRequest({
      url: new URL('https://example.com/api/planner/notifications'),
      headers: new Headers()
    })).toBe(true);
  });

  it('accepts the legacy query token', () => {
    expect(isAuthorizedCronRequest({
      url: new URL('https://example.com/api/planner/notifications?token=legacy-secret'),
      headers: new Headers(),
      env: { NOTIFICATION_CRON_TOKEN: 'legacy-secret' }
    })).toBe(true);
  });

  it('accepts bearer auth for hosted cron jobs', () => {
    expect(isAuthorizedCronRequest({
      url: new URL('https://example.com/api/planner/notifications'),
      headers: new Headers({ authorization: 'Bearer vercel-secret' }),
      env: { CRON_SECRET: 'vercel-secret' }
    })).toBe(true);
  });

  it('rejects requests with the wrong token', () => {
    expect(isAuthorizedCronRequest({
      url: new URL('https://example.com/api/planner/notifications?token=wrong'),
      headers: new Headers({ authorization: 'Bearer nope' }),
      env: { CRON_SECRET: 'expected-secret' }
    })).toBe(false);
  });

  it('collects unique secrets from all supported env names', () => {
    expect(getCronSecrets({
      NOTIFICATION_CRON_TOKEN: 'shared',
      CRON_NOTIFICATION_TOKEN: 'shared',
      CRON_SECRET: 'hosted'
    })).toEqual(['shared', 'hosted']);
  });
});
