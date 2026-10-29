import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, rollSpec, milestones, daysLeft, activeProject, normalizeBusiness, SKILLS, BUSINESS_DEFAULTS,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const ACTORS = { med: 'Medtech', fix: 'Fixer' };
const MONDAY = 1;
const DAY = 20003;

const check = (base, die, dv, levers = {}) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv, levers }) });
const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: extra.key ?? `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: ACTORS, newId: 'b1', growthRate: 1, ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** A clinic with two partners: the Medtech with 3,000 units, the Fixer with 1,500, and 6,000 eb in the till. */
function clinic() {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(14, 9, 13) }).business;
  return normalizeBusiness({ ...b, till: 6000 });
}

/** Four full weeks behind it at 120 eb profit, so the side-business milestones are met. */
function seasoned() {
  const b = clinic();
  b.digests = [0, 1, 2, 3].map((i) => ({ index: i + 1, startDay: DAY + 7 * i, endDay: DAY + 7 * (i + 1), profit: 120, takings: 300, upkeep: 180, till: 6000 }));
  return b;
}

test('each partner with a vote has three business days a week', () => {
  const b = clinic();
  assert.equal(daysLeft(b, 'med'), BUSINESS_DEFAULTS.businessDays);
  assert.equal(rollSpec(b, { type: 'action', action: 'work' }, 'med', { day: DAY }).extraAvailable, true);
});

test('extra time adds +1 and spends a business day', () => {
  const b = apply(clinic(), { type: 'action', businessId: 'b1', action: 'work', use: cybertech }, MED, { check: check(12, 1 + 1, 13, { extra: 1 }) }).business;
  assert.equal(b.period.slots[0].total, 15);
  assert.equal(daysLeft(b, 'med'), BUSINESS_DEFAULTS.businessDays - 1);
});

test('an expansion needs a majority of units: the bigger partner carries it alone, the smaller one needs a yes', () => {
  const byMed = apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'expansion' }, MED).business;
  assert.equal(byMed.proposals.length, 0);
  assert.ok(activeProject(byMed), 'two thirds of the units: it passes at once');
  assert.equal(byMed.till, 6000 - 1500);

  const byFix = apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'expansion' }, FIX).business;
  assert.equal(byFix.proposals.length, 1, 'a third of the units is not enough');
  const no = apply(byFix, { type: 'vote', businessId: 'b1', proposalId: byFix.proposals[0].id, yes: false }, MED);
  assert.equal(no.business.proposals.length, 0);
  assert.equal(no.events.at(-1).type, 'proposalFailed');
  const yes = apply(byFix, { type: 'vote', businessId: 'b1', proposalId: byFix.proposals[0].id, yes: true }, MED);
  assert.ok(activeProject(yes.business));
});

test('a project is finished with business days, and raises Capacity up to the stage\'s ceiling', () => {
  let b = apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'expansion' }, MED).business;
  const project = activeProject(b);
  const before = b.state.capacity;
  assert.equal(apply(b, { type: 'addDays', businessId: 'b1', projectId: project.id, days: 4 }, MED, { expect: false }).reason, 'no-days');
  b = apply(b, { type: 'addDays', businessId: 'b1', projectId: project.id, days: 2 }, MED).business;
  assert.equal(activeProject(b).days, 2);
  const done = apply(b, { type: 'addDays', businessId: 'b1', projectId: project.id, days: 1 }, FIX);
  assert.equal(done.events.at(-1).type, 'projectDone');
  assert.equal(activeProject(done.business), null);
  assert.ok(Math.abs(done.business.state.capacity - Math.min(1.6, before + 0.25)) < 1e-9);
  assert.equal(apply(done.business, { type: 'propose', businessId: 'b1', kind: 'expansion' }, MED).business.projects.length, 2, 'another one can start');
});

test('the business days reset each week', () => {
  let b = apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'expansion' }, MED).business;
  b = apply(b, { type: 'addDays', businessId: 'b1', projectId: activeProject(b).id, days: 2 }, MED).business;
  const next = advanceBusiness(b, b.period.endDay, { weekday: MONDAY }).business;
  assert.equal(daysLeft(next, 'med'), BUSINESS_DEFAULTS.businessDays);
});

test('the registration checklist: four full weeks, 100 eb a week, Reputation 50, and the fee in the till', () => {
  const fresh = milestones(clinic());
  assert.equal(fresh.met, false);
  assert.deepEqual(fresh.items.map((i) => i.id), ['weeks', 'profit', 'reputation', 'fee']);
  const ready = milestones(seasoned());
  assert.equal(ready.met, true, JSON.stringify(ready.items));
  const short = milestones(normalizeBusiness({ ...seasoned(), till: 300 }));
  assert.equal(short.items.find((i) => i.id === 'fee').met, false);
});

test('stepping up needs every partner, then a registration roll; the fee is paid either way', () => {
  assert.equal(apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'stepUp' }, MED, { expect: false }).reason, 'milestones');
  let b = apply(seasoned(), { type: 'propose', businessId: 'b1', kind: 'stepUp' }, MED).business;
  assert.equal(b.proposals.length, 1, 'unanimous, so the Fixer must agree too');
  assert.equal(rollSpec(b, { type: 'stepUpRoll' }, 'med', { day: DAY }).reason, 'not-agreed');
  b = apply(b, { type: 'vote', businessId: 'b1', proposalId: b.proposals[0].id, yes: true }, FIX).business;
  assert.equal(b.stepUp.approved, true);

  const spec = rollSpec(b, { type: 'stepUpRoll', use: SKILLS.bureaucracy }, 'med', { day: DAY });
  assert.equal(spec.dv, 15);
  assert.equal(rollSpec(b, { type: 'stepUpRoll', use: SKILLS.persuasion }, 'med', { day: DAY }).dv, 17, 'Persuasion at DV +2');

  const failed = apply(b, { type: 'stepUpRoll', businessId: 'b1', use: SKILLS.bureaucracy }, MED, { check: check(6, 4, 15) }).business;
  assert.deepEqual([failed.stage, failed.till, failed.stepUp.retryDay], [0, 6000 - 500, DAY + 7]);
  assert.equal(rollSpec(failed, { type: 'stepUpRoll', use: SKILLS.bureaucracy }, 'med', { day: DAY + 3 }).reason, 'step-up-delay');

  const passed = apply(b, { type: 'stepUpRoll', businessId: 'b1', use: SKILLS.bureaucracy }, MED, { check: check(12, 9, 15) });
  assert.equal(passed.business.stage, 1);
  assert.equal(passed.business.state.compliance, 55, 'a strong registration');
  assert.equal(passed.business.till, 6000 - 500);
  assert.ok(passed.events.some((e) => e.type === 'steppedUp'));
});

test('a registered business has two slots at DV 15, pays licence fees, and its Compliance drifts back to 50', () => {
  const base = clinic();
  const b = normalizeBusiness({ ...base, stage: 1, state: { ...base.state, compliance: 70 } });
  assert.equal(rollSpec(b, { type: 'action', action: 'work', use: cybertech }, 'med', { day: DAY }).dv, 15);
  const one = apply(b, { type: 'action', businessId: 'b1', action: 'work', use: cybertech }, MED, { check: check(14, 5, 15) }).business;
  assert.equal(rollSpec(one, { type: 'action', action: 'promote', use: SKILLS.persuasion }, 'fix', { day: DAY }).ok, true, 'a second slot');
  const closed = advanceBusiness(b, b.period.endDay, { weekday: MONDAY }).business;
  assert.ok(closed.state.compliance < 70 && closed.state.compliance > 50);
  const side = advanceBusiness(clinic(), b.period.endDay, { weekday: MONDAY }).business;
  assert.ok(closed.digests[0].upkeep > side.digests[0].upkeep, 'rent and licence fees are dearer than a side business\'s');
});

test('a proposal nobody settles lapses after seven days', () => {
  const b = apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'expansion' }, FIX).business;
  const later = advanceBusiness(b, DAY + 8, { weekday: MONDAY });
  assert.equal(later.business.proposals.length, 0);
  assert.ok(later.events.some((e) => e.type === 'proposalLapsed'));
});
