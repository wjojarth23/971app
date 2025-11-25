import { supabase } from './supabase.js';

const scheduleSelection = `
  id,
  label,
  day_of_week,
  start_time,
  end_time,
  active,
  attendance_schedule_locations (
    location_id,
    attendance_locations ( id, name, network_cidr, active )
  )
`;

const mapSchedule = (row = {}) => {
  const relations = Array.isArray(row.attendance_schedule_locations)
    ? row.attendance_schedule_locations
    : [];
  const locations = relations
    .map((rel) => rel?.attendance_locations)
    .filter(Boolean)
    .map((loc) => ({
      id: loc.id,
      name: loc.name,
      network_cidr: loc.network_cidr,
      active: loc.active
    }));
  return {
    id: row.id,
    label: row.label,
    day_of_week: row.day_of_week,
    start_time: row.start_time,
    end_time: row.end_time,
    active: row.active,
    location_ids: relations.map((rel) => rel.location_id),
    locations
  };
};

const mapLocation = (row = {}) => ({
  id: row.id,
  name: row.name,
  network_cidr: row.network_cidr,
  description: row.description,
  active: row.active,
  created_at: row.created_at
});

export async function trackUserAttendance(userId) {
  if (!userId) {
    console.warn('No user ID provided for attendance tracking');
    return { recorded: false };
  }

  try {
    const response = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id: userId })
    });

    const result = await response.json();
    if (!response.ok) {
      console.error('Attendance tracking error:', result?.error);
      return { recorded: false, error: result?.error };
    }

    return {
      recorded: !!result.attendance_logged,
      client_ip: result.client_ip,
      record: result.record || null
    };
  } catch (error) {
    console.error('Error tracking attendance:', error);
    return { recorded: false, error: error?.message || 'Unknown error' };
  }
}

export async function getUserAttendanceStats(userId) {
  if (!userId) return null;
  try {
    const { data, error } = await supabase
      .from('attendance_leaderboard_30_days')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error fetching attendance stats:', error);
      return null;
    }

    return data || null;
  } catch (error) {
    console.error('Error in getUserAttendanceStats:', error);
    return null;
  }
}

export async function getUserAttendanceHistory(userId, limit = 20) {
  if (!userId) return [];
  try {
    const { data, error } = await supabase
      .from('user_attendance_logs')
      .select(`
        id,
        recorded_at,
        attendance_locations ( id, name ),
        attendance_schedules ( id, label )
      `)
      .eq('user_id', userId)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || []).map((row) => ({
      id: row.id,
      recorded_at: row.recorded_at,
      location: row.attendance_locations ?? null,
      schedule: row.attendance_schedules ?? null
    }));
  } catch (error) {
    console.error('Error fetching attendance history:', error);
    return [];
  }
}

export async function getRecentAttendanceActivity(limit = 10) {
  try {
    const { data, error } = await supabase
      .from('user_attendance_logs')
      .select(`
        recorded_at,
        user_profiles!inner(id, full_name),
        attendance_locations ( id, name )
      `)
      .order('recorded_at', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return (data || []).map((row) => ({
      recorded_at: row.recorded_at,
      user: row.user_profiles,
      location: row.attendance_locations
    }));
  } catch (error) {
    console.error('Error fetching recent attendance:', error);
    return [];
  }
}

export async function fetchAttendanceLeaderboard({ search = '', limit = 200, days = 30, start, end } = {}) {
  try {
    const params = new URLSearchParams();
    params.set('action', 'leaderboard');
    params.set('limit', String(limit));
    if (search) params.set('q', search);
    if (start) params.set('start', start);
    if (end) params.set('end', end);
    else if (days) params.set('days', String(days));

    const res = await fetch(`/api/attendance?${params.toString()}`);
    const payload = await res.json();
    if (!res.ok) {
      console.error('Error loading attendance leaderboard:', payload?.error || res.statusText);
      return [];
    }

    return (payload.data || []).map((row) => ({
      // ensure email is not exposed
      user_id: row.user_id,
      full_name: row.full_name,
      email: null,
      days_attended: row.days_attended,
      total_check_ins: row.total_check_ins,
      last_attended_at: row.last_attended_at
    }));
  } catch (error) {
    console.error('Error loading attendance leaderboard:', error);
    return [];
  }
}

export async function getCurrentNetworkFingerprint() {
  try {
    const response = await fetch('/api/attendance?action=current-ip');
    const payload = await response.json();
    if (!response.ok) throw new Error(payload?.error || 'Unable to fetch network info');
    return payload.client_ip;
  } catch (error) {
    console.error('Failed to capture network fingerprint:', error);
    return null;
  }
}

export async function fetchAttendanceLocations() {
  try {
    const { data, error } = await supabase
      .from('attendance_locations')
      .select('*')
      .order('name');
    if (error) throw error;
    return (data || []).map(mapLocation);
  } catch (error) {
    console.error('Error fetching attendance locations:', error);
    return [];
  }
}

export async function createAttendanceLocation(payload) {
  const insert = {
    name: payload?.name,
    network_cidr: payload?.network_cidr,
    description: payload?.description || null,
    active: payload?.active ?? true,
    created_by: payload?.created_by || null
  };
  try {
    const { data, error } = await supabase
      .from('attendance_locations')
      .insert(insert)
      .select('*')
      .single();
    if (error) throw error;
    return mapLocation(data);
  } catch (error) {
    console.error('Error creating attendance location:', error);
    throw error;
  }
}

export async function updateAttendanceLocation(id, payload) {
  if (!id) throw new Error('Location ID required');
  const updates = {};
  if (payload?.name !== undefined) updates.name = payload.name;
  if (payload?.network_cidr !== undefined) updates.network_cidr = payload.network_cidr;
  if (payload?.description !== undefined) updates.description = payload.description;
  if (payload?.active !== undefined) updates.active = payload.active;
  if (Object.keys(updates).length === 0) {
    const { data } = await supabase
      .from('attendance_locations')
      .select('*')
      .eq('id', id)
      .single();
    return mapLocation(data);
  }
  try {
    const { data, error } = await supabase
      .from('attendance_locations')
      .update(updates)
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return mapLocation(data);
  } catch (error) {
    console.error('Error updating attendance location:', error);
    throw error;
  }
}

export async function deleteAttendanceLocation(id) {
  if (!id) return false;
  try {
    const { error } = await supabase
      .from('attendance_locations')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting attendance location:', error);
    return false;
  }
}

async function syncScheduleLocations(scheduleId, locationIds = []) {
  const { error: deleteError } = await supabase
    .from('attendance_schedule_locations')
    .delete()
    .eq('schedule_id', scheduleId);
  if (deleteError) throw deleteError;

  if (locationIds.length === 0) return;

  const rows = locationIds.map((location_id) => ({ schedule_id: scheduleId, location_id }));
  const { error: insertError } = await supabase.from('attendance_schedule_locations').insert(rows);
  if (insertError) throw insertError;
}

export async function fetchAttendanceSchedules() {
  try {
    const { data, error } = await supabase
      .from('attendance_schedules')
      .select(scheduleSelection)
      .order('day_of_week')
      .order('start_time');
    if (error) throw error;
    return (data || []).map(mapSchedule);
  } catch (error) {
    console.error('Error fetching attendance schedules:', error);
    return [];
  }
}

export async function createAttendanceSchedule(payload) {
  const insert = {
    label: payload?.label,
    day_of_week: payload?.day_of_week,
    start_time: payload?.start_time,
    end_time: payload?.end_time,
    active: payload?.active ?? true,
    created_by: payload?.created_by || null
  };
  try {
    const { data, error } = await supabase
      .from('attendance_schedules')
      .insert(insert)
      .select(scheduleSelection)
      .single();
    if (error) throw error;
    const locationIds = payload?.location_ids || [];
    if (locationIds.length) {
      await syncScheduleLocations(data.id, locationIds);
      const refreshed = await supabase
        .from('attendance_schedules')
        .select(scheduleSelection)
        .eq('id', data.id)
        .single();
      if (refreshed.error) throw refreshed.error;
      return mapSchedule(refreshed.data);
    }
    return mapSchedule(data);
  } catch (error) {
    console.error('Error creating attendance schedule:', error);
    throw error;
  }
}

export async function updateAttendanceSchedule(id, payload) {
  if (!id) throw new Error('Schedule ID required');
  const update = {};
  if (payload?.label !== undefined) update.label = payload.label;
  if (payload?.day_of_week !== undefined) update.day_of_week = payload.day_of_week;
  if (payload?.start_time !== undefined) update.start_time = payload.start_time;
  if (payload?.end_time !== undefined) update.end_time = payload.end_time;
  if (payload?.active !== undefined) update.active = payload.active;
  try {
    const { data, error } = await supabase
      .from('attendance_schedules')
      .update(update)
      .eq('id', id)
      .select(scheduleSelection)
      .single();
    if (error) throw error;
    await syncScheduleLocations(id, payload?.location_ids || []);
    const refreshed = await supabase
      .from('attendance_schedules')
      .select(scheduleSelection)
      .eq('id', id)
      .single();
    if (refreshed.error) throw refreshed.error;
    return mapSchedule(refreshed.data);
  } catch (error) {
    console.error('Error updating attendance schedule:', error);
    throw error;
  }
}

export async function deleteAttendanceSchedule(id) {
  if (!id) return false;
  try {
    await supabase
      .from('attendance_schedule_locations')
      .delete()
      .eq('schedule_id', id);
    const { error } = await supabase
      .from('attendance_schedules')
      .delete()
      .eq('id', id);
    if (error) throw error;
    return true;
  } catch (error) {
    console.error('Error deleting attendance schedule:', error);
    return false;
  }
}
