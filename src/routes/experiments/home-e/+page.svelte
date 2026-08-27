<script>
  // EXPERIMENTAL — home page redesign concept E: "Command Deck"
  // Committed direction: an ops/status-board register (Grafana/Datadog-style
  // density) instead of a landing page - monospace throughout, a shell-prompt
  // styled login, live-status dots. Uses only the app's real theme variables
  // (no hardcoded dark background) so it still respects light/dark mode
  // instead of forcing its own palette - "terminal feel" comes from
  // typography/density/borders, not from overriding the app's colors.
  import { Mail, Lock } from 'lucide-svelte';

  let screen = 'signedout';

  const stats = [
    { label: 'subsystems', value: 6, status: 'ok' },
    { label: 'builds', value: 14, status: 'ok' },
    { label: 'purchase_requests', value: 23, status: 'ok' },
    { label: 'pending_approval', value: 3, status: 'warn' }
  ];

  const subsystems = [
    { name: '2026-drivetrain', members: 5, status: 'active' },
    { name: '2026-shooter', members: 4, status: 'active' },
    { name: '2026-climber', members: 3, status: 'idle' }
  ];

  const purchases = [
    { name: 'maxplanetary-5-1-slice', price: '148.00', status: 'pending' },
    { name: 'petg-cf-filament', price: '34.99', status: 'ordered' },
    { name: '30t-aluminum-sprocket', price: '13.00', status: 'approved' }
  ];
</script>

<svelte:head>
  <title>Home Concept E — Command Deck</title>
</svelte:head>

<div class="cd-shell">
  <div class="cd-toggle">
    <button class:active={screen === 'signedout'} on:click={() => (screen = 'signedout')}>~/sign-in</button>
    <button class:active={screen === 'dashboard'} on:click={() => (screen = 'dashboard')}>~/dashboard</button>
  </div>

  {#if screen === 'signedout'}
    <div class="cd-terminal">
      <div class="cd-terminal-bar">
        <span class="cd-dot cd-dot-red"></span><span class="cd-dot cd-dot-amber"></span><span class="cd-dot cd-dot-green"></span>
        <span class="cd-terminal-path">spartanshub — auth — 80×24</span>
      </div>
      <div class="cd-terminal-body">
        <p class="cd-line"><span class="cd-prompt">$</span> whoami</p>
        <h1 class="cd-ascii">SPARTANS HUB</h1>
        <p class="cd-line">&nbsp;</p>
        <p class="cd-line"><span class="cd-prompt">$</span> login --email --password</p>

        <form on:submit|preventDefault class="cd-form">
          <div class="cd-field">
            <span class="cd-field-key">email:</span>
            <Mail size={13} />
            <input type="email" placeholder="you@spartanrobotics.org" />
          </div>
          <div class="cd-field">
            <span class="cd-field-key">pass:</span>
            <Lock size={13} />
            <input type="password" placeholder="********" />
          </div>
          <button type="submit" class="cd-run">
            <span class="cd-prompt">$</span> run authenticate<span class="cd-cursor">▌</span>
          </button>
        </form>
        <p class="cd-line cd-comment"># no account? register — # forgot password? reset</p>
      </div>
    </div>
  {:else}
    <div class="cd-dash">
      <div class="cd-dash-topbar">
        <span><span class="cd-dot cd-dot-green"></span> operator: yuvan.shankar</span>
        <span class="cd-timestamp">session active</span>
      </div>

      <div class="cd-metric-grid">
        {#each stats as s}
          <div class="cd-metric">
            <div class="cd-metric-top">
              <span class="cd-status-dot cd-status-{s.status}"></span>
              <span class="cd-metric-key">{s.label}</span>
            </div>
            <span class="cd-metric-value">{String(s.value).padStart(2, '0')}</span>
          </div>
        {/each}
      </div>

      <div class="cd-tables">
        <div class="cd-table-block">
          <div class="cd-table-title">$ ls ./subsystems</div>
          <div class="cd-rows">
            {#each subsystems as s}
              <a href="/experiments" class="cd-row">
                <span class="cd-status-dot cd-status-{s.status === 'active' ? 'ok' : 'idle'}"></span>
                <span class="cd-row-name">{s.name}</span>
                <span class="cd-row-meta">{s.members} members</span>
              </a>
            {/each}
          </div>
        </div>

        <div class="cd-table-block">
          <div class="cd-table-title">$ cat ./purchasing/requests.log</div>
          <div class="cd-rows">
            {#each purchases as p}
              <div class="cd-row">
                <span class="cd-status-dot cd-status-{p.status === 'approved' ? 'ok' : p.status === 'pending' ? 'warn' : 'info'}"></span>
                <span class="cd-row-name">{p.name}</span>
                <span class="cd-row-meta">${p.price}</span>
                <span class="cd-row-status">{p.status}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>

      <a href="/experiments" class="cd-admin-line">$ sudo ./admin --panel</a>
    </div>
  {/if}
</div>

<style>
  .cd-shell { font-family: var(--font-mono-stack); animation: cdFade 0.25s ease both; }
  @keyframes cdFade { from { opacity: 0; } to { opacity: 1; } }

  .cd-toggle { display: inline-flex; gap: var(--space-2); margin-bottom: var(--space-6); }
  .cd-toggle button {
    border: 1px solid var(--border);
    background: var(--card);
    padding: 0.4rem 0.85rem;
    font-family: var(--font-mono-stack);
    font-size: 0.74rem;
    color: var(--text-muted);
    cursor: pointer;
  }
  .cd-toggle button.active { background: var(--secondary); color: var(--primary); border-color: var(--secondary); }

  .cd-terminal { border: 1px solid var(--border); background: var(--card); }
  .cd-terminal-bar {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.6rem 0.9rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
  }
  .cd-dot { width: 9px; height: 9px; border-radius: 999px; display: inline-block; }
  .cd-dot-red { background: var(--red-base); }
  .cd-dot-amber { background: var(--brand-gold-base); }
  .cd-dot-green { background: var(--green-base); }
  .cd-terminal-path { margin-left: auto; font-size: 0.7rem; color: var(--text-muted); }

  .cd-terminal-body { padding: clamp(1.5rem, 4vw, 3rem); max-width: 640px; }
  .cd-line { margin: 0 0 0.3rem; font-size: 0.85rem; }
  .cd-prompt { color: var(--green-base); font-weight: 700; margin-right: 0.5rem; }
  .cd-comment { color: var(--text-muted); }
  .cd-ascii {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(1.8rem, 4.5vw, 2.6rem);
    letter-spacing: -0.01em;
    margin: 0.4rem 0 1.2rem;
  }

  .cd-form { margin: var(--space-6) 0 var(--space-4) 1.5rem; }
  .cd-field {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: var(--space-4);
    padding-bottom: 0.5rem;
    border-bottom: 1px dashed var(--border);
  }
  .cd-field-key { color: var(--green-base); font-size: 0.82rem; width: 3.6rem; flex-shrink: 0; }
  .cd-field input {
    border: none;
    background: none;
    outline: none;
    flex: 1;
    font-family: inherit;
    font-size: 0.85rem;
    color: var(--text);
  }
  .cd-run {
    display: block;
    background: none;
    border: 1px solid var(--green-base);
    color: var(--green-base);
    padding: 0.55rem 0.9rem;
    font-family: inherit;
    font-size: 0.82rem;
    cursor: pointer;
    margin-top: var(--space-3);
  }
  .cd-run:hover { background: var(--green-base); color: var(--primary); }
  .cd-cursor { animation: blink 1s step-end infinite; margin-left: 0.2rem; }
  @keyframes blink { 50% { opacity: 0; } }

  /* ===== Dashboard ===== */
  .cd-dash-topbar {
    display: flex;
    justify-content: space-between;
    font-size: 0.78rem;
    padding-bottom: var(--space-4);
    border-bottom: 1px solid var(--border);
    margin-bottom: var(--space-6);
    color: var(--text-secondary);
  }
  .cd-timestamp { color: var(--text-muted); }

  .cd-metric-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    margin-bottom: var(--space-6);
  }
  @media (max-width: 700px) { .cd-metric-grid { grid-template-columns: repeat(2, 1fr); } }
  .cd-metric { background: var(--card); padding: var(--space-5); }
  .cd-metric-top { display: flex; align-items: center; gap: 0.4rem; margin-bottom: var(--space-3); }
  .cd-metric-key { font-size: 0.7rem; color: var(--text-muted); }
  .cd-metric-value { font-family: var(--font-display); font-weight: 700; font-size: 2.1rem; font-variant-numeric: tabular-nums; }

  .cd-status-dot { width: 7px; height: 7px; border-radius: 999px; flex-shrink: 0; }
  .cd-status-ok { background: var(--green-base); }
  .cd-status-warn { background: var(--brand-gold-base); }
  .cd-status-info { background: var(--blue-base); }
  .cd-status-idle { background: var(--text-muted); }

  .cd-tables { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); margin-bottom: var(--space-6); }
  @media (max-width: 860px) { .cd-tables { grid-template-columns: 1fr; } }
  .cd-table-block { border: 1px solid var(--border); }
  .cd-table-title {
    padding: 0.55rem 0.9rem;
    background: var(--surface-2);
    border-bottom: 1px solid var(--border);
    font-size: 0.76rem;
    color: var(--green-base);
  }
  .cd-rows { padding: 0.3rem 0; }
  .cd-row {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    padding: 0.55rem 0.9rem;
    font-size: 0.8rem;
    text-decoration: none;
    color: var(--text);
  }
  .cd-row-name { flex: 1; }
  .cd-row-meta { color: var(--text-muted); font-size: 0.75rem; }
  .cd-row-status { color: var(--text-muted); font-size: 0.72rem; }

  .cd-admin-line {
    display: inline-block;
    color: var(--text);
    text-decoration: none;
    font-size: 0.85rem;
    padding: 0.3rem 0;
    border-bottom: 1px solid transparent;
  }
  .cd-admin-line:hover { border-bottom-color: var(--text); }
</style>
