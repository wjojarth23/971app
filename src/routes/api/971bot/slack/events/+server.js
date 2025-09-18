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

              if (mapped) {
                if (reaction !== 'x') {
                  console.log('Approving purchase from mapping', mapped, 'based on reaction', reaction);
                  await approvePurchaseInDb(mapped);
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
                      console.log('Approving purchase', purchaseId, 'based on reaction', reaction);
                      await approvePurchaseInDb(purchaseId);
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
