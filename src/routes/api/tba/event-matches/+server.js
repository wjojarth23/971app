// Server proxy for The Blue Alliance event matches.
// GET /api/tba/event-matches?event_key=2025casj
// Hides the TBA_API_KEY from the browser; uses server env var TBA_API_KEY.
// Optional query params:
//   comp_level=qm (default: qm) - filter by comp level; use "all" for every match
//   sort=match_number (default) - basic numeric sort by match_number
// Returns: { success:true, data:[ { key, match_number, alliances:{ red:{team_keys:[]}, blue:{team_keys:[]} } } ] }
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

const COMP_LEVEL_ORDER = {
  pm: 0,
  qm: 1,
  ef: 2,
  qf: 3,
  sf: 4,
  f: 5
};

export async function GET({ url }) {
  const eventKey = url.searchParams.get('event_key');
  if (!eventKey) return json({ success: false, error: 'event_key required' }, { status: 400 });

  const rawCompLevel = url.searchParams.get('comp_level');
  const compLevel = rawCompLevel === null ? 'qm' : String(rawCompLevel).trim().toLowerCase();

  // Prefer private env (no PUBLIC_ prefix). Support legacy naming with VITE_ / PUBLIC_ fallbacks.
  const authKey = env.TBA_API_KEY || env.VITE_TBA_API_KEY || env.PUBLIC_TBA_API_KEY;
  if (!authKey) return json({ success: false, error: 'Server missing TBA_API_KEY' }, { status: 500 });

  try {
    const resp = await fetch(
      `https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/matches`,
      {
        headers: { 'X-TBA-Auth-Key': authKey }
      }
    );

    if (!resp.ok) {
      return json({ success: false, error: 'TBA upstream error ' + resp.status }, { status: 502 });
    }

    let data = await resp.json();
    if (compLevel && compLevel !== 'all') {
      data = (data || []).filter((match) => String(match.comp_level || '').toLowerCase() === compLevel);
    }

    data = (data || []).sort((a, b) => {
      const levelDelta =
        (COMP_LEVEL_ORDER[String(a?.comp_level || '').toLowerCase()] ?? 99) -
        (COMP_LEVEL_ORDER[String(b?.comp_level || '').toLowerCase()] ?? 99);
      if (levelDelta !== 0) return levelDelta;

      const setDelta = (a?.set_number || 0) - (b?.set_number || 0);
      if (setDelta !== 0) return setDelta;

      return (a?.match_number || 0) - (b?.match_number || 0);
    });

    return json({ success: true, data });
  } catch (e) {
    return json({ success: false, error: e.message || 'Fetch failed' }, { status: 500 });
  }
}
