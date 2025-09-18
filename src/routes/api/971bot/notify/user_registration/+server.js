import { json } from '@sveltejs/kit';
import { postUserApprovalNeeded } from '$lib/server/971bot';

export async function POST({ request }) {
  const data = await request.json().catch(() => ({}));
  const name = data.name || data.full_name || 'New User';
  const user_id = data.id || data.user_id;
  await postUserApprovalNeeded(name);
  return json({ ok: true, noted: true, user_id });
}
