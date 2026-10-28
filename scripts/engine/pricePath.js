/**
 * Price path
 * @file scripts/engine/pricePath.js
 * @description The prices along a run of ticks. Open orders and price alerts are worked once a run
 *              has finished, so the path lets them see where prices went in between, not only where
 *              they ended: a limit the price touched and left still fills. Pure; no Foundry globals.
 *
 *   path: { times: number[], prices: { [assetId]: number[] } }
 *         `times[i]` is the market clock after the run's tick i, and `prices[id][i]` the price then
 */

import { TIME_EPS } from './clock.js';

export const emptyPath = () => ({ times: [], prices: {} });

/** Record the prices after one tick. The path is changed in place, as the run builds it. */
export function addToPath(path, time, prices) {
  path.times.push(time);
  for (const [id, price] of Object.entries(prices)) (path.prices[id] ??= []).push(price);
  return path;
}

/**
 * The lowest and highest price of an asset at the path's times from `from` to `to`, both included.
 * @returns {{low: number, high: number} | null} null when the path has no price for it in that span
 */
export function pathRange(path, assetId, from = -Infinity, to = Infinity) {
  const prices = path?.prices?.[assetId];
  if (!prices) return null;
  let low = Infinity;
  let high = -Infinity;
  path.times.forEach((t, i) => {
    if (t < from - TIME_EPS || t > to + TIME_EPS || !(prices[i] > 0)) return;
    low = Math.min(low, prices[i]);
    high = Math.max(high, prices[i]);
  });
  return low === Infinity ? null : { low, high };
}
