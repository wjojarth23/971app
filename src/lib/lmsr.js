// LMSR (Logarithmic Market Scoring Rule) utilities for 2-outcome markets
// Reference:
//   C(q) = b * ln(sum_i exp(q_i / b))
//   price_i(q) = exp(q_i / b) / sum_j exp(q_j / b)
//   To spend amount A to buy outcome i: delta = b * ln(1 + (exp(A/b) - 1) / price_i(q))
//
// q is an object { red: number, blue: number } representing outstanding shares per outcome
// b is the liquidity parameter (higher b => flatter prices, more liquidity)

function logSumExp(a, b) {
  // numerically stable log(exp(a) + exp(b))
  if (a === -Infinity) return b;
  if (b === -Infinity) return a;
  const m = Math.max(a, b);
  return m + Math.log(Math.exp(a - m) + Math.exp(b - m));
}

/**
 * Cost function C(q) for 2-outcome LMSR
 * @param {{red:number, blue:number}} q
 * @param {number} b
 * @returns {number}
 */
export function cost(q, b) {
  const a = q.red / b;
  const c = q.blue / b;
  return b * logSumExp(a, c);
}

/**
 * Instantaneous prices for both outcomes at state q
 * @param {{red:number, blue:number}} q
 * @param {number} b
 * @returns {{red:number, blue:number}}
 */
export function prices(q, b) {
  const a = Math.exp(q.red / b);
  const c = Math.exp(q.blue / b);
  const Z = a + c;
  return {
    red: a / Z,
    blue: c / Z
  };
}

/**
 * Price for a single outcome at q
 * @param {{red:number, blue:number}} q
 * @param {number} b
 * @param {'red'|'blue'} outcome
 * @returns {number}
 */
export function priceOf(q, b, outcome) {
  return prices(q, b)[outcome];
}

/**
 * Compute shares delta you receive for spending amount A on outcome i at state q.
 * @param {{red:number, blue:number}} q
 * @param {number} b
 * @param {'red'|'blue'} outcome
 * @param {number} amount
 * @returns {number} delta shares
 */
export function sharesForSpend(q, b, outcome, amount) {
  if (amount <= 0) return 0;
  const p = priceOf(q, b, outcome);
  // delta = b * ln(1 + (exp(A/b) - 1)/p)
  const expTerm = Math.exp(amount / b);
  const delta = b * Math.log(1 + (expTerm - 1) / Math.max(p, 1e-12));
  return delta;
}

/**
 * Apply a buy to state q, returning new q and post-trade prices
 * @param {{red:number, blue:number}} q
 * @param {number} b
 * @param {'red'|'blue'} outcome
 * @param {number} amount
 * @returns {{qNext:{red:number, blue:number}, delta:number, postPrices:{red:number, blue:number}}}
 */
export function buy(q, b, outcome, amount) {
  const delta = sharesForSpend(q, b, outcome, amount);
  const qNext = { ...q };
  qNext[outcome] += delta;
  return { qNext, delta, postPrices: prices(qNext, b) };
}

/**
 * Quote helper: given q,b,outcome,amount return expected shares and post-prices (without mutating q)
 * @param {{red:number, blue:number}} q
 * @param {number} b
 * @param {'red'|'blue'} outcome
 * @param {number} amount
 * @returns {{shares:number, postPrices:{red:number, blue:number}}}
 */
export function quote(q, b, outcome, amount) {
  const { qNext, delta, postPrices } = buy(q, b, outcome, amount);
  return { shares: delta, postPrices };
}

/**
 * Compute expected payout for shares if outcome wins.
 * Spec: winning share pays $1 minus 0.01 offset. Losing share pays 0.
 * @param {number} shares
 * @param {number} marketOffset default 0.01
 * @returns {number}
 */
export function payoutForWinningShares(shares, marketOffset = 0.01) {
  return Math.max(0, shares) * Math.max(0, 1 - marketOffset);
}
