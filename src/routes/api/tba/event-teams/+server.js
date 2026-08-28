import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// GET /api/tba/event-teams?event_key=2025casj
// Returns lightweight team info for display names in scouting UIs.
export async function GET({ url }) {
  const eventKey = url.searchParams.get('event_key');
  if (!eventKey) return json({ success: false, error: 'event_key required' }, { status: 400 });

  const authKey = env.TBA_API_KEY || env.VITE_TBA_API_KEY || env.PUBLIC_TBA_API_KEY;
  if (!authKey) {
    // Local development should not require copying the production TBA secret
    // onto every laptop. The deployed endpoint already holds that credential
    // server-side and exposes only the same public team roster returned here.
    const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (isLocal) {
      try {
        const response = await fetch(
          `https://spartanshub.spartanrobotics.org/api/tba/event-teams?event_key=${encodeURIComponent(eventKey)}`
        );
        const payload = await response.json().catch(() => null);
        if (response.ok && payload?.success) return json(payload);
      } catch {
        // Return the actionable configuration error below if the deployed
        // proxy is unavailable too.
      }
    }
    return json({ success: false, error: 'Server missing TBA_API_KEY' }, { status: 500 });
  }

  try {
    const resp = await fetch(
      `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/teams/simple`,
      { headers: { 'X-TBA-Auth-Key': authKey } }
    );
    if (!resp.ok) {
      return json({ success: false, error: `TBA upstream error ${resp.status}` }, { status: 502 });
    }

    const rows = (await resp.json()) || [];
    const data = rows.map((row) => ({
      key: row.key,
      team_number: row.team_number,
      nickname: row.nickname || '',
      name: row.name || ''
    }));
    return json({ success: true, data });
  } catch (e) {
    return json({ success: false, error: e.message || 'Fetch failed' }, { status: 500 });
  }
}
