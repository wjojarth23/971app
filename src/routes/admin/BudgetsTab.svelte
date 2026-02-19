<script>
  import { onMount } from 'svelte';
  import { supabase } from '$lib/supabase.js';
  import { hasPermission, PURCHASING_ROLES } from '$lib/permissions.js';
  import { toastActions } from '$lib/toast.js';
  import { Plus, Edit, Trash2, DollarSign, Calendar, Target, Folder } from 'lucide-svelte';
  import { userStore } from '$lib/stores/user.js';

  export let subsystems = []; // Passed from parent or loaded here if needed

  let budgets = [];
  let loading = false;
  let showModal = false;
  let editingBudget = null;
  let saving = false;

  // Form State
  let form = {
    name: '',
    category: '',
    scope_type: 'overall', // overall, project, subsystem, build, build_group
    scope_value: '',
    amount: 0,
    start_date: '',
    end_date: '',
    notes: ''
  };

  const SCOPE_TYPES = [
    { value: 'overall', label: 'Overall (All Teams)' },
    { value: 'project', label: 'Project' },
    { value: 'subsystem', label: 'Subsystem' },
    { value: 'build', label: 'Build' },
    { value: 'build_group', label: 'Build Group' }
  ];

  const CATEGORIES = [
    'General', 'Mechanical', 'Electrical', 'Software', 'Manufacturing', 'Travel', 'Events', 'Food', 'Marketing'
  ];

  onMount(async () => {
    // If subsystems not passed, load them
    if (!subsystems || subsystems.length === 0) {
      await loadSubsystems();
    }
    await loadBudgets();
  });

  async function loadSubsystems() {
    const { data } = await supabase.from('subsystems').select('id, name, frc_team').order('name');
    subsystems = data || [];
  }

  async function loadBudgets() {
    loading = true;
    try {
      const { data, error } = await supabase
        .from('purchasing_budgets')
        .select('*')
        .order('created_at', { ascending: false });

      if (error) throw error;
      
      // Load purchasing data to calculate spending
      const { data: purchases, error: purchaseErr } = await supabase
        .from('purchasing')
        .select('*');
      
      if (purchaseErr) throw purchaseErr;
      
      // Calculate spending for each budget
      budgets = (data || []).map(budget => ({
        ...budget,
        spent: calculateBudgetSpent(budget, purchases || [])
      }));
    } catch (err) {
      console.error('Failed to load budgets', err);
      toastActions.show('Failed to load budgets');
    } finally {
      loading = false;
    }
  }

  function calculateBudgetSpent(budget, allPurchases) {
    const matches = allPurchases.filter(p => {
      // Only count non-rejected items
      if (p.status === 'rejected') return false;
      
      // Date filter
      if (budget.start_date && new Date(p.created_at) < new Date(budget.start_date)) return false;
      if (budget.end_date && new Date(p.created_at) > new Date(budget.end_date)) return false;

      // Scope filter
      if (budget.scope_type === 'overall') return true;
      if (budget.scope_type === 'project') {
        return p.project_id === budget.scope_value;
      }
      if (budget.scope_type === 'subsystem') {
        // Match by subsystem - would need to join with builds table in real implementation
        return p.project_id && p.project_id.includes(budget.scope_value);
      }
      if (budget.scope_type === 'build') {
        return p.project_id === budget.scope_value;
      }
      if (budget.scope_type === 'build_group') {
        return p.project_id && p.project_id.includes(budget.scope_value);
      }
      return false;
    });

    return matches.reduce((sum, p) => {
      return sum + ((p.final_price || p.price || 0) * (p.quantity || 1));
    }, 0);
  }

  function openCreateModal() {
    editingBudget = null;
    form = {
      name: '',
      category: 'General',
      scope_type: 'overall',
      scope_value: '',
      amount: 0,
      start_date: new Date().toISOString().split('T')[0],
      end_date: '',
      notes: ''
    };
    showModal = true;
  }

  function openEditModal(budget) {
    editingBudget = budget;
    form = {
      name: budget.name,
      category: budget.category || 'General',
      scope_type: budget.scope_type,
      scope_value: budget.scope_value || '',
      amount: budget.amount,
      start_date: budget.start_date || '',
      end_date: budget.end_date || '',
      notes: budget.notes || ''
    };
    showModal = true;
  }

  async function saveBudget() {
    if (!form.name || form.amount < 0 || !form.start_date) {
      toastActions.show('Please fill in required fields (Name, Amount >= 0, Start Date)');
      return;
    }
    
    saving = true;
    try {
      let finalScopeValue = null;
      if (form.scope_type !== 'overall') {
        finalScopeValue = form.scope_value;
      }

      const payload = {
        name: form.name.trim(),
        category: form.category,
        scope_type: form.scope_type,
        scope_value: finalScopeValue,
        amount: form.amount,
        start_date: form.start_date,
        end_date: form.end_date || null,
        notes: form.notes ? form.notes.trim() : null,
        updated_at: new Date().toISOString()
      };

      if (editingBudget) {
        const { error } = await supabase
          .from('purchasing_budgets')
          .update(payload)
          .eq('id', editingBudget.id);
        if (error) throw error;
        toastActions.show('Budget updated');
      } else {
        payload.created_by = $userStore?.id;
        const { error } = await supabase
          .from('purchasing_budgets')
          .insert([payload]);
        if (error) throw error;
        toastActions.show('Budget created');
      }

      showModal = false;
      editingBudget = null;
      await loadBudgets();
    } catch (err) {
      console.error('Failed to save budget', err);
      toastActions.show('Failed to save budget');
    } finally {
      saving = false;
    }
  }

  async function deleteBudget(budget) {
    if (!confirm(`Delete budget "${budget.name}"? This cannot be undone.`)) return;
    try {
      const { error } = await supabase.from('purchasing_budgets').delete().eq('id', budget.id);
      if (error) throw error;
      toastActions.show('Budget deleted');
      await loadBudgets();
    } catch (err) {
      console.error('Failed to delete budget', err);
      toastActions.show('Failed to delete budget');
    }
  }

  function getScopeDisplay(b) {
    if (b.scope_type === 'overall') return 'Overall';
    if (b.scope_type === 'project') return `Project: ${b.scope_value}`;
    if (b.scope_type === 'subsystem') {
      const sub = subsystems.find(s => s.id === b.scope_value);
      return sub ? `Subsystem: ${sub.name}` : `Subsystem: ${b.scope_value}`;
    }
    if (b.scope_type === 'build') return `Build: ${b.scope_value}`;
    if (b.scope_type === 'build_group') return `Build Group: ${b.scope_value}`;
    return b.scope_type;
  }
</script>

<div class="budgets-container">
  <div class="header-actions">
    <h3>Budget Management</h3>
    <button class="btn btn-primary" on:click={openCreateModal}>
      <Plus size={16} /> New Budget
    </button>
  </div>

  {#if loading}
    <div class="loading">Loading budgets...</div>
  {:else if budgets.length === 0}
    <div class="empty-state">No budgets found. Create one to get started.</div>
  {:else}
    <div class="table-container">
      <table class="table">
        <thead>
          <tr>
            <th>Name</th>
            <th>Scope</th>
            <th>Category</th>
            <th>Amount</th>
            <th>Spending</th>
            <th>Dates</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {#each budgets as budget}
            <tr>
              <td>
                <div class="fw-bold">{budget.name}</div>
                {#if budget.notes}<small class="text-muted">{budget.notes}</small>{/if}
              </td>
              <td>
                <span class="badge scope-{budget.scope_type}" title={budget.scope_value}>
                  {#if budget.scope_type === 'overall'}<Target size={12}/>{/if}
                  {#if budget.scope_type === 'project' || budget.scope_type === 'subsystem'}<Folder size={12}/>{/if}
                  {getScopeDisplay(budget)}
                </span>
              </td>
              <td>{budget.category || '-'}</td>
              <td class="font-mono">${Number(budget.amount).toLocaleString()}</td>
              <td>
                <div class="spending-cell">
                  <div class="spending-bar">
                    <div 
                      class="spending-fill" 
                      class:over-budget={budget.spent > budget.amount}
                      style="width: {Math.min((budget.spent / budget.amount) * 100, 100)}%"
                    ></div>
                  </div>
                  <div class="spending-text" class:over-budget={budget.spent > budget.amount}>
                    ${budget.spent.toLocaleString(undefined, {maximumFractionDigits: 0})}
                    <span class="spending-percent">({Math.round((budget.spent / budget.amount) * 100)}%)</span>
                  </div>
                </div>
              </td>
              <td>
                <div class="date-range">
                  <span>{new Date(budget.start_date).toLocaleDateString()}</span>
                  {#if budget.end_date}
                    <span class="arrow">→</span>
                    <span>{new Date(budget.end_date).toLocaleDateString()}</span>
                  {/if}
                </div>
              </td>
              <td>
                <div class="actions">
                  <button class="btn-icon" on:click={() => openEditModal(budget)} title="Edit">
                    <Edit size={16} />
                  </button>
                  <button class="btn-icon danger" on:click={() => deleteBudget(budget)} title="Delete">
                    <Trash2 size={16} />
                  </button>
                </div>
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</div>

{#if showModal}
  <div class="modal-backdrop" on:click={() => showModal = false}>
    <div class="modal" on:click|stopPropagation>
      <div class="modal-header">
        <h3>{editingBudget ? 'Edit Budget' : 'Create Budget'}</h3>
        <button class="btn-close" on:click={() => showModal = false}>&times;</button>
      </div>
      <div class="modal-body">
        <div class="form-group">
          <label>Budget Name*</label>
          <input type="text" class="form-control" bind:value={form.name} placeholder="e.g. 2025 Robot BOM" />
        </div>
        
        <div class="row">
          <div class="col">
            <div class="form-group">
              <label>Scope Type</label>
              <select class="form-select" bind:value={form.scope_type}>
                {#each SCOPE_TYPES as type}
                  <option value={type.value}>{type.label}</option>
                {/each}
              </select>
            </div>
          </div>
          
          <div class="col">
            <div class="form-group">
              <label>Category</label>
              <input type="text" list="categories-list" class="form-control" bind:value={form.category} />
              <datalist id="categories-list">
                {#each CATEGORIES as cat}
                  <option value={cat} />
                {/each}
              </datalist>
            </div>
          </div>
        </div>

        {#if form.scope_type === 'subsystem'}
          <div class="form-group">
            <label>Subsystem</label>
            <select class="form-select" bind:value={form.scope_value}>
              <option value="" disabled>Select Subsystem</option>
              {#each subsystems as sub}
                <option value={sub.id}>{sub.name} ({sub.frc_team || 'General'})</option>
              {/each}
            </select>
          </div>
        {:else if form.scope_type === 'project' || form.scope_type === 'build' || form.scope_type === 'build_group'}
          <div class="form-group">
            <label>{form.scope_type === 'project' ? 'Project ID' : form.scope_type === 'build' ? 'Build ID' : 'Build Group ID'}</label>
            <input type="text" class="form-control" bind:value={form.scope_value} placeholder="Enter ID" />
          </div>
        {/if}

        <div class="form-group">
          <label>Total Amount ($)*</label>
          <input type="number" step="0.01" class="form-control" bind:value={form.amount} />
        </div>

        <div class="row">
          <div class="col">
            <div class="form-group">
              <label>Start Date*</label>
              <input type="date" class="form-control" bind:value={form.start_date} />
            </div>
          </div>
          <div class="col">
             <div class="form-group">
              <label>End Date (Optional)</label>
              <input type="date" class="form-control" bind:value={form.end_date} />
            </div>
          </div>
        </div>

        <div class="form-group">
          <label>Notes</label>
          <textarea class="form-control" rows="2" bind:value={form.notes}></textarea>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" on:click={() => showModal = false}>Cancel</button>
        <button class="btn btn-primary" on:click={saveBudget} disabled={saving}>
          {saving ? 'Saving...' : 'Save Budget'}
        </button>
      </div>
    </div>
  </div>
{/if}

<style>
  .header-actions {
    display: flex;
    justify-content: space-between;
    align-items: center;
    margin-bottom: 1rem;
  }
  .table-container {
    overflow-x: auto;
    background: var(--surface-1);
    border-radius: 4px;
    border: 1px solid var(--border);
  }
  .table {
    width: 100%;
    border-collapse: collapse;
  }
  .table th, .table td {
    padding: 0.75rem 1rem;
    text-align: left;
    border-bottom: 1px solid var(--border);
  }
  .table th {
    background: var(--surface-2);
    font-weight: 500;
  }
  .badge {
    display: inline-flex;
    align-items: center;
    gap: var(--gap-1);
    padding: 0 var(--space-3);
    height: var(--control-height);
    border-radius: var(--radius-sm);
    font-size: var(--font-xs);
    font-weight: 600;
    text-transform: uppercase;
    box-sizing: border-box;
  }
  .scope-overall { background: var(--blue-soft); color: var(--blue-strong); border: 1px solid var(--blue-base); }
  .scope-project { background: var(--purple-soft); color: var(--purple-strong); border: 1px solid var(--purple-base); }
  .scope-subsystem { background: var(--green-soft); color: var(--green-strong); border: 1px solid var(--green-base); }
  .scope-build { background: var(--brand-gold-soft); color: var(--brand-gold-strong); border: 1px solid var(--brand-gold-base); }
  .scope-build_group { background: var(--red-soft); color: var(--red-strong); border: 1px solid var(--red-base); }
  
  .font-mono { font-family: monospace; }
  .fw-bold { font-weight: 600; }
  .text-muted { color: var(--text-2); font-size: 0.85em; }
  
  .date-range {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9em;
  }
  .arrow { color: var(--text-2); }
  
  .spending-cell {
    display: flex;
    flex-direction: column;
    gap: 0.375rem;
    min-width: 140px;
  }
  .spending-bar {
    width: 100%;
    height: 6px;
    background: var(--surface-2);
    border-radius: 3px;
    overflow: hidden;
  }
  .spending-fill {
    height: 100%;
    background: var(--brand-gold-strong);
    border-radius: 3px;
    transition: width 0.3s ease;
  }
  .spending-fill.over-budget {
    background: var(--red-strong);
  }
  .spending-text {
    font-size: 0.85rem;
    font-weight: 500;
    color: var(--text);
  }
  .spending-text.over-budget {
    color: var(--red-strong);
  }
  .spending-percent {
    font-size: 0.75rem;
    color: var(--text-muted);
    margin-left: 0.25rem;
  }
  
  .actions {
    display: flex;
    gap: 0.5rem;
  }
  .btn-icon {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--text-2);
    padding: 0.25rem;
    border-radius: 0.25rem;
  }
  .btn-icon:hover { background: var(--surface-2); color: var(--text); }
  .btn-icon.danger:hover { background: #fee2e2; color: #dc2626; }
  
  .modal-backdrop {
    position: fixed;
    top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.5);
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
    padding: 1rem;
  }
  .modal {
    background: var(--surface-1);
    border-radius: 4px;
    width: 100%;
    max-width: 600px;
    max-height: 90vh;
    overflow-y: auto;
    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
    display: flex;
    flex-direction: column;
  }
  .modal-header {
    padding: 1rem;
    border-bottom: 1px solid var(--border);
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .modal-body { padding: 1rem; }
  .modal-footer {
    padding: 1rem;
    border-top: 1px solid var(--border);
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }
  .btn-close {
    background: none;
    border: none;
    font-size: 1.5rem;
    line-height: 1;
    cursor: pointer;
    color: var(--text-2);
  }
  .form-group { margin-bottom: 1rem; }
  .form-group label { display: block; margin-bottom: 0.25rem; font-weight: 500; font-size: 0.9rem; }
  .form-control, .form-select {
    width: 100%;
    padding: 0.5rem;
    border: 1px solid var(--border);
    border-radius: 0.25rem;
    background: var(--surface-0);
    color: var(--text);
  }
  .row { display: flex; gap: 1rem; }
  .col { flex: 1; }
</style>
