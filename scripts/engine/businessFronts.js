/**
 * Player businesses: back rooms and dirty cash (U1a)
 * @file scripts/engine/businessFronts.js
 * @description A business can run an illegal operation behind the shop. Its takings go to a pot of dirty cash,
 *              off the books: out of the cash, the book value and the reports. Laundering moves some of it
 *              into the cash through the week's legitimate takings; taking it straight is quicker and leaves
 *              more of a trail. Every step adds to or cuts the business's hidden Exposure. Pure.
 */

import { BUSINESS_DEFAULTS, BACK_ROOMS, EVENTS, POSTS } from './businessConfig.js';
import { fail, addLedger, archetypeOf, lastDigest, clamp } from './businessRecord.js';
import { approachOf, bandPassed } from './rolls.js';
import { createRng } from './rng.js';
import { exposureBand } from './businessCompany.js';
import { traitOf } from './businessStaff.js';
import { seizeIllegal } from './businessProduction.js';

/** The one thing each profile alone can do (U3b). */
export const PROFILE_ACTIONS = Object.freeze({ loud: 'bigNight', quiet: 'coverTrail', hungry: 'newSupplier', connected: 'callFavour', laundering: 'clientWash' });
export const ROOM_ACTIONS = Object.freeze(['roomWork', 'launder', 'payOff', 'dealGang', ...Object.values(PROFILE_ACTIONS)]);
const PROFILE_ACTION_IDS = Object.values(PROFILE_ACTIONS);
/** Whether this action works the room for the week: earns, and can draw trouble the week after. */
const WORK_ACTIONS = Object.freeze(['roomWork', 'bigNight']);
/** A company's crime (U1c), which a world's underworld setting hides. */
export const CRIME_ACTIONS = Object.freeze(['dumping', 'bribeRegulator', 'blackOps', 'fence']);
/** What only those running a company should see of its crime: slots, and ledger lines, which others see in plain words. */
export const SECRET_ACTIONS = Object.freeze([...ROOM_ACTIONS, ...CRIME_ACTIONS, 'lieLow']);
export const SECRET_LEDGER = Object.freeze(['laundered', 'dirtyTaken', 'raidFine', 'blackOps', 'regulatorBribe', 'illegalMaterials', 'fenced']);

/** The kinds of back room this business's front could hide. */
export const roomKinds = (b) => Object.keys(BACK_ROOMS[b.archetype] ?? {});

/** The id of a kind's profile, for a business type. A kind no longer known is Steady. */
export const kindProfile = (archetype, kind) => BACK_ROOMS[archetype]?.[kind]?.profile ?? 'steady';

/** How this business's room plays. A kind no longer known plays as every room did before there were profiles. */
export function roomProfile(b, p = BUSINESS_DEFAULTS) {
  return p.backRoom.profiles[kindProfile(b.archetype, b.backRoom?.kind)] ?? p.backRoom.profiles.steady;
}

/** A back room that is running. */
export const openRoom = (b) => (b.backRoom?.status === 'open' ? b.backRoom : null);

/** What a pay-off costs out of the dirty cash, at this stage. */
export function payOffCost(b, p = BUSINESS_DEFAULTS) {
  const costs = p.backRoom.payOff;
  return costs[Math.min(b.stage ?? 0, costs.length - 1)];
}

/** Whether one of the back room's actions can be taken, and the skills it is rolled with. */
export function roomCheck(b, action, p = BUSINESS_DEFAULTS, day = null) {
  const room = openRoom(b);
  if (!room) return fail('no-back-room');
  if (PROFILE_ACTION_IDS.includes(action)) {
    if (PROFILE_ACTIONS[kindProfile(b.archetype, room.kind)] !== action) return fail('wrong-room');
    const rules = p.backRoom.actions[action];
    const last = room.used?.[action];
    if (rules.days && day != null && last != null && day - last < rules.days) return fail('room-wait');
    if (action === 'bigNight') {
      if (b.period.slots.some((s) => s.action === 'lieLow')) return fail('lying-low');
      if (b.period.slots.some((s) => s.action === 'roomWork')) return fail('action-taken');
    }
    if (action === 'callFavour' && !(room.factionId && rules.bands.includes(b.standings?.[room.factionId]))) return fail('favour-refused');
    return { ok: true, uses: BACK_ROOMS[b.archetype]?.[room.kind]?.uses ?? [] };
  }
  if (action === 'roomWork') {
    // Lying low means no work behind the shop this week, and a big night is the week's work.
    if (b.period.slots.some((s) => s.action === 'lieLow')) return fail('lying-low');
    if (b.period.slots.some((s) => s.action === 'bigNight')) return fail('action-taken');
    return { ok: true, uses: BACK_ROOMS[b.archetype]?.[room.kind]?.uses ?? [] };
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
  const profile = roomProfile(b, p);
  const slot = (action) => b.period.slots.find((s) => s.action === action);
  const day = b.period.endDay;
  const out = { earned: 0, supply: 0, laundered: 0, paid: 0, low: false, exposure: 0 };
  // An informant reports in, whether the room is worked or not (U1b).
  const moles = informants(b, traits);
  out.exposure += moles.length * rules.informant.exposure;

  if (slot('lieLow')) {
    out.low = true;
    out.exposure -= rules.lieLow;
  } else if (slot('roomWork') || slot('bigNight')) {
    const work = slot('roomWork') ?? slot('bigNight');
    const big = work.action === 'bigNight' ? rules.actions.bigNight : null;
    const scale = 1 + (p.effects.work[work.band] - 1) * approachOf(work.approach).effect * profile.swing;
    // What this week's event cost it (U3).
    const kept = 1 - Math.min(1, b.period.roomLost ?? 0);
    const night = big && bandPassed(work.band) ? big.earn : 1;
    out.earned = work.band === 'fumble' ? 0 : Math.round(archetypeOf(b).takings * b.state.capacity * rules.share * scale * profile.earn * part * kept * night);
    // A supplier found this month changes what the stock costs (U3b).
    const supplier = room.supplier && room.supplier.until >= b.period.index ? room.supplier : null;
    out.supply = Math.round(out.earned * (supplier?.supply ?? profile.supply));
    room.dirty += out.earned - out.supply;
    out.exposure += rules.workExposure[work.band] * profile.exposure * (big?.exposure ?? 1) - profile.quietWeek;
    // A connected room's work keeps it in with the faction it chose.
    if (profile.standing && room.factionId) out.standing = { factionId: room.factionId, amount: profile.standing };
  }
  // A big order taken this week (U3), worked or not.
  if (b.period.roomBonus) {
    out.earned += b.period.roomBonus;
    room.dirty += b.period.roomBonus;
  }
  // What only this kind of room can do (U3b).
  const passed = (s) => !!s && bandPassed(s.band);
  const cover = slot('coverTrail');
  if (cover) out.exposure += rules.actions.coverTrail.exposure[cover.band];
  const sourced = slot('newSupplier');
  if (sourced) {
    const r = rules.actions.newSupplier;
    room.supplier = { until: b.period.index + r.weeks, ...(passed(sourced) ? { supply: r.supply } : { risk: r.risk }) };
  }
  const favour = slot('callFavour');
  if (passed(favour) && room.factionId) {
    const r = rules.actions.callFavour;
    out.favour = { factionId: room.factionId, amount: -r.cost };
    // A shakedown it stopped has been dealt with already: otherwise it quietens things.
    if (b.period.event?.kind !== 'shakedown') out.exposure += r.exposure;
  }
  const wash = slot('clientWash');
  if (wash) {
    const fee = Math.round(takings * rules.launderCap * profile.launder * rules.launderShare[wash.band] * rules.actions.clientWash.fee);
    room.dirty += fee;
    out.earned += fee;
    out.exposure += rules.launderExposure[wash.band];
  }
  // The wait runs from the start of the week it was used, so 28 days means every fourth week.
  for (const id of PROFILE_ACTION_IDS) if (slot(id) && rules.actions[id].days) room.used = { ...room.used, [id]: b.period.startDay };
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
    out.laundered = Math.min(room.dirty, Math.round(takings * rules.launderCap * profile.launder * rules.launderShare[launder.band]));
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
  return r.chance[exposureBand(exposure, p)] * roomProfile(b, p).raid + (informants(b, traits).length ? r.informant : 0) + Math.min(r.sullenCap, sullen * r.sullen) + staff.filter(inRoom).length * r.crew;
}

/** A raid on the back room this week, or none. It comes in place of what the week would have drawn. */
export function roomBust(b, seed = 'nci', p = BUSINESS_DEFAULTS, relations = null, traits = null) {
  if (!openRoom(b) || relations?.exposure == null) return null;
  return createRng(seed, 'business-bust', b.id, b.period.index).chance(raidChance(b, relations.exposure, traits, p)) ? { kind: 'bust' } : null;
}

/**
 * What goes wrong in a back room this week, or none (U3). Only a room worked last week draws one. A company's room is
 * left out until its events can pass for something else to the other shareholders (U3c).
 * @param {object} [relations] - `roomEvents`, the world's frequency
 */
export function roomEvent(b, seed = 'nci', p = BUSINESS_DEFAULTS, relations = null) {
  const room = openRoom(b);
  if (!room || b.stage >= 2) return null;
  const last = lastDigest(b);
  if (last?.index !== b.period.index - 1 || !(last.actions ?? []).some((a) => WORK_ACTIONS.includes(a.action))) return null;
  const rules = p.backRoom.events;
  const rng = createRng(seed, 'business-room-event', b.id, b.period.index);
  // A failed search for a supplier makes a bad batch likelier for a while (U3b).
  const risky = kindProfile(b.archetype, room.kind) === 'hungry' && room.supplier?.risk && room.supplier.until >= b.period.index ? room.supplier.risk : 1;
  if (!rng.chance(rules.chance * (relations?.roomEvents ?? 1) * risky)) return null;
  const shared = rng.chance(rules.shared);
  const profile = kindProfile(b.archetype, room.kind);
  let own = rules.byProfile[profile] ?? null;
  // A connected room opened where there are no factions has nobody to ask it a favour.
  if (own === 'roomFavour' && !room.factionId) own = null;
  if (shared) return { kind: rng.chance(0.5) ? 'roomRival' : 'roomBigOrder' };
  if (!own) return null;
  // A bookkeeper keeps the trail tidier.
  if (own === 'roomBooks' && (b.staff ?? []).some((s) => s.status === 'active' && s.post === 'bookkeeper') && rng.chance(rules.roomBooks.bookkeeper)) return null;
  return { kind: own };
}

/**
 * What a back room's event leaves behind, once it is settled: a passed answer stops it, a failed one takes half, and
 * none or a fumble takes it all. What it does to the room's earnings is left on the period for `roomWeek`.
 * @param {object} settled - from `settleEvent`
 * @returns {object[]} events for the GM's service
 */
export function roomEventFallout(b, event, settled, part = 1, p = BUSINESS_DEFAULTS) {
  const def = event && EVENTS[event.kind];
  const room = b.backRoom;
  if (!def?.room || !room || !settled) return [];
  const rules = p.backRoom.events[event.kind];
  const { outcome } = settled;
  if (event.kind === 'roomBigOrder') {
    if (outcome === 'unanswered') return [];
    if (outcome === 'answered') b.period.roomBonus = Math.round(archetypeOf(b).takings * b.state.capacity * p.backRoom.share * roomProfile(b, p).earn * rules.pay * part);
    return [{ type: 'backRoomEvent', kind: event.kind, exposure: rules.exposure }];
  }
  const scale = outcome === 'answered' ? 0 : outcome === 'failed' ? 0.5 : 1;
  if (!scale) return [];
  if (rules.lost) b.period.roomLost = rules.lost * scale;
  if (rules.reputation) b.state.reputation = clamp(b.state.reputation + rules.reputation * scale, 0, 100);
  if (rules.dirty) room.dirty -= Math.floor(room.dirty * rules.dirty * scale);
  const exposure = (rules.exposure ?? 0) * scale + (outcome === 'fumbled' ? rules.fumbleExposure ?? 0 : 0);
  return [
    { type: 'backRoomEvent', kind: event.kind, exposure },
    ...(rules.standing && room.factionId ? [{ type: 'factionMove', factionId: room.factionId, amount: rules.standing * scale, steady: true }] : []),
  ];
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
  // Illegal stock goes the same way, in the same share (P1c).
  const taken = seizeIllegal(b, worst ? 1 : r.failShare);
  b.till -= fine;
  addLedger(b, { day, kind: 'raidFine', amount: -fine }, p);
  if (shut) {
    room.status = 'shut';
    room.deal = null;
    room.offer = null;
  }
  return [{ type: 'bustLost', seized, fine, shut, heat: worst ? r.heat : 0 }, ...taken];
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
