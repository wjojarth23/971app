<script>
  import { onMount } from 'svelte';
  import { userStore } from '$lib/stores/user.js';
  import { hasPermission } from '$lib/permissions.js';
  import { sharesForSpend, payoutForWinningShares } from '$lib/lmsr.js';
  import { Coins } from 'lucide-svelte';

  // Auth/user
  let user = null;
  const unsub = userStore.subscribe((v) => { user = v; });

  // Feature flags / settings
  let demo = false;
  let configuredCompetitions = [];
  let predictTabVisible = false;
  let loadedInfo = false;

  // UI tabs
  let activeTab = 'markets'; // 'markets' | 'portfolio'

  // Matches
  let upcoming = [];
  let loadingUpcoming = false;
  let apiNote = '';

  // Selected market
  let selectedMatch = null;
  let market = null;
  let loadingMarket = false;

  // Market ticks (for price-over-time)
  let ticks = [];
  let loadingTicks = false;

  // Balance
  let balance = null;
  let loadingBalance = false;

  // Betting
  let outcome = 'red'; // 'red' | 'blue'
  let amount = 10;     // dollars
  let placing = false;
  let placeError = '';

  // Portfolio
  let loadingPortfolio = false;
  let portfolio = []; // [{ bet, market }]

  // Admin settings removed for Predict

  function formatProb(p) {
    if (p == null) return '-';
    return (p * 100).toFixed(1) + '%';
  }

  function teamList(keys = []) {
    // keys look like ["frc971","frc254"] -> show numbers only
    return (keys || []).map((k) => String(k).replace(/^frc/i, '')).join(', ');
  }

  async function loadInfo() {
    try {
      const resp = await fetch('/api/predict?action=info');
      const data = await resp.json();
      if (resp.ok) {
        demo = !!data?.data?.demo;
        configuredCompetitions = Array.isArray(data?.data?.competitions) ? data.data.competitions : [];
        predictTabVisible = !!data?.data?.tab_visible;
      }
    } catch {} finally { loadedInfo = true; }
  }

  async function loadUpcoming() {
    upcoming = [];
    apiNote = '';
    loadingUpcoming = true;
    try {
      const resp = await fetch(`/api/predict?action=upcoming`);
      const data = await resp.json();
      if (!resp.ok) {
        apiNote = data?.error || 'Failed to fetch matches';
        return;
      }
      apiNote = data?.note || '';
      upcoming = Array.isArray(data?.data) ? data.data : [];
    } catch (e) {
      apiNote = 'Failed to fetch matches';
      console.error(e);
    } finally {
      loadingUpcoming = false;
    }
  }

  async function ensureBalance() {
    if (!user?.id) {
      balance = null;
      return;
    }
    loadingBalance = true;
    try {
      const resp = await fetch(`/api/predict?action=balance&user_id=${encodeURIComponent(user.id)}`);
      const data = await resp.json();
      if (resp.ok) {
        balance = data?.data?.balance ?? null;
      } else {
        console.warn('Balance error:', data?.error);
      }
    } catch (e) {
      console.warn('Balance fetch exception:', e);
    } finally {
      loadingBalance = false;
    }
  }

  async function loadTicks() {
    ticks = [];
    if (!market?.id) return;
    loadingTicks = true;
    try {
      const url = new URL('/api/predict', window.location.origin);
      url.searchParams.set('action', 'market-ticks');
      url.searchParams.set('market_id', market.id);
      const resp = await fetch(url);
      const data = await resp.json();
      if (resp.ok) {
        ticks = Array.isArray(data?.data) ? data.data : [];
      }
    } catch (e) {
      console.warn('ticks fetch exception:', e);
    } finally {
      loadingTicks = false;
    }
  }

  async function openMarketForMatch(match) {
    selectedMatch = match;
    market = null;
    loadingMarket = true;
    placeError = '';
    try {
      const url = new URL('/api/predict', window.location.origin);
      url.searchParams.set('action', 'market');
      url.searchParams.set('match_key', match.match_key);
      const resp = await fetch(url);
      const data = await resp.json();
      if (!resp.ok) {
        console.error('market error:', data?.error);
        return;
      }
      market = data?.data || null;
      await loadTicks();
    } catch (e) {
      console.error('openMarket error:', e);
    } finally {
      loadingMarket = false;
    }
  }

  function computeQuoteShares() {
    if (!market || !(amount > 0)) return 0;
    const q = { red: Number(market.q_red || 0), blue: Number(market.q_blue || 0) };
    const b = Number(market.b || 50);
    return sharesForSpend(q, b, outcome, Number(amount));
  }

  async function placeBet() {
    placeError = '';
    if (!user?.id) { placeError = 'Sign in required.'; return; }
    if (!market?.id) { placeError = 'No market selected.'; return; }
    const amt = Number(amount);
    if (!(amt > 0)) { placeError = 'Amount must be > 0'; return; }

    placing = true;
    try {
      const resp = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type':'application/json' },
        body: JSON.stringify({
          action: 'place-bet',
          user_id: user.id,
          market_id: market.id,
          outcome,
          amount: amt
        })
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        placeError = data?.error || 'Bet failed';
        return;
      }
      // Update market/balance/ticks and portfolio
      market = data?.data?.market || market;
      balance = data?.data?.new_balance ?? balance;
      await loadTicks();
      await loadPortfolio();
    } catch (e) {
      placeError = 'Bet failed: ' + (e?.message || e);
    } finally {
      placing = false;
    }
  }

  async function loadPortfolio() {
    if (!user?.id) { portfolio = []; return; }
    loadingPortfolio = true;
    try {
      const resp = await fetch(`/api/predict?action=user-bets&user_id=${encodeURIComponent(user.id)}`);
      const data = await resp.json();
      if (resp.ok) {
        portfolio = Array.isArray(data?.data) ? data.data : [];
      } else {
        portfolio = [];
      }
    } catch (e) {
      portfolio = [];
    } finally {
      loadingPortfolio = false;
    }
  }

   // Selling has been disabled application-wide. Keep function present but make it a no-op
  async function sellBet(betId) {
    console.warn('Selling is disabled; sellBet was called for bet id:', betId);
    return;
  }

  // Admin settings removed — no client-side save endpoint

  onMount(() => {
    void loadInfo();
    void ensureBalance();
    // Try to settle any finished matches on server before loading markets
    void settleFinishedThenLoad();
    void loadPortfolio();
    return () => { unsub?.(); };
  });

  async function settleFinishedThenLoad() {
    try {
      // best-effort: backfill winners for already-settled markets, then try settling open ones
      await fetch('/api/predict?action=backfill-winners');
      await fetch('/api/predict?action=settle-finished');
      // ignore response details; proceed to refresh upcoming list and selected market/portfolio
      await loadUpcoming();
      if (market?.id) await openMarketForMatch(selectedMatch || { match_key: market.match_key });
      await ensureBalance();
      await loadPortfolio();
    } catch (e) {
      // ignore errors; still load upcoming so UI remains functional
      await loadUpcoming();
    }
  }

  // -------- Price chart helpers (simple inline SVG) ----------
  const CHART_W = 360;
  const CHART_H = 120;
  const PAD = 8;

  function mm(arr, key) {
    if (!arr?.length) return { min: 0, max: 1 };
    let mn = Infinity, mx = -Infinity;
    for (const r of arr) {
      const v = Number(r[key] ?? 0);
      if (isFinite(v)) {
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (!isFinite(mn) || !isFinite(mx) || mn === mx) {
      mn = 0; mx = 1;
    }
    return { min: mn, max: mx };
  }

  function buildPath(arr, key) {
    if (!arr?.length) return '';
    const { min, max } = mm(arr, key);
    const n = arr.length;
    const w = CHART_W - PAD * 2;
    const h = CHART_H - PAD * 2;
    const xs = (i) => PAD + (n <= 1 ? 0 : (w * i) / (n - 1));
    const ys = (v) => PAD + h - (h * (v - min)) / Math.max(1e-9, max - min);
    let d = '';
    for (let i = 0; i < n; i++) {
      const v = Number(arr[i][key] ?? 0);
      const x = xs(i);
      const y = ys(v);
      d += (i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`);
    }
    return d;
  }
</script>

{#if !loadedInfo}
  <div class="predict-page"><div class="empty">Loading Predict...</div></div>
{:else if predictTabVisible}
<div class="predict-page">
  <div class="header">
    <div class="title">
      <Coins size={22} />
      <h1>Predict</h1>
      {#if configuredCompetitions.length}
        <span class="competitions">Events: {configuredCompetitions.join(', ')}</span>
      {/if}
    </div>
    <div class="right-side">
      <div class="balance">
        {#if loadingBalance}
          <span>Loading balance...</span>
        {:else if balance != null}
          <span>Balance: ${balance.toFixed(2)}</span>
        {:else}
          <span>Sign in to see balance</span>
        {/if}
        {#if demo}
          <span class="demo-badge">Demo Mode</span>
        {/if}
      </div>
      <!-- Admin Settings removed -->
    </div>
  </div>

  <div class="tabs">
    <button class="tab" class:active={activeTab === 'markets'} on:click={() => activeTab = 'markets'}>Markets</button>
    <button class="tab" class:active={activeTab === 'portfolio'} on:click={() => activeTab = 'portfolio'}>Portfolio</button>
  </div>

  {#if activeTab === 'markets'}
    <div class="controls">
      <button class="btn btn-yellow" on:click={() => loadUpcoming()} disabled={loadingUpcoming}>
        {#if loadingUpcoming} Loading... {:else} Refresh Matches {/if}
      </button>
    </div>
    {#if apiNote}
      <div class="note">{apiNote}</div>
    {/if}

    <div class="content">
      <div class="matches">
        <h2>Upcoming Matches</h2>
        {#if upcoming.length === 0}
          <div class="empty">No upcoming matches loaded</div>
        {:else}
          <div class="match-list">
            {#each upcoming as m}
              <button type="button" class="match-item" class:selected={selectedMatch?.match_key === m.match_key} on:click={() => openMarketForMatch(m)}>
                <div class="line">
                  <div class="code">{m.match_key}</div>
                  <div class="time">
                    {#if m.predicted_time}
                      {new Date(m.predicted_time * 1000).toLocaleString()}
                    {:else if m.time}
                      {new Date(m.time * 1000).toLocaleString()}
                    {:else}
                      -
                    {/if}
                  </div>
                </div>
                <div class="alliances">
                  <div class="red">
                    <span class="label">Red:</span>
                    <span class="teams">{teamList(m.red_team_keys)}</span>
                    <span class="odds">{formatProb(m.initial_odds?.red)}</span>
                  </div>
                  <div class="blue">
                    <span class="label">Blue:</span>
                    <span class="teams">{teamList(m.blue_team_keys)}</span>
                    <span class="odds">{formatProb(m.initial_odds?.blue)}</span>
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="market">
        <h2>Market</h2>
        {#if loadingMarket}
          <div class="empty">Loading market...</div>
        {:else if !market}
          <div class="empty">Select a match to open/create a market</div>
        {:else}
          <div class="market-card">
            <div class="m-header">
              <div class="mk">{market.match_key}</div>
              <div class="status">Status: {market.status}</div>
            </div>

            <div class="alliances">
              <div class="row red">
                <span class="name">Red</span>
                <span class="price">{formatProb(market.prices?.red)}</span>
              </div>
              <div class="row blue">
                <span class="name">Blue</span>
                <span class="price">{formatProb(market.prices?.blue)}</span>
              </div>
            </div>

            <div class="chart">
              <svg width={CHART_W} height={CHART_H}>
                <rect x="0" y="0" width={CHART_W} height={CHART_H} fill="#fff" stroke="var(--border)" />
                {#if loadingTicks || !ticks.length}
                  <text x={CHART_W/2} y={CHART_H/2} text-anchor="middle" fill="var(--secondary)" font-size="12">
                    {loadingTicks ? 'Loading...' : 'No price history'}
                  </text>
                {:else}
                  <path d={buildPath(ticks, 'price_red')} fill="none" stroke="#a00" stroke-width="2" />
                  <path d={buildPath(ticks, 'price_blue')} fill="none" stroke="#005" stroke-width="2" />
                {/if}
              </svg>
              <div class="legend">
                <span class="lg red"></span><span>Red</span>
                <span class="lg blue"></span><span>Blue</span>
              </div>
            </div>

            <div class="bet-panel">
              <div class="side-select">
                <label>
                  <input type="radio" name="side" value="red" bind:group={outcome} />
                  Red
                </label>
                <label>
                  <input type="radio" name="side" value="blue" bind:group={outcome} />
                  Blue
                </label>
              </div>
              <div class="stake">
                <label for="amt">Stake ($)</label>
                <input id="amt" class="form-input" type="number" min="0" step="0.01" bind:value={amount} />
              </div>
              <div class="quote">
                <div class="q-line">
                  <span>Estimated Shares</span>
                  <strong>{computeQuoteShares().toFixed(4)}</strong>
                </div>
                <div class="q-tip">Winning share pays $0.99</div>
              </div>
              {#if placeError}
                <div class="error">{placeError}</div>
              {/if}
              <div class="actions">
                <button class="btn btn-yellow" on:click={placeBet} disabled={placing || !user || !market || !(amount > 0)}>
                  {#if placing} Placing... {:else} Place Bet {/if}
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else if activeTab === 'portfolio'}
    <div class="portfolio">
      <h2>My Portfolio</h2>
      {#if !user}
        <div class="empty">Sign in to see your portfolio</div>
      {:else if loadingPortfolio}
        <div class="empty">Loading portfolio...</div>
      {:else if !portfolio.length}
        <div class="empty">No bets yet</div>
      {:else}
        <div class="table-container">
          <table class="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Match</th>
                <th>Side</th>
                <th>Amount ($)</th>
                <th>Shares</th>
                <th>Market Status</th>
                <th>Winner</th>
                <th>Result</th>
                <th>Payout ($)</th>
              </tr>
            </thead>
            <tbody>
              {#each portfolio as row}
                <tr>
                  <td>{new Date(row.bet.created_at).toLocaleString()}</td>
                  <td>{row.market?.match_key || row.bet.market_id}</td>
                  <td style="color: {row.bet.outcome === 'red' ? '#a00' : '#005'}">{row.bet.outcome}</td>
                  <td>${Number(row.bet.amount || 0).toFixed(2)}</td>
                  <td>{Number(row.bet.shares || 0).toFixed(4)}</td>
                      <td>{row.market?.status || '-'}</td>
                      <td>{row.market?.winning_outcome || '-'}</td>
                      <td>
                        {#if row.market?.status === 'settled'}
                          {#if row.market?.winning_outcome === row.bet.outcome}
                            Won
                          {:else}
                            Lost
                          {/if}
                        {:else if row.market?.status === 'open'}
                          <!-- Selling disabled: show disabled Sell button -->
                          <button class="btn btn-small" disabled title="Selling has been disabled">Sell (disabled)</button>
                        {:else}
                          -
                        {/if}
                      </td>
                      <td>
                        {#if row.market?.status === 'settled' && row.market?.winning_outcome === row.bet.outcome}
                          ${payoutForWinningShares(Number(row.bet.shares || 0), 0.01).toFixed(2)}
                        {:else}
                          -
                        {/if}
                      </td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </div>
  {/if}
</div>

<!-- Admin modal removed -->

{/if}

<style>
  .predict-page { max-width: 1200px; margin: 0 auto; padding: 1rem 1.25rem 2rem; }
  .header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 0.75rem; gap: 0.5rem; }
  .title { display: flex; align-items: center; gap: 0.5rem; flex-wrap: wrap; }
  .title h1 { margin: 0; font-size: 1.5rem; }
  .competitions { color: var(--secondary); font-size: 0.85rem; }
  .right-side { display: flex; align-items: center; gap: 0.5rem; }
  .balance { color: var(--secondary); }
  .demo-badge {
    margin-left: 0.5rem;
    padding: 0.15rem 0.4rem;
    border: 1px solid var(--border);
    border-radius: 999px;
    background: #fff6cc;
    color: #6b5000;
    font-size: 0.75rem;
  }

  .tabs { display: flex; gap: 0.5rem; margin: 0.25rem 0 0.75rem; }
  .tab {
    padding: 0.4rem 0.75rem;
    border: 1px solid var(--border);
    border-radius: 6px;
    background: var(--primary);
    cursor: pointer;
  }
  .tab.active { background: var(--accent); }

  .controls { display: flex; align-items: end; gap: 0.5rem; margin-bottom: 0.5rem; }
  .form-input { padding: 0.45rem 0.6rem; border: 1px solid var(--border); border-radius: 6px; background: var(--background); color: var(--text); height: 36px; }
  .btn { height: 36px; padding: 0 0.9rem; border: 1px solid var(--border); border-radius: 6px; background: var(--background); cursor: pointer; }
  .btn-yellow { background: #FFD700; color: #333; border-color: #e5c100; }
  .btn-yellow:disabled { opacity: 0.6; cursor: not-allowed; }
  /* .btn-sm and .btn-secondary were removed (unused) */
  .note { font-size: 0.85rem; color: var(--secondary); margin-bottom: 0.5rem; }

  .content { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 900px) { .content { grid-template-columns: 1fr; } }

  .matches, .market, .portfolio { border: 1px solid var(--border); border-radius: 8px; background: #fff; padding: 0.75rem; }
  .matches h2, .market h2, .portfolio h2 { margin: 0 0 0.5rem; font-size: 1.1rem; }
  .empty { padding: 0.75rem; color: var(--secondary); font-style: italic; }

  .match-list { display: flex; flex-direction: column; gap: 0.5rem; max-height: 60vh; overflow: auto; }
  .match-item { border: 1px solid var(--border); border-radius: 8px; padding: 0.5rem; cursor: pointer; background: #fafafa; }
  .match-item.selected { border-color: #FFD700; background: #fff9d6; }
  .match-item .line { display: flex; justify-content: space-between; font-size: 0.9rem; margin-bottom: 0.25rem; }
  .match-item .code { font-weight: 600; }
  .match-item .alliances { display: grid; gap: 0.25rem; }
  .match-item .alliances .red, .match-item .alliances .blue { display: grid; grid-template-columns: auto 1fr auto; gap: 0.4rem; align-items: center; }
  .match-item .red .label { color: #a00; }
  .match-item .blue .label { color: #005; }
  .match-item .teams { color: var(--text); }
  .match-item .odds { color: var(--secondary); }

  .market-card { display: grid; gap: 0.75rem; }
  .m-header { display: flex; justify-content: space-between; }
  .m-header .mk { font-weight: 600; }
  .m-header .status { color: var(--secondary); }

  .market-card .alliances { display: grid; gap: 0.25rem; }
  .market-card .row { display: flex; justify-content: space-between; padding: 0.25rem 0.4rem; border: 1px solid var(--border); border-radius: 6px; }
  .market-card .row.red { background: #fff0f0; }
  .market-card .row.blue { background: #f0f4ff; }
  .market-card .name { font-weight: 600; }
  .market-card .price { font-variant-numeric: tabular-nums; }

  .chart { display: grid; gap: 0.25rem; }
  .legend { display: flex; align-items: center; gap: 0.5rem; font-size: 0.85rem; color: var(--secondary); }
  .legend .lg { width: 14px; height: 3px; display: inline-block; border-radius: 2px; margin-right: 4px; }
  .legend .lg.red { background: #a00; }
  .legend .lg.blue { background: #005; }

  .bet-panel { border-top: 1px solid var(--border); padding-top: 0.5rem; display: grid; gap: 0.5rem; }
  .side-select { display: flex; gap: 1rem; }
  .stake { display: grid; gap: 0.25rem; }
  .quote { display: grid; gap: 0.2rem; }
  .q-line { display: flex; justify-content: space-between; }
  .q-tip { font-size: 0.85rem; color: var(--secondary); }
  .error { color: #a00; }
  .actions { display: flex; justify-content: flex-end; }

  /* Portfolio table */
  .table-container { overflow: auto; }
  .table { width: 100%; border-collapse: collapse; }
  .table th, .table td { padding: 0.5rem; border-bottom: 1px solid var(--border); text-align: left; }

  /* Modal */
  /* modal styles removed (admin modal no longer used) */
</style>
