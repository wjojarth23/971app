<script>
  // EXPERIMENTAL — home page redesign concept B: "Bento" (revised)
  // First pass used a gold->blue->purple gradient hero and gradient-clip-text,
  // which read as vibrant/off-brand in review (the gold-to-purple blend reads
  // pink in the transition zone) - also a flagged AI-design cliché (gradient
  // hero + gradient text + a Sparkles badge icon). This pass: one dominant
  // neutral surface, gold used as a single sharp accent (matching the app's
  // own --accent token), flat colors only, no gradients, no Sparkles.
  import { Mail, Lock, Layers, Briefcase, Receipt, Clock, Shield, Users, Wrench } from 'lucide-svelte';

  let screen = 'signedout'; // 'signedout' | 'dashboard'

  const stats = [
    { label: 'Subsystems', value: 6, icon: Layers },
    { label: 'Builds', value: 14, icon: Briefcase },
    { label: 'Purchase Requests', value: 23, icon: Receipt },
    { label: 'Pending Approval', value: 3, icon: Clock, alert: true }
  ];

  const subsystems = [
    { name: '2026 Drivetrain', members: 5 },
    { name: '2026 Shooter', members: 4 },
    { name: '2026 Climber', members: 3 }
  ];

  const purchases = [
    { name: 'MAXPlanetary 5:1 Slice', qty: 2, price: 148.0, status: 'pending' },
    { name: 'PETG-CF Filament', qty: 1, price: 34.99, status: 'ordered' },
    { name: '30t Aluminum Plate Sprocket', qty: 4, price: 13.0, status: 'approved' }
  ];
</script>

<svelte:head>
  <title>Home Concept B — Bento</title>
</svelte:head>

<div class="concept-shell-b">
  <div class="concept-toggle-b">
    <button class:active={screen === 'signedout'} on:click={() => (screen = 'signedout')}>Sign-in screen</button>
    <button class:active={screen === 'dashboard'} on:click={() => (screen = 'dashboard')}>Dashboard</button>
  </div>

  {#if screen === 'signedout'}
    <div class="hero-b">
      <div class="hero-b-content">
        <span class="hero-b-badge">Spartan Robotics — Teams 971 &amp; 9584</span>
        <h1 class="hero-b-title">Welcome to Spartans Hub</h1>
        <p class="hero-b-sub">CAD, manufacturing, purchasing, and scouting — all in one place.</p>

        <div class="hero-b-card">
          <div class="hero-b-tabs">
            <button class="active">Sign In</button>
            <button>Register</button>
          </div>
          <form on:submit|preventDefault>
            <div class="field-b">
              <Mail size={16} />
              <input type="email" placeholder="Email address" />
            </div>
            <div class="field-b">
              <Lock size={16} />
              <input type="password" placeholder="Password" />
            </div>
            <button type="submit" class="btn-b-primary">Sign In</button>
          </form>
          <p class="hero-b-footnote">No account? <a href="/experiments">Register here</a></p>
        </div>
      </div>
    </div>
  {:else}
    <div class="dash-b">
      <div class="dash-b-header">
        <div>
          <h1>Welcome back, Yuvan <span class="wave">👋</span></h1>
          <p>Quick access to your subsystems, builds, and purchases.</p>
        </div>
      </div>

      <div class="bento-grid">
        {#each stats as s, i}
          <a href="/experiments" class="bento-cell stat-cell" class:alert={s.alert} style="--i:{i}">
            <div class="bento-icon"><svelte:component this={s.icon} size={20} /></div>
            <span class="bento-value">{s.value}</span>
            <span class="bento-label">{s.label}</span>
          </a>
        {/each}

        <div class="bento-cell wide-cell">
          <div class="bento-head">
            <h3><Users size={16} /> Your Subsystems</h3>
            <a href="/experiments" class="bento-link">View all</a>
          </div>
          <div class="subsystem-chips">
            {#each subsystems as s}
              <a href="/experiments" class="subsystem-chip">
                <span class="chip-name">{s.name}</span>
                <span class="chip-members">{s.members} members</span>
              </a>
            {/each}
          </div>
        </div>

        <div class="bento-cell tall-cell">
          <div class="bento-head">
            <h3><Wrench size={16} /> Quick Actions</h3>
          </div>
          <a href="/experiments" class="quick-action-b">
            <span class="qa-icon-b"><Layers size={18} /></span>
            <div><strong>CAD Design</strong><small>Work with CAD files</small></div>
          </a>
          <a href="/experiments" class="quick-action-b">
            <span class="qa-icon-b"><Briefcase size={18} /></span>
            <div><strong>Builds</strong><small>View your builds</small></div>
          </a>
          <a href="/experiments" class="quick-action-b">
            <span class="qa-icon-b"><Shield size={18} /></span>
            <div><strong>Admin Panel</strong><small>Manage users &amp; roles</small></div>
          </a>
        </div>

        <div class="bento-cell wide-cell">
          <div class="bento-head">
            <h3><Receipt size={16} /> Purchase Requests</h3>
            <a href="/experiments" class="bento-link">View all</a>
          </div>
          <div class="purchase-table-b">
            {#each purchases as p}
              <div class="purchase-row-b">
                <span class="pr-name">{p.name}</span>
                <span class="pr-qty">×{p.qty}</span>
                <span class="pr-price">${p.price.toFixed(2)}</span>
                <span class="pr-status status-b-{p.status}">{p.status}</span>
              </div>
            {/each}
          </div>
        </div>
      </div>
    </div>
  {/if}
</div>

<style>
  .concept-shell-b { animation: popIn 0.4s ease both; }
  @keyframes popIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .concept-toggle-b {
    display: inline-flex;
    gap: 4px;
    padding: 4px;
    background: var(--surface-2);
    border-radius: 10px;
    margin-bottom: var(--space-7);
  }
  .concept-toggle-b button {
    border: none;
    background: transparent;
    padding: 0.5rem 1.1rem;
    border-radius: 7px;
    font-size: 0.8rem;
    font-weight: 600;
    color: var(--text-muted);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .concept-toggle-b button.active { background: var(--card); color: var(--text); }

  /* ===== Sign-in ===== */
  .hero-b {
    border: 1px solid var(--border);
    border-radius: 16px;
    padding: clamp(2.5rem, 6vw, 5rem) clamp(1.5rem, 4vw, 3rem);
    background: var(--surface-2);
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
  }
  .hero-b-content { max-width: 460px; display: flex; flex-direction: column; align-items: center; }
  .hero-b-badge {
    font-family: var(--font-mono-stack);
    font-size: 0.7rem;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--text-muted);
    margin-bottom: var(--space-5);
  }
  .hero-b-title {
    font-family: var(--font-display);
    font-weight: 700;
    font-size: clamp(2rem, 5vw, 2.9rem);
    line-height: 1.1;
    margin: 0 0 var(--space-4);
    color: var(--text);
  }
  .hero-b-sub {
    font-size: 1rem;
    color: var(--text-secondary);
    margin: 0 0 var(--space-8);
  }

  .hero-b-card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: var(--space-7);
    width: 100%;
    max-width: 380px;
  }
  .hero-b-tabs {
    display: flex;
    background: var(--surface-2);
    border-radius: 9px;
    padding: 3px;
    margin-bottom: var(--space-6);
  }
  .hero-b-tabs button {
    flex: 1;
    border: none;
    background: transparent;
    padding: 0.55rem;
    border-radius: 7px;
    font-weight: 600;
    font-size: 0.85rem;
    color: var(--text-muted);
    cursor: pointer;
  }
  .hero-b-tabs button.active { background: var(--card); color: var(--text); }
  .field-b {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    border: 1.5px solid var(--border);
    border-radius: 9px;
    padding: 0.75rem 0.9rem;
    margin-bottom: var(--space-4);
    color: var(--text-muted);
    transition: border-color 0.15s ease;
  }
  .field-b:focus-within { border-color: var(--accent-strong); color: var(--text); }
  .field-b input {
    border: none;
    background: transparent;
    outline: none;
    flex: 1;
    font-size: 0.92rem;
    color: var(--text);
    font-family: inherit;
  }
  .btn-b-primary {
    width: 100%;
    background: var(--secondary);
    color: var(--primary);
    border: none;
    border-radius: 9px;
    padding: 0.85rem;
    font-weight: 700;
    font-size: 0.95rem;
    cursor: pointer;
    margin-top: var(--space-3);
    transition: background 0.15s ease;
  }
  .btn-b-primary:hover { background: var(--accent-strong); color: var(--secondary); }
  .hero-b-footnote { text-align: center; font-size: 0.82rem; color: var(--text-muted); margin-top: var(--space-5); }
  .hero-b-footnote a { color: var(--accent-strong); font-weight: 700; }

  /* ===== Dashboard ===== */
  .dash-b-header { margin-bottom: var(--space-8); }
  .dash-b-header h1 { font-family: var(--font-display); font-weight: 700; font-size: 1.85rem; margin: 0 0 0.3rem; }
  .dash-b-header p { color: var(--text-muted); margin: 0; }
  .wave { display: inline-block; animation: wave 2.2s ease-in-out infinite; transform-origin: 70% 70%; }
  @keyframes wave { 0%, 60%, 100% { transform: rotate(0); } 10%, 30% { transform: rotate(14deg); } 20% { transform: rotate(-8deg); } }

  .bento-grid {
    display: grid;
    grid-template-columns: repeat(4, 1fr);
    grid-auto-rows: minmax(100px, auto);
    gap: var(--space-4);
  }
  @media (max-width: 900px) { .bento-grid { grid-template-columns: repeat(2, 1fr); } }

  .bento-cell {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 14px;
    padding: var(--space-5);
    transition: transform 0.15s ease, border-color 0.15s ease;
    animation: cellIn 0.4s ease both;
    animation-delay: calc(var(--i, 0) * 50ms);
  }
  @keyframes cellIn { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }

  .stat-cell {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    text-decoration: none;
    color: var(--text);
  }
  .stat-cell:hover { transform: translateY(-2px); border-color: var(--accent-strong); }
  .stat-cell.alert { border-color: var(--status-pending-border); background: var(--status-pending-bg); }
  .bento-icon {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text-secondary);
  }
  .stat-cell.alert .bento-icon { background: var(--card); color: var(--status-pending-text); }
  .bento-value { font-family: var(--font-display); font-weight: 700; font-size: 2rem; line-height: 1; }
  .bento-label { font-size: 0.8rem; color: var(--text-muted); }

  .wide-cell { grid-column: span 2; }
  .tall-cell { grid-row: span 2; display: flex; flex-direction: column; gap: var(--space-3); }
  @media (max-width: 900px) { .wide-cell, .tall-cell { grid-column: span 2; grid-row: auto; } }

  .bento-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: var(--space-4); }
  .bento-head h3 { display: flex; align-items: center; gap: 0.4rem; font-family: var(--font-display); font-size: 0.95rem; margin: 0; }
  .bento-link { font-size: 0.78rem; font-weight: 600; color: var(--accent-strong); text-decoration: none; }

  .subsystem-chips { display: flex; flex-direction: column; gap: 0.5rem; }
  .subsystem-chip {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.7rem 0.9rem;
    border-radius: 10px;
    background: var(--surface-2);
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s ease;
  }
  .subsystem-chip:hover { background: var(--surface-3); }
  .chip-name { font-weight: 600; }
  .chip-members { font-size: 0.75rem; color: var(--text-muted); }

  .quick-action-b {
    display: flex;
    align-items: center;
    gap: 0.75rem;
    padding: 0.75rem;
    border-radius: 12px;
    text-decoration: none;
    color: var(--text);
    transition: background 0.15s ease;
  }
  .quick-action-b:hover { background: var(--surface-2); }
  .qa-icon-b {
    width: 36px; height: 36px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 10px;
    background: var(--surface-2);
    color: var(--text-secondary);
    flex-shrink: 0;
  }
  .quick-action-b strong { display: block; font-size: 0.88rem; }
  .quick-action-b small { color: var(--text-muted); font-size: 0.76rem; }

  .purchase-table-b { display: flex; flex-direction: column; gap: 0.35rem; }
  .purchase-row-b {
    display: grid;
    grid-template-columns: 1fr auto auto auto;
    align-items: center;
    gap: var(--space-4);
    padding: 0.65rem 0.9rem;
    border-radius: 10px;
    background: var(--surface-2);
    font-size: 0.86rem;
  }
  .pr-name { font-weight: 600; }
  .pr-qty, .pr-price { color: var(--text-muted); font-size: 0.8rem; }
  .pr-status {
    font-size: 0.68rem;
    font-weight: 700;
    text-transform: uppercase;
    padding: 0.25rem 0.6rem;
    border-radius: 999px;
  }
  .status-b-pending { background: var(--status-pending-bg); color: var(--status-pending-text); }
  .status-b-ordered { background: var(--status-progress-bg); color: var(--status-progress-text); }
  .status-b-approved { background: var(--status-ready-bg); color: var(--status-ready-text); }
</style>
