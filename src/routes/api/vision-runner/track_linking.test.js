import { describe, it, expect, vi, beforeEach } from 'vitest';

// Separate from server.test.js because these tests need to assert on the rows
// actually written, which the shared mock there deliberately doesn't capture.
const inserted = { vision_tracks: [], vision_observations: [] };

function makeMockClient({ trackIds = [] } = {}) {
  function makeChain(table) {
    let payload = null;
    const resultFor = () => {
      if (table === 'vision_runs') {
        return { data: { id: 'run-1', status: 'processing', vision_match_id: 'match-1', model_version: 'v1', config: {}, vision_matches: { match_key: '2026casj_qm1' } }, error: null };
      }
      if (table === 'vision_tracks') return { data: trackIds.map((id) => ({ id })), error: null };
      return { data: [], error: null };
    };
    const chain = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      limit: () => chain,
      in: () => chain,
      update: () => chain,
      upsert: () => chain,
      delete: () => chain,
      insert: (rows) => {
        payload = rows;
        if (inserted[table]) inserted[table].push(...(Array.isArray(rows) ? rows : [rows]));
        return chain;
      },
      single: () => Promise.resolve(resultFor(payload)),
      maybeSingle: () => Promise.resolve(resultFor(payload)),
      then: (onFulfilled, onRejected) => Promise.resolve(resultFor(payload)).then(onFulfilled, onRejected)
    };
    return chain;
  }
  return { from: (table) => makeChain(table) };
}

let mockClient;
vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn(() => mockClient) }));
vi.mock('$lib/server/slack_notifications.js', () => ({
  notifyVisionRunFailed: vi.fn(async () => ({ ok: true })),
  notifyVisionCriticalDiscrepancy: vi.fn(async () => ({ ok: true }))
}));
// No TBA reference: keeps these tests about track linking, not reconciliation.
vi.mock('$lib/server/vision_reference.js', () => ({ fetchTbaMatchReference: vi.fn(async () => null) }));
vi.mock('$env/dynamic/private', () => ({
  env: { VISION_RUNNER_TOKEN: 'correct-token', SUPABASE_URL: 'https://example.supabase.co', SUPABASE_SERVICE_KEY: 'service-key' }
}));

function request(body) {
  return {
    headers: { get: (name) => (name.toLowerCase() === 'authorization' ? 'Bearer correct-token' : null) },
    json: async () => body
  };
}

const track = (key, alliance) => ({
  track_key: key, view_id: 'view-1', alliance, team_key: null,
  started_ms: 0, ended_ms: 1000, identity_confidence: 0, tracking_confidence: 0.9,
  trajectory: [{ t: 500, x: 1, y: 1 }]
});

const observation = (trackKey, type = 'climb_success') => ({
  track_key: trackKey, view_id: 'view-1', team_key: null, alliance: 'red',
  observation_type: type, value: {}, started_ms: 500, ended_ms: 500, confidence: 0.8,
  source: 'yolo', evidence: {}
});

describe('complete: linking observations to their track', () => {
  beforeEach(() => {
    inserted.vision_tracks = [];
    inserted.vision_observations = [];
  });

  it('resolves each observation track_key to the real inserted track id', async () => {
    mockClient = makeMockClient({ trackIds: ['track-uuid-a', 'track-uuid-b'] });
    const { POST } = await import('./+server.js');
    await POST({
      request: request({
        action: 'complete', run_id: 'run-1',
        tracks: [track('view-1:7', 'red'), track('view-1:9', 'blue')],
        observations: [observation('view-1:9'), observation('view-1:7')]
      })
    });
    expect(inserted.vision_observations.map((row) => row.track_id))
      .toEqual(['track-uuid-b', 'track-uuid-a']);
  });

  it('strips track_key so it never reaches the database as a column', async () => {
    mockClient = makeMockClient({ trackIds: ['track-uuid-a'] });
    const { POST } = await import('./+server.js');
    await POST({
      request: request({
        action: 'complete', run_id: 'run-1',
        tracks: [track('view-1:7', 'red')],
        observations: [observation('view-1:7')]
      })
    });
    expect(inserted.vision_tracks[0]).not.toHaveProperty('track_key');
    expect(inserted.vision_observations[0]).not.toHaveProperty('track_key');
  });

  it('leaves track_id null for an observation nothing could be attributed to', async () => {
    mockClient = makeMockClient({ trackIds: ['track-uuid-a'] });
    const { POST } = await import('./+server.js');
    await POST({
      request: request({
        action: 'complete', run_id: 'run-1',
        tracks: [track('view-1:7', 'red')],
        observations: [observation(null), observation('view-1:404')]
      })
    });
    expect(inserted.vision_observations.map((row) => row.track_id)).toEqual([null, null]);
  });

  it('still records observations when a run produced no tracks at all', async () => {
    mockClient = makeMockClient({ trackIds: [] });
    const { POST } = await import('./+server.js');
    const res = await POST({
      request: request({
        action: 'complete', run_id: 'run-1', tracks: [],
        observations: [observation(null, 'fuel_scored')]
      })
    });
    expect(res.status).not.toBe(500);
    expect(inserted.vision_observations).toHaveLength(1);
    expect(inserted.vision_observations[0].track_id).toBeNull();
  });
});
