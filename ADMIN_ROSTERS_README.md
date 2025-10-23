# Admin Panel - Rosters System

## Overview
The admin panel now features a flexible roster management system that allows you to organize users into custom rosters without immediately granting permissions.

## Database Migration

Run the migration to create the rosters tables:

```sql
-- File: migrations/20251019_add_rosters.sql
```

This creates:
- **rosters** table - stores roster information
- **roster_members** table - junction table for roster membership
- Proper indexes and RLS policies

## Features

### 1. **Users Tab**
- Clean table view of all users
- Search and filter (All, Pending, Active)
- Quick approve pending users
- Edit individual user permissions
- Simple permission tags inline

### 2. **Rosters Tab**

#### Create Custom Rosters
- Click "Create New" button
- Give your roster a name (e.g., "Data Scouts 2025", "Video Team")
- Optionally add a description
- Rosters are saved to database without granting permissions yet

#### Manage Roster Members
- **Left Panel**: List of all your rosters with member counts
- **Middle Panel**: Current roster members in a table
- **Right Panel**: Search and add users to the roster

#### Add/Remove Members
- Search for users in the "Add Members" panel
- Click "Add" to add them to the roster (no permissions granted)
- Click "Remove" to take them off the roster
- Members are stored in database independently of permissions

#### Update Permissions
- Click "Update Permissions" button on any roster
- Select a permission from the dropdown
- Choose mode:
  - **Grant to all members**: Applies permission to everyone in roster
  - **Selective grant**: Choose specific members to receive permission
- Click "Grant Permission" to apply

#### Delete Rosters
- Click the × button next to any roster name
- Confirms before deleting
- Removes roster and memberships but doesn't affect user permissions

### 3. **Permissions Reference Tab**
- Table showing all available permissions
- Organized by category
- Clear descriptions for each permission

## Workflow Example

1. **Create a roster**: "Data Scouts Competition"
2. **Add members**: Search and add 10 users to the roster
3. **Later, grant permissions**: 
   - Click "Update Permissions"
   - Select "DATA_SCOUT_MEMBER"
   - Grant to all or selective members
4. **Add more permissions as needed**:
   - Click "Update Permissions" again
   - Select "CAN_SEE_ROUTES"
   - Grant to all members

## Technical Details

### Database Schema

**rosters table:**
- id (UUID, primary key)
- name (text)
- description (text, optional)
- created_by (UUID, references auth.users)
- created_at, updated_at (timestamps)

**roster_members table:**
- id (UUID, primary key)
- roster_id (UUID, references rosters)
- user_id (UUID, references auth.users)
- added_by (UUID, references auth.users)
- added_at (timestamp)
- Unique constraint on (roster_id, user_id)

### Permissions
- Admins and users with VIEW_ADMIN_PANEL can manage rosters
- All users can view rosters
- RLS policies enforce access control

## Design Philosophy

- **Minimal and functional** - No unnecessary visual elements
- **Clean tables** - Information-dense, scannable
- **Flexible workflow** - Create rosters first, grant permissions later
- **Batch operations** - Update multiple users at once
- **Matches site styling** - Uses existing design tokens and patterns
