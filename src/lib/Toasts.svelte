<script>
  import { toast } from './toast.js';
  let state = { message: '', visible: false };
  const unsubscribe = toast.subscribe((v) => (state = v));
  // clean up when unmounted
  import { onDestroy } from 'svelte';
  onDestroy(unsubscribe);
</script>

{#if state.visible}
  <div class="global-toast" role="status" aria-live="polite">{state.message}</div>
{/if}

<style>
  .global-toast {
    position: fixed;
    bottom: 20px;
    left: 50%;
    transform: translateX(-50%);
    background: var(--secondary);
    color: var(--primary);
    padding: 10px 18px;
    border-radius: var(--radius-md);
    box-shadow: var(--shadow-md);
    z-index: 1200;
    font-weight: 600;
    animation: slideUp 0.22s ease-out;
    max-width: 90vw;
    text-align: center;
  }

  @keyframes slideUp {
    from { opacity: 0; transform: translateX(-50%) translateY(8px); }
    to { opacity: 1; transform: translateX(-50%) translateY(0); }
  }
</style>
