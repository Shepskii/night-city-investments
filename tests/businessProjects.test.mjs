import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, activeProject, normalizeBusiness, BUSINESS_DEFAULTS, projectOffer, upgradesOf, protectionFactor,
  breakInFactor, headcountOf, postOpen, drawEvent,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const ACTORS = { med: 'Medtech', fix: 'Fixer' };
const MONDAY = 1;
const DAY = 20003;
const P = BUSINESS_DEFAULTS.projects;
const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: null }, dv, levers: {} }) });

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: extra.key ?? `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: ACTORS, newId: 'b1', growthRate: 1, ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** A clinic with two partners (the Medtech holds the majority), at a stage, with cash in hand. */
function clinic({ stage = 0, till = 6000, costFactor = 1 } = {}) {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: { kind: 'skill', skill: 'Cybertech', stat: 'tech' } }, MED, { check: check(14, 9, 13) }).business;
  const out = normalizeBusiness({ ...b, stage, till, state: { ...b.state, costFactor, compliance: stage ? 50 : null, reputation: 50 } });
  delete out.period.event;
  return out;
}

/** Propose a project (the Medtech's majority starts it) and finish it with business days. */
function build(b, project) {
  let out = apply(b, { type: 'propose', businessId: 'b1', kind: 'project', project }, MED).business;
  const running = activeProject(out);
  assert.equal(running.kind, project);
  let left = running.daysNeeded;
  for (const who of [MED, FIX]) {
    const n = Math.min(left, BUSINESS_DEFAULTS.businessDays);
    if (n < 1) break;
    out = apply(out, { type: 'addDays', businessId: 'b1', projectId: running.id, days: n }, who).business;
    left -= n;
  }
  assert.equal(activeProject(out), null, `${project} finished`);
  return out;
}

test('every kind of project is offered with its cost and days by stage', () => {
  const b = clinic({ stage: 1 });
  assert.deepEqual(projectOffer(b, 'refit'), { ok: true, cost: P.refit.cost[1], days: P.refit.days[1] });
  assert.deepEqual(projectOffer(b, 'staffRoom'), { ok: true, cost: P.staffRoom.cost[1], days: P.staffRoom.days[1] });
  assert.equal(projectOffer(b, 'expansion').gain, BUSINESS_DEFAULTS.stages[1].expansion.gain);
  const poor = projectOffer(clinic({ till: 100 }), 'security');
  assert.deepEqual([poor.ok, poor.reason, poor.cost], [false, 'no-funds', P.security.cost[0]], 'short of cash: how much it needs');
  assert.equal(projectOffer(b, 'nonsense').reason, 'bad-project');
});

test('a project is paid at once and its proposal names it; only one runs at a time', () => {
  const b = clinic();
  const started = apply(b, { type: 'propose', businessId: 'b1', kind: 'project', project: 'refit' }, MED).business;
  assert.equal(started.till, b.till - P.refit.cost[0]);
  assert.equal(started.assets, b.assets + P.refit.cost[0], 'what it builds is worth what it cost');
  assert.equal(started.ledger.at(-1).project, 'refit');
  assert.equal(projectOffer(started, 'storefront').reason, 'project-running');
  // The Fixer alone cannot carry it: the proposal waits, naming the project.
  const waiting = apply(b, { type: 'propose', businessId: 'b1', kind: 'project', project: 'storefront' }, FIX).business;
  assert.equal(waiting.proposals[0].terms.project, 'storefront');
});

test('a refit cuts the Cost base, never below its floor', () => {
  const b = build(clinic({ costFactor: 0.95 }), 'refit');
  assert.ok(Math.abs(b.state.costFactor - 0.9) < 1e-9);
  const low = clinic({ costFactor: BUSINESS_DEFAULTS.costFloor + 0.02 });
  assert.equal(build(low, 'refit').state.costFactor, BUSINESS_DEFAULTS.costFloor);
  assert.equal(projectOffer(clinic({ costFactor: BUSINESS_DEFAULTS.costFloor }), 'refit').reason, 'at-floor');
});

test('security: two levels, each cutting protection money a quarter and halving break-ins', () => {
  const plain = clinic();
  let b = build(plain, 'security');
  assert.equal(upgradesOf(b).security, 1);
  assert.equal(protectionFactor(b), 0.75);
  assert.equal(breakInFactor(b), 0.5);
  // A new week, with fresh business days.
  b = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' }).business;
  delete b.period.event;
  b = build(b, 'security');
  assert.equal(protectionFactor(b), 0.5);
  assert.equal(projectOffer(b, 'security').reason, 'top-level');
  // The week's upkeep pays less protection money.
  const week = (x) => advanceBusiness(x, x.period.endDay, { weekday: MONDAY, seed: 'test' }).events.find((e) => e.type === 'periodClosed').digest.costs.protection;
  assert.ok(week(b) < week(plain));
  // Break-ins come less often: over many weeks, fewer drawn.
  const count = (x) => Array.from({ length: 400 }, (_, i) => {
    x.period.index = i;
    return drawEvent(x, 'test')?.kind === 'theft';
  }).filter(Boolean).length;
  assert.ok(count(structuredClone(b)) < count(structuredClone(plain)));
});

test('a storefront: Reputation +5 at once, settling higher from then on; once a stage', () => {
  const b = build(clinic(), 'storefront');
  assert.equal(b.state.reputation, 50 + P.storefront.reputation);
  assert.equal(projectOffer(b, 'storefront').reason, 'built-here');
  assert.equal(projectOffer(normalizeBusiness({ ...b, stage: 1 }), 'storefront').ok, true, 'again at the next stage');
  // At 53 a plain business drifts down toward 50; with a storefront it stays.
  const at = (x) => normalizeBusiness({ ...x, state: { ...x.state, reputation: 50 + P.storefront.target } });
  const next = (x) => advanceBusiness(x, x.period.endDay, { weekday: MONDAY, seed: 'test' }).business.state.reputation;
  assert.ok(next(at(clinic())) < 50 + P.storefront.target);
  assert.ok(Math.abs(next(at(b)) - (50 + P.storefront.target)) < 0.5);
});

test('a staff room: a place more for staff, and loyalty rises to 70 with paid weeks', () => {
  const b = build(clinic({ stage: 1 }), 'staffRoom');
  assert.equal(headcountOf(b), BUSINESS_DEFAULTS.staff.headcount[1] + 1);
  assert.equal(projectOffer(b, 'staffRoom').reason, 'built-here');
  const staffed = normalizeBusiness({
    ...b,
    staff: [{ id: 'stf_a', actorId: null, name: 'Hand', source: 'recruit', post: 'floor', bases: { 'skill:Paramedic': 12 }, pct: 1, wage: 108, hiredDay: DAY, status: 'active', owed: 0, loyalty: 65, candidateId: 'a' }],
  });
  const after = advanceBusiness(staffed, staffed.period.endDay, { weekday: MONDAY, seed: 'test' }).business;
  assert.equal(after.staff[0].loyalty, 67, 'above 60 with a staff room');
  // Four in the staff: one more than the stage allows without it.
  const full = normalizeBusiness({ ...staffed, staff: ['a', 'b', 'c'].map((id) => ({ ...staffed.staff[0], id: `stf_${id}`, post: 'security' })) });
  assert.equal(postOpen(full, 'manager').ok, true);
});
