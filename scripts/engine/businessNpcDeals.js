/**
 * Player businesses: deals with NPC investors (X2c, DESIGN §36.20)
 * @file scripts/engine/businessNpcDeals.js
 * @description Two ways money and stakes move between players and NPCs. *An NPC buys in*: at a month's close an
 *              unlisted player business making a profit week after week may draw an offer from an investor contact,
 *              for new units or for one partner's whole stake. It waits for the GM ('held'), who offers it, perhaps
 *              changed, or drops it; offered, new units go to a majority vote and a stake to its holder alone, and it
 *              lapses after its days. The investor joins as a silent NPC partner. *A player buys from an NPC*: a
 *              partner offers for units an NPC holds (an investor, the receivers), or anyone offers for a block of a
 *              listed company's public shares (the market's). Each waits for the GM, who accepts, declines or
 *              counters; a counter is the buyer's to take or leave. A listed block's money and shares are the GM's
 *              service's (the portfolio); the rest is here. Pure.
 *
 * A deal: `{ id, status: 'held'|'offered', kind: 'units'|'stake', investor: {ref, name}, units, price, amount,
 *            sellerId?, sellerName?, drawnDay, offeredDay?, expires? }` on `b.npcDeal`.
 * An offer: `{ id, status: 'held'|'countered', buyerId, buyerName, sellerId, sellerName, units, price, day, expires?,
 *             listed? }` in `b.npcBids`.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail, text, clamp, partnerOf, voters, holders, totalUnits, unitValue } from './businessRecord.js';
import { createRng } from './rng.js';
import { isListed } from './businessListing.js';

const int = (v) => Math.floor(Number(v) || 0);
const cents = (v) => Math.round(Number(v) * 100) / 100;
const settings = (p) => p.npcDeals;

/** A partner may sell or be bought out: an active holder with units. */
const holding = (x) => x && ['active', 'leaving'].includes(x.status) && x.units > 0;

/** NPC holders a player may buy from in an unlisted business: investors and the receivers, never the market's float. */
export const npcSellers = (b) => holders(b).filter((x) => x.npc && !x.market && x.units > 0);

/** Whether a business can draw an investor's offer: open, a player's, not listed, and no deal under way. */
export function npcDealEligible(b, weekProfits, p = BUSINESS_DEFAULTS) {
  const d = settings(p);
  if (b.status !== 'open' || b.npcRun || b.npcDeal) return false;
  // Not listed, nor on its way to a listing.
  if (['awaiting', 'prospectus', 'ready', 'scheduled', 'listed'].includes(b.listing?.status)) return false;
  const recent = (weekProfits ?? []).slice(0, d.profitWeeks);
  return recent.length >= d.profitWeeks && recent.every((x) => x > 0);
}

/** The premium over book value good Reputation earns new units: none at 50 or under, `repPremium` at 100. */
export const unitsPremium = (reputation, p = BUSINESS_DEFAULTS) => settings(p).repPremium * clamp(((reputation ?? 50) - 50) / 50, 0, 1);

/**
 * New units an investor would take for `share` of the business after them, at book value with the premium.
 * @returns {{units: number, price: number, amount: number}|null}
 */
export function unitsTerms(b, share, p = BUSINESS_DEFAULTS) {
  const total = totalUnits(b);
  const value = unitValue(b);
  if (!(total > 0 && value > 0 && share > 0 && share < 1)) return null;
  const units = Math.max(1, Math.round((total * share) / (1 - share)));
  const price = Math.max(0.01, cents(value * (1 + unitsPremium(b.state?.reputation, p))));
  return { units, price, amount: Math.round(units * price) };
}

/** A partner's whole stake, at the stake premium over book value. */
export function stakeTerms(b, seller, p = BUSINESS_DEFAULTS) {
  const value = unitValue(b);
  if (!holding(seller) || !(value > 0)) return null;
  const price = Math.max(0.01, cents(value * (1 + settings(p).stakePremium)));
  return { units: seller.units, price, amount: Math.round(seller.units * price) };
}

/**
 * A month's close: perhaps an investor's offer, waiting for the GM as 'held'. `investors` are the GM's side's investor
 * contacts `[{ref, name}]` (an NPC's actor id, or `contact:<id>`). New units, or, with another voting partner left to
 * run it, one partner's whole stake.
 * @param {number[]} weekProfits - this week's profit first, then the weeks before
 * @returns {object|null} the deal drawn
 */
export function drawNpcDeal(b, investors, weekProfits, seed, day, p = BUSINESS_DEFAULTS) {
  if (!(investors ?? []).length || !npcDealEligible(b, weekProfits, p)) return null;
  const d = settings(p);
  const rng = createRng(seed, 'npc-deal', b.id, b.period?.index ?? 0);
  if (!rng.chance(d.chance)) return null;
  const investor = investors[rng.int(0, investors.length - 1)];
  const sellers = voters(b).length >= 2 ? voters(b).filter(holding) : [];
  const stake = sellers.length && rng.chance(0.5);
  const seller = stake ? sellers[rng.int(0, sellers.length - 1)] : null;
  const terms = seller ? stakeTerms(b, seller, p) : unitsTerms(b, d.share[0] + rng.next() * (d.share[1] - d.share[0]), p);
  if (!terms) return null;
  b.npcDeal = {
    id: `nd_${b.id.slice(-6)}_${day}`, status: 'held', kind: seller ? 'stake' : 'units', investor: { ref: String(investor.ref), name: text(investor.name, 60) },
    ...terms, ...(seller ? { sellerId: seller.actorId, sellerName: seller.name } : {}), drawnDay: day,
  };
  return b.npcDeal;
}

/**
 * The GM offers a drawn deal, with any changes: new units go to the partners' vote, a stake to its holder.
 * @param {{units?: number, price?: number, investor?: {ref: string, name: string}}} edits
 */
export function offerNpcDeal(b, edits, day, p = BUSINESS_DEFAULTS) {
  const deal = b.npcDeal;
  if (deal?.status !== 'held') return fail('no-deal');
  if (b.status !== 'open' || isListed(b)) return fail('not-open');
  const units = edits?.units != null && edits.units !== '' ? int(edits.units) : deal.units;
  const price = edits?.price != null && edits.price !== '' ? cents(edits.price) : deal.price;
  if (units < 1 || !(price > 0)) return fail('bad-amount');
  if (deal.kind === 'stake') {
    const seller = partnerOf(b, deal.sellerId);
    if (!holding(seller) || !seller.voting) return fail('not-for-sale');
    // A stake is the holder's whole holding, as it stands now.
    deal.units = seller.units;
  } else deal.units = units;
  if (edits?.investor?.ref) deal.investor = { ref: String(edits.investor.ref), name: text(edits.investor.name, 60) };
  deal.price = price;
  deal.amount = Math.round(deal.units * price);
  deal.status = 'offered';
  deal.offeredDay = day;
  deal.expires = day + settings(p).offerDays;
  if (deal.kind === 'units') b.proposals = [...b.proposals, { id: deal.id, kind: 'npcDeal', by: null, day, expires: deal.expires, votes: {}, terms: { dealId: deal.id } }];
  return { ok: true, deal };
}

/** The GM drops a drawn deal: nobody hears of it. */
export function dropNpcDeal(b) {
  if (b.npcDeal?.status !== 'held') return fail('no-deal');
  b.npcDeal = null;
  return { ok: true };
}

/** The investor's partner entry, new or the one they already have, as a silent NPC holder. */
function investorEntry(b, investor) {
  const actorId = `npc:${investor.ref}`;
  let x = partnerOf(b, actorId);
  if (!x) {
    x = { actorId, actorRef: investor.ref, npc: true, name: investor.name, status: 'active', cash: 0, gear: [], units: 0, voting: false, heirId: null, leavingSince: null };
    b.partners.push(x);
  }
  Object.assign(x, { status: 'active', voting: false });
  return x;
}

/** The partners voted new units through: the investor pays in and joins. */
export function enactNpcDeal(b, day, p = BUSINESS_DEFAULTS) {
  const deal = b.npcDeal;
  if (deal?.status !== 'offered' || deal.kind !== 'units') return fail('no-deal');
  const x = investorEntry(b, deal.investor);
  x.units += deal.units;
  x.cash += deal.amount;
  b.till += deal.amount;
  addLedger(b, { day, kind: 'investment', amount: deal.amount, name: deal.investor.name }, p);
  b.npcDeal = null;
  return { ok: true, deal };
}

/** The deal ends without a sale: turned down, voted down or out of time. */
export function endNpcDeal(b, id = null) {
  const deal = b.npcDeal;
  if (!deal || deal.status !== 'offered' || (id && deal.id !== id)) return null;
  b.npcDeal = null;
  return deal;
}

/**
 * The holder answers an investor's offer for their whole stake. Yes: their units go to the investor, the money to them,
 * and they leave the business.
 * @returns {{ok: true, amount?: number, sellerId?: string}|{ok: false, reason: string}}
 */
export function answerNpcStake(b, actorId, yes, day, p = BUSINESS_DEFAULTS) {
  const deal = b.npcDeal;
  if (deal?.status !== 'offered' || deal.kind !== 'stake' || deal.sellerId !== actorId) return fail('no-deal');
  if (!yes) {
    b.npcDeal = null;
    return { ok: true };
  }
  const seller = partnerOf(b, actorId);
  if (!holding(seller)) return fail('not-for-sale');
  if (voters(b).filter((x) => x !== seller).length < 1) return fail('only-partner');
  const amount = Math.round(seller.units * deal.price);
  const x = investorEntry(b, deal.investor);
  x.units += seller.units;
  seller.units = 0;
  seller.status = 'left';
  addLedger(b, { day, kind: 'npcStake', amount: 0, sellerId: seller.actorId, name: deal.investor.name, price: amount }, p);
  b.npcDeal = null;
  return { ok: true, amount, sellerId: actorId };
}

// ── A player buys from an NPC ────────────────────────────────────────────────

export const bidsOf = (b) => b.npcBids ?? [];
export const bidOf = (b, id) => bidsOf(b).find((x) => x.id === id) ?? null;

/**
 * Whether a partner may offer for an NPC holder's units in an unlisted business: an active partner with a vote, the
 * holder an NPC's (an investor or the receivers) with that many units, and no offer of theirs already waiting for it.
 */
export function bidCheck(b, buyerId, { sellerId, units, price }) {
  if (b.status !== 'open') return fail('not-open');
  if (isListed(b)) return fail('listed');
  const me = partnerOf(b, buyerId);
  if (me?.status !== 'active' || !me.voting) return fail('not-partner');
  const seller = npcSellers(b).find((x) => x.actorId === sellerId);
  if (!seller) return fail('not-for-sale');
  const n = int(units);
  const each = cents(price);
  if (n < 1 || n > seller.units || !(each > 0)) return fail('bad-amount');
  if (bidsOf(b).some((x) => x.buyerId === buyerId && x.sellerId === sellerId)) return fail('bid-waiting');
  return { ok: true, seller, units: n, price: each, amount: Math.round(n * each) };
}

/** A partner's offer, for the GM to answer. */
export function placeBid(b, buyer, request, day) {
  const can = bidCheck(b, buyer.id, request);
  if (!can.ok) return can;
  if (can.amount > (buyer.wealth ?? 0)) return fail('insufficient-funds');
  const bid = {
    id: String(request.key ?? `bid_${day}_${bidsOf(b).length}`), status: 'held', buyerId: buyer.id, buyerName: text(buyer.name, 60),
    sellerId: can.seller.actorId, sellerName: can.seller.creditors ? '' : text(can.seller.name, 60), units: can.units, price: can.price, day,
  };
  b.npcBids = [...bidsOf(b), bid];
  return { ok: true, bid };
}

/**
 * The units change hands at the offer's price: from the NPC holder to the buyer, who pays the price (to nobody's sheet:
 * an NPC's money is off-sheet). A holder left with none leaves the table.
 * @returns {{ok: true, amount: number}|{ok: false, reason: string}}
 */
export function settleBid(b, bid, wealth, day, p = BUSINESS_DEFAULTS) {
  const seller = npcSellers(b).find((x) => x.actorId === bid.sellerId);
  const buyer = partnerOf(b, bid.buyerId);
  if (!seller || seller.units < bid.units) return fail('not-for-sale');
  if (buyer?.status !== 'active' || !buyer.voting) return fail('not-partner');
  const amount = Math.round(bid.units * bid.price);
  if (amount > wealth) return fail('insufficient-funds');
  seller.units -= bid.units;
  if (seller.units <= 0) seller.status = 'left';
  buyer.units += bid.units;
  addLedger(b, { day, kind: 'npcBought', amount: 0, actorId: buyer.actorId, sellerId: seller.actorId, count: bid.units, price: amount }, p);
  b.npcBids = bidsOf(b).filter((x) => x.id !== bid.id);
  return { ok: true, amount };
}

/**
 * The GM's answer to an offer: 'accept' (with the buyer's wealth, for an unlisted one), 'decline', or 'counter' at a
 * new price each, which the buyer takes or leaves within the offer days. A listed block's acceptance is the service's.
 */
export function answerBid(b, id, { answer, price, wealth = 0 }, day, p = BUSINESS_DEFAULTS) {
  const bid = bidOf(b, id);
  if (bid?.status !== 'held') return fail('no-bid');
  if (answer === 'decline') {
    b.npcBids = bidsOf(b).filter((x) => x !== bid);
    return { ok: true, bid };
  }
  if (answer === 'counter') {
    const each = cents(price);
    if (!(each > 0) || each === bid.price) return fail('bad-amount');
    Object.assign(bid, { status: 'countered', price: each, expires: day + settings(p).offerDays });
    return { ok: true, bid };
  }
  if (answer !== 'accept' || bid.listed) return fail('bad-request');
  const done = settleBid(b, bid, wealth, day, p);
  return done.ok ? { ...done, bid } : done;
}

/** The buyer takes or leaves the GM's counter on an unlisted offer. */
export function answerCounter(b, buyer, id, yes, day, p = BUSINESS_DEFAULTS) {
  const bid = bidOf(b, id);
  if (bid?.status !== 'countered' || bid.buyerId !== buyer.id || bid.listed) return fail('no-bid');
  if (!yes) {
    b.npcBids = bidsOf(b).filter((x) => x !== bid);
    return { ok: true, bid };
  }
  const done = settleBid(b, bid, buyer.wealth ?? 0, day, p);
  return done.ok ? { ...done, bid } : done;
}

// ── A block of a listed company's public shares ──────────────────────────────

/** The most a block may be: a share of the company's shares, and no more than the market holds. */
export function blockMost(b, p = BUSINESS_DEFAULTS) {
  const market = b.partners.find((x) => x.market);
  return Math.max(0, Math.min(Math.floor((b.listing?.shares ?? totalUnits(b)) * settings(p).block.maxShare), market?.units ?? 0));
}

/** The least a block's price may be: the market price and the premium. */
export const blockLeast = (marketPrice, p = BUSINESS_DEFAULTS) => Math.ceil(marketPrice * (1 + settings(p).block.minPremium) * 100) / 100;

/**
 * Whether anyone may offer for a block of a listed company's public shares: within the size, at the premium, with the
 * brokerage cash for it, and not within a week of their last offer for this company.
 */
export function blockCheck(b, buyerId, { units, price, marketPrice, cash, day }, p = BUSINESS_DEFAULTS) {
  if (!isListed(b) || b.status !== 'open') return fail('not-listed');
  const n = int(units);
  const each = cents(price);
  if (n < 1 || !(each > 0)) return fail('bad-amount');
  if (n > blockMost(b, p)) return fail('block-size');
  if (each < blockLeast(marketPrice, p)) return fail('block-price');
  const last = b.blockDays?.[buyerId];
  if (last != null && day - last < settings(p).block.everyDays) return fail('block-week');
  if (bidsOf(b).some((x) => x.buyerId === buyerId)) return fail('bid-waiting');
  const amount = Math.round(n * each);
  if (amount > (cash ?? 0)) return fail('insufficient-funds');
  return { ok: true, units: n, price: each, amount };
}

/** An offer for a block, for the GM to answer. */
export function placeBlock(b, buyer, request, terms, day) {
  const market = b.partners.find((x) => x.market);
  const bid = {
    id: String(request.key ?? `blk_${day}_${bidsOf(b).length}`), status: 'held', buyerId: buyer.id, buyerName: text(buyer.name, 60),
    sellerId: market?.actorId ?? 'npc:market', sellerName: '', units: terms.units, price: terms.price, day, listed: true,
  };
  b.npcBids = [...bidsOf(b), bid];
  b.blockDays = { ...(b.blockDays ?? {}), [buyer.id]: day };
  return { ok: true, bid };
}

/** A block bought: off the record's waiting offers (the shares go into the portfolio; the market's holding follows them). */
export function closeBlock(b, id, day, amount, p = BUSINESS_DEFAULTS) {
  const bid = bidOf(b, id);
  if (!bid?.listed) return fail('no-bid');
  b.npcBids = bidsOf(b).filter((x) => x !== bid);
  addLedger(b, { day, kind: 'blockSold', amount: 0, name: bid.buyerName, count: bid.units, price: amount }, p);
  return { ok: true, bid };
}

/** Counters and offered deals whose days have run out. @returns {object[]} what lapsed, as events */
export function lapseNpcDeals(b, day) {
  const events = [];
  if (b.npcDeal?.status === 'offered' && b.npcDeal.kind === 'stake' && day > b.npcDeal.expires) {
    events.push({ type: 'npcDealLapsed', dealId: b.npcDeal.id });
    b.npcDeal = null;
  }
  const gone = bidsOf(b).filter((x) => x.status === 'countered' && day > x.expires);
  if (gone.length) {
    b.npcBids = bidsOf(b).filter((x) => !gone.includes(x));
    events.push(...gone.map((x) => ({ type: 'bidLapsed', bidId: x.id, buyerId: x.buyerId })));
  }
  return events;
}
