/**
 * Player businesses: weekly events
 * @file scripts/engine/businessEvents.js
 * @description The week's trouble or windfall (DESIGN §27.0, §27.4). The engine draws an event when
 *              a week starts, from the world seed, the business and the week, so the same week always
 *              draws the same thing; that draw is not a player's roll. Answering it is: a partner
 *              takes a slot and rolls one of the skills the event names. Unanswered, it has its default
 *              outcome when the week closes. Pure; no Foundry globals.
 */

import { createRng } from './rng.js';
import { EVENTS, ABILITIES, BUSINESS_DEFAULTS, districtOf } from './businessConfig.js';
import { archetypeOf, clamp } from './businessRecord.js';
import { bandPassed } from './rolls.js';
import { staffEventWeight, staffEventTarget, settleStaffEvent } from './businessPeople.js';
import { breakInFactor } from './businessGrowth.js';
import { hostileChance } from './factions.js';

/** How likely an event is this week: the base chance, the district's risk, and less once registered. */
export function eventChance(b, p = BUSINESS_DEFAULTS) {
  return Math.min(0.9, p.events.chance * districtOf(b.district).risk * (b.stage >= 1 ? p.events.registeredFactor : 1));
}

/**
 * Draw this week's event, or none. Staff events join the table when there are NPC staff (E2); one
 * about an employee names them (`staffId`). Gangs on the turf make shakedowns likelier or rarer, and
 * one of them is named (F1b).
 */
export function drawEvent(b, seed = 'nci', p = BUSINESS_DEFAULTS, traits = null, relations = null) {
  const rng = createRng(seed, 'business-event', b.id, b.period.index);
  if (!rng.chance(eventChance(b, p))) return null;
  const weights = Object.fromEntries(Object.entries(EVENTS).filter(([, e]) => (e.stage ?? 0) <= b.stage)
    // A security upgrade keeps break-ins away.
    .map(([k, e]) => [k, e.staff ? staffEventWeight(b, k, traits, p) : k === 'theft' ? e.weight * breakInFactor(b, p) : k === 'shakedown' ? e.weight * (relations?.shakedown ?? 1) : e.weight]).filter(([, w]) => w > 0));
  const kind = rng.weighted(weights);
  const staffId = EVENTS[kind].staff ? staffEventTarget(b, kind, rng, p) : null;
  // A two-jobs event names the other business, as it stood when it was drawn (E3).
  const rival = EVENTS[kind].twoJobs ? (b.staff ?? []).find((s) => s.id === staffId)?.elsewhere : null;
  // Its own stream, so naming a gang leaves the draws of other weeks and businesses as they were.
  const gangs = kind === 'shakedown' ? relations?.gangs ?? [] : [];
  const gang = gangs.length ? gangs[createRng(seed, 'business-gang', b.id, b.period.index).int(0, gangs.length - 1)] : null;
  // A gang that is hostile to the business makes it a heavy shakedown, big enough to play out (X1).
  const heavy = gang && relations?.hostile?.some((h) => h.id === gang.id);
  return { kind, ...(staffId ? { staffId } : {}), ...(rival ? { rival: { businessId: rival.businessId, name: rival.name } } : {}), ...(gang ? { factionId: gang.id, factionName: gang.name } : {}), ...(heavy ? { heavy: true } : {}) };
}

/**
 * A hostile faction's act this week, or none (F1b): the worst one may act, in place of whatever the
 * week would have drawn. A corporation smears, a gang sabotages; either can tip off a raid or poach.
 */
export function hostileAct(b, seed = 'nci', p = BUSINESS_DEFAULTS, relations = null) {
  const worst = relations?.hostile?.[0];
  if (!worst) return null;
  const rng = createRng(seed, 'business-hostile', b.id, b.period.index);
  if (!rng.chance(hostileChance(worst.value, p))) return null;
  const staffId = staffEventTarget(b, 'poaching', rng, p);
  const kinds = [worst.kind === 'gang' ? 'sabotage' : 'smear', 'raid', ...(staffId ? ['poaching'] : [])];
  const kind = kinds[rng.int(0, kinds.length - 1)];
  return { kind, factionId: worst.id, factionName: worst.name, ...(kind === 'poaching' ? { staffId } : {}) };
}

/** What a faction's event leaves behind when the week closes, for the GM's service: standing, Exposure, the price. */
export function factionFallout(b, settled, p = BUSINESS_DEFAULTS) {
  const event = b.period.event;
  if (!settled || !event?.factionId) return [];
  const rules = p.standing.hostile;
  const lost = ['unanswered', 'failed', 'fumbled'].includes(settled.outcome);
  const scale = settled.outcome === 'failed' ? 0.5 : 1;
  if (event.kind === 'shakedown' && settled.outcome === 'answered' && byForce(b)) return [{ type: 'factionMove', factionId: event.factionId, amount: rules.force }];
  if (event.kind === 'raid' && lost) return [{ type: 'factionRaid', factionId: event.factionId, exposure: Math.ceil(rules.raidExposure * scale) }];
  if (event.kind === 'smear' && lost) return [{ type: 'factionSmear', factionId: event.factionId, amount: rules.smear * scale, period: b.period.index }];
  return [];
}

const FORCE = [ABILITIES.combatAwareness, ABILITIES.backup].map((a) => `ability:${a.ability}`);

/** Whether this week's answer was by force: a fighting ability, or security staff. */
function byForce(b) {
  const answer = b.period.slots.find((s) => s.action === 'respond');
  return !!answer && (FORCE.includes(answer.use) || (b.staff ?? []).find((s) => s.id === answer.by)?.post === 'security');
}

/** The ways an event may be answered: its own skills and abilities, and the trade's skills where it says so. */
export function eventUses(b, kind) {
  const e = EVENTS[kind];
  if (!e) return [];
  const seen = new Set();
  return [...(e.trade ? archetypeOf(b)?.trade ?? [] : []), ...e.uses].filter((u) => {
    const key = u.kind === 'ability' ? `a:${u.ability}` : `s:${u.skill}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * How this week's event turned out, when the week closes.
 * @param {object} b - the business (its state is changed by the event's hit)
 * @param {number} takings - the week's takings before the event
 * @param {object[]} slots - the week's slots: the answer is the `respond` one; a passed Keep it safe covers security events
 * @returns {{kind: string, outcome: string, band: string|null, change: number}|null}
 *          `change` is what the event does to the takings, in eb
 */
export function settleEvent(b, takings, slots, p = BUSINESS_DEFAULTS, staffCtx = {}) {
  const event = b.period.event;
  if (!event) return null;
  const def = EVENTS[event.kind];
  if (def.staff) return settleStaffEvent(b, takings, slots, staffCtx, p);
  const answer = slots.find((s) => s.action === 'respond');
  const safe = slots.find((s) => s.action === 'keepSafe');

  if (def.good) {
    const band = answer?.band ?? null;
    return { kind: event.kind, outcome: band ? (bandPassed(band) ? 'windfall' : 'missed') : 'unanswered', band, change: Math.round(takings * (band ? p.events.windfall[band] : 0)) };
  }

  let outcome;
  let share;
  if (answer) {
    outcome = answer.band === 'fumble' ? 'fumbled' : bandPassed(answer.band) ? 'answered' : 'failed';
    share = outcome === 'answered' ? 0 : p.events.loss[outcome === 'fumbled' ? 'fumble' : 'failure'];
  } else if (def.security && safe && bandPassed(safe.band)) {
    outcome = 'covered';
    share = 0;
  } else {
    outcome = 'unanswered';
    share = p.events.loss.unanswered;
  }
  if (share > 0) applyHit(b, def.hit, outcome === 'failed' ? 0.5 : 1);
  return { kind: event.kind, outcome, band: answer?.band ?? null, change: -Math.round(takings * share) };
}

export function applyHit(b, hit, scale) {
  if (hit.reputation) b.state.reputation = clamp(b.state.reputation + hit.reputation * scale, 0, 100);
  if (hit.capacity) b.state.capacity = Math.max(0.5, b.state.capacity + hit.capacity * scale);
  if (hit.costFactor) b.state.costFactor = Math.min(1.2, b.state.costFactor + hit.costFactor * scale);
  if (hit.compliance && b.state.compliance != null) b.state.compliance = clamp(b.state.compliance + hit.compliance * scale, 0, 100);
}
