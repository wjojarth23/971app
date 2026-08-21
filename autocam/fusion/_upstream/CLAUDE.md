# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Development Commands

```bash
npm run dev      # Start development server (localhost:3000)
npm run build    # Production build
npm run start    # Start production server
npm run lint     # Run ESLint
```

**Database migrations (Drizzle Kit):**
```bash
npx drizzle-kit generate    # Generate migrations from schema changes
npx drizzle-kit migrate     # Apply migrations (uses ADMIN_DB_URL)
npx drizzle-kit push        # Push schema directly (dev only)
```

## Architecture Overview

AutoCAM is a multi-tenant CAM (Computer-Aided Manufacturing) SaaS platform built with:
- **Next.js 16** with App Router and React 19
- **Drizzle ORM** with PostgreSQL
- **Better Auth** for authentication (email/password + verification)
- **React Compiler** enabled in next.config.ts

### Directory Structure

```
app/                    # Next.js App Router pages and API routes
├── api/               # API routes (delegate to lib/api/ implementations)
├── dashboard/         # Protected dashboard with parallel routes (@tabs)
│   └── @tabs/        # Parallel route slot for tab navigation
│       └── settings/@tabs/  # Nested parallel routes for settings
├── login/, signup/    # Auth pages
└── pc/[id]/[teamid]/  # Part Categories workflow

lib/                    # Core business logic
├── db/                # Drizzle setup
│   ├── index.ts      # Drizzle instance export
│   └── schema/       # Schema files (auth.ts, entities.ts, cam.ts)
├── api/              # API implementations (called by app/api/ routes)
├── auth/             # Better Auth server/client configuration
├── scopes.ts         # API key scope definitions
├── aws.ts            # S3 client
└── mailer.ts         # Nodemailer config

components/            # Reusable React components
proxy.ts               # Auth middleware (redirects)
```

### Database Schemas

Three main schema files in `lib/db/schema/`:
- **auth.ts** - Better Auth tables (user, session, account, verification)
- **entities.ts** - Team infrastructure (Teams, TeamMembers, TeamInvites, TeamKeys, TeamRunners)
- **cam.ts** - Core CAM models (Parts, Plates, Materials, Machines, Tools, Jobs, BoxTubes, PartCategories)

All data is scoped to `team_id` for multi-tenancy.

### API Pattern

Routes in `app/api/` delegate to implementations in `lib/api/`:

```typescript
// app/api/materials/route.ts delegates to lib/api/materials.ts
import { GET, POST, PUT, DELETE } from "@/lib/api/materials";
export { GET, POST, PUT, DELETE };
```

Key utilities in `lib/api/common.ts`:
- `routeFactory()` - Creates standardized endpoint handlers with auth
- `validateAuthType()` - Validates user session or API key
- `checkUserTeam()` - Verifies team membership and admin status
- `parseSchema()` - Zod validation wrapper

### Authentication

**Dual auth support:**
1. User sessions via Better Auth cookies
2. API keys via `Authorization: Bearer <token>` header

API keys have scoped permissions defined in `lib/scopes.ts`:
```typescript
{ materials: { read, write }, jobs: { read, create, process, delete }, ... }
```

Protected routes middleware in `proxy.ts` redirects unauthenticated users.

### Job Queue System

Jobs table tracks async work with states:
- `pending` → `claimed_by` (runner digest) → `response` (completed)
- Job kinds: "plate:arrange", "plate:cam", "box_tube"
- Runners claim jobs via digest hash to prevent duplicates

### Parallel Routes

Dashboard uses Next.js parallel routes (`@tabs`) for independent tab rendering:
- `/dashboard/@tabs/jobs`, `/dashboard/@tabs/queue`, etc.
- Nested: `/dashboard/@tabs/settings/@settingstabs/personal`

### Styling

- CSS Modules for component-scoped styles (`.module.css`)
- Framer Motion for animations
- Bootstrap 5.3.3 via CDN

## Key Files to Know

- `lib/api/common.ts` - API utilities, auth helpers, OpenAPI registration
- `lib/db/index.ts` - Drizzle instance with all schemas
- `lib/auth/server.ts` - Better Auth configuration
- `lib/scopes.ts` - API key permission definitions
- `proxy.ts` - Auth middleware
- `app/types.ts` - Shared TypeScript types

## Environment Variables

Required:
- `DATABASE_URL` - PostgreSQL connection string
- `ADMIN_DB_URL` - Admin DB URL for migrations
- `BASE_URL` - Application base URL
- `SMTP_SENDER` - Email sender address
- AWS/S3 credentials for file uploads (`AUTOCAM_BUCKET`)
