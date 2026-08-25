// Batch-syncs scouting data to a single, scout-manager-configured Google
// Sheet - deliberately NOT real-time (no API call per tap/event). Design
// context: docs/plans has the fuller feature history; the short version is
// this replaces "every scout sets up their own export" with one shared
// sheet the whole team points at.
//
// Auth: reuses the same service account as the AutoCAM Drive watcher
// (GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY), via $lib/server/google_service_account.js
// with a spreadsheets-scoped token instead of Drive's. The target sheet
// must be shared (Editor access) with that service account's email - same
// sharing model already used for AutoCAM's watched Drive folders, not a
// new concept for whoever manages that credential.
//
// STATUS: built and safe to ship with zero configuration (no-ops until
// both scouting_settings.google_sheet_id and GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY
// are set), but genuinely untested against a real Google Sheet - this
// environment has no Google credentials, same caveat already accepted for
// the Drive watcher (see its own header comment). Treat the first real
// sync against a real sheet as unverified.
import { getSupabase } from '$lib/server/971bot.js';
import { getServiceAccountAccessToken } from '$lib/server/google_service_account.js';
import { deriveMatchTeamRow } from '$lib/scoutingStats.js';
import { env } from '$env/dynamic/private';

const SHEETS_SCOPE = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';
// Unqualified range (no "SheetName!" prefix) targets the spreadsheet's
// first visible tab by default - avoids requiring the scout manager to
// create/rename a specific tab before this works at all.
const SYNC_RANGE = 'A1:N5000';

const HEADER_ROW = [
  'Match', 'Team', 'Auto Start', 'Dead Auto', 'Auto Climb', 'Final Climb',
  'Driving Rank', 'Accuracy', 'Speed', 'Shuttle Fuel', 'Hub Fuel',
  'Scouted By', 'Last Updated', 'Match Number'
];

function matchTeamGroups(events) {
  const groups = new Map();
  for (const e of events || []) {
    if (!e?.match_key || !e?.team_key) continue;
    const key = `${e.match_key}::${e.team_key}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  }
  return groups;
}

function matchSortKey(matchKey) {
  // qm12 should sort after qm2, not before it as a plain string would -
  // pull the trailing number out and pad it, same idea as the existing
  // formatMatchLabel-style sorts elsewhere in scouting UI.
  const m = String(matchKey || '').match(/(\d+)$/);
  const num = m ? m[1].padStart(6, '0') : '000000';
  return `${matchKey.replace(/\d+$/, '')}${num}`;
}

async function resolveScoutNames(supa, userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (!ids.length) return new Map();
  const { data } = await supa.from('user_profiles').select('id, full_name, email').in('id', ids);
  return new Map((data || []).map((u) => [u.id, u.full_name || u.email || u.id]));
}

export async function syncScoutingDataToSheet() {
  const supa = getSupabase();
  const { data: settings, error: settingsError } = await supa
    .from('scouting_settings')
    .select('event_key, google_sheet_id')
    .eq('id', 1)
    .maybeSingle();
  if (settingsError) return { ok: false, reason: 'settings-query-failed', error: settingsError.message };

  const eventKey = String(settings?.event_key || '').trim();
  const sheetId = String(settings?.google_sheet_id || '').trim();
  if (!eventKey || !sheetId) {
    return { ok: false, reason: 'not-configured' };
  }

  const serviceAccountJson = env.GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountJson) {
    return { ok: false, reason: 'no-service-account' };
  }

  try {
    const { data: events, error: eventsError } = await supa
      .from('scout_data_events')
      .select('match_key, match_number, team_key, event_type, event_value, created_at, created_by')
      .ilike('match_key', `${eventKey}_%`);
    if (eventsError) throw new Error(eventsError.message);

    const groups = matchTeamGroups(events);
    const scoutIds = (events || []).map((e) => e.created_by);
    const scoutNames = await resolveScoutNames(supa, scoutIds);

    const rows = [...groups.entries()]
      .map(([key, groupEvents]) => {
        const [matchKey, teamKey] = key.split('::');
        const row = deriveMatchTeamRow(groupEvents);
        const lastEvent = groupEvents.reduce((latest, e) =>
          !latest || new Date(e.created_at) > new Date(latest.created_at) ? e : latest, null);
        const scoutId = groupEvents.find((e) => e.created_by)?.created_by;
        return {
          matchKey,
          teamKey,
          matchNumber: groupEvents[0]?.match_number ?? null,
          row,
          scoutedBy: scoutId ? scoutNames.get(scoutId) || scoutId : '',
          lastUpdated: lastEvent?.created_at || ''
        };
      })
      .sort((a, b) => {
        const byMatch = matchSortKey(a.matchKey).localeCompare(matchSortKey(b.matchKey));
        if (byMatch !== 0) return byMatch;
        return String(a.teamKey).localeCompare(String(b.teamKey));
      });

    const values = [
      HEADER_ROW,
      ...rows.map(({ matchKey, teamKey, matchNumber, row, scoutedBy, lastUpdated }) => [
        matchKey,
        teamKey.replace(/^frc/i, ''),
        row.autoStartPosition,
        row.deadAuto ? 'Yes' : 'No',
        row.autoClimbPos,
        row.finalClimbPos,
        row.drivingRank ?? '',
        row.accuracy ?? '',
        row.speed ?? '',
        row.shuttleFuel,
        row.hubFuel,
        scoutedBy,
        lastUpdated,
        matchNumber ?? ''
      ])
    ];

    const accessToken = await getServiceAccountAccessToken(serviceAccountJson, SHEETS_SCOPE);
    const res = await fetch(
      `${SHEETS_API}/${encodeURIComponent(sheetId)}/values/${encodeURIComponent(SYNC_RANGE)}?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({ range: SYNC_RANGE, majorDimension: 'ROWS', values })
      }
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const message = body?.error?.message || `Sheets API error ${res.status}`;
      await supa.from('scouting_settings').update({ google_sheet_last_sync_error: message }).eq('id', 1);
      return { ok: false, reason: 'sheets-api-error', error: message };
    }

    await supa
      .from('scouting_settings')
      .update({ google_sheet_last_synced_at: new Date().toISOString(), google_sheet_last_sync_error: null })
      .eq('id', 1);

    return { ok: true, rows: rows.length };
  } catch (e) {
    const message = e?.message || String(e);
    await supa.from('scouting_settings').update({ google_sheet_last_sync_error: message }).eq('id', 1).then(() => {}, () => {});
    return { ok: false, reason: 'exception', error: message };
  }
}
