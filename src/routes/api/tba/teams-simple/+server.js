import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';

// GET /api/tba/teams-simple?team_keys=frc254,frc971
export async function GET({ url }) {
  const raw = url.searchParams.get('team_keys') || '';
  const teamKeys = raw
    .split(',')
    .map((k) => String(k || '').trim().toLowerCase())
    .filter((k) => /^frc\d+$/.test(k));

  if (!teamKeys.length) return json({ success: true, data: [] });

  const authKey = env.TBA_API_KEY || env.VITE_TBA_API_KEY || env.PUBLIC_TBA_API_KEY;
  if (!authKey) return json({ success: false, error: 'Server missing TBA_API_KEY' }, { status: 500 });

  try {
    const uniqueKeys = [...new Set(teamKeys)];
    const data = [];

    await Promise.all(
      uniqueKeys.map(async (teamKey) => {
        const resp = await fetch(`https://www.thebluealliance.com/api/v3/team/${encodeURIComponent(teamKey)}/simple`, {
          headers: { 'X-TBA-Auth-Key': authKey }
        }).catch(() => null);
        if (!resp?.ok) return;
        const row = await resp.json().catch(() => null);
        if (!row?.key) return;
        data.push({
          key: row.key,
          team_number: row.team_number,
          nickname: row.nickname || '',
          name: row.name || ''
        });
      })
    );

    return json({ success: true, data });
  } catch (e) {
    return json({ success: false, error: e.message || 'Fetch failed' }, { status: 500 });
  }
}
