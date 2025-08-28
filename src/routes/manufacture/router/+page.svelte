<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { userStore } from '$lib/stores/user.js';
  import { Route, MapPin, Navigation, Settings, Play, Pause, RotateCcw } from 'lucide-svelte';
  import { goto } from '$app/navigation';

  let user = null;
  let loading = true;

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
  });
</script>

<svelte:head>
  <title>Router Control - 971 Hub</title>
</svelte:head>

{#if loading}
  <div class="loading-container">
    <div class="loading-spinner"></div>
    <p>Loading...</p>
  </div>
{:else if user}
  <div class="router-container">
    <div class="page-header">
      <div class="header-content">
        <Route size={32} />
        <div>
          <h1>Router Control Center</h1>
          <p>Manage CNC routing operations and job scheduling</p>
        </div>
      </div>
    </div>

    <div class="router-sections">
      <!-- Router Status -->
      <section class="section">
        <h2>Router Status</h2>
        <div class="status-grid">
          <div class="status-card status-active">
            <div class="status-header">
              <Play size={20} />
              <h3>Router #1</h3>
              <div class="status-indicator active">RUNNING</div>
            </div>
            <div class="status-details">
              <p><strong>Current Job:</strong> Frame Panel Cutting</p>
              <p><strong>Progress:</strong> 45% Complete</p>
              <p><strong>Est. Completion:</strong> 2:30 PM</p>
              <p><strong>Material:</strong> 1/4" Aluminum</p>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: 45%"></div>
            </div>
          </div>

          <div class="status-card status-idle">
            <div class="status-header">
              <Pause size={20} />
              <h3>Router #2</h3>
              <div class="status-indicator idle">IDLE</div>
            </div>
            <div class="status-details">
              <p><strong>Last Job:</strong> Electronics Bracket</p>
              <p><strong>Completed:</strong> 11:45 AM</p>
              <p><strong>Next Job:</strong> Scheduled for 3:00 PM</p>
              <p><strong>Status:</strong> Ready for operation</p>
            </div>
            <div class="progress-bar">
              <div class="progress-fill" style="width: 0%"></div>
            </div>
          </div>

          <div class="status-card status-maintenance">
            <div class="status-header">
              <Settings size={20} />
              <h3>Router #3</h3>
              <div class="status-indicator maintenance">MAINTENANCE</div>
            </div>
            <div class="status-details">
              <p><strong>Issue:</strong> Spindle bearing replacement</p>
              <p><strong>Started:</strong> June 16, 2025</p>
              <p><strong>Est. Completion:</strong> June 19, 2025</p>
              <p><strong>Technician:</strong> Mike Johnson</p>
            </div>
            <div class="progress-bar">
              <div class="progress-fill maintenance" style="width: 75%"></div>
            </div>
          </div>
        </div>
      </section>

      <!-- Job Queue -->
      <section class="section">
        <h2>Job Queue</h2>
        <div class="queue-list">
          <div class="job-item priority-high">
            <div class="job-info">
              <h4>Drive Base Plates</h4>
              <span class="job-id">Job #R-2024-045</span>
            </div>
            <div class="job-details">
              <p><strong>Material:</strong> 1/8" Steel</p>
              <p><strong>Quantity:</strong> 4 pieces</p>
              <p><strong>Est. Time:</strong> 45 minutes</p>
            </div>
            <div class="job-priority high">HIGH</div>
          </div>

          <div class="job-item priority-normal">
            <div class="job-info">
              <h4>Mounting Brackets</h4>
              <span class="job-id">Job #R-2024-046</span>
            </div>
            <div class="job-details">
              <p><strong>Material:</strong> 1/4" Aluminum</p>
              <p><strong>Quantity:</strong> 8 pieces</p>
              <p><strong>Est. Time:</strong> 1.5 hours</p>
            </div>
            <div class="job-priority normal">NORMAL</div>
          </div>

          <div class="job-item priority-low">
            <div class="job-info">
              <h4>Decorative Panels</h4>
              <span class="job-id">Job #R-2024-047</span>
            </div>
            <div class="job-details">
              <p><strong>Material:</strong> 1/2" Plywood</p>
              <p><strong>Quantity:</strong> 2 pieces</p>
              <p><strong>Est. Time:</strong> 30 minutes</p>
            </div>
            <div class="job-priority low">LOW</div>
          </div>
        </div>
      </section>

      <!-- Router Tools -->
      <section class="section">
        <h2>Router Tools & Settings</h2>
        <div class="tools-grid">
          <div class="tool-card">
            <Settings size={24} />
            <h3>Machine Settings</h3>
            <p>Configure router parameters and speeds</p>
            <button class="btn btn-secondary">Configure</button>
          </div>
          <div class="tool-card">
            <MapPin size={24} />
            <h3>Coordinate System</h3>
            <p>Set work coordinate origins and offsets</p>
            <button class="btn btn-secondary">Set Origin</button>
          </div>
          <div class="tool-card">
            <Navigation size={24} />
            <h3>Manual Control</h3>
            <p>Manually jog router axes for setup</p>
            <button class="btn btn-secondary">Manual Mode</button>
          </div>
          <div class="tool-card">
            <RotateCcw size={24} />
            <h3>Tool Change</h3>
            <p>Perform automatic or manual tool changes</p>
            <button class="btn btn-primary">Change Tool</button>
          </div>
        </div>
      </section>

      <!-- Material Inventory -->
      <section class="section">
        <h2>Material Inventory</h2>
        <div class="inventory-grid">
          <div class="material-card">
            <div class="material-header">
              <h4>Aluminum Sheets</h4>
              <span class="stock-level high">In Stock</span>
            </div>
            <div class="material-details">
              <p><strong>Thickness:</strong> 1/4" (6.35mm)</p>
              <p><strong>Size:</strong> 24" x 48"</p>
              <p><strong>Quantity:</strong> 15 sheets</p>
              <p><strong>Location:</strong> Rack A2</p>
            </div>
          </div>

          <div class="material-card">
            <div class="material-header">
              <h4>Steel Plate</h4>
              <span class="stock-level medium">Medium Stock</span>
            </div>
            <div class="material-details">
              <p><strong>Thickness:</strong> 1/8" (3.18mm)</p>
              <p><strong>Size:</strong> 18" x 36"</p>
              <p><strong>Quantity:</strong> 6 sheets</p>
              <p><strong>Location:</strong> Rack B1</p>
            </div>
          </div>

          <div class="material-card">
            <div class="material-header">
              <h4>Plywood</h4>
              <span class="stock-level low">Low Stock</span>
            </div>
            <div class="material-details">
              <p><strong>Thickness:</strong> 1/2" (12.7mm)</p>
              <p><strong>Size:</strong> 24" x 48"</p>
              <p><strong>Quantity:</strong> 2 sheets</p>
              <p><strong>Location:</strong> Rack C3</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  </div>
{:else}
  <div class="error-container">
    <p>Please log in to access the Router Control Center.</p>
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
    --info: #3498db;
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

  .router-container {
    max-width: 1200px;
    margin: 2rem auto;
    padding: 0 1rem;
  }

  .page-header {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2rem;
    margin-bottom: 2rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .header-content {
    display: flex;
    align-items: center;
    gap: 1rem;
  }

  .header-content h1 {
    margin: 0;
    color: var(--secondary);
    font-size: 2rem;
  }

  .header-content p {
    margin: 0.5rem 0 0 0;
    color: #666;
    font-size: 1.1rem;
  }

  .router-sections {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  .section {
    background: var(--primary);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 2rem;
    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.05);
  }

  .section h2 {
    margin: 0 0 1.5rem 0;
    color: var(--secondary);
    font-size: 1.5rem;
  }

  .status-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 1rem;
  }

  .status-card {
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    transition: all 0.2s ease;
  }

  .status-card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    border-color: var(--accent);
  }

  .status-header {
    display: flex;
    align-items: center;
    gap: 1rem;
    margin-bottom: 1rem;
  }

  .status-header h3 {
    flex: 1;
    margin: 0;
    color: var(--secondary);
    font-size: 1.1rem;
  }

  .status-indicator {
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .status-indicator.active {
    background: #e8f5e8;
    color: var(--success);
  }

  .status-indicator.idle {
    background: #e3f2fd;
    color: var(--info);
  }

  .status-indicator.maintenance {
    background: #fff3e0;
    color: var(--warning);
  }

  .status-details p {
    margin: 0.5rem 0;
    font-size: 0.9rem;
    color: #666;
  }

  .progress-bar {
    width: 100%;
    height: 8px;
    background: var(--border);
    border-radius: 4px;
    overflow: hidden;
    margin-top: 1rem;
  }

  .progress-fill {
    height: 100%;
    background: var(--success);
    transition: width 0.3s ease;
  }

  .progress-fill.maintenance {
    background: var(--warning);
  }

  .queue-list {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .job-item {
    display: flex;
    align-items: center;
    gap: 1rem;
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1rem;
    transition: all 0.2s ease;
  }

  .job-item:hover {
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
    border-color: var(--accent);
  }

  .job-info {
    flex: 1;
  }

  .job-info h4 {
    margin: 0;
    color: var(--secondary);
    font-size: 1rem;
  }

  .job-id {
    font-size: 0.8rem;
    color: #666;
  }

  .job-details {
    flex: 2;
  }

  .job-details p {
    margin: 0.25rem 0;
    font-size: 0.85rem;
    color: #666;
  }

  .job-priority {
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  .job-priority.high {
    background: #ffebee;
    color: var(--danger);
  }

  .job-priority.normal {
    background: #e3f2fd;
    color: var(--info);
  }

  .job-priority.low {
    background: #f3e5f5;
    color: #9c27b0;
  }

  .tools-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
    gap: 1rem;
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

  .inventory-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
    gap: 1rem;
  }

  .material-card {
    background: var(--background);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 1.5rem;
    transition: all 0.2s ease;
  }

  .material-card:hover {
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    border-color: var(--accent);
  }

  .material-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }

  .material-header h4 {
    margin: 0;
    color: var(--secondary);
    font-size: 1.1rem;
  }

  .stock-level {
    padding: 0.25rem 0.75rem;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
    border: 1px solid var(--border);
    background: transparent;
    color: var(--secondary);
  }

  .stock-level.high {
    background: #e8f5e8;
    color: var(--success);
    border-color: #a5d6a7;
  }

  .stock-level.medium {
    background: #fff3e0;
    color: var(--warning);
    border-color: #ffcc02;
  }

  .stock-level.low {
    background: #ffebee;
    color: var(--danger);
    border-color: #f48fb1;
  }

  .material-details p {
    margin: 0.5rem 0;
    font-size: 0.9rem;
    color: #666;
  }

  /* Buttons use global styles from app.css */

  .error-container {
    display: flex;
    justify-content: center;
    align-items: center;
    min-height: 60vh;
    text-align: center;
  }

  @media (max-width: 768px) {
    .router-container {
      margin: 1rem;
      padding: 0;
    }

    .page-header {
      padding: 1.5rem;
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
      padding: 1.5rem;
    }

    .status-grid {
      grid-template-columns: 1fr;
    }

    .tools-grid {
      grid-template-columns: 1fr;
    }

    .inventory-grid {
      grid-template-columns: 1fr;
    }

    .job-item {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }

    .job-details {
      flex: 1;
      width: 100%;
    }

    .job-priority {
      align-self: flex-start;
    }

    .material-header {
      flex-direction: column;
      align-items: flex-start;
      gap: 0.5rem;
    }

    .stock-level {
      align-self: flex-start;
    }
  }
</style>
