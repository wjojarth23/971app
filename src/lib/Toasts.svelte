<script>
  import { toast } from './toast.js';
  let state = { message: '', visible: false };
  const unsubscribe = toast.subscribe((v) => (state = v));
  // clean up when unmounted
  import { onDestroy } from 'svelte';
  onDestroy(unsubscribe);
</script>

{#if state.visible}
  <div class="toast" role="status" aria-live="polite">{state.message}</div>
{/if}

<style>
  .toast {
    --toast-bg-current: var(--toast-bg);
    --toast-color-current: var(--toast-color);
    --toast-border: transparent;
    position: fixed;
    bottom: var(--space-4);
    left: 50%;
    transform: translateX(-50%);
    background: var(--toast-bg-current);
    color: var(--toast-color-current);
    padding: var(--space-3) var(--space-6);
    border-radius: var(--toast-radius);
    box-shadow: var(--toast-shadow);
    border: 1px solid var(--toast-border);
    z-index: 1200;
    font-weight: 600;
    animation: slideUp 0.22s ease-out;
    max-width: 90vw;
    text-align: center;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    gap: var(--gap-2);
  }

  .toast:global(.toast-success),
  .toast:global([data-variant="success"]) {
    --toast-bg-current: var(--green-soft);
    --toast-color-current: var(--green-strong);
    --toast-border: var(--green-soft);
  }

  .toast:global(.toast-danger),
  .toast:global([data-variant="danger"]),
  .toast:global([data-variant="error"]) {
    --toast-bg-current: var(--red-soft);
    --toast-color-current: var(--red-strong);
    --toast-border: var(--red-soft);
  }

  .toast:global(.toast-info),
  .toast:global([data-variant="info"]) {
    --toast-bg-current: var(--blue-soft);
    --toast-color-current: var(--blue-strong);
    --toast-border: var(--blue-soft);
  }

  .toast:global(.toast-warning),
  .toast:global([data-variant="warning"]) {
    --toast-bg-current: var(--brand-gold-soft);
    --toast-color-current: var(--brand-gold-strong);
    --toast-border: var(--brand-gold-soft);
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
