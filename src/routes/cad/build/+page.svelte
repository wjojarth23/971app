<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore } from '$lib/stores/user.js';
  import { Settings, Package, Wrench, CheckCircle, Clock, ExternalLink } from 'lucide-svelte';
  import { goto } from '$app/navigation';

  let user = null;
  let loading = true;
  let builds = [];
  let buildStats = {
    total: 0,
    pending: 0,
    ready_to_assemble: 0,
    assembled: 0
  };

  onMount(async () => {
    // Check authentication
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      goto('/');
      return;
    }

    // Get user profile
    userStore.subscribe(value => {
      user = value;
      loading = false;
    });

    await loadBuilds();
  });  async function loadBuilds() {
    try {
      const { data, error } = await supabase
        .from('builds')
        .select(`
          *,
          subsystems(name, onshape_url)
        `)
        .order('created_at', { ascending: false });

      if (error) throw error;
      builds = data || [];
      
      // Get parts data for each build
      for (const build of builds) {
        if (build.part_ids && build.part_ids.length > 0) {
          // Get parts from parts table
          const { data: partsData, error: partsError } = await supabase
            .from('parts')
            .select('*')
            .in('id', build.part_ids);

          if (!partsError) {
            build.parts = partsData || [];
          }

          // Get purchasing data (COTS parts might be in purchasing table)
          const { data: purchasingData, error: purchasingError } = await supabase
            .from('purchasing')
            .select('*')
            .in('id', build.part_ids);

          if (!purchasingError) {
            build.purchasing = purchasingData || [];
          }
        } else {
          build.parts = [];
          build.purchasing = [];
        }
      }
      
      // Calculate stats and update build statuses
      buildStats = {
        total: builds.length,
        pending: 0,
        ready_to_assemble: 0,
        assembled: 0
      };

      // Update build statuses based on part completion
      for (const build of builds) {
        if (build.status !== 'assembled') {
          const allParts = [...(build.parts || []), ...(build.purchasing || [])];
          if (allParts.length > 0) {
            // Check if all parts are completed
            const allPartsComplete = allParts.every(part => 
              part.status === 'complete' || part.status === 'delivered'
            );
            
            // Update build status if needed
            if (allPartsComplete && build.status === 'pending') {
              // Update build to ready_to_assemble
              await supabase
                .from('builds')
                .update({ status: 'ready_to_assemble' })
                .eq('id', build.id);
              build.status = 'ready_to_assemble';
            } else if (!allPartsComplete && allParts.some(part => part.status !== 'pending')) {
              // Update build to manufacturing if any parts are in progress
              await supabase
                .from('builds')
                .update({ status: 'manufacturing' })
                .eq('id', build.id);
              build.status = 'manufacturing';
            }
          }
        }
        
        // Count for stats
        if (build.status === 'pending') buildStats.pending++;
        else if (build.status === 'ready_to_assemble' || build.status === 'manufacturing') buildStats.ready_to_assemble++;
        else if (build.status === 'assembled') buildStats.assembled++;
      }
      
    } catch (error) {
      console.error('Error loading builds:', error);
    }
  }

  async function markAsAssembled(buildId) {
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
      await loadBuilds();
    } catch (error) {
      console.error('Error marking as assembled:', error);
      alert('Failed to mark as assembled');
    }
  }
  function getBuildProgress(build) {
    const allParts = [...(build.parts || []), ...(build.purchasing || [])];
    if (allParts.length === 0) return { percent: 0, manufactured: 0, total: 0, status: 'No parts' };
    
    const manufactured = allParts.filter(item => 
      item.status === 'complete' || item.status === 'delivered'
    ).length;
    
    const inProgress = allParts.filter(item => 
      item.status === 'in-progress' || item.status === 'cammed' || item.status === 'ordered'
    ).length;
    
    let status = 'Requested';
    if (manufactured === allParts.length) {
      status = 'Ready';
    } else if (inProgress > 0 || manufactured > 0) {
      status = 'Manufacturing';
    }
    
    return {
      percent: Math.round((manufactured / allParts.length) * 100),
      manufactured,
      total: allParts.length,
      inProgress,
      status
    };
  }
</script>

<svelte:head>
  <title>Build Center - 971 Hub</title>
</svelte:head>

{#if loading}
  <div class="loading-container">
    <div class="loading-spinner"></div>
    <p>Loading...</p>
  </div>
{:else if user}
  <div class="build-container">
    <div class="page-header">
      <div class="header-content">
        <Settings size={32} />
        <div>
          <h1>Build Center</h1>
          <p>Manage build configurations and assembly processes</p>
        </div>
      </div>
    </div>

    <!-- Build Statistics -->
    <div class="stats-grid">
      <div class="stat-card">
        <Package size={24} />
        <div class="stat-info">
          <h3>{buildStats.total}</h3>
          <p>Total Builds</p>
        </div>
      </div>
      <div class="stat-card">
        <Clock size={24} />
        <div class="stat-info">
          <h3>{buildStats.pending}</h3>
          <p>Pending</p>
        </div>
      </div>
      <div class="stat-card">
        <Wrench size={24} />
        <div class="stat-info">
          <h3>{buildStats.ready_to_assemble}</h3>
          <p>Ready to Assemble</p>
        </div>
      </div>
      <div class="stat-card">
        <CheckCircle size={24} />
        <div class="stat-info">
          <h3>{buildStats.assembled}</h3>
          <p>Assembled</p>
        </div>
      </div>
    </div>

    <!-- Active Builds -->
    <div class="build-sections">
      <section class="section">
        <h2>All Builds</h2>
        {#if builds.length > 0}
          <div class="builds-grid">
            {#each builds as build}
              {@const progress = getBuildProgress(build)}
              <div class="build-card status-{build.status}"
                   on:click={() => goto(`/cad/build/${build.id}`)}
                   on:keydown={(e) => e.key === 'Enter' && goto(`/cad/build/${build.id}`)}
                   role="button"
                   tabindex="0">
                <div class="build-header">
                  <div class="icon-wrap"><Package size={18} /></div>
                  <div class="build-info">
                    <h3>{build.subsystems?.name || 'Unknown'} · {build.release_name}</h3>
                    <p>Build #{build.build_hash?.split('_')[1] || 'N/A'}</p>
                  </div>
                  <span class="status-badge status-{build.status}">
                    {#if build.status === 'pending'}
                      <Clock size={14} /> Pending
                    {:else if build.status === 'manufacturing'}
                      <Wrench size={14} /> in progress
                    {:else if build.status === 'ready_to_assemble'}
                      <CheckCircle size={14} /> Ready
                    {:else if build.status === 'assembled'}
                      <CheckCircle size={14} /> Assembled
                    {/if}
                  </span>
                </div>

                <div class="progress-bar">
                  <div class="progress-fill" style="width: {progress.percent}%"></div>
                </div>

                <div class="build-details">
                  <div class="meta">
                    <span>{progress.manufactured}/{progress.total} parts</span>
                    <span>•</span>
                    <span>{progress.percent}%</span>
                    <span>•</span>
                    <span>Created {new Date(build.created_at).toLocaleDateString()}</span>
                    {#if build.assembled_at}
                      <span>•</span>
                      <span>Assembled {new Date(build.assembled_at).toLocaleDateString()}</span>
                    {/if}
                  </div>
                </div>

                <div class="build-actions">
                  <a href="/cad/build/{build.id}" class="btn btn-primary btn-sm">
                    <ExternalLink size={14} />
                    View Details
                  </a>
                  
                  {#if build.subsystems?.onshape_url}
                    <a href={build.subsystems.onshape_url} target="_blank" class="btn btn-secondary btn-sm">
                      <ExternalLink size={14} />
                      View CAD
                    </a>
                  {/if}
                  
                  <!-- BUILD FINISHED BUTTON LOGIC -->
                  {#if build.status !== 'assembled'}
                    {@const progress = getBuildProgress(build)}
                    {#if progress.status === 'Ready'}
                      <button class="btn btn-success btn-sm" on:click|stopPropagation={() => markAsAssembled(build.id)}>
                        <CheckCircle size={14} />
                        Build Finished
                      </button>
                    {/if}
                  {/if}
                </div>
              </div>
            {/each}
          </div>
      {:else}        <div class="empty-state">
          <Package size={48} />
          <h3>No Builds Yet</h3>
          <p>Builds are automatically created when you add parts from CAD subsystem BOMs.</p>
          <p>To create your first build:</p>
          <ol style="text-align: left; margin: 1rem 0;">
            <li>Go to a CAD subsystem</li>
            <li>Generate or view a BOM</li>
            <li>Add parts to manufacturing or purchasing</li>
            <li>A build will be created automatically</li>
          </ol>
          <a href="/cad" class="btn btn-primary btn-sm">
            Go to CAD Subsystems
          </a>
        </div>
      {/if}
    </section>
  </div>
</div>
{:else}
  <div class="error-container">
    <p>Please log in to access the Build Center.</p>
  </div>
{/if}

<style>
  :global(body) {
    margin: 0;
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
    background: var(--background);
    color: var(--text);
  }

  :root {
    --primary: #ffffff;
    --secondary: #1a1a1a;
    --accent: #f1c40f;
    --background: #f8f9fa;
    --border: #e1e5e9;
    --text: #2c3e50;
    --success: #27ae60;
    --warning: #f39c12;
    --danger: #e74c3c;
  }

  .loading-container {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    min-height: 60vh;
    gap: 1rem;
  }

  .loading-spinner {
    width: 40px;
    height: 40px;
    border: 3px solid var(--border);
    border-top: 3px solid var(--accent);
    border-radius: 50%;
    animation: spin 1s linear infinite;
  }

  @keyframes spin {
    0% { transform: rotate(0deg); }
    100% { transform: rotate(360deg); }
  }
  .build-container { max-width: 1400px; margin: 0 auto; padding: 0 1rem 1rem; }
  .page-header { background: var(--primary); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; margin: 1rem 0; }

  .header-content {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header-content h1 {
    margin: 0;
    color: var(--secondary);
    font-size: 1.25rem;
  }

  .header-content p {
    margin: 0.25rem 0 0 0;
    color: #666;
    font-size: 0.95rem;
  }

  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 0.75rem;
    margin-bottom: 0.75rem;
  }

  .stat-card {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 0.75rem;
    display: flex;
    align-items: center;
    gap: 0.75rem;
    box-shadow: var(--shadow-sm);
  }

  .stat-info h3 {
    margin: 0;
    color: var(--secondary);
    font-size: 1.5rem;
  }

  .stat-info p {
    margin: 0.25rem 0 0 0;
    color: #666;
    font-size: 0.9rem;
  }

  .build-sections {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .section { background: var(--primary); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 1rem; box-shadow: var(--shadow-sm); }

  .section h2 {
    margin: 0 0 0.75rem 0;
    color: var(--secondary);
    font-size: 1.5rem;
  }

  .builds-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
    gap: 1rem;
  }
  .build-card { background: var(--surface, #fff); border: 1px solid var(--border); border-radius: 12px; padding: 0.9rem; transition: box-shadow 0.2s ease, transform 0.15s ease; cursor: pointer; }

  .build-card:hover {
    box-shadow: 0 6px 16px rgba(0, 0, 0, 0.08);
    transform: translateY(-2px);
  }

  .build-header { display: flex; align-items: center; gap: 0.75rem; margin-bottom: 0.75rem; flex-wrap: wrap; }
  .icon-wrap { width: 28px; height: 28px; border-radius: 8px; background: #f3f4f6; display: inline-flex; align-items: center; justify-content: center; color: #6b7280; border: 1px solid #e5e7eb; }

  .build-info {
    flex: 1;
    min-width: 0; /* allow flex child to shrink for truncation */
  }

  .build-info h3 { margin: 0; color: var(--secondary); font-size: 1rem; font-weight: 600; }

  .build-info p {
    margin: 0.25rem 0 0 0;
    color: #666;
    font-size: 0.9rem;
  }

  .status-badge { display: inline-flex; align-items: center; gap: 0.4rem; padding: 0.3rem 0.6rem; border-radius: 6px; font-size: 0.78rem; font-weight: 600; border: 1px solid transparent; margin-left: auto; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; box-sizing: border-box; }
  .status-badge.status-pending { background: #fff8e6; color: #8f5f00; border-color: #ffe199; }
  .status-badge.status-manufacturing { background: #eaf3ff; color: #1e60d1; border-color: #b6d3ff; }
  .status-badge.status-ready_to_assemble { background: #f0fdf4; color: #166534; border-color: #bbf7d0; }
  .status-badge.status-assembled { background: #e8f6ef; color: #11642a; border-color: #a7e0c1; }

  .progress-bar { width: 100%; height: 8px; background: #eef2f7; border-radius: 999px; overflow: hidden; margin-bottom: 0.75rem; }
  .progress-fill { height: 100%; background: linear-gradient(90deg, #ffd54f, #ffb300); transition: width 0.3s ease; }

  .build-details .meta { display: flex; gap: 0.5rem; flex-wrap: wrap; color: #6b7280; font-size: 0.85rem; }

  .build-actions {
    display: flex;
    gap: 0.75rem;
    margin-top: 1rem;
    flex-wrap: wrap;
  }

  .empty-state {
    text-align: center;
    padding: 1.5rem;
    color: #666;
  }

  .empty-state h3 {
    margin: 1rem 0;
    color: var(--secondary);
  }

  .empty-state p {
    margin-bottom: 2rem;
    line-height: 1.5;
  }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1.5rem;
  }

  .tool-card {
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    text-align: center;
    transition: all 0.2s ease;
  }

  .tool-card:hover {
    transform: translateY(-2px);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    border-color: var(--accent);
  }

  .tool-card h3 {
    margin: 0.5rem 0;
    color: var(--secondary);
    font-size: 1.1rem;
  }

  .tool-card p {
    margin: 0 0 1.5rem 0;
    color: #666;
    line-height: 1.5;
  }

  /* Removed unused checklist styles */

  /* Buttons use global styles from app.css */

  .error-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 60vh;
    text-align: center;
  }

  /* Removed per-build parts table styles in favor of compact cards */

  @media (max-width: 768px) {
    .build-container {
      margin: 0;
      padding: 0;
    }

    .page-header {
      padding: 0.75rem;
    }

    .header-content {
      flex-direction: column;
      align-items: flex-start;
      text-align: left;
    }

    .header-content h1 {
      font-size: 1.5rem;
    }

    .section {
      padding: 0.75rem;
    }

    .tools-grid {
      grid-template-columns: 1fr;
    }

    .build-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.75rem;
    }

    .build-status {
      align-self: flex-start;
    }
  }
</style>
