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
    
    console.log('Attendance check for user:', user_id, 'from IP:', clientIP);
    
    // Call the database function to log attendance
    const { data, error } = await supabase.rpc('log_user_attendance', {
      p_user_id: user_id,
      p_external_ip: clientIP
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
      return json({ success: true, data });
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
