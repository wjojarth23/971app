# 971 Hub - Manufacturing Management System

A comprehensive manufacturing management system built with SvelteKit, featuring OnShape CAD integration and AI-powered BOM analysis.

## Features

- **OnShape Integration**: Connect CAD documents and analyze assemblies
- **Manufacturing Process Assignment**: Automatically assigns appropriate manufacturing processes (mill, laser-cut, 3D-print, etc.)
- **Stock Management**: Track and assign stock materials to parts
- **Build Management**: Create and manage manufacturing builds
- **User Authentication**: Secure user management with Supabase
- **Attendance Tracking**: Define on-site schedules and trusted locations, automatically log attendance, and review leaderboards

## Setup

### Prerequisites

- Node.js 18+
- Supabase account
- OnShape developer account

### Installation

1. Clone the repository
2. Install dependencies:
   ```bash
   npm install
   ```

3. Set up environment variables:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   ```env
   # OnShape API Configuration
   PUBLIC_ONSHAPE_ACCESS_KEY=your_onshape_access_key
   PUBLIC_ONSHAPE_SECRET_KEY=your_onshape_secret_key
   PUBLIC_ONSHAPE_BASE_URL=https://cad.onshape.com
    
   # Supabase Configuration
   PUBLIC_SUPABASE_URL=your_supabase_url
   PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key

   # The Blue Alliance (server-side only; required for live match/odds)
   TBA_API_KEY=your_tba_api_key

   # Betting Demo Mode (server-side only)
   # When true, include finished matches in "upcoming" so you can test past events.
   # Accepted truthy values: "true", "1", "yes", "y"

   ```

4. Set up the database (run in Supabase SQL Editor, in this order):
   - `20251125_attendance_overhaul.sql`
   - `migration_add_build_system.sql`
   - `migration_add_other_category.sql`
   - `migration_add_drawing_support.sql`
   - `supabase_betting.sql` (adds betting tables: user_balances, betting_markets, betting_bets)
   See BUILD_SYSTEM_SETUP.md for details. Do not run `migration_fix_builds.sql` (deprecated).

## Developing

Start the development server:

```bash
npm run dev

# or start the server and open the app in a new browser tab
npm run dev -- --open
```


## Building

To create a production version:

```bash
npm run build
```

Preview the production build:

```bash
npm run preview
```

## Project Structure

- `/src/lib/` - Shared libraries and utilities
  - `onshape.js` - OnShape API integration
  - `chatgpt.js` - ChatGPT service for BOM classification
  - `supabase.js` - Database connection
- `/src/routes/` - SvelteKit routes
  - `/api/chatgpt/` - Server-side ChatGPT API endpoint
  - `/cad/` - CAD management pages
- `/static/` - Static assets

## Attendance Tracking

- Grant the `MANAGE_ATTENDANCE` permission to trusted admins. They will see a new Attendance tab under `/admin` with:
   - **Trusted Locations** – capture the current network prefix (first 3 octets of IPv4, e.g., `205.167.46`) to define on-site Wi-Fi/LANs.
   - **Schedules** – build recurring day/time windows and assign one or more locations.
   - **Leaderboard** – review a 30-day rolling leaderboard with search/filter.
- Whenever a signed-in user loads the app, the client pings `/api/attendance`. If they have not checked in today and are inside an active schedule window on a trusted network, attendance is logged automatically and they receive a toast confirmation.
- Users can review their personal attendance stats and recent check-ins on the Profile page.

### How Network Matching Works

The system uses **network prefix matching** for privacy and flexibility:
1. Client IP is normalized to first 3 octets (IPv4) or first 4 hextets (IPv6)
2. Example: `205.167.46.123` → `205.167.46`
3. Stored locations use the same prefix format (not CIDR notation)
4. Matching is a simple string equality check

This means all devices on the same /24 network will match automatically, and we never store complete IP addresses.

## Documentation

- [Supabase Setup](./SUPABASE_SETUP.md) - Database configuration

## Deployment

The app can be deployed to any SvelteKit-compatible platform. Make sure to configure environment variables in your deployment environment.

> You may need to install an [adapter](https://svelte.dev/docs/kit/adapters) for your target environment.

When deploying on Vercel, the included [vercel.json](/c:/Users/wjoja/Downloads/Code/971app/vercel.json) schedules planner Slack notifications every 15 minutes. Set `CRON_SECRET` in the deployment environment to protect those cron endpoints with Vercel's `Authorization: Bearer ...` header.

## Configuration: Disabling automatic vendor detection

The app supports an environment variable to disable automatic vendor detection for BOM parsing. By default detection is enabled.

- Client-side (Vite/SvelteKit): set `VITE_AUTO_VENDOR` or `PUBLIC_AUTO_VENDOR`.
- Server-side: set `AUTO_VENDOR`.

Accepted falsy values to disable detection: `false`, `0`, `no` (case-insensitive). Any other value (or omitted) leaves detection enabled.

Example (.env):

```env
PUBLIC_AUTO_VENDOR=false
```

