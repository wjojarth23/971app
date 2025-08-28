import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase.js';

/** @type {import('./$types').RequestHandler} */
export async function POST({ request, getClientAddress }) {
  try {
    const { user_id } = await request.json();
    
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
    
    // Return whether attendance was logged
    return json({ 
      success: true, 
      attendance_logged: data,
      client_ip: clientIP 
    });
    
  } catch (error) {
    console.error('Error in attendance API:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}

/** @type {import('./$types').RequestHandler} */
export async function GET({ url }) {
  try {
    const action = url.searchParams.get('action');
    
    if (action === 'allowed-ips') {
      // Get list of allowed external IPs
      const { data, error } = await supabase
        .from('allowed_external_ips')
        .select('*')
        .order('location_name');
      
      if (error) throw error;
      
      return json({ success: true, data });
    }
    
    if (action === 'attendance-stats') {
      // Get attendance statistics
      const { data, error } = await supabase
        .from('attendance_leaderboard_30_days')
        .select('*')
        .order('days_attended', { ascending: false });
      
      if (error) throw error;
      
      return json({ success: true, data });
    }
    
    return json({ error: 'Invalid action' }, { status: 400 });
    
  } catch (error) {
    console.error('Error in attendance GET API:', error);
    return json({ error: 'Internal server error' }, { status: 500 });
  }
}
