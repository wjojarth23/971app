# Google Drive Setup (AutoCAM watcher)

Full checklist, start to finish, for wiring up the `cad` → auto-CAM → `cammed`
Drive integration. Steps 1–4 you can do entirely in the Cloud Console (no
`gcloud` needed, `gcloud` equivalents included). Steps 5–7 need real values
(folder IDs, the generated key) that only exist once you've done the earlier
steps - come back to those once you have them.

## Architecture (what this actually does)

- A subfolder literally named `cad` (wherever it lives in your Shared Drive) is
  the trigger — dropping a CAD file there auto-queues (and for routing jobs,
  auto-generates) a CAM job.
- A sibling `cammed` folder is where finished G-code lands — but not directly.
  Every delivery goes into a dated subfolder inside it (`2026-08-20`, Pacific
  time), created on first use each day and reused for the rest of that day.
- Output delivery starts working the moment steps 1–6 below are done, no
  scheduler required. The input trigger (`cad` → auto-queue) additionally
  needs step 7.

## 1. Create the service account

- Go to [console.cloud.google.com](https://console.cloud.google.com) and make sure
  you're in the `geminiapi-469220` project (project selector top-left).
- Left sidebar → **IAM & Admin** → **Service Accounts**.
- **+ Create Service Account** at the top.
- Give it a name (e.g. `drive-watcher`) — the ID auto-fills.
- Click **Create and Continue**.
- On the "Grant access" step, click **Continue** without adding any
  project-level roles — this service account only needs access to the two
  Drive folders you'll share with it directly, not anything project-wide.
- Click **Done**.

## 2. Enable the Drive API (once per project)

- Left sidebar → **APIs & Services** → **Library**.
- Search "Google Drive API" → click it → **Enable**.

## 3. Generate the JSON key

- Back in **IAM & Admin → Service Accounts**, click the service account you
  just made.
- Go to the **Keys** tab.
- **Add Key** → **Create new key** → choose **JSON** → **Create**.
- A `.json` file downloads automatically. **Its entire contents are the value
  of `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`** — don't edit it, don't extract
  individual fields, the whole JSON blob is the secret value.
- **Handle it carefully**: it's a real, standing credential — anyone who has it
  can act as this service account against whatever it's shared with. Don't
  commit it to git, don't paste its contents into chat.

## 4. Share the `cad` and `cammed` folders with it

- Still on the service account's page, copy its email address at the top —
  looks like `drive-watcher@geminiapi-469220.iam.gserviceaccount.com`.
- In Google Drive, right-click the `cad` folder → **Share** → paste that
  email → set its role to **Viewer** → Send.
- Right-click the `cammed` folder → **Share** → same email → set its role to
  **Editor** (it needs to create the dated subfolders and upload files) →
  Send.
- **Note both folders' IDs** while you're there — you'll need both for step 6.
  Two ways to get a folder's ID:
  - **From the address bar**: double-click to open the folder in Drive. The URL
    looks like `https://drive.google.com/drive/folders/1AbCdEfGhIjKlMnOpQrStUvWxYz`
    — everything after the last `/` is the folder ID (`1AbCdEfGhIjKlMnOpQrStUvWxYz`
    in that example). Copy just that part, not the whole URL.
  - **From the share dialog**: right-click the folder → **Share** → **Copy link**.
    The copied link has the same `.../folders/<ID>` shape — paste it somewhere
    and pull out the same trailing segment.
  - Do this once for `cad` and once for `cammed` — you'll end up with two
    different IDs, one per folder.

## 5. Create the Secret Manager secret from the downloaded key

Console path (no `gcloud`):
- **Secret Manager** → **Create Secret** → name it `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`
  → upload the downloaded `.json` file as the secret value → **Create Secret**.
- On that secret's page → **Permissions** → grant the Cloud Run runtime service
  account (`819718873862-compute@developer.gserviceaccount.com`) the **Secret
  Manager Secret Accessor** role.

`gcloud` equivalent:
```bash
gcloud secrets create GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY --data-file=/path/to/downloaded-key.json
gcloud secrets add-iam-policy-binding GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY \
  --member="serviceAccount:819718873862-compute@developer.gserviceaccount.com" \
  --role="roles/secretmanager.secretAccessor"
```

## 6. Wire the secret and folder IDs in

Two separate places:
- **`cloudbuild.yaml`**: add `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY=GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY:latest`
  to the deploy step's `--set-secrets` line (same pattern already used for
  `CRON_NOTIFICATION_TOKEN`). Not done yet as of this doc — say the word once
  the secret from step 5 actually exists, and this line gets added; adding it
  before the secret exists would make the next deploy fail.
- **`/autocam` → Manage Profiles**: edit the relevant machine, paste the `cad`
  folder's ID into "Drive Auto-Trigger Folder ID" and the `cammed` folder's ID
  into "Drive Delivery Folder ID".

## 7. Schedule the input sweep

Nothing calls `/api/drive-watcher` on a timer yet — dropping a file in `cad`
won't trigger anything until one of these exists:

- **Cloud Scheduler** (simpler now that you're on GCP): a scheduled job that
  hits `POST https://spartanshub.spartanrobotics.org/api/drive-watcher` on an
  interval, with `Authorization: Bearer <CRON_NOTIFICATION_TOKEN value>` (the
  same token from the cron-auth fix — this endpoint is gated by the same
  check).
- **Supabase `pg_cron`**: a Vault secret + wrapper function calling this
  endpoint, mirroring the existing `invoke_planner_notification_cron()`
  job that already runs every 15 minutes.

Either way, output delivery (step 4–6) doesn't need this — it fires
automatically whenever a job on a Drive-configured machine completes.
