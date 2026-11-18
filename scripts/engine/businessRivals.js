/**
 * Moves against NPC rivals (X2b, DESIGN §36.20)
 * @file scripts/engine/businessRivals.js
 * @description A player business may poach an NPC company's employee or sabotage it, as weekly actions; the GM may
 *              make the same moves for an NPC company against a player business, as its week's event, and an NPC
 *              company with the aggressive trait proposes them now and then for the GM to approve. The GM's service
 *              keeps the rivals' true records and publishes only what a player's window needs. Pure.
 */

import { BUSINESS_DEFAULTS, stageDv } from './businessConfig.js';
import { archetypeOf, fail } from './businessRecord.js';
import { upgradesOf } from './businessGrowth.js';
import { npcStaff } from './businessPeople.js';
import { postOpen, postRate, postBase, wageOf, startLoyalty } from './businessStaff.js';
import { bandPassed } from './rolls.js';

/** The weekly actions aimed at an NPC company. */
export const RIVAL_ACTIONS = Object.freeze(['poach', 'sabotage']);

/** The GM's moves for an NPC company against a player business. */
export const RIVAL_MOVES = Object.freeze(['poach', 'sabotage', 'story']);

/** Whether a business is an NPC's company a player may move against: open, and owned and run by an NPC (N1). */
export const isRival = (b) => !!b && b.status === 'open' && !!b.npcRun;

/** An employee's DV to be poached: the more loyal, the harder. */
export const poachDv = (loyalty, p = BUSINESS_DEFAULTS) => p.rivals.poach.base + Math.floor(Math.max(0, loyalty ?? 0) / p.rivals.poach.perLoyalty);

/** A rival's DV to be sabotaged: its stage's, and one more for each security upgrade. */
export const sabotageDv = (rival, p = BUSINESS_DEFAULTS) => stageDv(rival.stage, p) + (rival.security ?? 0);

/** Who may be poached from a rival: its NPC employees (never a player character on its staff, or an Exec's team). */
const poachable = (b) => npcStaff(b).filter((s) => s.source !== 'team');

/**
 * A rival as the GM's service hands it to the engine: its whole staff entries, to hire from. A player's window gets
 * `publicRival` instead, and the service puts this one on the request in its place before anything is checked.
 */
export function rivalView(b) {
  return {
    id: b.id, name: b.name, stage: b.stage, archetype: b.archetype, district: b.district ?? null,
    security: upgradesOf(b).security ?? 0,
    staff: poachable(b).map((s) => structuredClone(s)),
  };
}

/** A rival as players see it on the job board: its name, its DV, and each employee who may be poached with theirs. */
export function publicRival(b, p = BUSINESS_DEFAULTS) {
  const view = rivalView(b);
  return {
    id: view.id, name: view.name, stage: view.stage, archetype: view.archetype, district: view.district, security: view.security,
    dv: sabotageDv(view, p),
    staff: view.staff.map((s) => ({ id: s.id, name: s.name, post: s.post, dv: poachDv(s.loyalty, p) })),
  };
}

/**
 * Whether a rival action can be taken now, and its DV. `request.rival` is the rival: the GM's service puts its true
 * record there; a player's window puts what the board shows, which is enough to show the roll.
 * @returns {{ok: boolean, dv?: number, staff?: object, reason?: string}}
 */
export function rivalCheck(b, request, p = BUSINESS_DEFAULTS) {
  const rival = request.rival;
  if (!rival || !request.targetId || rival.id !== request.targetId) return fail('bad-target');
  if (rival.id === b.id) return fail('bad-target');
  if (request.action === 'sabotage') return { ok: true, dv: sabotageDv(rival, p) };
  const staff = (rival.staff ?? []).find((s) => s.id === request.staffId);
  if (!staff) return fail('no-staff');
  // There has to be room for them here.
  const open = postOpen(b, staff.post, p);
  if (!open.ok) return open;
  return { ok: true, dv: staff.loyalty != null ? poachDv(staff.loyalty, p) : staff.dv, staff };
}

/**
 * A poached employee joins: their post, skills and traits as they were, paid what they had plus the raise. Their
 * loyalty starts where a new hire's would at that pay.
 * @returns {object} the new staff entry
 */
export function poachHire(b, staff, day, fromId = null, p = BUSINESS_DEFAULTS) {
  const wanted = Math.round((staff.wage ?? 0) * (1 + p.rivals.poach.raise));
  const going = postRate(staff.post, postBase(staff, staff.post, archetypeOf(b), p), b.stage, p);
  const pct = going > 0 ? Math.max(1, Math.round((wanted / going) * 100) / 100) : 1;
  const hired = {
    ...structuredClone(staff),
    status: 'active', hiredDay: day, owed: 0, pct, loyalty: startLoyalty(pct, p),
    poachedFrom: { businessId: fromId, day },
  };
  delete hired.outUntil;
  delete hired.elsewhere;
  delete hired.knownElsewhere;
  delete hired.promotions;
  hired.wage = Math.max(wageOf(b, hired, p), wanted);
  b.staff = [...(b.staff ?? []), hired];
  return hired;
}

/** How much a landed sabotage cuts the rival's next takings: a narrow pass less. */
export const sabotageCut = (band, p = BUSINESS_DEFAULTS) => (band === 'narrow' ? p.rivals.sabotage.narrowCut : p.rivals.sabotage.cut);

/**
 * What a rival action leaves for the GM's service, when it is rolled: the rival's side is another record.
 * Sabotage brings Exposure here whatever the roll, more on a fumble.
 */
export function rivalOutcome(request, { band, staff = null, actorId }, p = BUSINESS_DEFAULTS) {
  const r = p.rivals;
  const success = bandPassed(band);
  const base = { type: 'rivalMove', move: request.action, rivalId: request.targetId, rivalName: request.rival?.name ?? '', band, success, actorId };
  if (request.action === 'poach') return { ...base, staffId: staff?.id ?? request.staffId, staffName: staff?.name ?? '' };
  return { ...base, cut: success ? sabotageCut(band, p) : 0, exposure: r.sabotage.exposure + (band === 'fumble' ? r.sabotage.fumbleExposure : 0) };
}

/**
 * The event an NPC company's move makes at a player business (the GM's, or an aggressive company's): a poaching of
 * its best hand, a sabotage, each from the rival. A story goes through the press instead (`runPress`).
 * @returns {{ok: boolean, event?: object, reason?: string}}
 */
export function rivalEvent(b, rival, kind, staffId = null) {
  if (b.status !== 'open' || !b.period) return fail('not-open');
  if (b.npcRun) return fail('not-player');
  if (!isRival(rival) || rival.id === b.id) return fail('bad-target');
  const from = { factionName: rival.name, rivalBusiness: { id: rival.id, name: rival.name }, byHand: true };
  if (kind === 'sabotage') return { ok: true, event: { kind: 'sabotage', ...from } };
  if (kind !== 'poach') return fail('bad-move');
  const staff = npcStaff(b).filter((s) => s.source !== 'team');
  const target = staffId ? staff.find((s) => s.id === staffId) : [...staff].sort((x, y) => (y.wage ?? 0) - (x.wage ?? 0))[0];
  if (!target) return fail('no-staff');
  return { ok: true, event: { kind: 'poaching', staffId: target.id, ...from } };
}

/**
 * A rival's event this week, or next week's if this one has its event already (as a breach is, X2a).
 * @returns {{ok: boolean, when?: 'now'|'next', reason?: string}}
 */
export function queueRivalEvent(b, event) {
  if (b.period.event) {
    if (b.rivalQueued) return fail('rival-queued');
    b.rivalQueued = event;
    return { ok: true, when: 'next' };
  }
  b.period.event = event;
  return { ok: true, when: 'now' };
}

/**
 * An aggressive NPC company's move this week, or none: now and then it picks a player business, one on its own
 * patch or in its own trade first, and a move against it, for the GM to approve.
 * @param {{id: string, name: string, district?: string, archetype: string, staff: number}[]} targets - open player businesses
 * @param {{chance: (x: number) => boolean, int: (lo: number, hi: number) => number}} rng
 * @returns {{targetId: string, targetName: string, kind: string}|null}
 */
export function drawRivalMove(rival, targets, rng, p = BUSINESS_DEFAULTS) {
  if (!rival.npcRun?.aggressive || rival.npcRun.move || !targets.length) return null;
  if (!rng.chance(p.rivals.aggressive.chance)) return null;
  const near = targets.filter((t) => (rival.district && t.district === rival.district) || t.archetype === rival.archetype);
  const pool = near.length ? near : targets;
  const target = pool[rng.int(0, pool.length - 1)];
  const kinds = target.staff > 0 ? RIVAL_MOVES : RIVAL_MOVES.filter((k) => k !== 'poach');
  return { targetId: target.id, targetName: target.name, kind: kinds[rng.int(0, kinds.length - 1)] };
}
