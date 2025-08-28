import { supabase } from './supabase.js';

/**
 * Tracks user attendance if they're accessing from an allowed external IP
 * @param {string} userId - The user's UUID
 * @returns {Promise<boolean>} - Whether attendance was logged
 */
export async function trackUserAttendance(userId) {
  if (!userId) {
    console.log('No user ID provided for attendance tracking');
    return false;
  }

  try {
    console.log('Tracking attendance for user:', userId);
    
    const response = await fetch('/api/attendance', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ user_id: userId })
    });

    const result = await response.json();
    
    if (!response.ok) {
      console.error('Attendance tracking error:', result.error);
      return false;
    }

    if (result.attendance_logged) {
      console.log('✅ Attendance logged successfully from IP:', result.client_ip);
    } else {
      console.log('ℹ️ IP not in allowed list, attendance not logged:', result.client_ip);
    }

    return result.attendance_logged;
    
  } catch (error) {
    console.error('Error tracking attendance:', error);
    return false;
  }
}

/**
 * Gets the current user's attendance statistics
 * @param {string} userId - The user's UUID
 * @returns {Promise<Object|null>} - User's attendance data
 */
export async function getUserAttendanceStats(userId) {
  if (!userId) return null;

  try {
    const { data, error } = await supabase
      .from('attendance_leaderboard_30_days')
      .select('*')
      .eq('user_id', userId)
      .single();

    if (error && error.code !== 'PGRST116') { // PGRST116 is "not found"
      console.error('Error fetching attendance stats:', error);
      return null;
    }

    return data;
  } catch (error) {
    console.error('Error in getUserAttendanceStats:', error);
    return null;
  }
}

/**
 * Gets recent attendance activity for display
 * @param {number} limit - Number of recent activities to fetch
 * @returns {Promise<Array>} - Recent attendance activities
 */
export async function getRecentAttendanceActivity(limit = 10) {
  try {
    const { data, error } = await supabase
      .from('user_attendance_logs')
      .select(`
        *,
        user_profiles!inner(full_name, email)
      `)
      .order('login_time', { ascending: false })
      .limit(limit);

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching recent attendance:', error);
    return [];
  }
}

/**
 * Admin function to add a new allowed external IP
 * @param {string} ipAddress - The IP address to allow
 * @param {string} locationName - Human-readable location name
 * @param {string} description - Optional description
 * @returns {Promise<boolean>} - Success status
 */
export async function addAllowedIP(ipAddress, locationName, description = '') {
  try {
    const { error } = await supabase
      .from('allowed_external_ips')
      .insert({
        ip_address: ipAddress,
        location_name: locationName,
        description: description
      });

    if (error) {
      console.error('Error adding allowed IP:', error);
      return false;
    }

    console.log('✅ Added allowed IP:', ipAddress, locationName);
    return true;
  } catch (error) {
    console.error('Error in addAllowedIP:', error);
    return false;
  }
}

/**
 * Admin function to remove an allowed external IP
 * @param {string} ipAddress - The IP address to remove
 * @returns {Promise<boolean>} - Success status
 */
export async function removeAllowedIP(ipAddress) {
  try {
    const { error } = await supabase
      .from('allowed_external_ips')
      .delete()
      .eq('ip_address', ipAddress);

    if (error) {
      console.error('Error removing allowed IP:', error);
      return false;
    }

    console.log('✅ Removed allowed IP:', ipAddress);
    return true;
  } catch (error) {
    console.error('Error in removeAllowedIP:', error);
    return false;
  }
}

/**
 * Gets all allowed IPs for management interface
 * @returns {Promise<Array>} - List of allowed IPs
 */
export async function getAllowedIPs() {
  try {
    const { data, error } = await supabase
      .from('allowed_external_ips')
      .select('*')
      .order('location_name');

    if (error) throw error;

    return data || [];
  } catch (error) {
    console.error('Error fetching allowed IPs:', error);
    return [];
  }
}
