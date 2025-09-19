import { json } from '@sveltejs/kit';
import {
  verifySlackSignature,
  approvePurchaseInDb,
  getSlackClient,
  ensureApproverDmChannel,
  messageToPurchaseMap,
  getSupabase
} from '$lib/server/971bot';

// Avoid approving the same purchase repeatedly when multiple reactions are added.
const recentlyApprovedPurchases = new Set();

export async function POST({ request }) {
  const rawBody = await request.text();
  const headers = Object.fromEntries(request.headers.entries());
  if (!verifySlackSignature(rawBody, headers)) {
    return new Response('Invalid Slack signature', { status: 401 });
  }

  let payload = {};
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
    console.log('Slack event callback received', { event_type, event });

  if (event_type === 'reaction_added') {
      const reaction = event.reaction;
      const item = event.item || {};
      const channel = item.channel;
      const ts = item.ts;
      // The user who reacted is available on the event as `user`
      const reactingUser = event.user || null;

      try {
        const approverChannel = await ensureApproverDmChannel();
        console.log('Approver channel (cached):', approverChannel, 'event channel:', channel);

  if (channel && channel === approverChannel && ts) {
          // First check in-memory map (temporary workaround)
            try {
              const mapKey = `${channel}:${ts}`;
              let mapped = messageToPurchaseMap.get(mapKey);
              if (!mapped) {
                // Try to find a durable mapping in Supabase
                try {
                  const { data: rows, error } = await (await import('$lib/server/971bot')).getSupabase()
                    .from('purchasing')
                    .select('id')
                    .eq('slack_channel', channel)
                    .eq('slack_ts', ts)
                    .limit(1);
                  if (!error && Array.isArray(rows) && rows.length) {
                    mapped = rows[0].id;
                  }
                } catch (dbErr) {
                  console.warn('DB lookup for slack mapping failed:', dbErr);
                }
              }

              // Resolve a friendly approver name from the reacting user's Slack profile when possible
              let approverName = 'Slack Approver';
              try {
                if (reactingUser) {
                  const client = getSlackClient();
                  const info = await client.users.info({ user: reactingUser });
                  if (info && info.ok && info.user) {
                    approverName = info.user.profile?.display_name || info.user.profile?.real_name || info.user.name || approverName;
                  }
                }
              } catch (e) {
                console.warn('Failed to lookup reacting user info:', e?.data || e?.message || e);
              }

              if (mapped) {
                  if (reaction !== 'x') {
                    if (recentlyApprovedPurchases.has(mapped)) {
                      console.log('Purchase already approved recently, skipping duplicate approve for', mapped);
                    } else {
                      console.log('Approving purchase from mapping', mapped, 'based on reaction', reaction, 'by', approverName);
                      const ok = await approvePurchaseInDb(mapped, approverName);
                      if (ok) {
                        recentlyApprovedPurchases.add(mapped);
                        // remove from cache after a short window so future legitimate approvals still work
                        setTimeout(() => recentlyApprovedPurchases.delete(mapped), 30 * 1000);
                      }
                    }
                  }
                } else {
                // Fallback: fetch the message if the app has conversation history scopes
                const client = getSlackClient();
                const msgResp = await client.conversations.history({ channel, latest: ts, inclusive: true, limit: 1 });
                console.log('Fetched message from Slack for ts', ts, msgResp?.ok, msgResp?.messages?.length || 0);
                if (msgResp.ok && msgResp.messages && msgResp.messages.length) {
                  const msg = msgResp.messages[0];
                  const text = msg.text || '';
                    const m = /purchase_id:(\d+)/.exec(text);
                    if (m) {
                      const purchaseId = Number(m[1]);
                      if (reaction !== 'x') {
                        console.log('Approving purchase', purchaseId, 'based on reaction', reaction, 'by', approverName);
                        await approvePurchaseInDb(purchaseId, approverName);
                      }
                    } else {
                      // New: try to detect and approve builds
                      const m2 = /build_id:([0-9a-fA-F-]{8,})/.exec(text);
                      if (m2 && reaction !== 'x') {
                        const buildId = m2[1];
                        try {
                          const supa = getSupabase();
                          await supa.from('builds').update({ approved: true, approver: approverName }).eq('id', buildId);
                          console.log('Approved build via Slack reaction', buildId, 'by', approverName);
                          // Process approved build: create parts/purchasing/kitting from build_bom flags
                          try {
                            const { data: build } = await supa.from('builds').select('*').eq('id', buildId).single();
                            const project_id = build?.project_id || `${build?.release_name || ''}`;
                            const { data: rows } = await supa.from('build_bom').select('*').eq('build_id', buildId);
                            const createdPartIds = [];
                            const createdPurchasingIds = [];
                            const createdKittingIds = [];
                            for (const it of (rows || []).filter(r => r.part_type === 'manufactured' && r.added_to_parts_list)) {
                              const baseInsert = {
                                name: it.part_name || 'Unnamed Part',
                                requester: 'Build System',
                                project_id,
                                workflow: it.workflow || 'mill',
                                status: 'pending',
                                quantity: it.quantity || 1,
                                material: it.material || '',
                                file_name: '',
                                file_url: '',
                                stock_assignment: it.stock_assignment || null
                              };
                              const { data: ins } = await supa.from('parts').insert([baseInsert]).select();
                              if (ins?.[0]?.id) createdPartIds.push(ins[0].id);
                            }
                            for (const it of (rows || []).filter(r => r.part_type === 'COTS' && r.added_to_purchasing && (r.workflow || 'purchase') === 'purchase')) {
                              const purchasingInsertData = {
                                name: it.part_name || 'Unnamed Item',
                                requester: 'Build System',
                                project_id,
                                quantity: it.quantity || 1,
                                material: it.material || '',
                                status: 'pending',
                                workflow: 'purchase'
                              };
                              const { data: pur } = await supa.from('purchasing').insert([purchasingInsertData]).select();
                              if (pur?.[0]?.id) createdPurchasingIds.push(pur[0].id);
                            }
                            for (const it of (rows || []).filter(r => r.part_type === 'COTS' && r.added_to_kitting && r.workflow === 'kit')) {
                              const kitInsert = {
                                name: it.part_name || 'Unnamed Item',
                                requester: 'Build System',
                                project_id,
                                quantity: it.quantity || 1,
                                material: it.material || '',
                                status: 'pending',
                                workflow: 'kit'
                              };
                              const { data: kit } = await supa.from('kitting').insert([kitInsert]).select();
                              if (kit?.[0]?.id) createdKittingIds.push(kit[0].id);
                            }
                            const newIds = [...createdPartIds, ...createdPurchasingIds, ...createdKittingIds].filter(Boolean);
                            if (newIds.length) {
                              const currentIds = Array.isArray(build?.part_ids) ? build.part_ids : [];
                              const merged = [...currentIds, ...newIds.filter(id => !currentIds.includes(id))];
                              await supa.from('builds').update({ part_ids: merged }).eq('id', buildId);
                            }
                          } catch (procErr) {
                            console.error('Failed to process approved build:', procErr?.message || procErr);
                          }
                        } catch (e) {
                          console.error('Failed to approve build from Slack reaction:', e?.message || e);
                        }
                      }
                    }
                }
              }
            } catch (e) {
              console.error('Failed to fetch message for reaction processing:', e);
            }
        }
      } catch (e) {
        console.error('Failed to process reaction:', e);
      }
    }

    return json({ ok: true });
  }

  return json({ ok: true });
}
