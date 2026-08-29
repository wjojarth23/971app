import { describe, it, expect, vi, beforeEach } from 'vitest';

const sendAlerts = vi.fn(async () => ({ ok: true, checked: 2, sent: 0 }));
vi.mock('$lib/server/slack_notifications.js', () => ({
  sendVisionRunnerHealthAlerts: (...args) => sendAlerts(...args)
}));

let mockEnv = {};
vi.mock('$env/dynamic/private', () => ({ get env() { return mockEnv; } }));

function request(token) {
  return {
    headers: { get: (name) => (name.toLowerCase() === 'authorization' && token ? `Bearer ${token}` : null) }
  };
}

const url = (query = '') => new URL(`http://localhost/api/notifications/vision-stale-runners${query}`);

describe('api/notifications/vision-stale-runners', () => {
  beforeEach(() => {
    sendAlerts.mockClear();
    mockEnv = {};
  });

  it('refuses to run at all when no cron secret is configured', async () => {
    // cron_auth is fail-open by design, so a new endpoint must not inherit it -
    // that would put an unauthenticated route on the live service.
    const { GET } = await import('./+server.js');
    const res = await GET({ url: url(), request: request() });
    expect(res.status).toBe(503);
    expect(sendAlerts).not.toHaveBeenCalled();
  });

  it('rejects a wrong token once a secret is configured', async () => {
    mockEnv = { CRON_NOTIFICATION_TOKEN: 'right' };
    const { GET } = await import('./+server.js');
    const res = await GET({ url: url(), request: request('wrong') });
    expect(res.status).toBe(401);
    expect(sendAlerts).not.toHaveBeenCalled();
  });

  it('accepts the configured token as a bearer header', async () => {
    mockEnv = { CRON_NOTIFICATION_TOKEN: 'right' };
    const { GET } = await import('./+server.js');
    const res = await GET({ url: url(), request: request('right') });
    expect(res.status).toBe(200);
    expect(sendAlerts).toHaveBeenCalledOnce();
  });

  it('accepts the configured token as a query parameter, which is how pg_cron calls it', async () => {
    mockEnv = { CRON_NOTIFICATION_TOKEN: 'right' };
    const { GET } = await import('./+server.js');
    const res = await GET({ url: url('?token=right'), request: request() });
    expect(res.status).toBe(200);
    expect(sendAlerts).toHaveBeenCalledOnce();
  });
});
