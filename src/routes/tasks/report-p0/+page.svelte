<script>
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  onMount(() => {
    const url = new URL(window.location.href);
    const params = new URLSearchParams(url.search);
    params.set('report_p0', '1');
    goto(`/tasks?${params.toString()}`, { replaceState: true });
  });
</script>
