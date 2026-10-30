/**
 * Player businesses: growing
 * @file scripts/engine/businessGrowth.js
 * @description How a business grows in B2 (DESIGN §26.0): business days, expansion projects that
 *              raise Capacity, and the step up from side business to registered business, with its
 *              milestone checklist and registration roll. Pure; no Foundry globals.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { charterMilestones } from './businessCharter.js';
import { dvOf } from './rolls.js';
import { partnerOf, holders, addLedger, fail, clamp } from './businessRecord.js';

// ── Business days ────────────────────────────────────────────────────────────

/** Business days a partner has left this week: the weekly allowance, less what they have spent. */
export function daysLeft(b, actorId, p = BUSINESS_DEFAULTS) {
  const me = partnerOf(b, actorId);
  if (b.status !== 'open' || !b.period || me?.status !== 'active' || !me.voting) return 0;
  return Math.max(0, p.businessDays - (b.period.days?.[actorId] ?? 0));
}

export function spendDays(b, actorId, n) {
  b.period.days = { ...(b.period.days ?? {}), [actorId]: (b.period.days?.[actorId] ?? 0) + n };
}

// ── Expansion projects ───────────────────────────────────────────────────────

export const activeProject = (b) => b.projects.find((x) => x.status === 'active') ?? null;

/** Whether an expansion can be started now, and what it would cost and give. */
export function expansionOffer(b, p = BUSINESS_DEFAULTS) {
  const stage = p.stages[b.stage];
  const ex = stage?.expansion;
  if (!ex) return fail('no-expansion');
  if (activeProject(b)) return fail('project-running');
  if (b.state.capacity >= stage.capacityCap - 1e-6) return fail('at-capacity');
  if (b.till < ex.cost) return fail('no-funds');
  return { ok: true, cost: ex.cost, gain: ex.gain, days: ex.days };
}

/** Start an expansion, paid from the till at once. The fit-out is worth what it cost. */
export function startExpansion(b, id, day, p = BUSINESS_DEFAULTS) {
  const offer = expansionOffer(b, p);
  if (!offer.ok) return offer;
  b.till -= offer.cost;
  b.assets += offer.cost;
  b.projects = [...b.projects, {
    id, kind: 'expansion', stage: b.stage, cost: offer.cost, gain: offer.gain, daysNeeded: offer.days, days: 0, startedDay: day, status: 'active', crew: {},
  }];
  addLedger(b, { day, kind: 'expansion', amount: -offer.cost }, p);
  return { ok: true };
}

/**
 * Put business days into the running project. When it has its days it is done and Capacity rises,
 * up to the stage's ceiling.
 * @returns {{ok: true, done: boolean} | {ok: false, reason: string}}
 */
export function addProjectDays(b, actorId, projectId, n, { growthRate = 1, day, params: p = BUSINESS_DEFAULTS } = {}) {
  const project = b.projects.find((x) => x.id === projectId && x.status === 'active');
  if (!project) return fail('no-project');
  const days = Math.floor(Number(n) || 0);
  if (days < 1) return fail('bad-amount');
  if (days > daysLeft(b, actorId, p)) return fail('no-days');
  const used = Math.min(days, project.daysNeeded - project.days);
  spendDays(b, actorId, used);
  project.days += used;
  project.crew = { ...project.crew, [actorId]: (project.crew?.[actorId] ?? 0) + used };
  if (project.days < project.daysNeeded) return { ok: true, done: false };
  const cap = p.stages[b.stage]?.capacityCap ?? b.state.capacity;
  b.state.capacity = clamp(b.state.capacity + project.gain * growthRate, 0.5, Math.max(cap, b.state.capacity));
  project.status = 'done';
  project.doneDay = day;
  return { ok: true, done: true };
}

// ── Stepping up ──────────────────────────────────────────────────────────────

/** A digest's profit as a full week's, so a short first week does not count against the average. */
const weekly = (d) => (d.endDay - d.startDay > 0 ? (d.profit * 7) / (d.endDay - d.startDay) : d.profit);

/**
 * The checklist for the next stage, shown, never rolled (DESIGN §26.0). Only the step to a
 * registered business exists until B4 brings the charter.
 * @returns {{to: number|null, items: {id: string, have: number, need: number, met: boolean}[], met: boolean, available: boolean}}
 */
export function milestones(b, p = BUSINESS_DEFAULTS) {
  if (b.stage === 1) return charterMilestones(b, p);
  if (b.stage !== 0) return { to: b.stage + 1, items: [], met: false, available: false };
  const r = p.registration;
  const full = b.digests.filter((d) => d.endDay - d.startDay >= 7);
  const recent = b.digests.slice(-4);
  const avg = recent.length ? recent.reduce((a, d) => a + weekly(d), 0) / recent.length : 0;
  const items = [
    { id: 'weeks', have: full.length, need: r.minWeeks },
    { id: 'profit', have: Math.round(avg), need: r.minProfit },
    { id: 'reputation', have: Math.round(b.state.reputation), need: r.minReputation },
    { id: 'fee', have: b.till, need: r.fee },
  ].map((x) => ({ ...x, met: x.have >= x.need }));
  return { to: 1, items, met: items.every((x) => x.met), available: true };
}

/** Whether the registration roll can be made now (the partners have agreed and the milestones are met). */
export function stepUpCheck(b, actorId, day, p = BUSINESS_DEFAULTS) {
  const me = partnerOf(b, actorId);
  if (b.status !== 'open') return fail('not-open');
  if (me?.status !== 'active' || !me.voting) return fail('not-partner');
  // The registration roll; a registered business charters with the charter rolls instead (B4a).
  if (b.stage !== 0) return fail('no-step-up');
  const m = milestones(b, p);
  if (!m.available) return fail('no-step-up');
  if (!m.met) return fail('milestones');
  if (!b.stepUp?.approved) return fail('not-agreed');
  if (b.stepUp.retryDay != null && day < b.stepUp.retryDay) return fail('step-up-delay');
  return { ok: true, dv: dvOf(p.registration.dv), uses: [...p.registration.uses] };
}

/** Apply the registration roll. The fee is paid whatever the result. */
export function applyStepUp(b, actorId, result, day, p = BUSINESS_DEFAULTS) {
  const r = p.registration;
  b.till -= r.fee;
  addLedger(b, { day, kind: 'registrationFee', amount: -r.fee, actorId }, p);
  if (!result.success) {
    b.stepUp = { approved: true, retryDay: day + (result.band === 'fumble' ? r.fumbleDelay : r.delay) };
    return { stepped: false };
  }
  b.stage = 1;
  b.registeredDay = day;
  b.state.compliance = r.compliance[result.band] ?? p.complianceBaseline;
  b.stepUp = null;
  addLedger(b, { day, kind: 'registered', amount: 0, actorId }, p);
  return { stepped: true };
}

/** Partners with a vote, for the proposal rules. */
export const votingUnits = (b) => holders(b).filter((x) => x.voting).reduce((a, x) => a + x.units, 0);
