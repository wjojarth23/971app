import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import notescoutConfig from '$lib/notescout.json';
import { getSupabase } from '$lib/server/971bot';
import { notifyMatchReminder } from '$lib/server/slack_notifications.js';

function requireToken(url) {
  const expected = env.NOTIFICATION_CRON_TOKEN || env.CRON_NOTIFICATION_TOKEN || null;
  if (!expected) return true;
  const provided = url.searchParams.get('token');
  return provided === expected;
}

function eventKeyFromUrl(url) {
  return url.searchParams.get('event_key') || notescoutConfig?.event_key || null;
}

function matchStartTimestamp(match) {
  return match?.predicted_time || match?.time || null;
}

export async function GET({ url }) {
  if (!requireToken(url)) {
    return json({ error: 'Unauthorized' }, { status: 401 });
  }
  const eventKey = eventKeyFromUrl(url);
  if (!eventKey) {
    return json({ error: 'event_key missing' }, { status: 400 });
  }
  const windowSeconds = Number(url.searchParams.get('window') || 120);
  const authKey = env.TBA_API_KEY || env.VITE_TBA_API_KEY || env.PUBLIC_TBA_API_KEY;
  if (!authKey) {
    return json({ error: 'TBA_API_KEY missing' }, { status: 500 });
  }
  let matches = [];
  try {
    const resp = await fetch(`https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/matches` , {
      headers: { 'X-TBA-Auth-Key': authKey }
    });
    if (!resp.ok) {
      return json({ error: `TBA error ${resp.status}` }, { status: 502 });
    }
    matches = await resp.json();
  } catch (error) {
    return json({ error: error.message || 'TBA fetch failed' }, { status: 500 });
  }
  const now = Math.floor(Date.now() / 1000);
  const upcoming = (matches || []).filter((match) => {
    const start = matchStartTimestamp(match);
    if (!start) return false;
    const diff = start - now;
    return diff > 0 && diff <= windowSeconds;
  });
  if (!upcoming.length) {
    return json({ ok: true, scheduled: 0, reason: 'no-upcoming' });
  }
  const matchKeys = upcoming.map((m) => m.key);
  const supa = getSupabase();
  const { data: assignments, error: assignError } = await supa
    .from('scout_match_assignments')
    .select('match_key, team_key, assigned_user')
    .in('match_key', matchKeys);
  if (assignError) {
    return json({ error: assignError.message || 'Failed to load assignments' }, { status: 500 });
  }
  const assignmentMap = new Map();
  for (const matchKey of matchKeys) {
    assignmentMap.set(matchKey, new Map());
  }
  for (const row of assignments || []) {
    if (!row?.assigned_user) continue;
    const map = assignmentMap.get(row.match_key);
    if (!map) continue;
    const existing = map.get(row.assigned_user) || [];
    const teamLabel = row.team_key ? row.team_key.replace(/^frc/i, '') : 'match';
    if (!existing.includes(teamLabel)) existing.push(teamLabel);
    map.set(row.assigned_user, existing);
  }
  let sent = 0;
  for (const match of upcoming) {
    const map = assignmentMap.get(match.key);
    if (!map || map.size === 0) continue;
    for (const [userId, teams] of map.entries()) {
      const result = await notifyMatchReminder({
        userId,
        matchKey: match.key,
        teams,
        matchTime: matchStartTimestamp(match)
      });
      if (result?.ok) sent += 1;
    }
  }
  return json({ ok: true, scheduled: sent, matches: upcoming.length });
}
