import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, normalizeBusiness, rollSpec, BUSINESS_DEFAULTS,
  levelOf, postBase, goingRate, wageOf, postOpen, staffOf, ARCHETYPES, postBest,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const NOVA = { id: 'nova', name: 'Nova', wealth: 100 };
const ACTORS = { med: 'Medtech', fix: 'Fixer', nova: 'Nova', doc: 'Doc Ruiz' };
const MONDAY = 1;
const DAY = 20003;
const check = (base, die, dv, levers = {}) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv, levers }) });
const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };
const BUSINESS = { kind: 'skill', skill: 'Business', stat: 'int' };
const st = BUSINESS_DEFAULTS.staff;

/** Nova, a player character with Paramedic 12 (stat + skill), and Doc Ruiz, an NPC Medtech with Medicine 4. */
const BASES = {
  nova: { 'skill:Paramedic': 12, 'skill:Cybertech': 9, 'skill:Business': 6 },
  doc: { 'skill:Paramedic': 10, 'ability:Medicine': 4 },
};
const CONTEXT = {
  approval: false, weekday: MONDAY, actors: ACTORS, newId: 'b1', seed: 'test', growthRate: 1,
  staffActors: { nova: 'pc', doc: 'npc' }, basesOf: (id) => BASES[id] ?? null,
};

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: request.key ?? `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check,
    context: { ...CONTEXT, ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** An open clinic of the Medtech's (who holds the majority) and the Fixer's, at a stage, with no event this week. */
function clinic({ stage = 1, capacity = 3, till = 5000 } = {}) {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(14, 9, 13) }).business;
  const out = normalizeBusiness({ ...b, stage, till, state: { ...b.state, capacity, compliance: stage ? 50 : null, reputation: 50 } });
  delete out.period.event;
  return out;
}

const close = (b) => {
  const out = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' });
  delete out.business.period.event;
  return out;
};

/** Hire on the partners' say-so (the Medtech's majority carries it). */
const hire = (b, terms) => apply(b, { type: 'propose', businessId: 'b1', kind: 'hire', pct: 100, ...terms }, MED).business;
const recruit = (b, post, die = 8, key = 'r1') => apply(b, { type: 'recruitRoll', businessId: 'b1', post, use: BUSINESS, key }, MED, { check: check(14, die, 15) });

test('a base reads as a level; a post counts its own skills, a fitting role ability as rank + 9, a lower skill 3 less', () => {
  assert.deepEqual([5, 8, 9, 12, 13, 15, 16, 20].map((x) => levelOf(x)), ['green', 'green', 'skilled', 'skilled', 'expert', 'expert', 'master', 'master']);
  const arch = ARCHETYPES.clinic;
  assert.equal(postBase({ bases: BASES.nova }, 'floor', arch), 12, 'Paramedic, a clinic trade skill');
  assert.equal(postBase({ bases: BASES.doc }, 'floor', arch), 13, 'Medicine 4 counts as 13');
  assert.equal(postBase({ bases: BASES.nova }, 'manager', arch), 9, 'Business 6, or the trade a level lower: 12 − 3');
  const doc = postBest({ bases: BASES.doc }, 'floor', arch);
  assert.deepEqual([doc.use.ability, doc.base], ['Medicine', 13], 'the use that counts, for the Skill column');
  const nova = postBest({ bases: BASES.nova }, 'manager', arch);
  assert.deepEqual([nova.use.skill, nova.adj], ['Paramedic', -3]);
  assert.equal(goingRate(12, 0), 60);
  assert.equal(goingRate(12, 1), 108);
  assert.equal(goingRate(12, 2), 168);
});

test('headcount by stage, one manager, floor staff no more than the Capacity, and posts that wait for a stage', () => {
  const side = clinic({ stage: 0, capacity: 1.2 });
  assert.equal(postOpen(side, 'bookkeeper').reason, 'post-later');
  const one = hire(side, { actorId: 'nova', post: 'floor' });
  assert.equal(postOpen(one, 'manager').reason, 'no-headcount', 'an offer waiting takes the place');
  const reg = hire(clinic({ capacity: 1.5 }), { actorId: 'nova', post: 'floor' });
  assert.equal(postOpen(reg, 'floor').reason, 'no-floor-room', 'Capacity 1.5: room for one on the floor');
  assert.equal(postOpen(hire(reg, { actorId: 'doc', post: 'manager' }), 'manager').reason, 'post-taken');
});

test('recruiting costs eb and finds a candidate whose level the band sets; a failure finds nobody; once a week', () => {
  const b = clinic();
  const out = recruit(b, 'floor', 8);
  const applicants = out.business.candidates;
  assert.equal(out.business.till, b.till - st.recruit.cost[1]);
  // A strong advert (14 + 8 against 15): two or three applicants, base 10 to 14, asking 90% to 115%.
  assert.ok(applicants.length >= 2 && applicants.length <= 3, `${applicants.length} applicants`);
  for (const a of applicants) {
    assert.ok(a.base >= 10 && a.base <= 14, `base ${a.base}`);
    assert.ok(a.pct >= 0.9 && a.pct <= 1.15, `asks ${a.pct}`);
    assert.equal(a.level, levelOf(a.base));
    assert.ok(a.name.includes(' '));
    assert.equal(a.post, 'floor');
  }
  assert.deepEqual(applicants.map((a) => a.id).slice(0, 2), ['r1-1', 'r1-2']);
  assert.equal(rollSpec(out.business, { type: 'recruitRoll', post: 'floor' }, 'med', { day: DAY + 3 }).reason, 'recruit-delay');
  assert.equal(recruit(b, 'floor', 0).business.candidates.length, 0, 'a fumble brings nobody');
  // A failed advert (14 + 0, a fumble aside): one weak applicant who asks well over the going rate.
  const weak = apply(b, { type: 'recruitRoll', businessId: 'b1', post: 'floor', use: BUSINESS, key: 'r9' }, MED, { check: check(10, 3, 15) }).business.candidates;
  assert.equal(weak.length, 1);
  assert.ok(weak[0].base <= 8 && weak[0].pct >= 1.1);
  // A new advert for the post replaces the applicants still waiting for it.
  const again = apply(out.business, { type: 'recruitRoll', businessId: 'b1', post: 'floor', use: BUSINESS, key: 'r2' }, MED, { day: DAY + 7, check: check(10, 3, 15) }).business.candidates;
  assert.deepEqual(again.map((a) => a.id), ['r2-1']);
  assert.equal(rollSpec(b, { type: 'recruitRoll', post: 'sales' }, 'med', { day: DAY }).reason, 'post-later');
});

test('hiring a recruit starts them at once; a character is offered the job and accepts it from their own character', () => {
  let b = recruit(clinic(), 'floor', 8).business;
  const applicant = b.candidates[0];
  b = hire(b, { candidateId: applicant.id, pct: 150 });
  const recruitStaff = b.staff[0];
  assert.equal(recruitStaff.status, 'active');
  assert.equal(recruitStaff.wage, Math.round(goingRate(applicant.base, 1) * applicant.pct), 'hired on what they asked, whatever pay was proposed');
  assert.equal(b.candidates.length, b.candidates.filter((c) => c.id !== applicant.id).length);
  assert.equal(b.candidates.some((c) => c.id === applicant.id), false);

  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'hire', actorId: 'nova', post: 'floor', pct: 70 }, MED, { expect: false }).reason, 'bad-wage');
  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'hire', actorId: 'fix', post: 'manager' }, MED, { expect: false }).reason, 'not-staff');
  b = hire(b, { actorId: 'nova', post: 'manager' });
  assert.equal(staffOf(b, 'stf_nova').status, 'offered');
  assert.deepEqual(staffOf(b, 'stf_nova').bases, BASES.nova, 'read from the sheet');
  b = apply(b, { type: 'acceptJob', businessId: 'b1' }, NOVA).business;
  assert.equal(staffOf(b, 'stf_nova').status, 'active');
  assert.equal(staffOf(b, 'stf_nova').hiredDay, DAY);
});

test('floor staff lift the takings, wages are paid when the week closes, a player character\'s on their payslip', () => {
  const plain = close(clinic()).business.digests.at(-1);
  let b = hire(clinic(), { actorId: 'nova', post: 'floor' });
  b = apply(b, { type: 'acceptJob', businessId: 'b1' }, NOVA).business;
  const out = close(b);
  const week = out.business.digests.at(-1);
  const wage = goingRate(12, 1);
  assert.ok(week.takings > plain.takings, `${week.takings} > ${plain.takings}`);
  assert.equal(Math.round(week.takings / plain.takings * 1000) / 1000, Math.round((1 + (12 - 6) * 0.015) * 1000) / 1000, 'a 9% lift');
  assert.ok(Math.abs(week.wages - Math.round(wage * Math.min(1, (b.period.endDay - b.period.startDay) / 7))) <= 1);
  assert.equal(week.profit, week.takings - week.upkeep - week.wages);
  assert.equal(out.wealth.nova ?? 0, 0, 'not straight to their sheet');
  assert.equal(out.events.find((e) => e.type === 'payslip' && e.actorId === 'nova').paid, week.wages, 'on the payslip, for the mail to carry');
  assert.ok(out.business.ledger.some((e) => e.kind === 'wages'));
});

test('wages the cash cannot cover are owed and paid first the next week', () => {
  let b = hire(clinic({ till: 0 }), { actorId: 'nova', post: 'floor' });
  b = apply(b, { type: 'acceptJob', businessId: 'b1' }, NOVA).business;
  b = normalizeBusiness({ ...b, till: -5000 });
  const out = close(b);
  assert.ok(staffOf(out.business, 'stf_nova').owed > 0);
  assert.equal(out.wealth.nova ?? 0, 0);
  assert.ok(out.business.digests.at(-1).owed > 0);
});

test('an employee called in for overtime rolls their best for it, at its DV, for half a week\'s wage, two shifts a week', () => {
  let b = hire(clinic(), { actorId: 'doc', post: 'floor' });
  b = apply(b, { type: 'acceptJob', businessId: 'b1' }, { id: 'doc', name: 'Doc Ruiz', wealth: 0 }).business;
  const use = { kind: 'staff', staffId: 'stf_doc' };
  const spec = rollSpec(b, { type: 'action', action: 'work', use }, 'med', { day: DAY });
  assert.equal(spec.ok, true, spec.reason);
  assert.equal(spec.use.via, 'skill:Paramedic', 'Paramedic 10 beats Medicine rank 4 for a roll');
  assert.equal(spec.use.base, 10);
  assert.equal(spec.extraAvailable, false);
  const pay = Math.round(wageOf(b, staffOf(b, 'stf_doc')) * st.overtime.roll);
  assert.equal(spec.overtime, pay);
  const worked = apply(b, { type: 'action', businessId: 'b1', action: 'work', use }, MED, { check: check(10, 6, 15) }).business;
  assert.equal(worked.till, b.till - pay);
  assert.equal(worked.period.slots[0].by, 'stf_doc');
  assert.equal(worked.period.slots[0].use, 'staff:stf_doc');
  assert.equal(worked.period.overtime.stf_doc, 1);
  const helped = apply(worked, { type: 'assist', businessId: 'b1', forAction: 'promote', use }, MED, { check: check(10, 6, 13) }).business;
  assert.equal(helped.till, worked.till - Math.round(wageOf(b, staffOf(b, 'stf_doc')) * st.overtime.help));
  assert.ok(helped.period.helpers.includes('stf_doc'));
  assert.equal(rollSpec(helped, { type: 'action', action: 'promote', use }, 'med', { day: DAY }).reason, 'no-shifts');
  assert.equal(rollSpec(helped, { type: 'assist', forAction: 'source', use: BUSINESS }, 'med', { day: DAY }).ok, true, 'the partner who called them in may still help');
});

test('a manager works the shop when no partner does; security answers trouble nobody answered', () => {
  let b = recruit(clinic(), 'manager', 8).business;
  b = hire(b, { candidateId: 'r1-1' });
  const managed = close(b).business.digests.at(-1);
  assert.equal(managed.worked, true);
  assert.equal(managed.actions[0].action, 'work');
  assert.equal(managed.actions[0].staff, true);

  let g = recruit(clinic(), 'security', 8).business;
  g = hire(g, { candidateId: 'r1-1' });
  g = normalizeBusiness({ ...g, period: { ...g.period, event: { kind: 'shakedown' } } });
  const guarded = advanceBusiness(g, g.period.endDay, { weekday: MONDAY, seed: 'test' }).business.digests.at(-1);
  assert.notEqual(guarded.event.outcome, 'unanswered');
  assert.ok(guarded.actions.some((a) => a.action === 'respond' && a.staff));
});

test('firing pays a week\'s wage in severance; an employee can quit, and turn an offer down', () => {
  let b = hire(clinic(), { actorId: 'nova', post: 'floor' });
  assert.equal(apply(b, { type: 'declineJob', businessId: 'b1' }, NOVA).business.staff.length, 0);
  b = apply(b, { type: 'acceptJob', businessId: 'b1' }, NOVA).business;
  const fired = apply(b, { type: 'propose', businessId: 'b1', kind: 'fire', staffId: 'stf_nova' }, MED);
  assert.equal(fired.business.staff.length, 0);
  assert.equal(fired.wealth.nova, goingRate(12, 1));
  assert.equal(fired.business.till, b.till - goingRate(12, 1));
  assert.equal(apply(b, { type: 'quitJob', businessId: 'b1' }, NOVA).business.staff.length, 0);
});

test('at a company, a bookkeeper gives the report its +1, and a publicist lifts Reputation', () => {
  let b = clinic({ stage: 2, capacity: 6, till: 20000 });
  b = normalizeBusiness({ ...b, company: { ticker: 'BRC', sector: 'health', charteredDay: DAY - 1 }, officers: ['med', 'fix'], reportWeeks: 3 });
  b = recruit(b, 'bookkeeper', 8).business;
  b = hire(b, { candidateId: 'r1-1' });
  assert.equal(rollSpec(b, { type: 'reportRoll' }, 'med', { day: DAY }).bonusAvailable, true);
  assert.equal(rollSpec(b, { type: 'recruitRoll', post: 'publicist' }, 'med', { day: DAY }).reason, 'recruit-delay');
  const plain = close(b).business.state.reputation;
  b = hire(b, { actorId: 'doc', post: 'publicist' });
  b = apply(b, { type: 'acceptJob', businessId: 'b1' }, { id: 'doc', name: 'Doc Ruiz', wealth: 0 }).business;
  const out = close(b).business;
  assert.ok(out.state.reputation > plain, `${out.state.reputation} > ${plain}`);
});
