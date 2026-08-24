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

const APP_ORIGIN = 'https://spartanshub.spartanrobotics.org';

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

const signInResp = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: SUPABASE_ANON_KEY },
  body: JSON.stringify({ email: DEV_TOOLS_EMAIL, password: DEV_TOOLS_PASSWORD })
});
const signInData = await signInResp.json();
if (!signInData.access_token) {
  console.error('Sign-in failed:', signInData);
  process.exit(1);
}

const resp = await fetch(`${APP_ORIGIN}/api/971bot/internal/test-dm`, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    authorization: `Bearer ${signInData.access_token}`
  },
  body: JSON.stringify({ email: targetEmail, text })
});
const result = await resp.json();
console.log(`HTTP ${resp.status}`);
console.log(JSON.stringify(result, null, 2));
process.exit(resp.ok && result.ok ? 0 : 1);
