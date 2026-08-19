# Deploying to Google Cloud Run

This app moved from Vercel to Cloud Run. This doc covers the actual GCP setup and the
day-to-day workflow, split so a GitHub-only maintainer never needs GCP access for
normal updates.

**Target**: project `geminiapi-469220`, region `us-west1`, Cloud Run service and
Artifact Registry repo both named `spartanshub`, domain `spartanshub.spartanrobotics.org`.

## Why the Dockerfile needs so many `--build-arg`s

SvelteKit inlines every `PUBLIC_*` var referenced via `$env/static/public` into the
client-side JS bundle **at build time** — this isn't a Vercel-specific mechanism, it's
just something Vercel's own build step used to handle transparently by reading its
dashboard env vars. Cloud Build has to pass the same values explicitly, or the build
fails immediately with `"X" is not exported by "virtual:env/static/public"` (fail
loudly, not a silent bad deploy). The full set, discovered by grepping `src/` for every
`PUBLIC_*` reference:

```
PUBLIC_SUPABASE_URL
PUBLIC_SUPABASE_ANON_KEY
PUBLIC_SENTRY_DSN
PUBLIC_ONSHAPE_ACCESS_KEY
PUBLIC_ONSHAPE_SECRET_KEY
PUBLIC_ONSHAPE_BASE_URL
PUBLIC_AUTOCAM_API_URL
PUBLIC_APP_ORIGIN
PUBLIC_SITE_URL
PUBLIC_ROUTES
PUBLIC_TBA_API_KEY
PUBLIC_AUTO_VENDOR
```

**Implication worth knowing**: because these are baked into the built bundle, a
different value per environment (e.g. a staging Supabase project) needs a separate
image build, not just a different Cloud Run deploy-time env var. There's only one
environment today (prod), so this doesn't bite yet — flag it if a staging environment
gets added later.

Non-`PUBLIC_*` (private) vars are normal runtime env vars / secrets and don't have
this constraint — see **Secrets** below.

## One-time GCP setup (admin only)

Run these yourself once `gcloud` is authenticated (`gcloud auth login`,
`gcloud config set project geminiapi-469220`):

### 1. Enable required APIs

```bash
gcloud services enable run.googleapis.com \
  cloudbuild.googleapis.com \
  artifactregistry.googleapis.com \
  secretmanager.googleapis.com
```

### 2. Create the Artifact Registry repo

```bash
gcloud artifacts repositories create spartanshub \
  --repository-format=docker \
  --location=us-west1 \
  --description="SpartansHub app images"
```

### 3. Create secrets (values piped in locally — never pasted into chat)

```bash
gcloud secrets create SUPABASE_SERVICE_KEY --data-file=-   # paste value, then Ctrl-D
gcloud secrets create SLACK_BOT_TOKEN --data-file=-
gcloud secrets create SLACK_SIGNING_SECRET --data-file=-
gcloud secrets create GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY --data-file=/path/to/key.json
gcloud secrets create TBA_API_KEY --data-file=-
gcloud secrets create CRON_NOTIFICATION_TOKEN --data-file=-
```

Grant the Cloud Run runtime service account access to just these secrets (replace
`RUNTIME_SA` with the service account Cloud Run actually runs as — by default the
Compute Engine default service account unless you create a dedicated one, which is
the better long-term choice):

```bash
for SECRET in SUPABASE_SERVICE_KEY SLACK_BOT_TOKEN SLACK_SIGNING_SECRET \
              GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY TBA_API_KEY CRON_NOTIFICATION_TOKEN; do
  gcloud secrets add-iam-policy-binding "$SECRET" \
    --member="serviceAccount:RUNTIME_SA" \
    --role="roles/secretmanager.secretAccessor"
done
```

Since `SUPABASE_SERVICE_KEY` currently lives in Vercel's dashboard, rotate it in
Supabase once it's confirmed working from Secret Manager — the old value stays valid
until you do, so this is a deliberate cutover step, not automatic.

### 4. First manual deploy (proves the container actually runs before automating it)

```bash
gcloud builds submit \
  --substitutions=_PUBLIC_SUPABASE_URL="...",_PUBLIC_SUPABASE_ANON_KEY="...",... \
  --config=cloudbuild.yaml
```

Then confirm the service responds:

```bash
gcloud run services describe spartanshub --region=us-west1 --format="value(status.url)"
curl -I <that URL>
```

Wire in the private env vars / secrets on the service:

```bash
gcloud run services update spartanshub \
  --region=us-west1 \
  --set-secrets=SUPABASE_SERVICE_KEY=SUPABASE_SERVICE_KEY:latest,SLACK_BOT_TOKEN=SLACK_BOT_TOKEN:latest,... \
  --set-env-vars=PUBLIC_SUPABASE_URL=...,PUBLIC_SITE_URL=https://spartanshub.spartanrobotics.org,...
```

### 5. Custom domain

DNS for `spartanrobotics.org` is already controlled and wired up (confirmed with
project owner). Map the domain:

```bash
gcloud run domain-mappings create \
  --service=spartanshub \
  --domain=spartanshub.spartanrobotics.org \
  --region=us-west1
```

This prints the DNS records (a CNAME or A/AAAA set) to add — add them, then wait for
the managed TLS cert to provision (can take up to ~24h on a fresh mapping).

### 6. Connect Cloud Build to GitHub (this is what makes merges auto-deploy)

Via Cloud Console: **Cloud Build → Triggers → Connect Repository**, authorize the
Cloud Build GitHub App for this repo, then create a trigger:

```bash
gcloud builds triggers create github \
  --repo-name=spartanshub \
  --repo-owner=<github-org-or-user> \
  --branch-pattern="^main$" \
  --build-config=cloudbuild.yaml \
  --substitutions=_PUBLIC_SUPABASE_URL="...",_PUBLIC_SUPABASE_ANON_KEY="...",...
```

(Non-secret `PUBLIC_*` substitutions can live directly on the trigger config in Cloud
Console/`gcloud`; they're not sensitive by definition — they end up in the public
client bundle either way.)

**Recommended**: turn on GitHub branch protection on `main` requiring the Cloud Build
check to pass before merge is allowed, so a broken build never reaches `main`.

## Ongoing workflow (the GitHub-only maintainer)

1. Open a PR, get it reviewed.
2. Merge to `main`.
3. Cloud Build trigger fires automatically → builds → pushes to Artifact Registry →
   deploys the new revision to Cloud Run.
4. Check build/deploy status and logs at **Cloud Console → Cloud Build → History**
   (no `gcloud` needed) — click the failed build to see exactly which step and line
   failed, same as a failed CI check on any other platform.

That's the entire deploy action. No `gcloud`, no Cloud Run console access, no IAM
needed for this workflow.

## Local development / testing the container

```bash
npm run build   # requires all PUBLIC_* vars above set in your shell or .env
npm run start    # or: node build/index.js

# or, to test the actual container:
docker build \
  --build-arg PUBLIC_SUPABASE_URL=... \
  --build-arg PUBLIC_SUPABASE_ANON_KEY=... \
  # ...(all 12 PUBLIC_* args)
  -t spartanshub .
docker run -p 8080:8080 -e PUBLIC_SUPABASE_URL=... -e PUBLIC_SUPABASE_ANON_KEY=... spartanshub
```

`maxDuration: 60` in `src/routes/api/cam-generate/+server.js` is a Vercel-specific
route config left in place intentionally — it's a harmless no-op on Cloud Run, whose
default request timeout is much longer.

## What's intentionally out of scope here

- **The `autocam/` FastAPI service** is not part of this migration. It's currently
  disabled (`DISABLE_AUTOCAM = true` in `src/lib/config/autocam.js`) and superseded —
  turning/routing G-code generation now happens synchronously in this app itself
  (`src/lib/cam/turning.js`, `routing.js`, `stepProfile.js`). Its Dockerfile also has
  an unresolved dependency on a `PenguinCAM/` directory that doesn't exist anywhere in
  this repo. Revisit as a separate task if it's ever re-enabled.
- **Replacing Supabase** — see `docs/deployment/supabase-alternative-design.md` for
  that as a fully separate, not-yet-executed design.
