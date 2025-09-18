import { json } from '@sveltejs/kit';
import { approverSlackUserIds, approverDmChannelId } from '$lib/server/971bot';

export function GET() {
  return json({ ok: true, service: '971bot', approvers_cached: approverSlackUserIds.length });
}
