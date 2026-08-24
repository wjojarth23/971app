import { json } from '@sveltejs/kit';
import { createClient } from '@supabase/supabase-js';
import { PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY } from '$env/static/public';
import { getSlackClient, getSupabase, slackUserIdForEmail } from '$lib/server/971bot.js';

function getClientFromRequest(request) {
  const auth = request?.headers?.get('authorization') || '';
  return createClient(PUBLIC_SUPABASE_URL, PUBLIC_SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: auth } }
  });
}

// Ad hoc diagnostic endpoint: send an arbitrary Slack DM to a given email,
// using whatever SLACK_BOT_TOKEN is actually configured in this deployment's
// environment (never touches the raw secret value directly - that's the
// point of testing through here instead of a local script). Admin-only,
// since this can DM any real person in the workspace.
export async function POST({ request }) {
  const userSupa = getClientFromRequest(request);
  const { data: { user: authUser } } = await userSupa.auth.getUser();
  if (!authUser) return json({ error: 'Unauthorized' }, { status: 401 });

  const supa = getSupabase();
  const { data: caller } = await supa.from('user_profiles').select('role').eq('id', authUser.id).maybeSingle();
  if (caller?.role !== 'admin') return json({ error: 'Admin only' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const email = body?.email;
  const text = body?.text;
  const identityOnly = !!body?.identity_only;

  try {
    const slack = getSlackClient();

    const authCheck = await slack.auth.test().catch((e) => ({ ok: false, error: e?.data?.error || e?.message }));
    if (!authCheck.ok) {
      return json({ ok: false, step: 'auth.test', error: authCheck.error }, { status: 502 });
    }

    // identity_only: confirm which bot/app this token belongs to (name,
    // bot user id, workspace) without actually sending a message.
    if (identityOnly) {
      return json({
        ok: true,
        team: authCheck.team,
        teamId: authCheck.team_id,
        botUserName: authCheck.user,
        botUserId: authCheck.user_id,
        botId: authCheck.bot_id
      });
    }

    if (!email || !text) return json({ error: 'email and text required' }, { status: 400 });

    let slackUserId = await slackUserIdForEmail(email);
    if (!slackUserId) {
      return json({ ok: false, step: 'lookupByEmail', error: 'no Slack user found for that email', authTest: authCheck }, { status: 404 });
    }

    const conv = await slack.conversations.open({ users: slackUserId });
    if (!conv.ok) {
      return json({ ok: false, step: 'conversations.open', error: conv.error || conv }, { status: 502 });
    }

    const resp = await slack.chat.postMessage({ channel: conv.channel.id, text });
    return json({ ok: !!resp.ok, ts: resp.ts, channel: conv.channel.id, slackUserId, team: authCheck.team });
  } catch (e) {
    return json({ ok: false, error: e?.data?.error || e?.message || String(e) }, { status: 500 });
  }
}
