/**
 * Portfolio model
 * @file scripts/engine/portfolioModel.js
 * @description Shape, caps, and valuation of a player's portfolio. Pure; no Foundry globals.
 *
 *   { schema, brokerContactId, cash, lots[], orders[], ledger[], processed[], results[], stats }
 *
 * Only the GM executor writes a portfolio. Players write requests to a separate outbox, and the
 * executor records which request keys it has handled in `processed`.
 */

import { positionSummary, computeFees } from './orderEngine.js';
import { TIME_EPS } from './clock.js';

export const PORTFOLIO_SCHEMA = 1;
export const LEDGER_CAP = 200;
export const CLOSED_ORDER_CAP = 40;
export const PROCESSED_CAP = 200;
export const RESULT_CAP = 20;
export const PAID_CAP = 100;
export const CLOSED_WITHDRAWAL_CAP = 15;

export const OPEN = 'open';
export const CLOSED_STATUSES = ['filled', 'rejected', 'cancelled', 'expired'];

export const emptyPortfolio = () => ({
  schema: PORTFOLIO_SCHEMA,
  brokerContactId: null,
  cash: 0,
  lots: [],
  orders: [],
  ledger: [],
  processed: [],
  results: [],
  /** Dividend payouts already made, as "assetId:periodKey", so none is paid twice. */
  paid: [],
  /** Per-asset dividend reinvestment switch: { ARA: true }. */
  drip: {},
  /** Withdrawals handled by a broker: { id, amount, fee, brokerId, submittedTick, releaseTick, status }. */
  withdrawals: [],
  /** Live terminal session for direct trading, or null. */
  session: null,
  /** Locked out of the terminal until this tick, after a failed Accounting check. */
  lockoutUntilTick: 0,
  /** Sale proceeds still settling: { id, assetId, amount, releaseTick }. Counted in value, not spendable yet. */
  unsettled: [],
  /** Price alerts (see alerts.js) and the last few that fired. */
  alerts: [],
  alertLog: [],
  /** The last monthly statement: { tick, monthKey, total, realized, dividends }, or null. */
  statement: null,
  /** Insider-trading consequences (see heatPenalty.js). Written only by the GM executor. */
  frozenUntilTick: 0,
  /** Brokers that refuse this character after dropping them: { [brokerId]: untilTick }. */
  brokerBans: {},
  /** Set once the character has been warned; it is what makes the "cover your tracks" actions visible. */
  heatAware: false,
  /** Cover-up actions on cooldown: { [actionId]: untilTick }. */
  heatCooldowns: {},
  stats: { realized: 0, dividends: 0 },
});

/** Fill in any missing fields of a stored portfolio. Does not mutate the input. */
export function normalizePortfolio(p) {
  const base = emptyPortfolio();
  if (!p) return base;
  return {
    ...base,
    ...p,
    lots: p.lots ?? [],
    orders: p.orders ?? [],
    ledger: p.ledger ?? [],
    processed: p.processed ?? [],
    results: p.results ?? [],
    paid: p.paid ?? [],
    drip: p.drip ?? {},
    withdrawals: p.withdrawals ?? [],
    session: p.session ?? null,
    lockoutUntilTick: p.lockoutUntilTick ?? 0,
    unsettled: p.unsettled ?? [],
    alerts: p.alerts ?? [],
    alertLog: p.alertLog ?? [],
    statement: p.statement ?? null,
    frozenUntilTick: p.frozenUntilTick ?? 0,
    brokerBans: p.brokerBans ?? {},
    heatAware: !!p.heatAware,
    heatCooldowns: p.heatCooldowns ?? {},
    stats: { ...base.stats, ...(p.stats ?? {}) },
  };
}

export const openOrders = (p) => p.orders.filter((o) => o.status === OPEN);

/** Cash reserved by open buy orders, optionally excluding one order. */
export function committedCash(orders, excludeId = null) {
  return orders
    .filter((o) => o.status === OPEN && o.side === 'buy' && o.id !== excludeId)
    .reduce((sum, o) => sum + (o.reserve ?? 0), 0);
}

/** Shares of an asset reserved by open sell orders, optionally excluding one order. */
export function reservedShares(orders, assetId, excludeId = null) {
  return orders
    .filter((o) => o.status === OPEN && o.side === 'sell' && o.assetId === assetId && o.id !== excludeId)
    .reduce((sum, o) => sum + o.qty, 0);
}

/**
 * Estimated cost or proceeds of an order at a given unit price.
 * Buys: total = gross + fees. Sells: total = gross - fees.
 */
export function estimateOrder({ side, qty, price, feeProfile = {} }) {
  const gross = Math.round(qty * price);
  const fees = computeFees(gross, feeProfile);
  return { gross, fees, total: side === 'buy' ? gross + fees : gross - fees };
}

/**
 * Value a portfolio at current prices.
 * @param {object} portfolio
 * @param {Object<string, number>} prices - assetId -> price
 */
export function valuePortfolio(portfolio, prices) {
  const ids = [...new Set(portfolio.lots.map((l) => l.assetId))].sort();
  const positions = ids.map((assetId) => {
    const price = prices[assetId] ?? 0;
    const s = positionSummary(portfolio.lots, assetId, price);
    return { assetId, price, ...s, unrealizedPct: s.cost ? s.unrealized / s.cost : 0 };
  });
  const holdings = positions.reduce((sum, p) => sum + p.value, 0);
  const cost = positions.reduce((sum, p) => sum + p.cost, 0);
  const unsettled = (portfolio.unsettled ?? []).reduce((sum, u) => sum + u.amount, 0);
  return {
    positions,
    holdings,
    cost,
    cash: portfolio.cash,
    unsettled,
    total: portfolio.cash + holdings + unsettled,
    unrealized: holdings - cost,
  };
}

/**
 * Move sale proceeds that have finished settling into cash.
 * @returns {{portfolio: object, released: number}}
 */
export function releaseSettled(portfolio, tick) {
  const p = normalizePortfolio(portfolio);
  const due = p.unsettled.filter((u) => u.releaseTick <= tick + TIME_EPS);
  if (!due.length) return { portfolio: p, released: 0 };
  const released = due.reduce((sum, u) => sum + u.amount, 0);
  return {
    portfolio: { ...p, cash: p.cash + released, unsettled: p.unsettled.filter((u) => u.releaseTick > tick + TIME_EPS) },
    released,
  };
}

const TICK_DRIVEN_KINDS = new Set(['buy', 'sell', 'dividend', 'drip', 'fine']);

/**
 * Has this portfolio's money moved because of market tick `tickIndex` or a later one? Fills,
 * dividends and paid broker withdrawals have; deposits and cancelled orders have not. Undoing a
 * tick is only safe when no portfolio has.
 */
export function movedMoneySince(portfolio, tickIndex) {
  const p = normalizePortfolio(portfolio);
  return p.ledger.some((e) => TICK_DRIVEN_KINDS.has(e.kind) && e.ts >= tickIndex)
    || p.withdrawals.some((w) => w.status === 'paid' && (w.paidTick ?? -1) >= tickIndex);
}

/** Enforce the caps on history so the stored flag stays small. */
export function trimPortfolio(p) {
  const open = p.orders.filter((o) => o.status === OPEN);
  const closed = p.orders.filter((o) => o.status !== OPEN).slice(-CLOSED_ORDER_CAP);
  const pending = p.withdrawals.filter((w) => w.status === 'pending');
  const settled = p.withdrawals.filter((w) => w.status !== 'pending').slice(-CLOSED_WITHDRAWAL_CAP);
  return {
    ...p,
    orders: [...closed, ...open],
    withdrawals: [...settled, ...pending],
    ledger: p.ledger.slice(-LEDGER_CAP),
    processed: p.processed.slice(-PROCESSED_CAP),
    paid: p.paid.slice(-PAID_CAP),
    results: p.results.slice(-RESULT_CAP),
  };
}
