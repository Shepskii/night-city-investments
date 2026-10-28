/**
 * Dividends
 * @file scripts/engine/dividends.js
 * @description Schedule and payout maths. Dates are plain { year, month (1-12), day } objects
 *              taken from the in-world calendar. No Foundry globals.
 */

import { normalizePortfolio, PAID_CAP } from './portfolioModel.js';
import { dayOf } from './clock.js';

const pad = (n) => String(n).padStart(2, '0');

const PERIODS_PER_YEAR = { monthly: 12, quarterly: 4, annual: 1 };

/** Annualised dividend yield of a company at a price, as a fraction (0.04 is 4%). */
export function annualYield(company, price) {
  const d = company?.dividend;
  if (!d || d.policy === 'none' || !(price > 0) || company.status !== 'active') return 0;
  const periods = PERIODS_PER_YEAR[d.frequency] ?? 1;
  return d.policy === 'yield' ? (d.yield ?? 0) : ((d.perShare ?? 0) * periods) / price;
}

/** Identifier of the dividend period a date falls in, e.g. "2045-03", "2045-Q1", "2045". */
export function periodKey(frequency, { year, month }) {
  switch (frequency) {
    case 'monthly': return `${year}-${pad(month)}`;
    case 'quarterly': return `${year}-Q${Math.ceil(month / 3)}`;
    default: return `${year}`;
  }
}

/** First month (1-12) of the period containing `month`. */
function periodStartMonth(frequency, month) {
  if (frequency === 'monthly') return month;
  if (frequency === 'quarterly') return Math.floor((month - 1) / 3) * 3 + 1;
  return 1;
}

/**
 * Is a dividend payable for this company on this date?
 * Fires at most once per period; a skipped payout day is paid on the next check (catch-up).
 * @param {object} company - { status, dividend: { policy, frequency, payoutDay } }
 * @param {{year: number, month: number, day: number}} date
 * @param {string|null} lastKey - the last period key already paid
 * @returns {{due: boolean, key?: string}}
 */
export function dividendDue(company, date, lastKey = null) {
  const d = company.dividend;
  if (!d || d.policy === 'none' || company.status !== 'active') return { due: false };
  const key = periodKey(d.frequency, date);
  if (key === lastKey) return { due: false };
  const start = periodStartMonth(d.frequency, date.month);
  const reached = date.month > start || date.day >= (d.payoutDay ?? 1);
  return reached ? { due: true, key } : { due: false };
}

/** Dividend per share for one period, rounded to 2 decimals. */
export function dividendPerShare(company, price) {
  const d = company.dividend;
  if (!d || d.policy === 'none') return 0;
  const value = d.policy === 'yield'
    ? (price * (d.yield ?? 0)) / (PERIODS_PER_YEAR[d.frequency] ?? 1)
    : (d.perShare ?? 0);
  return Math.round(value * 100) / 100;
}

/** Cash payout for a holding, in whole eb. */
export function payoutFor(qty, perShare) {
  return Math.round(qty * perShare);
}

/** Reinvest a payout as whole shares; the remainder stays as cash. */
export function reinvest(amount, price) {
  const shares = Math.floor(amount / price);
  return { shares, spent: Math.round(shares * price), remainder: amount - Math.round(shares * price) };
}

/**
 * Pay one dividend into a portfolio. Pure and idempotent: a (company, period) pair is paid once.
 * Only shares held BEFORE the declaration tick qualify, so buying just ahead of a payout earns nothing.
 * If the holder switched on reinvestment for the asset, the payout buys whole shares at `price`.
 *
 * @param {object} o
 * @param {object} o.portfolio
 * @param {string} o.assetId
 * @param {number} o.perShare
 * @param {string} o.key - period key, or a unique key for a special dividend
 * @param {number} o.price - current share price (for reinvestment)
 * @param {number} o.tick - the declaration tick
 * @returns {{portfolio: object, paid: boolean, payout: number}}
 */
export function payDividend({ portfolio, assetId, perShare, key, price, tick }) {
  const p = normalizePortfolio(portfolio);
  const paidKey = `${assetId}:${key}`;
  if (p.paid.includes(paidKey)) return { portfolio: p, paid: false, payout: 0 };

  const marked = { ...p, paid: [...p.paid, paidKey].slice(-PAID_CAP) };
  const eligible = p.lots
    .filter((l) => l.assetId === assetId && (l.acquiredTick ?? 0) < dayOf(tick))
    .reduce((sum, l) => sum + l.qty, 0);
  const payout = payoutFor(eligible, perShare);
  if (eligible === 0 || payout <= 0) return { portfolio: marked, paid: false, payout: 0 };

  const ledger = [...marked.ledger, { ts: tick, kind: 'dividend', assetId, qty: eligible, amount: payout, ref: key }];
  let cash = marked.cash + payout;
  let lots = marked.lots;

  if (marked.drip[assetId] && price > 0) {
    const re = reinvest(payout, price);
    if (re.shares > 0) {
      lots = [...lots, {
        id: `lot_div_${assetId}_${key}`, assetType: 'stock', assetId, qty: re.shares, unitCost: price, acquiredTick: tick, drip: true,
      }];
      cash -= re.spent;
      ledger.push({ ts: tick, kind: 'drip', assetId, qty: re.shares, amount: -re.spent, ref: key });
    }
  }

  return {
    portfolio: { ...marked, cash, lots, ledger, stats: { ...marked.stats, dividends: marked.stats.dividends + payout } },
    paid: true,
    payout,
  };
}
