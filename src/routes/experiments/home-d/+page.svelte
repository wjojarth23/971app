<script>
  // EXPERIMENTAL — home page redesign concept D: "Pit Board / Scoreboard"
  // Committed direction: borrows from FRC pit-display and scoreboard typography
  // instead of SaaS-dashboard conventions — big condensed numerals, black/white
  // with ONE decisive gold accent (never a gradient), horizontal rules instead
  // of cards-in-cards, almost no motion (one deliberate count-up). Uses only
  // the app's actual tokens (gold/blue/green/red) - no pink, no purple, no neon.
  import { Mail, Lock } from 'lucide-svelte';
  import { onMount } from 'svelte';

  let screen = 'signedout';
  let counted = false;
  onMount(() => { requestAnimationFrame(() => (counted = true)); });

  const stats = [
    { label: 'SUBSYSTEMS', value: 6 },
    { label: 'BUILDS', value: 14 },
    { label: 'PURCHASE REQ', value: 23 },
    { label: 'PENDING', value: 3, flag: true }
  ];

  const subsystems = [
    { name: '2026 Drivetrain', tag: 'DT' },
    { name: '2026 Shooter', tag: 'SH' },
    { name: '2026 Climber', tag: 'CL' }
  ];

  const purchases = [
    { name: 'MAXPlanetary 5:1 Slice', price: '148.00', status: 'PENDING' },
    { name: 'PETG-CF Filament', price: '34.99', status: 'ORDERED' },
    { name: '30t Aluminum Plate Sprocket', price: '13.00', status: 'APPROVED' }
  ];
</script>

<svelte:head>
  <title>Home Concept D — Pit Board</title>
</svelte:head>

<div class="pb-shell">
  <div class="pb-toggle">
    <button class:active={screen === 'signedout'} on:click={() => (screen = 'signedout')}>SIGN IN</button>
    <button class:active={screen === 'dashboard'} on:click={() => (screen = 'dashboard')}>DASHBOARD</button>
  </div>

  {#if screen === 'signedout'}
    <div class="pb-masthead">
      <div class="pb-masthead-row">
        <span class="pb-kicker">SPARTAN ROBOTICS — TEAMS 971 &amp; 9584</span>
        <span class="pb-kicker pb-kicker-right">SEASON 2026</span>
      </div>
      <h1 class="pb-title">SPARTANS HUB</h1>
      <div class="pb-rule"></div>
    </div>

    <div class="pb-signin-grid">
      <form on:submit|preventDefault class="pb-signin-form">
        <div class="pb-field">
          <Mail size={15} />
          <input type="email" placeholder="Email address" />
        </div>
        <div class="pb-field">
          <Lock size={15} />
          <input type="password" placeholder="Password" />
        </div>
        <button type="submit" class="pb-submit">SIGN IN</button>
        <p class="pb-alt">New here? <a href="/experiments">Register an account</a></p>
      </form>
    </div>
  {:else}
    <div class="pb-dash">
      <div class="pb-masthead-row">
        <span class="pb-kicker">WELCOME BACK</span>
        <span class="pb-kicker pb-kicker-right">YUVAN SHANKAR</span>
      </div>
      <h1 class="pb-title pb-title-sm">DASHBOARD</h1>
      <div class="pb-rule"></div>

      <div class="pb-scoreboard">
        {#each stats as s}
          <div class="pb-score" class:flag={s.flag}>
            <span class="pb-score-value" class:counted>{counted ? s.value : 0}</span>
            <span class="pb-score-label">{s.label}</span>
          </div>
        {/each}
      </div>

      <div class="pb-columns">
        <section>
          <h2 class="pb-col-head">YOUR SUBSYSTEMS</h2>
          {#each subsystems as s, i}
            <a href="/experiments" class="pb-list-row">
              <span class="pb-list-index">{String(i + 1).padStart(2, '0')}</span>
              <span class="pb-list-name">{s.name}</span>
              <span class="pb-list-tag">{s.tag}</span>
            </a>
          {/each}
        </section>

        <section>
          <h2 class="pb-col-head">PURCHASE REQUESTS</h2>
          {#each purchases as p, i}
            <div class="pb-list-row">
              <span class="pb-list-index">{String(i + 1).padStart(2, '0')}</span>
              <span class="pb-list-name">{p.name}</span>
              <span class="pb-price">${p.price}</span>
              <span class="pb-tag pb-tag-{p.status.toLowerCase()}">{p.status}</span>
            </div>
          {/each}
        </section>
      </div>

      <a href="/experiments" class="pb-admin-bar">ADMIN PANEL →</a>
    </div>
  {/if}
</div>

<style>
  .pb-shell { animation: pbFade 0.3s ease both; }
  @keyframes pbFade { from { opacity: 0; } to { opacity: 1; } }

  .pb-toggle { display: inline-flex; gap: 0; margin-bottom: var(--space-7); }
  .pb-toggle button {
    border: 1.5px solid var(--secondary);
    background: var(--card);
    padding: 0.45rem 1rem;
    font-family: var(--font-mono-stack);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--secondary);
    cursor: pointer;
    margin-left: -1.5px;
  }
  .pb-toggle button:first-child { margin-left: 0; }
  .pb-toggle button.active { background: var(--secondary); color: var(--primary); }

  .pb-masthead-row {
    display: flex;
    justify-content: space-between;
    font-family: var(--font-mono-stack);
    font-size: 0.7rem;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: var(--space-3);
  }
  .pb-kicker-right { color: var(--accent-strong); font-weight: 700; }

  .pb-title {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(3rem, 9vw, 6.5rem);
    line-height: 0.9;
    letter-spacing: -0.02em;
    margin: 0;
    text-transform: uppercase;
  }
  .pb-title-sm { font-size: clamp(2.2rem, 6vw, 3.5rem); }
  .pb-rule { height: 4px; background: var(--secondary); margin: var(--space-5) 0 var(--space-8); }

  .pb-signin-grid {
    display: flex;
    justify-content: center;
  }

  .pb-signin-form { width: 100%; max-width: 420px; border-top: 3px solid var(--secondary); padding-top: var(--space-6); }
  .pb-field {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    border-bottom: 1.5px solid var(--border);
    padding: 0.7rem 0.1rem;
    margin-bottom: var(--space-5);
    color: var(--text-muted);
  }
  .pb-field:focus-within { border-bottom-color: var(--secondary); color: var(--text); }
  .pb-field input { border: none; background: none; outline: none; flex: 1; font-size: 0.95rem; font-family: inherit; color: var(--text); }
  .pb-submit {
    width: 100%;
    background: var(--secondary);
    color: var(--primary);
    border: none;
    padding: 0.85rem;
    font-family: var(--font-display);
    font-weight: 700;
    letter-spacing: 0.03em;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .pb-submit:hover { background: var(--accent-strong); }
  .pb-alt { font-size: 0.8rem; color: var(--text-muted); margin-top: var(--space-5); }
  .pb-alt a { color: var(--accent-strong); font-weight: 700; }

  .pb-scoreboard {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 0;
    border-top: 3px solid var(--secondary);
    border-bottom: 3px solid var(--secondary);
    margin-bottom: var(--space-8);
  }
  @media (max-width: 700px) { .pb-scoreboard { grid-template-columns: repeat(2, 1fr); } }
  .pb-score {
    padding: var(--space-6) var(--space-4);
    text-align: center;
    border-right: 1px solid var(--border);
  }
  .pb-score:last-child { border-right: none; }
  .pb-score.flag { background: color-mix(in srgb, var(--accent-strong) 10%, transparent); }
  .pb-score-value {
    display: block;
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(2.4rem, 5vw, 3.4rem);
    line-height: 1;
    font-variant-numeric: tabular-nums;
    transition: opacity 0.4s ease;
  }
  .pb-score-label { display: block; font-size: 0.66rem; letter-spacing: 0.08em; color: var(--text-muted); margin-top: 0.5rem; }

  .pb-columns { display: grid; grid-template-columns: 1fr 1fr; gap: clamp(2rem, 4vw, 4rem); margin-bottom: var(--space-8); }
  @media (max-width: 820px) { .pb-columns { grid-template-columns: 1fr; } }
  .pb-col-head {
    font-family: var(--font-mono-stack);
    font-size: 0.72rem;
    letter-spacing: 0.1em;
    color: var(--text-muted);
    border-bottom: 1.5px solid var(--secondary);
    padding-bottom: 0.6rem;
    margin: 0 0 var(--space-2);
  }
  .pb-list-row {
    display: flex;
    align-items: center;
    gap: var(--space-4);
    padding: 0.85rem 0;
    border-bottom: 1px solid var(--border);
    text-decoration: none;
    color: var(--text);
  }
  .pb-list-index { font-family: var(--font-mono-stack); font-size: 0.72rem; color: var(--border); width: 1.4rem; flex-shrink: 0; }
  .pb-list-name { flex: 1; font-weight: 600; }
  .pb-list-tag { font-family: var(--font-mono-stack); font-size: 0.68rem; color: var(--text-muted); }
  .pb-price { font-family: var(--font-mono-stack); font-size: 0.78rem; color: var(--text-muted); }
  .pb-tag {
    font-size: 0.62rem;
    font-weight: 700;
    letter-spacing: 0.05em;
    padding: 0.2rem 0.5rem;
  }
  .pb-tag-pending { background: var(--status-pending-bg); color: var(--status-pending-text); }
  .pb-tag-ordered { background: var(--status-progress-bg); color: var(--status-progress-text); }
  .pb-tag-approved { background: var(--status-ready-bg); color: var(--status-ready-text); }

  .pb-admin-bar {
    display: block;
    text-align: center;
    background: var(--secondary);
    color: var(--primary);
    text-decoration: none;
    padding: 0.9rem;
    font-family: var(--font-display);
    font-weight: 700;
    letter-spacing: 0.03em;
  }
  .pb-admin-bar:hover { background: var(--accent-strong); }
</style>
