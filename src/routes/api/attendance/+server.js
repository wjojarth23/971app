import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase.js';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';

const getClientFromRequest = (request) => {
  const auth = request?.headers?.get('authorization') || '';
  const headers = auth ? { Authorization: auth } : {};
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers }
  });
};

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, getClientAddress }) {
  try {
    const body = await request.json();
    const action = body?.action || 'check-in';
    if (action !== 'check-in') {
      return json({ error: 'Unsupported action' }, { status: 400 });
    }
    const { user_id } = body;
    
    if (!user_id) {
      return json({ error: 'User ID is required' }, { status: 400 });
    }
    
    // Get the client's IP address
    const clientIP = getClientAddress();

    // Helper: normalize IP addresses
    function normalizeClientIP(ip) {
      if (!ip || typeof ip !== 'string') return ip;
      // strip zone id (fe80::1%eth0)
      const noZone = ip.split('%')[0];

      // IPv4: drop the final octet (e.g. 205.167.46)
      const ipv4Match = noZone.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/);
      if (ipv4Match) return ipv4Match[1];

      // IPv6: normalize by truncating to /64 (keep first 4 hextets)
      try {
        // Expand '::' shorthand
        const parts = noZone.split('::');
        let hextets = [];
        if (parts.length === 2) {
          const left = parts[0] ? parts[0].split(':') : [];
          const right = parts[1] ? parts[1].split(':') : [];
          const missing = 8 - (left.filter(Boolean).length + right.filter(Boolean).length);
          hextets = [...left.filter(Boolean), ...new Array(missing).fill('0'), ...right.filter(Boolean)];
        } else {
          hextets = noZone.split(':').filter(Boolean);
        }
        if (hextets.length === 0) return noZone;
        const first4 = hextets.slice(0, 4).map(h => h.replace(/^0+/, '') || '0');
        // Return first 4 hextets only (e.g. 2001:db8:0:1)
        return first4.join(':');
      } catch (e) {
        return noZone;
      }
    }

    const clientIPNormalized = normalizeClientIP(clientIP);

    console.log('Attendance check for user:', user_id, 'from IP:', clientIP, 'normalized:', clientIPNormalized);

    // Call the database function to log attendance using the NORMALIZED client IP
    // (use first-three-octets for IPv4 and first-four-hextets for IPv6 per policy).
    const { data, error } = await supabase.rpc('log_user_attendance', {
      p_user_id: user_id,
      p_external_ip: clientIPNormalized
    });
    
    if (error) {
      console.error('Error logging attendance:', error);
      return json({ error: error.message }, { status: 500 });
    }

    let record = null;
    if (data === true) {
      const { data: latest } = await supabase
        .from('user_attendance_logs')
        .select(`
          id,
          recorded_at,
          attendance_locations ( id, name ),
          attendance_schedules ( id, label )
        `)
        .eq('user_id', user_id)
        .order('recorded_at', { ascending: false })
        .limit(1)
        .single();

      if (latest) {
        record = {
          id: latest.id,
          recorded_at: latest.recorded_at,
          location: latest.attendance_locations
            ? { id: latest.attendance_locations.id, name: latest.attendance_locations.name }
            : null,
          schedule: latest.attendance_schedules
            ? { id: latest.attendance_schedules.id, label: latest.attendance_schedules.label }
            : null
        };
      }
    }
    
    // Return whether attendance was logged
    return json({ 
      success: true, 
      attendance_logged: !!data,
      client_ip: clientIP,
      client_ip_normalized: clientIPNormalized,
      record
    });
    
  } catch (error) {
    console.error('Error in attendance API:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ url, getClientAddress, request }) {
  try {
    const action = url.searchParams.get('action');
    const supa = getClientFromRequest(request);
    
    if (action === 'current-ip') {
      return json({ success: true, client_ip: getClientAddress() });
    }
    
    if (action === 'leaderboard' || action === 'attendance-stats') {
      const search = url.searchParams.get('q') || '';
      const limit = Number(url.searchParams.get('limit') || '200');
      const daysParam = url.searchParams.get('days');
      const startParam = url.searchParams.get('start');
      const endParam = url.searchParams.get('end');

      // Default behavior: return the existing 30-day leaderboard view,
      // but strip emails before returning (privacy improvement).
      if (!daysParam && !startParam && !endParam) {
        let query = supa
          .from('attendance_leaderboard_30_days')
          .select('*')
          .order('days_attended', { ascending: false })
          .limit(limit);

        if (search) {
          query = query.or(`full_name.ilike.%${search}%,email.ilike.%${search}%`);
        }

        const { data, error } = await query;
        if (error) throw error;

        const safe = (data || []).map((row) => ({ ...row, email: null }));
        return json({ success: true, data: safe });
      }

      // Custom date range or days-based leaderboard: aggregate from logs
      // Parse date range
      let startDate;
      let endDate;
      if (startParam || endParam) {
        startDate = startParam ? new Date(startParam) : new Date(0);
        endDate = endParam ? new Date(endParam) : new Date();
      } else {
        const days = Number(daysParam) || 30;
        endDate = new Date();
        startDate = new Date(endDate);
        startDate.setDate(endDate.getDate() - days);
      }

      // Fetch logs in the requested range
      const { data: logs, error: logsError } = await supa
        .from('user_attendance_logs')
        .select('id, user_id, recorded_at')
        .gte('recorded_at', startDate.toISOString())
        .lte('recorded_at', endDate.toISOString())
        .order('recorded_at', { ascending: false })
        .limit(10000);

      if (logsError) throw logsError;

      console.log('attendance: fetched logs count=', (logs || []).length, 'start=', startDate.toISOString(), 'end=', endDate.toISOString());

      // Aggregate per-user: distinct PST dates attended, total check-ins, last attended
      const agg = new Map();
      for (const row of logs || []) {
        const uid = row.user_id;
        const existing = agg.get(uid) || { user_id: uid, daysSet: new Set(), total_check_ins: 0, last_attended_at: null };
        const d = new Date(row.recorded_at);
        // Convert to PST date string (YYYY-MM-DD) to count distinct days in Pacific time
        let pstDate;
        try {
          pstDate = d.toLocaleString('en-CA', { timeZone: 'America/Los_Angeles' }).slice(0, 10);
        } catch (e) {
          // Fallback to UTC date if Intl/timeZone not available
          pstDate = d.toISOString().slice(0, 10);
          console.warn('attendance: PST conversion failed, falling back to UTC date for', row.recorded_at, e && e.message);
        }
        existing.daysSet.add(pstDate);
        existing.total_check_ins += 1;
        if (!existing.last_attended_at || new Date(row.recorded_at) > new Date(existing.last_attended_at)) {
          existing.last_attended_at = row.recorded_at;
        }
        agg.set(uid, existing);
      }

      const userIds = Array.from(agg.keys());
      console.log('attendance: unique user ids in range=', userIds.length);
      let users = [];
      if (userIds.length) {
        const { data: ups, error: upsError } = await supa
          .from('user_profiles')
          .select('id, full_name')
          .in('id', userIds)
          .limit(10000);
        if (upsError) throw upsError;
        users = ups || [];
      }

      const entries = (users || []).map((u) => {
        const a = agg.get(u.id) || { daysSet: new Set(), total_check_ins: 0, last_attended_at: null };
        return {
          user_id: u.id,
          full_name: u.full_name,
          email: null,
          days_attended: a.daysSet.size,
          total_check_ins: a.total_check_ins,
          last_attended_at: a.last_attended_at
        };
      });

      entries.sort((a, b) => {
        if (b.days_attended !== a.days_attended) return b.days_attended - a.days_attended;
        const la = a.last_attended_at ? new Date(a.last_attended_at).getTime() : 0;
        const lb = b.last_attended_at ? new Date(b.last_attended_at).getTime() : 0;
        return lb - la;
      });

      return json({ success: true, data: entries.slice(0, limit) });
    }

    if (action === 'locations') {
      const { data, error } = await supa
        .from('attendance_locations')
        .select('*')
        .order('name');
      if (error) throw error;
      return json({ success: true, data });
    }

    if (action === 'schedules') {
      const { data, error } = await supa
        .from('attendance_schedules')
        .select(`
          *,
          attendance_schedule_locations (
            location_id,
            attendance_locations ( id, name, network_cidr, active )
          )
        `)
        .order('day_of_week')
        .order('start_time');
      if (error) throw error;
      return json({ success: true, data });
    }
    
    return json({ error: 'Invalid action' }, { status: 400 });
    
  } catch (error) {
    console.error('Error in attendance GET API:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
