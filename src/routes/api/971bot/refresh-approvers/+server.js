import { json } from '@sveltejs/kit';
import { syncApprovers, approverSlackUserIds, approverDmChannelId } from '$lib/server/971bot';

export async function POST() {
  console.log('Manual approver refresh requested');
  try {
    await syncApprovers(true);
    const result = {
      ok: true,
      approver_count: approverSlackUserIds.length,
      approver_slack_user_ids: approverSlackUserIds,
      channel: approverDmChannelId,
      channel_type: approverDmChannelId ? (approverSlackUserIds.length === 1 ? 'DM' : 'MPIM') : null
    };
    console.log('Approver sync result:', result);
    return json(result);
  } catch (error) {
    console.error('Error during manual approver sync:', error);
    return json({ 
      ok: false, 
      error: error.message || String(error),
      approver_slack_user_ids: approverSlackUserIds,
      channel: approverDmChannelId
    }, { status: 500 });
  }
}
