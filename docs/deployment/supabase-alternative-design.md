# Design option: replacing Supabase with Cloud SQL + self-hosted PostgREST

**Status: design only, not executed.** No database, auth, or storage changes have
been made. This is a separate, much larger decision than the Cloud Run hosting move
(see `docs/deployment/google-cloud-run.md`) and should only be started once there's a
concrete driver (cost at scale, org policy, vendor consolidation) — see the prior
analysis this builds on: `implementations/vercel-and-supabase-to-google-plan.md`.

## Current footprint (confirmed live via Supabase MCP, see the prior analysis doc)

- 50 tables in `public`, genuinely relational (FKs across `parts` ↔ `builds` ↔
  `purchasing` ↔ `router_groups` ↔ `cam_jobs`, etc.)
- **153 Row Level Security policies** — the real authorization layer for almost every
  table runs inside Postgres, not just in application code
- 9 `SECURITY DEFINER` functions implementing a custom permission system on top of RLS
- Modest data volume (largest table ~8,170 rows) — a full export/import is realistic
  in a single maintenance window
- Supabase Auth (GoTrue): client-side only, no SSR session handling
  (`@supabase/ssr` is a declared dependency but unused); 116 users
- Storage: 4 buckets in active use, including signed-URL downloads
- Realtime: exactly one usage (`src/routes/admin/ActivityLogTab.svelte`)
- `pg_cron` (1 active job, `*/15 * * * *`), `pg_net`, `supabase_vault`, `pgcrypto`,
  `uuid-ossp`

## Target architecture

| Supabase piece | Google Cloud replacement |
|---|---|
| Postgres | Cloud SQL for PostgreSQL (or AlloyDB) |
| PostgREST (implicit, via Supabase's API layer) | Self-hosted PostgREST, e.g. as its own Cloud Run service |
| Auth (GoTrue) | Firebase Authentication / Identity Platform |
| Storage | Cloud Storage buckets |
| Realtime | Polling first; Cloud Pub/Sub + a relay only if live-push is actually needed |
| `pg_cron` | Cloud Scheduler hitting `/api/planner/notifications` directly over HTTP |
| `pg_net` | Not needed — Cloud Scheduler calls the app's HTTP endpoint directly, same shape `pg_net` already used |
| `supabase_vault` | Secret Manager |

### Why Cloud SQL/AlloyDB, not Firestore

RLS is a Postgres feature, not Supabase-proprietary — all 153 policies port as plain
SQL. Firestore would mean re-modeling every foreign-key relationship (most of the
schema) into a document shape and rewriting every RLS policy as a Firestore Security
Rule in a different rules language — a rewrite of the data layer, not a migration.

### Why self-hosted PostgREST, not app-layer authorization

Preserves the existing Postgres-native security boundary: `auth.uid()`/`auth.role()`
inside the 153 policies keep resolving from a validated JWT the same way, so those
policies mostly port unchanged. The cost is operating PostgREST yourself — it's open
source and deployable anywhere (e.g. as a small Cloud Run service in front of Cloud
SQL), but it's now infrastructure this project owns and patches, not a managed
product. (The alternative — moving all 153 policies' logic into SvelteKit API route
checks and dropping RLS as the enforcement point — is a much larger rewrite of every
route that currently trusts RLS as its real security boundary.)

## IAM design

This needs its own real discussion, not an afterthought — RLS was the actual security
boundary before, so whatever replaces the infrastructure around it needs equivalent
rigor:

- **Separate service accounts per component**, least privilege each:
  - Cloud Run app (runtime): talks to PostgREST over the network, no direct Cloud SQL
    credentials, no broad Secret Manager access.
  - PostgREST service: a dedicated Cloud SQL client role, scoped to exactly the
    databases/schemas it serves — not a superuser/admin connection.
  - Cloud Build (deploy-time): can push images and deploy Cloud Run revisions; no
    runtime data access at all.
  - Cloud Scheduler → app endpoint: only `roles/run.invoker` on the specific
    notification endpoint's Cloud Run service, nothing broader.
- **Cloud SQL**: a dedicated DB user for PostgREST's runtime connection, distinct from
  whatever user runs schema migrations — migrations use a separate, more-privileged
  connection that's never used at request time.
- **Firebase Auth admin operations** (user management, forced password resets)
  restricted to a small admin group — never granted to the app's runtime service
  account.
- **Secret Manager**: access scoped per-secret per-service-account (mirrors the
  Cloud Run hosting doc's secrets section), not one broad "app secrets" grant that
  every component can read.
- **The GitHub-only maintainer workflow still applies if this is ever built**: none of
  this IAM surface should require the student maintainer's involvement for routine
  app updates — merging a PR should remain the entire deploy action, same as the
  hosting-only migration.

## Migration mechanics (if this proceeds)

1. `pg_dump` the Supabase Postgres instance, restore into Cloud SQL/AlloyDB.
2. Stand up PostgREST against Cloud SQL with the dedicated runtime DB user above.
3. Firebase Auth / Identity Platform project setup; forced password-reset flow for all
   ~116 existing users (passwords are not portable between auth providers — this is
   not a silent migration); rewrite `src/lib/supabase.js` and its 44 call sites against
   the new auth SDK (mechanically similar for basic CRUD, different for
   auth/realtime-specific calls).
4. Cloud Storage buckets created (`manufacturing-files`, `part-previews`,
   `task-description-images`, `pit-scout-photos`); signed-URL call sites updated to
   the Cloud Storage SDK equivalent.
5. Cloud Scheduler job replacing `pg_cron`, hitting `/api/planner/notifications`
   directly — that route's existing `cron_auth.js` bearer-token check needs no change.
6. `ActivityLogTab.svelte`'s Realtime feed → polling to start.
7. **Full regression pass against all 153 ported policies** — the highest-risk step; a
   missed or subtly-wrong authorization check here is a real data-exposure bug, not a
   cosmetic one.

## Open questions that gate starting this at all

1. Is there a concrete driver (cost, compliance, org policy, vendor consolidation), or
   is this exploratory? Given the complexity above, this determines whether it's worth
   doing at all right now versus later.
2. Who operates PostgREST and the rest of this newly-self-hosted infrastructure
   on an ongoing basis — this becomes real operational work the project doesn't
   currently have.
3. Timeline/downtime tolerance for the `pg_dump`/restore and forced password reset —
   both are real, user-visible events, not zero-downtime by default.
