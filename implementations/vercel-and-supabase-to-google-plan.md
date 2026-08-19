# Migrating hosting (Vercel → Google Cloud) and database (Supabase → a Google database) — implementation plan (not built)

## How to read this

These are two separate decisions bundled into one ask, with very different sizes. Hosting is a moderate, mechanical change. The database is not - it's the single riskiest piece of infrastructure this whole app depends on (153 RLS policies, 50 tables, a real Postgres-native permissions system, a working cron pipeline, storage, and a live user base). Don't let "let's migrate hosting" momentum carry into "so let's also migrate the database" without treating the second decision on its own terms - the recommendation section at the end says this more directly.

Everything below is grounded in what's actually live in this project (checked directly via Supabase MCP and repo greps this session, not assumed) plus explicit open questions that need real answers, not guesses - same discipline as every other plan in this folder.

## Part 1: Hosting — Vercel → Google Cloud

### Current footprint (confirmed, not assumed)

- `svelte.config.js` uses `@sveltejs/adapter-auto` - auto-detects Vercel at build time, no explicit adapter chosen, no `vercel.json` in the repo.
- Exactly **one** Vercel-specific route config in the whole codebase: `export const config = { maxDuration: 60 }` in `src/routes/api/cam-generate/+server.js` (STEP parsing + WASM init needs more than Vercel's default function timeout).
- `process.env.VERCEL_ENV` is read once, in `src/hooks.server.js`, purely to tag the Sentry `environment` field. Not load-bearing logic.
- No other Vercel-specific APIs found (no Vercel KV, Blob, Edge Config, Cron - the app's own cron pattern is Supabase `pg_cron` → `pg_net` → this app's API routes, entirely independent of Vercel).

This is a genuinely small footprint - the app barely uses anything Vercel-specific beyond "build and run a SvelteKit app," which is exactly the case `adapter-auto` exists for.

### Target: Cloud Run (recommended over App Engine / Firebase Hosting)

Cloud Run is the closest match to what Vercel already provides (containerized, scales to zero, per-request billing, custom domains) and is the standard SvelteKit-on-GCP target. Concretely:
1. Swap `adapter-auto` for `@sveltejs/adapter-node`, which outputs a plain Node server (`build/index.js`) - this is the SvelteKit-recommended path for any non-Vercel/Netlify host.
2. Add a `Dockerfile` (build the Node output, run it, expose the port `adapter-node` listens on - reads `PORT` from env, matches Cloud Run's convention already).
3. `maxDuration: 60` on `cam-generate` becomes moot - Cloud Run requests can run up to 60 minutes by default, so this constraint just disappears rather than needing translation. (Worth leaving the code as-is regardless - it's a harmless no-op on Cloud Run, not something that needs stripping out.)
4. Env vars: Vercel's dashboard env vars → **Secret Manager** for actual secrets (`SUPABASE_SERVICE_KEY`, `SLACK_BOT_TOKEN`, `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`, etc.) injected as env vars at deploy time, plain Cloud Run env vars for non-secret config (`PUBLIC_SUPABASE_URL` etc.).
5. CI/CD: Vercel's git-push-to-deploy → **Cloud Build** triggers on push to `main` (build the Docker image, deploy to Cloud Run) - this is the actual "Cloud Build" half of what was mentioned earlier, and it's genuinely the right tool for this specific job (unlike using Cloud Run for the Drive watcher's cron trigger, which was overkill - see the Drive watcher docs).
6. Custom domain: Cloud Run supports domain mapping directly, or fronting with a Google Cloud Load Balancer if you also want a CDN/WAF layer - not required to get started.
7. Preview deployments: Vercel auto-deploys a preview URL per PR; Cloud Run doesn't do this out of the box - either accept losing PR previews, or build a small Cloud Build trigger variant that deploys PR branches to a separate Cloud Run revision/service. Worth deciding whether this workflow is actually used today before building a replacement for it.

### Open questions

1. Is there a concrete driver (cost, org policy requiring GCP, wanting one vendor alongside the Drive integration), or is this exploratory? Changes how much it's worth investing in preview-deploy parity, custom CI polish, etc.
2. Who owns billing/IAM for a Google Cloud project here - same team/account structure as whatever manages the Google Workspace the Drive service account would live under?

## Part 2: Database — Supabase → "a Google database"

### Current footprint (confirmed live via Supabase MCP this session)

- **50 tables** in `public`, several with real relational structure (foreign keys across `parts` ↔ `builds` ↔ `purchasing` ↔ `router_groups` ↔ `cam_jobs`, etc.) - this is a genuinely relational schema, not a loose bag of documents.
- **153 Row Level Security policies** across those tables - the actual authorization layer for almost every table in the app runs *inside Postgres*, not just in application code.
- **9 `SECURITY DEFINER` functions** implementing a real custom permission system on top of RLS: `approved_user()`, `has_permission()`, `has_any_permission()`, `handle_new_user()` (an auth trigger), `log_activity()` (the activity-log trigger wired up earlier this session), plus the cron/lease helpers (`claim_runtime_lease`, `release_runtime_lease`, `invoke_planner_notification_cron`).
- **Data volume is modest** - largest table is `scout_data_events` at ~8,170 rows, `build_bom` at ~3,398, most tables in the tens-to-low-thousands. A full export/import is realistic in a single maintenance window; this is not a "months of dual-writing" scale problem.
- **Auth**: Supabase Auth (GoTrue) - email/password, `signInWithPassword`/`signUp`/`signOut`/`resetPasswordForEmail`/`updateUser`/`onAuthStateChange`/session refresh, used across the app (24 separate `getSession()` call sites). 116 rows in `user_profiles`. `@supabase/ssr` is a declared dependency but **not actually wired into `hooks.server.js`** - auth today is client-side session handling only, no server-rendered auth state. That simplifies the auth migration slightly (no SSR cookie-session machinery to replace) but is itself worth knowing, since it means server routes trust whatever Authorization header a request carries (see `cam-generate`'s own doc comment on this) rather than a validated server-side session.
- **Storage**: 4 real buckets in active use - `manufacturing-files`, `part-previews`, `task-description-images`, `pit-scout-photos` - including signed-URL downloads (`createSignedUrl`), not just public reads.
- **Realtime**: used in exactly **one** place, `src/routes/admin/ActivityLogTab.svelte` (a live feed of the activity log). Small, contained footprint - not a pervasive pattern despite `grep`-ing wide at first.
- **Postgres extensions actually installed** (not just available): `pg_cron` (1 active job today - the planner Slack-reminder sweep, `*/15 * * * *`), `pg_net` (async HTTP from inside Postgres - what lets `pg_cron` call this app's API), `supabase_vault` (stores the secrets that cron job reads), `pgcrypto`, `uuid-ossp`.
- **This session's own new work depends on all of this**: the Drive watcher's still-unscheduled cron trigger was designed around exactly this `pg_cron`/`pg_net`/Vault pattern; `deliverJobToDrive` and the input sweep both use Supabase Storage and Supabase's service-role RLS bypass.

### The one fact that determines everything else: which Google database product?

This wasn't specified, and the honest answer is that it changes the size of this project by an order of magnitude depending on which way it goes.

**Option A - Cloud SQL for PostgreSQL (or AlloyDB, Google's higher-performance Postgres-compatible option).** Same engine as Supabase (Postgres) - the actual schema, all 50 tables, every foreign key, every `SECURITY DEFINER` function, and (this matters a lot) **all 153 RLS policies as SQL are directly portable** - RLS is a Postgres feature, not a Supabase one. What does *not* come for free:
- Supabase's RLS policies lean on `auth.uid()`/`auth.role()`, which are populated by Supabase's own PostgREST layer from a validated JWT on every request. Cloud SQL has no PostgREST equivalent and no built-in request-to-JWT-to-session-variable bridge - this has to be rebuilt, either by standing up PostgREST yourself against Cloud SQL (it's open source, deployable anywhere, but now it's infrastructure you run and patch instead of a managed product), or by moving all 153 policies' logic into application-layer checks in the SvelteKit API routes and dropping RLS as the enforcement point entirely (a real, large rewrite of every route that currently relies on RLS as its actual security boundary, not just a config change).
- `pg_cron`/`pg_net`/Vault are Supabase-packaged conveniences, not free-standing extensions available on stock Cloud SQL by default - equivalent behavior needs **Cloud Scheduler** (external cron) + **Secret Manager** (replaces Vault) + either Cloud Functions or hitting this app's own API routes directly (same shape the Drive watcher endpoint already is - a bearer-token-gated HTTP endpoint any external scheduler can call).
- No built-in Realtime - Cloud SQL has no logical-replication-to-websocket product like Supabase Realtime. The one real usage (`ActivityLogTab.svelte`) would need either polling (simplest, probably fine for one admin panel) or a real pub/sub layer (Cloud Pub/Sub + a WebSocket relay - meaningfully more infrastructure for one feature).
- Storage: Cloud Storage buckets replace Supabase Storage; signed URLs are a supported, analogous concept (different SDK call shape, same idea) - this part translates cleanly.
- Auth: **Firebase Authentication** or Google Identity Platform replaces Supabase Auth. Passwords cannot be migrated across auth providers (password hashes aren't portable/exportable in a usable form) - every one of the ~116 users would need a forced password reset, not a silent migration. Session/JWT shape also changes, which cascades into however RLS ends up bridged (previous bullet).

**Option B - Firestore (or the wider Firebase suite).** Not Postgres - a document/NoSQL model. This is not a migration, it's **a rewrite**: every table with foreign keys (which is most of them - `parts`↔`builds`↔`purchasing`↔`cam_jobs`↔`router_groups` etc.) needs to be re-modeled around denormalization/subcollections, every RLS policy needs to become a Firestore Security Rule (a genuinely different rules language, not a port), every SQL join used throughout the app's query code needs restructuring, and `pg_cron`/`pg_net`/RLS-as-SQL have no conceptual equivalent at all. Given how relational this schema actually is (confirmed above, not assumed), this option is realistically a rewrite of the whole data layer, not a migration of it.

**Recommendation if this proceeds at all: Option A (Cloud SQL/AlloyDB), not Firestore** - it's the only path that doesn't turn this into a rewrite of the entire app's data layer. But see the sequencing note below before committing to doing this at all.

### Migration mechanics (assuming Option A)

1. `pg_dump` the Supabase Postgres instance, restore into Cloud SQL/AlloyDB - standard Postgres-to-Postgres migration, made easier by the modest data volumes confirmed above.
2. Stand up PostgREST (or an equivalent thin REST/RPC layer) against Cloud SQL if keeping the "RLS as the real security boundary" model - this is now infrastructure you operate, not a managed product, which is a real ongoing-maintenance cost worth being honest about up front.
3. Firebase Auth (or Identity Platform) project setup, forced password-reset flow for existing users, `$lib/supabase.js`-equivalent client rewritten against the new auth SDK - touches all 44 files that currently import the Supabase client, though most of that is mechanical (same method shapes for basic CRUD, different for anything auth- or realtime-specific).
4. Cloud Storage buckets created (`manufacturing-files`, `part-previews`, `task-description-images`, `pit-scout-photos`), upload/download/signed-URL call sites updated.
5. `pg_cron` job → Cloud Scheduler hitting `/api/planner/notifications` directly (this app's endpoint already does its own auth via `cron_auth.js` - Cloud Scheduler can call it exactly like `pg_net` does today, just from outside Postgres instead of inside it). Same approach the Drive watcher's still-pending cron trigger could use instead of `pg_cron`, incidentally solving two problems with one pattern.
6. `ActivityLogTab.svelte`'s Realtime feed → polling (start here, it's one panel) or a Pub/Sub-backed replacement if live-push turns out to actually matter in practice.
7. Full regression pass against all 153 ported policies/equivalent app-layer checks - this is the highest-risk step, since a missed or subtly-wrong authorization check is a real data-exposure bug, not a cosmetic one.

### Open questions (the ones that actually gate starting)

1. **Which Google database product** - see above, this alone changes the scope by an order of magnitude. Don't start building until this is picked.
2. **Keep RLS-as-enforcement (via self-hosted PostgREST) or move to app-layer authorization?** This is its own real architectural decision independent of the hosting/DB question - it changes how much of the SvelteKit route code needs rewriting versus how much new infrastructure needs operating.
3. Is there a concrete reason for this migration (cost, compliance, org policy, wanting everything on one vendor), or is it exploratory? Given the honest complexity above, this materially affects whether it's worth doing at all right now versus later.
4. Who's on the hook for operating whatever replaces Supabase's managed pieces (Vault, cron, PostgREST if self-hosted, Realtime if replaced) - this becomes real ongoing infrastructure work this project doesn't currently have to think about.

## Recommended sequencing

**Do the hosting move first, independently, if it's happening at all** - it's small, mechanical, doesn't touch data, and is fully reversible (swap the adapter back, redeploy to Vercel). It also doesn't block or get blocked by the database question.

**Treat the database migration as its own, separately-scoped decision** - don't let "we moved hosting to Google" create momentum toward "so let's also move the database." The honest tradeoff: Supabase today bundles Postgres + RLS-integrated auth + storage + Realtime + cron into one managed product with a working, tested, 153-policy authorization layer already built and correct. Migrating to "a Google database" doesn't replace that bundle with an equivalent one - it replaces it with several separate GCP services (Cloud SQL, Firebase Auth, Cloud Storage, Cloud Scheduler, Secret Manager, and either self-hosted PostgREST or a rewritten authorization layer) that this project would now own the integration and operation of. That can absolutely be the right call if there's a real driver (cost at scale, org policy, vendor consolidation) - but it's worth confirming that driver exists before spending the effort, rather than migrating because the hosting move made it feel like the natural next step.
