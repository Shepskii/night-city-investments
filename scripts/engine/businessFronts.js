/**
 * Player businesses: back rooms and dirty cash (U1a)
 * @file scripts/engine/businessFronts.js
 * @description A business can run an illegal operation behind the shop. Its takings go to a pot of dirty cash,
 *              off the books: out of the cash, the book value and the reports. Laundering moves some of it
 *              into the cash through the week's legitimate takings; taking it straight is quicker and leaves
 *              more of a trail. Every step adds to or cuts the business's hidden Exposure. Pure.
 */

import { BUSINESS_DEFAULTS, BACK_ROOMS } from './businessConfig.js';
import { fail, addLedger, archetypeOf } from './businessRecord.js';
import { approachOf } from './rolls.js';

export const ROOM_ACTIONS = Object.freeze(['roomWork', 'launder', 'payOff']);

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
  if (action === 'launder') return room.dirty > 0 ? { ok: true, uses: p.backRoom.launderUses } : fail('no-dirty');
  return room.dirty >= payOffCost(b, p) ? { ok: true, uses: p.backRoom.payOffUses } : fail('no-dirty');
}

/** What the week's slots do in the back room, at the close. `takings` are the legitimate week's, which cap the laundering. */
export function roomWeek(b, takings, part = 1, p = BUSINESS_DEFAULTS) {
  const room = openRoom(b);
  if (!room) return null;
  const rules = p.backRoom;
  const slot = (action) => b.period.slots.find((s) => s.action === action);
  const day = b.period.endDay;
  const out = { earned: 0, laundered: 0, paid: 0, low: false, exposure: 0 };

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
  const payOff = slot('payOff');
  if (payOff) {
    out.paid = Math.min(room.dirty, payOffCost(b, p));
    room.dirty -= out.paid;
    out.exposure += rules.payOffExposure[payOff.band];
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
