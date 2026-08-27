<script>
  // EXPERIMENTAL — home page redesign concept C: "Blueprint / Technical Drafting"
  // Committed direction (not a generic template): this app IS a CAD/CNC/manufacturing
  // tool, so the home screen borrows from engineering-drawing conventions instead of
  // SaaS-landing-page conventions — dimension lines, part-number-style identifiers,
  // JetBrains Mono used as a genuine co-equal typeface (not filler), a single amber
  // "shop warning" accent instead of a gradient. Deliberately avoids: purple/blue
  // gradients, centered hero, rounded-2xl+shadow-lg defaults, Sparkles/ArrowRight
  // icon-on-every-button, uniform fade-in-up on every element.
  import { Mail, Lock } from 'lucide-svelte';

  let screen = 'signedout';

  const stats = [
    { code: '01', label: 'SUBSYSTEMS', value: '06' },
    { code: '02', label: 'BUILDS', value: '14' },
    { code: '03', label: 'PURCHASE REQ.', value: '23' },
    { code: '04', label: 'PENDING APPR.', value: '03', flag: true }
  ];

  const subsystems = [
    { id: 'SYS-2026-DT', name: '2026 Drivetrain', rev: 'REV C' },
    { id: 'SYS-2026-SH', name: '2026 Shooter', rev: 'REV B' },
    { id: 'SYS-2026-CL', name: '2026 Climber', rev: 'REV A' }
  ];

  const purchases = [
    { name: 'MAXPlanetary 5:1 Slice', qty: '2', price: '148.00', status: 'PENDING' },
    { name: 'PETG-CF Filament', qty: '1', price: '34.99', status: 'ORDERED' },
    { name: '30t Aluminum Plate Sprocket', qty: '4', price: '13.00', status: 'APPROVED' }
  ];
</script>

<svelte:head>
  <title>Home Concept C — Blueprint</title>
</svelte:head>

<div class="bp-shell">
  <div class="bp-toggle">
    <button class:active={screen === 'signedout'} on:click={() => (screen = 'signedout')}>SIGN-IN</button>
    <button class:active={screen === 'dashboard'} on:click={() => (screen = 'dashboard')}>DASHBOARD</button>
  </div>

  {#if screen === 'signedout'}
    <div class="bp-sheet">
      <div class="bp-sheet-header">
        <div class="bp-titleblock">
          <span class="bp-titleblock-label">DOC</span>
          <span class="bp-titleblock-value">SPARTANS-HUB-001</span>
        </div>
        <div class="bp-titleblock">
          <span class="bp-titleblock-label">TEAMS</span>
          <span class="bp-titleblock-value">971 / 9584</span>
        </div>
        <div class="bp-titleblock">
          <span class="bp-titleblock-label">STATUS</span>
          <span class="bp-titleblock-value bp-status-live">ACTIVE SEASON</span>
        </div>
      </div>

      <div class="bp-main">
        <div class="bp-main-left">
          <span class="bp-dim-line" aria-hidden="true"></span>
          <h1 class="bp-wordmark">SPARTANS<br />HUB</h1>
        </div>

        <div class="bp-main-right">
          <div class="bp-form-header">
            <span>ACCESS —</span>
            <button class="bp-form-tab active">SIGN IN</button>
            <button class="bp-form-tab">REGISTER</button>
          </div>
          <form on:submit|preventDefault class="bp-form">
            <label>
              <span class="bp-field-num">01</span>
              <span class="bp-field-label"><Mail size={13} /> EMAIL</span>
              <input type="email" placeholder="you@spartanrobotics.org" />
            </label>
            <label>
              <span class="bp-field-num">02</span>
              <span class="bp-field-label"><Lock size={13} /> PASSWORD</span>
              <input type="password" placeholder="—————————" />
            </label>
            <button type="submit" class="bp-submit">SIGN IN</button>
          </form>
          <p class="bp-forgot">Forgot password — reset it here</p>
        </div>
      </div>
    </div>
  {:else}
    <div class="bp-dash">
      <div class="bp-dash-header">
        <div>
          <span class="bp-dash-eyebrow">OPERATOR</span>
          <h1>Yuvan Shankar</h1>
        </div>
        <div class="bp-dash-meta">
          <span>SESSION</span>
          <strong>ACTIVE</strong>
        </div>
      </div>

      <div class="bp-stat-strip">
        {#each stats as s}
          <div class="bp-stat" class:flag={s.flag}>
            <span class="bp-stat-code">{s.code}</span>
            <span class="bp-stat-value">{s.value}</span>
            <span class="bp-stat-label">{s.label}</span>
          </div>
        {/each}
      </div>

      <div class="bp-panels">
        <section class="bp-panel">
          <header><h2>SUBSYSTEMS</h2><span class="bp-panel-count">{subsystems.length} ACTIVE</span></header>
          <table class="bp-table">
            <thead><tr><th>ID</th><th>NAME</th><th>REV</th></tr></thead>
            <tbody>
              {#each subsystems as s}
                <tr><td class="bp-mono">{s.id}</td><td>{s.name}</td><td class="bp-mono">{s.rev}</td></tr>
              {/each}
            </tbody>
          </table>
        </section>

        <section class="bp-panel">
          <header><h2>PURCHASE REQUESTS</h2><span class="bp-panel-count">{purchases.length} OPEN</span></header>
          <table class="bp-table">
            <thead><tr><th>ITEM</th><th>QTY</th><th>PRICE</th><th>STATUS</th></tr></thead>
            <tbody>
              {#each purchases as p}
                <tr>
                  <td>{p.name}</td>
                  <td class="bp-mono">{p.qty}</td>
                  <td class="bp-mono">${p.price}</td>
                  <td><span class="bp-status-tag status-{p.status.toLowerCase()}">{p.status}</span></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </section>
      </div>

      <a href="/experiments" class="bp-admin-strip">
        <span>ADMIN PANEL</span>
        <span class="bp-admin-strip-sub">MANAGE USERS, ROLES, PERMISSIONS</span>
      </a>
    </div>
  {/if}
</div>

<style>
  .bp-shell {
    font-family: var(--font-mono-stack);
    animation: bpIn 0.35s ease both;
  }
  @keyframes bpIn { from { opacity: 0; } to { opacity: 1; } }

  .bp-toggle { display: flex; gap: 0; margin-bottom: var(--space-6); border: 1px solid var(--border); width: fit-content; }
  .bp-toggle button {
    border: none;
    background: var(--card);
    padding: 0.5rem 1rem;
    font-family: var(--font-mono-stack);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    cursor: pointer;
    border-right: 1px solid var(--border);
  }
  .bp-toggle button:last-child { border-right: none; }
  .bp-toggle button.active { background: var(--secondary); color: var(--primary); }

  /* ===== Sign-in sheet ===== */
  .bp-sheet {
    border: 1px solid var(--border);
    background:
      repeating-linear-gradient(0deg, transparent, transparent 31px, color-mix(in srgb, var(--border) 45%, transparent) 32px),
      repeating-linear-gradient(90deg, transparent, transparent 31px, color-mix(in srgb, var(--border) 45%, transparent) 32px);
  }
  .bp-sheet-header {
    display: flex;
    border-bottom: 1px solid var(--border);
    background: var(--card);
  }
  .bp-titleblock {
    flex: 1;
    padding: 0.6rem 1rem;
    border-right: 1px solid var(--border);
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
  }
  .bp-titleblock:last-child { border-right: none; }
  .bp-titleblock-label { font-size: 0.6rem; letter-spacing: 0.1em; color: var(--text-muted); }
  .bp-titleblock-value { font-size: 0.78rem; font-weight: 600; letter-spacing: 0.02em; }
  .bp-status-live { color: var(--accent-strong); }

  .bp-main {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
  }
  @media (max-width: 860px) { .bp-main { grid-template-columns: 1fr; } }

  .bp-main-left {
    position: relative;
    padding: clamp(2.5rem, 5vw, 4.5rem) clamp(1.5rem, 4vw, 3.5rem);
    background: var(--card);
    border-right: 1px solid var(--border);
  }
  @media (max-width: 860px) { .bp-main-left { border-right: none; border-bottom: 1px solid var(--border); } }
  .bp-dim-line {
    display: block;
    width: 60px;
    height: 2px;
    background: var(--accent-strong);
    margin-bottom: var(--space-6);
  }
  .bp-wordmark {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(2.6rem, 5.5vw, 4rem);
    line-height: 0.96;
    letter-spacing: -0.01em;
    margin: 0 0 var(--space-6);
  }
  .bp-main-right {
    padding: clamp(2.5rem, 5vw, 4.5rem) clamp(1.5rem, 4vw, 3rem);
    background: var(--background);
  }
  .bp-form-header {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: var(--space-6);
    font-size: 0.68rem;
    letter-spacing: 0.08em;
    color: var(--text-muted);
  }
  .bp-form-tab {
    border: 1px solid var(--border);
    background: var(--card);
    padding: 0.35rem 0.7rem;
    font-family: var(--font-mono-stack);
    font-size: 0.68rem;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    cursor: pointer;
  }
  .bp-form-tab.active { background: var(--secondary); color: var(--primary); border-color: var(--secondary); }

  .bp-form label {
    display: block;
    margin-bottom: var(--space-5);
    position: relative;
  }
  .bp-field-num {
    position: absolute;
    top: 0;
    right: 0;
    font-size: 0.6rem;
    color: var(--border);
  }
  .bp-field-label {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.66rem;
    letter-spacing: 0.08em;
    color: var(--text-muted);
    margin-bottom: 0.4rem;
  }
  .bp-form input {
    width: 100%;
    box-sizing: border-box;
    border: 1px solid var(--border);
    background: var(--card);
    padding: 0.65rem 0.7rem;
    font-family: var(--font-mono-stack);
    font-size: 0.85rem;
    color: var(--text);
  }
  .bp-form input:focus { outline: none; border-color: var(--accent-strong); }
  .bp-submit {
    width: 100%;
    background: var(--secondary);
    color: var(--primary);
    border: none;
    padding: 0.8rem;
    font-family: var(--font-mono-stack);
    font-size: 0.78rem;
    letter-spacing: 0.1em;
    cursor: pointer;
    margin-top: var(--space-2);
  }
  .bp-submit:hover { background: var(--accent-strong); }
  .bp-forgot { font-size: 0.72rem; color: var(--text-muted); margin-top: var(--space-5); }

  /* ===== Dashboard ===== */
  .bp-dash-header {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    border-bottom: 2px solid var(--secondary);
    padding-bottom: var(--space-4);
    margin-bottom: var(--space-6);
  }
  .bp-dash-eyebrow { font-size: 0.66rem; letter-spacing: 0.1em; color: var(--text-muted); }
  .bp-dash-header h1 { font-family: var(--font-display); font-weight: 700; font-size: 1.8rem; margin: 0.2rem 0 0; }
  .bp-dash-meta { display: flex; flex-direction: column; align-items: flex-end; gap: 0.1rem; font-size: 0.62rem; color: var(--text-muted); }
  .bp-dash-meta strong { color: var(--green-base); font-size: 0.72rem; letter-spacing: 0.06em; }

  .bp-stat-strip {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    border: 1px solid var(--border);
    margin-bottom: var(--space-6);
  }
  @media (max-width: 700px) { .bp-stat-strip { grid-template-columns: repeat(2, 1fr); } }
  .bp-stat {
    padding: var(--space-5);
    border-right: 1px solid var(--border);
    position: relative;
  }
  .bp-stat:last-child { border-right: none; }
  .bp-stat.flag { background: color-mix(in srgb, var(--accent-strong) 8%, transparent); }
  .bp-stat-code { position: absolute; top: 0.5rem; right: 0.6rem; font-size: 0.6rem; color: var(--border); }
  .bp-stat-value { display: block; font-family: var(--font-display); font-weight: 700; font-size: 2.1rem; line-height: 1; }
  .bp-stat-label { display: block; font-size: 0.62rem; letter-spacing: 0.06em; color: var(--text-muted); margin-top: 0.4rem; }

  .bp-panels { display: grid; grid-template-columns: 1fr 1fr; gap: var(--space-5); margin-bottom: var(--space-5); }
  @media (max-width: 860px) { .bp-panels { grid-template-columns: 1fr; } }
  .bp-panel { border: 1px solid var(--border); }
  .bp-panel header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 0.9rem;
    background: var(--card);
    border-bottom: 1px solid var(--border);
  }
  .bp-panel h2 { font-family: var(--font-display); font-size: 0.8rem; letter-spacing: 0.03em; margin: 0; }
  .bp-panel-count { font-size: 0.6rem; color: var(--text-muted); letter-spacing: 0.05em; }

  .bp-table { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  .bp-table th {
    text-align: left;
    padding: 0.4rem 0.9rem;
    font-size: 0.6rem;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    border-bottom: 1px solid var(--border);
    font-weight: 500;
  }
  .bp-table td { padding: 0.5rem 0.9rem; border-bottom: 1px solid var(--border); }
  .bp-table tr:last-child td { border-bottom: none; }
  .bp-mono { font-family: var(--font-mono-stack); font-size: 0.72rem; color: var(--text-muted); }
  .bp-status-tag {
    font-size: 0.6rem;
    letter-spacing: 0.05em;
    padding: 0.15rem 0.45rem;
    border: 1px solid currentColor;
  }
  .status-pending { color: var(--status-pending-text); }
  .status-ordered { color: var(--status-progress-text); }
  .status-approved { color: var(--status-ready-text); }

  .bp-admin-strip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    border: 1px solid var(--secondary);
    background: var(--secondary);
    color: var(--primary);
    padding: 0.85rem 1.1rem;
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.85rem;
  }
  .bp-admin-strip-sub { font-family: var(--font-mono-stack); font-weight: 400; font-size: 0.62rem; letter-spacing: 0.06em; opacity: 0.65; }
</style>
