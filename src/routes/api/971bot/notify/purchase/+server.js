import { json } from '@sveltejs/kit';
import { postPurchaseRequestMessage, getSupabase } from '$lib/server/971bot';

export async function POST({ request }) {
  const data = await request.json().catch(() => ({}));
  const requester = data.requester || 'Unknown requester';
  const item_name = data.item_name || data.name || 'item';
  const project_id = data.project_id || data.project || 'project';

  // If a purchase_id is supplied use it; otherwise caller should insert and then call notify.
  const purchaseId = data.purchase_id || data.purchaseId || null;

  const slackResp = await postPurchaseRequestMessage(requester, item_name, project_id, purchaseId);

  // Persist slack channel/ts to the purchasing row when possible (durable mapping)
  try {
    if (slackResp && slackResp.ok && slackResp.ts && purchaseId) {
      const supa = getSupabase();
      await supa.from('purchasing').update({ slack_channel: slackResp.channel, slack_ts: slackResp.ts }).eq('id', purchaseId);
    }
  } catch (e) {
    console.warn('Failed to persist slack channel/ts to purchasing row:', e);
  }

  return json({ ok: true, slack: { ok: !!slackResp?.ok, ts: slackResp?.ts, channel: slackResp?.channel } });
}
