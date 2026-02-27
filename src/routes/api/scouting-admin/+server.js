import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { env } from '$env/dynamic/private';
import notescoutConfig from '$lib/notescout.json';
import { FRC_TEAMS, TEAM_ROLES } from '$lib/permissions.js';
import { getSupabase } from '$lib/server/971bot.js';

const COMPETITION_LEAD = String(TEAM_ROLES.COMPETITION_LEAD || 'Competition Lead');
const ALL_FRC_TEAMS = new Set(Object.values(FRC_TEAMS).map(String));
const COMPETITION_ROLE_PRIORITY = [
  'Scouting Lead',
  'Data Scout Lead',
  'Note Scout Lead',
  'Data Scout Member',
  'Note Scout Member'
];

const getClientFromRequest = (request) => {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
};

function fallbackEventKey() {
  return String(notescoutConfig?.event_key || '').trim() || null;
}

function isCompetitionLead(profile) {
  return String(profile?.team_role || '').trim().toLowerCase() === COMPETITION_LEAD.toLowerCase();
}

function isScoutingLead(rosterKeys) {
  const keys = new Set((rosterKeys || []).map(normalizeKey).filter(Boolean));
  return keys.has('scouting lead') || keys.has('data scout lead') || keys.has('note scout lead');
}

function canManageScouting(profile, rosterKeys) {
  return isCompetitionLead(profile) || isScoutingLead(rosterKeys);
}

function normalizeKey(value) {
  return String(value || '').trim().toLowerCase();
}

function pickCompetitionRole(roleSet) {
  for (const roleName of COMPETITION_ROLE_PRIORITY) {
    if (roleSet.has(roleName)) return roleName;
  }
  return null;
}

function matchNumberForKey(matchKey) {
  const m = String(matchKey || '').match(/_qm(\d+)$/i);
  return m ? Number(m[1]) : null;
}

function slotKey(matchKey, teamKey) {
  return `${matchKey}::${teamKey}`;
}

function userSlotKey(userId, matchKey, teamKey) {
  return `${userId}::${matchKey}::${teamKey}`;
}

async function fetchActorProfile(authSupa) {
  const { data } = await authSupa.auth.getUser();
  const actorId = data?.user?.id || null;
  if (!actorId) return { actorId: null, profile: null };

  const { data: profile } = await authSupa
    .from('user_profiles')
    .select('id, role, permissions, team_role')
    .eq('id', actorId)
    .single();

  return { actorId, profile: profile || null };
}

async function getActiveEventKey(db) {
  const { data, error } = await db
    .from('scouting_settings')
    .select('event_key')
    .eq('id', 1)
    .maybeSingle();

  if (error) return fallbackEventKey();
  return String(data?.event_key || '').trim() || fallbackEventKey();
}

async function fetchCompetitionRoleKeys(db) {
  const { data, error } = await db
    .from('roster_keys')
    .select('id, roster_id, key_name')
    .in('key_name', COMPETITION_ROLE_PRIORITY)
    .order('id', { ascending: true });

  if (error) throw error;

  const byName = new Map();
  for (const row of data || []) {
    const keyName = String(row?.key_name || '').trim();
    if (!keyName || byName.has(keyName)) continue;
    byName.set(keyName, {
      id: row.id,
      roster_id: row.roster_id,
      key_name: keyName
    });
  }

  return byName;
}

async function findScoutingRosterId(db, existingRoleKeys = new Map()) {
  for (const row of existingRoleKeys.values()) {
    if (row?.roster_id) return row.roster_id;
  }

  const { data, error } = await db
    .from('rosters')
    .select('id, name')
    .ilike('name', '%scout%')
    .order('id', { ascending: true });

  if (error) return null;
  const rows = data || [];
  const scoutingRoster =
    rows.find((r) => String(r?.name || '').toLowerCase().includes('scouting')) ||
    rows[0];

  return scoutingRoster?.id || null;
}

async function ensureCompetitionRoleKeys(db) {
  const byName = await fetchCompetitionRoleKeys(db);
  const missing = COMPETITION_ROLE_PRIORITY.filter((name) => !byName.has(name));
  if (!missing.length) return byName;

  const rosterId = await findScoutingRosterId(db, byName);
  if (!rosterId) return byName;

  for (const keyName of missing) {
    const { error } = await db.from('roster_keys').insert([
      {
        roster_id: rosterId,
        key_name: keyName,
        category: 'Scouting'
      }
    ]);

    if (error && error.code !== '23505') throw error;
  }

  return fetchCompetitionRoleKeys(db);
}

async function fetchCompetitionRolesByUser(db, keyIds) {
  if (!keyIds.length) return new Map();
  const { data, error } = await db
    .from('roster_entries')
    .select('user_id, key:key_id(key_name)')
    .in('key_id', keyIds);

  if (error) throw error;

  const byUser = new Map();
  for (const row of data || []) {
    const userId = row?.user_id;
    const keyName = String(row?.key?.key_name || '').trim();
    if (!userId || !keyName) continue;
    if (!byUser.has(userId)) byUser.set(userId, new Set());
    byUser.get(userId).add(keyName);
  }

  return byUser;
}

async function fetchRosterKeysForUser(db, userId) {
  if (!userId) return [];
  const { data, error } = await db
    .from('roster_entries')
    .select('key:key_id(key_name)')
    .eq('user_id', userId);

  if (error) return [];
  return (data || [])
    .map((row) => row?.key?.key_name)
    .filter(Boolean)
    .map(String);
}

async function fetchEventMatches(eventKey) {
  if (!eventKey) return { matches: [], warning: 'No event configured.' };

  const authKey = env.TBA_API_KEY || env.VITE_TBA_API_KEY || env.PUBLIC_TBA_API_KEY;
  if (!authKey) return { matches: [], warning: 'Server missing TBA_API_KEY.' };

  try {
    const resp = await fetch(`https://www.thebluealliance.com/api/v3/event/${encodeURIComponent(eventKey)}/matches`, {
      headers: { 'X-TBA-Auth-Key': authKey }
    });
    if (!resp.ok) {
      return { matches: [], warning: `TBA request failed (${resp.status}).` };
    }

    const raw = await resp.json();
    const matches = (raw || [])
      .filter((m) => m?.comp_level === 'qm')
      .sort((a, b) => (a?.match_number || 0) - (b?.match_number || 0));

    return { matches, warning: null };
  } catch (e) {
    return { matches: [], warning: e?.message || 'Failed to fetch TBA matches.' };
  }
}

async function fetchUpcomingEvents() {
  const authKey = env.TBA_API_KEY || env.VITE_TBA_API_KEY || env.PUBLIC_TBA_API_KEY;
  if (!authKey) return { events: [], warning: null };

  const now = new Date();
  const currentYear = now.getUTCFullYear();
  const yesterdayIso = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const teams = ['frc971', 'frc9584'];

  const urls = [
    ...teams.map((team) => `https://www.thebluealliance.com/api/v3/team/${team}/events/upcoming/simple`),
    ...teams.map((team) => `https://www.thebluealliance.com/api/v3/team/${team}/events/${currentYear}/simple`),
    ...teams.map((team) => `https://www.thebluealliance.com/api/v3/team/${team}/events/${currentYear + 1}/simple`)
  ];

  try {
    const responses = await Promise.all(
      urls.map((u) => fetch(u, { headers: { 'X-TBA-Auth-Key': authKey } }))
    );

    const okResponses = responses.filter((r) => r.ok);
    if (!okResponses.length) {
      const statuses = responses.map((r) => r?.status).filter(Boolean);
      const all404 = statuses.length > 0 && statuses.every((s) => s === 404);
      if (all404) {
        // Treat "no upcoming events endpoint data" as empty state, not an operator-facing error.
        return { events: [], warning: null };
      }
      return { events: [], warning: `TBA events request failed (${responses[0]?.status || 'unknown'}).` };
    }

    const payloads = await Promise.all(okResponses.map((r) => r.json()));
    const byKey = new Map();

    for (const list of payloads) {
      for (const ev of list || []) {
        if (!ev?.key) continue;
        byKey.set(ev.key, {
          key: ev.key,
          name: ev.name || ev.key,
          year: ev.year || null,
          start_date: ev.start_date || null,
          end_date: ev.end_date || null
        });
      }
    }

    const events = [...byKey.values()]
      .filter((ev) => {
        const end = String(ev?.end_date || '');
        if (!end) return true;
        return end >= yesterdayIso;
      })
      .sort((a, b) => {
        const aDate = String(a.start_date || '9999-12-31');
        const bDate = String(b.start_date || '9999-12-31');
        if (aDate !== bDate) return aDate.localeCompare(bDate);
        return String(a.key).localeCompare(String(b.key));
      });

    return { events, warning: null };
  } catch (e) {
    return { events: [], warning: e?.message || 'Failed to fetch upcoming events.' };
  }
}

function computeTypeMetrics({ type, assignments, matches, slotTeamsByMatch, evidenceRows, userNameMap }) {
  const totalMatches = matches.length;
  const totalSlots = totalMatches * 6;

  const relevantAssignments = (assignments || []).filter((row) => row?.scouting_type === type);
  const assignedSlots = new Set();
  for (const row of relevantAssignments) {
    if (!row?.assigned_user) continue;
    if (!slotTeamsByMatch.has(row.match_key)) continue;
    assignedSlots.add(slotKey(row.match_key, row.team_key));
  }

  let fullyAssignedMatches = 0;
  for (const match of matches) {
    const teams = slotTeamsByMatch.get(match.key) || [];
    const allAssigned = teams.every((teamKey) => assignedSlots.has(slotKey(match.key, teamKey)));
    if (allAssigned) fullyAssignedMatches += 1;
  }

  const anyEvidenceBySlot = new Set();
  const ownEvidenceBySlot = new Set();
  const userMaxStartedMatch = new Map();

  for (const row of evidenceRows || []) {
    const mk = row?.match_key;
    const tk = row?.team_key;
    const uid = row?.created_by;
    if (!mk || !tk) continue;
    if (!slotTeamsByMatch.has(mk)) continue;

    anyEvidenceBySlot.add(slotKey(mk, tk));

    if (uid) {
      ownEvidenceBySlot.add(userSlotKey(uid, mk, tk));
      const mn = matchNumberForKey(mk);
      if (mn !== null) {
        const prev = userMaxStartedMatch.get(uid) || 0;
        if (mn > prev) userMaxStartedMatch.set(uid, mn);
      }
    }
  }

  let fullyScoutedMatches = 0;
  for (const match of matches) {
    const teams = slotTeamsByMatch.get(match.key) || [];
    const allScouted = teams.every((teamKey) => anyEvidenceBySlot.has(slotKey(match.key, teamKey)));
    if (allScouted) fullyScoutedMatches += 1;
  }

  const missedAssignments = [];
  for (const row of relevantAssignments) {
    if (!row?.assigned_user) continue;
    if (!slotTeamsByMatch.has(row.match_key)) continue;

    const matchNumber = matchNumberForKey(row.match_key);
    if (matchNumber === null) continue;

    const ownEvidence = ownEvidenceBySlot.has(userSlotKey(row.assigned_user, row.match_key, row.team_key));
    if (ownEvidence) continue;

    const maxStarted = userMaxStartedMatch.get(row.assigned_user) || 0;
    if (maxStarted > matchNumber) {
      missedAssignments.push({
        scouting_type: type,
        match_key: row.match_key,
        match_number: matchNumber,
        team_key: row.team_key,
        assigned_user: row.assigned_user,
        user_name: userNameMap.get(row.assigned_user) || null
      });
    }
  }

  const percent = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

  return {
    assigned_matches: fullyAssignedMatches,
    assigned_match_percent: percent(fullyAssignedMatches, totalMatches),
    scouted_matches: fullyScoutedMatches,
    scouted_match_percent: percent(fullyScoutedMatches, totalMatches),
    assigned_slots: assignedSlots.size,
    total_slots: totalSlots,
    missed_shifts: missedAssignments.length,
    missed_shift_percent: percent(missedAssignments.length, assignedSlots.size || 0),
    missed_assignments: missedAssignments
  };
}

function computeMissedMatchList(dataMissed, noteMissed) {
  const byMatch = new Map();
  for (const item of [...dataMissed, ...noteMissed]) {
    if (!byMatch.has(item.match_key)) {
      byMatch.set(item.match_key, {
        match_key: item.match_key,
        match_number: item.match_number,
        data_missed_count: 0,
        note_missed_count: 0,
        missed_assignments: []
      });
    }
    const row = byMatch.get(item.match_key);
    if (item.scouting_type === 'data') row.data_missed_count += 1;
    if (item.scouting_type === 'note') row.note_missed_count += 1;
    row.missed_assignments.push(item);
  }

  return [...byMatch.values()].sort((a, b) => (a.match_number || 0) - (b.match_number || 0));
}

export async function GET({ request }) {
  try {
    const authSupa = getClientFromRequest(request);
    const { actorId, profile } = await fetchActorProfile(authSupa);
    const db = getSupabase();
    const actorRosterKeys = actorId ? await fetchRosterKeysForUser(db, actorId) : [];

    if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!canManageScouting(profile, actorRosterKeys)) return json({ error: 'Forbidden' }, { status: 403 });
    const eventKey = await getActiveEventKey(db);

    const [upcomingRes, matchesRes, usersRes, assignmentsRes, pitRes, competitionRoleKeys] = await Promise.all([
      fetchUpcomingEvents(),
      fetchEventMatches(eventKey),
      db
        .from('user_profiles')
        .select('id, full_name, email, role, team_role, frc_team, banned')
        .order('full_name', { ascending: true }),
      db
        .from('scout_match_assignments')
        .select('scouting_type, match_key, team_key, assigned_user, completed_at')
        .in('scouting_type', ['data', 'note']),
      eventKey
        ? db
            .from('pit_scout_entries')
            .select('team_key, drivebase_type, shooter_type, hopper_type, human_player_balls_in_auto')
            .eq('event_key', eventKey)
        : Promise.resolve({ data: [], error: null }),
      ensureCompetitionRoleKeys(db)
    ]);

    if (usersRes.error) return json({ error: usersRes.error.message }, { status: 500 });
    if (assignmentsRes.error) return json({ error: assignmentsRes.error.message }, { status: 500 });
    if (pitRes.error) return json({ error: pitRes.error.message }, { status: 500 });

    const competitionRoleOptions = [...COMPETITION_ROLE_PRIORITY];
    const competitionRoleKeyIds = competitionRoleOptions
      .map((name) => competitionRoleKeys.get(name)?.id || null)
      .filter(Boolean);
    const competitionRolesByUser = await fetchCompetitionRolesByUser(db, competitionRoleKeyIds);

    const matches = matchesRes.matches || [];
    const warning = matchesRes.warning || upcomingRes.warning || null;

    const matchKeys = matches.map((m) => m.key);
    const slotTeamsByMatch = new Map();
    const teamSet = new Set();

    for (const match of matches) {
      const teams = [
        ...(match?.alliances?.blue?.team_keys || []),
        ...(match?.alliances?.red?.team_keys || [])
      ];
      slotTeamsByMatch.set(match.key, teams);
      for (const teamKey of teams) teamSet.add(teamKey);
    }

    const dataEventsRes = matchKeys.length
      ? await db
          .from('scout_data_events')
          .select('match_key, team_key, created_by')
          .in('match_key', matchKeys)
      : { data: [], error: null };

    if (dataEventsRes.error) return json({ error: dataEventsRes.error.message }, { status: 500 });

    const noteEventsRes = matchKeys.length
      ? await db
          .from('scout_notes')
          .select('match_key, team_key, created_by')
          .in('match_key', matchKeys)
      : { data: [], error: null };

    if (noteEventsRes.error) return json({ error: noteEventsRes.error.message }, { status: 500 });

    const users = (usersRes.data || [])
      .filter((u) => !u?.banned)
      .map((u) => ({
        id: u.id,
        full_name: u.full_name || null,
        email: u.email || null,
        role: u.role || 'member',
        frc_team: u.frc_team || null,
        competition_role: pickCompetitionRole(competitionRolesByUser.get(u.id) || new Set())
      }));

    const userNameMap = new Map(users.map((u) => [u.id, u.full_name || u.email || u.id]));

    const assignments = assignmentsRes.data || [];

    const dataMetrics = computeTypeMetrics({
      type: 'data',
      assignments,
      matches,
      slotTeamsByMatch,
      evidenceRows: dataEventsRes.data || [],
      userNameMap
    });

    const noteMetrics = computeTypeMetrics({
      type: 'note',
      assignments,
      matches,
      slotTeamsByMatch,
      evidenceRows: noteEventsRes.data || [],
      userNameMap
    });

    const pitRows = pitRes.data || [];
    const pitCompleteSet = new Set(
      pitRows
        .filter((row) => row?.drivebase_type && row?.shooter_type && row?.hopper_type && row?.human_player_balls_in_auto)
        .map((row) => row.team_key)
    );

    const totalTeams = teamSet.size;
    const pitScoutedTeams = [...pitCompleteSet].filter((teamKey) => teamSet.has(teamKey)).length;

    const totalMatches = matches.length;
    const missedMatches = computeMissedMatchList(dataMetrics.missed_assignments, noteMetrics.missed_assignments);

    const pct = (num, den) => (den > 0 ? Math.round((num / den) * 1000) / 10 : 0);

    return json({
      success: true,
      data: {
        event_key: eventKey || null,
        upcoming_events: upcomingRes.events || [],
        warning,
        competition_role_options: competitionRoleOptions,
        users,
        metrics: {
          pit: {
            scouted_teams: pitScoutedTeams,
            total_teams: totalTeams,
            percent: pct(pitScoutedTeams, totalTeams)
          },
          data: {
            assigned_matches: dataMetrics.assigned_matches,
            scouted_matches: dataMetrics.scouted_matches,
            total_matches: totalMatches,
            assigned_percent: dataMetrics.assigned_match_percent,
            scouted_percent: dataMetrics.scouted_match_percent,
            missed_shifts: dataMetrics.missed_shifts,
            missed_shift_percent: dataMetrics.missed_shift_percent
          },
          note: {
            assigned_matches: noteMetrics.assigned_matches,
            scouted_matches: noteMetrics.scouted_matches,
            total_matches: totalMatches,
            assigned_percent: noteMetrics.assigned_match_percent,
            scouted_percent: noteMetrics.scouted_match_percent,
            missed_shifts: noteMetrics.missed_shifts,
            missed_shift_percent: noteMetrics.missed_shift_percent
          },
          overall: {
            assigned_percent: pct(
              dataMetrics.assigned_matches + noteMetrics.assigned_matches,
              Math.max(1, totalMatches * 2)
            ),
            scouted_percent: pct(
              dataMetrics.scouted_matches + noteMetrics.scouted_matches,
              Math.max(1, totalMatches * 2)
            ),
            missed_shift_percent: pct(
              dataMetrics.missed_shifts + noteMetrics.missed_shifts,
              Math.max(1, dataMetrics.assigned_slots + noteMetrics.assigned_slots)
            )
          }
        },
        missed_matches: missedMatches
      }
    });
  } catch (e) {
    return json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}

export async function POST({ request }) {
  try {
    const body = await request.json();
    const action = String(body?.action || '');

    const authSupa = getClientFromRequest(request);
    const { actorId, profile } = await fetchActorProfile(authSupa);
    const db = getSupabase();
    const actorRosterKeys = actorId ? await fetchRosterKeysForUser(db, actorId) : [];
    if (!actorId) return json({ error: 'Unauthorized' }, { status: 401 });
    if (!canManageScouting(profile, actorRosterKeys)) return json({ error: 'Forbidden' }, { status: 403 });

    if (action === 'update-event-key') {
      const eventKey = String(body?.event_key || '').trim();
      if (!eventKey) return json({ error: 'event_key is required' }, { status: 400 });

      const { data, error } = await db
        .from('scouting_settings')
        .upsert({ id: 1, event_key: eventKey, updated_by: actorId, updated_at: new Date().toISOString() }, { onConflict: 'id' })
        .select('event_key')
        .single();

      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data: { event_key: data?.event_key || eventKey } });
    }

    if (action !== 'update-competition-role') {
      return json({ error: 'Invalid action' }, { status: 400 });
    }

    const targetUserId = String(body?.target_user_id || '').trim();
    const competitionRoleRaw = body?.competition_role;
    const competitionRole = competitionRoleRaw === null || competitionRoleRaw === '' ? null : String(competitionRoleRaw).trim();
    const frcTeamRaw = body?.frc_team;
    const frcTeam = frcTeamRaw === null || frcTeamRaw === '' ? null : String(frcTeamRaw).trim();

    if (!targetUserId) return json({ error: 'target_user_id is required' }, { status: 400 });
    if (competitionRole !== null && !COMPETITION_ROLE_PRIORITY.includes(competitionRole)) {
      return json({ error: 'Invalid competition_role' }, { status: 400 });
    }
    if (frcTeam !== null && !ALL_FRC_TEAMS.has(frcTeam)) return json({ error: 'Invalid frc_team' }, { status: 400 });

    const { data: profileData, error: profileError } = await db
      .from('user_profiles')
      .update({ frc_team: frcTeam })
      .eq('id', targetUserId)
      .select('id, full_name, email, frc_team')
      .single();

    if (profileError) return json({ error: profileError.message }, { status: 500 });

    const roleKeyMap = await ensureCompetitionRoleKeys(db);
    const availableRoleNames = [...COMPETITION_ROLE_PRIORITY];
    const roleKeyIds = availableRoleNames
      .map((name) => roleKeyMap.get(name)?.id || null)
      .filter(Boolean);

    const { data: existingEntries, error: existingError } = roleKeyIds.length
      ? await db
          .from('roster_entries')
          .select('id, key_id')
          .eq('user_id', targetUserId)
          .in('key_id', roleKeyIds)
      : { data: [], error: null };

    if (existingError) return json({ error: existingError.message }, { status: 500 });

    const selectedRoleKey = competitionRole ? roleKeyMap.get(competitionRole) || null : null;
    if (competitionRole && !selectedRoleKey) {
      return json({ error: `Missing roster key for role "${competitionRole}". Add scouting keys in Admin > Roster Studio.` }, { status: 400 });
    }

    const keepKeyId = selectedRoleKey?.id || null;
    const entriesToDelete = (existingEntries || []).filter((entry) => entry.key_id !== keepKeyId);

    for (const entry of entriesToDelete) {
      const { error: delErr } = await db.from('roster_entries').delete().eq('id', entry.id);
      if (delErr) return json({ error: delErr.message }, { status: 500 });
    }

    const hasSelectedEntry = keepKeyId
      ? (existingEntries || []).some((entry) => entry.key_id === keepKeyId)
      : false;

    if (selectedRoleKey && !hasSelectedEntry) {
      const { error: insertErr } = await db.from('roster_entries').insert([
        {
          roster_id: selectedRoleKey.roster_id,
          user_id: targetUserId,
          key_id: selectedRoleKey.id
        }
      ]);

      if (insertErr) return json({ error: insertErr.message }, { status: 500 });
    }

    return json({
      success: true,
      data: {
        ...profileData,
        competition_role: competitionRole
      }
    });
  } catch (e) {
    return json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
