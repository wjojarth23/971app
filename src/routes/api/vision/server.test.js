import { describe, it, expect, vi, beforeEach } from 'vitest';

// See src/routes/api/vision-runner/server.test.js for the rationale behind
// this shape - every chain method returns the same chain, and the chain
// itself is awaitable, matching how these route handlers always build one
// full chain and await it exactly once.
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
let mockDb;
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => mockClient)
}));
vi.mock('$lib/server/971bot.js', () => ({
  getSupabase: vi.fn(() => mockDb)
}));

function request(body) {
  return {
    headers: { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer token' : null) },
    json: async () => body
  };
}

function url(path) {
  return new URL(`http://localhost${path}`);
}

describe('api/vision', () => {
  beforeEach(() => {
    mockClient = makeMockClient();
    mockDb = makeMockClient();
  });

  describe('GET', () => {
    it('rejects unauthenticated requests', async () => {
      mockClient = makeMockClient({}, { user: null });
      const { GET } = await import('./+server.js');
      const res = await GET({ request: request(), url: url('/api/vision') });
      expect(res.status).toBe(401);
    });

    it('lists matches when no id is given', async () => {
      mockClient = makeMockClient({ vision_matches: [{ data: [{ id: 'm1' }], error: null }] });
      const { GET } = await import('./+server.js');
      const res = await GET({ request: request(), url: url('/api/vision') });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data).toEqual([{ id: 'm1' }]);
    });

    it('aggregates an event dashboard from matches/discrepancies/runners/queue depth', async () => {
      mockClient = makeMockClient({
        vision_matches: [{
          data: [
            { id: 'm1', match_key: 'qm1', status: 'complete', vision_runs: [
              { id: 'r1', status: 'complete', released_at: '2026-01-01T00:00:00Z' },
              { id: 'r2', status: 'failed', released_at: null }
            ] },
            { id: 'm2', match_key: 'qm2', status: 'queued', vision_runs: [] }
          ],
          error: null
        }],
        vision_discrepancies: [{ data: [
          { id: 'd1', severity: 'critical', status: 'open' },
          { id: 'd2', severity: 'warning', status: 'accepted_vision' }
        ], error: null }],
        vision_runners: [{ data: [{ runner_id: 'gpu-1', last_seen_at: new Date().toISOString() }], error: null }],
        vision_runs: [{ data: null, error: null, count: 2 }]
      });
      const { GET } = await import('./+server.js');
      const res = await GET({ request: request(), url: url('/api/vision?dashboard=2026casf') });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.matches_total).toBe(2);
      expect(body.data.matches_complete).toBe(1);
      expect(body.data.runs).toEqual({ total: 2, complete: 1, failed: 1, in_progress: 0, released: 1 });
      expect(body.data.discrepancies).toEqual({ total: 2, open: 1, open_critical: 1, resolved: 1 });
      expect(body.data.queue_depth).toBe(2);
      expect(body.data.runners[0].online).toBe(true);
    });

    it('marks a runner offline when its last heartbeat is stale', async () => {
      mockClient = makeMockClient({
        vision_matches: [{ data: [], error: null }],
        vision_runners: [{ data: [{ runner_id: 'gpu-1', last_seen_at: new Date(Date.now() - 10 * 60_000).toISOString() }], error: null }],
        vision_runs: [{ data: null, error: null, count: 0 }]
      });
      const { GET } = await import('./+server.js');
      const res = await GET({ request: request(), url: url('/api/vision?dashboard=2026casf') });
      const body = await res.json();
      expect(body.data.runners[0].online).toBe(false);
    });
  });

  describe('POST create-match / add-view / queue-run / review', () => {
    it('rejects create-match without event_key/match_key', async () => {
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'create-match' }) });
      expect(res.status).toBe(400);
    });

    it('creates a match', async () => {
      mockClient = makeMockClient({ vision_matches: [{ data: { id: 'm1' }, error: null }] });
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'create-match', event_key: '2026casf', match_key: '2026casf_qm1' }) });
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.id).toBe('m1');
    });

    it('queue-run rejects a match with no uploaded views yet', async () => {
      mockClient = makeMockClient({ vision_views: [{ data: [], error: null }] });
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'queue-run', vision_match_id: 'm1', model_name: 'yolo', model_version: 'v1' }) });
      expect(res.status).toBe(400);
    });

    it('review rejects an invalid status value', async () => {
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'review', id: 'd1', status: 'not-a-real-status' }) });
      expect(res.status).toBe(400);
    });
  });

  describe('POST release-run', () => {
    const run = { id: 'run-1', status: 'complete', released_at: null, vision_matches: { match_key: '2026casf_qm1' } };
    const observations = [
      { observation_type: 'fuel_scored', team_key: 'frc971', alliance: 'red', started_ms: 1000, value: { count: 3 }, review_status: 'accepted' },
      { observation_type: 'climb_success', team_key: 'frc971', alliance: 'red', started_ms: 5000, value: { level: 'L2' }, review_status: 'accepted' }
    ];

    it('requires run_id', async () => {
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'release-run' }) });
      expect(res.status).toBe(400);
    });

    it('rejects an actor without VISION_RELEASE', async () => {
      mockClient = makeMockClient({ user_profiles: [{ data: { role: 'member', permissions: ['CAN_SEE_ROUTES'] }, error: null }] });
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'release-run', run_id: 'run-1' }) });
      expect(res.status).toBe(403);
    });

    it('rejects a run that is not complete', async () => {
      mockClient = makeMockClient({ user_profiles: [{ data: { role: 'member', permissions: ['VISION_RELEASE'] }, error: null }] });
      mockDb = makeMockClient({ vision_runs: [{ data: { ...run, status: 'processing' }, error: null }] });
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'release-run', run_id: 'run-1' }) });
      expect(res.status).toBe(400);
    });

    it('rejects a run that was already released', async () => {
      mockClient = makeMockClient({ user_profiles: [{ data: { role: 'member', permissions: ['VISION_RELEASE'] }, error: null }] });
      mockDb = makeMockClient({ vision_runs: [{ data: { ...run, released_at: '2026-01-01T00:00:00Z' }, error: null }] });
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'release-run', run_id: 'run-1' }) });
      expect(res.status).toBe(409);
    });

    it('rejects a run with no attributable (team-identified) results', async () => {
      mockClient = makeMockClient({ user_profiles: [{ data: { role: 'member', permissions: ['VISION_RELEASE'] }, error: null }] });
      mockDb = makeMockClient({
        vision_runs: [{ data: run, error: null }],
        vision_tracks: [{ data: [], error: null }],
        vision_observations: [{ data: [{ observation_type: 'fuel_scored', team_key: null, alliance: 'red', started_ms: 1000, value: { count: 3 }, review_status: 'accepted' }], error: null }]
      });
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'release-run', run_id: 'run-1' }) });
      expect(res.status).toBe(400);
    });

    it('an admin (no explicit VISION_RELEASE permission) can still release', async () => {
      mockClient = makeMockClient({ user_profiles: [{ data: { role: 'admin', permissions: [] }, error: null }] });
      mockDb = makeMockClient({
        vision_runs: [{ data: run, error: null }],
        vision_tracks: [{ data: [], error: null }],
        vision_observations: [{ data: observations, error: null }],
        scout_data_events: [{ data: [{ id: 'e1' }, { id: 'e2' }], error: null }]
      });
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'release-run', run_id: 'run-1' }) });
      expect(res.status).toBe(200);
    });

    it('releases fuel and a valid climb_pos as scout_data_events, tagged role: vision', async () => {
      mockClient = makeMockClient({ user_profiles: [{ data: { role: 'member', permissions: ['VISION_RELEASE'] }, error: null }] });
      const insertedRows = [];
      mockDb = makeMockClient({
        vision_runs: [{ data: run, error: null }],
        vision_tracks: [{ data: [], error: null }],
        vision_observations: [{ data: observations, error: null }],
        scout_data_events: [{ data: [{ id: 'e1' }, { id: 'e2' }], error: null }]
      });
      // Capture what's actually passed to insert() so the mapping (event_type,
      // event_value, role) can be asserted, not just the HTTP status.
      const originalFrom = mockDb.from;
      mockDb.from = (table) => {
        const chain = originalFrom(table);
        if (table === 'scout_data_events') {
          const originalInsert = chain.insert;
          chain.insert = (rows) => { insertedRows.push(...rows); return originalInsert(rows); };
        }
        return chain;
      };

      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'release-run', run_id: 'run-1' }) });
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.data.released_count).toBe(2);
      expect(insertedRows).toEqual(expect.arrayContaining([
        expect.objectContaining({ team_key: 'frc971', event_type: 'hub_fuel_override', event_value: '3', role: 'vision', match_key: '2026casf_qm1' }),
        expect.objectContaining({ team_key: 'frc971', event_type: 'climb_pos', event_value: 'L2', role: 'vision', match_key: '2026casf_qm1' })
      ]));
    });

    it('skips an unrecognized climb value instead of writing garbage into climb_pos', async () => {
      mockClient = makeMockClient({ user_profiles: [{ data: { role: 'member', permissions: ['VISION_RELEASE'] }, error: null }] });
      const insertedRows = [];
      mockDb = makeMockClient({
        vision_runs: [{ data: run, error: null }],
        vision_tracks: [{ data: [], error: null }],
        vision_observations: [{ data: [
          { observation_type: 'fuel_scored', team_key: 'frc971', alliance: 'red', started_ms: 1000, value: { count: 1 }, review_status: 'accepted' },
          { observation_type: 'climb_success', team_key: 'frc971', alliance: 'red', started_ms: 5000, value: { level: 'success' }, review_status: 'accepted' }
        ], error: null }],
        scout_data_events: [{ data: [{ id: 'e1' }], error: null }]
      });
      const originalFrom = mockDb.from;
      mockDb.from = (table) => {
        const chain = originalFrom(table);
        if (table === 'scout_data_events') {
          const originalInsert = chain.insert;
          chain.insert = (rows) => { insertedRows.push(...rows); return originalInsert(rows); };
        }
        return chain;
      };
      const { POST } = await import('./+server.js');
      await POST({ request: request({ action: 'release-run', run_id: 'run-1' }) });
      expect(insertedRows.some((row) => row.event_type === 'climb_pos')).toBe(false);
    });

    it('refuses to release unreviewed model observations', async () => {
      mockClient = makeMockClient({ user_profiles: [{ data: { role: 'member', permissions: ['VISION_RELEASE'] }, error: null }] });
      mockDb = makeMockClient({
        vision_runs: [{ data: run, error: null }],
        vision_tracks: [{ data: [], error: null }],
        vision_observations: [{ data: [{
          observation_type: 'fuel_scored', team_key: 'frc971', alliance: 'red',
          started_ms: 1000, value: { count: 9 }, review_status: 'unreviewed'
        }], error: null }]
      });
      const { POST } = await import('./+server.js');
      const res = await POST({ request: request({ action: 'release-run', run_id: 'run-1' }) });
      expect(res.status).toBe(400);
    });
  });

  it('rejects an invalid observation review state', async () => {
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'review-observation', id: 'o1', status: 'rubber-stamped' }) });
    expect(res.status).toBe(400);
  });

  it('records a corrected observation for human-reviewed release', async () => {
    mockClient = makeMockClient({ vision_observations: [{ data: { id: 'o1', review_status: 'corrected' }, error: null }] });
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({
      action: 'review-observation', id: 'o1', status: 'corrected',
      team_key: 'frc971', value: { count: 4 }
    }) });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data.review_status).toBe('corrected');
  });

  it('rejects an unknown action', async () => {
    const { POST } = await import('./+server.js');
    const res = await POST({ request: request({ action: 'not-a-real-action' }) });
    expect(res.status).toBe(400);
  });
});
