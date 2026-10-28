/**
 * Brokerage statements
 * @file scripts/engine/statements.js
 * @description A statement summarises a portfolio since the last monthly one: the opening and
 *              closing value, money paid in and out, trading and income, performance, and what is
 *              held now. Monthly statements move the baseline forward; one a player asks for in
 *              between does not. Built from the account ledger, which keeps the most recent
 *              entries, so a very busy month can under-count its flows. Pure; no Foundry globals.
 */

import { normalizePortfolio, valuePortfolio, OPEN } from './portfolioModel.js';

const pad = (n) => String(n).padStart(2, '0');

/** "2046-10" for an in-world date. */
export const monthKey = ({ year, month }) => `${year}-${pad(month)}`;

/**
 * What a monthly check should do for this portfolio.
 * @returns {'baseline'|'send'|null} baseline: first sight, record a starting point only;
 *          send: a new month has begun; null: nothing to do
 */
export function statementDue(portfolio, key) {
  const p = normalizePortfolio(portfolio);
  if (!p.statement) return 'baseline';
  return p.statement.monthKey === key ? null : 'send';
}

/** Move the baseline to now. Call with the statement just built. */
export function closeStatement(portfolio, statement, key) {
  const p = normalizePortfolio(portfolio);
  return {
    ...p,
    statement: { tick: statement.toTick, monthKey: key, total: statement.closing.total, realized: p.stats.realized },
  };
}

/** The baseline for a portfolio seen for the first time: its value now, with nothing to report yet. */
export function baselineStatement(portfolio, prices, tick, key) {
  const p = normalizePortfolio(portfolio);
  const v = valuePortfolio(p, prices);
  return { ...p, statement: { tick, monthKey: key, total: Math.round(v.total), realized: p.stats.realized } };
}

const sum = (entries, kind) => entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount, 0);

/**
 * @param {object} o
 * @param {object} o.portfolio
 * @param {Object<string, number>} o.prices - assetId -> price now
 * @param {number} o.tick
 */
export function buildStatement({ portfolio, prices, tick }) {
  const p = normalizePortfolio(portfolio);
  const since = p.statement?.tick ?? -1;
  const entries = p.ledger.filter((e) => e.ts > since);
  const v = valuePortfolio(p, prices);

  // `+ 0` turns -0 (from an empty sum) into 0.
  const r = (x) => Math.round(x) + 0;
  const flows = {
    deposits: r(sum(entries, 'deposit')),
    withdrawals: r(-sum(entries, 'withdraw')),
    refunds: r(sum(entries, 'withdraw-refund')),
    bought: r(-sum(entries, 'buy')),
    sold: r(sum(entries, 'sell')),
    fees: r(-sum(entries, 'fee')),
    dividends: r(sum(entries, 'dividend')),
    reinvested: r(-sum(entries, 'drip')),
    payouts: r(sum(entries, 'buyout') + sum(entries, 'delist')),
  };

  const opening = p.statement ? p.statement.total : null;
  const closing = { cash: Math.round(v.cash), holdings: Math.round(v.holdings), unsettled: Math.round(v.unsettled), total: Math.round(v.total) };
  const external = flows.deposits - flows.withdrawals + flows.refunds;
  const gain = opening === null ? null : closing.total - opening - external;

  return {
    fromTick: since < 0 ? null : since,
    toTick: tick,
    opening,
    closing,
    flows,
    gain,
    gainPct: opening ? gain / opening : null,
    realized: Math.round(p.stats.realized - (p.statement?.realized ?? 0)),
    unrealized: Math.round(v.unrealized),
    openOrders: p.orders.filter((o) => o.status === OPEN).length,
    positions: v.positions.map((pos) => ({
      assetId: pos.assetId,
      qty: pos.qty,
      avgCost: pos.avgCost,
      price: pos.price,
      value: pos.value,
      unrealized: pos.unrealized,
      unrealizedPct: pos.unrealizedPct,
      weight: v.holdings > 0 ? pos.value / v.holdings : 0,
    })).sort((a, b) => b.value - a.value),
  };
}
