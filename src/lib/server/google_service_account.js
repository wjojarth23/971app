// Generic Google service-account JWT-Bearer OAuth2 token exchange (RFC
// 7523) - not tied to any one Google API. Originally lived inline in
// autocam/drive_watcher.js (Drive-only, hardcoded scope); extracted here
// so the Google Sheets sync (src/lib/server/google_sheets_sync.js) can
// mint its own differently-scoped token from the SAME service account
// credentials (GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY) without either duplicating
// this signing logic or creating an awkward scouting-imports-from-autocam
// dependency - the JWT-signing itself has nothing AutoCAM-specific about
// it. A service account's access is scoped per-token-request (the `scope`
// claim below), not baked into the key itself, so the same client_email/
// private_key pair can mint a Drive-scoped token here and a
// spreadsheets-scoped token there, as long as whatever it's granted access
// to (a Drive folder, a Sheet) was actually shared with that email.
//
// Hand-rolled with Node's built-in crypto (RS256) + plain fetch() - no
// googleapis npm dependency, same zero-dependency approach used elsewhere
// in this app (see drive_watcher.js's own header comment).
import crypto from 'node:crypto';

const TOKEN_URL = 'https://oauth2.googleapis.com/token';

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function getServiceAccountAccessToken(serviceAccountJson, scope) {
  let key;
  try {
    key = JSON.parse(serviceAccountJson);
  } catch {
    throw new Error('Service account JSON is not valid JSON');
  }
  if (!key.client_email || !key.private_key) {
    throw new Error('Service account JSON is missing client_email/private_key');
  }
  if (!scope) {
    throw new Error('getServiceAccountAccessToken requires an explicit scope');
  }

  const now = Math.floor(Date.now() / 1000);
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = base64url(JSON.stringify({
    iss: key.client_email,
    scope,
    aud: TOKEN_URL,
    iat: now,
    exp: now + 3600
  }));
  const signature = base64url(crypto.sign('RSA-SHA256', Buffer.from(`${header}.${claims}`), key.private_key));
  const assertion = `${header}.${claims}.${signature}`;

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok || !body.access_token) {
    throw new Error(`Google OAuth2 token exchange failed: ${body.error_description || body.error || res.status}`);
  }
  return body.access_token;
}
