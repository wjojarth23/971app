<script>
  import { createEventDispatcher } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { toastActions } from '$lib/toast.js';
  import { isManufacturingLead } from '$lib/permissions.js';
  import { X, Check, XCircle, Download, Copy, AlertTriangle, Clock, Wrench } from 'lucide-svelte';

  export let part = null;
  export let visible = false;
  export let user = null;

  const dispatch = createEventDispatcher();
  
  let loading = true;
  let autocamJob = null;
  let copied = false;
  let rejectionReason = '';
  let showRejectionForm = false;
  let processing = false;

  $: if (visible && part) {
    loadAutocamJob();
  }

  async function loadAutocamJob() {
    loading = true;
    try {
      const { data, error } = await supabase
        .from('autocam_jobs')
        .select('*')
        .eq('part_id', part.id)
        .order('created_at', { ascending: false })
        .limit(1)
        .single();
      
      if (error && error.code !== 'PGRST116') throw error;
      autocamJob = data;
    } catch (e) {
      console.error('Failed to load autocam job:', e);
      toastActions.show('Failed to load autocam data', 'error');
    } finally {
      loading = false;
    }
  }

  function close() {
    visible = false;
    showRejectionForm = false;
    rejectionReason = '';
    dispatch('close');
  }

  async function approve() {
    if (!autocamJob) return;
    if (!isManufacturingLead(user)) {
      toastActions.show('Only manufacturing leads can review autocam parts.', 'error');
      return;
    }
    processing = true;
    
    try {
      // Update the autocam job status
      await supabase
        .from('autocam_jobs')
        .update({
          status: 'approved',
          reviewed_at: new Date().toISOString()
        })
        .eq('id', autocamJob.id);
      
      // Update part status to 'cammed' (CAM Reviewed)
      await supabase
        .from('parts')
        .update({
          status: 'cammed',
          gcode_file_name: autocamJob.gcode_file_name,
          gcode_file_url: autocamJob.gcode_file_url,
          updated_at: new Date().toISOString()
        })
        .eq('id', part.id);
      
      // Update router_meta to cammed step
      const meta = parseFileMeta(part);
      meta.router_meta = { ...(meta.router_meta || {}), step: 'cammed', autocam_approved: true };
      await supabase
        .from('parts')
        .update({ file_url: JSON.stringify(meta) })
        .eq('id', part.id);
      
      toastActions.show('Autocam approved! Part is now CAM Reviewed.');
      dispatch('update');
      close();
    } catch (e) {
      console.error('Failed to approve:', e);
      toastActions.show('Failed to approve autocam', 'error');
    } finally {
      processing = false;
    }
  }

  async function reject() {
    if (!autocamJob) return;
    if (!isManufacturingLead(user)) {
      toastActions.show('Only manufacturing leads can review autocam parts.', 'error');
      return;
    }
    
    if (!showRejectionForm) {
      showRejectionForm = true;
      return;
    }
    
    processing = true;
    
    try {
      // Update the autocam job status
      await supabase
        .from('autocam_jobs')
        .update({
          status: 'rejected',
          reviewed_at: new Date().toISOString(),
          rejection_reason: rejectionReason || 'Manual CAM required'
        })
        .eq('id', autocamJob.id);
      
      // Update part status to 'in-progress' for manual CAM
      await supabase
        .from('parts')
        .update({
          status: 'in-progress',
          updated_at: new Date().toISOString()
        })
        .eq('id', part.id);
      
      // Update router_meta to cam_ing step (manual CAM workflow)
      const meta = parseFileMeta(part);
      meta.router_meta = { ...(meta.router_meta || {}), step: 'cam_ing', autocam_rejected: true };
      await supabase
        .from('parts')
        .update({ file_url: JSON.stringify(meta) })
        .eq('id', part.id);
      
      toastActions.show('Autocam rejected. Part returned to manual CAM workflow.');
      dispatch('update');
      close();
    } catch (e) {
      console.error('Failed to reject:', e);
      toastActions.show('Failed to reject autocam', 'error');
    } finally {
      processing = false;
    }
  }

  function parseFileMeta(p) {
    try { return JSON.parse(p?.file_url || '{}') || {}; } catch { return {}; }
  }

  function copyGcode() {
    if (!autocamJob?.gcode) return;
    navigator.clipboard.writeText(autocamJob.gcode);
    copied = true;
    setTimeout(() => copied = false, 2000);
  }

  function downloadGcode() {
    if (!autocamJob?.gcode) return;
    const blob = new Blob([autocamJob.gcode], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = autocamJob.gcode_file_name || `${part.name || 'part'}.nc`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function formatDuration(ms) {
    if (!ms) return '-';
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(1)}s`;
  }
</script>

{#if visible}
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="modal-overlay" on:click={close} on:keydown={(e) => e.key === 'Escape' && close()} role="presentation">
    <!-- svelte-ignore a11y_click_events_have_key_events -->
    <div class="modal" on:click|stopPropagation role="dialog" aria-modal="true" tabindex="-1">
      <div class="modal-header">
        <h2>
          <Wrench size={20} />
          Review Autocam: {part?.name}
        </h2>
        <button class="btn btn-ghost btn-icon" on:click={close}>
          <X size={20} />
        </button>
      </div>
      
      <div class="modal-body">
        {#if loading}
          <div class="loading">Loading autocam data...</div>
        {:else if !autocamJob}
          <div class="error">
            <AlertTriangle size={24} />
            <p>No autocam job found for this part.</p>
          </div>
        {:else}
          <!-- Job Info -->
          <div class="info-grid">
            <div class="info-item">
              <span class="label">Status</span>
              <span class="value status-{autocamJob.status}">{autocamJob.status}</span>
            </div>
            <div class="info-item">
              <span class="label">Processing Time</span>
              <span class="value"><Clock size={14} /> {formatDuration(autocamJob.processing_time_ms)}</span>
            </div>
            {#if autocamJob.stats?.num_holes !== undefined}
              <div class="info-item">
                <span class="label">Holes</span>
                <span class="value">{autocamJob.stats.num_holes}</span>
              </div>
            {/if}
            {#if autocamJob.stats?.num_pockets !== undefined}
              <div class="info-item">
                <span class="label">Pockets</span>
                <span class="value">{autocamJob.stats.num_pockets}</span>
              </div>
            {/if}
            {#if autocamJob.stats?.has_perimeter !== undefined}
              <div class="info-item">
                <span class="label">Perimeter</span>
                <span class="value">{autocamJob.stats.has_perimeter ? 'Yes' : 'No'}</span>
              </div>
            {/if}
            {#if autocamJob.stats?.cycle_time_display}
              <div class="info-item">
                <span class="label">Est. Cycle Time</span>
                <span class="value">{autocamJob.stats.cycle_time_display}</span>
              </div>
            {/if}
          </div>
          
          <!-- Warnings/Errors -->
          {#if autocamJob.warnings?.length > 0}
            <div class="warnings">
              <strong><AlertTriangle size={14} /> Warnings:</strong>
              <ul>
                {#each autocamJob.warnings as warning}
                  <li>{warning}</li>
                {/each}
              </ul>
            </div>
          {/if}
          
          {#if autocamJob.errors?.length > 0}
            <div class="errors">
              <strong>Errors:</strong>
              <ul>
                {#each autocamJob.errors as error}
                  <li>{error}</li>
                {/each}
              </ul>
            </div>
          {/if}
          
          <!-- G-code Preview -->
          <div class="gcode-section">
            <div class="gcode-header">
              <h3>G-code Preview</h3>
              <div class="gcode-actions">
                <button class="btn btn-ghost btn-sm" on:click={copyGcode}>
                  <Copy size={14} /> {copied ? 'Copied!' : 'Copy'}
                </button>
                <button class="btn btn-ghost btn-sm" on:click={downloadGcode}>
                  <Download size={14} /> Download
                </button>
              </div>
            </div>
            <pre class="gcode-preview">{autocamJob.gcode?.slice(0, 3000) || 'No G-code generated'}{autocamJob.gcode?.length > 3000 ? '\n\n... (truncated, download for full file)' : ''}</pre>
          </div>
          
          <!-- Rejection Form -->
          {#if showRejectionForm}
            <div class="rejection-form">
              <label for="rejectionReason">Rejection Reason (optional)</label>
              <textarea 
                id="rejectionReason"
                bind:value={rejectionReason}
                placeholder="e.g., Complex pockets need manual optimization, Incorrect toolpath order..."
                rows="3"
              ></textarea>
            </div>
          {/if}
        {/if}
      </div>
      
      {#if !loading && autocamJob}
        <div class="modal-footer">
          <button 
            class="btn btn-danger" 
            on:click={reject}
            disabled={processing || !isManufacturingLead(user)}
          >
            <XCircle size={16} />
            {showRejectionForm ? 'Confirm Reject' : 'Reject (Manual CAM)'}
          </button>
          
          {#if showRejectionForm}
            <button 
              class="btn btn-secondary"
              on:click={() => showRejectionForm = false}
              disabled={processing}
            >
              Cancel
            </button>
          {/if}
          
          <button 
            class="btn btn-success" 
            on:click={approve}
            disabled={processing || showRejectionForm || !isManufacturingLead(user)}
          >
            <Check size={16} /> Approve
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .modal-overlay {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.6);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 1000;
    padding: 1rem;
  }
  
  .modal {
    background: var(--surface);
    border-radius: 12px;
    width: 100%;
    max-width: 800px;
    max-height: 90vh;
    display: flex;
    flex-direction: column;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.3);
  }
  
  .modal-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 1.5rem;
    border-bottom: 1px solid var(--border);
  }
  
  .modal-header h2 {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin: 0;
    font-size: 1.1rem;
  }
  
  .modal-body {
    padding: 1.5rem;
    overflow-y: auto;
    flex: 1;
  }
  
  .modal-footer {
    display: flex;
    justify-content: flex-end;
    gap: 0.75rem;
    padding: 1rem 1.5rem;
    border-top: 1px solid var(--border);
  }
  
  .info-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 1rem;
    margin-bottom: 1rem;
  }
  
  .info-item {
    background: var(--background);
    padding: 0.75rem;
    border-radius: 6px;
  }
  
  .info-item .label {
    display: block;
    font-size: 0.75rem;
    color: var(--text-secondary);
    margin-bottom: 0.25rem;
  }
  
  .info-item .value {
    font-weight: 500;
    display: flex;
    align-items: center;
    gap: 0.25rem;
  }
  
  .status-pending { color: var(--warning); }
  .status-processing { color: var(--info); }
  .status-completed { color: var(--success); }
  .status-failed { color: var(--danger); }
  .status-approved { color: var(--success); }
  .status-rejected { color: var(--danger); }
  
  .warnings, .errors {
    padding: 0.75rem;
    border-radius: 6px;
    margin-bottom: 1rem;
    font-size: 0.85rem;
  }
  
  .warnings {
    background: rgba(245, 158, 11, 0.1);
    color: var(--warning);
  }
  
  .errors {
    background: rgba(239, 68, 68, 0.1);
    color: var(--danger);
  }
  
  .warnings ul, .errors ul {
    margin: 0.5rem 0 0 1.25rem;
    padding: 0;
  }
  
  .gcode-section {
    margin-top: 1rem;
  }
  
  .gcode-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 0.5rem;
  }
  
  .gcode-header h3 {
    margin: 0;
    font-size: 0.95rem;
  }
  
  .gcode-actions {
    display: flex;
    gap: 0.5rem;
  }
  
  .gcode-preview {
    background: #1a1a2e;
    color: #eee;
    padding: 1rem;
    border-radius: 6px;
    font-family: 'Fira Code', 'Monaco', monospace;
    font-size: 0.75rem;
    line-height: 1.4;
    max-height: 300px;
    overflow: auto;
    white-space: pre-wrap;
    word-break: break-all;
  }
  
  .rejection-form {
    margin-top: 1rem;
    padding: 1rem;
    background: rgba(239, 68, 68, 0.05);
    border: 1px solid rgba(239, 68, 68, 0.2);
    border-radius: 6px;
  }
  
  .rejection-form label {
    display: block;
    font-weight: 500;
    margin-bottom: 0.5rem;
  }
  
  .rejection-form textarea {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--background);
    color: var(--text);
    resize: vertical;
  }
  
  .loading, .error {
    text-align: center;
    padding: 2rem;
    color: var(--text-secondary);
  }
  
  .error {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
    color: var(--danger);
  }
  
  .btn-success {
    background: var(--success);
    color: white;
  }
  
  .btn-danger {
    background: var(--danger);
    color: white;
  }
  
  .btn-icon {
    padding: 0.25rem;
  }
</style>
