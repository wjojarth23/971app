import { json } from '@sveltejs/kit';
import { getSupabase } from '$lib/server/971bot';

export async function POST({ request }) {
  const supa = getSupabase();
  const body = await request.json().catch(() => ({}));
  const buildId = body.build_id || body.id;
  if (!buildId) return json({ ok: false, error: 'missing build_id' }, { status: 400 });

  try {
    const { data: build, error } = await supa.from('builds').select('*').eq('id', buildId).single();
    if (error || !build) return json({ ok: false, error: error?.message || 'not found' }, { status: 404 });
    if (!build.approved) return json({ ok: false, error: 'build not approved yet' }, { status: 400 });

    // Gather BOM snapshot rows
    const { data: rows, error: bomErr } = await supa.from('build_bom').select('*').eq('build_id', buildId);
    if (bomErr) throw bomErr;
    const createdPartIds = [];
    const createdPurchasingIds = [];
    const createdKittingIds = [];

    const project_id = build.project_id || `${build.release_name}`;

    // Insert manufactured parts flagged by added_to_parts_list
    for (const it of rows.filter(r => r.part_type === 'manufactured' && r.added_to_parts_list)) {
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
      const { data: ins, error: insErr } = await supa.from('parts').insert([baseInsert]).select();
      if (!insErr && ins?.[0]?.id) createdPartIds.push(ins[0].id);
    }

    // Insert COTS purchases flagged by added_to_purchasing
    for (const it of rows.filter(r => r.part_type === 'COTS' && r.added_to_purchasing && (r.workflow || 'purchase') === 'purchase')) {
      const purchasingInsertData = {
        name: it.part_name || 'Unnamed Item',
        requester: 'Build System',
        project_id,
        quantity: it.quantity || 1,
        material: it.material || '',
        status: 'pending',
        workflow: 'purchase'
      };
      const { data: pur, error: purErr } = await supa.from('purchasing').insert([purchasingInsertData]).select();
      if (!purErr && pur?.[0]?.id) createdPurchasingIds.push(pur[0].id);
    }

    // Insert COTS items flagged for kitting
    for (const it of rows.filter(r => r.part_type === 'COTS' && r.added_to_kitting && r.workflow === 'kit')) {
      const kitInsert = {
        name: it.part_name || 'Unnamed Item',
        requester: 'Build System',
        project_id,
        quantity: it.quantity || 1,
        material: it.material || '',
        status: 'pending',
        workflow: 'kit'
      };
      const { data: kit, error: kitErr } = await supa.from('kitting').insert([kitInsert]).select();
      if (!kitErr && kit?.[0]?.id) createdKittingIds.push(kit[0].id);
    }

    // Update build.part_ids with everything created
    const newIds = [...createdPartIds, ...createdPurchasingIds, ...createdKittingIds].filter(Boolean);
    if (newIds.length) {
      const currentIds = Array.isArray(build.part_ids) ? build.part_ids : [];
      const merged = [...currentIds, ...newIds.filter(id => !currentIds.includes(id))];
      await supa.from('builds').update({ part_ids: merged }).eq('id', buildId);
    }

    return json({ ok: true, parts: createdPartIds.length, purchasing: createdPurchasingIds.length, kitting: createdKittingIds.length });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
