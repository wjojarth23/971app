<script>
  // EXPERIMENTAL — local-only index of home page redesign concepts.
  // Not linked from the real nav; visit directly at /experiments.
  const concepts = [
    { href: '/experiments/home-a', name: 'A — Editorial', desc: 'Split-screen hero, confident oversized type, thin-divider stat row. (Reviewed well.)' },
    { href: '/experiments/home-b', name: 'B — Bento', desc: 'Grid of tinted cards, revised to drop the gradient hero for flat on-brand color.' },
    { href: '/experiments/home-c', name: 'C — Blueprint', desc: 'Engineering-drawing register: dimension lines, part-number IDs, JetBrains Mono as a real second typeface.' },
    { href: '/experiments/home-d', name: 'D — Pit Board', desc: 'FRC scoreboard/pit-display typography: big condensed numerals, one decisive gold accent, near-zero motion.' },
    { href: '/experiments/home-e', name: 'E — Command Deck', desc: 'Ops-dashboard density, shell-prompt login, theme-aware (no hardcoded dark background).' }
  ];
</script>

<svelte:head>
  <title>Home Page Redesign Concepts</title>
</svelte:head>

<div style="max-width: 720px; margin: 4rem auto; text-align: center;">
  <h1 style="font-family: var(--font-display); font-weight: 700;">Home Page Redesign — Concepts</h1>
  <p class="text-muted" style="margin-bottom: 2rem;">Local experiments, not wired to real data. Each has a toggle between the sign-in screen and the dashboard.</p>
  <div style="display: flex; flex-direction: column; gap: 0.75rem; text-align: left;">
    {#each concepts as c}
      <a href={c.href} class="btn btn-secondary" style="padding: 1rem; display: flex; flex-direction: column; align-items: flex-start; gap: 0.2rem;">
        <strong>{c.name}</strong>
        <span class="text-muted" style="font-size: 0.85rem;">{c.desc}</span>
      </a>
    {/each}
  </div>
</div>
