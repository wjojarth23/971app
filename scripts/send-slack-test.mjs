#!/usr/bin/env node
// One-command Slack DM test tool. Calls the already-deployed
// POST /api/971bot/internal/test-dm endpoint on the live production app,
// so it uses whatever SLACK_BOT_TOKEN is actually configured there right
// now - no local build/deploy needed, and the raw token never has to be
// fetched or handled here.
//
// Usage:
//   node --env-file=.env scripts/send-slack-test.mjs <email> "<message text>"
//
// Requires in .env: PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY,
// DEV_TOOLS_EMAIL, DEV_TOOLS_PASSWORD (a persistent admin test account -
// see the comment above those two vars in .env for what it's for).
//
// Speed: a full password sign-in runs bcrypt server-side and costs a
// second network round trip on top of the actual send - both avoidable
// on repeat calls. The resulting access/refresh token is cached in
// ~/.971app-dev-token.json (mode 0600) and reused until it's about to
// expire, at which point it's silently refreshed (no bcrypt) instead of
// re-authenticating from scratch. First run is a normal password sign-in;
// every run after that within the token's lifetime is a single request.

import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

const APP_ORIGIN = 'https://spartanshub.spartanrobotics.org';
const TOKEN_CACHE_PATH = join(homedir(), '.971app-dev-token.json');
const EXPIRY_BUFFER_SECONDS = 60;

const [, , targetEmail, ...textParts] = process.argv;
const text = textParts.join(' ');

if (!targetEmail || !text) {
  console.error('Usage: node --env-file=.env scripts/send-slack-test.mjs <email> "<message text>"');
  process.exit(1);
}

const SUPABASE_URL = process.env.PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.PUBLIC_SUPABASE_ANON_KEY;
const DEV_TOOLS_EMAIL = process.env.DEV_TOOLS_EMAIL;
const DEV_TOOLS_PASSWORD = process.env.DEV_TOOLS_PASSWORD;

const missing = ['PUBLIC_SUPABASE_URL', 'PUBLIC_SUPABASE_ANON_KEY', 'DEV_TOOLS_EMAIL', 'DEV_TOOLS_PASSWORD']
  .filter((k) => !process.env[k]);
if (missing.length) {
  console.error(`Missing env vars: ${missing.join(', ')} - did you forget --env-file=.env?`);
  process.exit(1);
}

async function readCachedTokens() {
  try {
    return JSON.parse(await readFile(TOKEN_CACHE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

async function writeCachedTokens(tokens) {
  await writeFile(TOKEN_CACHE_PATH, JSON.stringify(tokens), { mode: 0o600 });
}

async function signInWithPassword() {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ email: DEV_TOOLS_EMAIL, password: DEV_TOOLS_PASSWORD })
  });
  const data = await resp.json();
  if (!data.access_token) {
    console.error('Sign-in failed:', data);
    process.exit(1);
  }
  return data;
}

async function refreshTokens(refreshToken) {
  const resp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
    body: JSON.stringify({ refresh_token: refreshToken })
  });
  if (!resp.ok) return null;
  const data = await resp.json();
  return data.access_token ? data : null;
}

async function getAccessToken() {
  const cached = await readCachedTokens();
  const now = Date.now() / 1000;

  if (cached?.access_token && cached.expires_at > now + EXPIRY_BUFFER_SECONDS) {
    return cached.access_token;
  }

  let fresh = cached?.refresh_token ? await refreshTokens(cached.refresh_token) : null;
  if (!fresh) fresh = await signInWithPassword();

  await writeCachedTokens({
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at: now + (fresh.expires_in ?? 3600)
  });
  return fresh.access_token;
}

async function sendTestDm(accessToken) {
  const resp = await fetch(`${APP_ORIGIN}/api/971bot/internal/test-dm`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ email: targetEmail, text })
  });
  return { resp, result: await resp.json() };
}

let accessToken = await getAccessToken();
let { resp, result } = await sendTestDm(accessToken);

// Cached token looked unexpired but the server rejected it anyway (e.g.
// revoked out-of-band) - fall back to a real sign-in and retry once,
// rather than leaving the user with a confusing 401.
if (resp.status === 401) {
  const fresh = await signInWithPassword();
  await writeCachedTokens({
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token,
    expires_at: Date.now() / 1000 + (fresh.expires_in ?? 3600)
  });
  ({ resp, result } = await sendTestDm(fresh.access_token));
}

console.log(`HTTP ${resp.status}`);
console.log(JSON.stringify(result, null, 2));
process.exit(resp.ok && result.ok ? 0 : 1);
