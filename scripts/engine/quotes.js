/**
 * Quotes and spreads
 * @file scripts/engine/quotes.js
 */

import { DEFAULT_MODEL_CONFIG } from './config.js';

const round2 = (n) => Math.round(n * 100) / 100;

/** Spread as a fraction of price for a 1..5 liquidity rating. */
export function spreadFor(liquidity, config = DEFAULT_MODEL_CONFIG) {
  const idx = Math.min(5, Math.max(1, Math.round(liquidity ?? 3))) - 1;
  return config.spreadByLiquidity[idx];
}

/**
 * Bid and ask around the last price. Players buy at the ask and sell at the bid.
 * @returns {{bid: number, ask: number, mid: number, spread: number}}
 */
export function quote(price, liquidity, config = DEFAULT_MODEL_CONFIG) {
  const spread = spreadFor(liquidity, config);
  return {
    mid: price,
    spread,
    bid: Math.max(0.01, round2(price * (1 - spread / 2))),
    ask: round2(price * (1 + spread / 2)),
  };
}

/**
 * Price multiplier from a large order, so one rich runner moves a thin stock.
 * Returns 1 when market impact is disabled.
 */
export function impactMultiplier(side, qty, config = DEFAULT_MODEL_CONFIG) {
  const mi = config.marketImpact;
  if (!mi?.enabled) return 1;
  const move = mi.lambda * Math.sqrt(Math.max(0, qty) / mi.advRef);
  return side === 'buy' ? 1 + move : Math.max(0.01, 1 - move);
}
