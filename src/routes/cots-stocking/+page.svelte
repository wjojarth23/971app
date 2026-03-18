<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';
  import { Check, Package, Search } from 'lucide-svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore, loadUserFromUUID } from '$lib/stores/user.js';
  import {
    canonicalKeyForStock,
    createNewStockPreview,
    detectHardwareType,
    findCotsStockMatches,
    getPreviewCandidate,
    mergeAliases,
    normalizeStockText
  } from '$lib/cotsStocking.js';

  const PART_TYPE_AUTOCOMPLETE = ['gear', 'pulley', 'bearing', 'bolt', 'washer', 'nut', 'screw'];
  const HARDWARE_LEVELS = ['low', 'mid', 'lots'];

  let loading = true;
  let saving = false;
  let user = null;
  let items = [];
  let searchTerm = '';
  let searchSuffix = '';
  let sectionInput = '';
  let drawerInput = '';
  let subsectionInput = '';
  let selectedItemId = null;
  let highlightedIndex = 0;
  let adjustmentQty = 1;
  let stockLevelInput = 'mid';
  let forceCreateNew = false;
  let notice = '';
  let error = '';

  function normalizeLocationField(value) {
    return String(value || '').trim();
  }

  function buildSearchQuery(term, suffix) {
    return [String(term || '').trim(), String(suffix || '').trim()].filter(Boolean).join(' ');
  }

  function buildLocationKey(location = {}) {
    return ['section', 'drawer', 'subsection']
      .map((field) => normalizeLocationField(location[field]).toLowerCase())
      .join('||');
  }

  function getLocationInput() {
    return {
      section: normalizeLocationField(sectionInput),
      drawer: normalizeLocationField(drawerInput),
      subsection: normalizeLocationField(subsectionInput)
    };
  }

  function hasLocationInput(location = getLocationInput()) {
    return !!(location.section || location.drawer || location.subsection);
  }

  function formatLocation(location = {}) {
    const parts = [];
    if (location.section) parts.push(`Section ${location.section}`);
    if (location.drawer) parts.push(`Drawer ${location.drawer}`);
    if (location.subsection) parts.push(`Subsection ${location.subsection}`);
    return parts.join(' / ') || 'Unassigned';
  }

  function sortLocations(locations = []) {
    return [...locations].sort((a, b) =>
      formatLocation(a).localeCompare(formatLocation(b), undefined, { sensitivity: 'base' })
    );
  }

  function normalizeMatchValue(value) {
    return normalizeLocationField(value).toLowerCase();
  }

  function matchesLocationFilter(candidate, typedValue) {
    const normalizedCandidate = normalizeMatchValue(candidate);
    const normalizedTyped = normalizeMatchValue(typedValue);
    if (!normalizedTyped) return true;
    return normalizedCandidate.includes(normalizedTyped);
  }

  function uniqueLocationValues(values = []) {
    return [...new Set(values.map((value) => normalizeLocationField(value)).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }

  function getAllLocations(list = items) {
    return list.flatMap((item) => item.locations || []);
  }

  function getSectionSuggestions() {
    return uniqueLocationValues(
      getAllLocations()
        .map((location) => location.section)
        .filter((value) => matchesLocationFilter(value, sectionInput))
    );
  }

  function getDrawerSuggestions() {
    const normalizedSection = normalizeMatchValue(sectionInput);
    return uniqueLocationValues(
      getAllLocations()
        .filter((location) => !normalizedSection || normalizeMatchValue(location.section) === normalizedSection)
        .map((location) => location.drawer)
        .filter((value) => matchesLocationFilter(value, drawerInput))
    );
  }

  function getSubsectionSuggestions() {
    const normalizedSection = normalizeMatchValue(sectionInput);
    const normalizedDrawer = normalizeMatchValue(drawerInput);
    return uniqueLocationValues(
      getAllLocations()
        .filter((location) => !normalizedSection || normalizeMatchValue(location.section) === normalizedSection)
        .filter((location) => !normalizedDrawer || normalizeMatchValue(location.drawer) === normalizedDrawer)
        .map((location) => location.subsection)
        .filter((value) => matchesLocationFilter(value, subsectionInput))
    );
  }

  function hydrateItems(rows = []) {
    return rows.map((row) => ({
      ...row,
      locations: sortLocations(row.cots_stock_locations || [])
    }));
  }

  function getItemTrackMode(item) {
    return item?.track_mode || (detectHardwareType(item?.canonical_name) ? 'level' : 'count');
  }

  function getItemCountTotal(item) {
    return (item?.locations || []).reduce((sum, location) => sum + (Number(location.quantity) || 0), 0);
  }

  function getItemLevelSummary(item) {
    const rank = { low: 1, mid: 2, lots: 3 };
    let best = null;
    for (const location of item?.locations || []) {
      if (!best || rank[location.stock_level] > rank[best]) best = location.stock_level;
    }
    return best || 'low';
  }

  function getItemStockSummary(item) {
    return getItemTrackMode(item) === 'level' ? getItemLevelSummary(item) : String(getItemCountTotal(item));
  }

  function getLocationStockSummary(item, location) {
    return getItemTrackMode(item) === 'level' ? location.stock_level || 'low' : String(location.quantity || 0);
  }

  function findMatchingLocation(item, locationInput = getLocationInput()) {
    const targetKey = buildLocationKey(locationInput);
    return (item?.locations || []).find((location) => buildLocationKey(location) === targetKey) || null;
  }

  function inferTrackModeFromQuery(value) {
    return detectHardwareType(value) ? 'level' : 'count';
  }

  $: searchQuery = buildSearchQuery(searchTerm, searchSuffix);
  $: autocompleteHint = getPartTypeAutocomplete(searchQuery);
  $: effectiveSearchQuery = autocompleteHint?.query || searchQuery;
  $: normalizedSearch = normalizeStockText(effectiveSearchQuery);
  $: matches = findCotsStockMatches(items, effectiveSearchQuery);
  $: preview = forceCreateNew ? createNewStockPreview(effectiveSearchQuery) : getPreviewCandidate(items, effectiveSearchQuery, selectedItemId);
  $: selectedItem = selectedItemId ? items.find((item) => item.id === selectedItemId) : null;
  $: activeTrackMode = preview?.item ? getItemTrackMode(preview.item) : inferTrackModeFromQuery(effectiveSearchQuery);
  $: sectionSuggestions = getSectionSuggestions();
  $: drawerSuggestions = getDrawerSuggestions();
  $: subsectionSuggestions = getSubsectionSuggestions();
  $: if (highlightedIndex > Math.max(matches.length - 1, 0)) highlightedIndex = 0;

  onMount(() => {
    let cancelled = false;
    const unsub = userStore.subscribe((value) => {
      user = value;
    });

    const init = async () => {
      try {
        await loadUserFromUUID(supabase);
        const { data } = await supabase.auth.getSession();
        if (!data?.session?.user) {
          goto('/');
          return;
        }

        await loadItems();
      } finally {
        if (!cancelled) loading = false;
      }
    };

    init();

    return () => {
      cancelled = true;
      unsub?.();
    };
  });

  async function loadItems() {
    try {
      const { data, error: queryError } = await supabase
        .from('cots_stock_items')
        .select('id, canonical_name, canonical_key, aliases, item_category, track_mode, cots_stock_locations(id, section, drawer, subsection, quantity, stock_level)')
        .order('canonical_name');

      if (queryError) throw queryError;
      items = hydrateItems(data || []);
    } catch (err) {
      console.error('Failed to load COTS stock items', err);
      error = err.message || 'Failed to load COTS stock.';
    }
  }

  function clearMessages() {
    notice = '';
    error = '';
  }

  function resetComposer() {
    searchTerm = '';
    searchSuffix = '';
    sectionInput = '';
    drawerInput = '';
    subsectionInput = '';
    selectedItemId = null;
    highlightedIndex = 0;
    adjustmentQty = 1;
    stockLevelInput = 'mid';
    forceCreateNew = false;
  }

  function chooseMatch(match) {
    if (!match?.item?.id) return;
    selectedItemId = match.item.id;
    forceCreateNew = false;
    clearMessages();
  }

  function onSearchInput() {
    selectedItemId = null;
    highlightedIndex = 0;
    forceCreateNew = false;
    clearMessages();
  }

  function setAdjustmentFromInput(value) {
    adjustmentQty = Math.max(1, Number(value) || 1);
  }

  function getPartTypeAutocomplete(value) {
    const compactValue = String(value || '').replace(/\s+$/, '');
    if (!compactValue) return null;

    const match = compactValue.match(/(^|\s)([a-zA-Z]{2,})$/);
    if (!match) return null;

    const prefix = compactValue.slice(0, compactValue.length - match[2].length);
    const typed = match[2].toLowerCase();
    const completion = PART_TYPE_AUTOCOMPLETE.find((option) => option.startsWith(typed) && option !== typed);
    if (!completion) return null;

    return { typed, completion, query: `${prefix}${completion}` };
  }

  async function onSearchKeydown(event) {
    if (!matches.length && event.key !== 'Enter') return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      highlightedIndex = (highlightedIndex + 1) % matches.length;
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      highlightedIndex = (highlightedIndex - 1 + matches.length) % matches.length;
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (matches[highlightedIndex]) chooseMatch(matches[highlightedIndex]);
    }
  }

  function createNewFromSearch() {
    if (!searchQuery.trim()) return;
    selectedItemId = null;
    forceCreateNew = true;
    clearMessages();
  }

  async function ensureItemRecord(activePreview) {
    if (activePreview.mode === 'existing') {
      const currentItem = activePreview.item;
      const nextAliases = mergeAliases(currentItem.aliases, searchQuery.trim(), currentItem.canonical_name);
      const { error: updateError } = await supabase
        .from('cots_stock_items')
        .update({ aliases: nextAliases })
        .eq('id', currentItem.id);
      if (updateError) throw updateError;
      return currentItem.id;
    }

    const trackMode = inferTrackModeFromQuery(effectiveSearchQuery);
    const itemCategory = detectHardwareType(effectiveSearchQuery);
    const insertPayload = {
      canonical_name: effectiveSearchQuery.trim(),
      canonical_key: canonicalKeyForStock(effectiveSearchQuery),
      aliases: [],
      item_category: itemCategory,
      track_mode: trackMode,
      quantity: 0,
      created_by: user?.id || null
    };

    const { data, error: insertError } = await supabase
      .from('cots_stock_items')
      .insert(insertPayload)
      .select('id')
      .single();

    if (insertError) throw insertError;
    return data.id;
  }

  async function syncCountLocation(itemId, currentItem, amount, locationInput) {
    const existingLocation = findMatchingLocation(currentItem, locationInput);
    const currentQuantity = Number(existingLocation?.quantity) || 0;
    const nextQuantity = currentQuantity + amount;

    if (amount < 0 && !existingLocation) throw new Error('That location has no saved stock to remove.');
    if (nextQuantity < 0) throw new Error('Cannot remove more stock than exists in that location.');

    if (existingLocation && nextQuantity === 0) {
      const { error: deleteError } = await supabase.from('cots_stock_locations').delete().eq('id', existingLocation.id);
      if (deleteError) throw deleteError;
      return;
    }

    if (existingLocation) {
      const { error: updateError } = await supabase
        .from('cots_stock_locations')
        .update({ quantity: nextQuantity, stock_level: null })
        .eq('id', existingLocation.id);
      if (updateError) throw updateError;
      return;
    }

    const { error: insertError } = await supabase.from('cots_stock_locations').insert({
      item_id: itemId,
      section: locationInput.section || null,
      drawer: locationInput.drawer || null,
      subsection: locationInput.subsection || null,
      quantity: amount,
      stock_level: null,
      created_by: user?.id || null
    });
    if (insertError) throw insertError;
  }

  async function saveCountChange(direction) {
    const locationInput = getLocationInput();
    if (!hasLocationInput(locationInput)) throw new Error('Enter a section, drawer, or subsection before saving.');

    const amount = Math.max(1, Number(adjustmentQty) || 1);
    const signedAmount = direction === 'remove' ? -amount : amount;
    const itemId = await ensureItemRecord(preview);
    const currentItem = items.find((item) => item.id === itemId) || preview.item;
    const nextTotal = Math.max(0, getItemCountTotal(currentItem) + signedAmount);

    await syncCountLocation(itemId, currentItem, signedAmount, locationInput);
    await supabase.from('cots_stock_items').update({ quantity: nextTotal }).eq('id', itemId);
    await loadItems();
    selectedItemId = itemId;
    notice = direction === 'remove'
      ? `Removed ${amount} from ${effectiveSearchQuery.trim()} at ${formatLocation(locationInput)}.`
      : `Added ${amount} to ${effectiveSearchQuery.trim()} at ${formatLocation(locationInput)}.`;
  }

  async function saveLevelChange() {
    const locationInput = getLocationInput();
    if (!hasLocationInput(locationInput)) throw new Error('Enter a section, drawer, or subsection before saving.');

    const itemId = await ensureItemRecord(preview);
    const currentItem = items.find((item) => item.id === itemId) || preview.item;
    const existingLocation = findMatchingLocation(currentItem, locationInput);

    if (existingLocation) {
      const { error: updateError } = await supabase
        .from('cots_stock_locations')
        .update({ quantity: null, stock_level: stockLevelInput })
        .eq('id', existingLocation.id);
      if (updateError) throw updateError;
    } else {
      const { error: insertError } = await supabase.from('cots_stock_locations').insert({
        item_id: itemId,
        section: locationInput.section || null,
        drawer: locationInput.drawer || null,
        subsection: locationInput.subsection || null,
        quantity: null,
        stock_level: stockLevelInput,
        created_by: user?.id || null
      });
      if (insertError) throw insertError;
    }

    await supabase.from('cots_stock_items').update({ quantity: 0 }).eq('id', itemId);
    await loadItems();
    selectedItemId = itemId;
    notice = `Set ${effectiveSearchQuery.trim()} at ${formatLocation(locationInput)} to ${stockLevelInput}.`;
  }

  async function saveChange(direction = 'add') {
    clearMessages();
    if (!preview?.item || !effectiveSearchQuery.trim()) {
      error = 'Type a part name to start counting stock.';
      return;
    }

    saving = true;
    try {
      if (activeTrackMode === 'level') await saveLevelChange();
      else await saveCountChange(direction);
    } catch (err) {
      console.error('Failed to save stock change', err);
      error = err.message || 'Failed to save stock change.';
    } finally {
      saving = false;
    }
  }
</script>

<svelte:head>
  <title>COTS Stocking</title>
</svelte:head>

<div class="page-shell">
  <section class="page-header">
    <div class="header-copy">
      <div class="header-title-row">
        <h1>COTS Stocking</h1>
        <span class="header-meta">{items.length} saved parts</span>
      </div>
      <p>Track stock by location. Counted parts save exact quantities, while common hardware saves low, mid, or lots per location.</p>
    </div>
  </section>

  {#if loading}
    <section class="panel empty-state">
      <h3>Loading stock...</h3>
      <p>Pulling shared COTS inventory from Supabase.</p>
    </section>
  {:else}
    <div class="stocking-grid">
      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Find or Add a Part</h2>
            <p>Type a part name, choose a saved match if one exists, then save stock into a specific location.</p>
          </div>
        </div>

        <label class="form-label" for="stock-search">Search keywords</label>
        <div class="search-row">
          <div class="input-icon">
            <Search size={16} />
            <input id="stock-search" class="form-input" type="text" placeholder="32t gear, 10-32 bolt, 1/2 bearing..." bind:value={searchTerm} on:input={onSearchInput} on:keydown={onSearchKeydown} />
          </div>
          <input class="form-input" type="text" placeholder="Suffix" bind:value={searchSuffix} on:input={onSearchInput} on:keydown={onSearchKeydown} aria-label="Search suffix" />
        </div>

        <div class="location-grid">
          <input class="form-input" type="text" placeholder="Section" bind:value={sectionInput} list="cots-section-options" on:input={clearMessages} />
          <input class="form-input" type="text" placeholder="Drawer" bind:value={drawerInput} list="cots-drawer-options" on:input={clearMessages} />
          <input class="form-input" type="text" placeholder="Subsection" bind:value={subsectionInput} list="cots-subsection-options" on:input={clearMessages} />
        </div>

        <datalist id="cots-section-options">
          {#each sectionSuggestions as suggestion}
            <option value={suggestion}></option>
          {/each}
        </datalist>

        <datalist id="cots-drawer-options">
          {#each drawerSuggestions as suggestion}
            <option value={suggestion}></option>
          {/each}
        </datalist>

        <datalist id="cots-subsection-options">
          {#each subsectionSuggestions as suggestion}
            <option value={suggestion}></option>
          {/each}
        </datalist>

        {#if autocompleteHint}
          <p class="helper-text">Autocomplete: <strong>{autocompleteHint.completion}</strong></p>
        {/if}

        {#if matches.length > 0}
          <div class="match-list">
            {#each matches as match, index}
              <button type="button" class="match-card {selectedItemId === match.item.id ? 'selected' : ''} {highlightedIndex === index ? 'highlighted' : ''}" on:click={() => chooseMatch(match)}>
                <strong>{match.item.canonical_name}</strong>
                <span>{getItemStockSummary(match.item)} {getItemTrackMode(match.item) === 'level' ? 'stock' : 'total'}</span>
              </button>
            {/each}
          </div>
        {:else if normalizedSearch}
          <div class="match-empty">
            <strong>No saved match yet.</strong>
            <span>The next save will create a new stock item.</span>
          </div>
        {/if}
      </section>

      <section class="panel">
        <div class="panel-head">
          <div>
            <h2>Stock Counter</h2>
            <p>{activeTrackMode === 'level' ? 'Hardware parts save a level per location.' : 'Counted parts add or remove exact quantity per location.'}</p>
          </div>
        </div>

        {#if preview?.item}
          <div class="focus-card">
            <div class="focus-header">
              <div>
                <div class="eyebrow">{preview.mode === 'new' ? 'New item' : selectedItem ? 'Selected item' : 'Best match'}</div>
                <h3>{preview.item.canonical_name}</h3>
              </div>
              <span class="pill">{activeTrackMode === 'level' ? 'low / mid / lots' : 'counted'}</span>
            </div>

            {#if preview.mode === 'existing' && searchQuery.trim() && normalizeStockText(searchQuery) !== normalizeStockText(preview.item.canonical_name)}
              <p class="helper-text"><strong>{searchQuery.trim()}</strong> maps to <strong>{preview.item.canonical_name}</strong>. <button type="button" class="inline-action" on:click={createNewFromSearch} disabled={saving}>Create new part instead</button></p>
            {/if}

            {#if activeTrackMode === 'level'}
              <div class="level-row">
                {#each HARDWARE_LEVELS as level}
                  <button type="button" class="level-button {stockLevelInput === level ? 'active' : ''}" on:click={() => stockLevelInput = level} disabled={saving}>{level}</button>
                {/each}
              </div>
              <button type="button" class="btn btn-success" on:click={() => saveChange('add')} disabled={saving || !searchQuery.trim()}>Save Stock Level</button>
            {:else}
              <div class="counter-row">
                <button type="button" class="btn btn-outline-danger" on:click={() => saveChange('remove')} disabled={saving || !searchQuery.trim()}>Remove Stock</button>
                <input class="form-input counter-input" type="number" min="1" step="1" value={adjustmentQty} on:input={(event) => setAdjustmentFromInput(event.currentTarget.value)} disabled={saving} />
                <button type="button" class="btn btn-success" on:click={() => saveChange('add')} disabled={saving || !searchQuery.trim()}>Add Stock</button>
              </div>
            {/if}
          </div>
        {:else}
          <div class="empty-state">
            <Package size={22} />
            <h3>Nothing selected yet</h3>
            <p>Start typing a COTS part name to preview its current stock.</p>
          </div>
        {/if}

        {#if notice}
          <div class="message success-message"><Check size={16} /> <span>{notice}</span></div>
        {/if}

        {#if error}
          <div class="message error-message"><span>{error}</span></div>
        {/if}
      </section>
    </div>

    <section class="panel">
      <div class="panel-head inventory-head">
        <div>
          <h2>Saved Inventory</h2>
          <p>Saved stock by part and location.</p>
        </div>
      </div>

      {#if items.length === 0}
        <div class="empty-state">
          <h3>No COTS stock saved yet</h3>
          <p>Your first save will create the item and attach it to a location.</p>
        </div>
      {:else}
        <div class="inventory-table-wrap desktop-table">
          <div class="bom-table-container">
            <table class="bom-table inventory-table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Mode</th>
                  <th>Total</th>
                  <th>Locations</th>
                </tr>
              </thead>
              <tbody>
                {#each items as item}
                  <tr>
                    <td class="part-cell">
                      <button type="button" class="table-link" on:click={() => { searchTerm = item.canonical_name; searchSuffix = ''; selectedItemId = item.id; forceCreateNew = false; clearMessages(); }}>
                        {item.canonical_name}
                      </button>
                    </td>
                    <td>
                      <span class="pill pill-muted">{getItemTrackMode(item) === 'level' ? 'Level' : 'Counted'}</span>
                    </td>
                    <td class="summary-cell">
                      <strong>{getItemTrackMode(item) === 'level' ? getItemLevelSummary(item) : getItemCountTotal(item)}</strong>
                    </td>
                    <td>
                      {#if item.locations?.length}
                        <div class="location-badges">
                          {#each item.locations as location}
                            <div class="location-badge">
                              <span>{formatLocation(location)}</span>
                              <strong>{getLocationStockSummary(item, location)}</strong>
                            </div>
                          {/each}
                        </div>
                      {:else}
                        <span class="helper-text">No saved locations yet.</span>
                      {/if}
                    </td>
                  </tr>
                {/each}
              </tbody>
            </table>
          </div>
        </div>

        <div class="mobile-card-list inventory-mobile-list">
          {#each items as item}
            <article class="mobile-card inventory-mobile-card">
              <div class="inventory-mobile-top">
                <button type="button" class="table-link" on:click={() => { searchTerm = item.canonical_name; searchSuffix = ''; selectedItemId = item.id; forceCreateNew = false; clearMessages(); }}>
                  {item.canonical_name}
                </button>
                <span class="pill pill-muted">{getItemTrackMode(item) === 'level' ? 'Level' : 'Counted'}</span>
              </div>
              <div class="inventory-mobile-summary">
                <span class="helper-text">Current stock</span>
                <strong>{getItemTrackMode(item) === 'level' ? getItemLevelSummary(item) : `${getItemCountTotal(item)} total`}</strong>
              </div>
              {#if item.locations?.length}
                <div class="location-badges">
                  {#each item.locations as location}
                    <div class="location-badge">
                      <span>{formatLocation(location)}</span>
                      <strong>{getLocationStockSummary(item, location)}</strong>
                    </div>
                  {/each}
                </div>
              {:else}
                <p class="helper-text">No saved locations yet.</p>
              {/if}
            </article>
          {/each}
        </div>
      {/if}
    </section>
  {/if}
</div>

<style>
  .page-shell {
    width: 100%;
    max-width: 1280px;
    margin: 0 auto;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-bottom: var(--space-7);
  }

  .panel {
    padding: var(--space-4);
  }

  .page-header,
  .stocking-grid,
  .search-row,
  .location-grid,
  .counter-row,
  .focus-header {
    display: flex;
    gap: var(--gap-3);
  }

  .page-header,
  .focus-header {
    justify-content: space-between;
    flex-wrap: wrap;
  }

  .page-header {
    padding: 0 0 var(--space-1);
    margin-bottom: 0;
    border-bottom: 1px solid var(--border);
  }

  .header-copy {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    min-width: 0;
  }

  .header-title-row {
    display: flex;
    align-items: center;
    gap: var(--gap-3);
    flex-wrap: wrap;
  }

  .header-copy h1,
  .panel-head h2,
  .focus-header h3 {
    margin: 0;
  }

  .header-copy h1 {
    font-size: clamp(1.55rem, 2vw, 1.95rem);
    line-height: 1.1;
  }

  .header-copy p,
  .panel-head p {
    margin: 0;
    color: var(--text-muted);
  }

  .focus-card,
  .location-badge {
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: var(--space-3);
  }

  .header-meta,
  .pill,
  .level-button,
  .match-card,
  .table-link {
    border-radius: var(--radius-sm);
  }

  .header-meta {
    border: 1px solid var(--border);
    background: var(--surface-2);
    padding: 0.25rem 0.55rem;
    color: var(--text-muted);
    font-size: var(--font-xs);
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }

  .stat-label,
  .helper-text,
  .eyebrow {
    color: var(--text-muted);
    font-size: var(--font-xs);
  }

  .eyebrow {
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
  }

  .stocking-grid {
    align-items: start;
  }

  .stocking-grid > .panel {
    flex: 1 1 0;
  }

  .panel-head {
    display: flex;
    justify-content: space-between;
    align-items: flex-start;
    gap: var(--gap-3);
    margin-bottom: var(--space-3);
  }

  .inventory-head {
    margin-bottom: var(--space-2);
  }

  .search-row,
  .location-grid,
  .counter-row,
  .level-row,
  .match-list {
    display: grid;
    gap: var(--gap-2);
  }

  .search-row {
    grid-template-columns: minmax(0, 1fr) 180px;
  }

  .location-grid,
  .counter-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
    margin-top: var(--space-3);
  }

  .inventory-list,
  .match-list {
    margin-top: var(--space-3);
  }

  .input-icon {
    width: 100%;
  }

  .match-card,
  .level-button,
  .table-link {
    border: 1px solid var(--border);
    background: var(--surface-1);
    padding: 0.75rem 0.9rem;
  }

  .match-card {
    display: flex;
    justify-content: space-between;
    text-align: left;
    cursor: pointer;
  }

  .match-card.selected,
  .match-card.highlighted,
  .level-button.active {
    border-color: var(--accent);
    background: var(--accent-subtle);
  }

  .level-row {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .pill {
    display: inline-flex;
    align-items: center;
    border: 1px solid var(--border);
    background: var(--surface-1);
    padding: 0.35rem 0.6rem;
    font-size: var(--font-xs);
    font-weight: 700;
    text-transform: uppercase;
  }

  .inline-action,
  .table-link {
    cursor: pointer;
    color: var(--accent-strong);
    font: inherit;
  }

  .table-link {
    width: auto;
    text-align: left;
    background: transparent;
    padding: 0;
    border: none;
    font-weight: 600;
  }

  .message,
  .empty-state,
  .match-empty {
    margin-top: var(--space-3);
  }

  .success-message {
    color: var(--green-strong);
  }

  .error-message {
    color: var(--red-strong);
  }

  .inventory-table-wrap,
  .inventory-mobile-list {
    margin-top: var(--space-3);
  }

  .inventory-table {
    table-layout: auto;
  }

  .inventory-table-wrap .bom-table-container {
    background: var(--surface-1);
  }

  .inventory-table th {
    vertical-align: middle;
    font-size: var(--font-xs);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-muted);
    background: var(--surface-2);
  }

  .inventory-table td {
    vertical-align: top;
    padding: 0.9rem 0.75rem;
  }

  .part-cell {
    width: 28%;
  }

  .summary-cell {
    white-space: nowrap;
    font-variant-numeric: tabular-nums;
  }

  .location-badges {
    display: flex;
    flex-wrap: wrap;
    gap: var(--gap-2);
  }

  .location-badge {
    display: inline-flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
    min-width: min(100%, 220px);
    padding: 0.55rem 0.7rem;
    background: var(--surface-2);
  }

  .inventory-mobile-card {
    background: var(--color-white);
    border: 1px solid var(--border);
    border-radius: var(--radius-lg);
    padding: var(--space-4);
  }

  .inventory-mobile-top,
  .inventory-mobile-summary {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--gap-3);
  }

  .inventory-mobile-summary {
    margin: var(--space-3) 0;
    padding: var(--space-3);
    border: 1px solid var(--border);
    border-radius: var(--radius-sm);
    background: var(--surface-2);
  }

  @media (max-width: 900px) {
    .stocking-grid,
    .page-header {
      display: grid;
    }

    .search-row,
    .location-grid,
    .counter-row,
    .level-row {
      grid-template-columns: 1fr;
    }

    .location-badge {
      min-width: 100%;
    }
  }

  @media (max-width: 640px) {
    .desktop-table {
      display: none;
    }

    .inventory-mobile-list {
      display: flex;
      flex-direction: column;
      gap: var(--gap-3);
    }
  }
</style>
