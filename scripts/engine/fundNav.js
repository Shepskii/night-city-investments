/**
 * Fund and index values
 * @file scripts/engine/fundNav.js
 * @description Fund NAV is derived from component prices, not simulated. No Foundry globals.
 */

/** Weighted component value at the given prices: sum of weight * price. */
export function weightedValue(components, prices) {
  return components.reduce((sum, c) => sum + c.weight * (prices[c.companyId] ?? 0), 0);
}

/** Divisor that makes the index equal `baseLevel` at the given prices. */
export function makeDivisor(components, prices, baseLevel = 100) {
  const value = weightedValue(components, prices);
  return value > 0 ? value / baseLevel : 1;
}

/** Index or NAV level, rounded to 2 decimals. */
export function computeNav(components, prices, divisor) {
  return Math.round((weightedValue(components, prices) / divisor) * 100) / 100;
}

/** Apply one tick of expense-ratio drag to a NAV. */
export function accrueExpense(nav, expenseRatio, ticksPerYear = 365) {
  return Math.round(nav * (1 - expenseRatio / ticksPerYear) * 100) / 100;
}

/**
 * Equal-weighted market index: the average of each company's price relative to its starting
 * price, scaled so every company at its start gives 100.
 * @param {{price: number, prevClose: number, base: number}[]} items
 * @returns {{level: number, prev: number, changePct: number}}
 */
export function equalWeightIndex(items) {
  const valid = items.filter((i) => i.base > 0);
  if (!valid.length) return { level: 100, prev: 100, changePct: 0 };
  const avg = (key) => (valid.reduce((s, i) => s + i[key] / i.base, 0) / valid.length) * 100;
  const level = avg('price');
  const prev = avg('prevClose');
  return {
    level: Math.round(level * 100) / 100,
    prev: Math.round(prev * 100) / 100,
    changePct: prev ? (level - prev) / prev : 0,
  };
}
