import { json } from '@sveltejs/kit';
import { postPurchaseRequestMessage, getSupabase } from '$lib/server/971bot';

export async function POST({ request }) {
  try {
    const data = await request.json().catch(() => ({}));
    const requester = data.requester || 'Unknown requester';
    const item_name = data.item_name || data.name || 'item';
    const project_id = data.project_id || data.project || 'project';

    // If a purchase_id is supplied use it; otherwise caller should insert and then call notify.
    const purchaseId = data.purchase_id || data.purchaseId || null;

    console.log('Purchase notification request:', { requester, item_name, project_id, purchaseId });

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
  } catch (error) {
    console.error('Error in purchase notification endpoint:', error);
    return json({ 
      ok: false, 
      error: error.message || 'Failed to send purchase notification',
      details: error.toString()
    }, { status: 500 });
  }
}
