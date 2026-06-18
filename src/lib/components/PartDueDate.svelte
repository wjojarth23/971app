<script>
  import { createEventDispatcher } from 'svelte';
  import { supabase } from '$lib/supabase.js';

  export let part;
  export let editable = true;

  const dispatch = createEventDispatcher();

  let saving = false;

  // Normalize a stored date (date or ISO timestamp) to yyyy-mm-dd for <input type=date>
  function toInputValue(d) {
    if (!d) return '';
    try {
      const s = String(d);
      // Already yyyy-mm-dd
      if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
      const dt = new Date(s);
      if (isNaN(dt.getTime())) return '';
      return dt.toISOString().slice(0, 10);
    } catch {
      return '';
    }
  }

  $: value = toInputValue(part?.due_date);

  // Days until due (negative = overdue). null when no due date.
  function daysUntil(d) {
    const v = toInputValue(d);
    if (!v) return null;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const due = new Date(v + 'T00:00:00');
    return Math.round((due.getTime() - today.getTime()) / 86400000);
  }

  $: days = daysUntil(part?.due_date);
  $: urgency =
    days === null ? 'none' :
    days < 0 ? 'overdue' :
    days <= 2 ? 'soon' :
    'ok';

  $: label =
    days === null ? '' :
    days < 0 ? `${Math.abs(days)}d overdue` :
    days === 0 ? 'Due today' :
    days === 1 ? 'Due tomorrow' :
    `${days}d left`;

  async function save(newVal) {
    if (saving) return;
    saving = true;
    try {
      const { error } = await supabase
        .from('parts')
        .update({ due_date: newVal || null, updated_at: new Date().toISOString() })
        .eq('id', part.id);
      if (error) throw error;
      part = { ...part, due_date: newVal || null };
      dispatch('update', { id: part.id, due_date: newVal || null });
    } catch (e) {
      console.error('Failed to update due date', e);
      alert('Failed to update due date');
    } finally {
      saving = false;
    }
  }

  function onChange(e) {
    save(e.target.value);
  }
</script>

<div class="due-date {urgency}" title={value ? `Due ${value}` : 'No due date set'}>
  {#if editable}
    <input
      type="date"
      class="due-input"
      value={value}
      disabled={saving}
      on:change={onChange}
      aria-label="Due date"
    />
  {:else}
    <span class="due-text">{value || '—'}</span>
  {/if}
  {#if label}
    <span class="due-badge {urgency}">{label}</span>
  {/if}
</div>

<style>
  .due-date {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
  }

  .due-input {
    font-size: 0.78rem;
    padding: 0.25rem 0.4rem;
    border: 1px solid var(--border, #d1d5db);
    border-radius: var(--radius-sm, 4px);
    background: var(--surface-1, #fff);
    color: var(--text, #1f2933);
  }

  .due-input:disabled {
    opacity: 0.6;
  }

  .due-text {
    font-size: 0.8rem;
    color: var(--text, #1f2933);
  }

  .due-badge {
    font-size: 0.68rem;
    font-weight: 700;
    padding: 0.1rem 0.4rem;
    border-radius: 999px;
    white-space: nowrap;
    text-transform: uppercase;
    letter-spacing: 0.02em;
  }

  .due-badge.overdue {
    background: #fee2e2;
    color: #991b1b;
    border: 1px solid #fca5a5;
  }

  .due-badge.soon {
    background: #fef3c7;
    color: #92400e;
    border: 1px solid #fde68a;
  }

  .due-badge.ok {
    background: #dcfce7;
    color: #166534;
    border: 1px solid #bbf7d0;
  }

  /* subtle border accent on the wrapper for overdue/soon */
  .due-date.overdue .due-input { border-color: #fca5a5; }
  .due-date.soon .due-input { border-color: #fde68a; }
</style>
