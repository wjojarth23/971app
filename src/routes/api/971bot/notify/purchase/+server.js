import { json } from '@sveltejs/kit';
import { postPurchaseRequestMessage } from '$lib/server/971bot';

export async function POST({ request }) {
  const data = await request.json().catch(() => ({}));
  const requester = data.requester || 'Unknown requester';
  const item_name = data.item_name || data.name || 'item';
  const project_id = data.project_id || data.project || 'project';
  await postPurchaseRequestMessage(requester, item_name, project_id);
  return json({ ok: true });
}
