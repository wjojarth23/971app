import { createClient } from '@supabase/supabase-js';
import { WebClient } from '@slack/web-api';

// Lazy initialization to avoid throwing at module import time (build-time).
let _supabaseClient = null;
let _slackClient = null;

const APPROVER_GROUP_NAME = process.env.APPROVER_DM_NAME || 'purchase-approvals';
const FALLBACK_APPROVER_EMAILS = (process.env.FALLBACK_APPROVER_EMAILS || '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function getSlackTokenFromEnv() {
  return process.env.SLACK_BOT_TOKEN || process.env.BOT_TOKEN || process.env.TOKEN || null;
}

export function getSlackClient() {
  if (_slackClient) return _slackClient;
  const token = getSlackTokenFromEnv();
  if (!token) {
    throw new Error('Missing SLACK_BOT_TOKEN/BOT_TOKEN in environment');
  }
  _slackClient = new WebClient(token);
  return _slackClient;
}

export function getSupabase() {
  if (_supabaseClient) return _supabaseClient;
  const SUPABASE_URL = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    throw new Error('Missing SUPABASE_URL/SUPABASE_SERVICE_KEY (or PUBLIC_SUPABASE_ANON_KEY) in environment');
  }
  _supabaseClient = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  return _supabaseClient;
}

// Cached state
export let approverSlackUserIds = [];
export let approverDmChannelId = null;
export let lastApproverSync = 0;
export const APPROVER_SYNC_TTL = 60; // seconds

// Temporary in-memory map from `${channel}:${ts}` -> purchaseId to avoid needing
// conversation history scopes in development. Not reliable in serverless/prod.
export const messageToPurchaseMap = new Map();

export async function listApproversFromDb() {
  const supa = getSupabase();
  try {
    const { data } = await supa.from('user_profiles').select('id, email, full_name, permissions');
    const users = data || [];
    return users.filter((u) => Array.isArray(u.permissions) && u.permissions.includes('APPROVE_PURCHASES'));
  } catch (e) {
    console.error('Error fetching approvers from Supabase:', e);
    return [];
  }
}

export async function slackUserIdForEmail(email) {
  if (!email) return null;
  try {
    const client = getSlackClient();
    const resp = await client.users.lookupByEmail({ email });
    if (resp.ok) return resp.user?.id || null;
  } catch (e) {
    console.error(`Slack lookup failed for ${email}:`, e?.data || e?.message || e);
  }
  return null;
}

export async function syncApprovers(force = false) {
  if (!force && Date.now() / 1000 - lastApproverSync < APPROVER_SYNC_TTL && approverSlackUserIds.length) return;
  const approvers = await listApproversFromDb();
  let emails = approvers.map((a) => a.email).filter(Boolean);
  if (!emails.length && FALLBACK_APPROVER_EMAILS.length) emails = FALLBACK_APPROVER_EMAILS;
  const userIds = [];
  for (const email of emails) {
    const uid = await slackUserIdForEmail(email);
    if (uid) userIds.push(uid);
  }
  approverSlackUserIds = Array.from(new Set(userIds)).sort();
  lastApproverSync = Date.now() / 1000;
  if (approverSlackUserIds.length) {
    try {
      const client = getSlackClient();
      const conv = await client.conversations.open({ users: approverSlackUserIds.join(',') });
      if (conv.ok) approverDmChannelId = conv.channel.id;
    } catch (e) {
      console.error('Failed to open approver DM:', e?.data || e?.message || e);
    }
  }
}

export async function ensureApproverDmChannel() {
  if (!approverDmChannelId) await syncApprovers(true);
  return approverDmChannelId;
}

export async function postPurchaseRequestMessage(requester, itemName, projectId, purchaseId = null) {
  const channel = await ensureApproverDmChannel();
  if (!channel) {
    console.warn('No approver DM channel available; skipping Slack post');
    return false;
  }
  // Do not include purchase id in message text (avoid leaking IDs in chat)
  // Mapping from message ts -> purchaseId is still stored in-memory and persisted by caller.
  const text = `${requester} needs ${itemName} for ${projectId}`;
  try {
    const client = getSlackClient();
    const resp = await client.chat.postMessage({ channel, text });
    // Log message and response for debugging
    console.log('Posted purchase message to Slack', { channel, text, ok: resp?.ok, ts: resp?.ts, message: resp?.message });
    // If we posted successfully and have a purchaseId, record the mapping in memory
    if (resp && resp.ok && resp.ts && purchaseId) {
      try {
        messageToPurchaseMap.set(`${channel}:${resp.ts}`, Number(purchaseId));
      } catch (e) {
        console.warn('Failed to store message->purchase mapping:', e);
      }
    }
    // Return the full response so callers can persist ts/channel if desired
    return resp;
  } catch (e) {
    console.error('Slack error posting purchase request:', e?.data || e?.message || e);
    return false;
  }
}

export async function approvePurchaseInDb(purchaseId, approverName = 'Slack Approver') {
  try {
    const supa = getSupabase();
    await supa.from('purchasing').update({ approved: true, approver: approverName, status: 'approved' }).eq('id', purchaseId);
    return true;
  } catch (e) {
    console.error('Error approving purchase in DB:', e);
    return false;
  }
}

export async function addPermissionCanSeeRoutes(userId) {
  try {
    const supa = getSupabase();
    const { data } = await supa.from('user_profiles').select('permissions').eq('id', userId).single();
    if (!data) return false;
    const perms = data.permissions || [];
    if (!perms.includes('CAN_SEE_ROUTES')) perms.push('CAN_SEE_ROUTES');
    await supa.from('user_profiles').update({ permissions: perms, role: 'member', banned: false }).eq('id', userId);
    return true;
  } catch (e) {
    console.error('Error adding CAN_SEE_ROUTES permission:', e);
    return false;
  }
}

export async function postUserApprovalNeeded(name) {
  const channel = await ensureApproverDmChannel();
  if (!channel) {
    console.warn('No approver DM channel available for user approval message');
    return false;
  }
  const text = `${name} needs approval`;
  try {
    const client = getSlackClient();
    const resp = await client.chat.postMessage({ channel, text });
    return resp.ok;
  } catch (e) {
    console.error('Slack error posting user approval request:', e?.data || e?.message || e);
    return false;
  }
}

// Basic signature verification for Slack requests (raw body needed by SvelteKit handler)
import crypto from 'crypto';
export function verifySlackSignature(rawBody, headers) {
  const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET || '';
  if (!SLACK_SIGNING_SECRET) return true;
  const timestamp = headers['x-slack-request-timestamp'];
  if (!timestamp) return false;
  if (Math.abs(Date.now() / 1000 - Number(timestamp)) > 60 * 5) return false;
  const sigBasestring = `v0:${timestamp}:${rawBody}`;
  const mySig = 'v0=' + crypto.createHmac('sha256', SLACK_SIGNING_SECRET).update(sigBasestring).digest('hex');
  const slackSig = headers['x-slack-signature'] || '';
  try {
    return crypto.timingSafeEqual(Buffer.from(mySig), Buffer.from(slackSig));
  } catch (e) {
    return false;
  }
}
