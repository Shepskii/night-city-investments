/**
 * A company's capital (B6a)
 * @file scripts/engine/businessCapital.js
 * @description New shares and buybacks for a chartered company, each voted by a majority of the shares.
 *              A private company offers new shares to its holders at book value (a rights issue), and
 *              buys units back at book value from holders who want to sell (a tender). A listed company
 *              sells new shares through the market (a secondary offering) and buys its own shares back
 *              from the market's float (a market buyback); both take an officer's roll first. Pure.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail, totalUnits, unitValue, partnerOf } from './businessRecord.js';
import { isListed } from './businessListing.js';
import { bandPassed, dvOf } from './rolls.js';

const int = (v) => Math.floor(Number(v) || 0);
const cents = (v) => Math.round(v * 100) / 100;
/** A listing under way stops new shares and buybacks until it is done. */
const LISTING_BUSY = ['awaiting', 'prospectus', 'ready', 'scheduled'];

/** The capital record, empty when nothing is under way. */
export const capitalOf = (b) => b.capital ?? { issue: null, buyback: null };

/** The sizes of a new issue the shareholders may vote, as a share of the shares there are now. */
export function issueOptions(p = BUSINESS_DEFAULTS) {
  const c = p.capital.issue;
  const out = [];
  for (let x = c.minPct; x <= c.maxPct + 1e-9; x += c.step) out.push(Math.round(x * 100) / 100);
  return out;
}

function companyCheck(b) {
  if (b.stage !== 2 || b.status !== 'open') return fail('not-company');
  if (LISTING_BUSY.includes(b.listing?.status)) return fail('listing-open');
  return { ok: true };
}

/**
 * Whether new shares can be proposed, and their terms: how many, and for a private company the book
 * value per share they are offered at (a listed company's price comes from its offering roll).
 */
export function issueOffer(b, pct, p = BUSINESS_DEFAULTS) {
  const can = companyCheck(b);
  if (!can.ok) return can;
  if (capitalOf(b).issue) return fail('issue-open');
  const share = Math.round(Number(pct) * 100) / 100;
  if (!issueOptions(p).includes(share)) return fail('bad-issue');
  const shares = Math.max(1, Math.round(totalUnits(b) * share));
  if (isListed(b)) return { ok: true, terms: { pct: share, shares } };
  const price = cents(unitValue(b));
  if (price <= 0) return fail('no-value');
  return { ok: true, terms: { pct: share, shares, price } };
}

/**
 * The shareholders voted new shares. A private company's holders may each take their share of them
 * (by the shares they hold now) in the window; a listed company's offering waits for an officer's roll.
 */
export function startIssue(b, terms, day, p = BUSINESS_DEFAULTS) {
  const c = p.capital.issue;
  b.capital = capitalOf(b);
  if (isListed(b)) {
    b.capital.issue = { kind: 'offering', status: 'roll', shares: terms.shares, startDay: day };
  } else {
    const total = totalUnits(b);
    const entitlements = {};
    for (const x of b.partners.filter((y) => y.status === 'active' && !y.npc && y.units > 0)) {
      entitlements[x.actorId] = Math.floor((terms.shares * x.units) / total);
    }
    b.capital.issue = { kind: 'rights', shares: terms.shares, price: terms.price, startDay: day, endDay: day + c.windowDays, entitlements, taken: {} };
  }
  addLedger(b, { day, kind: 'issueOpened', amount: 0 }, p);
  return { ok: true };
}

/** How many of a rights issue's shares this holder may still take. */
export function rightsLeft(b, actorId) {
  const issue = capitalOf(b).issue;
  if (issue?.kind !== 'rights') return 0;
  return Math.max(0, (issue.entitlements[actorId] ?? 0) - (issue.taken[actorId] ?? 0));
}

/**
 * A holder takes up some of their rights: they pay book value for each share, which goes into the
 * company's cash, and hold the new shares at once.
 * @returns {{ok: true, cost: number} | {ok: false, reason: string}}
 */
export function takeRights(b, actor, qty, day, p = BUSINESS_DEFAULTS) {
  const issue = capitalOf(b).issue;
  if (issue?.kind !== 'rights' || day > issue.endDay) return fail('no-issue');
  const me = partnerOf(b, actor.id);
  if (me?.status !== 'active') return fail('not-partner');
  const n = int(qty);
  if (n < 1 || n > rightsLeft(b, actor.id)) return fail('bad-qty');
  const cost = Math.round(n * issue.price);
  if (cost > actor.wealth) return fail('insufficient-funds');
  me.units += n;
  b.till += cost;
  issue.taken[actor.id] = (issue.taken[actor.id] ?? 0) + n;
  addLedger(b, { day, kind: 'rightsTaken', amount: cost, actorId: actor.id }, p);
  return { ok: true, cost };
}

/** Whether a buyback can be proposed: a budget the company's cash covers now. */
export function buybackOffer(b, budget, p = BUSINESS_DEFAULTS) {
  const can = companyCheck(b);
  if (!can.ok) return can;
  if (capitalOf(b).buyback) return fail('buyback-open');
  const amount = int(budget);
  if (amount < p.capital.buyback.minBudget) return fail('bad-amount');
  if (amount > b.till) return fail('no-funds');
  if (isListed(b)) return { ok: true, terms: { budget: amount } };
  const price = cents(unitValue(b));
  if (price <= 0) return fail('no-value');
  return { ok: true, terms: { budget: amount, price } };
}

/**
 * The shareholders voted a buyback. A private company buys at book value from any holder who sells in
 * the window; a listed company's officer times it first, then it buys from the market day by day.
 */
export function startBuyback(b, terms, day, p = BUSINESS_DEFAULTS) {
  b.capital = capitalOf(b);
  b.capital.buyback = isListed(b)
    ? { kind: 'market', status: 'roll', budget: terms.budget, spent: 0, bought: 0, startDay: day }
    : { kind: 'tender', budget: terms.budget, price: terms.price, spent: 0, bought: 0, startDay: day, endDay: day + p.capital.buyback.windowDays };
  addLedger(b, { day, kind: 'buybackOpened', amount: 0 }, p);
  return { ok: true };
}

/** How many units a tender can still buy, by what is left of the budget and the cash. */
export function tenderRoom(b) {
  const bb = capitalOf(b).buyback;
  if (bb?.kind !== 'tender' || !(bb.price > 0)) return 0;
  return Math.floor(Math.min(bb.budget - bb.spent, Math.max(0, b.till)) / bb.price);
}

/**
 * A holder sells units back in a tender: paid book value from the company's cash, the units retired.
 * Someone must still hold shares afterwards.
 * @returns {{ok: true, cash: number} | {ok: false, reason: string}}
 */
export function sellBack(b, actor, qty, day, p = BUSINESS_DEFAULTS) {
  const bb = capitalOf(b).buyback;
  if (bb?.kind !== 'tender' || day > bb.endDay) return fail('no-buyback');
  const me = partnerOf(b, actor.id);
  if (!me || !['active', 'leaving'].includes(me.status)) return fail('not-partner');
  const n = int(qty);
  if (n < 1 || n > me.units) return fail('bad-qty');
  if (n > tenderRoom(b)) return fail('over-budget');
  if (totalUnits(b) - n <= 0) return fail('last-holder');
  const cash = Math.round(n * bb.price);
  me.units -= n;
  if (me.units === 0) me.status = 'left';
  b.till -= cash;
  bb.spent += cash;
  bb.bought += n;
  addLedger(b, { day, kind: 'soldBack', amount: -cash, actorId: actor.id }, p);
  return { ok: true, cash };
}

/** Close a rights issue or a tender whose window has ended. Returns whether anything closed. */
export function closeCapital(b, day, p = BUSINESS_DEFAULTS) {
  const c = capitalOf(b);
  let changed = false;
  if (c.issue?.kind === 'rights' && day > c.issue.endDay) {
    const taken = Object.values(c.issue.taken).reduce((a, n) => a + n, 0);
    addLedger(b, { day, kind: 'issueClosed', amount: 0, price: taken }, p);
    c.issue = null;
    changed = true;
  }
  if (c.buyback?.kind === 'tender' && day > c.buyback.endDay) {
    addLedger(b, { day, kind: 'buybackClosed', amount: 0, price: c.buyback.bought }, p);
    c.buyback = null;
    changed = true;
  }
  if (changed) b.capital = c;
  return changed;
}

// ── A listed company (B6a) ───────────────────────────────────────────────────

/**
 * Whether an officer can roll for a listed company's offering (`issue`) or buyback (`buyback`) now,
 * and how: the offering is Trading (Persuasion at DV +2), the timing Trading (Business at DV +2).
 */
export function capitalRollCheck(b, kind, p = BUSINESS_DEFAULTS) {
  if (!isListed(b)) return fail('not-listed');
  const rec = capitalOf(b)[kind];
  if (rec?.status !== 'roll') return fail(kind === 'issue' ? 'no-issue' : 'no-buyback');
  const c = kind === 'issue' ? p.capital.offering : p.capital.timing;
  return { ok: true, dv: dvOf(c.dv), uses: [...c.uses] };
}

/**
 * The offering roll. A pass opens the offering on the market: the new shares at the market price less a
 * discount by the result, for anyone to subscribe for in the window. A failure pulls it.
 * @returns {{failed: boolean}}
 */
export function applyOfferingRoll(b, actorId, result, { day, price }, p = BUSINESS_DEFAULTS) {
  const c = p.capital.offering;
  const issue = capitalOf(b).issue;
  if (!bandPassed(result.band)) {
    b.capital.issue = null;
    addLedger(b, { day, kind: 'offeringFailed', amount: 0 }, p);
    return { failed: true };
  }
  const discount = c.discount[result.band] ?? 0;
  Object.assign(issue, { status: 'open', band: result.band, by: actorId, discount, price: Math.max(0.01, cents(price * (1 - discount))), endDay: day + c.windowDays });
  addLedger(b, { day, kind: 'offeringSet', amount: 0 }, p);
  return { failed: false };
}

/** The timing roll: the buyback starts, paying the market price adjusted by the result. */
export function applyTimingRoll(b, actorId, result, day, p = BUSINESS_DEFAULTS) {
  const bb = capitalOf(b).buyback;
  Object.assign(bb, { status: 'buying', band: result.band, by: actorId, adj: p.capital.timing.price[result.band] ?? 0 });
  addLedger(b, { day, kind: 'buybackTimed', amount: 0 }, p);
  return { ok: true };
}

/**
 * One market day of a listed company's buyback: it buys from the market's float, at most `cap` shares,
 * at the market price adjusted by its timing, while the budget and the cash last; the shares are
 * retired. It ends when the budget, the cash or the float runs out.
 * @returns {{qty: number, cost: number, done: boolean}}
 */
export function buybackDay(b, { price, cap, day }, p = BUSINESS_DEFAULTS) {
  const bb = capitalOf(b).buyback;
  if (bb?.kind !== 'market' || bb.status !== 'buying' || bb.lastDay === day || !(price > 0)) return { qty: 0, cost: 0, done: false };
  const market = b.partners.find((x) => x.market);
  const unit = Math.max(0.01, cents(price * (1 + (bb.adj ?? 0))));
  const affordable = Math.floor(Math.min(bb.budget - bb.spent, Math.max(0, b.till)) / unit);
  const qty = Math.max(0, Math.min(Math.floor(cap), market?.units ?? 0, affordable));
  let cost = 0;
  if (qty > 0) {
    cost = Math.round(qty * unit);
    market.units -= qty;
    b.listing.shares -= qty;
    b.till -= cost;
    bb.spent += cost;
    bb.bought += qty;
    addLedger(b, { day, kind: 'boughtBack', amount: -cost, price: qty }, p);
  }
  bb.lastDay = day;
  const done = qty === 0 || (market?.units ?? 0) === 0 || Math.min(bb.budget - bb.spent, b.till) < unit;
  if (done) {
    addLedger(b, { day, kind: 'buybackClosed', amount: 0, price: bb.bought }, p);
    b.capital.buyback = null;
  }
  return { qty, cost, done };
}

/**
 * The offering's window has closed: all the new shares are sold at the offer price, to the players who
 * subscribed (their shares are in their portfolios already) and the market for the rest, and the
 * company's cash takes the whole sum. The shareholders are read from the portfolios again after.
 * @returns {{ok: true, shares: number, proceeds: number} | {ok: false, reason: string}}
 */
export function settleOffering(b, day, p = BUSINESS_DEFAULTS) {
  const issue = capitalOf(b).issue;
  if (issue?.kind !== 'offering' || issue.status !== 'open') return fail('no-issue');
  const proceeds = Math.round(issue.shares * issue.price);
  b.listing.shares = (b.listing.shares ?? totalUnits(b)) + issue.shares;
  const market = b.partners.find((x) => x.market);
  if (market) market.units += issue.shares;
  b.till += proceeds;
  addLedger(b, { day, kind: 'offeringProceeds', amount: proceeds }, p);
  b.capital.issue = null;
  return { ok: true, shares: issue.shares, proceeds };
}
