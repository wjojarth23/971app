<script>
  import { marked } from 'marked';
  import { page } from '$app/stores';
  import { goto } from '$app/navigation';
  import { FileText, Search, Folder, FolderOpen } from 'lucide-svelte';

  export let data;

  $: files = data.files;

  let search = '';

  $: filtered = search.trim()
    ? files.filter((f) => f.path.toLowerCase().includes(search.trim().toLowerCase()))
    : files;

  // Grouped by folder, in first-seen order (files already arrive sorted by
  // full path, so this naturally groups + orders folders alphabetically too).
  $: groups = filtered.reduce((acc, f) => {
    let group = acc.find((g) => g.folder === f.folder);
    if (!group) { group = { folder: f.folder, files: [] }; acc.push(group); }
    group.files.push(f);
    return acc;
  }, []);

  $: selectedPath = $page.url.searchParams.get('file') || '';
  $: selected = files.find((f) => f.path === selectedPath) || null;
  $: renderedHtml = selected ? marked.parse(selected.content) : '';

  let openFolders = new Set();
  $: {
    // Auto-expand the folder containing the currently selected file, and
    // every folder once a search narrows things down (so matches are never
    // hidden inside a collapsed group).
    if (selected) openFolders.add(selected.folder);
    if (search.trim()) for (const g of groups) openFolders.add(g.folder);
    openFolders = openFolders;
  }

  function toggleFolder(folder) {
    if (openFolders.has(folder)) openFolders.delete(folder);
    else openFolders.add(folder);
    openFolders = openFolders;
  }

  function selectFile(path) {
    const url = new URL($page.url);
    url.searchParams.set('file', path);
    goto(url, { keepFocus: true, noScroll: true });
  }
</script>

<svelte:head>
  <title>Docs{selected ? ` - ${selected.label}` : ''}</title>
</svelte:head>

<div class="page-header">
  <div class="header-content">
    <h1>Docs</h1>
    <p>Every markdown file in the codebase - {files.length} total.</p>
  </div>
</div>

<div class="docs-layout">
  <aside class="docs-finder surface-card">
    <div class="docs-search">
      <Search size={16} />
      <input
        class="form-input"
        type="text"
        placeholder="Filter by path..."
        bind:value={search}
      />
    </div>
    <nav class="docs-tree">
      {#if groups.length === 0}
        <p class="empty">No files match "{search}".</p>
      {/if}
      {#each groups as group (group.folder)}
        <div class="docs-folder">
          <button type="button" class="docs-folder-header" on:click={() => toggleFolder(group.folder)}>
            {#if openFolders.has(group.folder)}
              <FolderOpen size={15} />
            {:else}
              <Folder size={15} />
            {/if}
            <span class="mono">{group.folder}</span>
            <span class="text-muted">({group.files.length})</span>
          </button>
          {#if openFolders.has(group.folder)}
            <ul class="docs-file-list">
              {#each group.files as f (f.path)}
                <li>
                  <button
                    type="button"
                    class="docs-file-item"
                    class:active={selectedPath === f.path}
                    on:click={() => selectFile(f.path)}
                  >
                    <FileText size={14} />
                    {f.label}
                  </button>
                </li>
              {/each}
            </ul>
          {/if}
        </div>
      {/each}
    </nav>
  </aside>

  <main class="docs-viewer surface-card">
    {#if !selected}
      <div class="empty-state">
        <FileText size={40} />
        <h3>Pick a file</h3>
        <p>Choose a document from the finder on the left to read it.</p>
      </div>
    {:else}
      <div class="docs-viewer-header">
        <h2>{selected.label}</h2>
        <span class="text-muted mono">{selected.path}</span>
      </div>
      <div class="docs-markdown">
        {@html renderedHtml}
      </div>
    {/if}
  </main>
</div>

<style>
  .docs-layout {
    display: grid;
    grid-template-columns: minmax(220px, 320px) 1fr;
    gap: var(--gap-4);
    align-items: start;
    min-height: 60vh;
  }

  @media (max-width: 800px) {
    .docs-layout { grid-template-columns: 1fr; }
  }

  .docs-finder {
    padding: var(--space-3);
    position: sticky;
    top: var(--space-3);
    max-height: calc(100vh - 6rem);
    overflow-y: auto;
  }

  .docs-search {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    margin-bottom: var(--space-3);
    color: var(--text-muted);
  }
  .docs-search .form-input { flex: 1; }

  .docs-tree { display: flex; flex-direction: column; gap: var(--space-1); }

  .docs-folder-header {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    width: 100%;
    padding: var(--space-2);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-xs);
    text-align: left;
    color: var(--text);
  }
  .docs-folder-header:hover { background: var(--surface-2); }

  .docs-file-list {
    list-style: none;
    margin: 0 0 var(--space-2) 0;
    padding: 0 0 0 var(--space-5);
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .docs-file-item {
    display: flex;
    align-items: center;
    gap: var(--gap-2);
    width: 100%;
    padding: var(--space-1) var(--space-2);
    background: none;
    border: none;
    border-radius: var(--radius-sm);
    cursor: pointer;
    font-size: var(--font-xs);
    text-align: left;
    color: var(--text);
  }
  .docs-file-item:hover { background: var(--surface-2); }
  .docs-file-item.active { background: var(--accent); color: var(--secondary); font-weight: 600; }

  .docs-viewer {
    padding: var(--space-5);
    min-height: 60vh;
  }

  .docs-viewer-header {
    display: flex;
    align-items: baseline;
    gap: var(--gap-3);
    flex-wrap: wrap;
    border-bottom: 1px solid var(--border);
    padding-bottom: var(--space-3);
    margin-bottom: var(--space-4);
  }
  .docs-viewer-header h2 { margin: 0; }

  /* Markdown content - scoped, minimal styling that leans on the app's own
     type/color variables instead of inventing a separate look. */
  .docs-markdown :global(h1),
  .docs-markdown :global(h2),
  .docs-markdown :global(h3) {
    margin-top: var(--space-5);
    margin-bottom: var(--space-2);
    color: var(--secondary);
  }
  .docs-markdown :global(h1:first-child),
  .docs-markdown :global(h2:first-child),
  .docs-markdown :global(h3:first-child) {
    margin-top: 0;
  }
  .docs-markdown :global(p) { line-height: 1.6; margin: var(--space-2) 0; }
  .docs-markdown :global(ul),
  .docs-markdown :global(ol) { padding-left: var(--space-5); line-height: 1.6; }
  .docs-markdown :global(code) {
    font-family: var(--font-mono-stack);
    background: var(--surface-2);
    padding: 0.1em 0.35em;
    border-radius: var(--radius-sm);
    font-size: 0.85em;
  }
  .docs-markdown :global(pre) {
    background: var(--surface-2);
    padding: var(--space-3);
    border-radius: var(--radius-md);
    overflow-x: auto;
  }
  .docs-markdown :global(pre code) { background: none; padding: 0; }
  .docs-markdown :global(blockquote) {
    border-left: 3px solid var(--border);
    margin: var(--space-3) 0;
    padding: var(--space-1) var(--space-3);
    color: var(--text-muted);
  }
  .docs-markdown :global(table) { border-collapse: collapse; width: 100%; margin: var(--space-3) 0; }
  .docs-markdown :global(th),
  .docs-markdown :global(td) { border: 1px solid var(--border); padding: var(--space-2); text-align: left; }
  .docs-markdown :global(a) { color: var(--accent); }
</style>
