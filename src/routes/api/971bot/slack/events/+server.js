import { json } from '@sveltejs/kit';
import { verifySlackSignature, approverDmChannelId, approvePurchaseInDb } from '$lib/server/971bot';

export async function POST({ request }) {
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  if (!verifySlackSignature(rawBody, headers)) {
    return new Response('Invalid Slack signature', { status: 401 });
  }
  let payload;
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
    if (event_type === 'reaction_added') {
      const reaction = event.reaction;
      const item = event.item || {};
      const channel = item.channel;
      if (channel && channel === approverDmChannelId) {
        try {
          const ts = item.ts;
          if (ts) {
            // fetch message via slack client to extract purchase id not available here (left as TODO)
            // If message text contains purchase_id:<number>, approve unless reaction is 'x'
            // For now, no message fetch; rely on future enhancements.
          }
        } catch (e) {
          console.error('Failed to process reaction:', e);
        }
      }
    }
    return json({ ok: true });
  }

  return json({ ok: true });
}
