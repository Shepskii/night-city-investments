/**
 * Player businesses: back rooms and dirty cash (U1a)
 * @file scripts/engine/businessFronts.js
 * @description A business can run an illegal operation behind the shop. Its takings go to a pot of dirty cash,
 *              off the books: out of the cash, the book value and the reports. Laundering moves some of it
 *              into the cash through the week's legitimate takings; taking it straight is quicker and leaves
 *              more of a trail. Every step adds to or cuts the business's hidden Exposure. Pure.
 */

import { BUSINESS_DEFAULTS, BACK_ROOMS, POSTS } from './businessConfig.js';
import { fail, addLedger, archetypeOf } from './businessRecord.js';
import { approachOf, bandPassed } from './rolls.js';
import { createRng } from './rng.js';
import { exposureBand } from './businessCompany.js';
import { traitOf } from './businessStaff.js';

export const ROOM_ACTIONS = Object.freeze(['roomWork', 'launder', 'payOff', 'dealGang']);
/** A company's crime (U1c), which a world's underworld setting hides. */
export const CRIME_ACTIONS = Object.freeze(['dumping', 'bribeRegulator', 'blackOps']);
/** What only those running a company should see of its crime: slots, and ledger lines, which others see in plain words. */
export const SECRET_ACTIONS = Object.freeze([...ROOM_ACTIONS, ...CRIME_ACTIONS, 'lieLow']);
export const SECRET_LEDGER = Object.freeze(['laundered', 'dirtyTaken', 'raidFine', 'blackOps', 'regulatorBribe']);

/** The kinds of back room this business's front could hide. */
export const roomKinds = (b) => Object.keys(BACK_ROOMS[b.archetype] ?? {});

/** A back room that is running. */
export const openRoom = (b) => (b.backRoom?.status === 'open' ? b.backRoom : null);

/** What a pay-off costs out of the dirty cash, at this stage. */
export function payOffCost(b, p = BUSINESS_DEFAULTS) {
  const costs = p.backRoom.payOff;
  return costs[Math.min(b.stage ?? 0, costs.length - 1)];
}

/** Whether one of the back room's actions can be taken, and the skills it is rolled with. */
export function roomCheck(b, action, p = BUSINESS_DEFAULTS) {
  const room = openRoom(b);
  if (!room) return fail('no-back-room');
  if (action === 'roomWork') {
    // Lying low means no work behind the shop this week.
    if (b.period.slots.some((s) => s.action === 'lieLow')) return fail('lying-low');
    return { ok: true, uses: BACK_ROOMS[b.archetype]?.[room.kind] ?? [] };
  }
  if (action === 'dealGang') return room.deal ? fail('has-deal') : { ok: true, uses: p.backRoom.deal.uses };
  if (action === 'launder') return room.dirty > 0 ? { ok: true, uses: p.backRoom.launderUses } : fail('no-dirty');
  return room.dirty >= payOffCost(b, p) ? { ok: true, uses: p.backRoom.payOffUses } : fail('no-dirty');
}

/** What the week's slots do in the back room, at the close. `takings` are the legitimate week's, which cap the laundering. */
export function roomWeek(b, takings, part = 1, p = BUSINESS_DEFAULTS, traits = null) {
  const room = openRoom(b);
  if (!room) return null;
  const rules = p.backRoom;
  const slot = (action) => b.period.slots.find((s) => s.action === action);
  const day = b.period.endDay;
  const out = { earned: 0, laundered: 0, paid: 0, low: false, exposure: 0 };
  // An informant reports in, whether the room is worked or not (U1b).
  const moles = informants(b, traits);
  out.exposure += moles.length * rules.informant.exposure;

  if (slot('lieLow')) {
    out.low = true;
    out.exposure -= rules.lieLow;
  } else if (slot('roomWork')) {
    const work = slot('roomWork');
    const scale = 1 + (p.effects.work[work.band] - 1) * approachOf(work.approach).effect;
    out.earned = work.band === 'fumble' ? 0 : Math.round(archetypeOf(b).takings * b.state.capacity * rules.share * scale * part);
    room.dirty += out.earned;
    out.exposure += rules.workExposure[work.band];
  }
  // A silent partner takes its cut, whether or not there was much to cut (U1c).
  if (room.deal) {
    const due = Math.max(rules.deal.minimum, Math.round(out.earned * room.deal.cut));
    if (room.dirty >= due) {
      room.dirty -= due;
      out.cut = due;
    } else {
      out.unpaid = room.deal.factionId;
    }
    // A gang that has turned hostile walks away, and keeps what it put in.
    if (b.standings?.[room.deal.factionId] === 'hostile') {
      out.dealEnded = room.deal.name;
      room.deal = null;
    }
  }
  const payOff = slot('payOff');
  if (payOff) {
    out.paid = Math.min(room.dirty, payOffCost(b, p));
    room.dirty -= out.paid;
    out.exposure += rules.payOffExposure[payOff.band];
    // Money well placed also says who has been talking.
    if (moles.length && ['strong', 'exceptional'].includes(payOff.band)) out.informant = moles[0].name;
  }
  const launder = slot('launder');
  if (launder) {
    out.laundered = Math.min(room.dirty, Math.round(takings * rules.launderCap * rules.launderShare[launder.band]));
    room.dirty -= out.laundered;
    b.till += out.laundered;
    if (out.laundered) addLedger(b, { day, kind: 'laundered', amount: out.laundered }, p);
    // A bookkeeper makes it cleaner.
    const clean = (b.staff ?? []).some((s) => s.status === 'active' && s.post === 'bookkeeper') ? rules.bookkeeper : 0;
    out.exposure += Math.max(0, rules.launderExposure[launder.band] - clean);
  }
  return out;
}

/** What a gang at this standing asks of a business, if it will deal at all. */
export function dealCut(band, p = BUSINESS_DEFAULTS) {
  return p.backRoom.deal.cut[band] ?? null;
}

/** The roll to ask a gang for a deal: a pass brings an offer for the partners to vote on. */
export function runDealRoll(b, { faction, band, day }, p = BUSINESS_DEFAULTS) {
  const room = b.backRoom;
  const cash = p.backRoom.deal.cash[band];
  room.offer = bandPassed(band) && cash > 0
    ? { factionId: faction.id, name: faction.name, cash, cut: dealCut(b.standings?.[faction.id] ?? 'neutral', p), day }
    : null;
}

/** The partners take the gang's offer: its money goes into the dirty cash. */
export function takeDeal(b, day) {
  const room = b.backRoom;
  if (!room?.offer || room.deal) return fail('no-offer');
  room.deal = { factionId: room.offer.factionId, name: room.offer.name, cut: room.offer.cut, cash: room.offer.cash, since: day };
  room.dirty += room.offer.cash;
  room.offer = null;
  return { ok: true };
}

/** The partners end the deal: the money goes back, which there must be enough dirty cash for. */
export function endDeal(b) {
  const room = b.backRoom;
  if (!room?.deal) return fail('no-deal');
  if (room.dirty < room.deal.cash) return fail('no-dirty');
  room.dirty -= room.deal.cash;
  const { factionId } = room.deal;
  room.deal = null;
  return { ok: true, factionId };
}

/** The NPC staff who are informants. */
export const informants = (b, traits) => (b.staff ?? []).filter((s) => s.status === 'active' && traitOf(traits, s) === 'informant');

/** The chance of a raid on the back room this week: by Exposure, an informant, and each sullen employee. */
export function raidChance(b, exposure, traits = null, p = BUSINESS_DEFAULTS) {
  const r = p.backRoom.raid;
  const staff = (b.staff ?? []).filter((s) => s.status === 'active');
  const inRoom = (s) => !!POSTS[s.post]?.backRoom;
  const sullen = staff.filter((s) => s.source !== 'pc' && s.loyalty != null && s.loyalty < r.sullenBelow).reduce((sum, s) => sum + (inRoom(s) ? r.sullenCrew : 1), 0);
  return r.chance[exposureBand(exposure, p)] + (informants(b, traits).length ? r.informant : 0) + Math.min(r.sullenCap, sullen * r.sullen) + staff.filter(inRoom).length * r.crew;
}

/** A raid on the back room this week, or none. It comes in place of what the week would have drawn. */
export function roomBust(b, seed = 'nci', p = BUSINESS_DEFAULTS, relations = null, traits = null) {
  if (!openRoom(b) || relations?.exposure == null) return null;
  return createRng(seed, 'business-bust', b.id, b.period.index).chance(raidChance(b, relations.exposure, traits, p)) ? { kind: 'bust' } : null;
}

/** An employee with no trait may turn informant in a week with a back room running. */
export function turnInformant(b, traits, seed = 'nci', p = BUSINESS_DEFAULTS) {
  if (!openRoom(b)) return null;
  const rng = createRng(seed, 'business-turned', b.id, b.period.index);
  const candidate = (b.staff ?? []).find((s) => s.status === 'active' && s.source !== 'pc' && !traitOf(traits, s) && rng.chance(p.backRoom.informant.turn));
  return candidate ? { [candidate.candidateId ?? candidate.id]: 'informant' } : null;
}

/**
 * What a raid leaves behind, once it is settled. A win clears some Exposure. A failure seizes half the dirty cash
 * and fines the business; left unanswered or fumbled, all of it, a bigger fine, heat for the partners, and the room
 * shut until it is built again. High Exposure shuts it on a failure too. The legitimate business carries on.
 * @returns {object[]} events for the GM's service
 */
export function bustFallout(b, event, outcome, day, p = BUSINESS_DEFAULTS) {
  const room = b.backRoom;
  if (event?.kind !== 'bust' || !room || !outcome) return [];
  const r = p.backRoom.raid;
  if (outcome === 'answered' || outcome === 'covered') return [{ type: 'bustWon', exposure: -r.winClear }];
  const worst = outcome !== 'failed';
  const seized = worst ? room.dirty : Math.floor(room.dirty * r.failShare);
  const fine = worst ? r.fineLost : r.fineFail;
  const shut = worst || room.band === 'high';
  room.dirty -= seized;
  b.till -= fine;
  addLedger(b, { day, kind: 'raidFine', amount: -fine }, p);
  if (shut) {
    room.status = 'shut';
    room.deal = null;
    room.offer = null;
  }
  return [{ type: 'bustLost', seized, fine, shut, heat: worst ? r.heat : 0 }];
}

/** A partner takes dirty cash straight, as eddies. No cap, but it leaves a trail: Exposure for each `takeEvery` eb. */
export function takeDirty(b, amount, p = BUSINESS_DEFAULTS) {
  const room = openRoom(b);
  if (!room) return fail('no-back-room');
  const eddies = Math.floor(Number(amount) || 0);
  if (eddies < 1) return fail('bad-amount');
  if (eddies > room.dirty) return fail('no-dirty');
  room.dirty -= eddies;
  return { ok: true, amount: eddies, exposure: Math.ceil(eddies / p.backRoom.takeEvery) * p.backRoom.takeExposure };
}
