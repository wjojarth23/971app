import { json } from '@sveltejs/kit';
import { supabase } from '$lib/supabase.js';
import { payoutForWinningShares, prices as lmsrPrices } from '$lib/lmsr.js';
import { TBA_API_KEY, CEMO } from '$env/static/private';

// Helpers
const TBA_BASE = 'https://www.thebluealliance.com/api/v3';
const STATBOTICS_BASE = 'https://api.statbotics.io/v3';

function tbaHeaders() {
  if (!TBA_API_KEY) return {};
  return { 'X-TBA-Auth-Key': TBA_API_KEY };
}

function clamp01(x) {
  return Math.min(0.99, Math.max(0.01, x));
}

// Fetch a single match from Statbotics (no auth required). Returns parsed JSON or null.
async function fetchStatboticsMatch(match_key) {
  try {
    const resp = await fetch(`${STATBOTICS_BASE}/match/${match_key}`, { headers: { accept: 'application/json' } });
    if (!resp.ok) return null;
    return await resp.json();
  } catch {
    return null;
  }
}

// For 2-outcome LMSR, to initialize with target p_red, set q_blue=0 and q_red=b*ln(p/(1-p))
function initialQFromProb(p_red, b) {
  const p = clamp01(p_red);
  const q_red = b * Math.log(p / (1 - p));
  return { red: q_red, blue: 0 };
}

async function fetchEventMatchesSimple(event_key) {
  if (!TBA_API_KEY) return null;
  const resp = await fetch(`${TBA_BASE}/event/${event_key}/matches/simple`, { headers: tbaHeaders() });
  if (!resp.ok) return null;
  return await resp.json();
}

// Best-effort: TBA may expose predictions; if not available, return null
async function fetchEventPredictions(event_key) {
  if (!TBA_API_KEY) return null;
  try {
    const resp = await fetch(`${TBA_BASE}/event/${event_key}/predictions`, { headers: tbaHeaders() });
    if (!resp.ok) return null;
    const data = await resp.json();
    // Shape may vary; try to map to { [match_key]: { redWinProb, blueWinProb } }
    const out = {};
    const matches = data?.match_predictions || data?.matches || data;
    if (matches && typeof matches === 'object') {
      for (const [k, v] of Object.entries(matches)) {
        const red = v?.red || v?.prob_red || v?.red_win_prob || v?.red_win;
        const blue = v?.blue || v?.prob_blue || v?.blue_win_prob || v?.blue_win;
        if (typeof red === 'number' && typeof blue === 'number') {
          out[k] = { redWinProb: clamp01(red), blueWinProb: clamp01(blue) };
        }
      }
      return out;
    }
    return null;
  } catch {
    return null;
  }
}

// Predict settings (single row)
async function getPredictSettings() {
  const { data, error } = await supabase.from('predict_settings').select('*').eq('id', 'global').maybeSingle();
  if (error) {
    // Fall back to env-based demo if table missing/inaccessible
    const envDemo = ((CEMO ?? cemo ?? '') + '').toLowerCase();
    const demo = envDemo === 'true' || envDemo === '1' || envDemo === 'yes' || envDemo === 'y';
    return { id: 'global', demo, competitions: ['2025cc'], tab_visible: true, updated_at: new Date().toISOString() };
  }
  if (!data) {
    const envDemo = ((CEMO ?? cemo ?? '') + '').toLowerCase();
    const demo = envDemo === 'true' || envDemo === '1' || envDemo === 'yes' || envDemo === 'y';
    return { id: 'global', demo, competitions: ['2025cc'], tab_visible: true, updated_at: new Date().toISOString() };
  }
  // Normalize
  return {
    id: data.id || 'global',
    demo: !!data.demo,
    competitions: (Array.isArray(data.competitions) ? data.competitions.map(String) : []).filter(Boolean).length ? data.competitions.map(String) : ['2025cc'],
    tab_visible: data.tab_visible == null ? true : !!data.tab_visible,
    updated_at: data.updated_at || new Date().toISOString()
  };
}

async function savePredictSettings({ demo, competitions, tab_visible }) {
  const payload = {
    id: 'global',
    demo: !!demo,
    competitions: Array.isArray(competitions) ? competitions.map((s) => String(s).trim()).filter(Boolean) : [],
    tab_visible: !!tab_visible,
    updated_at: new Date().toISOString()
  };
  // Upsert by id
  const { data, error } = await supabase.from('predict_settings').upsert([payload]).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

// Admin permission checks removed for predict save endpoint (no longer supported)

async function demoMode() {
  const s = await getPredictSettings();
  return !!s.demo;
}

async function getOrCreateBalance(user_id, initial = 100) {
  const { data, error } = await supabase.from('user_balances').select('user_id, balance').eq('user_id', user_id).maybeSingle();
  if (error) throw new Error(error.message);
  if (data) return data;
  const ins = await supabase.from('user_balances').insert([{ user_id, balance: initial }]).select('user_id, balance').single();
  if (ins.error) throw new Error(ins.error.message);
  return ins.data;
}

async function getMarketByMatchKey(match_key) {
  const { data, error } = await supabase.from('betting_markets').select('*').eq('match_key', match_key).maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

async function createMarket({ match_key, event_key, red_team_keys, blue_team_keys, start_time, b = 50, initProbRed = 0.5 }) {
  const q = initialQFromProb(initProbRed, b);
  const payload = {
    match_key,
    event_key,
    red_team_keys,
    blue_team_keys,
    b,
    q_red: q.red,
    q_blue: q.blue,
    status: 'open',
    start_time
  };
  const { data, error } = await supabase.from('betting_markets').insert([payload]).select('*').single();
  if (error) throw new Error(error.message);
  return data;
}

function marketPrices(m) {
  return lmsrPrices({ red: Number(m.q_red || 0), blue: Number(m.q_blue || 0) }, Number(m.b || 50));
}

function serializeMarket(m) {
  return {
    id: m.id,
    match_key: m.match_key,
    event_key: m.event_key,
    red_team_keys: m.red_team_keys,
    blue_team_keys: m.blue_team_keys,
    b: Number(m.b),
    q_red: Number(m.q_red),
    q_blue: Number(m.q_blue),
    status: m.status,
    winning_outcome: m.winning_outcome || null,
    start_time: m.start_time,
    prices: marketPrices(m)
  };
}

async function insertMarketTick(marketRowLike) {
  try {
    const b = Number(marketRowLike.b || 50);
    const q = { red: Number(marketRowLike.q_red || 0), blue: Number(marketRowLike.q_blue || 0) };
    const prices = lmsrPrices(q, b);
    await supabase.from('betting_market_ticks').insert([{
      market_id: marketRowLike.id,
      q_red: q.red,
      q_blue: q.blue,
      price_red: prices.red,
      price_blue: prices.blue
    }]);
  } catch {
    // best-effort, ignore errors
  }
}

// GET handler
export async function GET({ url }) {
  try {
    const action = url.searchParams.get('action');
    if (!action) {
      return json({ error: 'Missing action' }, { status: 400 });
    }

    if (action === 'upcoming') {
      const source = url.searchParams.get('source'); // optional: 'statbotics'
      const singleEventKey = url.searchParams.get('event_key'); // optional per-event fallback
      const settings = await getPredictSettings();

      // Build list of events to query
      const eventKeys = singleEventKey
        ? [singleEventKey]
        : Array.isArray(settings.competitions)
        ? settings.competitions.filter((s) => !!s)
        : [];

      if (!eventKeys.length) {
        // No events configured; return empty list (and a note if TBA key is missing)
        return json({
          success: true,
          data: [],
          note: TBA_API_KEY ? '' : 'No competitions configured and missing/invalid TBA key.'
        });
      }

      // Fetch matches and predictions per event, then merge
      const allMatches = [];
      for (const ek of eventKeys) {
        const matches = await fetchEventMatchesSimple(ek);
        const preds = await fetchEventPredictions(ek);

        if (!matches) {
          // Skip if no TBA; continue to next event
          continue;
        }

        // Build list; in demo mode include finished matches too
        const now = Date.now() / 1000;
        let list = matches;
        if (!(await demoMode())) {
          list = matches.filter((m) => !m.actual_time || (m.time || 0) > now);
        }
  // Default to Statbotics for all events unless client explicitly requests TBA via source=tba
  const upcoming = [];
        // Build upcoming list. Prefer an existing Supabase market's prices; otherwise prefer Statbotics
        for (const m of list) {
          // Default values
          let redP = 0.5;
          let blueP = 0.5;
          let redTeams = m.alliances?.red?.team_keys || [];
          let blueTeams = m.alliances?.blue?.team_keys || [];
          let timeVal = m.predicted_time || m.time || null;

          // If a supabase market already exists for this match, use its current prices and team keys
          try {
            const marketRow = await getMarketByMatchKey(m.key);
            if (marketRow) {
              const prices = marketPrices(marketRow);
              redP = clamp01(prices.red);
              blueP = clamp01(prices.blue);
              if (Array.isArray(marketRow.red_team_keys) && marketRow.red_team_keys.length) redTeams = marketRow.red_team_keys;
              if (Array.isArray(marketRow.blue_team_keys) && marketRow.blue_team_keys.length) blueTeams = marketRow.blue_team_keys;
              // prefer market start_time if present
              if (marketRow.start_time) timeVal = marketRow.start_time;
            } else {
              // No market exists: use Statbotics (default) or TBA predictions per existing logic
              const useStatbotics = source === 'tba' ? false : true;
              if (useStatbotics) {
                try {
                  const sb = await fetchStatboticsMatch(m.key);
                  if (sb) {
                    if (sb.pred?.red_win_prob != null) {
                      redP = clamp01(Number(sb.pred.red_win_prob));
                      blueP = clamp01(1 - Number(sb.pred.red_win_prob));
                    } else if (typeof sb.pred?.red === 'number') {
                      redP = clamp01(Number(sb.pred.red));
                      blueP = clamp01(1 - Number(sb.pred.red));
                    }
                    if (Array.isArray(sb.alliances?.red?.team_keys)) redTeams = sb.alliances.red.team_keys;
                    if (Array.isArray(sb.alliances?.blue?.team_keys)) blueTeams = sb.alliances.blue.team_keys;
                    if (sb.predicted_time) timeVal = sb.predicted_time;
                  } else {
                    // Fallback to TBA predictions if statbotics didn't return useful data
                    const p = preds?.[m.key];
                    if (p) {
                      redP = p?.redWinProb ?? redP;
                      blueP = p?.blueWinProb ?? blueP;
                    }
                  }
                } catch {
                  // On error, fallback to TBA predictions if available
                  const p = preds?.[m.key];
                  if (p) {
                    redP = p?.redWinProb ?? redP;
                    blueP = p?.blueWinProb ?? blueP;
                  }
                }
              } else {
                const p = preds?.[m.key];
                if (p) {
                  redP = p?.redWinProb ?? redP;
                  blueP = p?.blueWinProb ?? blueP;
                }
              }
            }
          } catch {
            // If anything goes wrong querying supabase or statbotics, best-effort fallback to TBA preds
            const p = preds?.[m.key];
            if (p) {
              redP = p?.redWinProb ?? redP;
              blueP = p?.blueWinProb ?? blueP;
            }
          }

          upcoming.push({
            match_key: m.key,
            comp_level: m.comp_level,
            set_number: m.set_number,
            match_number: m.match_number,
            time: m.time || null,
            predicted_time: timeVal,
            red_team_keys: redTeams,
            blue_team_keys: blueTeams,
            initial_odds: { red: clamp01(redP), blue: clamp01(blueP) }
          });
        }

        allMatches.push(...upcoming);
      }

      // Sort combined list chronologically and limit
      const sorted = allMatches
        .sort((a, b) => (a.predicted_time || a.time || 0) - (b.predicted_time || b.time || 0));

      // Provide note about TBA if nothing could be loaded
      const note =
        !TBA_API_KEY
          ? 'No TBA data available (missing or invalid TBA key). Provide TBA_API_KEY in env to enable live matches.'
          : '';

      return json({ success: true, data: sorted, note });
    }

    if (action === 'market') {
      const match_key = url.searchParams.get('match_key');
      const event_key = url.searchParams.get('event_key'); // optional
  const source = url.searchParams.get('source'); // 'statbotics' to prefer statbotics
      const initRedProbParam = url.searchParams.get('init_red_prob');
      const initRedProb = initRedProbParam ? Number(initRedProbParam) : undefined;
      if (!match_key) {
        return json({ error: 'match_key is required' }, { status: 400 });
      }

      let market = await getMarketByMatchKey(match_key);
      if (!market) {
        // Try to fetch match details from TBA to seed market
        let red_team_keys = [];
        let blue_team_keys = [];
        let start_time = null;
        if (TBA_API_KEY) {
          try {
            const resp = await fetch(`${TBA_BASE}/match/${match_key}/simple`, { headers: tbaHeaders() });
            if (resp.ok) {
              const m = await resp.json();
              red_team_keys = m?.alliances?.red?.team_keys || [];
              blue_team_keys = m?.alliances?.blue?.team_keys || [];
              start_time = m?.predicted_time || m?.time || null;
            }
          } catch {
            // ignore
          }
        }

        // Prefer Statbotics for initial odds and team keys when requested
        let initProb = initRedProb ?? 0.5;
        // Default to Statbotics unless caller explicitly asks for TBA via source=tba
        const useStatbotics = source === 'tba' ? false : true;
        if (useStatbotics) {
          try {
            const sb = await fetchStatboticsMatch(match_key);
            if (sb) {
              // sb.pred (if present) contains red_win_prob / blue_win_prob
              if (sb.pred?.red_win_prob != null) initProb = clamp01(Number(sb.pred.red_win_prob));
              else if (typeof sb.pred?.red === 'number') initProb = clamp01(Number(sb.pred.red));
              // team keys may be numeric in statbotics response
              if (Array.isArray(sb.alliances?.red?.team_keys)) red_team_keys = sb.alliances.red.team_keys;
              if (Array.isArray(sb.alliances?.blue?.team_keys)) blue_team_keys = sb.alliances.blue.team_keys;
              if (sb.predicted_time) start_time = sb.predicted_time;
            }
          } catch {
            // ignore
            // On error, try falling back to TBA predictions if available below
          }
        }
        // Fallback to TBA predictions if statbotics didn't yield and caller asked for TBA or TBA is available
        if ((initRedProb == null || !initRedProb) && TBA_API_KEY) {
          try {
            const ek = event_key || match_key.split('_')[0]; // e.g., 2025casj_qm1 -> 2025casj
            const preds = await fetchEventPredictions(ek);
            const p = preds?.[match_key];
            if (p) initProb = clamp01(p.redWinProb);
          } catch {
            // ignore
          }
        }

        market = await createMarket({
          match_key,
          event_key: event_key || null,
          red_team_keys,
          blue_team_keys,
          start_time,
          b: 50,
          initProbRed: initProb
        });

        // Snapshot initial state for price-over-time chart
        await insertMarketTick(market);
      }

      return json({ success: true, data: serializeMarket(market) });
    }

    if (action === 'balance') {
      const user_id = url.searchParams.get('user_id');
      if (!user_id) return json({ error: 'user_id is required' }, { status: 400 });
      const bal = await getOrCreateBalance(user_id);
      return json({ success: true, data: bal });
    }

    if (action === 'markets') {
      const event_key = url.searchParams.get('event_key');
      const status = url.searchParams.get('status'); // 'open' | 'settled' | 'cancelled'
      let query = supabase.from('betting_markets').select('*');
      if (event_key) query = query.eq('event_key', event_key);
      if (status) query = query.eq('status', status);
      else query = query.in('status', ['open', 'settled']);
      const { data, error } = await query.order('updated_at', { ascending: false }).limit(200);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data: (data || []).map(serializeMarket) });
    }

    // Attempt to settle any open markets whose match result is available from TBA
    if (action === 'settle-finished') {
      // If no TBA key, we cannot resolve winners automatically
      if (!TBA_API_KEY) {
        return json({ success: true, note: 'Missing TBA key; nothing settled', data: [] });
      }

      const { data: openMarkets, error: mErr } = await supabase.from('betting_markets').select('*').eq('status', 'open').limit(500);
      if (mErr) return json({ error: mErr.message }, { status: 500 });

      const settled = [];
      for (const market of openMarkets || []) {
        try {
          const resp = await fetch(`${TBA_BASE}/match/${market.match_key}`, { headers: tbaHeaders() });
          if (!resp.ok) continue;
          const m = await resp.json();
          const res = m?.winning_alliance; // 'red' | 'blue' | ''
          if (res !== 'red' && res !== 'blue') continue;

          // Fetch bets for this market
          const { data: bets, error: betsErr } = await supabase.from('betting_bets').select('*').eq('market_id', market.id);
          if (betsErr) throw new Error(betsErr.message);

          // Compute payouts
          const payouts = new Map();
          for (const bet of bets) {
            if (bet.outcome === res) {
              const amt = payoutForWinningShares(Number(bet.shares), 0.01);
              payouts.set(bet.user_id, Number(payouts.get(bet.user_id) || 0) + amt);
            }
          }

          // Apply payouts
          for (const [user_id, amt] of payouts.entries()) {
            await getOrCreateBalance(user_id);
            const { data: balRow, error: getErr } = await supabase.from('user_balances').select('balance').eq('user_id', user_id).single();
            if (getErr) throw new Error(getErr.message);
            const { error: updErr } = await supabase.from('user_balances').update({ balance: Number(balRow.balance) + amt }).eq('user_id', user_id);
            if (updErr) throw new Error(updErr.message);
          }

          // Close market
          const { error: closeErr } = await supabase
            .from('betting_markets')
            .update({ status: 'settled', winning_outcome: res, updated_at: new Date().toISOString() })
            .eq('id', market.id);
          if (closeErr) throw new Error(closeErr.message);

          settled.push({ market_id: market.id, match_key: market.match_key, winning_outcome: res, payouts: Object.fromEntries(payouts) });
        } catch {
          // Best-effort: continue to next market on any error
          continue;
        }
      }

      return json({ success: true, data: settled });
    }

    // Backfill winning_outcome for markets that were marked 'settled' but lack a winner
    if (action === 'backfill-winners') {
      if (!TBA_API_KEY) {
        return json({ success: true, note: 'Missing TBA key; nothing backfilled', data: [] });
      }

      const { data: mkts, error: mkErr } = await supabase
        .from('betting_markets')
        .select('*')
        .eq('status', 'settled')
        .is('winning_outcome', null)
        .limit(500);
      if (mkErr) return json({ error: mkErr.message }, { status: 500 });

      const backfilled = [];
      for (const m of mkts || []) {
        try {
          const resp = await fetch(`${TBA_BASE}/match/${m.match_key}`, { headers: tbaHeaders() });
          if (!resp.ok) continue;
          const mm = await resp.json();
          const res = mm?.winning_alliance; // 'red' | 'blue' | ''
          if (res !== 'red' && res !== 'blue') continue;

          const { error: updErr } = await supabase.from('betting_markets').update({ winning_outcome: res, updated_at: new Date().toISOString() }).eq('id', m.id);
          if (updErr) continue;
          backfilled.push({ market_id: m.id, match_key: m.match_key, winning_outcome: res });
        } catch {
          continue;
        }
      }

      return json({ success: true, data: backfilled });
    }

    if (action === 'user-bets') {
      const user_id = url.searchParams.get('user_id');
      if (!user_id) return json({ error: 'user_id is required' }, { status: 400 });
      const { data: bets, error: betsErr } = await supabase
        .from('betting_bets')
        .select('*')
        .eq('user_id', user_id)
        .order('created_at', { ascending: false })
        .limit(200);
      if (betsErr) return json({ error: betsErr.message }, { status: 500 });
      const ids = Array.from(new Set((bets || []).map((b) => b.market_id))).filter(Boolean);
      let marketsMap = new Map();
      if (ids.length) {
        const { data: mkts, error: mErr } = await supabase.from('betting_markets').select('*').in('id', ids);
        if (mErr) return json({ error: mErr.message }, { status: 500 });
        for (const m of mkts || []) marketsMap.set(m.id, serializeMarket(m));
      }
      const rows = (bets || []).map((b) => ({
        bet: b,
        market: marketsMap.get(b.market_id) || null
      }));
      return json({ success: true, data: rows });
    }

    if (action === 'market-ticks') {
      const market_id = url.searchParams.get('market_id');
      const match_key = url.searchParams.get('match_key');
      let mId = market_id;
      if (!mId && match_key) {
        const m = await getMarketByMatchKey(match_key);
        mId = m?.id || null;
      }
      if (!mId) return json({ success: true, data: [] });
      const { data, error } = await supabase
        .from('betting_market_ticks')
        .select('market_id, q_red, q_blue, price_red, price_blue, created_at')
        .eq('market_id', mId)
        .order('created_at', { ascending: true })
        .limit(1000);
      if (error) return json({ error: error.message }, { status: 500 });
      return json({ success: true, data: data || [] });
    }

    if (action === 'info') {
      const s = await getPredictSettings();
      return json({ success: true, data: { demo: !!s.demo, competitions: s.competitions, tab_visible: !!s.tab_visible } });
    }

    return json({ error: 'Invalid action' }, { status: 400 });
  } catch (e) {
    return json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}

// POST handler
export async function POST({ request }) {
  try {
    const body = await request.json();
    const action = body?.action;
    if (!action) return json({ error: 'Missing action' }, { status: 400 });

    if (action === 'place-bet') {
      const { user_id, match_key, market_id, outcome, amount } = body || {};
      if (!user_id) return json({ error: 'user_id is required' }, { status: 400 });
      if (!outcome || !['red', 'blue'].includes(outcome)) return json({ error: 'outcome must be red or blue' }, { status: 400 });
      const amt = Number(amount);
      if (!(amt > 0)) return json({ error: 'amount must be > 0' }, { status: 400 });

      // Load or find market
      let market;
      if (market_id) {
        const { data, error } = await supabase.from('betting_markets').select('*').eq('id', market_id).maybeSingle();
        if (error) throw new Error(error.message);
        market = data;
      } else if (match_key) {
        market = await getMarketByMatchKey(match_key);
      }
      if (!market) return json({ error: 'Market not found' }, { status: 404 });
      if (market.status !== 'open') return json({ error: 'Market is not open' }, { status: 400 });

      // Balance check
      const bal = await getOrCreateBalance(user_id);
      if (Number(bal.balance) < amt) return json({ error: 'Insufficient balance' }, { status: 400 });

      const b = Number(market.b || 50);
      const q = { red: Number(market.q_red || 0), blue: Number(market.q_blue || 0) };

      // Compute shares using LMSR
      // Reuse formula from lmsr.js, but we need sharesForSpend; derive by prices and cost delta
      const p = lmsrPrices(q, b)[outcome];
      const expTerm = Math.exp(amt / b);
      const delta = b * Math.log(1 + (expTerm - 1) / Math.max(p, 1e-12));
      const qNext = { ...q, [outcome]: q[outcome] + delta };

      // Apply updates: deduct balance, update market q, insert bet
      const { error: balErr } = await supabase.from('user_balances').update({ balance: Number(bal.balance) - amt }).eq('user_id', user_id);
      if (balErr) throw new Error(balErr.message);

      const { error: marketErr, data: updatedMarketRows } = await supabase
        .from('betting_markets')
        .update({ q_red: qNext.red, q_blue: qNext.blue, updated_at: new Date().toISOString() })
        .eq('id', market.id)
        .select('*');
      if (marketErr) throw new Error(marketErr.message);
      const updatedMarket = updatedMarketRows?.[0] ?? { ...market, q_red: qNext.red, q_blue: qNext.blue };

      const { error: betErr, data: betRow } = await supabase
        .from('betting_bets')
        .insert([
          {
            market_id: market.id,
            user_id,
            outcome,
            amount: amt,
            shares: delta
          }
        ])
        .select('*')
        .single();
      if (betErr) throw new Error(betErr.message);

      // Snapshot updated state for price-over-time chart
      await insertMarketTick(updatedMarket);

      return json({
        success: true,
        data: {
          bet: betRow,
          market: serializeMarket(updatedMarket),
          new_balance: Number(bal.balance) - amt
        }
      });
    }

    if (action === 'settle-market') {
      const { admin_user_id, match_key, winning_outcome } = body || {};
      if (!match_key) return json({ error: 'match_key is required' }, { status: 400 });

      // Load market
      const market = await getMarketByMatchKey(match_key);
      if (!market) return json({ error: 'Market not found' }, { status: 404 });
      if (market.status !== 'open') return json({ error: 'Market is not open' }, { status: 400 });

      // Determine winning outcome
      let winner = winning_outcome;
      if (!winner && TBA_API_KEY) {
        try {
          const resp = await fetch(`${TBA_BASE}/match/${match_key}`, { headers: tbaHeaders() });
          if (resp.ok) {
            const m = await resp.json();
            const res = m?.winning_alliance; // 'red' | 'blue' | ''
            if (res === 'red' || res === 'blue') {
              winner = res;
            }
          }
        } catch {
          // ignore
        }
      }
      if (winner !== 'red' && winner !== 'blue') {
        return json({ error: 'Unable to resolve winner; provide winning_outcome explicitly' }, { status: 400 });
      }

      // Fetch all bets for market
      const { data: bets, error: betsErr } = await supabase.from('betting_bets').select('*').eq('market_id', market.id);
      if (betsErr) throw new Error(betsErr.message);

      // Compute payouts
      const payouts = new Map(); // user_id -> amount
      for (const bet of bets) {
        if (bet.outcome === winner) {
          const amt = payoutForWinningShares(Number(bet.shares), 0.01);
          payouts.set(bet.user_id, Number(payouts.get(bet.user_id) || 0) + amt);
        }
      }

      // Apply payouts and close market
      for (const [user_id, amt] of payouts.entries()) {
        await getOrCreateBalance(user_id);
        const { data: balRow, error: getErr } = await supabase.from('user_balances').select('balance').eq('user_id', user_id).single();
        if (getErr) throw new Error(getErr.message);
        const { error: updErr } = await supabase.from('user_balances').update({ balance: Number(balRow.balance) + amt }).eq('user_id', user_id);
        if (updErr) throw new Error(updErr.message);
      }

      const { error: closeErr } = await supabase
        .from('betting_markets')
        .update({ status: 'settled', winning_outcome: winner, updated_at: new Date().toISOString() })
        .eq('id', market.id);
      if (closeErr) throw new Error(closeErr.message);

      return json({ success: true, data: { market_id: market.id, winning_outcome: winner, payouts: Object.fromEntries(payouts) } });
    }

    if (action === 'sell-bet') {
      // Selling has been disabled application-wide.
      return json({ error: 'Selling disabled' }, { status: 403 });
    }

    if (action === 'sell-bet') {
      // Selling is disabled; respond consistently for any method
      return json({ error: 'Selling disabled' }, { status: 403 });
    }

    // 'save-settings' action removed — predictive settings are no longer editable via this endpoint

    return json({ error: 'Invalid action' }, { status: 400 });
  } catch (e) {
    return json({ error: e.message || 'Internal server error' }, { status: 500 });
  }
}
