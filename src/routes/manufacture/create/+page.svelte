<script>
  import { goto } from '$app/navigation';
  import { supabase } from '$lib/supabase.js';
  import { Upload, FileText, Wrench, Zap } from 'lucide-svelte';
  
  let partName = '';
  let requesterName = '';
  let projectId = '';
  let workflow = '';
  let quantity = 1;
  let stockAssignment = '';
  let customStock = '';
  let uploadedFile = null;
  let uploadedStepFile = null;
  let uploadedDXFFile = null;
  let isSubmitting = false;

  // Router: if selected stock is tube, DXF not required
  $: stockIsTube = (() => {
    if (workflow === 'router' && stockAssignment && stockAssignment !== '__other__') {
      const s = (stockOptions || []).find(s => s.description === stockAssignment);
      return Boolean(s && s.isTube);
    }
    return false;
  })();

  // For non-router: need one file. For router: need STEP and DXF unless tube (DXF optional)
  $: hasRequiredFiles = workflow === 'router'
    ? (!!uploadedStepFile && (stockIsTube ? true : !!uploadedDXFFile))
    : !!uploadedFile;

  const workflows = [
    { id: 'laser-cut', name: 'Laser Cut', fileType: 'svg', icon: Zap, color: 'workflow-laser' },
    { id: 'router', name: 'Router', fileType: 'step', icon: Wrench, color: 'workflow-router' },
    { id: 'lathe', name: 'Lathe', fileType: 'pdf', icon: FileText, color: 'workflow-lathe' },
    { id: 'mill', name: 'Mill', fileType: 'pdf', icon: FileText, color: 'workflow-mill' },
    { id: '3d-print', name: '3D Print', fileType: 'stl', icon: Upload, color: 'workflow-3d-print' }
  ];

  $: selectedWorkflow = workflows.find(w => w.id === workflow);
  $: requiredFileType = selectedWorkflow?.fileType || '';
  import stockData from '$lib/stock.json';
  $: stockOptions = workflow ? (stockData[workflow] || []) : [];

  // No material field: parts list only tracks stock_assignment.

  function handleFileUpload(event) {
    const file = event.target.files[0];
    if (file) {
      const fileExtension = file.name.split('.').pop().toLowerCase();
      if (requiredFileType && fileExtension !== requiredFileType) {
        alert(`Please upload a ${requiredFileType.toUpperCase()} file for ${selectedWorkflow.name} workflow.`);
        event.target.value = '';
        return;
      }
      uploadedFile = file;
    }
  }

  // Fix for Vercel deployment - ensure functions are properly scoped
  function handleDragOver(event) {
    event.preventDefault();
    event.currentTarget.classList.add('active');
  }

  function handleDragLeave(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('active');
  }

  function handleDrop(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('active');
    
    const files = event.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      const fileExtension = file.name.split('.').pop().toLowerCase();
      if (requiredFileType && fileExtension !== requiredFileType) {
        alert(`Please upload a ${requiredFileType.toUpperCase()} file for ${selectedWorkflow.name} workflow.`);
        return;
      }
      uploadedFile = file;
    }
  }

  // Router-specific STEP + DXF handlers
  function handleStepUpload(event) {
    const file = event.target.files[0];
    if (file) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['step', 'stp'].includes(ext)) {
        alert('Please upload a STEP (.step or .stp) file.');
        event.target.value = '';
        return;
      }
      uploadedStepFile = file;
    }
  }
  function handleDXFUpload(event) {
    const file = event.target.files[0];
    if (file) {
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext !== 'dxf') {
        alert('Please upload a DXF (.dxf) file.');
        event.target.value = '';
        return;
      }
      uploadedDXFFile = file;
    }
  }
  // Handle drag-and-drop for STEP and DXF zones
  function handleDropStep(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('active');
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      const ext = file.name.split('.').pop().toLowerCase();
      if (!['step', 'stp'].includes(ext)) {
        alert('Please drop a STEP (.step or .stp) file.');
        return;
      }
      uploadedStepFile = file;
    }
  }
  function handleDropDXF(event) {
    event.preventDefault();
    event.currentTarget.classList.remove('active');
    const files = event.dataTransfer?.files;
    if (files && files.length > 0) {
      const file = files[0];
      const ext = file.name.split('.').pop().toLowerCase();
      if (ext !== 'dxf') {
        alert('Please drop a DXF (.dxf) file.');
        return;
      }
      uploadedDXFFile = file;
    }
  }
  function sanitizeName(n) { return (n || 'part').replace(/[^a-zA-Z0-9]/g, '_'); }

  async function handleSubmitGeneric() {
    const effectiveStock = stockAssignment === '__other__' ? customStock.trim() : stockAssignment;
    if (!partName || !requesterName || !projectId || !workflow || !uploadedFile || !quantity || quantity < 1 || !effectiveStock) {
      alert('Please fill in all fields, select a stock, upload a file, and specify a valid quantity.');
      return;
    }

    isSubmitting = true;
    try {
      const fileExt = uploadedFile.name.split('.').pop();
      const fileName = `${Date.now()}_${sanitizeName(partName)}.${fileExt}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('manufacturing-files')
        .upload(fileName, uploadedFile, { cacheControl: '3600', upsert: false });
      if (uploadError) throw uploadError;

  const { error: insertError } = await supabase
        .from('parts')
        .insert([{
          name: partName,
          requester: requesterName,
          project_id: projectId,
          workflow: workflow,
          quantity: quantity,
          stock_assignment: effectiveStock,
          file_name: fileName,
          file_url: fileName,
          status: 'pending'
        }]);
      if (insertError) throw insertError;

      // Reset
      partName = '';
      requesterName = '';
      projectId = '';
      workflow = '';
      quantity = 1;
  stockAssignment = '';
  customStock = '';
      uploadedFile = null;

      goto('/manufacture');
    } catch (error) {
      console.error('Submission error:', error);
      alert(`Error submitting part: ${error.message}`);
    } finally {
      isSubmitting = false;
    }
  }

  async function handleSubmitRouter() {
    const effectiveStock = stockAssignment === '__other__' ? customStock.trim() : stockAssignment;
    if (!partName || !requesterName || !projectId || !workflow || !quantity || quantity < 1 || !effectiveStock) {
      alert('Please fill in all fields and specify a valid quantity.');
      return;
    }
    if (!uploadedStepFile) {
      alert('Router parts require a STEP file.');
      return;
    }
    if (!stockIsTube && !uploadedDXFFile) {
      alert('DXF file is required for non-tube router stock.');
      return;
    }

    isSubmitting = true;
    try {
      const base = `${Date.now()}_${sanitizeName(partName)}`;
      // STEP
      const stepExt = uploadedStepFile.name.split('.').pop();
      const stepName = `${base}.${stepExt}`;
      const { error: stepErr } = await supabase.storage
        .from('manufacturing-files')
        .upload(stepName, uploadedStepFile, { cacheControl: '3600', upsert: false });
      if (stepErr) throw stepErr;

      // DXF (optional for tube)
      let dxfName = null;
      if (uploadedDXFFile) {
        const dxfExt = uploadedDXFFile.name.split('.').pop();
        dxfName = `${base}.${dxfExt}`;
        const { error: dxfErr } = await supabase.storage
          .from('manufacturing-files')
          .upload(dxfName, uploadedDXFFile, { cacheControl: '3600', upsert: false });
        if (dxfErr) throw dxfErr;
      }

      const fileMeta = { step_file: stepName, dxf_file: dxfName };
  const { error: insertError } = await supabase
        .from('parts')
        .insert([{
          name: partName,
          requester: requesterName,
          project_id: projectId,
          workflow: workflow,
          quantity: quantity,
          stock_assignment: effectiveStock,
          file_name: stepName, // keep for backward compat
          file_url: JSON.stringify(fileMeta),
          status: 'pending'
        }]);
      if (insertError) throw insertError;

      // Reset
      partName = '';
      requesterName = '';
      projectId = '';
      workflow = '';
      quantity = 1;
  stockAssignment = '';
  customStock = '';
      uploadedStepFile = null;
      uploadedDXFFile = null;
      uploadedFile = null;

      goto('/manufacture');
    } catch (error) {
      console.error('Submission error:', error);
      alert(`Error submitting part: ${error.message}`);
    } finally {
      isSubmitting = false;
    }
  }

  async function handleSubmit() {
    if (workflow === 'router') {
      return await handleSubmitRouter();
    }
    return await handleSubmitGeneric();
  }
</script>

<svelte:head>
  <title>Create New Part - 971 Manufacturing</title>
</svelte:head>

<div class="container">
  <div class="header">
    <h1>971 Manufacturing Request</h1>
    <p>Submit your manufacturing requests for processing</p>
  </div>

  <div class="form-container">
    <form on:submit|preventDefault={handleSubmit} class="manufacturing-form">
      <!-- Basic Information -->
      <div class="form-section">
        <h2>Part Information</h2>
        
        <div class="form-group">
          <label for="partName">Part Name</label>
          <input 
            id="partName"
            type="text" 
            bind:value={partName} 
            placeholder="Enter part name"
            required
          />
        </div>

        <div class="form-group">
          <label for="requesterName">Requester Name</label>
          <input 
            id="requesterName"
            type="text" 
            bind:value={requesterName} 
            placeholder="Enter your name"
            required
          />
        </div>

        <div class="form-group">
          <label for="projectId">Project ID</label>
          <input 
            id="projectId"
            type="text" 
            bind:value={projectId} 
            placeholder="Enter project ID"
            required
          />
        </div>

        <div class="form-group">
          <label for="quantity">Quantity</label>
          <input 
            id="quantity"
            type="number" 
            bind:value={quantity} 
            min="1"
            placeholder="Enter quantity"
            required
          />
        </div>
      </div>

      <!-- Workflow Selection -->
      <div class="form-section">
        <h2>Manufacturing Process</h2>
        
        <div class="workflow-grid">
          {#each workflows as workflowOption}
            <label class="workflow-card {workflow === workflowOption.id ? 'selected' : ''} {workflowOption.color}">
              <input 
                type="radio" 
                bind:group={workflow} 
                value={workflowOption.id}
                on:change={() => { stockAssignment = ''; customStock = ''; uploadedFile = null; uploadedStepFile = null; uploadedDXFFile = null; }}
              />
              <div class="workflow-content">
                <svelte:component this={workflowOption.icon} size={24} />
                <span class="workflow-name">{workflowOption.name}</span>
                <span class="workflow-file-type">.{workflowOption.fileType}</span>
              </div>
            </label>
          {/each}
        </div>
      </div>

      <!-- Stock Selection -->
      {#if stockOptions.length > 0}
        <div class="form-section">
          <h2>Stock Selection</h2>
          <div class="form-group">
            <label for="stock">Stock</label>
            <select id="stock" bind:value={stockAssignment} required>
              <option value="">Select stock</option>
              {#each stockOptions as s}
                <option value={s.description}>{s.description}</option>
              {/each}
              <option value="__other__">Other...</option>
            </select>
          </div>
          {#if stockAssignment === '__other__'}
            <div class="form-group">
              <label for="customStock">Custom Stock</label>
              <input id="customStock" type="text" bind:value={customStock} placeholder="Type custom stock" required />
            </div>
          {/if}
        </div>
      {/if}



      <!-- File Upload -->
      {#if workflow}
        <div class="form-section">
          <h2>File Upload</h2>
          {#if workflow === 'router'}
            <div class="upload-container">
              <div 
                class="file-drop-zone {uploadedStepFile ? 'has-file' : ''}"
                role="button"
                tabindex="0"
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDropStep}
                on:click={() => document.getElementById('step-input').click()}
                on:keydown={(e) => e.key === 'Enter' && document.getElementById('step-input').click()}
              >
                <input 
                  id="step-input"
                  type="file" 
                  accept=".step,.stp"
                  on:change={handleStepUpload}
                  style="display: none;"
                />
                
                {#if uploadedStepFile}
                  <div class="uploaded-file">
                    <FileText size={48} />
                    <span class="file-name">{uploadedStepFile.name}</span>
                    <span class="file-size">{(uploadedStepFile.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                {:else}
                  <div class="upload-prompt">
                    <Upload size={48} />
                    <span class="upload-text">Drop STEP (.step/.stp) here or click to browse</span>
                    <span class="upload-subtext">Required</span>
                  </div>
                {/if}
              </div>
            </div>

            <div class="upload-container" style="margin-top: 0.75rem;">
              <div 
                class="file-drop-zone {uploadedDXFFile ? 'has-file' : ''}"
                role="button"
                tabindex="0"
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDropDXF}
                on:click={() => document.getElementById('dxf-input').click()}
                on:keydown={(e) => e.key === 'Enter' && document.getElementById('dxf-input').click()}
              >
                <input 
                  id="dxf-input"
                  type="file" 
                  accept=".dxf"
                  on:change={handleDXFUpload}
                  style="display: none;"
                />
                
                {#if uploadedDXFFile}
                  <div class="uploaded-file">
                    <FileText size={48} />
                    <span class="file-name">{uploadedDXFFile.name}</span>
                    <span class="file-size">{(uploadedDXFFile.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                {:else}
                  <div class="upload-prompt">
                    <Upload size={48} />
                    <span class="upload-text">Drop DXF (.dxf) here or click to browse</span>
                    <span class="upload-subtext">{stockIsTube ? 'Optional for tube stock' : 'Required'}</span>
                  </div>
                {/if}
              </div>
            </div>
          {:else}
            <div class="upload-container">
              <div 
                class="file-drop-zone {uploadedFile ? 'has-file' : ''}"
                role="button"
                tabindex="0"
                on:dragover={handleDragOver}
                on:dragleave={handleDragLeave}
                on:drop={handleDrop}
                on:click={() => document.getElementById('file-input').click()}
                on:keydown={(e) => e.key === 'Enter' && document.getElementById('file-input').click()}
              >
                <input 
                  id="file-input"
                  type="file" 
                  accept=".{requiredFileType}"
                  on:change={handleFileUpload}
                  style="display: none;"
                />
                
                {#if uploadedFile}
                  <div class="uploaded-file">
                    <FileText size={48} />
                    <span class="file-name">{uploadedFile.name}</span>
                    <span class="file-size">{(uploadedFile.size / 1024 / 1024).toFixed(2)} MB</span>
                  </div>
                {:else}
                  <div class="upload-prompt">
                    <Upload size={48} />
                    <span class="upload-text">Drop your {requiredFileType.toUpperCase()} file here or click to browse</span>
                    <span class="upload-subtext">Required file type: .{requiredFileType}</span>
                  </div>
                {/if}
              </div>
            </div>
          {/if}
        </div>
      {/if}

      <!-- Submit Button -->
      <div class="form-actions">
        <button 
          type="submit" 
          class="submit-btn" 
          disabled={isSubmitting || !partName || !requesterName || !projectId || !workflow || !hasRequiredFiles || !quantity || quantity < 1}
        >
          {#if isSubmitting}
            Submitting...
          {:else}
            Submit Manufacturing Request
          {/if}
        </button>
      </div>
    </form>
  </div>
</div>

<style>
  .header {
    margin-bottom: 2rem;
  }

  .header h1 {
    margin-bottom: 0.5rem;
  }

  .header p {
    color: #666;
    margin-bottom: 0;
  }

  .form-container {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: 4px;
    padding: 1.5rem;
    margin-bottom: 1rem;
  }

  /* .manufacturing-form wrapper uses container padding; no extra rules needed */

  .form-section {
    margin-bottom: 2rem;
  }

  .form-section h2 {
    margin-bottom: 1rem;
    font-size: 1.25rem;
    font-weight: 600;
  }

  .form-group {
    margin-bottom: 1rem;
  }

  .form-group label {
    display: block;
    margin-bottom: 0.5rem;
    font-weight: 500;
  }

  .form-group input,
  .form-group select {
    width: 100%;
    padding: 0.75rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    font-size: 1rem;
  }

  .form-group input:focus,
  .form-group select:focus {
    outline: none;
    border-color: var(--accent);
  }

  .workflow-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(150px, 1fr));
    gap: 1rem;
  }

  .workflow-card {
    display: block;
    padding: 1rem;
    border: 1px solid var(--border);
    border-radius: 4px;
    cursor: pointer;
    position: relative;
    background: var(--primary);
  }

  .workflow-card input {
    position: absolute;
    opacity: 0;
    pointer-events: none;
  }

  .workflow-card:hover {
    border-color: var(--accent);
  }

  .workflow-card.selected {
    border-color: var(--accent);
    background-color: rgba(241, 195, 49, 0.1);
  }

  .workflow-content {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .workflow-name {
    font-weight: 600;
  }

  .workflow-file-type {
    font-size: 0.875rem;
    color: #666;
    background: var(--background);
    padding: 0.25rem 0.5rem;
    border-radius: 4px;
  }

  .upload-container {
    margin-top: 1rem;
  }

  .file-drop-zone {
    border: 1px dashed var(--border);
    border-radius: 4px;
    padding: 2rem;
    text-align: center;
    cursor: pointer;
    background: var(--background);
  }

  .file-drop-zone:hover,
  .file-drop-zone.active {
    border-color: var(--accent);
  }

  .file-drop-zone.has-file {
    border-color: var(--success);
  }

  .upload-prompt,
  .uploaded-file {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.5rem;
  }

  .upload-text {
    font-weight: 500;
  }

  .upload-subtext {
    font-size: 0.875rem;
    color: #666;
  }

  .file-name {
    font-weight: 600;
    color: var(--success);
  }

  .file-size {
    font-size: 0.875rem;
    color: #666;
  }

  .form-actions {
    margin-top: 2rem;
    text-align: center;
  }

  .submit-btn {
    background: var(--accent);
    color: var(--secondary);
    border: none;
    padding: 0.75rem 1.5rem;
    border-radius: 4px;
    font-size: 1rem;
    font-weight: 600;
    cursor: pointer;
  }

  .submit-btn:hover:not(:disabled) {
    opacity: 0.9;
  }

  .submit-btn:disabled {
    background: #ccc;
    cursor: not-allowed;
  }

  @media (max-width: 640px) {
    .workflow-grid {
      grid-template-columns: 1fr;
    }
  }
</style>
