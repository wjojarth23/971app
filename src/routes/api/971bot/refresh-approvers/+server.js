import { json } from '@sveltejs/kit';
import { syncApprovers, approverSlackUserIds, approverDmChannelId } from '$lib/server/971bot';

export async function POST() {
  await syncApprovers(true);
  return json({ ok: true, approver_slack_user_ids: approverSlackUserIds, channel: approverDmChannelId });
}
