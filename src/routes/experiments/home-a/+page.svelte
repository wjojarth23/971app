<script>
  // EXPERIMENTAL — home page redesign concept A: "Editorial / Confident Minimal"
  // Not wired to real auth or data on purpose — a self-contained visual mockup
  // so it's viewable regardless of login state. Toggle between the two real
  // screens (signed-out / signed-in) this route needs to eventually replace.
  import { Mail, Lock, ArrowRight, Layers, Briefcase, Receipt, Clock, Shield } from 'lucide-svelte';

  let screen = 'signedout'; // 'signedout' | 'dashboard'

  const stats = [
    { label: 'Subsystems', value: 6, icon: Layers, href: '#' },
    { label: 'Builds', value: 14, icon: Briefcase, href: '#' },
    { label: 'Purchase Requests', value: 23, icon: Receipt, href: '#' },
    { label: 'Pending Approval', value: 3, icon: Clock, href: '#', alert: true }
  ];

  const subsystems = [
    { name: '2026 Drivetrain', desc: 'Swerve modules, gearboxes, chassis rails' },
    { name: '2026 Shooter', desc: 'Flywheel, hood, turret indexing' },
    { name: '2026 Climber', desc: 'Telescoping arm, ratchet, winch' }
  ];

  const purchases = [
    { name: 'MAXPlanetary 5:1 Slice', qty: 2, price: 148.0, status: 'pending' },
    { name: 'PETG-CF Filament', qty: 1, price: 34.99, status: 'ordered' },
    { name: '30t Aluminum Plate Sprocket', qty: 4, price: 13.0, status: 'approved' }
  ];
</script>

<svelte:head>
  <title>Home Concept A — Editorial</title>
  <link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;500;600;700;800&display=swap" rel="stylesheet" />
</svelte:head>

<div class="concept-shell">
  <div class="concept-toggle">
    <button class:active={screen === 'signedout'} on:click={() => (screen = 'signedout')}>Sign-in screen</button>
    <button class:active={screen === 'dashboard'} on:click={() => (screen = 'dashboard')}>Dashboard</button>
  </div>

  {#if screen === 'signedout'}
    <div class="hero-split">
      <div class="hero-brand-panel">
        <div class="hero-brand-inner">
          <span class="hero-eyebrow">FRC Team 971 &amp; 9584</span>
          <h1 class="hero-word">Spartans<br />Hub</h1>
        </div>
        <div class="hero-mesh" aria-hidden="true"></div>
      </div>

      <div class="hero-form-panel">
        <div class="hero-form-card">
          <div class="form-tabs-editorial">
            <button class="active">Sign In</button>
            <button>Register</button>
          </div>
          <form on:submit|preventDefault>
            <label class="field-editorial">
              <span><Mail size={15} /> Email</span>
              <input type="email" placeholder="you@spartanrobotics.org" />
            </label>
            <label class="field-editorial">
              <span><Lock size={15} /> Password</span>
              <input type="password" placeholder="••••••••••" />
            </label>
            <button type="submit" class="btn-editorial">Sign In</button>
          </form>
          <p class="hero-form-footnote">Forgot your password? <a href="/experiments">Reset it</a></p>
        </div>
      </div>
    </div>
  {:else}
    <div class="dash-editorial">
      <div class="dash-header">
        <span class="dash-eyebrow">Welcome back</span>
        <h1 class="dash-greeting">Yuvan<span class="dash-greeting-dim">.</span></h1>
        <p class="dash-sub">Here's where things stand across your subsystems, builds, and requests.</p>
      </div>

      <div class="stat-row-editorial">
        {#each stats as s}
          <a href={s.href} class="stat-editorial" class:alert={s.alert}>
            <div class="stat-editorial-top">
              <svelte:component this={s.icon} size={18} />
            </div>
            <span class="stat-editorial-value">{s.value}</span>
            <span class="stat-editorial-label">{s.label}</span>
          </a>
        {/each}
      </div>

      <div class="dash-grid-editorial">
        <section class="dash-panel">
          <div class="dash-panel-head">
            <h2>Your Subsystems</h2>
            <a href="/experiments" class="dash-panel-link">View all <ArrowRight size={13} /></a>
          </div>
          <div class="subsystem-list-editorial">
            {#each subsystems as s}
              <a href="/experiments" class="subsystem-row-editorial">
                <span class="subsystem-row-name">{s.name}</span>
                <span class="subsystem-row-desc">{s.desc}</span>
              </a>
            {/each}
          </div>
        </section>

        <section class="dash-panel">
          <div class="dash-panel-head">
            <h2>Purchase Requests</h2>
            <a href="/experiments" class="dash-panel-link">View all <ArrowRight size={13} /></a>
          </div>
          <div class="purchase-list-editorial">
            {#each purchases as p}
              <div class="purchase-row-editorial">
                <span class="purchase-row-name">{p.name}</span>
                <span class="purchase-row-qty">×{p.qty}</span>
                <span class="purchase-row-price">${p.price.toFixed(2)}</span>
                <span class="purchase-row-status status-{p.status}">{p.status}</span>
              </div>
            {/each}
          </div>
        </section>

        <section class="dash-panel dash-panel-admin">
          <div class="dash-panel-head">
            <h2>Admin</h2>
          </div>
          <a href="/experiments" class="admin-tile-editorial">
            <Shield size={22} />
            <span>Admin Panel</span>
            <ArrowRight size={15} />
          </a>
        </section>
      </div>
    </div>
  {/if}
</div>

<style>
  .concept-shell {
    animation: fadeUp 0.5s ease both;
  }
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(10px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .concept-toggle {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    background: var(--surface-2);
    border: 1px solid var(--border);
    border-radius: 999px;
    margin-bottom: var(--space-7);
  }
  .concept-toggle button {
    border: none;
    background: transparent;
    padding: 0.5rem 1.1rem;
    border-radius: 999px;
    font-family: var(--font-mono-stack);
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--text-muted);
    cursor: pointer;
    transition: background 0.15s ease, color 0.15s ease;
  }
  .concept-toggle button.active {
    background: var(--secondary);
    color: var(--primary);
  }

  /* ===== Signed-out: split hero ===== */
  .hero-split {
    display: grid;
    grid-template-columns: 1.15fr 1fr;
    min-height: 640px;
    border: 1px solid var(--border);
    border-radius: 18px;
    overflow: hidden;
  }
  @media (max-width: 900px) {
    .hero-split { grid-template-columns: 1fr; min-height: auto; }
  }

  .hero-brand-panel {
    position: relative;
    background: var(--secondary);
    color: var(--primary);
    display: flex;
    align-items: center;
    padding: clamp(2.5rem, 6vw, 5rem);
    overflow: hidden;
  }
  .hero-mesh {
    position: absolute;
    inset: -30%;
    background:
      radial-gradient(circle at 20% 20%, color-mix(in srgb, var(--accent) 55%, transparent) 0%, transparent 45%),
      radial-gradient(circle at 85% 75%, color-mix(in srgb, var(--accent) 35%, transparent) 0%, transparent 50%);
    filter: blur(60px);
    opacity: 0.55;
    animation: drift 16s ease-in-out infinite alternate;
    pointer-events: none;
  }
  @keyframes drift {
    from { transform: translate(0, 0) scale(1); }
    to { transform: translate(3%, -3%) scale(1.08); }
  }

  .hero-brand-inner { position: relative; z-index: 1; max-width: 520px; }
  .hero-eyebrow {
    font-family: var(--font-mono-stack);
    font-size: 0.72rem;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    opacity: 0.6;
    display: block;
    margin-bottom: var(--space-4);
  }
  .hero-word {
    /* Explicit color: h1 is targeted by the global `h1,h2,h3,h4 { color:
       var(--secondary) }` rule in app.css, which would otherwise beat the
       inherited light text color from .hero-brand-panel - since --secondary
       is also this panel's own background, that bug made the wordmark
       nearly invisible (same color as what's behind it). */
    color: var(--primary);
    font-family: var(--font-display);
    font-weight: 800;
    font-size: clamp(3rem, 6.5vw, 5.25rem);
    line-height: 0.94;
    letter-spacing: -0.02em;
    margin: 0 0 var(--space-6);
  }

  .hero-form-panel {
    display: flex;
    align-items: center;
    justify-content: center;
    padding: clamp(2rem, 4vw, 3.5rem);
    background: var(--primary);
  }
  .hero-form-card { width: 100%; max-width: 360px; }
  .form-tabs-editorial {
    display: flex;
    gap: var(--space-6);
    margin-bottom: var(--space-7);
    border-bottom: 1px solid var(--border);
  }
  .form-tabs-editorial button {
    background: none;
    border: none;
    padding: 0 0 0.85rem;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1rem;
    color: var(--text-muted);
    cursor: pointer;
    border-bottom: 2px solid transparent;
    margin-bottom: -1px;
  }
  .form-tabs-editorial button.active {
    color: var(--text);
    border-bottom-color: var(--accent);
  }
  .field-editorial {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
    margin-bottom: var(--space-6);
  }
  .field-editorial span {
    display: flex;
    align-items: center;
    gap: 0.35rem;
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.07em;
    color: var(--text-muted);
    font-family: var(--font-mono-stack);
  }
  .field-editorial input {
    border: none;
    border-bottom: 1.5px solid var(--border);
    background: transparent;
    padding: 0.6rem 0.1rem;
    font-size: 1rem;
    font-family: inherit;
    color: var(--text);
    transition: border-color 0.15s ease;
  }
  .field-editorial input:focus {
    outline: none;
    border-bottom-color: var(--accent-strong);
  }
  .btn-editorial {
    width: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    background: var(--secondary);
    color: var(--primary);
    border: none;
    border-radius: 999px;
    padding: 0.95rem;
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 0.95rem;
    cursor: pointer;
    margin-top: var(--space-4);
    transition: transform 0.15s ease, opacity 0.15s ease;
  }
  .btn-editorial:hover { transform: translateY(-1px); opacity: 0.9; }
  .hero-form-footnote {
    text-align: center;
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-top: var(--space-6);
  }
  .hero-form-footnote a { color: var(--accent-strong); font-weight: 600; }

  /* ===== Dashboard ===== */
  .dash-header { margin-bottom: var(--space-8); }
  .dash-eyebrow {
    font-family: var(--font-mono-stack);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--text-muted);
  }
  .dash-greeting {
    font-family: var(--font-display);
    font-weight: 300;
    font-size: clamp(2.5rem, 5vw, 4rem);
    line-height: 1;
    margin: 0.3rem 0 var(--space-3);
    letter-spacing: -0.01em;
  }
  .dash-greeting-dim { color: var(--accent-strong); }
  .dash-sub { color: var(--text-secondary); font-size: 1.02rem; max-width: 34rem; }

  .stat-row-editorial {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    gap: 1px;
    background: var(--border);
    border: 1px solid var(--border);
    border-radius: 14px;
    overflow: hidden;
    margin-bottom: var(--space-8);
  }
  @media (max-width: 760px) { .stat-row-editorial { grid-template-columns: repeat(2, 1fr); } }
  .stat-editorial {
    background: var(--card);
    padding: var(--space-6);
    display: flex;
    flex-direction: column;
    gap: var(--space-5);
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s ease;
  }
  .stat-editorial:hover { background: var(--surface-2); }
  .stat-editorial-top { display: flex; align-items: center; justify-content: space-between; color: var(--text-muted); }
  .stat-editorial.alert .stat-editorial-top { color: var(--accent-strong); }
  .stat-editorial-value {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: 2.5rem;
    line-height: 1;
  }
  .stat-editorial-label {
    font-size: 0.78rem;
    color: var(--text-muted);
  }

  .dash-grid-editorial {
    display: grid;
    grid-template-columns: 1.3fr 1fr;
    gap: var(--space-6);
  }
  @media (max-width: 900px) { .dash-grid-editorial { grid-template-columns: 1fr; } }
  .dash-panel {
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: var(--space-6);
  }
  .dash-panel-admin { grid-column: 1 / -1; }
  .dash-panel-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: var(--space-5);
  }
  .dash-panel-head h2 {
    font-family: var(--font-display);
    font-weight: 600;
    font-size: 1.1rem;
    margin: 0;
  }
  .dash-panel-link {
    font-size: 0.78rem;
    color: var(--text-muted);
    text-decoration: none;
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
  }
  .dash-panel-link:hover { color: var(--accent-strong); }

  .subsystem-list-editorial, .purchase-list-editorial { display: flex; flex-direction: column; }
  .subsystem-row-editorial {
    display: flex;
    flex-direction: column;
    gap: 0.15rem;
    padding: var(--space-4) 0;
    border-bottom: 1px solid var(--border);
    text-decoration: none;
    color: var(--text);
  }
  .subsystem-row-editorial:last-child { border-bottom: none; }
  .subsystem-row-name { font-family: var(--font-display); font-weight: 600; }
  .subsystem-row-desc { font-size: 0.82rem; color: var(--text-muted); }

  .purchase-row-editorial {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: var(--space-4);
    padding: var(--space-3) 0;
    border-bottom: 1px solid var(--border);
    font-size: 0.88rem;
  }
  .purchase-row-editorial:last-child { border-bottom: none; }
  .purchase-row-name { font-weight: 500; }
  .purchase-row-qty, .purchase-row-price { color: var(--text-muted); font-family: var(--font-mono-stack); font-size: 0.8rem; }
  .purchase-row-status {
    font-size: 0.68rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    font-weight: 600;
  }
  .status-pending { background: var(--status-pending-bg); color: var(--status-pending-text); }
  .status-ordered { background: var(--status-progress-bg); color: var(--status-progress-text); }
  .status-approved { background: var(--status-ready-bg); color: var(--status-ready-text); }

  .admin-tile-editorial {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    padding: var(--space-5);
    background: var(--secondary);
    color: var(--primary);
    border-radius: 10px;
    text-decoration: none;
    font-family: var(--font-display);
    font-weight: 600;
  }
  .admin-tile-editorial span { flex: 1; }
</style>
