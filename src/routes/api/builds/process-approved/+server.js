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

    // Gather BOM snapshot rows that were added to the build
    const { data: rows, error: bomErr } = await supa.from('build_bom').select('*').eq('build_id', buildId).eq('added', true);
    if (bomErr) throw bomErr;
    const createdPartIds = [];
    const createdPurchasingIds = [];
    const createdKittingIds = [];

    const project_id = build.project_id || `${build.release_name}`;

    // Insert manufactured parts for items marked as added
    for (const it of rows.filter(r => r.part_type === 'manufactured')) {
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
      if (!insErr && ins?.[0]?.id) {
        createdPartIds.push(ins[0].id);
        // Update the build_bom row with the relation to the newly created part
        await supa.from('build_bom').update({ parts_id: ins[0].id }).eq('id', it.id);
      }
    }

    // Insert COTS purchases for items marked as added
    for (const it of rows.filter(r => r.part_type === 'COTS' && (r.workflow || 'purchase') === 'purchase')) {
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
      if (!purErr && pur?.[0]?.id) {
        createdPurchasingIds.push(pur[0].id);
        // Update the build_bom row with the relation to the newly created purchasing item
        await supa.from('build_bom').update({ purchasing_id: pur[0].id }).eq('id', it.id);
      }
    }

    // Insert COTS items for kitting workflow
    for (const it of rows.filter(r => r.part_type === 'COTS' && r.workflow === 'kit')) {
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
      if (!kitErr && kit?.[0]?.id) {
        createdKittingIds.push(kit[0].id);
        // Update the build_bom row with the relation to the newly created kitting item
        await supa.from('build_bom').update({ kitting_id: kit[0].id }).eq('id', it.id);
      }
    }

    // Update build.part_ids with everything created
    const newIds = [...createdPartIds, ...createdPurchasingIds, ...createdKittingIds].filter(Boolean);
    if (newIds.length) {
      const currentIds = Array.isArray(build.part_ids) ? build.part_ids : [];
      const merged = [...currentIds, ...newIds.filter(id => !currentIds.includes(id))];
      await supa.from('builds').update({ part_ids: merged }).eq('id', buildId);
    }

    console.log('process-approved: created', { buildId, createdPartIds, createdPurchasingIds, createdKittingIds });
    return json({ ok: true, parts: createdPartIds.length, purchasing: createdPurchasingIds.length, kitting: createdKittingIds.length, part_ids: newIds, created: { parts: createdPartIds, purchasing: createdPurchasingIds, kitting: createdKittingIds } });
  } catch (e) {
    return json({ ok: false, error: e?.message || String(e) }, { status: 500 });
  }
}
