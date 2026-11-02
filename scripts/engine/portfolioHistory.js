/**
 * Portfolio performance over time
 * @file scripts/engine/portfolioHistory.js
 * @description A brokerage account's profit and loss, day by day, rebuilt from what is already stored: its ledger
 *              and each company's daily closes. Walking back from today, each ledger entry is undone, which gives
 *              the cash and holdings on each earlier day. Money moved in or out is not profit, so it is taken off.
 *              The ledger keeps its latest entries only, so the line starts no further back than they reach.
 *              Private stakes have no daily price, so they are not included. Pure.
 */

import { dayOf } from './clock.js';
import { getSeries } from './history.js';

/** Ledger entries that change what is held: adding it, taking it away, or carrying their own sign. */
const ADDS = new Set(['buy', 'drip', 'split', 'listing', 'takeoverSettled']);
const REMOVES = new Set(['sell', 'writeoff', 'buyout', 'delist']);
const SIGNED = new Set(['tendered', 'delisting', 'windUp']);
/** Money moving in or out of the account: neither profit nor loss. */
const FLOWS = new Set([
  'deposit', 'withdraw', 'withdraw-refund',
  'syndicateDeposit', 'syndicateRedeem', 'syndicatePayout',
  'memberDeposit', 'memberRedeem', 'memberPayout',
  'businessIn', 'businessOut',
]);

function heldChange(entry) {
  if (ADDS.has(entry.kind)) return Number(entry.qty) || 0;
  if (REMOVES.has(entry.kind)) return -Math.abs(Number(entry.qty) || 0);
  if (SIGNED.has(entry.kind)) return Number(entry.qty) || 0;
  return 0;
}

/** An asset's close on a day, or the nearest there is. */
function closeOn(history, assetId, day, fallback) {
  const series = history?.series?.[assetId];
  if (!series?.closes?.length) return fallback;
  const closes = getSeries(history, assetId);
  return closes[Math.max(0, Math.min(closes.length - 1, day - series.startTick))];
}

/**
 * The account's profit or loss since the line began, one value a day, oldest first; empty with nothing to show.
 * @param {object} portfolio - with `cash`, `lots` and `ledger`
 * @param {object} history - the price history
 * @param {{day: number, days?: number, prices?: object, unsettled?: number}} o - today, how far back, and prices now
 * @returns {number[]}
 */
export function portfolioPnl(portfolio, history, { day, days = 90, prices = {}, unsettled = 0 }) {
  const ledger = [...(portfolio?.ledger ?? [])].sort((a, b) => a.ts - b.ts);
  if (!ledger.length) return [];
  const first = Math.max(day - days + 1, dayOf(ledger[0].ts));
  if (first >= day) return [];

  const held = {};
  for (const lot of portfolio.lots ?? []) held[lot.assetId] = (held[lot.assetId] ?? 0) + lot.qty;
  let cash = (Number(portfolio.cash) || 0) + unsettled;
  let flows = 0;
  let at = ledger.length - 1;
  const value = {};
  const flowsTo = {};
  for (let d = day; d >= first; d--) {
    // Undo everything that happened after this day.
    while (at >= 0 && dayOf(ledger[at].ts) > d) {
      const entry = ledger[at];
      cash -= Number(entry.amount) || 0;
      if (entry.assetId) held[entry.assetId] = (held[entry.assetId] ?? 0) - heldChange(entry);
      if (FLOWS.has(entry.kind)) flows += Number(entry.amount) || 0;
      at -= 1;
    }
    // Today is worth what the prices say now, so the line ends on the account's figures.
    const priceOn = (id) => (d === day && prices[id] != null ? prices[id] : closeOn(history, id, d, prices[id] ?? 0));
    value[d] = cash + Object.entries(held).reduce((sum, [id, qty]) => sum + qty * priceOn(id), 0);
    flowsTo[d] = flows;
  }
  // Money moved in after a day made the account bigger, not better: count it back in.
  const series = [];
  for (let d = first; d <= day; d++) series.push(Math.round((value[d] + flowsTo[d] - value[first] - flowsTo[first]) * 100) / 100);
  return series;
}
