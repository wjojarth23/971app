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
  let sellingStatus = {}; // { [betId]: boolean }

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

      // Try to fetch current market for each upcoming match in background so
      // the match-list boxes can show the live market prices instead of
      // initial_odds. This is best-effort and will silently ignore failures.
      if (upcoming.length) {
        // Fire parallel requests but don't block the UI; update when done.
        void (async () => {
          const keys = upcoming.map((m) => m.match_key).filter(Boolean);
          const promises = keys.map(async (match_key) => {
            try {
              const url = new URL('/api/predict', window.location.origin);
              url.searchParams.set('action', 'market');
              url.searchParams.set('match_key', match_key);
              const r = await fetch(url);
              const d = await r.json();
              if (r.ok && d?.data) {
                const idx = upcoming.findIndex((x) => x.match_key === match_key);
                if (idx >= 0) {
                  // attach market payload (including market.prices)
                  upcoming[idx] = { ...upcoming[idx], market: d.data };
                  // force Svelte reactivity by replacing the array
                  upcoming = [...upcoming];
                }
              }
            } catch (e) {
              // ignore individual market fetch errors
            }
          });
          await Promise.allSettled(promises);
        })();
      }
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

  // Determine whether a market is tradable (can buy/sell): must be open and match start_time in future
  function isMarketTradable(m) {
    if (!m) return false;
    if (m.status !== 'open') return false;
    // prefer explicit start_time on market, else undefined
    const start = m.start_time ?? null;
    if (!start) return true; // unknown start time -> allow (server will enforce in edge cases)
    const startNum = Number(start);
    if (Number.isNaN(startNum)) return true;
    const nowSec = Math.floor(Date.now() / 1000);
    return startNum > nowSec;
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

  async function sellBet(betId) {
    if (!user?.id || !betId) return;
    sellingStatus = { ...sellingStatus, [betId]: true };
    let sold = false;
    try {
      const resp = await fetch('/api/predict', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sell-bet', user_id: user.id, bet_id: betId })
      });
      const data = await resp.json();
      if (!resp.ok || !data?.success) {
        console.warn('Sell failed', data?.error);
        return;
      }
      sold = true;
      balance = data?.data?.new_balance ?? balance;
      await loadPortfolio();
      if (market?.id === data?.data?.market?.id) {
        market = data.data.market;
        await loadTicks();
      }
    } catch (e) {
      console.error('sellBet exception', e);
    } finally {
      if (sold) {
        await ensureBalance();
      }
      const currentStatus = sellingStatus;
      const { [betId]: _ignored, ...rest } = currentStatus;
      sellingStatus = rest;
    }
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
  <!-- Page header consistent with other tabs -->
  <div class="page-header card">
    <div class="header-left">
      <div style="display:flex; align-items:center; gap:0.5rem">
        <Coins size={22} />
        <h2 style="margin:0">Predict</h2>
      </div>
      {#if configuredCompetitions.length}
        <div class="form-label" style="margin-top:0.25rem">Events: {configuredCompetitions.join(', ')}</div>
      {/if}
    </div>
    <div class="page-actions">
      <div class="balance-chip">
        {#if loadingBalance}
          <span>Loading balance…</span>
        {:else if balance != null}
          <span>Balance: ${balance.toFixed(2)}</span>
        {:else}
          <span>Sign in to see balance</span>
        {/if}
        {#if demo}
          <span class="demo-badge">Demo</span>
        {/if}
      </div>
    </div>
  </div>

  <!-- Sub tabs -->
  <div class="subtabs">
    <button class="btn {activeTab === 'markets' ? 'btn-primary' : 'btn-secondary'} btn-sm" on:click={() => activeTab = 'markets'}>Markets</button>
    <button class="btn {activeTab === 'portfolio' ? 'btn-primary' : 'btn-secondary'} btn-sm" on:click={() => activeTab = 'portfolio'}>Portfolio</button>
  </div>

  {#if activeTab === 'markets'}
    {#if apiNote}
      <div class="note">{apiNote}</div>
    {/if}

    <div class="content">
      <div class="card matches">
        <div class="card-header">
          <h3>Upcoming Matches</h3>
          <div class="page-actions">
            <button class="btn btn-secondary btn-sm" on:click={() => loadUpcoming()} disabled={loadingUpcoming}>
              {#if loadingUpcoming} Loading… {:else} Refresh {/if}
            </button>
          </div>
        </div>
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
                    <span class="odds">
                      {#if m.market?.prices?.red != null}
                        {formatProb(m.market.prices.red)}
                      {:else}
                        {formatProb(m.initial_odds?.red)}
                      {/if}
                    </span>
                  </div>
                  <div class="blue">
                    <span class="label">Blue:</span>
                    <span class="teams">{teamList(m.blue_team_keys)}</span>
                    <span class="odds">
                      {#if m.market?.prices?.blue != null}
                        {formatProb(m.market.prices.blue)}
                      {:else}
                        {formatProb(m.initial_odds?.blue)}
                      {/if}
                    </span>
                  </div>
                </div>
              </button>
            {/each}
          </div>
        {/if}
      </div>

      <div class="card market">
        <div class="card-header">
          <h3>Market</h3>
        </div>
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
                <label class="form-label" for="amt">Stake ($)</label>
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
                <button class="btn btn-primary" on:click={placeBet} disabled={placing || !user || !market || !(amount > 0) || !isMarketTradable(market)}>
                  {#if placing} Placing… {:else} Place Bet {/if}
                </button>
              </div>
            </div>
          </div>
        {/if}
      </div>
    </div>
  {:else if activeTab === 'portfolio'}
    <div class="card portfolio">
      <div class="card-header">
        <h3>My Portfolio</h3>
      </div>
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
                          {#if isMarketTradable(row.market)}
                            <button
                              class="btn btn-sm btn-secondary"
                              type="button"
                              on:click={() => sellBet(row.bet.id)}
                              disabled={!!sellingStatus[row.bet.id]}
                              title="Sell this position back to the market"
                            >
                              {sellingStatus[row.bet.id] ? 'Selling…' : 'Sell'}
                            </button>
                          {:else}
                            <button class="btn btn-sm btn-secondary" type="button" disabled title="Match started - selling disabled">Sell</button>
                          {/if}
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
  .predict-page { max-width: 1200px; margin: 0 auto; padding: 0 0 2rem; }
  .balance-chip { display: inline-flex; align-items: center; gap: 0.5rem; color: var(--secondary); }
  .demo-badge { padding: 0.15rem 0.5rem; border: 1px solid var(--border); border-radius: 999px; background: #fff6cc; color: #6b5000; font-size: 0.75rem; }

  .subtabs { display: flex; gap: 0.5rem; margin: 0 0 1rem; }

  .note { font-size: 0.9rem; color: var(--secondary); margin-bottom: 0.5rem; }

  .content { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
  @media (max-width: 900px) { .content { grid-template-columns: 1fr; } }

  .card-header { display: flex; align-items: center; justify-content: space-between; gap: 0.5rem; margin: -0.25rem 0 0.5rem; }
  .card-header h3 { margin: 0; font-size: 1.05rem; }
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

  /* Portfolio table tweaks (use global table styles) */
  .table-container { overflow: auto; }

  /* Modal */
  /* modal styles removed (admin modal no longer used) */
</style>
