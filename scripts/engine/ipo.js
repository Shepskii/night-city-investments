/**
 * IPOs
 * @file scripts/engine/ipo.js
 * @description A company can be scheduled to list on an in-world date. For a few days before that
 *              (the offering window) players can subscribe for shares at the offer price; cash is
 *              held, not spent. On the listing day the company's price is set to the offer price and
 *              every subscription is filled, pro rata if the offer is oversubscribed. Pure; no
 *              Foundry globals.
 */

import { DAY_MS } from './clock.js';
import { normalizePortfolio, committedCash, OPEN } from './portfolioModel.js';

export const IPO_ORDER_TYPE = 'ipo';
/** An order that waits for the listing, never for a tick. */
export const IPO_WAIT = 1_000_000_000;

/** Day index (days since the epoch) for "YYYY-MM-DD", or null when it is not a real date. */
export function isoToDay(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso ?? ''));
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  const back = new Date(ms);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== mo - 1 || back.getUTCDate() !== d) return null;
  return Math.floor(ms / DAY_MS);
}

/** The offer price: the GM's price, or the company's initial price. */
export const ipoPrice = (company) => company.ipo?.price ?? company.initialPrice;

/**
 * Where an unlisted company is in its IPO.
 * @returns {{state: 'none'|'upcoming'|'window'|'due', listDay?: number, daysToList?: number}}
 */
export function ipoStatus(company, todayDay) {
  if (!company || company.listed || !company.ipo?.date) return { state: 'none' };
  const listDay = isoToDay(company.ipo.date);
  if (listDay === null) return { state: 'none' };
  const daysToList = listDay - todayDay;
  if (daysToList <= 0) return { state: 'due', listDay, daysToList };
  if (company.ipo.windowDays > 0 && daysToList <= company.ipo.windowDays) return { state: 'window', listDay, daysToList };
  return { state: 'upcoming', listDay, daysToList };
}

export const ipoOrdersFor = (portfolio, assetId) => portfolio.orders.filter(
  (o) => o.status === OPEN && o.type === IPO_ORDER_TYPE && o.assetId === assetId,
);

/**
 * Subscribe to an open IPO. The money is reserved, not taken, so cancelling is free until listing.
 * @param {{ipo: {open: boolean, price: number}}} asset - the market entry for the company
 * @returns {{ok: true, portfolio: object, orderId: string, reserve: number} | {ok: false, reason: string}}
 */
export function planSubscription({ portfolio, key, assetId, qty, asset, tick }) {
  const p = normalizePortfolio(portfolio);
  const n = Number(qty);
  if (!asset?.ipo?.open) return { ok: false, reason: 'ipo-closed' };
  if (!Number.isInteger(n) || n <= 0) return { ok: false, reason: 'invalid-qty' };
  if (ipoOrdersFor(p, assetId).length) return { ok: false, reason: 'ipo-already' };

  const price = asset.ipo.price;
  const reserve = Math.round(n * price);
  if (p.cash - committedCash(p.orders) < reserve) return { ok: false, reason: 'insufficient-funds' };

  const order = {
    id: `o_${key}`,
    side: 'buy',
    assetType: 'stock',
    assetId,
    qty: n,
    type: IPO_ORDER_TYPE,
    limit: null,
    expiry: 'gtc',
    route: 'direct',
    brokerId: null,
    feeProfile: {},
    terms: null,
    status: OPEN,
    submittedTick: tick,
    eligibleTick: IPO_WAIT,
    expiresTick: IPO_WAIT,
    reserve,
    offerPrice: price,
  };
  return { ok: true, portfolio: { ...p, orders: [...p.orders, order] }, orderId: order.id, reserve };
}

/** Total shares asked for across portfolios. */
export const ipoDemand = (portfolios, assetId) => portfolios.reduce(
  (sum, p) => sum + ipoOrdersFor(normalizePortfolio(p), assetId).reduce((s, o) => s + o.qty, 0),
  0,
);

/** Share of each subscription that is filled: 1 unless the offer is capped and oversubscribed. */
export function allocationRatio(demand, allocation) {
  return allocation > 0 && demand > allocation ? allocation / demand : 1;
}

/**
 * The listing has happened: fill this portfolio's subscriptions at the offer price.
 * @returns {{portfolio: object, changed: boolean, filled: number}}
 */
export function settleIpoOrders(portfolio, assetId, price, ratio, tick) {
  const p = normalizePortfolio(portfolio);
  const mine = ipoOrdersFor(p, assetId);
  if (!mine.length) return { portfolio: p, changed: false, filled: 0 };

  let cash = p.cash;
  let lots = p.lots;
  let ledger = p.ledger;
  let filledTotal = 0;
  const done = new Map();

  for (const o of mine) {
    const qty = Math.floor(o.qty * ratio);
    const gross = Math.round(qty * price);
    if (qty <= 0 || cash < gross) {
      done.set(o.id, { ...o, status: 'rejected', reason: qty <= 0 ? 'ipo-no-allocation' : 'insufficient-funds', closedTick: tick });
      continue;
    }
    cash -= gross;
    lots = [...lots, { id: `lot_${o.id}`, assetType: 'stock', assetId, qty, unitCost: price, acquiredTick: tick, drip: false }];
    ledger = [...ledger, { ts: tick, kind: 'buy', assetId, qty, amount: -gross, ref: 'ipo' }];
    filledTotal += qty;
    done.set(o.id, { ...o, status: 'filled', requestedQty: o.qty, qty, fillPrice: price, fees: 0, filledTick: tick, closedTick: tick, reserve: 0 });
  }

  return {
    portfolio: { ...p, cash, lots, ledger, orders: p.orders.map((o) => done.get(o.id) ?? o) },
    changed: true,
    filled: filledTotal,
  };
}
