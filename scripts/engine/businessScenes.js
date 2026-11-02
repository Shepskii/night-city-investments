/**
 * Player businesses: big events played out as scenes (X1)
 * @file scripts/engine/businessScenes.js
 * @description A big event (a raid, sabotage, a hostile faction's move, collectors) can be played at the table
 *              instead of rolled. The GM's choice lifts it out of the week, so the weeks run on while it waits
 *              for a session; the GM then says how it went, or sends it back to a roll. Left alone it stays an
 *              ordinary event. Pure.
 */

import { BUSINESS_DEFAULTS, EVENTS } from './businessConfig.js';
import { fail, addLedger, lastDigest, clamp } from './businessRecord.js';
import { applyHit, factionFallout } from './businessEvents.js';

const BIG = Object.freeze(['sabotage', 'raid', 'smear', 'collectors', 'grudge']);

/** Whether this event is big enough to play out: a hostile faction's move, a heavy shakedown, or a debt come due. */
export function isBigEvent(event) {
  if (!event || !EVENTS[event.kind]) return false;
  return BIG.includes(event.kind) || (event.kind === 'poaching' && !!event.factionId) || (event.kind === 'shakedown' && !!event.heavy);
}

/** This week's event, if the GM could make a scene of it: big, and nobody has answered it yet. */
export function sceneCandidate(b) {
  const event = b.period?.event;
  if (b.scene || !isBigEvent(event) || b.period.slots.some((s) => s.action === 'respond')) return null;
  return event;
}

/** GM: play this week's big event out. */
export function startScene(b, day) {
  const event = sceneCandidate(b);
  if (!event) return fail('no-scene');
  b.scene = { event, day };
  b.period.event = null;
  return { ok: true };
}

/** GM: back to a roll, on this week's event, if the week has none of its own. */
export function sceneToRoll(b) {
  if (!b.scene) return fail('no-scene');
  if (b.period.event) return fail('event-busy');
  b.period.event = b.scene.event;
  b.scene = null;
  return { ok: true };
}

/**
 * GM: how the scene went. Won, the business comes out of it well. Lost, it takes what an unanswered event
 * takes, on the last week's takings as the weeks have moved on.
 * @returns {{ok: boolean, events?: object[]}} events for the GM's service
 */
export function settleScene(b, won, day, p = BUSINESS_DEFAULTS) {
  if (!b.scene) return fail('no-scene');
  const { event } = b.scene;
  b.scene = null;
  if (won) {
    b.state.reputation = clamp(b.state.reputation + p.scene.wonReputation, 0, 100);
    addLedger(b, { day, kind: 'sceneWon', amount: 0 }, p);
    return { ok: true, events: [] };
  }
  const loss = Math.round((lastDigest(b)?.takings ?? 0) * p.events.loss.unanswered);
  b.till -= loss;
  addLedger(b, { day, kind: 'sceneLost', amount: -loss }, p);
  applyHit(b, EVENTS[event.kind].hit, 1);
  if (event.kind === 'poaching') {
    const target = (b.staff ?? []).find((s) => s.id === event.staffId);
    if (target && (target.loyalty ?? 0) < p.staff.loyalty.devoted) {
      b.staff = b.staff.filter((s) => s !== target);
      addLedger(b, { day, kind: 'poached', amount: 0, staffName: target.name }, p);
    }
  }
  // Exposure from a raid, a smear's dip in the price: as the event would have left behind.
  return { ok: true, events: factionFallout({ ...b, period: { ...b.period, event } }, { outcome: 'unanswered' }, p) };
}
