# Google Drive Setup (AutoCAM watcher)

## Still ahead of you for this to actually run

Creating the service account, sharing the `cad`/`cammed` folders with it, wiring
`GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` into Secret Manager (same pattern as
`CRON_NOTIFICATION_TOKEN`), and pasting both folder IDs into `/autocam` → Manage
Profiles for whichever machine this is for. Once you've got the folder IDs, wire
those in - or set up the input-sweep scheduler (Cloud Scheduler vs `pg_cron`) if
you want the input side automated too.

## Getting the Google Drive authentication key

Exact path via the Cloud Console (no `gcloud` needed):

### 1. Create the service account

- Go to [console.cloud.google.com](https://console.cloud.google.com) and make sure
  you're in the `geminiapi-469220` project (project selector top-left).
- Left sidebar → **IAM & Admin** → **Service Accounts**.
- **+ Create Service Account** at the top.
- Give it a name (e.g. `drive-watcher`) — the ID auto-fills.
- Click **Create and Continue**.
- On the "Grant access" step, you can just click **Continue** without adding any
  project-level roles — this service account only needs access to the two Drive
  folders you'll share with it directly, not anything project-wide.
- Click **Done**.

### 2. Enable the Drive API (only needs doing once per project)

- Left sidebar → **APIs & Services** → **Library**.
- Search "Google Drive API" → click it → **Enable**.

### 3. Generate the JSON key

- Back in **IAM & Admin → Service Accounts**, click the service account you just
  made.
- Go to the **Keys** tab.
- **Add Key** → **Create new key** → choose **JSON** → **Create**.
- A `.json` file downloads automatically to your machine. **This file's entire
  contents are the value of `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`** — don't edit it,
  don't extract individual fields, the whole JSON blob is what gets stored as the
  secret.

### 4. Note the service account's email

- Still on that service account's page, copy the email address at the top — looks
  like `drive-watcher@geminiapi-469220.iam.gserviceaccount.com`. You'll need this
  to actually share your `cad`/`cammed` folders with it (Drive access has to be
  granted explicitly — creating the key alone doesn't give it access to anything).

### A note on handling the key

That downloaded JSON file is a real, standing credential — anyone with it can act
as this service account against whatever it's shared with. Don't commit it to git,
don't paste its contents into chat. Once you have it, create the
`GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` secret in Secret Manager from it (same
`gcloud secrets create ... --data-file=` pattern as the cron token, or the Console
UI equivalent if you'd rather avoid the CLI).
