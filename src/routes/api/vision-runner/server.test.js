import { describe, it, expect, vi, beforeEach } from 'vitest';

// A minimal stand-in for the Supabase query builder: every chain method
// (select/eq/order/limit/in/update/insert/upsert/delete) returns the same
// chain object, and the chain itself is awaitable (has `.then`) - matching
// how the route handlers under test always build a full chain and await it
// exactly once, never branching on an intermediate step. `queues` maps a
// table name to an ordered list of canned {data, error} results; each
// `.from(table)` call consumes the next queued result for that table (or
// {data: null, error: null} once exhausted).
function makeMockClient(queues = {}, { user = { id: 'user-1' } } = {}) {
  const remaining = {};
  for (const [table, list] of Object.entries(queues)) remaining[table] = [...list];

  function nextFor(table) {
    const list = remaining[table];
    if (!list || !list.length) return { data: null, error: null };
    return list.shift();
  }

  function makeChain(table) {
    const result = nextFor(table);
    const resolved = Promise.resolve(result);
    const chain = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      update: () => chain,
      insert: () => chain,
      upsert: () => chain,
      delete: () => chain,
      single: () => resolved,
      maybeSingle: () => resolved,
      then: (onFulfilled, onRejected) => resolved.then(onFulfilled, onRejected)
    };
    return chain;
  }

  return {
    from: (table) => makeChain(table),
    storage: {
      from: () => ({
        createSignedUrl: async () => ({ data: { signedUrl: 'https://signed.example/view.mp4' }, error: null }),
        createSignedUploadUrl: async () => ({ data: { path: 'p', token: 't' }, error: null })
      })
    },
    auth: {
      getUser: async () => ({ data: { user } })
    }
  };
}

let mockClient;
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient)
}));

const notifyRunFailed = vi.fn(async () => ({ ok: true }));
const notifyCriticalDiscrepancy = vi.fn(async () => ({ ok: true }));
vi.mock('$lib/server/slack_notifications.js', () => ({
  notifyVisionRunFailed: (...args) => notifyRunFailed(...args),
  notifyVisionCriticalDiscrepancy: (...args) => notifyCriticalDiscrepancy(...args)
}));

vi.mock('$env/dynamic/private', () => ({
  env: {
    VISION_RUNNER_TOKEN: 'correct-token',
    SUPABASE_URL: 'https://example.supabase.co',
    SUPABASE_SERVICE_KEY: 'service-key',
    TBA_API_KEY: 'tba-key'
  }
}));

function request(body, token = 'correct-token') {
  return {
    headers: { get: (name) => (name.toLowerCase() === 'authorization' ? `Bearer ${token}` : null) },
    json: async () => body
  };
}

describe('api/vision-runner', () => {
  beforeEach(() => {
    mockClient = makeMockClient();
    notifyRunFailed.mockClear();
    notifyCriticalDiscrepancy.mockClear();
  });

  it('rejects requests with no token', async () => {
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'claim', runner_id: 'r1' }, '') });
    expect(res.status).toBe(401);
  });

  it('rejects requests with the wrong token', async () => {
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'claim', runner_id: 'r1' }, 'wrong-token') });
    expect(res.status).toBe(401);
  });

  it('rejects a token of the wrong length (constant-time check never runs)', async () => {
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'claim', runner_id: 'r1' }, 'short') });
    expect(res.status).toBe(401);
  });

  it('accepts the correct token and requires runner_id for claim', async () => {
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'claim' }) });
    expect(res.status).toBe(400);
  });

  it('claim returns null when nothing is queued', async () => {
    mockClient = makeMockClient({ vision_runs: [{ data: [], error: null }] });
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'claim', runner_id: 'r1' }) });
    const body = await res.json();
    expect(body).toEqual({ run: null });
  });

  it('claim skips a candidate another runner already grabbed (CAS loses) and wins the next one', async () => {
    // First candidate's compare-and-swap update returns no row (already
    // claimed elsewhere); the loop must move on to the second candidate
    // rather than returning run: null after a single loss.
    mockClient = makeMockClient({
      vision_runs: [
        { data: [{ id: 'run-a' }, { id: 'run-b' }], error: null }, // select candidates
        { data: null, error: null }, // update run-a: lost the race
        { data: { id: 'run-b', vision_match_id: 'match-1', vision_matches: {} }, error: null } // update run-b: won
      ],
      vision_views: [{ data: [], error: null }]
    });
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'claim', runner_id: 'r1' }) });
    const body = await res.json();
    expect(body.run.id).toBe('run-b');
  });

  it('heartbeat requires runner_id', async () => {
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'heartbeat' }) });
    expect(res.status).toBe(400);
  });

  it('heartbeat upserts successfully with a runner_id', async () => {
    mockClient = makeMockClient({ vision_runners: [{ data: null, error: null }] });
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'heartbeat', runner_id: 'r1', model_path: '/models/v1.pt' }) });
    const body = await res.json();
    expect(body).toEqual({ success: true });
  });

  it('processing returns 409 when the run was not in the claimed state', async () => {
    mockClient = makeMockClient({ vision_runs: [{ data: [], error: null }] });
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'processing', run_id: 'run-1' }) });
    expect(res.status).toBe(409);
  });

  it('fail marks the run failed and sends a Slack alert when a row actually transitioned', async () => {
    mockClient = makeMockClient({ vision_runs: [{ data: [{ id: 'run-1' }], error: null }] });
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'fail', run_id: 'run-1', error: 'boom' }) });
    expect(res.status).toBe(200);
    expect(notifyRunFailed).toHaveBeenCalledWith('run-1');
  });

  it('fail does not alert when nothing was actually claimed/processing (no-op CAS)', async () => {
    mockClient = makeMockClient({ vision_runs: [{ data: [], error: null }] });
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'fail', run_id: 'run-1', error: 'boom' }) });
    expect(res.status).toBe(200);
    expect(notifyRunFailed).not.toHaveBeenCalled();
  });

  it('rejects an unknown action', async () => {
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'not-a-real-action' }) });
    expect(res.status).toBe(400);
  });
});
