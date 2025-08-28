# Attendance Tracking System

This system automatically tracks team member attendance based on their external IP addresses when they access the application. It's designed to monitor when team members are physically present at specific locations (workshops, labs, meeting rooms, etc.).

## Features

- **Automatic Tracking**: Logs attendance whenever users access the system from configured external IP addresses
- **Leaderboard**: Shows team attendance statistics over the last 30 days
- **Multiple Locations**: Support for tracking attendance across different physical locations
- **Real-time Updates**: User profiles are updated with attendance data in real-time
- **Export Functionality**: Export attendance data to CSV for further analysis
- **Admin Management**: Easy-to-use interface for managing allowed IP addresses

## Setup Instructions

### 1. Database Migration

Run the attendance tracking migration to set up the necessary database tables:

```sql
-- Execute migration_attendance_tracking.sql in your Supabase dashboard
-- This creates:
-- - allowed_external_ips table
-- - user_attendance_logs table
-- - Updates user_profiles table
-- - Creates views and functions
```

### 2. Configure Allowed IP Addresses

1. Navigate to `/attendance/settings` in your application
2. Add the external IP addresses of locations where you want to track attendance
3. Provide meaningful location names (e.g., "Main Workshop", "Design Lab")
4. Optionally add descriptions for each location

### 3. Test the System

1. Visit `/attendance/test` to verify your setup
2. Click "Test Attendance Tracking" to check if your current IP is recognized
3. If not recognized, add your IP to the allowed list in settings

### 4. View Results

1. Visit `/attendance` to see the attendance leaderboard
2. Export data using the "Export CSV" button for external analysis
3. View daily summaries and location usage statistics

## How It Works

### Automatic Logging

When a user logs into the system:

1. The system captures their external IP address
2. Checks if the IP is in the `allowed_external_ips` table
3. If found, creates a record in `user_attendance_logs`
4. Updates the user's profile with their latest attendance date

### Data Structure

#### `allowed_external_ips` Table
- `ip_address`: The external IP address to track
- `location_name`: Human-readable location name
- `description`: Optional description of the location

#### `user_attendance_logs` Table
- `user_id`: Reference to the user
- `external_ip`: The IP address they logged in from
- `location_name`: Name of the location
- `login_time`: Timestamp of the login
- `session_duration_minutes`: Future feature for session tracking

#### Views
- `attendance_leaderboard_30_days`: Pre-calculated leaderboard for last 30 days
- `daily_attendance_summary`: Daily summaries of attendance across all locations

### Privacy and Security

- Only external IP addresses are logged, not full browsing history
- Users can only view aggregate attendance data
- IP address management requires admin access
- All attendance data is anonymized in exports

## API Endpoints

### POST `/api/attendance`
Logs attendance for a user from their current IP
```json
{
  "user_id": "uuid"
}
```

### GET `/api/attendance?action=allowed-ips`
Returns list of allowed IP addresses

### GET `/api/attendance?action=attendance-stats`
Returns attendance leaderboard data

## Library Functions

### `trackUserAttendance(userId)`
Attempts to log attendance for a user from their current IP

### `getUserAttendanceStats(userId)`
Gets attendance statistics for a specific user

### `getRecentAttendanceActivity(limit)`
Returns recent attendance activity across all users

### `addAllowedIP(ipAddress, locationName, description)`
Admin function to add new allowed IP addresses

### `removeAllowedIP(ipAddress)`
Admin function to remove allowed IP addresses

## Customization

### Changing the Tracking Period

To modify the default 30-day tracking period, update the views:

```sql
-- Update the view to use a different period
CREATE OR REPLACE VIEW public.attendance_leaderboard_7_days AS
SELECT ...
WHERE ual.login_time >= NOW() - INTERVAL '7 days'
...
```

### Adding Session Duration Tracking

The system is set up to track session durations in the future. You can implement this by:

1. Recording session start times
2. Updating session duration on logout or timeout
3. Adding session duration statistics to the leaderboard

### Custom Location Types

You can extend the system to categorize different types of locations:

```sql
-- Add a location_type column
ALTER TABLE allowed_external_ips ADD COLUMN location_type VARCHAR(50);

-- Examples: 'workshop', 'lab', 'office', 'meeting_room'
```

## Troubleshooting

### Attendance Not Being Logged

1. Check if your external IP is in the allowed list (`/attendance/settings`)
2. Verify the IP address format is correct (IPv4: xxx.xxx.xxx.xxx)
3. Test the functionality using `/attendance/test`
4. Check browser console for any JavaScript errors

### Incorrect IP Detection

- Some networks use dynamic IP addresses that change frequently
- Corporate networks may use NAT which shows a single external IP for many users
- VPNs will show the VPN server's IP, not the actual location

### Performance Issues

If you have many users and locations:

1. Add database indexes on frequently queried columns
2. Consider archiving old attendance data (>90 days)
3. Implement caching for the leaderboard views

## Future Enhancements

- **Geolocation**: Add GPS-based attendance for mobile users
- **Time-based Rules**: Only log attendance during certain hours/days
- **Team Notifications**: Slack/Discord integration for attendance milestones
- **Analytics Dashboard**: More detailed reporting and trends
- **Multi-tenant Support**: Separate tracking for different teams/projects
- **Session Management**: Track time spent on different parts of the application

## Security Considerations

- IP addresses can be spoofed, so this system works best in trusted network environments
- Consider implementing additional authentication for admin functions
- Regular audit of allowed IP addresses to remove outdated entries
- Monitor for unusual attendance patterns that might indicate system abuse

## Support

For issues or feature requests related to the attendance tracking system, please:

1. Check the test page (`/attendance/test`) for diagnostic information
2. Review the browser console for any error messages
3. Verify your database migration completed successfully
4. Contact your system administrator for IP address management
