import { json } from '@sveltejs/kit';

// GET /api/statbotics/team-epas?event_key=2026casf
// Proxies Statbotics' public v3 API (no key required - api.statbotics.io) for
// EPA (Expected Points Added) ratings of every team at a given event. Field
// names below (epa, auto_epa, teleop_epa, endgame_epa, rank, etc.) are taken
// directly from Statbotics' own TeamEventORM model
// (backend/src/db/models/team_event.py in avgupta456/statbotics), not
// guessed - their OpenAPI schema for this endpoint doesn't document response
// fields (just "additionalProperties: true"), so the real field names had to
// come from the source model itself.
//
// Note: as of writing, api.statbotics.io is returning HTTP 500 on every
// query tested (including trivial ones like /v3/team/254 for a real,
// long-established team) - a live upstream outage, not a request-shape
// issue here. Handled the same way TBA upstream failures already are
// elsewhere in this app (502 with a clear error), so the UI can degrade
// gracefully instead of failing the whole page - see scouting/+page.svelte.
export async function GET({ url }) {
  const eventKey = url.searchParams.get('event_key');
  if (!eventKey) return json({ success: false, error: 'event_key required' }, { status: 400 });

  try {
    const resp = await fetch(
      `https://api.statbotics.io/v3/team_events?event=${encodeURIComponent(eventKey)}&metric=epa&ascending=false&limit=200`
    );
    if (!resp.ok) {
      return json({ success: false, error: `Statbotics upstream error ${resp.status}` }, { status: 502 });
    }

    const rows = (await resp.json()) || [];
    const data = rows.map((row) => ({
      team: row.team,
      team_name: row.team_name || '',
      rank: row.rank ?? null,
      epa: row.epa ?? null,
      auto_epa: row.auto_epa ?? null,
      teleop_epa: row.teleop_epa ?? null,
      endgame_epa: row.endgame_epa ?? null,
      wins: row.wins ?? 0,
      losses: row.losses ?? 0,
      ties: row.ties ?? 0
    }));
    return json({ success: true, data });
  } catch (e) {
    return json({ success: false, error: e.message || 'Fetch failed' }, { status: 500 });
  }
}
