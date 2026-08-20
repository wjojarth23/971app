import { describe, it, expect } from 'vitest';
import { cost, prices, priceOf, sharesForSpend, buy, quote, payoutForWinningShares } from './lmsr.js';

describe('prices', () => {
  it('splits 50/50 when both outcomes have equal shares', () => {
    const p = prices({ red: 0, blue: 0 }, 100);
    expect(p.red).toBeCloseTo(0.5, 10);
    expect(p.blue).toBeCloseTo(0.5, 10);
  });

  it('always sums to 1', () => {
    const p = prices({ red: 37, blue: -12 }, 50);
    expect(p.red + p.blue).toBeCloseTo(1, 10);
  });

  it('favors the outcome with more outstanding shares', () => {
    const p = prices({ red: 100, blue: 0 }, 50);
    expect(p.red).toBeGreaterThan(p.blue);
  });

  it('is flatter (closer to 50/50) with a larger liquidity parameter b', () => {
    const tight = prices({ red: 50, blue: 0 }, 10);
    const loose = prices({ red: 50, blue: 0 }, 1000);
    expect(Math.abs(loose.red - 0.5)).toBeLessThan(Math.abs(tight.red - 0.5));
  });
});

describe('priceOf', () => {
  it('returns the single requested outcome price', () => {
    const q = { red: 20, blue: 5 };
    const b = 50;
    expect(priceOf(q, b, 'red')).toBeCloseTo(prices(q, b).red, 10);
  });
});

describe('cost', () => {
  it('is symmetric under swapping red/blue with equal b', () => {
    expect(cost({ red: 10, blue: 3 }, 50)).toBeCloseTo(cost({ red: 3, blue: 10 }, 50), 10);
  });

  it('increases as outstanding shares increase', () => {
    const low = cost({ red: 0, blue: 0 }, 50);
    const high = cost({ red: 20, blue: 0 }, 50);
    expect(high).toBeGreaterThan(low);
  });

  it('stays numerically finite for large share counts (log-sum-exp stability)', () => {
    expect(Number.isFinite(cost({ red: 1e6, blue: 0 }, 50))).toBe(true);
    expect(Number.isFinite(cost({ red: 1e6, blue: 1e6 }, 50))).toBe(true);
  });
});

describe('sharesForSpend', () => {
  it('returns 0 shares for a non-positive spend', () => {
    expect(sharesForSpend({ red: 0, blue: 0 }, 50, 'red', 0)).toBe(0);
    expect(sharesForSpend({ red: 0, blue: 0 }, 50, 'red', -5)).toBe(0);
  });

  it('returns more shares for spending more (diminishing but monotonic)', () => {
    const q = { red: 0, blue: 0 };
    const small = sharesForSpend(q, 50, 'red', 10);
    const large = sharesForSpend(q, 50, 'red', 20);
    expect(large).toBeGreaterThan(small);
  });

  it('buying an outcome that already has more shares (higher price) costs more shares-per-dollar to gain the same shares... i.e. yields fewer shares for the same spend', () => {
    const cheap = sharesForSpend({ red: 0, blue: 0 }, 50, 'red', 10);
    const expensive = sharesForSpend({ red: 50, blue: 0 }, 50, 'red', 10);
    expect(expensive).toBeLessThan(cheap);
  });
});

describe('buy', () => {
  it('increases the outstanding shares of the purchased outcome only', () => {
    const q = { red: 10, blue: 10 };
    const { qNext } = buy(q, 50, 'red', 20);
    expect(qNext.red).toBeGreaterThan(q.red);
    expect(qNext.blue).toBe(q.blue);
  });

  it('does not mutate the input state', () => {
    const q = { red: 10, blue: 10 };
    buy(q, 50, 'red', 20);
    expect(q).toEqual({ red: 10, blue: 10 });
  });

  it('raises the post-trade price of the purchased outcome', () => {
    const q = { red: 10, blue: 10 };
    const before = prices(q, 50);
    const { postPrices } = buy(q, 50, 'red', 20);
    expect(postPrices.red).toBeGreaterThan(before.red);
  });
});

describe('quote', () => {
  it('matches what buy() would produce, without needing the caller to apply it', () => {
    const q = { red: 5, blue: 5 };
    const b = 50;
    const bought = buy(q, b, 'blue', 15);
    const quoted = quote(q, b, 'blue', 15);
    expect(quoted.shares).toBeCloseTo(bought.delta, 10);
    expect(quoted.postPrices.blue).toBeCloseTo(bought.postPrices.blue, 10);
  });
});

describe('payoutForWinningShares', () => {
  it('pays shares minus the market offset', () => {
    expect(payoutForWinningShares(100, 0.01)).toBeCloseTo(99, 10);
  });

  it('uses a 0.01 default offset', () => {
    expect(payoutForWinningShares(100)).toBeCloseTo(99, 10);
  });

  it('never pays a negative amount for negative shares', () => {
    expect(payoutForWinningShares(-5)).toBe(0);
  });
});
