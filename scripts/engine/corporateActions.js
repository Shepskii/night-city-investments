/**
 * Corporate actions
 * @file scripts/engine/corporateActions.js
 * @description How a stock split, buyout, delisting or bankruptcy changes the market state, price
 *              history and each player's portfolio. Pure; no Foundry globals.
 */

import { normalizePortfolio, OPEN } from './portfolioModel.js';

const round2 = (n) => Math.round(n * 100) / 100;
const round4 = (n) => Math.round(n * 10000) / 10000;

export const MAX_SPLIT_RATIO = 20;

/** A split ratio must be a whole number from 2 to 20 (an N-for-1 split). */
export const isValidSplitRatio = (ratio) => Number.isInteger(ratio) && ratio >= 2 && ratio <= MAX_SPLIT_RATIO;

/** Should a company split now, going by its auto-split setting? Returns the ratio or null. */
export function autoSplitRatio(company, price) {
  const s = company.split;
  if (!s?.auto || !(s.above > 0) || !isValidSplitRatio(s.ratio)) return null;
  return price >= s.above ? s.ratio : null;
}

/** Divide one company's prices in an engine state by the split ratio. */
export function splitMarketState(state, id, ratio) {
  const c = state.companies[id];
  if (!c) return state;
  return {
    ...state,
    companies: {
      ...state.companies,
      [id]: { ...c, price: round2(c.price / ratio), prevClose: round2(c.prevClose / ratio), fair: c.fair / ratio },
    },
  };
}

/** Scale one company's stored closes (integer cents) so charts stay continuous across a split. */
export function scaleHistory(history, id, factor) {
  const series = history.series?.[id];
  if (!series) return history;
  return {
    ...history,
    series: { ...history.series, [id]: { ...series, closes: series.closes.map((c) => Math.round(c * factor)) } },
  };
}

function cancelOpenOrders(p, assetId, reason, tick) {
  return {
    ...p,
    orders: p.orders.map((o) => (o.status === OPEN && o.assetId === assetId
      ? { ...o, status: 'cancelled', reason, closedTick: tick }
      : o)),
  };
}

const holds = (p, assetId) => p.lots.some((l) => l.assetId === assetId) || p.orders.some((o) => o.status === OPEN && o.assetId === assetId);

/**
 * Apply an N-for-1 split: shares multiply, cost per share divides, open orders are rescaled.
 * @returns {{portfolio: object, changed: boolean}}
 */
export function splitPortfolio(portfolio, assetId, ratio, tick = 0) {
  const p = normalizePortfolio(portfolio);
  if (!isValidSplitRatio(ratio) || !holds(p, assetId)) return { portfolio: p, changed: false };

  const before = p.lots.filter((l) => l.assetId === assetId).reduce((s, l) => s + l.qty, 0);
  const lots = p.lots.map((l) => (l.assetId === assetId
    ? { ...l, qty: l.qty * ratio, unitCost: round4(l.unitCost / ratio) }
    : l));
  const orders = p.orders.map((o) => (o.status === OPEN && o.assetId === assetId
    ? { ...o, qty: o.qty * ratio, limit: o.limit === null || o.limit === undefined ? o.limit : round2(o.limit / ratio) }
    : o));
  const ledger = before
    ? [...p.ledger, { ts: tick, kind: 'split', assetId, qty: before * (ratio - 1), amount: 0, ref: `1:${ratio}` }]
    : p.ledger;
  return { portfolio: { ...p, lots, orders, ledger }, changed: true };
}

/**
 * Pay holders out in cash at `price` and remove the position (buyout or delisting).
 * Open orders in the asset are cancelled.
 * @param {'buyout'|'delist'} kind
 * @returns {{portfolio: object, changed: boolean, payout: number}}
 */
export function cashOutPortfolio(portfolio, assetId, price, kind, tick = 0) {
  const p = normalizePortfolio(portfolio);
  if (!holds(p, assetId)) return { portfolio: p, changed: false, payout: 0 };

  const mine = p.lots.filter((l) => l.assetId === assetId);
  const qty = mine.reduce((s, l) => s + l.qty, 0);
  const cost = mine.reduce((s, l) => s + l.qty * l.unitCost, 0);
  const payout = Math.round(qty * price);

  const cancelled = cancelOpenOrders(p, assetId, kind, tick);
  const ledger = qty
    ? [...p.ledger, { ts: tick, kind, assetId, qty, amount: payout, ref: kind }]
    : p.ledger;
  return {
    portfolio: {
      ...cancelled,
      cash: p.cash + payout,
      lots: p.lots.filter((l) => l.assetId !== assetId),
      ledger,
      stats: { ...p.stats, realized: p.stats.realized + Math.round(payout - cost) },
    },
    changed: true,
    payout,
  };
}

/**
 * A bankrupt company: shares are worth nothing. The position is removed and the loss recorded.
 * @returns {{portfolio: object, changed: boolean, loss: number}}
 */
export function writeOffPortfolio(portfolio, assetId, tick = 0) {
  const p = normalizePortfolio(portfolio);
  if (!holds(p, assetId)) return { portfolio: p, changed: false, loss: 0 };

  const mine = p.lots.filter((l) => l.assetId === assetId);
  const qty = mine.reduce((s, l) => s + l.qty, 0);
  const cost = Math.round(mine.reduce((s, l) => s + l.qty * l.unitCost, 0));

  const cancelled = cancelOpenOrders(p, assetId, 'bankrupt', tick);
  const ledger = qty ? [...p.ledger, { ts: tick, kind: 'writeoff', assetId, qty, amount: 0, ref: 'bankrupt' }] : p.ledger;
  return {
    portfolio: {
      ...cancelled,
      lots: p.lots.filter((l) => l.assetId !== assetId),
      ledger,
      stats: { ...p.stats, realized: p.stats.realized - cost },
    },
    changed: true,
    loss: cost,
  };
}
