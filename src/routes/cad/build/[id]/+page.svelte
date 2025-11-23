<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { goto } from '$app/navigation';
  import { ArrowLeft, Package, CheckCircle, Clock, Wrench, ExternalLink, MapPin, Plus, Download } from 'lucide-svelte';
  import stockData from '$lib/stock.json';
  import { BUTTONS } from '$lib/statuses.js';
  import { detectVendorFromString, buildVendorSearchUrl } from '$lib/vendor_detect.js';

  let user = null;
  let loading = true;
  let build = null;
  let buildId = $page.params.id;
  let bomSnapshot = [];
  let processingAdd = false;
  let projectBuilds = [];
  let projectTotalCost = 0;
  let projectPartsCount = 0;

  // Edit modal state for build items (top table)
  let showEditModal = false;
  let editTarget = null;
  let editWorkflow = '';
  let editType = ''; // 'COTS' or 'manufactured'
  let editMaterial = '';
  let editQuantity = 1;
  let editStockAssignment = '';
  let editStockChoice = '';
  let editStockAssignmentCustom = null;

  // Purchase modal (when auto-detect fails)
  let showPurchaseModal = false;
  let purchaseModalItem = null;
  let purchaseModalUrl = '';
  let purchaseModalPrice = '';

  // Version selector modal for refetching BOM
  let showVersionModal = false;
  let versionTimeline = [];
  let loadingVersions = false;
  let selectedVersionForRefetch = null;

  onMount(async () => {
    // Hydrate from UUID and keep local var in sync
    const unsub = userStore.subscribe((v) => { user = v; });
    await loadUserFromUUID(supabase);

    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    if (!session && !user) {
      goto('/');
      loading = false;
      return;
    }
    if (session?.user?.id) {
      setUserUUID(session.user.id);
      await upsertProfileIfMissing(supabase, {
        id: session.user.id,
        email: session.user.email,
        name: session.user.user_metadata?.full_name || (session.user.email ? session.user.email.split('@')[0] : '')
      });
      await loadUserFromUUID(supabase);
    }

    await loadBuildDetails();
    loading = false;
  });

  async function loadBuildDetails() {
    try {
      const { data, error } = await supabase
        .from('builds')
        .select(`
          *,
          subsystems(
            id,
            name,
            description,
            onshape_url,
            onshape_document_id,
            onshape_workspace_id,
            onshape_element_id
          )
        `)
        .eq('id', buildId)
        .single();

      if (error) throw error;
      build = data;

      // Load saved BOM snapshot (all items)
      const { data: bomData, error: bomErr } = await supabase
        .from('build_bom')
        .select('*')
        .eq('build_id', buildId)
        .order('created_at', { ascending: true });
      if (!bomErr) {
        bomSnapshot = (bomData || []).map(it => ({
          ...it,
          _stock_choice: it.stock_assignment_custom ? '__other__' : '',
        }));
      } else {
        console.error('Error loading BOM snapshot:', bomErr);
        bomSnapshot = [];
      }

      // Load actual created items by following relations from build_bom
      // Get all build_bom rows that have been added to the build
      const addedBomRows = bomSnapshot.filter(row => row.added === true);

      // Collect all related IDs
      const partsIds = addedBomRows.filter(row => row.parts_id).map(row => row.parts_id);
      const purchasingIds = addedBomRows.filter(row => row.purchasing_id).map(row => row.purchasing_id);
      const kittingIds = addedBomRows.filter(row => row.kitting_id).map(row => row.kitting_id);

      // Fetch actual created items
      let partsData = [];
      let purchasingData = [];
      let kittingData = [];

      if (partsIds.length > 0) {
        const { data, error: partsError } = await supabase
          .from('parts')
          .select('*')
          .in('id', partsIds);
        if (!partsError) partsData = data || [];
      }

      if (purchasingIds.length > 0) {
        const { data, error: purchasingError } = await supabase
          .from('purchasing')
          .select('*')
          .in('id', purchasingIds);
        if (!purchasingError) purchasingData = data || [];
      }

      if (kittingIds.length > 0) {
        const { data, error: kittingError } = await supabase
          .from('kitting')
          .select('*')
          .in('id', kittingIds);
        if (!kittingError) kittingData = data || [];
      }

      // Update build object to trigger reactivity
      build = {
        ...build,
        parts: partsData,
        purchasing: purchasingData,
        kitting: kittingData
      };

      // Create placeholder entries for added items that don't have relations yet (pending approval)
      const pendingParts = addedBomRows.filter(row =>
        row.part_type === 'manufactured' && !row.parts_id
      ).map(row => ({
        _bom: true,
        bom_id: row.id,
        name: row.part_name,
        part_number: row.part_number || null,
        quantity: row.quantity || 1,
        material: row.material || '',
        workflow: row.workflow || 'mill',
        status: 'needs_approval',
        stock_assignment: row.stock_assignment || null
      }));

      const pendingPurchasing = addedBomRows.filter(row =>
        row.part_type === 'COTS' && (row.workflow || 'purchase') === 'purchase' && !row.purchasing_id
      ).map(row => ({
        _bom: true,
        bom_id: row.id,
        name: row.part_name,
        part_number: row.part_number || null,
        quantity: row.quantity || 1,
        material: row.material || '',
        workflow: 'purchase',
        status: 'needs_approval'
      }));

      const pendingKitting = addedBomRows.filter(row =>
        row.part_type === 'COTS' && row.workflow === 'kit' && !row.kitting_id
      ).map(row => ({
        _bom: true,
        bom_id: row.id,
        name: row.part_name,
        part_number: row.part_number || null,
        quantity: row.quantity || 1,
        material: row.material || '',
        workflow: 'kit',
        status: 'needs_approval'
      }));

  // Merge placeholders with actual created rows
  // Use `let` so variables exist even if an earlier error occurs during load
  let mergedParts = [];
  let mergedPurchasing = [];
  let mergedKitting = [];
  mergedParts = [...(partsData || []), ...(pendingParts || [])];
  mergedPurchasing = [...(purchasingData || []), ...(pendingPurchasing || [])];
  mergedKitting = [...(kittingData || []), ...(pendingKitting || [])];

      // Compute purchasing cost for this build
      let totalCost = 0;
      try {
        totalCost = mergedPurchasing.reduce((sum, p) => {
          const unit = (p.final_price ?? p.price) || 0;
          const qty = p.quantity || 1;
          return sum + (Number(unit) * Number(qty));
        }, 0);
      } catch (e) { totalCost = 0; }

      // Update build object with merged data and total cost
      build = {
        ...build,
        parts: mergedParts,
        purchasing: mergedPurchasing,
        kitting: mergedKitting,
        totalPurchasingCost: totalCost
      };

      // If build has a project_id, load sibling builds in the same project to show project container
      if (build.project_id) {
        try {
          const { data: siblings, error: sibErr } = await supabase.from('builds').select('*, subsystems(name)').eq('project_id', build.project_id).order('created_at', { ascending: false });
          if (!sibErr) {
            projectBuilds = siblings || [];
            projectTotalCost = projectBuilds.reduce((s, b) => s + (b.totalPurchasingCost || 0), 0);
            // compute project parts (row-based) across sibling builds
            try {
              projectPartsCount = projectBuilds.reduce((s, b) => s + (((b.parts||[]).length || 0) + ((b.purchasing||[]).length || 0) + ((b.kitting||[]).length || 0)), 0);
            } catch (e) {
              projectPartsCount = 0;
            }
          }
        } catch (e) {
          projectBuilds = [];
          projectTotalCost = 0;
        }
      }
    } catch (error) {
      console.error('Error loading build details:', error);
      alert('Failed to load build details: ' + error.message);
      goto('/cad/build');
    } finally {
      loading = false;
    }
  }

  async function markAsAssembled() {
    try {
      const { error } = await supabase
        .from('builds')
        .update({ 
          status: 'assembled',
          assembled_at: new Date().toISOString(),
          assembled_by: user.id
        })
        .eq('id', buildId);

      if (error) throw error;
      await loadBuildDetails();
    } catch (error) {
      console.error('Error marking as assembled:', error);
      alert('Failed to mark as assembled');
    }
  }

  function getStocksForWorkflow(workflow) {
    return stockData[workflow] || [];
  }

  function getBuildProgress() {
    if (!build) return { 
      percent: 0, 
      manufactured: 0, 
      total: 0, 
      status: 'No parts',
      mfgPercent: 0,
      purPercent: 0,
      kitPercent: 0,
      mfgCount: { complete: 0, total: 0 },
      purCount: { complete: 0, total: 0 },
      kitCount: { complete: 0, total: 0 }
    };
    const allParts = [...(build.parts || []), ...(build.purchasing || []), ...(build.kitting || [])];
    if (allParts.length === 0) return { 
      percent: 0, 
      manufactured: 0, 
      total: 0, 
      status: 'No parts',
      mfgPercent: 0,
      purPercent: 0,
      kitPercent: 0,
      mfgCount: { complete: 0, total: 0 },
      purCount: { complete: 0, total: 0 },
      kitCount: { complete: 0, total: 0 }
    };
    const manufactured = allParts.filter(item => item.status === 'complete' || item.status === 'delivered' || item.status === 'kitted').length;
    const inProgress = allParts.filter(item => item.status === 'in-progress' || item.status === 'cammed' || item.status === 'ordered').length;
    let status = 'Requested';
    if (manufactured === allParts.length) status = 'Ready to Assemble';
    else if (inProgress > 0 || manufactured > 0) status = 'Manufacturing';
  // Derive per-workflow lists from the aggregated allParts so counts
  // align with the overall manufactured/total calculations. This
  // handles cases where parts/purchasing/kitting arrays may not be
  // populated consistently but allParts still contains the items.
  const mfgParts = allParts.filter(p => (p.workflow || '').toString() !== 'purchase' && (p.workflow || '').toString() !== 'kit');
  const purParts = allParts.filter(p => (p.workflow || '').toString() === 'purchase');
  const kitParts = allParts.filter(p => (p.workflow || '').toString() === 'kit');

  const mfgComplete = mfgParts.filter(p => p.status === 'complete').length;
  const purComplete = purParts.filter(p => p.status === 'delivered').length;
  const kitComplete = kitParts.filter(p => p.status === 'kitted').length;
    return {
      percent: Math.round((manufactured / allParts.length) * 100),
      manufactured,
      total: allParts.length,
      inProgress,
      status,
      mfgPercent: mfgParts.length ? Math.round((mfgComplete / mfgParts.length) * 100) : 0,
      purPercent: purParts.length ? Math.round((purComplete / purParts.length) * 100) : 0,
      kitPercent: kitParts.length ? Math.round((kitComplete / kitParts.length) * 100) : 0,
      mfgCount: { complete: mfgComplete, total: mfgParts.length },
      purCount: { complete: purComplete, total: purParts.length },
      kitCount: { complete: kitComplete, total: kitParts.length }
    };
  }

  function getWorkflowIcon(workflow) {
    switch (workflow) {
      case '3d-print': return '🖨️';
      case 'laser-cut': return '🔥';
      case 'mill': return '⚙️';
      case 'lathe': return '🔄';
      case 'router': return '🪚';
      case 'purchase': return '🛒';
      default: return '🔧';
    }
  }

  // Build Components edit modal
  function openEditModal(part) {
    // If this is a BOM placeholder (not yet created in parts/purchasing/kitting)
    // we don't open the edit modal. Edits should be performed in the Full BOM
    // editor where the BOM snapshot is persisted.
    if (part && part._bom) {
      // prefer navigating to the full BOM edit page (same route)
      showToast('This item is a queued BOM item. Edit it in the Full BOM section below.');
      return;
    }
    editTarget = part;
    editWorkflow = part.workflow || '';
    editMaterial = part.material || '';
    editQuantity = part.quantity || 1;
    editStockAssignment = part.stock_assignment || '';
    editStockChoice = part._stock_choice || (part.stock_assignment_custom ? '__other__' : '') || '';
    editStockAssignmentCustom = part.stock_assignment_custom ?? null;
    editType = part.workflow === 'purchase' ? 'COTS' : 'manufactured';
    showEditModal = true;
  }

  // Row interaction helpers (like manufacture route)
  function onRowClick(e, part) {
    try {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a') || e.target.closest('select')) return;
    } catch {}
    // If placeholder BOM row, redirect user to the Full BOM section rather
    // than attempting to edit a non-persisted row in the parts/purchasing lists.
    if (part && part._bom) {
      // Smooth scroll to Full BOM section
      const el = document.querySelector('.bom-section:last-of-type');
      if (el) el.scrollIntoView({ behavior: 'smooth' });
      showToast('Scroll to Full BOM to edit queued items.');
      return;
    }
    openEditModal(part);
  }

  function onRowKeyDown(e, part) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    try {
      if (e.target.closest('button') || e.target.closest('input') || e.target.closest('a') || e.target.closest('select')) return;
    } catch {}
    e.preventDefault();
    openEditModal(part);
  }

  async function saveEdit() {
    if (!editTarget) {
      showEditModal = false;
      return;
    }
    try {
      const wasCOTS = editTarget?.workflow === 'purchase';
      const wantsCOTS = editType === 'COTS';

      // Find the corresponding build_bom row for synchronization
      let bomRow = null;
      if (editTarget._bom && editTarget.bom_id) {
        // This is a BOM placeholder, find the build_bom row
        bomRow = bomSnapshot.find(row => row.id === editTarget.bom_id);
      } else {
        // This is a created part, find the build_bom row by relation
        bomRow = bomSnapshot.find(row =>
          (row.parts_id === editTarget.id) ||
          (row.purchasing_id === editTarget.id) ||
          (row.kitting_id === editTarget.id)
        );
      }

      if (wasCOTS !== wantsCOTS) {
        const project_id = `${build?.subsystems?.name || 'Project'}-${build?.release_name || ''}`;
        if (wantsCOTS) {
          // Converting from manufactured to COTS - create purchasing entry
          const purchasingInsertData = {
            name: editTarget.name || editTarget.part_name || 'Unnamed Item',
            requester: user?.full_name || user?.email,
            project_id,
            quantity: editQuantity || editTarget.quantity || 1,
            material: editMaterial || editTarget.material || '',
            status: 'pending',
            vendor: editTarget.vendor || null,
            url: null,
            price: null,
            workflow: 'purchase'
          };
          const { data: pur, error: purErr } = await supabase.from('purchasing').insert([purchasingInsertData]).select();
          if (purErr) throw purErr;
          const newId = pur?.[0]?.id;
          if (newId) {
            // Update build_bom with the new relation
            if (bomRow) {
              await supabase.from('build_bom').update({
                purchasing_id: newId,
                parts_id: null,
                kitting_id: null
              }).eq('id', bomRow.id);
            }
          }
        } else {
          // Converting from COTS to manufactured - create parts entry
          const wf = editWorkflow && editWorkflow !== 'purchase' ? editWorkflow : 'mill';
          const baseInsert = {
            name: editTarget.name || editTarget.part_name || 'Unnamed Part',
            requester: user?.full_name || user?.email,
            project_id,
            workflow: wf,
            status: 'pending',
            quantity: editQuantity || editTarget.quantity || 1,
            material: editMaterial || editTarget.material || '',
            file_name: '',
            file_url: ''
          };
          const finalStock = (editStockChoice === '__other__') ? (editStockAssignmentCustom || editStockAssignment || null) : (editStockChoice || editStockAssignment || null);
          let partRow = null;
          let primaryError = null;
          try {
            const { data, error } = await supabase.from('parts').insert([{ ...baseInsert, stock_assignment: finalStock || null }]).select();
            if (error) primaryError = error; else partRow = data?.[0] || null;
          } catch (e) { primaryError = e; }
          if (!partRow) {
            if (primaryError && String(primaryError.message || primaryError).includes('stock_assignment') && String(primaryError.message || primaryError).includes('does not exist')) {
              const { data, error } = await supabase.from('parts').insert([baseInsert]).select();
              if (error) throw error;
              partRow = data?.[0] || null;
            } else if (primaryError) {
              throw primaryError;
            }
          }
          if (partRow?.id) {
            // Update build_bom with the new relation
            if (bomRow) {
              await supabase.from('build_bom').update({
                parts_id: partRow.id,
                purchasing_id: null,
                kitting_id: null
              }).eq('id', bomRow.id);
            }
          }
        }
        await loadBuildDetails();
        showEditModal = false;
        editTarget = null;
        return;
      }

      // Same type, just update existing entry
      if (editType === 'COTS') {
        const { error } = await supabase
          .from('purchasing')
          .update({
            material: editMaterial,
            quantity: editQuantity
          })
          .eq('id', editTarget.id);
        if (error) throw error;

        // Also update build_bom if we have a relation
        if (bomRow) {
          await supabase.from('build_bom').update({
            material: editMaterial,
            quantity: editQuantity
          }).eq('id', bomRow.id);
        }
      } else {
        // Try updating stock_assignment too; if column doesn't exist, retry without it
        let updateError = null;
        const baseUpdate = {
          workflow: editWorkflow || null,
          material: editMaterial,
          quantity: editQuantity
        };
        // Determine final stock value from choice/custom fields
        const finalStock = (editStockChoice === '__other__') ? (editStockAssignmentCustom || editStockAssignment || null) : (editStockChoice || editStockAssignment || null);
        try {
          const { error } = await supabase
            .from('parts')
            .update({
              ...baseUpdate,
              stock_assignment: finalStock
            })
            .eq('id', editTarget.id);
          if (error) updateError = error;
        } catch (e) {
          updateError = e;
        }
        if (updateError) {
          const msg = String(updateError.message || updateError);
          if (msg.includes('stock_assignment') && msg.includes('does not exist')) {
            const { error: e2 } = await supabase
              .from('parts')
              .update(baseUpdate)
              .eq('id', editTarget.id);
            if (e2) throw e2;
          } else {
            throw updateError;
          }
        }

        // Also update build_bom if we have a relation
        if (bomRow) {
          await supabase.from('build_bom').update({
            ...baseUpdate,
            stock_assignment: finalStock,
            stock_assignment_custom: editStockChoice === '__other__' ? (editStockAssignmentCustom || '') : null
          }).eq('id', bomRow.id);
        }
      }
      await loadBuildDetails();
    } catch (e) {
      console.error('Edit save failed:', e);
      alert('Failed to save changes');
    } finally {
      showEditModal = false;
      editTarget = null;
    }
  }

  async function removeBuildAssociation(partId) {
    try {
      // Normalize the incoming id to the probable DB type
      // parts/purchasing/kitting use bigint ids; build_bom stores those in columns parts_id, purchasing_id, kitting_id
      // If the id is a string that looks like a number, coerce to Number so the query matches correctly.
      const normalizedId = (typeof partId === 'string' && /^\d+$/.test(partId)) ? Number(partId) : partId;

      // Find any build_bom rows that reference this id so we can report them if clearing fails
      const { data: referencingRows, error: refErr } = await supabase.from('build_bom').select('id, parts_id, purchasing_id, kitting_id, build_id').or(
        `parts_id.eq.${normalizedId},purchasing_id.eq.${normalizedId},kitting_id.eq.${normalizedId}`
      );
      if (refErr) {
        console.warn('Error querying build_bom for references:', refErr);
      }

      // Attempt targeted clears only for the columns that actually reference this id
      // If there are any build_bom rows referencing this id, clear the specific
      // relation column and mark the BOM row as not added (added = false).
      // This intentionally does NOT block deletion of the parts/purchasing/kitting
      // row: we want to remove the created item while keeping the BOM row.
      if (referencingRows && referencingRows.length > 0) {
        const partsRefs = referencingRows.filter(r => r.parts_id === normalizedId).map(r => r.id);
        const purchRefs = referencingRows.filter(r => r.purchasing_id === normalizedId).map(r => r.id);
        const kitRefs = referencingRows.filter(r => r.kitting_id === normalizedId).map(r => r.id);

        async function clearBomRows(column, ids) {
          if (!ids || ids.length === 0) return;
          try {
            const patch = {};
            patch[column] = null;
            patch.added = false;
            const { error } = await supabase.from('build_bom').update(patch).in('id', ids);
            if (error) throw error;
          } catch (e) {
            // Log but don't block deletion; best-effort update to BOM rows
            console.warn(`Error clearing ${column} references in build_bom for ids ${ids}:`, e);
          }
        }

        await clearBomRows('parts_id', partsRefs);
        await clearBomRows('purchasing_id', purchRefs);
        await clearBomRows('kitting_id', kitRefs);
      }

      // Attempt deletion from each table; only one should match but trying all is safe.
      // If deletion fails due to lingering FK refs, the errors will be surfaced to the user.
      const { error: delPartsErr } = await supabase.from('parts').delete().eq('id', normalizedId);
      if (delPartsErr && String(delPartsErr.message || delPartsErr).toLowerCase().includes('foreign key')) {
        console.error('Failed to delete part due to foreign key:', delPartsErr);
        alert('Failed to delete part: ' + delPartsErr.message);
        return;
      }
      if (delPartsErr) console.warn('Non-critical error deleting from parts:', delPartsErr);

      const { error: delPurchErr } = await supabase.from('purchasing').delete().eq('id', normalizedId);
      if (delPurchErr && String(delPurchErr.message || delPurchErr).toLowerCase().includes('foreign key')) {
        console.error('Failed to delete purchasing due to foreign key:', delPurchErr);
        alert('Failed to delete purchasing entry: ' + delPurchErr.message);
        return;
      }
      if (delPurchErr) console.warn('Non-critical error deleting from purchasing:', delPurchErr);

      const { error: delKitErr } = await supabase.from('kitting').delete().eq('id', normalizedId);
      if (delKitErr && String(delKitErr.message || delKitErr).toLowerCase().includes('foreign key')) {
        console.error('Failed to delete kitting due to foreign key:', delKitErr);
        alert('Failed to delete kitting entry: ' + delKitErr.message);
        return;
      }
      if (delKitErr) console.warn('Non-critical error deleting from kitting:', delKitErr);

      // Reload the build details to reflect changes
      await loadBuildDetails();
    } catch (e) {
      console.error('Remove from build failed:', e);
      alert('Failed to remove from build: ' + (e?.message || e));
    }
  }

  // Full BOM (bottom table) - editing helpers
  function finalStockFromRow(item) {
    return item._stock_choice === '__other__'
      ? (item.stock_assignment_custom || item.stock_assignment || null)
      : (item._stock_choice || item.stock_assignment || null);
  }

  async function persistBomUpdate(itemId, patch) {
    try {
      const { error } = await supabase.from('build_bom').update(patch).eq('id', itemId);
      if (error) throw error;
    } catch (e) {
      console.error('Failed to persist BOM update:', e);
      alert('Failed to update BOM row: ' + (e?.message || e));
    }
  }

  function updateBomType(index, newType) {
    const item = bomSnapshot[index];
    if (!item) return;
    item.part_type = newType;
    if (newType === 'COTS') {
      item.workflow = 'purchase';
    } else {
      item.workflow = item.workflow && item.workflow !== 'purchase' ? item.workflow : 'mill';
    }
    bomSnapshot = [...bomSnapshot];
    persistBomUpdate(item.id, { part_type: item.part_type, workflow: item.workflow });
  }

  function updateBomWorkflow(index, newWorkflow) {
    const item = bomSnapshot[index];
    if (!item || item.part_type === 'COTS') return;
    item.workflow = newWorkflow;
    bomSnapshot = [...bomSnapshot];
    persistBomUpdate(item.id, { workflow: item.workflow });
  }

  // COTS workflow (Purchase vs Kit) selector in Full BOM
  function setCotsWorkflow(index, wf) {
    const item = bomSnapshot[index];
    if (!item || item.part_type !== 'COTS') return;
    item.workflow = (wf === 'kit') ? 'kit' : 'purchase';
    bomSnapshot = [...bomSnapshot];
    persistBomUpdate(item.id, { workflow: item.workflow });
  }

  function updateBomStockChoice(index, choice) {
    const item = bomSnapshot[index];
    if (!item || item.part_type === 'COTS') return;
    item._stock_choice = choice;
    if (choice && choice !== '__other__') {
      item.stock_assignment = choice;
      item.stock_assignment_custom = null;
    } else if (choice === '__other__') {
      item.stock_assignment = '';
      item.stock_assignment_custom = '';
    } else {
      item.stock_assignment = '';
      item.stock_assignment_custom = null;
    }
    bomSnapshot = [...bomSnapshot];
    const finalStock = finalStockFromRow(item);
    persistBomUpdate(item.id, { stock_assignment: finalStock, stock_assignment_custom: item._stock_choice === '__other__' ? (item.stock_assignment_custom || '') : null });
  }

  function updateBomCustomStock(index, value) {
    const item = bomSnapshot[index];
    if (!item || item.part_type === 'COTS') return;
    item.stock_assignment_custom = value;
    item.stock_assignment = value;
    item._stock_choice = '__other__';
    bomSnapshot = [...bomSnapshot];
    persistBomUpdate(item.id, { stock_assignment: value, stock_assignment_custom: value });
  }

  // Full BOM - Add action
  async function addFromFullBOM(item) {
    if (!item) return;
    if (processingAdd) return;
    processingAdd = true;
    try {
      const project_id = `${build?.subsystems?.name || 'Project'}-${build?.release_name || ''}`;

      if (item.part_type === 'COTS' && item.workflow === 'kit') {
        // Insert into kitting (in-stock COTS, just assign to bin later)
        const kittingInsertData = {
          name: item.part_name || item.part_number || 'Unnamed Item',
          requester: user?.full_name || user?.email,
          project_id,
          quantity: item.quantity || 1,
          status: 'pending',
          workflow: 'kit'
        };
        const { data: kit, error: kitErr } = await supabase
          .from('kitting')
          .insert([kittingInsertData])
          .select();
        if (kitErr) throw kitErr;
        const k = kit?.[0];

        if (k?.id) {
          // Update build_bom with the new relation
          await supabase.from('build_bom').update({
            kitting_id: k.id,
            added: true
          }).eq('id', item.id);
        }
      } else if (item.part_type === 'COTS' || item.workflow === 'purchase') {
        // Attempt vendor detection
        const detection = detectVendorFromString(item.vendor || item.part_name || item.part_number || '');
        
        const vendor = detection?.vendor || item.vendor || null;
        const rawUrl = buildVendorSearchUrl(detection);
        
        // Check if we have a valid, useful URL (not null and not ending with '=' which indicates no search term)
        const hasValidUrl = rawUrl && rawUrl.trim() !== '' && !rawUrl.endsWith('=');
        
        // Require a valid URL before inserting into purchasing; prompt when URL cannot be determined
        if (!hasValidUrl) {
          purchaseModalItem = { ...item, _buildId: buildId };
          purchaseModalUrl = '';
          purchaseModalPrice = '';
          showPurchaseModal = true;
          processingAdd = false;
          return;
        }
        
        // Insert into purchasing with validated URL
        const purchasingInsertData = {
          name: item.part_name || item.part_number || 'Unnamed Item',
          requester: user?.full_name || user?.email,
          project_id,
          quantity: item.quantity || 1,
          material: item.material || '',
          status: 'pending',
          vendor: vendor || null,
          url: rawUrl || null,
          price: null,
          workflow: 'purchase'
        };
        const { data: pur, error: purErr } = await supabase
          .from('purchasing')
          .insert([purchasingInsertData])
          .select();
        if (purErr) throw purErr;
        const p = pur?.[0];

        if (p?.id) {
          // Update build_bom with the new relation
          await supabase.from('build_bom').update({
            purchasing_id: p.id,
            added: true
          }).eq('id', item.id);
        }
      } else {
        // Insert into parts (manufactured)
        const wf = item.workflow || 'mill';
        const file_format =
          wf === '3d-print' ? 'stl' :
          (wf === 'laser-cut' || wf === 'lathe' || wf === 'mill' || wf === 'router') ? 'step' : 'step';

        const baseInsert = {
          name: item.part_name || item.part_number || 'Unnamed Part',
          requester: user?.full_name || user?.email,
          project_id,
          workflow: wf,
          status: 'pending',
          quantity: item.quantity || 1,
          material: item.material || '',
          file_name: '',
          file_url: ''
        };

        const stock_assignment_value = finalStockFromRow(item);

        let partRow = null;
        let primaryError = null;
        try {
          const withOnshape = {
            ...baseInsert,
            stock_assignment: stock_assignment_value || null,
            onshape_document_id: item.onshape_document_id || build?.subsystems?.onshape_document_id || null,
            onshape_wvm: item.onshape_wvm || 'v',
            onshape_wvmid: item.onshape_wvmid || build?.release_id || null,
            onshape_element_id: item.onshape_element_id || build?.subsystems?.onshape_element_id || null,
            onshape_part_id: item.onshape_part_id || null,
            file_format,
            is_onshape_part: !!(item.onshape_document_id || item.onshape_part_id)
          };
          const { data, error } = await supabase.from('parts').insert([withOnshape]).select();
          if (error) primaryError = error;
          else partRow = data?.[0] || null;
        } catch (e) {
          primaryError = e;
        }

        if (!partRow) {
          if (primaryError && String(primaryError.message || primaryError).includes('stock_assignment') && String(primaryError.message || primaryError).includes('does not exist')) {
            // Retry without stock_assignment
            const withOnshapeNoStock = {
              ...baseInsert,
              onshape_document_id: item.onshape_document_id || build?.subsystems?.onshape_document_id || null,
              onshape_wvm: item.onshape_wvm || 'v',
              onshape_wvmid: item.onshape_wvmid || build?.release_id || null,
              onshape_element_id: item.onshape_element_id || build?.subsystems?.onshape_element_id || null,
              onshape_part_id: item.onshape_part_id || null,
              file_format,
              is_onshape_part: !!(item.onshape_document_id || item.onshape_part_id)
            };
            const { data, error } = await supabase.from('parts').insert([withOnshapeNoStock]).select();
            if (error) throw error;
            partRow = data?.[0] || null;
          } else {
            // fallback to basic insert
            const { data, error } = await supabase.from('parts').insert([baseInsert]).select();
            if (error) throw error;
            partRow = data?.[0] || null;
          }
        }

        if (partRow?.id) {
          // Update build_bom with the new relation
          await supabase.from('build_bom').update({
            parts_id: partRow.id,
            added: true
          }).eq('id', item.id);
        }
      }

      await loadBuildDetails();
    } catch (e) {
      console.error('Add from Full BOM failed:', e);
      alert('Failed to add item to build: ' + (e?.message || e));
    } finally {
      processingAdd = false;
    }
  }

  async function confirmAddToPurchasingFromModal() {
    if (!purchaseModalItem) return;
    showPurchaseModal = false;
    
    const project_id = `${build?.subsystems?.name || 'Project'}-${build?.release_name || ''}`;
    
    try {
      // Insert into purchasing with user-provided URL and price
      const purchasingInsertData = {
        name: purchaseModalItem.part_name || purchaseModalItem.part_number || 'Unnamed Item',
        requester: user?.full_name || user?.email,
        project_id,
        quantity: purchaseModalItem.quantity || 1,
        material: purchaseModalItem.material || '',
        status: 'pending',
        vendor: purchaseModalItem.vendor || null,
        url: purchaseModalUrl && purchaseModalUrl.trim() !== '' ? purchaseModalUrl.trim() : null,
        price: purchaseModalPrice && purchaseModalPrice !== '' ? Number(purchaseModalPrice) : null,
        workflow: 'purchase'
      };
      
      const { data: pur, error: purErr } = await supabase
        .from('purchasing')
        .insert([purchasingInsertData])
        .select();
      if (purErr) throw purErr;
      
      const p = pur?.[0];
      if (p?.id) {
        // Update build_bom with the new relation
        await supabase.from('build_bom').update({
          purchasing_id: p.id,
          added: true
        }).eq('id', purchaseModalItem.id);
      }

      await loadBuildDetails();
      alert('Added to purchasing successfully!');
      
    } catch (e) {
      console.error('Failed to add from purchase modal:', e);
      alert('Failed to add to purchasing: ' + (e?.message || e));
    } finally {
      purchaseModalItem = null;
      purchaseModalUrl = '';
      purchaseModalPrice = '';
    }
  }

  // Version refetch functionality
  async function openVersionSelector() {
    if (!build?.subsystems?.onshape_document_id) {
      alert('No OnShape document linked to this subsystem');
      return;
    }
    
    showVersionModal = true;
    loadingVersions = true;
    
    try {
      const { onShapeAPI } = await import('$lib/onshape.js');
      const allVersions = await onShapeAPI.getDocumentVersions(build.subsystems.onshape_document_id);
      
      if (!Array.isArray(allVersions)) {
        console.warn('Invalid versions response');
        versionTimeline = [];
        return;
      }
      
      // Take the last 15 versions (newest first)
      const sortedVersions = allVersions.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      const recentVersions = sortedVersions.slice(0, 15);
      
      versionTimeline = recentVersions.map(version => ({
        ...version,
        type: 'version',
        date: new Date(version.createdAt)
      }));
      
    } catch (error) {
      console.error('Error loading versions:', error);
      alert('Failed to load versions: ' + (error?.message || error));
    } finally {
      loadingVersions = false;
    }
  }

  async function refetchBOMFromVersion() {
    if (!selectedVersionForRefetch) {
      alert('Please select a version');
      return;
    }
    
    if (!build?.subsystems?.onshape_document_id || !build?.subsystems?.onshape_workspace_id || !build?.subsystems?.onshape_element_id) {
      alert('Missing OnShape configuration for this build');
      return;
    }
    
    try {
      loadingVersions = true;
      
      // Import OnShape API
      const { onShapeAPI } = await import('$lib/onshape.js');
      
      // Get BOM from OnShape using the selected version ID
      const bom = await onShapeAPI.getAssemblyBOM(
        build.subsystems.onshape_document_id,
        build.subsystems.onshape_workspace_id,
        build.subsystems.onshape_element_id,
        selectedVersionForRefetch.id
      );
      
      // Analyze BOM
      const newBOM = await onShapeAPI.analyzeBOM(bom, build.subsystems.onshape_workspace_id);
      
      // Get list of already added parts (crosscheck by name and part_number)
      const addedParts = bomSnapshot.filter(row => row.added === true);
      const addedIdentifiers = new Set();
      
      addedParts.forEach(part => {
        if (part.part_name) addedIdentifiers.add(part.part_name.toLowerCase().trim());
        if (part.part_number) addedIdentifiers.add(part.part_number.toLowerCase().trim());
      });
      
      // Filter out parts that already exist in the build
      const filteredNewBOM = newBOM.filter(newPart => {
        const name = (newPart.part_name || '').toLowerCase().trim();
        const partNum = (newPart.part_number || '').toLowerCase().trim();
        
        // If either name or part_number matches an existing part, discard this entry
        if (name && addedIdentifiers.has(name)) return false;
        if (partNum && addedIdentifiers.has(partNum)) return false;
        
        return true;
      });
      
      // Insert new BOM entries into build_bom table (marked as not added)
      if (filteredNewBOM.length > 0) {
        const bomInserts = filteredNewBOM.map(part => ({
          build_id: buildId,
          part_name: part.part_name || 'Unnamed Part',
          part_number: part.part_number || null,
          part_type: part.part_type || 'manufactured',
          workflow: part.workflow || 'mill',
          quantity: part.quantity || 1,
          material: part.material || '',
          stock_assignment: part.stock_assignment || null,
          stock_assignment_custom: part.stock_assignment_custom || null,
          onshape_document_id: part.onshape_document_id || null,
          onshape_wvm: 'v',
          onshape_wvmid: selectedVersionForRefetch.id,
          onshape_element_id: part.onshape_element_id || null,
          onshape_part_id: part.onshape_part_id || null,
          added: false
        }));
        
        const { error: insertError } = await supabase
          .from('build_bom')
          .insert(bomInserts);
        
        if (insertError) throw insertError;
        
        // Reload build details to show new BOM entries
        await loadBuildDetails();
        
        alert(`Added ${filteredNewBOM.length} new parts to BOM (${newBOM.length - filteredNewBOM.length} duplicates skipped)`);
      } else {
        alert('No new parts to add - all parts from this version are already in the build');
      }
      
      showVersionModal = false;
      selectedVersionForRefetch = null;
      
    } catch (error) {
      console.error('Error refetching BOM:', error);
      alert('Failed to refetch BOM: ' + (error?.message || error));
    } finally {
      loadingVersions = false;
    }
  }

</script>

<svelte:head>
  <title>Build Details - {build?.subsystems?.name || 'Unknown'} {build?.release_name || ''} - 971 Hub</title>
</svelte:head>

<div class="main-content">
  {#if loading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading build details...</p>
    </div>
  {:else if build}
    <div class="page-header">
      <div class="header-content">
        <div class="header-left">
          <div class="header-actions">
            <button class="back-button" on:click={() => goto('/cad/build')}>
              <ArrowLeft size={16} />
              Back to Builds
            </button>
            {#if build.subsystems?.onshape_url}
              <a href={build.subsystems.onshape_url} target="_blank" class="btn btn-secondary btn-sm">
                <ExternalLink size={16} />
                View CAD
              </a>
            {/if}
          </div>
          <div class="header-info">
            <h1>
              <Package size={32} />
              {build.subsystems?.name || 'Unknown Subsystem'} - {build.release_name}
            </h1>
            <p class="build-hash">Build #{build.build_hash?.split('_')[1] || build.id.substring(0, 8)}</p>
            <div class="build-meta">
              <span>Created: {new Date(build.created_at).toLocaleDateString()}</span>
              {#if build.assembled_at}
                <span>Assembled: {new Date(build.assembled_at).toLocaleDateString()}</span>
              {/if}
              {#if build.project_id}
                <span>{projectBuilds.length} builds • {projectPartsCount} parts • Total cost: ${projectTotalCost.toFixed(2)}</span>
              {/if}
            </div>
          </div>
        </div>
        <div class="header-right">
          {#if build.status !== 'assembled'}
            {@const progress = getBuildProgress()}
            {#if progress.status === 'Ready to Assemble'}
              <button class="btn btn-success btn-sm" on:click={markAsAssembled}>
                <CheckCircle size={16} />
                Mark as Assembled
              </button>
            {/if}
          {/if}
        </div>
      </div>
    </div>

    <div class="status-section">
      <div class="status-card status-{build.status}">
        <div class="status-header">
          <span class="status-title">Parts</span>
          <span class="flag flag-{build.status}">
            {#if build.status === 'pending'}
              <Clock size={14} /> Pending
            {:else if build.status === 'manufacturing'}
              <Wrench size={14} /> in progress
            {:else if build.status === 'ready_to_assemble'}
              <CheckCircle size={14} /> Ready to Assemble
            {:else if build.status === 'assembled'}
              <CheckCircle size={14} /> Assembled
            {/if}
          </span>
        </div>
        {#if build}
          {@const progress = getBuildProgress()}
          <div class="progress-section">
            <div class="progress-row">
              <span class="progress-label">Manufacturing</span>
              <div class="progress-bar">
                <div class="progress-fill mfg" style="width: {progress.mfgPercent}%"></div>
              </div>
              <span class="progress-count">{progress.mfgCount.complete}/{progress.mfgCount.total}</span>
            </div>
            <div class="progress-row">
              <span class="progress-label">Purchasing</span>
              <div class="progress-bar">
                <div class="progress-fill pur" style="width: {progress.purPercent}%"></div>
              </div>
              <span class="progress-count">{progress.purCount.complete}/{progress.purCount.total}</span>
            </div>
            <div class="progress-row">
              <span class="progress-label">Kitting</span>
              <div class="progress-bar">
                <div class="progress-fill kit" style="width: {progress.kitPercent}%"></div>
              </div>
              <span class="progress-count">{progress.kitCount.complete}/{progress.kitCount.total}</span>
            </div>
          </div>
        {/if}
      </div>
    </div>

    <!-- Build Components on top - Added Parts Only -->
    <div class="bom-section">
      <div class="parts-header">
        <h2>Build Components (Added Parts)</h2>
        <div class="legend">
          <span class="legend-item"><span class="dot manufactured"></span>Manufactured</span>
          <span class="legend-item"><span class="dot cots"></span>COTS</span>
        </div>
      </div>
      {#if build.parts || build.purchasing}
        {@const allParts = [...(build.parts || []), ...(build.purchasing || []), ...(build.kitting || [])]}
        {#if allParts.length > 0}
          <div class="bom-table-container">
            <table class="bom-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Type</th>
                  <th>Workflow</th>
                  <th>Qty</th>
                  <th>Status</th>
                  <th>Kitting</th>
                </tr>
              </thead>
              <tbody>
                {#each allParts as part, i}
                  <tr
                    class="row {i % 2 === 0 ? 'even' : 'odd'}"
                    on:click={(e) => onRowClick(e, part)}
                    on:keydown={(e) => onRowKeyDown(e, part)}
                    role="button"
                    tabindex="0"
                    style="cursor: pointer;"
                  >
                    <td class="part-name">
                      <div class="name-cell">
                        <div class="avatar">
                          <Package size={14} />
                        </div>
                        <div class="name-wrap">
                          <div class="name">{part.name || part.part_name || 'Unnamed Part'}</div>
                          {#if part.part_number}
                            <div class="part-number">{part.part_number}</div>
                          {/if}
                        </div>
                      </div>
                    </td>
                    <td>
                      <span class="chip {(part.workflow === 'purchase' || part.workflow === 'kit') ? 'chip-cots' : 'chip-mfg'}">
                        {(part.workflow === 'purchase' || part.workflow === 'kit') ? 'COTS' : 'Manufactured'}
                      </span>
                    </td>
                    <td>
                      <span class="chip chip-neutral">
                        {part.workflow || 'N/A'}
                      </span>
                    </td>
                    <td class="quantity">{part.quantity || 1}</td>
                    <td>
                      {#if part.workflow === 'router' && part.status === 'pending'}
                        <button
                          class="btn btn-secondary btn-sm"
                          on:click={async () => {
                            await supabase.from('parts').update({ status: 'cammed', updated_at: new Date().toISOString() }).eq('id', part.id);
                            await loadBuildDetails();
                          }}
                          title={BUTTONS.CAM_REVIEWED}
                        >
                          {BUTTONS.CAM_REVIEWED}
                        </button>
                      {:else}
                        <span class="chip {part.status ? `chip-status-${part.status}` : 'chip-neutral'}">
                          {#if part.status === 'pending'}
                            <Clock size={12} />
                          {:else if part.status === 'in-progress' || part.status === 'cammed'}
                            <Wrench size={12} />
                          {:else if part.status === 'ordered'}
                            <Package size={12} />
                          {:else if part.status === 'delivered' || part.status === 'complete' || part.status === 'manufactured' || part.status === 'kitted'}
                            <CheckCircle size={12} />
                          {:else}
                            <Clock size={12} />
                          {/if}
                          <span>{part.status || 'unknown'}</span>
                        </span>
                      {/if}
                    </td>
                    <td class="kitting">
                      {#if part.kitting_bin}
                        <div class="kitting-location">
                          <MapPin size={14} />
                          {part.kitting_bin}
                        </div>
                      {:else}
                        <span class="no-kitting">Not assigned</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        {:else}
          <div class="empty-state">
            <Package size={48} />
            <h3>No Parts in This Build</h3>
            <p>No parts have been added to this build yet.</p>
          </div>
        {/if}
      {:else}
        <div class="empty-state">
          <Package size={48} />
          <h3>No Parts in This Build</h3>
          <p>No parts have been added to this build yet.</p>
        </div>
      {/if}
    </div>

    <!-- Full BOM below - Unadded Parts Only -->
    <div class="bom-section">
      <div class="parts-header">
        <h2>Full BOM (Unadded Parts)</h2>
        <div style="display: flex; align-items: center; gap: 1rem;">
          <button class="btn btn-secondary btn-sm" on:click={openVersionSelector}>
            <Download size={16} />
            Change Version
          </button>
          <div class="legend">
            <span class="legend-item"><span class="dot manufactured"></span>Manufactured</span>
            <span class="legend-item"><span class="dot cots"></span>COTS</span>
          </div>
        </div>
      </div>
      {#if bomSnapshot && bomSnapshot.length > 0}
        {@const unaddedParts = bomSnapshot.filter(item => !item.added && !item.parts_id && !item.purchasing_id && !item.kitting_id)}
        {#if unaddedParts.length > 0}
        <div class="bom-table-container">
          <table class="bom-table">
            <thead>
              <tr>
                <th>Part</th>
                <th>Type</th>
                <th>Workflow</th>
                <th>Qty</th>
                <th>Stock</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {#each unaddedParts as item, i}
                {@const actualIndex = bomSnapshot.findIndex(b => b.id === item.id)}
                <tr class="row {i % 2 === 0 ? 'even' : 'odd'}">
                  <td class="part-name">
                    <div class="name-cell">
                      <div class="avatar">
                        <Package size={14} />
                      </div>
                      <div class="name-wrap">
                        <div class="name">{item.part_name || 'Unnamed Part'}</div>
                        {#if item.part_number}
                          <div class="part-number">{item.part_number}</div>
                        {/if}
                      </div>
                    </div>
                  </td>
                  <td>
                    <select
                      class="type-dropdown {item.part_type === 'COTS' ? 'type-cots' : 'type-manufactured'}"
                      value={item.part_type}
                      on:change={(e) => updateBomType(actualIndex, e.target.value)}
                    >
                      <option value="COTS">COTS</option>
                      <option value="manufactured">Manufactured</option>
                      <option value="other">Other</option>
                    </select>
                  </td>
                  <td>
                    {#if item.part_type === 'COTS'}
                      <select
                        class="workflow-dropdown workflow-{item.workflow || 'purchase'}"
                        value={item.workflow || 'purchase'}
                        on:change={(e) => setCotsWorkflow(actualIndex, e.target.value)}
                      >
                        <option value="purchase">Purchase</option>
                        <option value="kit">Kit</option>
                      </select>
                    {:else}
                      <select
                        class="workflow-dropdown workflow-{item.workflow || 'mill'}"
                        value={item.workflow || 'mill'}
                        on:change={(e) => updateBomWorkflow(actualIndex, e.target.value)}
                      >
                        <option value="3d-print">3D Print</option>
                        <option value="laser-cut">Laser Cut</option>
                        <option value="lathe">Lathe</option>
                        <option value="mill">Mill</option>
                        <option value="router">Router</option>
                      </select>
                    {/if}
                  </td>
                  <td class="quantity">{item.quantity || 1}</td>
                  <td class="material">
                    {#if item.part_type !== 'COTS'}
                      <select on:change={(e) => updateBomStockChoice(actualIndex, e.target.value)} value={item._stock_choice || item.stock_assignment || ''}>
                        <option value="">Select Stock</option>
                        {#each getStocksForWorkflow(item.workflow || 'mill') as stock}
                          <option value={stock.description}>{stock.description}</option>
                        {/each}
                        <option value="__other__">Other...</option>
                      </select>
                      {#if item._stock_choice === '__other__'}
                        <div style="margin-top:0.35rem;">
                          <input class="form-input" type="text" placeholder="Type custom stock" value={item.stock_assignment_custom || ''} on:input={(e) => updateBomCustomStock(actualIndex, e.target.value)} />
                        </div>
                      {/if}
                    {:else}
                      <span class="no-stock">-</span>
                    {/if}
                  </td>
                  <td>
                    <button
                      class="btn btn-sm btn-yellow add-btn"
                      on:click={() => addFromFullBOM(item)}
                      disabled={(item.parts_id || item.purchasing_id || item.kitting_id) || processingAdd}
                    >
                      {#if item.parts_id || item.purchasing_id || item.kitting_id}
                        <CheckCircle size={14} />
                        Added
                      {:else}
                        <Plus size={14} />
                        Add
                      {/if}
                    </button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
        {:else}
          <div class="empty-state">
            <Package size={48} />
            <h3>No Unadded Parts in BOM</h3>
            <p>All BOM items have been added to the build, or you can load a new version.</p>
          </div>
        {/if}
      {:else}
        <div class="empty-state">
          <Package size={48} />
          <h3>No BOM Snapshot</h3>
          <p>The BOM snapshot for this build does not contain items yet. Click "Change Version" to load a BOM.</p>
        </div>
      {/if}
    </div>
  {:else}
    <div class="error-container">
      <h2>Build Not Found</h2>
      <p>The requested build could not be found.</p>
      <button class="btn btn-primary btn-sm" on:click={() => goto('/cad/build')}>
        <ArrowLeft size={16} />
        Back to Builds
      </button>
    </div>
  {/if}
</div>

{#if showEditModal}
  <div class="modal-backdrop" role="presentation" tabindex="-1" on:click={() => { showEditModal = false; editTarget = null; }}></div>
  <div
    class="modal"
    role="dialog"
    aria-modal="true"
    tabindex="0"
    on:click|stopPropagation
    on:keydown={(e) => { if (e.key === 'Escape') { showEditModal = false; editTarget = null; } }}
  >
    <h3>Edit Build Item</h3>
    <div class="modal-row">
      <label for="edit-type">Type</label>
      <select id="edit-type" bind:value={editType} on:change={() => { if (editType === 'COTS') editWorkflow = 'purchase'; else if (!editWorkflow || editWorkflow === 'purchase') editWorkflow = 'mill'; }}>
        <option value="manufactured">Manufactured</option>
        <option value="COTS">COTS</option>
      </select>
    </div>
    <div class="modal-row">
      <label for="edit-workflow">Workflow</label>
      {#if editType === 'COTS'}
        <input id="edit-workflow" class="form-input" type="text" value="Purchase" readonly disabled />
      {:else}
        <select id="edit-workflow" class="workflow-dropdown workflow-{editWorkflow || 'mill'}" bind:value={editWorkflow}>
          <option value="3d-print">3D Print</option>
          <option value="laser-cut">Laser Cut</option>
          <option value="lathe">Lathe</option>
          <option value="mill">Mill</option>
          <option value="router">Router</option>
        </select>
      {/if}
    </div>
    <div class="modal-row">
      <label for="edit-stock">Stock</label>
      {#if editType === 'COTS'}
        <input id="edit-stock" class="form-input" type="text" value="-" readonly disabled />
      {:else}
        <div style="display:flex;flex-direction:column;gap:0.5rem;">
          <select id="edit-stock" on:change={(e) => editStockChoice = e.target.value} value={editStockChoice || editStockAssignment}>
            <option value="">Select Stock</option>
            {#each getStocksForWorkflow(editWorkflow || 'mill') as stock}
              <option value={stock.description}>{stock.description}</option>
            {/each}
            <option value="__other__">Other...</option>
          </select>
          {#if (editStockChoice === '__other__' || (!editStockChoice && typeof editStockAssignmentCustom !== 'undefined' && editStockAssignmentCustom !== null))}
            <input id="edit-stock-custom" class="form-input" type="text" placeholder="Type custom stock" bind:value={editStockAssignmentCustom} />
          {/if}
        </div>
      {/if}
    </div>
    <div class="modal-row">
      <label for="edit-material">Material</label>
      <input id="edit-material" class="form-input" type="text" bind:value={editMaterial} readonly title="Material is read-only" />
    </div>
    <div class="modal-row">
      <label for="edit-quantity">Quantity</label>
      <input id="edit-quantity" class="form-input" type="number" min="1" step="1" bind:value={editQuantity} />
    </div>
    <div class="modal-actions">
      <button class="btn btn-outline-danger" on:click={() => { removeBuildAssociation(editTarget.id); showEditModal = false; editTarget = null; }}>Delete</button>
      <div style="flex:1"></div>
      <button class="btn" on:click={() => { showEditModal = false; editTarget = null; }}>Cancel</button>
      <button class="btn btn-yellow" on:click={saveEdit}>Save</button>
    </div>
  </div>
{/if}

<!-- Purchase Link/Price Modal (when auto-detect fails) -->
{#if showPurchaseModal}
  <div class="modal-backdrop" role="presentation" tabindex="-1" on:click={() => { showPurchaseModal = false; purchaseModalItem = null; }}></div>
  <div class="modal" role="dialog" aria-modal="true" tabindex="0" on:click|stopPropagation on:keydown={(e) => { if (e.key === 'Escape') { showPurchaseModal = false; purchaseModalItem = null; } }}>
    <h3>Provide vendor link and unit price</h3>
    <p>Please supply a vendor URL and unit price for <strong>{purchaseModalItem?.part_name || purchaseModalItem?.part_number || 'this part'}</strong></p>
    <div style="display:flex; flex-direction:column; gap:0.5rem;">
      <label for="purchase-url">Vendor URL:</label>
      <input id="purchase-url" class="form-input" type="url" placeholder="https://..." bind:value={purchaseModalUrl} />

      <label for="purchase-price">Unit Price (optional):</label>
      <input id="purchase-price" class="form-input" type="number" step="0.01" min="0" placeholder="0.00" bind:value={purchaseModalPrice} />
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => { showPurchaseModal = false; purchaseModalItem = null; }}>Cancel</button>
      <button class="btn btn-yellow" on:click={confirmAddToPurchasingFromModal}>Add to Purchasing</button>
    </div>
  </div>
{/if}

<!-- Version Selector Modal -->
{#if showVersionModal}
  <div class="modal-backdrop" role="presentation" tabindex="-1" on:click={() => { showVersionModal = false; selectedVersionForRefetch = null; }}></div>
  <div class="modal version-modal" role="dialog" aria-modal="true" tabindex="0" on:click|stopPropagation on:keydown={(e) => { if (e.key === 'Escape') { showVersionModal = false; selectedVersionForRefetch = null; } }}>
    <h3>Select Version to Load BOM</h3>
    <p style="color: #666; margin-bottom: 1rem;">Choose a version to fetch its BOM. Parts already added will be skipped.</p>
    
    {#if loadingVersions}
      <div style="display: flex; flex-direction: column; align-items: center; padding: 2rem; gap: 1rem;">
        <div class="loading-spinner"></div>
        <p>Loading versions...</p>
      </div>
    {:else if versionTimeline.length > 0}
      <div class="version-timeline" style="max-height: 400px; overflow-y: auto; margin-bottom: 1rem;">
        {#each versionTimeline as version}
          <div 
            class="version-item {selectedVersionForRefetch?.id === version.id ? 'selected' : ''}"
            on:click={() => selectedVersionForRefetch = version}
            on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectedVersionForRefetch = version; } }}
            role="button"
            tabindex="0"
          >
            <div class="version-info">
              <div class="version-name">{version.name || `Version ${version.id.substring(0, 8)}`}</div>
              <div class="version-date">{new Date(version.date).toLocaleDateString()} at {new Date(version.date).toLocaleTimeString()}</div>
            </div>
            {#if selectedVersionForRefetch?.id === version.id}
              <div class="version-checkmark">✓</div>
            {/if}
          </div>
        {/each}
      </div>
    {:else}
      <div style="padding: 2rem; text-align: center; color: #666;">
        <p>No versions available</p>
      </div>
    {/if}
    
    <div class="modal-actions">
      <button class="btn" on:click={() => { showVersionModal = false; selectedVersionForRefetch = null; }}>Cancel</button>
      <button 
        class="btn btn-yellow" 
        on:click={refetchBOMFromVersion}
        disabled={!selectedVersionForRefetch || loadingVersions}
      >
        {loadingVersions ? 'Loading...' : 'Load BOM from Version'}
      </button>
    </div>
  </div>
{/if}

<style>
  /* Make this section invisible (no padding/border), full width like BOM */
  .bom-section { display: block; }

  /* Modal styles (match BOM route) */
  .modal-backdrop {
    position: fixed !important;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.4);
    z-index: 2147483646 !important;
    display: block !important;
    pointer-events: auto !important;
  }
  .modal {
    position: fixed !important;
    top: 50%; left: 50%;
    transform: translate(-50%, -50%) !important;
    background: #fff;
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    width: min(560px, 92vw);
    z-index: 2147483647 !important;
    box-shadow: 0 10px 30px rgba(0,0,0,0.15);
    display: block !important;
    pointer-events: auto !important;
  }
  .modal-row {
    display: grid;
    grid-template-columns: 120px 1fr;
    align-items: center;
    gap: 0.75rem;
    margin: 0.5rem 0;
  }
  /* Control sizing/padding/radius handled globally in src/app.css */
  .form-input {
    width: 100%;
    border: 1px solid var(--border);
  }
  .modal-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
    margin-top: 0.75rem;
  }
  .main-content { max-width: 1440px; margin: 0 auto; padding: 1.25rem; }
  .loading-container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; gap: 1rem; }
  .loading-spinner { width: 40px; height: 40px; border: 3px solid var(--border); border-top: 3px solid #FFD700; border-radius: 50%; animation: spin 1s linear infinite; }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }
  .page-header { margin-bottom: 1rem; }
  .header-content { display: flex; align-items: flex-start; justify-content: space-between; gap: 1rem; }
  .header-left { flex: 1; }
  .header-right { display: flex; align-items: center; gap: 0.5rem; }
  .header-actions { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.5rem; }
  .back-button { display: inline-flex; align-items: center; gap: 0.5rem; padding: 0.375rem 0.75rem; background: var(--background); border: 1px solid var(--border); border-radius: 6px; color: var(--text); font-size: 0.85rem; }
  .header-info h1 { display: flex; align-items: center; gap: 0.5rem; margin: 0 0 0.5rem 0; color: var(--text); font-size: 1.6rem; font-weight: 600; }
  .build-hash { margin: 0.25rem 0; color: var(--secondary); font-family: monospace; font-size: 0.9rem; }
  .build-meta { display: flex; gap: 1rem; margin-top: 0.25rem; font-size: 0.85rem; color: var(--secondary); }
  .project-banner { margin-top:0.5rem; background:#f8fafc; padding:0.5rem; border-radius:6px; display:flex; align-items:center; gap:1rem; }
  .project-cost { color:#333; font-weight:600; }
  .project-builds { margin-top:0.5rem; display:flex; flex-direction:column; gap:0.25rem; }
  .project-build-row { display:flex; align-items:center; justify-content:space-between; gap:0.5rem; }
  .project-build-progress { display:flex; align-items:center; gap:0.5rem; }
  .progress-bar.small { width:160px; height:8px; background:#eef2f7; border-radius:999px; overflow:hidden; }
  .project-build-cost { font-family: ui-monospace, monospace; font-size:0.9rem; color:#444; }
  .status-section { margin-bottom: 1rem; }
  .status-card { background: white; border: 1px solid var(--border); border-radius: 8px; padding: 1rem; }
  .status-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .status-title { font-size: 1.1rem; font-weight: 600; color: var(--text); }
  .flag { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.375rem 0.75rem; height: 32px; border-radius: 4px; font-size: 0.8125rem; font-weight: 600; border: 1px solid transparent; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; flex: 0 1 280px; box-sizing: border-box; min-width: 0; margin-left: auto; }
  .flag.flag-pending { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .flag.flag-manufacturing { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .flag.flag-ready_to_assemble { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
  .flag.flag-assembled { background: #e8f6ef; color: #11642a; border-color: #a7e0c1; }
  .progress-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .progress-row { display: grid; grid-template-columns: 110px 1fr auto; align-items: center; gap: 0.5rem; }
  .progress-label { font-size: 0.85rem; color: var(--secondary); }
  .progress-count { font-size: 0.85rem; color: #666; }
  .progress-bar { width: 100%; height: 10px; background: #f0f0f0; border-radius: 5px; overflow: hidden; }
  .progress-fill { height: 100%; transition: width 0.3s ease; }
  .progress-fill.mfg { background: linear-gradient(90deg, #27ae60, #2ecc71); }
  .progress-fill.pur { background: linear-gradient(90deg, #ffd54f, #ffb300); }
  .progress-fill.kit { background: linear-gradient(90deg, #9fa8da, #5c6bc0); }
  .parts-section { background: white; border: 1px solid var(--border); border-radius: 12px; padding: 1rem; margin-bottom: 1.25rem; }
  .parts-header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; }
  .legend { display: flex; gap: 1rem; color: #666; font-size: 0.85rem; }
  .legend-item { display: inline-flex; align-items: center; gap: 0.4rem; }
  .dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; }
  .dot.manufactured { background: #e3f2fd; border: 1px solid #90caf9; }
  .dot.cots { background: #fff8e1; border: 1px solid #ffcc02; }
  .dot.other { background: #f3f4f6; border: 1px solid #e5e7eb; }
  /* removed unused .parts-table styles */
  .part-name { font-weight: 500; }
  .name-cell { display: flex; align-items: center; gap: 0.65rem; }
  .avatar { width: 26px; height: 26px; border-radius: 6px; background: #f3f4f6; display: inline-flex; align-items: center; justify-content: center; color: #6b7280; border: 1px solid #e5e7eb; }
  .name-wrap { display: flex; flex-direction: column; }
  .name-cell .name { font-weight: 600; color: var(--text); }
  .name-cell .part-number { font-size: 0.78rem; color: #6b7280; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace; }
  .chip { display: inline-flex; align-items: center; gap: 0.35rem; padding: 0.375rem 0.75rem; height: 32px; border-radius: 4px; font-size: 0.8125rem; font-weight: 500; border: 1px solid transparent; white-space: nowrap; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  @media (max-width: 520px) { .flag { flex-basis: 200px; } }
  .chip-mfg { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .chip-cots { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .chip-neutral { background: #f3f4f6; color: #374151; border-color: #e5e7eb; }
  .chip-status-pending { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .chip-status-in-progress, .chip-status-cammed { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .chip-status-ordered { background: #eef7ff; color: #0f609b; border-color: #b6e0fe; }
  .chip-status-delivered, .chip-status-complete, .chip-status-manufactured { background: #e8f6ef; color: #11642a; border-color: #a7e0c1; }
  .quantity { text-align: center; font-weight: 600; color: #111827; }
  .material { color: #4b5563; }
  .kitting { color: #4b5563; }
  .kitting-location { display: inline-flex; align-items: center; gap: 0.35rem; color: var(--success); font-weight: 500; }
  .no-kitting { color: #999; font-style: italic; }
  .date { color: #6b7280; font-size: 0.85rem; }
  .error-container { display: flex; flex-direction: column; align-items: center; justify-content: center; min-height: 60vh; text-align: center; gap: 1rem; }
  :root { --primary: #ffffff; --secondary: #6c757d; --accent: #FFD700; --background: #f8f9fa; --surface: #ffffff; --border: #e1e5e9; --text: #2c3e50; --success: #27ae60; --warning: #f39c12; --danger: #e74c3c; }
  .bom-table-container { overflow-x: auto; border: 1px solid var(--border); border-radius: 8px; }
  .bom-table { width: 100%; border-collapse: collapse; font-size: 0.875rem; }
  .bom-table th, .bom-table td { padding: 0.75rem; text-align: left; border-bottom: 1px solid var(--border); }
  .bom-table th { background: var(--background); font-weight: 600; color: var(--text); }
  .bom-table .table-row,
  .bom-table tbody tr.row,
  .bom-table tbody tr.row.even,
  .bom-table tbody tr.row.odd {
    background: #fff;
  }
  .bom-table tr:hover { background: #f8f9fa; }
  .bom-table tbody tr:last-child td {
    border-bottom: none;
  }
  .part-description { font-size: 0.75rem; color: var(--secondary); margin-top: 0.25rem; }
  .workflow-purchase { background: #fff8e1; color: #f57f17; border-color: #ffcc02; }
  .no-data { color: var(--secondary); font-style: italic; }
  .btn-yellow { background: #FFD700; color: #333; }
  .btn-yellow:hover { background: #FFC107; }
  .btn-outline-danger { background: #fff5f5; color: #e74c3c; border: 1px solid #e74c3c; }
  .btn-outline-danger:hover { background: #ffe8e8; }
  .add-btn { min-width: 80px; }
  .type-dropdown { border: 1px solid var(--border); background: white; cursor: pointer; }
  .type-cots { background: #fff8e1 !important; color: #f57f17 !important; border-color: #ffcc02 !important; }
  .type-manufactured { background: #e1f5fe !important; color: #0277bd !important; border-color: #81d4fa !important; }
  .bounding-box { font-family: monospace; font-size: 0.75rem; }
  .no-stock { color: var(--secondary); font-style: italic; }
  .workflow-dropdown { border: 1px solid var(--border); background: var(--background); color: var(--text); cursor: pointer; }
  .workflow-dropdown.workflow-3d-print { background: #e3f2fd; color: #1565c0; border-color: #90caf9; }
  .workflow-dropdown.workflow-laser-cut { background: #fff3e0; color: #ef6c00; border-color: #ffcc02; }
  .workflow-dropdown.workflow-lathe { background: #f3e5f5; color: #7b1fa2; border-color: #ce93d8; }
  .workflow-dropdown.workflow-mill { background: #e8f5e8; color: #388e3c; border-color: #a5d6a7; }
  .workflow-dropdown.workflow-router { background: #fce4ec; color: #c2185b; border-color: #f8bbd9; }
  select { border: 1px solid var(--border); background: white; cursor: pointer; }
  /* removed unused .chip-edit styles */

  /* Version Modal Styles */
  .version-modal {
    width: min(650px, 92vw);
    max-height: 90vh;
    overflow-y: auto;
  }
  .version-timeline {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.5rem;
    background: #f8f9fa;
    border-radius: 6px;
    border: 1px solid var(--border);
  }
  .version-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    background: white;
    border: 2px solid var(--border);
    border-radius: 6px;
    cursor: pointer;
    transition: all 0.2s ease;
  }
  .version-item:hover {
    border-color: #FFD700;
    background: #fffef8;
  }
  .version-item.selected {
    border-color: #FFD700;
    background: #fff8e1;
  }
  .version-info {
    flex: 1;
  }
  .version-name {
    font-weight: 600;
    color: var(--text);
    margin-bottom: 0.25rem;
  }
  .version-date {
    font-size: 0.8rem;
    color: var(--secondary);
  }
  .version-checkmark {
    width: 24px;
    height: 24px;
    background: #FFD700;
    border-radius: 50%;
    display: flex;
    align-items: center;
    justify-content: center;
    font-weight: bold;
    color: #333;
  }

  
</style>
