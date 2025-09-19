<script>
  import { onMount } from 'svelte';
  import { page } from '$app/stores';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID, upsertProfileIfMissing, setUserUUID } from '$lib/stores/user.js';
  import { onShapeAPI } from '$lib/onshape.js';
  import { goto } from '$app/navigation';
  import { ArrowLeft, Plus, CheckCircle, ShoppingCart, Zap, Package } from 'lucide-svelte';
  import stockData from '$lib/stock.json';
  import { detectVendorFromString, buildVendorSearchUrl } from '$lib/vendor_detect.js';

  // URL params
  let subsystemId = $page.url.searchParams.get('subsystem');
  let versionId = $page.url.searchParams.get('version');

  // Auth/user/subsystem/version
  let user = null;
  let loading = true;
  let subsystem = null;
  let version = null;

  // BOM and UI
  let buildBOM = [];
  let addedPartsSet = new Set(); // tracks queued items (not DB added)
  let processingAdd = false;

  // Toast
  let toastMessage = '';
  let toastVisible = false;
  let toastTimeout = null;
  function showToast(msg, duration = 4000) {
    toastMessage = msg;
    toastVisible = true;
    if (toastTimeout) clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {
      toastVisible = false;
      toastTimeout = null;
    }, duration);
  }

  // Feature flag
  let enableGetDimensions = false;

  // Queue state (no DB writes until Create Build is pressed)
  let queue = {
    manufactured: [], // queued manufactured items (from analyzed BOM)
    cots: [],         // queued COTS items (from analyzed BOM)
    kit: [],          // queued COTS kit items (from analyzed BOM)
    other: []         // queued "Other BOM" items (manual add section)
  };
  $: queueCount = queue.manufactured.length + queue.cots.length + queue.kit.length + queue.other.length;

  // Create Build processing
  let creatingBuild = false;

  onMount(async () => {
    const unsub = userStore.subscribe((v) => {
      user = v;
    });
    await loadUserFromUUID(supabase);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session && !user) {
      goto('/');
      return;
    }
    if (session?.user?.id) {
      try {
        setUserUUID(session.user.id);
        await upsertProfileIfMissing(supabase, {
          id: session.user.id,
          email: session.user.email,
          name: session.user.user_metadata?.full_name || (session.user.email ? session.user.email.split('@')[0] : '')
        });
        await loadUserFromUUID(supabase);
      } catch (e) {
        console.error('Error handling auth session:', e);
      }
    }
    await loadData();
  });

  async function loadData() {
    if (!subsystemId || !versionId) {
      alert('Missing subsystem or version ID');
      goto('/cad');
      return;
    }

    try {
      // Load subsystem
      const { data: subsystemData, error: subsystemError } = await supabase
        .from('subsystems')
        .select('*')
        .eq('id', subsystemId)
        .single();
      if (subsystemError) throw subsystemError;
      subsystem = subsystemData;

      // Resolve version name from Onshape
      if (subsystem.onshape_document_id) {
        try {
          const allVersions = await onShapeAPI.getDocumentVersions(subsystem.onshape_document_id);
          const currentVersion = allVersions.find(v => v.id === versionId);
          version = currentVersion
            ? { id: versionId, name: currentVersion.name || `Version ${versionId.substring(0, 8)}` }
            : { id: versionId, name: `Version ${versionId.substring(0, 8)}` };
        } catch (versionError) {
          console.error('Error fetching version name:', versionError);
          version = { id: versionId, name: `Version ${versionId.substring(0, 8)}` };
        }
      } else {
        version = { id: versionId, name: `Version ${versionId.substring(0, 8)}` };
      }

      await loadBOM();
    } catch (error) {
      console.error('Error loading data:', error);
      alert('Failed to load data: ' + error.message);

      if (!subsystem) {
        subsystem = {
          id: subsystemId,
          name: `Subsystem ${subsystemId}`,
          onshape_document_id: '',
          onshape_workspace_id: '',
          onshape_element_id: ''
        };
      }
      if (!version) {
        version = { id: versionId, name: `Version ${versionId.substring(0, 8)}` };
      }
    } finally {
      loading = false;
    }
  }

  async function loadBOM() {
    try {
      const bom = await onShapeAPI.getAssemblyBOM(
        subsystem.onshape_document_id,
        subsystem.onshape_workspace_id,
        subsystem.onshape_element_id,
        version?.id || versionId
      );

      buildBOM = await onShapeAPI.analyzeBOM(bom, subsystem.onshape_workspace_id);
      if (Array.isArray(buildBOM)) {
        buildBOM.forEach((part, index) => {
          if (part.part_type === 'manufactured') {
            autoAssignStock(index);
          }
        });
      } else {
        console.warn('analyzeBOM did not return an array', buildBOM);
      }
    } catch (error) {
      console.error('Error loading BOM:', error);
      console.log('Creating mock BOM data for testing...');

      buildBOM = [
        {
          part_name: '18t HTD pulley',
          part_number: 'P002570',
          quantity: 4,
          part_type: 'manufactured',
          workflow: 'mill',
          material: 'Aluminum',
          onshape_part_id: 'mock_part_id_1',
          bounding_box_x: 0.05,
          bounding_box_y: 0.05,
          bounding_box_z: 0.01
        }
      ];
      buildBOM.forEach((part, index) => {
        if (part.part_type === 'manufactured') {
          autoAssignStock(index);
        }
      });

      showToast('Failed to load BOM from OnShape. Using mock data for testing.');
    }
  }

  function autoAssignStock(index) {
    const part = buildBOM[index];
    if (!part || part.part_type === 'COTS') return;
    const stocks = getStocksForWorkflow(part.workflow || 'mill');
    if (stocks.length > 0) {
      part.stock_assignment = stocks[0].description;
    }
  }

  function getStocksForWorkflow(workflow) {
    return stockData[workflow] || [];
  }

  function updatePartType(index, newType) {
    if (buildBOM[index]) {
      buildBOM[index].part_type = newType;
      if (newType === 'COTS') {
        buildBOM[index].workflow = 'purchase';
        buildBOM[index].manufacturing_process = null;
      } else {
        buildBOM[index].workflow = buildBOM[index].manufacturing_process || 'mill';
      }
      autoAssignStock(index);
      buildBOM = [...buildBOM];
    }
  }

  function updateWorkflow(index, newWorkflow) {
    if (buildBOM[index]) {
      buildBOM[index].workflow = newWorkflow;
      buildBOM[index].manufacturing_process = newWorkflow === 'purchase' ? null : newWorkflow;
      autoAssignStock(index);
      buildBOM = [...buildBOM];
    }
  }

  // Stock helpers for analyzed BOM rows
  function updateStockChoice(index, choice) {
    const item = buildBOM[index];
    if (!item) return;
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
    buildBOM = [...buildBOM];
  }
  function updateCustomStock(index, value) {
    const item = buildBOM[index];
    if (!item) return;
    item.stock_assignment_custom = value;
    item.stock_assignment = value;
    item._stock_choice = '__other__';
    buildBOM = [...buildBOM];
  }
  function toggleStockMode(index, mode) {
    const item = buildBOM[index];
    if (!item) return;
    if (mode === 'input') {
      item._stock_choice = '__other__';
      if (item.stock_assignment_custom === null || item.stock_assignment_custom === undefined) {
        item.stock_assignment_custom = item.stock_assignment || '';
      }
      item.stock_assignment = item.stock_assignment_custom || '';
    } else {
      item._stock_choice = '';
    }
    buildBOM = [...buildBOM];
  }

  // Removed drawing modal state for lathe/mill parts (no longer requiring drawing URL)



  // Portal helper (modals)
  function portal(node) {
    const target = document.body;
    target.appendChild(node);
    return {
      destroy() {
        if (node && node.parentNode) {
          node.parentNode.removeChild(node);
        }
      }
    };
  }

  // Removed drawing URL parsing/prompt functions

  // Purchase modal (queue-only, when vendor detection not possible)
  let showPurchaseModal = false;
  let purchaseModalItem = null;
  let purchaseModalUrl = '';
  let purchaseModalPrice = '';

  // Add handlers: now queue-only (NO DB writes)
  function handleAddClick(item) {
    if (processingAdd) return;
    const partKey = item.part_number || item.part_name;
    if (addedPartsSet.has(partKey)) return;

    if (item.part_type === 'COTS') {
      const wf = String(item.workflow || '').trim().toLowerCase();
      if (wf === 'kit') {
        queueKitItem(item);
      } else {
        queueCOTSPromptIfNeeded(item);
      }
      return;
    }
    const wf = String(item.workflow || item.manufacturing_process || '').trim().toLowerCase();
    if (wf === 'lathe' || wf === 'mill') {
      // Directly add without drawing prompt
      queueManufacturedItem(item);
    } else if (wf === 'router') {
      queueManufacturedItem(item);
    } else {
      queueManufacturedItem(item);
    }
  }

  // Queue helpers
  function queueManufacturedItem(item, opts = {}) {
    const workflow = item.workflow || item.manufacturing_process || 'mill';
    const queued = {
      source: 'bom',
      part_name: item.part_name || item.part_number || 'Unnamed Part',
      part_number: item.part_number || null,
      quantity: item.quantity || 1,
      material: item.material || '',
      workflow,
      // stock selection
      stock_assignment: item._stock_choice === '__other__'
        ? (item.stock_assignment_custom || item.stock_assignment || null)
        : (item._stock_choice || item.stock_assignment || null),
      // onshape refs
      onshape_document_id: subsystem.onshape_document_id || null,
      onshape_element_id: item.onshape_part_studio_element_id || subsystem.onshape_element_id || null,
      onshape_part_id: item.onshape_part_id || null,
      onshape_wvm: 'v',
      onshape_wvmid: version.id,
      // meta
      drawingEID: opts.drawingEID || null,
      router_meta: opts.routerFlags ? { ...opts.routerFlags } : null
    };
    queue.manufactured = [...queue.manufactured, queued];

    // mark queued
    addedPartsSet = new Set([...addedPartsSet, item.part_number || item.part_name]);
    showToast(`Added ${queued.part_name}`);
  }

  function queueKitItem(item) {
    const queued = {
      source: 'bom',
      part_name: item.part_name || item.part_number || 'Unnamed Item',
      part_number: item.part_number || null,
      quantity: item.quantity || 1,
      material: item.material || '',
      workflow: 'kit'
    };
    queue.kit = [...queue.kit, queued];
    addedPartsSet = new Set([...addedPartsSet, item.part_number || item.part_name]);
    showToast(`Added ${queued.part_name}`);
  }

  function queueCOTSPromptIfNeeded(item) {
    const detection = detectVendorFromString(item.vendor || item.part_name || item.part_number || '');
    
    // Check if we have a valid vendor detection
    const hasValidDetection = detection && detection.vendor;
    
    // If no valid detection, show modal for manual entry
    if (!hasValidDetection) {
      purchaseModalItem = item;
      purchaseModalUrl = '';
      purchaseModalPrice = '';
      showPurchaseModal = true;
      return;
    }
    
    // If detection succeeded, check if we can build a valid URL
    const rawUrl = buildVendorSearchUrl(detection);
    const hasValidUrl = rawUrl && rawUrl.trim() !== '' && !rawUrl.endsWith('=');
    
    // If URL is invalid, show modal
    if (!hasValidUrl) {
      purchaseModalItem = item;
      purchaseModalUrl = '';
      purchaseModalPrice = '';
      showPurchaseModal = true;
      return;
    }
    
    // If we have both valid detection and URL, add directly to queue
    const queued = {
      source: 'bom',
      part_name: item.part_name || item.part_number || 'Unnamed Part',
      part_number: item.part_number || null,
      quantity: item.quantity || 1,
      material: item.material || '',
      workflow: 'purchase',
      vendor: detection?.vendor || item.vendor || null,
      url: rawUrl,  // Use the validated URL
      price: null
    };
    queue.cots = [...queue.cots, queued];
    addedPartsSet = new Set([...addedPartsSet, item.part_number || item.part_name]);
    showToast(`Added ${queued.part_name}`);
  }

  async function confirmAddToPurchasingFromModal() {
    if (!purchaseModalItem) return;
    showPurchaseModal = false;
    const queued = {
      source: 'bom',
      part_name: purchaseModalItem.part_name || purchaseModalItem.part_number || 'Unnamed Part',
      part_number: purchaseModalItem.part_number || null,
      quantity: purchaseModalItem.quantity || 1,
      material: purchaseModalItem.material || '',
      workflow: 'purchase',
      vendor: null,
      url: purchaseModalUrl && purchaseModalUrl.trim() !== '' ? purchaseModalUrl.trim() : null,
      price: purchaseModalPrice && purchaseModalPrice !== '' ? Number(purchaseModalPrice) : null
    };
    queue.cots = [...queue.cots, queued];
    addedPartsSet = new Set([...addedPartsSet, purchaseModalItem.part_number || purchaseModalItem.part_name]);
    showToast(`Added ${queued.part_name}`);
    purchaseModalItem = null;
    purchaseModalUrl = '';
    purchaseModalPrice = '';
  }

  // Add All COTS: queue-only
  function addAllCOTSToPurchasing() {
    const cotsItems = buildBOM.filter(item => item.part_type === 'COTS');
    if (cotsItems.length === 0) {
      showToast('No COTS items found in BOM');
      return;
    }
    let queuedCount = 0;
    for (const item of cotsItems) {
      const key = item.part_number || item.part_name;
      if (addedPartsSet.has(key)) continue;

      const wf = String(item.workflow || 'purchase').trim().toLowerCase();
      if (wf === 'kit') {
        const q = {
          source: 'bom',
          part_name: item.part_name || item.part_number || 'Unnamed Item',
          part_number: item.part_number || null,
          quantity: item.quantity || 1,
          material: item.material || '',
          workflow: 'kit'
        };
        queue.kit = [...queue.kit, q];
        addedPartsSet.add(key);
        queuedCount++;
        continue;
      }

      const detection = detectVendorFromString(item.vendor || item.part_name || item.part_number || '');
      // Get validated URL
      const rawUrl = buildVendorSearchUrl(detection);
      const validatedUrl = rawUrl && rawUrl.trim() !== '' && !rawUrl.endsWith('=') ? rawUrl : null;

      const q = {
        source: 'bom',
        part_name: item.part_name || item.part_number || 'Unnamed Part',
        part_number: item.part_number || null,
        quantity: item.quantity || 1,
        material: item.material || '',
        workflow: 'purchase',
        vendor: detection?.vendor || item.vendor || null,
        url: validatedUrl,
        price: null
      };
      queue.cots = [...queue.cots, q];
      addedPartsSet.add(key);
      queuedCount++;
    }
    if (queuedCount > 0) {
      showToast(`Added ${queuedCount} COTS items`);
      addedPartsSet = new Set(addedPartsSet);
    } else {
      showToast('All COTS items already added');
    }
  }

  // "Other BOM" section (manual add, queue-only)
  let otherDraft = {
    part_name: '',
    quantity: 1,
    type: 'manufactured', // 'manufactured' | 'COTS'
    workflow: 'mill',     // only when manufactured
    material: '',
    // dimensions (optional, meters like other code expects)
    bounding_box_x: null,
    bounding_box_y: null,
    bounding_box_z: null,
    // stock
    _stock_choice: '',
    stock_assignment: '',
    stock_assignment_custom: ''
  };

  function addOtherToQueue() {
    if (!otherDraft.part_name?.trim() || !otherDraft.quantity || otherDraft.quantity < 1) {
      alert('Enter a part name and quantity >= 1');
      return;
    }
    const queued = {
      part_name: otherDraft.part_name.trim(),
      quantity: Number(otherDraft.quantity),
      part_type: 'other', // stored as "other" until promoted on build page
      display_type: otherDraft.type, // for UI summary
      workflow: otherDraft.type === 'COTS' ? 'purchase' : (otherDraft.workflow || 'mill'),
      material: otherDraft.material || '',
      bounding_box_x: otherDraft.bounding_box_x ? Number(otherDraft.bounding_box_x) : null,
      bounding_box_y: otherDraft.bounding_box_y ? Number(otherDraft.bounding_box_y) : null,
      bounding_box_z: otherDraft.bounding_box_z ? Number(otherDraft.bounding_box_z) : null,
      stock_assignment: otherDraft._stock_choice === '__other__'
        ? (otherDraft.stock_assignment_custom || otherDraft.stock_assignment || null)
        : (otherDraft._stock_choice || otherDraft.stock_assignment || null),
      stock_assignment_custom: otherDraft._stock_choice === '__other__'
        ? (otherDraft.stock_assignment_custom || '')
        : null
    };
    queue.other = [...queue.other, queued];
    // reset draft minimally
    otherDraft.part_name = '';
    otherDraft.quantity = 1;
    otherDraft.material = '';
    otherDraft.bounding_box_x = otherDraft.bounding_box_y = otherDraft.bounding_box_z = null;
    otherDraft._stock_choice = '';
    otherDraft.stock_assignment = '';
    otherDraft.stock_assignment_custom = '';
    showToast('Added Other item');
  }
  function removeQueuedOther(index) {
    queue.other = queue.other.filter((_, i) => i !== index);
  }
  function updateOtherDraftStockChoice(choice) {
    otherDraft._stock_choice = choice;
    if (choice && choice !== '__other__') {
      otherDraft.stock_assignment = choice;
      otherDraft.stock_assignment_custom = '';
    } else if (choice === '__other__') {
      otherDraft.stock_assignment = '';
      otherDraft.stock_assignment_custom = '';
    } else {
      otherDraft.stock_assignment = '';
      otherDraft.stock_assignment_custom = '';
    }
  }

  // Create Build: now persist everything
  async function createBuildAndPersistQueue() {
    if (queueCount === 0) {
      alert('Queue is empty. Press Add next to BOM items or add Other items first.');
      return;
    }
    if (!user || !subsystem || !version) {
      alert('Missing user, subsystem, or version context');
      return;
    }

    creatingBuild = true;
    try {
      const buildHash = `${subsystem.name}_${version.id}`;

      // Try to create a new build; if one exists with same hash, use it
      let build = null;
      const { data: existingBuild, error: buildCheckError } = await supabase
        .from('builds')
        .select('*')
        .eq('build_hash', buildHash)
        .single();

      if (buildCheckError && buildCheckError.code !== 'PGRST116') {
        // Some other error
        throw buildCheckError;
      }

      if (existingBuild) {
        build = existingBuild;
      } else {
        const { data: newBuild, error: buildCreateError } = await supabase
          .from('builds')
          .insert([{
            subsystem_id: subsystem.id,
            release_id: version.id,
            release_name: version.name,
            build_hash: buildHash,
            status: 'pending',
            created_by: user.id,
            part_ids: []
          }])
          .select()
          .single();
        if (buildCreateError) throw buildCreateError;
        build = newBuild;
      }

      // IMPORTANT: Do NOT create parts/purchasing/kitting until the build is approved.
      // Instead, persist a full BOM snapshot (below) including flags indicating which
      // items were queued. The Slack approval handler will process these rows and
      // create parts/purchasing/kitting when the build is approved.

      // Gate by build approval: mark build as pending approval and request via Slack.
      try {
        await supabase.from('builds').update({ approved: false }).eq('id', build.id);
      } catch {}
      try {
        await fetch('/api/971bot/notify/build', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ build_id: build.id, requester: user?.full_name || user?.email, project_id: `${subsystem.name}-${version.name}` })
        });
      } catch (e) { console.warn('Failed to notify Slack for build approval:', e); }

      // Short-circuit for local/dev if already approved (or no Slack configured)
      let approved = false;
      try {
        const { data: check } = await supabase.from('builds').select('approved').eq('id', build.id).single();
        approved = !!check?.approved;
      } catch {}

      if (!approved) {
        showToast('Build submitted for approval in Slack. It will populate parts/purchasing after approval.');
      }

/**
 * Persist full BOM snapshot to build_bom so the build route can render all items.
 * We reset prior rows for this build, then insert all analyzed BOM items with flags
 * indicating whether they were added to parts or purchasing when Create Build was pressed.
 */
try {
  await supabase.from('build_bom').delete().eq('build_id', build.id);
} catch (e) {
  console.warn('Failed to clear existing build_bom rows:', e?.message || e);
}

const bomRows = (buildBOM || []).map((item) => {
  const isCOTS = item.part_type === 'COTS';
  const stock_assignment = isCOTS ? null : (
    item._stock_choice === '__other__'
      ? (item.stock_assignment_custom || item.stock_assignment || null)
      : (item._stock_choice || item.stock_assignment || null)
  );
  const wasMfgAdded = queue.manufactured.some(q => (q.part_number ? q.part_number === item.part_number : q.part_name === item.part_name));
  const wasCotsAdded = queue.cots.some(q => (q.part_number ? q.part_number === item.part_number : q.part_name === item.part_name));
  const wasKitAdded = queue.kit.some(q => (q.part_number ? q.part_number === item.part_number : q.part_name === item.part_name));
  return {
    build_id: build.id,
    build_hash: build.build_hash || null,
    subsystem_id: build.subsystem_id || null,
    release_id: build.release_id || null,
    release_name: build.release_name || null,
    created_by: user?.id || null,

    part_name: item.part_name,
    part_number: item.part_number || null,
    quantity: item.quantity || 1,
    material: item.material || '',
    part_type: isCOTS ? 'COTS' : 'manufactured',
    workflow: isCOTS ? 'purchase' : (item.workflow || item.manufacturing_process || 'mill'),

    // geometry and stock
    bounding_box_x: item.bounding_box_x ?? null,
    bounding_box_y: item.bounding_box_y ?? null,
    bounding_box_z: item.bounding_box_z ?? null,
    stock_assignment,
    stock_assignment_custom: isCOTS ? null : (item._stock_choice === '__other__' ? (item.stock_assignment_custom || '') : null),

    // onshape context (best-effort; may be null if not present on item)
    onshape_document_id: item.onshape_document_id || subsystem.onshape_document_id || null,
    onshape_element_id: item.onshape_part_studio_element_id || subsystem.onshape_element_id || null,
    onshape_part_id: item.onshape_part_id || null,
    onshape_wvm: 'v',
    onshape_wvmid: version.id,

    // flags showing which items you chose to add
    added_to_parts_list: !isCOTS && wasMfgAdded,
    added_to_purchasing: isCOTS && wasCotsAdded,
    added_to_kitting: isCOTS && wasKitAdded
  };
});

if (bomRows.length) {
  // Attempt full insert with all columns first
  let bomInsertError = null;
  try {
    const { error } = await supabase.from('build_bom').insert(bomRows);
    if (error) bomInsertError = error;
  } catch (e) {
    bomInsertError = e;
  }

  if (bomInsertError) {
    console.warn('Failed to insert BOM snapshot into build_bom (full columns):', bomInsertError?.message || bomInsertError);

    // Fallback A: retry with minimal set of columns compatible with leaner schemas
    const minimalRows = (bomRows || []).map((it) => ({
      build_id: it.build_id,
      part_name: it.part_name,
      quantity: it.quantity,
      material: it.material,
      part_type: it.part_type,
      workflow: it.workflow,
      bounding_box_x: it.bounding_box_x ?? null,
      bounding_box_y: it.bounding_box_y ?? null,
      bounding_box_z: it.bounding_box_z ?? null
    }));

    let minimalError = null;
    try {
      const { error: e2 } = await supabase.from('build_bom').insert(minimalRows);
      if (e2) minimalError = e2;
    } catch (e) {
      minimalError = e;
    }

    if (minimalError) {
      console.warn('Failed to insert BOM snapshot into build_bom (minimal columns):', minimalError?.message || minimalError);

      // Fallback B: include created_by only (to satisfy RLS) with minimal schema
      const minimalWithCreator = minimalRows.map((it) => ({
        ...it,
        created_by: user?.id || null
      }));
      let minimalCreatorError = null;
      try {
        const { error: e3 } = await supabase.from('build_bom').insert(minimalWithCreator);
        if (e3) minimalCreatorError = e3;
      } catch (e) {
        minimalCreatorError = e;
      }

      if (minimalCreatorError) {
        console.error('Failed to insert BOM snapshot into build_bom (minimal + created_by):', minimalCreatorError?.message || minimalCreatorError);
        alert('Failed to save full BOM snapshot to build BOM. Please check database permissions/columns.');
      }
    }
  }
}

// Insert "Other" queued items into build_bom as part_type 'other'
      for (const it of queue.other) {
        const row = {
          build_id: build.id,
          part_name: it.part_name,
          quantity: it.quantity || 1,
          material: it.material || '',
          part_type: 'other',
          workflow: it.workflow || null,
          bounding_box_x: it.bounding_box_x,
          bounding_box_y: it.bounding_box_y,
          bounding_box_z: it.bounding_box_z,
          stock_assignment: it.stock_assignment || null,
          stock_assignment_custom: it.stock_assignment_custom ?? null,
          added_to_parts_list: false,
          added_to_purchasing: false
        };
        const { error } = await supabase.from('build_bom').insert([row]);
        if (error) {
          console.warn('Failed to insert other item into build_bom:', error?.message || error);
        }
      }

  showToast('Build created. Awaiting approval to add items to parts/purchasing.');
  goto(`/cad/build/${build.id}`); // details page will refresh as items are added after approval
    } catch (e) {
      console.error('Create build failed:', e);
      alert('Failed to create build and persist items: ' + (e?.message || e));
    } finally {
      creatingBuild = false;
    }
  }
</script>

<div class="main-content">
  <div class="page-header">
    <div class="header-content">
      <div class="header-left">
        <div class="header-info">
          <h1>Build BOM</h1>
          {#if subsystem && version}
            <p class="subsystem-description">{subsystem.name} - {version.name}</p>
          {/if}
        </div>
      </div>
      <div class="header-right">
        <button class="back-button" on:click={() => goto('/cad')}>
          <ArrowLeft size={16} />
          Back to CAD
        </button>
      </div>
    </div>

    <!-- Build creation controls -->
    <div class="build-controls">
      <div class="queue-summary">
        <span class="q-pill mfg">Manufactured: {queue.manufactured.length}</span>
        <span class="q-pill cots">COTS: {queue.cots.length}</span>
        <span class="q-pill other">Other: {queue.other.length}</span>
      </div>
      <div class="controls-right">
        <button class="btn btn-yellow create-btn" disabled={queueCount === 0 || creatingBuild} on:click={createBuildAndPersistQueue}>
          {#if creatingBuild}
            Creating Build...
          {:else}
            Create Build ({queueCount})
          {/if}
        </button>
      </div>
    </div>
  </div>

  {#if loading}
    <div class="loading-container">
      <div class="loading-spinner"></div>
      <p>Loading BOM...</p>
    </div>
  {:else}
    <!-- BOM table -->
    <div class="bom-section">
      <div class="bom-actions" style="display:flex; justify-content: flex-end; margin-bottom: 0.5rem;">
        <button class="btn btn-sm" on:click={addAllCOTSToPurchasing}>Add All COTS</button>
      </div>
      <div class="bom-table-container">
        <table class="bom-table">
          <thead>
            <tr>
              <th>Part Name</th>
              <th>Qty</th>
              <th>Type</th>
              <th>Workflow</th>
              <th>Dimensions</th>
              <th>Stock Assignment</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {#each buildBOM as item, index}
              <tr class="table-row">
                <td>
                  <div class="part-name">
                    {item.part_name}
                    {#if item.description}
                      <div class="part-description">{item.description}</div>
                    {/if}
                  </div>
                </td>
                <td>{item.quantity}</td>
                <td>
                  <select
                    class="type-dropdown {item.part_type === 'COTS' ? 'type-cots' : 'type-manufactured'}"
                    value={item.part_type}
                    on:change={(e) => updatePartType(index, e.target.value)}
                  >
                    <option value="COTS">COTS</option>
                    <option value="manufactured">Manufactured</option>
                  </select>
                </td>
                <td>
                  {#if item.part_type === 'COTS'}
                    <select
                      class="workflow-dropdown workflow-{item.workflow || 'purchase'}"
                      value={item.workflow || 'purchase'}
                      on:change={(e) => updateWorkflow(index, e.target.value)}
                    >
                      <option value="purchase">Purchase</option>
                      <option value="kit">Kit</option>
                    </select>
                  {:else}
                    <select
                      class="workflow-dropdown workflow-{item.workflow || 'mill'}"
                      value={item.workflow || 'mill'}
                      on:change={(e) => updateWorkflow(index, e.target.value)}
                    >
                      <option value="3d-print">3D Print</option>
                      <option value="laser-cut">Laser Cut</option>
                      <option value="lathe">Lathe</option>
                      <option value="mill">Mill</option>
                      <option value="router">Router</option>
                    </select>
                  {/if}
                </td>
                <td>
                  {#if enableGetDimensions}
                    {#if item.bounding_box_x && item.bounding_box_y && item.bounding_box_z}
                      <div class="bounding-box">
                        {(item.bounding_box_x * 1000).toFixed(1)} × {(item.bounding_box_y * 1000).toFixed(1)} × {(item.bounding_box_z * 1000).toFixed(1)} mm
                      </div>
                    {:else}
                      <span class="no-data">No dimensions</span>
                    {/if}
                  {:else}
                    <span class="no-data">Dimensions disabled</span>
                  {/if}
                </td>
                <td>
                  {#if item.part_type !== 'COTS'}
                    <div class="stock-select hybrid-select">
                      {#if item._stock_choice === '__other__'}
                        <input
                          type="text"
                          class="form-input hybrid-input"
                          placeholder="Type custom stock"
                          bind:value={item.stock_assignment_custom}
                          on:input={(e) => updateCustomStock(index, e.target.value)}
                        />
                        <button
                          class="chevron-btn"
                          title="Show dropdown"
                          on:click={() => toggleStockMode(index, 'select')}
                        >▾</button>
                      {:else}
                        <select on:change={(e) => updateStockChoice(index, e.target.value)} value={item._stock_choice || item.stock_assignment}>
                          <option value="">Select Stock</option>
                          {#each getStocksForWorkflow(item.workflow || 'mill') as stock}
                            <option value={stock.description}>{stock.description}</option>
                          {/each}
                          <option value="__other__">Other...</option>
                        </select>
                      {/if}
                    </div>
                  {:else}
                    <span class="no-stock">-</span>
                  {/if}
                </td>
                <td>
                  <button
                    class="btn btn-sm btn-yellow add-btn"
                    on:click={() => handleAddClick(item)}
                    disabled={addedPartsSet.has(item.part_number || item.part_name) || processingAdd}
                    class:added={addedPartsSet.has(item.part_number || item.part_name)}
                  >
                    {#if addedPartsSet.has(item.part_number || item.part_name)}
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
    </div>

    <!-- Other BOM Items (Queue only; persisted to build_bom when Create Build is pressed) -->
    <div class="other-section">
      <div class="other-header">
        <h2>Other BOM Items</h2>
        <p class="hint">Use this to add items not present in the CAD BOM. They will appear on the Build page under "Other Items" and can be promoted later.</p>
      </div>
      <div class="other-form">
        <div class="row">
          <label for="other-name">Name</label>
          <input id="other-name" class="form-input" type="text" bind:value={otherDraft.part_name} placeholder="Custom item name" />
        </div>
        <div class="row">
          <label for="other-qty">Qty</label>
          <input id="other-qty" class="form-input" type="number" min="1" step="1" bind:value={otherDraft.quantity} />
        </div>
        <div class="row">
          <label for="other-type">Type</label>
          <select id="other-type" class="form-input" bind:value={otherDraft.type}>
            <option value="manufactured">Manufactured</option>
            <option value="COTS">COTS</option>
          </select>
        </div>
        <div class="row">
          {#if otherDraft.type !== 'COTS'}
            <label for="other-workflow">Workflow</label>
          {/if}
          {#if otherDraft.type === 'COTS'}
            <span class="workflow-badge workflow-purchase">Purchase</span>
          {:else}
            <select id="other-workflow" class="workflow-dropdown workflow-{otherDraft.workflow || 'mill'}" bind:value={otherDraft.workflow}>
              <option value="3d-print">3D Print</option>
              <option value="laser-cut">Laser Cut</option>
              <option value="lathe">Lathe</option>
              <option value="mill">Mill</option>
              <option value="router">Router</option>
            </select>
          {/if}
        </div>
        <div class="row">
          <label for="other-material">Material</label>
          <input id="other-material" class="form-input" type="text" bind:value={otherDraft.material} placeholder="e.g., Aluminum" />
        </div>
        <div class="row">
          <label for="other-dim-x">Dimensions</label>
          <div class="dims">
            <input id="other-dim-x" class="form-input" type="number" step="0.001" placeholder="X (m)" bind:value={otherDraft.bounding_box_x} />
            <input id="other-dim-y" class="form-input" type="number" step="0.001" placeholder="Y (m)" bind:value={otherDraft.bounding_box_y} />
            <input id="other-dim-z" class="form-input" type="number" step="0.001" placeholder="Z (m)" bind:value={otherDraft.bounding_box_z} />
          </div>
        </div>
        <div class="row">
          {#if otherDraft.type !== 'COTS'}
            <label for="other-stock">Stock</label>
          {/if}
          {#if otherDraft.type === 'COTS'}
            <span class="no-stock">-</span>
          {:else}
            <div class="stock-select hybrid-select" style="width:100%;">
              {#if otherDraft._stock_choice === '__other__'}
                <input
                  id="other-stock"
                  type="text"
                  class="form-input hybrid-input"
                  placeholder="Type custom stock"
                  bind:value={otherDraft.stock_assignment_custom}
                />
                <button class="chevron-btn" title="Show dropdown" on:click={() => updateOtherDraftStockChoice('')}>▾</button>
              {:else}
                <select id="other-stock" on:change={(e) => updateOtherDraftStockChoice(e.target.value)} value={otherDraft._stock_choice || otherDraft.stock_assignment}>
                  <option value="">Select Stock</option>
                  {#each getStocksForWorkflow(otherDraft.workflow || 'mill') as stock}
                    <option value={stock.description}>{stock.description}</option>
                  {/each}
                  <option value="__other__">Other...</option>
                </select>
              {/if}
            </div>
          {/if}
        </div>
        <div class="row" style="grid-column: 1 / -1; display:flex; justify-content:flex-end;">
          <button class="btn btn-sm btn-yellow" on:click={addOtherToQueue}>
            <Plus size={14} />
            Add Other Item
          </button>
        </div>
      </div>

      {#if queue.other.length > 0}
        <div class="bom-table-container" style="margin-top: 0.75rem;">
          <table class="bom-table">
            <thead>
              <tr>
                <th>Part Name</th>
                <th>Qty</th>
                <th>Type</th>
                <th>Workflow</th>
                <th>Dimensions</th>
                <th>Stock</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {#each queue.other as it, i}
                <tr class="table-row">
                  <td>{it.part_name}</td>
                  <td>{it.quantity}</td>
                  <td>{it.display_type}</td>
                  <td>{it.workflow || '-'}</td>
                  <td>
                    {#if it.bounding_box_x && it.bounding_box_y && it.bounding_box_z}
                      <div class="bounding-box">
                        {(it.bounding_box_x * 1000).toFixed(1)} × {(it.bounding_box_y * 1000).toFixed(1)} × {(it.bounding_box_z * 1000).toFixed(1)} mm
                      </div>
                    {:else}
                      <span class="no-data">No dimensions</span>
                    {/if}
                  </td>
                  <td>{it.stock_assignment || '-'}</td>
                  <td>
                    <button class="btn btn-sm" on:click={() => removeQueuedOther(i)}>Remove</button>
                  </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Drawing URL Modal removed -->

<!-- Purchase Link/Price Modal (queue-only) -->
{#if showPurchaseModal}
  <div use:portal id="purchase-modal-backdrop" class="modal-backdrop" role="presentation" tabindex="-1" on:click={() => { showPurchaseModal = false; purchaseModalItem = null; }}></div>
  <div use:portal id="purchase-modal" class="modal" role="dialog" tabindex="-1" on:click|stopPropagation on:keydown={(e) => { if (e.key === 'Escape') { showPurchaseModal = false; purchaseModalItem = null; } }}>
    <h3>Provide vendor link and unit price</h3>
    <p>Please supply a vendor URL and unit price for <strong>{purchaseModalItem?.part_name || purchaseModalItem?.part_number || 'this part'}</strong></p>
    <div class="modal-row">
      <label for="vendor-link">Vendor link</label>
      <input id="vendor-link" class="form-input" type="text" bind:value={purchaseModalUrl} placeholder="https://..." />
    </div>
    <div class="modal-row">
      <label for="unit-price">Unit price</label>
      <input id="unit-price" class="form-input" type="number" min="0" step="0.01" bind:value={purchaseModalPrice} />
    </div>
    <div class="modal-actions">
      <button class="btn" on:click={() => { showPurchaseModal = false; purchaseModalItem = null; }}>Cancel</button>
      <button class="btn btn-yellow" on:click={confirmAddToPurchasingFromModal}>Add to Purchasing</button>
    </div>
  </div>
{/if}

<!-- Toast -->
{#if toastVisible}
  <div id="app-toast" class="toast" role="status" aria-live="polite">
    {toastMessage}
  </div>
{/if}

<style>
  .main-content {
    max-width: 1600px;
    margin: 0 auto;
    padding: 2rem;
  }

  .page-header { margin-bottom: 1.25rem; }
  .header-content {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
  }
  .header-left { flex: 1; }
  .header-right { display: flex; align-items: center; gap: 1rem; }

  .back-button {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.5rem 1rem;
    background: var(--surface);
    border: 1px solid var(--border);
    border-radius: 8px;
    color: var(--text);
    cursor: pointer;
    font-size: 0.875rem;
    transition: all 0.2s ease;
    height: 40px;
  }
  .back-button:hover { border-color: var(--primary); color: var(--primary); }

  .header-info h1 {
    margin: 0;
    color: var(--text);
    font-size: 2rem;
    font-weight: 600;
  }
  .subsystem-description { margin: 0.5rem 0 0 0; color: var(--secondary); }

  .build-controls {
    margin-top: 0.75rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
  }
  .queue-summary { display: flex; gap: 0.5rem; flex-wrap: wrap; }
  .q-pill {
    display: inline-flex; align-items: center;
    padding: 0.25rem 0.5rem; font-size: 0.85rem; border-radius: 999px; border: 1px solid var(--border);
    background: var(--background);
  }
  .q-pill.mfg { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .q-pill.cots { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .q-pill.other { background: #f3f4f6; color: #374151; border-color: #e5e7eb; }
  .controls-right { display: flex; align-items: center; gap: 0.75rem; }
  .create-btn { min-width: 180px; }
  .hint { color: var(--secondary); font-size: 0.85rem; }

  .loading-container {
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    padding: 3rem; gap: 1rem;
  }
  .loading-spinner {
    width: 32px; height: 32px; border: 3px solid var(--border); border-top: 3px solid #FFD700;
    border-radius: 50%; animation: spin 1s linear infinite;
  }
  @keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }

  .bom-section { display: block; }
  .btn-yellow { background: #FFD700; color: #333; height: 40px; }
  .btn-yellow:hover { background: #FFC107; }

  .bom-actions .btn-sm {
    height: 32px; padding: 0.25rem 0.5rem; border: 1px solid var(--border); border-radius: 6px; background: var(--background);
  }

  .bom-table-container {
    overflow-x: auto;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
  }
  .bom-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.875rem;
  }
  .bom-table th, .bom-table td {
    padding: 0.75rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .bom-table th { background: var(--background); font-weight: 600; color: var(--text); }
  .bom-table .table-row { background: white; }
  .bom-table tr:hover { background: #f8f9fa; }
  .part-name { font-weight: 500; }
  .part-description { font-size: 0.75rem; color: var(--secondary); margin-top: 0.25rem; }

  .type-dropdown {
    padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8125rem; background: white; cursor: pointer; height: 32px;
  }
  .type-cots { background: #fff8e1 !important; color: #f57f17 !important; border-color: #ffcc02 !important; }
  .type-manufactured { background: #e1f5fe !important; color: #0277bd !important; border-color: #81d4fa !important; }

  .workflow-badge {
    display: inline-flex; align-items: center; padding: 0.375rem 0.75rem; border-radius: 4px; font-size: 0.8125rem; font-weight: 500; background: var(--background); border: 1px solid var(--border); height: 32px;
  }
  .workflow-purchase { background: #fff8e1; color: #f57f17; border-color: #ffcc02; }

  .workflow-dropdown {
    padding: 0.375rem 0.5rem; border: 1px solid var(--border); border-radius: 4px; font-size: 0.8125rem; background: var(--background); color: var(--text); cursor: pointer; height: 32px;
  }
  .workflow-dropdown.workflow-3d-print { background: #e3f2fd; color: #1565c0; border-color: #90caf9; }
  .workflow-dropdown.workflow-laser-cut { background: #fff3e0; color: #ef6c00; border-color: #ffcc02; }
  .workflow-dropdown.workflow-lathe { background: #f3e5f5; color: #7b1fa2; border-color: #ce93d8; }
  .workflow-dropdown.workflow-mill { background: #e8f5e8; color: #388e3c; border-color: #a5d6a7; }
  .workflow-dropdown.workflow-router { background: #fce4ec; color: #c2185b; border-color: #f8bbd9; }

  .bounding-box { font-family: monospace; font-size: 0.75rem; }
  .no-data { color: var(--secondary); font-style: italic; }
  .no-stock { color: var(--secondary); font-style: italic; }

  .add-btn { min-width: 80px; }
  .add-btn.added { background: #e8f5e8 !important; color: #388e3c !important; border: 1px solid #a5d6a7 !important; cursor: not-allowed !important; }
  .add-btn:disabled { opacity: 0.6; cursor: not-allowed; }

  select,
  .select-base,
  .type-dropdown,
  .workflow-dropdown,
  .hybrid-select select,
  .hybrid-select .hybrid-input,
  input[type="text"],
  input[type="number"],
  .form-input {
    padding: 0.45rem 0.6rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    font-size: 0.95rem;
    background: var(--background);
    color: var(--text);
    height: 36px;
    box-sizing: border-box;
    -webkit-appearance: none;
    -moz-appearance: none;
    appearance: none;
  }

  /* Modal styles */
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
  .modal h3 { margin: 0 0 0.5rem 0; }
  .modal p { margin: 0 0 0.75rem 0; color: var(--secondary); }
  .modal .form-input { width: 100%; }
  .modal-actions { display: flex; justify-content: flex-end; gap: 0.5rem; margin-top: 0.75rem; }
  .modal-row { display: flex; justify-content: space-between; align-items: center; gap: 0.75rem; }

  /* Toast */
  .toast {
    position: fixed;
    right: 1rem;
    bottom: 1rem;
    background: rgba(50,50,50,0.95);
    color: #fff;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    box-shadow: 0 6px 18px rgba(0,0,0,0.25);
    z-index: 2147483650 !important;
    font-size: 0.9rem;
    max-width: 360px;
  }

  /* Other BOM section */
  .other-section {
    margin-top: 1rem;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 8px;
    background: #fff;
  }
  .other-header { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 0.5rem; }
  .other-header h2 { margin: 0; }
  .other-form {
    display: grid;
    grid-template-columns: repeat(4, minmax(0, 1fr));
    gap: 0.5rem 0.75rem;
    align-items: center;
  }
  .other-form .row { display: contents; }
  .other-form .row > label { align-self: center; color: var(--secondary); }
  .dims { display: grid; grid-template-columns: repeat(3, 1fr); gap: 0.5rem; }

  /* Hybrid select/input */
  .stock-select.hybrid-select {
    position: relative;
    display: inline-flex;
    align-items: center;
    width: 100%;
    max-width: 420px;
  }
  .hybrid-select select,
  .hybrid-select .hybrid-input {
    width: 100%;
    padding-right: 2rem;
    height: 32px;
    box-sizing: border-box;
  }
  .hybrid-select .chevron-btn {
    position: absolute;
    right: 6px;
    top: 50%;
    transform: translateY(-50%);
    width: 24px;
    height: 24px;
    border: none;
    background: transparent;
    color: var(--secondary);
    cursor: pointer;
    line-height: 1;
    font-size: 16px;
    padding: 0;
  }
  .hybrid-select .chevron-btn:hover { color: var(--text); }
</style>
