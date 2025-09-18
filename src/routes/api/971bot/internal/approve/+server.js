import { json } from '@sveltejs/kit';
import { approvePurchaseInDb } from '$lib/server/971bot';

export async function POST({ request }) {
  const data = await request.json().catch(() => ({}));
  const purchase_id = data.purchase_id;
  if (!purchase_id) return json({ error: 'purchase_id required' }, { status: 400 });
  const ok = await approvePurchaseInDb(Number(purchase_id));
  return json({ ok });
}
