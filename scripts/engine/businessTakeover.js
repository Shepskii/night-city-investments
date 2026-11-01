/**
 * Takeovers (B6b)
 * @file scripts/engine/businessTakeover.js
 * @description A tender offer for a chartered player company, private or listed, by any character or
 *              syndicate. The GM approves the offer first; then the whole offer is held from the
 *              bidder's brokerage balance and it is open for `takeover.days`. Player holders tender
 *              shares or not; NPC holders and the market's float accept by the premium over the
 *              reference price (the market price, or book value for a private company), which the
 *              target's officers can talk up or down with one defence roll. At the close the bidder
 *              buys what was tendered, at most the shares offered for (pro rata if more came in).
 *              Holders who did not tender keep their shares. Pure.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail, totalUnits, unitValue, partnerOf } from './businessRecord.js';
import { isListed } from './businessListing.js';
import { bandPassed, dvOf } from './rolls.js';

const int = (v) => Math.floor(Number(v) || 0);
const cents = (v) => Math.round(v * 100) / 100;
const LISTING_BUSY = ['awaiting', 'prospectus', 'ready', 'scheduled'];

/** The shares an account holds on the company's record (a listed company's follow the portfolios). */
const heldBy = (b, actorId) => {
  const me = partnerOf(b, actorId);
  return me && ['active', 'leaving'].includes(me.status) ? me.units : 0;
};

/** The price a premium is measured against: the market price, or book value per share when private. */
export function takeoverReference(b, marketPrice = 0) {
  return isListed(b) ? Math.max(0, Number(marketPrice) || 0) : cents(unitValue(b));
}

/**
 * Whether this bidder can bid for the company: a chartered company, open, not listing, with no other
 * offer open; a price per share and a number of shares up to all the bidder does not hold already.
 */
export function takeoverOffer(b, bidderId, { price, shares }) {
  if (b.stage !== 2 || b.status !== 'open') return fail('not-company');
  if (LISTING_BUSY.includes(b.listing?.status)) return fail('listing-open');
  if (b.takeover) return fail('takeover-open');
  const each = cents(Number(price));
  if (!(each > 0)) return fail('bad-price');
  const n = int(shares);
  const room = totalUnits(b) - heldBy(b, bidderId);
  if (n < 1 || n > room) return fail('bad-qty');
  return { ok: true, terms: { price: each, shares: n } };
}

/** The bid is made: it waits for the GM. */
export function makeTakeover(b, bidder, terms, day, p = BUSINESS_DEFAULTS) {
  b.takeover = { status: 'awaiting', bidderId: bidder.id, bidderName: bidder.name, price: terms.price, shares: terms.shares, madeDay: day, tenders: {}, defence: null };
  addLedger(b, { day, kind: 'takeoverBid', amount: 0, actorId: bidder.id }, p);
  return { ok: true };
}

/**
 * The GM approves the offer: it opens for its days, priced against the reference now. The service holds
 * the escrow (the price times the shares) from the bidder's brokerage balance first.
 */
export function openTakeover(b, { day, reference }, p = BUSINESS_DEFAULTS) {
  const t = b.takeover;
  if (t?.status !== 'awaiting') return fail('no-takeover');
  Object.assign(t, { status: 'open', openDay: day, endDay: day + p.takeover.days, reference: cents(reference), escrow: Math.round(t.price * t.shares) });
  addLedger(b, { day, kind: 'takeoverOpen', amount: 0, actorId: t.bidderId }, p);
  return { ok: true };
}

/** The GM turns the offer down, or it could not be paid for. */
export function dropTakeover(b, day, reason = 'rejected', p = BUSINESS_DEFAULTS) {
  if (!b.takeover) return fail('no-takeover');
  addLedger(b, { day, kind: 'takeoverDropped', amount: 0, actorId: b.takeover.bidderId }, p);
  b.takeover = null;
  return { ok: true, reason };
}

/**
 * A holder tenders shares to an open offer (or changes their mind: 0 withdraws). The bidder cannot
 * tender to themselves. A listed company's tendered shares must still be free to sell at the close.
 */
export function tenderShares(b, actorId, qty, day) {
  const t = b.takeover;
  if (t?.status !== 'open' || day > t.endDay) return fail('no-takeover');
  if (actorId === t.bidderId) return fail('own-offer');
  const held = heldBy(b, actorId);
  if (!held) return fail('not-partner');
  const n = int(qty);
  if (n < 0 || n > held) return fail('bad-qty');
  if (n === 0) delete t.tenders[actorId];
  else t.tenders[actorId] = n;
  return { ok: true, qty: n };
}

/** Whether an officer can make the defence roll now: once per offer, while it is open. */
export function defenceCheck(b, p = BUSINESS_DEFAULTS) {
  const t = b.takeover;
  if (t?.status !== 'open') return fail('no-takeover');
  if (t.defence) return fail('defence-done');
  return { ok: true, dv: dvOf(p.takeover.defence.dv), uses: [...p.takeover.defence.uses] };
}

/** Record the defence roll: it moves the premium NPC holders and the float want. */
export function applyDefence(b, actorId, result, day, p = BUSINESS_DEFAULTS) {
  const shift = p.takeover.defence.shift[result.band] ?? 0;
  b.takeover.defence = { band: result.band, by: actorId, day, shift, passed: bandPassed(result.band) };
  addLedger(b, { day, kind: 'takeoverDefence', amount: 0, actorId }, p);
  return { ok: true, shift };
}

/** The premium the offer pays over its reference, as a fraction (0.25 is 25%). */
export const takeoverPremium = (t) => (t?.reference > 0 ? t.price / t.reference - 1 : 0);

/** How much of their shares NPC holders and the market's float tender: all, half or none, by the premium. */
export function npcAcceptance(t, p = BUSINESS_DEFAULTS) {
  const a = p.takeover.accept;
  const shift = t.defence?.shift ?? 0;
  const premium = takeoverPremium(t);
  if (premium >= a.all + shift) return 1;
  if (premium >= a.half + shift) return 0.5;
  return 0;
}

/**
 * Close an offer whose time is up. What each holder tendered (a player's capped by what they hold and,
 * for a listed company, can still sell; NPCs' and the float's by the premium) is bought at the price,
 * scaled down pro rata if it comes to more than the shares offered for. On a private company the shares
 * move on the record here; on a listed one the service moves them between portfolios and the record is
 * read from those afterwards (NPC holders' shares, kept on the record, move here either way).
 * @param {Object<string, number>|null} [sellable] - a listed company's holders' free shares now
 * @param {Object<string, number>|null} [held] - a listed company's holders' shares now, locked or not
 * @returns {{ok: true, transfers: {actorId: string, qty: number, cash: number, npc: boolean, market: boolean}[], acquired: number, spent: number, refund: number, bidderId: string, control: boolean}}
 */
export function settleTakeover(b, { day, sellable = null, held = null }, p = BUSINESS_DEFAULTS) {
  const t = b.takeover;
  if (t?.status !== 'open') return fail('no-takeover');
  const listed = isListed(b);
  const share = npcAcceptance(t, p);
  const asked = [];
  for (const x of b.partners.filter((y) => ['active', 'leaving'].includes(y.status) && y.units > 0 && y.actorId !== t.bidderId)) {
    let qty;
    if (x.npc || x.market) qty = Math.floor(x.units * share);
    else qty = Math.min(t.tenders[x.actorId] ?? 0, x.units, sellable ? Math.max(0, sellable[x.actorId] ?? 0) : Infinity);
    if (qty > 0) asked.push({ x, qty });
  }
  const offered = asked.reduce((a, r) => a + r.qty, 0);
  const scale = offered > t.shares ? t.shares / offered : 1;
  const parts = asked.map(({ x, qty }) => ({ x, exact: qty * scale, n: Math.floor(qty * scale) }));
  // Scaled down, the shares lost to rounding go to the largest remainders, so a full offer buys all it asked for.
  if (scale < 1) {
    let left = t.shares - parts.reduce((a, r) => a + r.n, 0);
    for (const r of [...parts].sort((a, c) => (c.exact - c.n) - (a.exact - a.n))) {
      if (left <= 0) break;
      r.n += 1;
      left -= 1;
    }
  }
  const transfers = parts.map(({ x, n }) => ({ actorId: x.actorId, qty: n, cash: Math.round(n * t.price), npc: !!x.npc && !x.market, market: !!x.market }))
    .filter((r) => r.qty > 0);
  const acquired = transfers.reduce((a, r) => a + r.qty, 0);
  const spent = transfers.reduce((a, r) => a + r.cash, 0);

  // Shares kept on the record move here: everything on a private company, NPC holders' on a listed one.
  for (const r of transfers) {
    if (listed && !r.npc) continue;
    const x = partnerOf(b, r.actorId);
    x.units -= r.qty;
    if (x.units === 0 && !x.market) x.status = 'left';
  }
  if (!listed && acquired > 0) {
    const bidder = partnerOf(b, t.bidderId);
    if (bidder && ['active', 'leaving'].includes(bidder.status)) bidder.units += acquired;
    else if (bidder) Object.assign(bidder, { status: 'active', units: acquired, voting: true });
    else b.partners.push({ actorId: t.bidderId, name: t.bidderName, status: 'active', cash: 0, gear: [], units: acquired, voting: true, heirId: null, leavingSince: null });
  }
  const total = listed ? (b.listing.shares ?? totalUnits(b)) : totalUnits(b);
  // A listed company's bidder holds what is in their portfolio, plus what they bought.
  const after = listed ? (held?.[t.bidderId] ?? 0) + acquired : heldBy(b, t.bidderId);
  const control = total > 0 && after / total > 0.5;
  b.lastTakeover = { bidderId: t.bidderId, bidderName: t.bidderName, price: t.price, acquired, spent, closedDay: day, control };
  addLedger(b, { day, kind: 'takeoverClosed', amount: 0, actorId: t.bidderId, price: acquired }, p);
  const refund = Math.max(0, (t.escrow ?? 0) - spent);
  b.takeover = null;
  return { ok: true, transfers, acquired, spent, refund, bidderId: t.bidderId, control };
}
