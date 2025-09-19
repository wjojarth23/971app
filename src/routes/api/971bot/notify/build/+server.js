import { json } from '@sveltejs/kit';
import { getSupabase, postBuildApprovalRequest } from '$lib/server/971bot';

export async function POST({ request }) {
  const supa = getSupabase();
  const data = await request.json().catch(() => ({}));
  const buildId = data.build_id || data.id;
  const requester = data.requester || 'Unknown';
  if (!buildId) return json({ ok: false, error: 'missing build_id' }, { status: 400 });

  try {
    const { data: build, error } = await supa
      .from('builds')
      .select('*')
      .eq('id', buildId)
      .single();
    if (error || !build) return json({ ok: false, error: error?.message || 'not found' }, { status: 404 });

    const resp = await postBuildApprovalRequest(build, requester);
    return json({ ok: !!resp?.ok, channel: resp?.channel, ts: resp?.ts });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
