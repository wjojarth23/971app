import { json } from '@sveltejs/kit';
import {
  verifySlackSignature,
  approvePurchaseInDb,
  getSlackClient,
  ensureApproverDmChannel,
  messageToPurchaseMap
} from '$lib/server/971bot';

export async function POST({ request }) {
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  if (!verifySlackSignature(rawBody, headers)) {
    return new Response('Invalid Slack signature', { status: 401 });
  }

  let payload = {};
  try {
    payload = JSON.parse(rawBody || '{}');
  } catch (e) {
    payload = {};
  }

  if (payload.type === 'url_verification') {
    return json({ challenge: payload.challenge });
  }

  if (payload.type === 'event_callback') {
    const event = payload.event || {};
    const event_type = event.type;
    console.log('Slack event callback received', { event_type, event });

    if (event_type === 'reaction_added') {
      const reaction = event.reaction;
      const item = event.item || {};
      const channel = item.channel;
      const ts = item.ts;
      // The user who reacted is available on the event as `user`
      const reactingUser = event.user || null;

      try {
        const approverChannel = await ensureApproverDmChannel();
        console.log('Approver channel (cached):', approverChannel, 'event channel:', channel);

        if (channel && channel === approverChannel && ts) {
          // First check in-memory map (temporary workaround)
            try {
              const mapKey = `${channel}:${ts}`;
              let mapped = messageToPurchaseMap.get(mapKey);
              if (!mapped) {
                // Try to find a durable mapping in Supabase
                try {
                  const { data: rows, error } = await (await import('$lib/server/971bot')).getSupabase()
                    .from('purchasing')
                    .select('id')
                    .eq('slack_channel', channel)
                    .eq('slack_ts', ts)
                    .limit(1);
                  if (!error && Array.isArray(rows) && rows.length) {
                    mapped = rows[0].id;
                  }
                } catch (dbErr) {
                  console.warn('DB lookup for slack mapping failed:', dbErr);
                }
              }

              // Resolve a friendly approver name from the reacting user's Slack profile when possible
              let approverName = 'Slack Approver';
              try {
                if (reactingUser) {
                  const client = getSlackClient();
                  const info = await client.users.info({ user: reactingUser });
                  if (info && info.ok && info.user) {
                    approverName = info.user.profile?.display_name || info.user.profile?.real_name || info.user.name || approverName;
                  }
                }
              } catch (e) {
                console.warn('Failed to lookup reacting user info:', e?.data || e?.message || e);
              }

              if (mapped) {
                  if (reaction !== 'x') {
                    console.log('Approving purchase from mapping', mapped, 'based on reaction', reaction, 'by', approverName);
                    await approvePurchaseInDb(mapped, approverName);
                  }
                } else {
                // Fallback: fetch the message if the app has conversation history scopes
                const client = getSlackClient();
                const msgResp = await client.conversations.history({ channel, latest: ts, inclusive: true, limit: 1 });
                console.log('Fetched message from Slack for ts', ts, msgResp?.ok, msgResp?.messages?.length || 0);
                if (msgResp.ok && msgResp.messages && msgResp.messages.length) {
                  const msg = msgResp.messages[0];
                  const text = msg.text || '';
                  const m = /purchase_id:(\d+)/.exec(text);
                  if (m) {
                    const purchaseId = Number(m[1]);
                    if (reaction !== 'x') {
                      console.log('Approving purchase', purchaseId, 'based on reaction', reaction, 'by', approverName);
                      await approvePurchaseInDb(purchaseId, approverName);
                    }
                  }
                }
              }
            } catch (e) {
              console.error('Failed to fetch message for reaction processing:', e);
            }
        }
      } catch (e) {
        console.error('Failed to process reaction:', e);
      }
    }

    return json({ ok: true });
  }

  return json({ ok: true });
}
