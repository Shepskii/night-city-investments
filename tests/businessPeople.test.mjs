import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, normalizeBusiness, rollSpec, BUSINESS_DEFAULTS, goingRate, wageOf, staffOf,
  loyaltyBand, moonlighting, staffEventWeight, idleStaff, drawEvent, applyDiligence, postBase, archetypeOf, refreshStaffBases, markElsewhere, moveLoyalty, grantedShare,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const ACTORS = { med: 'Medtech', fix: 'Fixer', nova: 'Nova', doc: 'Doc Ruiz' };
const MONDAY = 1;
const DAY = 20003;
const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv, levers: {} }) });
const BUSINESS = { kind: 'skill', skill: 'Business', stat: 'int' };
const PERCEPTION = { kind: 'skill', skill: 'Human Perception', stat: 'emp' };
const st = BUSINESS_DEFAULTS.staff;
const BASES = { nova: { 'skill:Paramedic': 12 }, doc: { 'skill:Paramedic': 10, 'ability:Medicine': 4 } };
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

function clinic({ stage = 1, capacity = 3, till = 5000, archetype = 'clinic' } = {}) {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype, cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: BUSINESS }, MED, { check: check(14, 9, 13) }).business;
  const out = normalizeBusiness({ ...b, stage, till, officers: stage >= 2 ? ['med', 'fix'] : [], state: { ...b.state, capacity, compliance: stage ? 50 : null, reputation: 50 } });
  delete out.period.event;
  return out;
}

/** A recruit already on the staff, as hiring an applicant leaves them. */
const recruit = (id, post = 'floor', { base = 12, loyalty = 50, pct = 1, ...more } = {}) => ({
  id: `stf_${id}`, actorId: null, name: `Hand ${id}`, source: 'recruit', post, bases: { 'skill:Paramedic': base, 'skill:Business': base }, pct, wage: 0,
  hiredDay: DAY - 30, status: 'active', owed: 0, loyalty, candidateId: id, ...more,
});
const withStaff = (b, ...staff) => {
  const out = normalizeBusiness({ ...b, staff });
  for (const s of out.staff) s.wage = wageOf(out, s);
  return out;
};

/** Close the week, with an event set for it (and what was rolled for it), and the traits the GM holds. */
const closeWeek = (b, { event = null, slots = [], traits = {} } = {}) => {
  const c = structuredClone(b);
  if (event) c.period.event = event;
  c.period.slots.push(...slots);
  const out = advanceBusiness(c, c.period.endDay, { weekday: MONDAY, seed: 'test', traits });
  delete out.business.period.event;
  return out;
};
const answered = (band = 'solid') => ({ action: 'respond', by: 'med', band, approach: 'standard', bonus: 0 });

test('Masters ask more: each point of base above Expert costs three times the rate', () => {
  assert.equal(goingRate(15, 1), 135);
  assert.equal(goingRate(16, 1), (16 + 2) * 9);
  assert.equal(goingRate(17, 2), (17 + 4) * 14);
  assert.equal(goingRate(12, 1), 108, 'unchanged below Expert');
});

test('loyalty: it starts from the pay offered, a paid week lifts it to 60, missed wages hurt, and two weeks unpaid they quit', () => {
  let b = apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'hire', actorId: 'doc', post: 'floor', pct: 120 }, MED).business;
  assert.equal(b.staff[0].loyalty, 60, '120% of the going rate: 50 + 2 × 5');
  b = apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'hire', actorId: 'nova', post: 'floor', pct: 120 }, MED).business;
  assert.equal(b.staff[0].loyalty, null, "a player character's loyalty is their own");

  let paid = withStaff(clinic(), recruit('a', 'floor', { loyalty: 59 }));
  paid = closeWeek(paid).business;
  assert.equal(staffOf(paid, 'stf_a').loyalty, 60, 'a paid week: +2, but no higher than 60');
  assert.equal(loyaltyBand(60), 'loyal');

  let broke = withStaff(clinic({ till: -400 }), recruit('a', 'floor', { loyalty: 70 }));
  broke = closeWeek(broke).business;
  const a = staffOf(broke, 'stf_a');
  assert.ok(a.owed > 0);
  assert.equal(a.loyalty, 55, 'a missed wage: −15');
  broke.till = -2000;
  const second = closeWeek(broke);
  assert.equal(staffOf(second.business, 'stf_a'), null, 'two weeks unpaid: they quit');
  assert.equal(second.events.find((e) => e.type === 'periodClosed').digest.staff[0].kind, 'unpaid');
});

test('a sullen employee may quit as the week closes; below 10 they walk out', () => {
  const walk = closeWeek(withStaff(clinic(), recruit('a', 'floor', { loyalty: 5 })));
  assert.equal(walk.business.staff.length, 0);
  assert.equal(walk.events.find((e) => e.type === 'periodClosed').digest.staff[0].kind, 'walked');
  // Below 25, a quarter of the weeks: over many weeks some quit and some stay.
  const outcomes = Array.from({ length: 24 }, (_, i) => {
    const b = withStaff(clinic(), recruit(`q${i}`, 'floor', { loyalty: 15 }));
    return closeWeek(b).business.staff.length;
  });
  assert.ok(outcomes.includes(0) && outcomes.includes(1), outcomes.join(''));
});

test('a second overtime shift costs loyalty; a devoted employee rolls one better', () => {
  let b = withStaff(clinic(), recruit('a', 'floor', { loyalty: 50 }));
  const spec = rollSpec(b, { type: 'action', action: 'promote', use: { kind: 'staff', staffId: 'stf_a' } }, 'med', { day: DAY });
  assert.equal(spec.ok, true, spec.reason);
  b = apply(b, { type: 'action', businessId: 'b1', action: 'promote', use: { kind: 'staff', staffId: 'stf_a' } }, MED, { check: check(7, 6, 15) }).business;
  assert.equal(staffOf(b, 'stf_a').loyalty, 50, 'the first shift is free');
  b = apply(b, { type: 'action', businessId: 'b1', action: 'source', use: { kind: 'staff', staffId: 'stf_a' } }, MED, { check: check(7, 6, 15) }).business;
  assert.equal(staffOf(b, 'stf_a').loyalty, 50 + st.loyalty.extraShift);

  const keen = withStaff(clinic(), recruit('b', 'floor', { loyalty: 80 }));
  const devotedSpec = rollSpec(keen, { type: 'action', action: 'promote', use: { kind: 'staff', staffId: 'stf_b' } }, 'med', { day: DAY });
  assert.equal(devotedSpec.use.base, spec.use.base + 1);
});

test('training: a course or a mentor raises the best skill for the post by 1, once every 4 weeks, at most +4', () => {
  const t = BUSINESS_DEFAULTS.staff.training;
  const b = withStaff(clinic({ till: 20000 }), recruit('a', 'floor', { base: 12 }));
  const wage = staffOf(b, 'stf_a').wage;
  // A course: twice the eb, no mentor needed.
  const course = apply(b, { type: 'train', businessId: 'b1', staffId: 'stf_a', mentor: false }, MED).business;
  assert.equal(course.till, b.till - t.perPoint * 12 * t.courseFactor);
  assert.equal(postBase(staffOf(course, 'stf_a'), 'floor', archetypeOf(course)), 13);
  assert.ok(wageOf(course, staffOf(course, 'stf_a')) > wage, 'their wage follows the new skill');
  assert.ok(course.ledger.some((e) => e.kind === 'trainedCourse'));
  // Once every 4 weeks.
  assert.equal(apply(course, { type: 'train', businessId: 'b1', staffId: 'stf_a' }, MED, { expect: false }).reason, 'train-delay');
  // A mentor whose own skill is higher, four weeks on, rolls Education at the stage's DV (15): the eb once, and their business days.
  const EDUCATION = { kind: 'skill', skill: 'Education', stat: 'int' };
  const lesson = (b0, die, basesOf = (id) => (id === 'med' ? { 'skill:Paramedic': 15 } : null)) => apply(b0, { type: 'trainRoll', businessId: 'b1', staffId: 'stf_a', use: EDUCATION }, MED, {
    day: DAY + t.every, check: check(12, die, 15), context: { basesOf }, expect: false,
  });
  const mentored = lesson(course, 5).business;
  assert.equal(mentored.till, course.till - t.perPoint * 13);
  assert.equal(mentored.period.days.med, t.mentorDays);
  assert.equal(postBase(staffOf(mentored, 'stf_a'), 'floor', archetypeOf(mentored)), 14, 'a pass teaches');
  // A failure teaches nothing, though the eb and days are spent; a fumble costs loyalty too.
  const failed = lesson(course, 2).business;
  assert.equal(postBase(staffOf(failed, 'stf_a'), 'floor', archetypeOf(failed)), 13);
  assert.equal(failed.till, course.till - t.perPoint * 13);
  assert.equal(failed.period.days.med, t.mentorDays);
  assert.ok(failed.ledger.some((e) => e.kind === 'trainedMentorFailed'));
  const fumbled = lesson(course, 0).business;
  assert.equal(staffOf(fumbled, 'stf_a').loyalty, staffOf(course, 'stf_a').loyalty + t.fumbleLoyalty);
  // An exceptional lesson: they can train again in 2 weeks.
  const brilliant = lesson(course, 11).business;
  assert.equal(staffOf(brilliant, 'stf_a').trainedDay + t.every, DAY + t.every + t.quickEvery);
  // A mentor no better than the employee is refused before anything is spent.
  assert.equal(lesson(course, 5, () => ({ 'skill:Paramedic': 13 })).reason, 'no-mentor');
  // Mentoring is always rolled, never by a hired professional or an employee.
  assert.equal(apply(course, { type: 'train', businessId: 'b1', staffId: 'stf_a', mentor: true }, MED, { day: DAY + t.every, expect: false }).reason, 'mentor-roll');
  assert.equal(rollSpec(course, { type: 'trainRoll', staffId: 'stf_a', use: { kind: 'hire', hire: 'good' } }, 'med', { day: DAY + t.every }).reason, 'hire-not-allowed');
  assert.deepEqual(rollSpec(course, { type: 'trainRoll', staffId: 'stf_a' }, 'med', { day: DAY + t.every }).uses.map((u) => u.skill), ['Education', 'Persuasion']);
  // At most +4 from training.
  const full = normalizeBusiness({ ...b, staff: b.staff.map((s) => ({ ...s, training: { 'skill:Paramedic': t.max } })) });
  assert.equal(apply(full, { type: 'train', businessId: 'b1', staffId: 'stf_a' }, MED, { expect: false }).reason, 'train-max');
  // A player character trains with their own Improvement Points.
  const pc = withStaff(clinic(), { ...recruit('p'), source: 'pc', actorId: 'nova', loyalty: null });
  assert.equal(apply(pc, { type: 'train', businessId: 'b1', staffId: 'stf_p' }, MED, { expect: false }).reason, 'not-trainable');
  // An NPC's sheet is read again each week; what training added stays on top.
  const npc = normalizeBusiness({ ...course, staff: course.staff.map((s) => ({ ...s, actorId: 'doc', source: 'npc' })) });
  refreshStaffBases(npc, () => ({ 'skill:Paramedic': 12 }));
  assert.equal(postBase(staffOf(npc, 'stf_a'), 'floor', archetypeOf(npc)), 13);
});

test('two jobs (E3): an NPC on two staffs is marked; shifts are shared; loyalty stops below devoted', () => {
  const doc = (id, more = {}) => ({ ...recruit(id, 'floor'), source: 'npc', actorId: 'doc', candidateId: undefined, ...more });
  const here = withStaff(clinic(), doc('a', { loyalty: 90 }), recruit('r'));
  const there = normalizeBusiness({ ...withStaff(clinic(), doc('x')), id: 'b2', name: 'Rival Clinic' });
  there.period.overtime = { stf_x: 1 };
  assert.equal(markElsewhere(here, [here, there]), true);
  assert.deepEqual(staffOf(here, 'stf_a').elsewhere, { businessId: 'b2', name: 'Rival Clinic', shifts: 1 });
  assert.equal(staffOf(here, 'stf_a').loyalty, BUSINESS_DEFAULTS.staff.loyalty.devoted - 1, 'no longer devoted');
  assert.equal(staffOf(here, 'stf_r').elsewhere, undefined, 'a recruit works here only');
  assert.equal(markElsewhere(here, [here, there]), false, 'nothing new');
  // One shift there and one here: no more this week.
  const use = { kind: 'staff', staffId: 'stf_a' };
  assert.equal(rollSpec(here, { type: 'action', action: 'promote', use }, 'med', { day: DAY }).ok, true);
  here.period.overtime = { stf_a: 1 };
  assert.equal(rollSpec(here, { type: 'action', action: 'promote', use }, 'med', { day: DAY }).reason, 'shifts-elsewhere');
  // Leaving the other job clears it.
  assert.equal(markElsewhere(here, [here]), true);
  assert.equal(staffOf(here, 'stf_a').elsewhere, undefined);
});

test('two jobs: its events come only with someone torn, and each plays out, reaching the other business', () => {
  const torn = (more = {}) => ({ ...recruit('a', 'floor', { loyalty: 60 }), source: 'npc', actorId: 'doc', elsewhere: { businessId: 'b2', name: 'Rival Clinic', shifts: 0 }, ...more });
  const plain = withStaff(clinic(), recruit('a'));
  const b = withStaff(clinic(), torn());
  for (const kind of ['doubleBooked', 'fullTimeOffer', 'talkingShop']) {
    assert.equal(staffEventWeight(plain, kind), 0, `${kind}: nobody torn`);
    assert.ok(staffEventWeight(b, kind) > 0, kind);
  }
  assert.ok(staffEventWeight(b, 'sickDay') > staffEventWeight(plain, 'sickDay'), 'two jobs wear them down');
  const ev = (kind) => ({ kind, staffId: 'stf_a', rival: { businessId: 'b2', name: 'Rival Clinic' } });
  const digest = (out) => out.events.find((e) => e.type === 'periodClosed').digest;
  const cross = (out) => out.events.find((e) => e.type === 'twoJobs');
  // Double-booked: off here unless kept.
  const off = structuredClone(b);
  off.period.event = ev('doubleBooked');
  assert.ok(idleStaff(off).has('stf_a'));
  off.period.slots.push(answered());
  assert.ok(!idleStaff(off).has('stf_a'));
  const lost = closeWeek(b, { event: ev('doubleBooked') });
  assert.match(JSON.stringify(digest(lost).staff), /"kind":"doubleBooked".*"rival":"Rival Clinic"/);
  assert.equal(staffOf(lost.business, 'stf_a').knownElsewhere, true, 'now they know');
  // A full-time offer: gone, unless answered; the other business hears of it.
  const gone = closeWeek(b, { event: ev('fullTimeOffer') });
  assert.equal(staffOf(gone.business, 'stf_a'), null);
  assert.deepEqual(cross(gone), { type: 'twoJobs', businessId: 'b1', kind: 'gainedFullTime', to: 'b2', staffName: 'Hand a' });
  assert.ok(staffOf(closeWeek(b, { event: ev('fullTimeOffer'), slots: [answered()] }).business, 'stf_a'));
  // Talking shop: unanswered, the other business learns about this one; caught well, this one about the other.
  assert.equal(cross(closeWeek(b, { event: ev('talkingShop') })).kind, 'leak');
  assert.equal(cross(closeWeek(b, { event: ev('talkingShop'), slots: [answered('strong')] })).kind, 'learn');
  assert.equal(cross(closeWeek(b, { event: ev('talkingShop'), slots: [answered('solid')] })), undefined, 'caught, but nothing learned');
  // Notes from another business's events reach this one's next digest, once.
  const told = normalizeBusiness({ ...b, pendingNotes: [{ kind: 'gainedFullTime', name: 'Vik', rival: 'Rival Clinic' }] });
  const closed = closeWeek(told);
  assert.match(JSON.stringify(digest(closed).staff), /gainedFullTime/);
  assert.deepEqual(closed.business.pendingNotes, []);
});

test('share grants (E3): at a company, voted on by the shares, up to 5% in all, vesting after 12 weeks into a holding', () => {
  const g = BUSINESS_DEFAULTS.staff.grants;
  const grant = (b0, staffId, pct, expect = true) => apply(b0, { type: 'propose', businessId: 'b1', kind: 'grant', staffId, pct }, MED, { expect });
  assert.equal(grant(withStaff(clinic(), recruit('a')), 'stf_a', 2, false).reason, 'not-company');
  const co = withStaff(clinic({ stage: 2 }), recruit('a', 'floor', { loyalty: 40 }), recruit('b'), { ...recruit('p'), source: 'pc', actorId: 'nova', loyalty: null });
  // The Medtech's majority carries it: vesting, and loyalty up.
  let b = grant(co, 'stf_a', 2).business;
  assert.deepEqual(staffOf(b, 'stf_a').grant, { share: 0.02, grantedDay: DAY, vestDay: DAY + g.vestDays });
  assert.equal(staffOf(b, 'stf_a').loyalty, 60);
  assert.equal(grant(b, 'stf_a', 1, false).reason, 'grant-vesting');
  assert.equal(grant(b, 'stf_b', 3.5, false).reason, 'grant-cap', '2% and 3.5% is past 5%');
  assert.equal(grant(b, 'stf_b', 0.7, false).reason, 'bad-grant', 'half-percent steps');
  // While they vest, loyalty stays at 50 or above.
  const keep = structuredClone(b);
  moveLoyalty(staffOf(keep, 'stf_a'), -40);
  assert.equal(staffOf(keep, 'stf_a').loyalty, g.floor);
  // A player character's grant too; then both vest at the close after their vesting day.
  b = grant(b, 'stf_p', 3).business;
  for (const s of b.staff) if (s.grant) s.grant.vestDay = b.period.endDay;
  const before = b.partners.reduce((a, x) => a + x.units, 0);
  const out = closeWeek(b);
  const after = out.business;
  const total = after.partners.filter((x) => x.status === 'active').reduce((a, x) => a + x.units, 0);
  const npc = after.partners.find((x) => x.actorId === 'npc:stf_a');
  const pc = after.partners.find((x) => x.actorId === 'nova');
  assert.ok(npc.npc && !npc.voting && npc.grant, 'an NPC holds them quietly, like an angel');
  assert.ok(pc && !pc.voting && !pc.npc, 'a player character holds them in their own name');
  // Vested in turn: the NPC's 2% of the company then, the player character's 3% of it after.
  assert.ok(Math.abs(pc.units / total - 0.03) < 0.001, `the player character holds 3% (${pc.units}/${total})`);
  assert.ok(Math.abs(npc.units / (total - pc.units) - 0.02) < 0.001, 'the NPC held 2% before the next grant vested');
  assert.ok(total > before, 'new shares issued');
  assert.equal(staffOf(after, 'stf_a').grant, undefined);
  assert.equal(staffOf(after, 'stf_a').vested, 0.02);
  assert.match(JSON.stringify(out.events.find((e) => e.type === 'periodClosed').digest.staff), /"kind":"vested"/);
  assert.ok(Math.abs(grantedShare(after) - 0.05) < 0.005, 'the 5% is used up');
  // An employee who leaves before vesting loses the grant.
  const left = grant(co, 'stf_a', 2).business;
  left.staff = left.staff.filter((s) => s.id !== 'stf_a');
  assert.equal(grantedShare(left), 0);
});

test('a bonus: quarters of a week\'s wage from the cash, loyalty up 5 for each, once a week', () => {
  const b = withStaff(clinic(), recruit('a', 'floor', { loyalty: 40 }));
  const wage = staffOf(b, 'stf_a').wage;
  const out = apply(b, { type: 'bonus', businessId: 'b1', staffId: 'stf_a', quarters: 2 }, MED);
  assert.equal(out.business.till, b.till - Math.round(wage / 2));
  assert.equal(staffOf(out.business, 'stf_a').loyalty, 50);
  assert.equal(apply(out.business, { type: 'bonus', businessId: 'b1', staffId: 'stf_a', quarters: 1 }, MED, { expect: false }).reason, 'bonus-given');
  assert.equal(apply(b, { type: 'bonus', businessId: 'b1', staffId: 'stf_a', quarters: 5 }, MED, { expect: false }).reason, 'bad-amount');
});

test('pay: a raise lifts loyalty, a cut hurts more; raises asked for at a month\'s end, ignored or refused, cost loyalty', () => {
  const b = withStaff(clinic(), recruit('a', 'floor', { loyalty: 40 }));
  const raised = apply(b, { type: 'propose', businessId: 'b1', kind: 'pay', staffId: 'stf_a', pct: 120 }, MED).business;
  const a = staffOf(raised, 'stf_a');
  assert.equal(a.pct, 1.2);
  assert.equal(a.loyalty, 50, '+5 for each 10%');
  assert.equal(a.wage, Math.round(goingRate(12, 1) * 1.2));
  const cut = apply(b, { type: 'propose', businessId: 'b1', kind: 'pay', staffId: 'stf_a', pct: 90 }, MED).business;
  assert.equal(staffOf(cut, 'stf_a').loyalty, 25, '−5 for the 10%, and −10 for the cut');
  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'pay', staffId: 'stf_a', pct: 100 }, MED, { expect: false }).reason, 'same-pay');

  // A month's end (every fourth week): below 50 they ask for 10% more.
  const month = structuredClone(b);
  month.period.index = 4;
  const asked = closeWeek(month).business;
  assert.equal(staffOf(asked, 'stf_a').ask.pct, 1.1);
  const refused = apply(asked, { type: 'refuseRaise', businessId: 'b1', staffId: 'stf_a' }, MED).business;
  assert.equal(staffOf(refused, 'stf_a').ask, undefined);
  assert.equal(staffOf(refused, 'stf_a').loyalty, staffOf(asked, 'stf_a').loyalty - 10);
  // Agreeing to it (a pay proposal at what they asked) answers it.
  const agreed = apply(asked, { type: 'propose', businessId: 'b1', kind: 'pay', staffId: 'stf_a', pct: 110 }, MED).business;
  assert.equal(staffOf(agreed, 'stf_a').ask, undefined);
  // Ignored until the next month's end: refused.
  const later = structuredClone(asked);
  later.period.index = 8;
  const ignored = closeWeek(later).business;
  assert.ok(staffOf(ignored, 'stf_a').loyalty <= staffOf(asked, 'stf_a').loyalty - 10 + st.loyalty.paidWeek + st.loyalty.profitMonth, 'the raise ignored counts as refused');
});

test('moving an employee to another post with room; their pay follows their skill there', () => {
  const b = withStaff(clinic(), recruit('a', 'floor', { base: 12 }));
  const moved = apply(b, { type: 'movePost', businessId: 'b1', staffId: 'stf_a', post: 'manager' }, MED).business;
  assert.equal(staffOf(moved, 'stf_a').post, 'manager');
  assert.equal(apply(moved, { type: 'movePost', businessId: 'b1', staffId: 'stf_a', post: 'manager' }, MED, { expect: false }).reason, 'same-post');
  const two = withStaff(clinic(), recruit('a', 'floor'), recruit('b', 'manager'));
  assert.equal(apply(two, { type: 'movePost', businessId: 'b1', staffId: 'stf_a', post: 'manager' }, MED, { expect: false }).reason, 'post-taken');
});

test('an advert draws hidden traits, kept off the record; vetting all a post\'s applicants shows them, a strong pass their skill too', () => {
  let traits = {};
  let out;
  // Find an advert that brings someone with a trait (about one in five).
  for (let i = 0; i < 30 && !Object.keys(traits).length; i++) {
    out = apply(clinic(), { type: 'recruitRoll', businessId: 'b1', post: 'floor', use: BUSINESS, key: `ad${i}` }, MED, { check: check(14, 8, 15) });
    traits = out.traits;
  }
  assert.ok(Object.keys(traits).length, 'an advert brought a trait');
  assert.equal(JSON.stringify(out.business).includes(Object.values(traits)[0]), false, 'the trait is not on the record');

  const b = out.business;
  const spec = rollSpec(b, { type: 'vetRoll', post: 'floor', use: PERCEPTION }, 'med', { day: DAY });
  assert.equal(spec.ok, true, spec.reason);
  assert.equal(spec.dv, st.vet.dv);
  const solid = apply(b, { type: 'vetRoll', businessId: 'b1', post: 'floor', use: PERCEPTION }, MED, { check: check(10, 5, 13), context: { traits } }).business;
  assert.equal(solid.till, b.till - st.vet.cost);
  for (const c of solid.candidates) {
    assert.equal(c.vetted, 'traits');
    assert.equal(c.revealed, traits[c.id] ?? 'none');
  }
  assert.equal(rollSpec(solid, { type: 'vetRoll', post: 'floor' }, 'med', { day: DAY }).reason, 'no-applicants', 'checked once');
  const strong = apply(b, { type: 'vetRoll', businessId: 'b1', post: 'floor', use: PERCEPTION }, MED, { check: check(14, 8, 13), context: { traits } }).business;
  assert.ok(strong.candidates.every((c) => c.vetted === 'full'));
  const failed = apply(b, { type: 'vetRoll', businessId: 'b1', post: 'floor', use: PERCEPTION }, MED, { check: check(5, 3, 13), context: { traits } }).business;
  assert.ok(failed.candidates.every((c) => c.vetted === 'failed' && !c.revealed));

  // Hired, they keep what vetting showed, and their trait is still found under the applicant they were.
  const flagged = solid.candidates.find((c) => traits[c.id]);
  const hired = apply(solid, { type: 'propose', businessId: 'b1', kind: 'hire', candidateId: flagged.id }, MED, { context: { traits } }).business;
  const s = hired.staff[0];
  assert.equal(s.candidateId, flagged.id);
  assert.equal(s.revealed, traits[flagged.id]);
  assert.equal(s.loyalty, st.loyalty.start);
});

test('traits at work: a moonlighter turns some overtime down, dedicated staff stay at 40 or more, a connected manager works better', () => {
  const traits = { a: 'moonlighter' };
  let b = withStaff(clinic(), recruit('a'));
  const weeks = Array.from({ length: 12 }, (_, i) => {
    b.period.index = i + 1;
    return moonlighting(b, b.staff[0], traits);
  });
  assert.ok(weeks.includes(true) && weeks.includes(false), weeks.join());
  b.period.index = weeks.indexOf(true) + 1;
  assert.equal(rollSpec(b, { type: 'action', action: 'promote', use: { kind: 'staff', staffId: 'stf_a' } }, 'med', { day: DAY, traits }).reason, 'moonlighting');

  const loyal = withStaff(clinic(), recruit('d', 'floor', { loyalty: 45 }));
  const cut = apply(loyal, { type: 'propose', businessId: 'b1', kind: 'pay', staffId: 'stf_d', pct: 80 }, MED, { context: { traits: { d: 'dedicated' } } }).business;
  assert.equal(staffOf(cut, 'stf_d').loyalty, st.loyalty.dedicatedFloor);

  const plain = closeWeek(withStaff(clinic(), recruit('m', 'manager', { base: 10 })));
  const connected = closeWeek(withStaff(clinic(), recruit('m', 'manager', { base: 10 })), { traits: { m: 'connected' } });
  const total = (out) => out.business.digests.at(-1) && out.events.find((e) => e.type === 'periodClosed').digest.actions.find((a) => a.action === 'work');
  assert.ok(total(plain) && total(connected));
  // The same roll from the seed, three higher.
  assert.ok(['narrow', 'solid', 'strong', 'exceptional'].indexOf(total(connected).band) >= ['narrow', 'solid', 'strong', 'exceptional'].indexOf(total(plain).band));
});

test('firing: a caught thief gets no severance, a corp plant brings Exposure, a sullen hand may hold a grudge', () => {
  const thief = withStaff(clinic(), recruit('t', 'floor', { caught: true }));
  const fired = apply(thief, { type: 'propose', businessId: 'b1', kind: 'fire', staffId: 'stf_t' }, MED);
  assert.equal(fired.business.till, thief.till, 'no severance');
  const plant = apply(withStaff(clinic({ stage: 2 }), recruit('p')), { type: 'propose', businessId: 'b1', kind: 'fire', staffId: 'stf_p' }, MED, { context: { traits: { p: 'corpPlant' } } });
  assert.equal(plant.events.find((e) => e.type === 'fired').exposure, st.traits.plantFired);
  const grudges = Array.from({ length: 16 }, (_, i) => apply(withStaff(clinic(), recruit(`g${i}`, 'floor', { loyalty: 10 })), { type: 'propose', businessId: 'b1', kind: 'fire', staffId: `stf_g${i}` }, MED).business.grudge);
  assert.ok(grudges.includes(true) && grudges.includes(false));
  const next = closeWeek(normalizeBusiness({ ...clinic(), grudge: true }));
  assert.equal(next.business.grudge, false);
});

test('a corp plant reports in each week: Exposure for the GM', () => {
  const out = closeWeek(withStaff(clinic({ stage: 2 }), recruit('p')), { traits: { p: 'corpPlant' } });
  assert.equal(out.events.find((e) => e.type === 'plant').exposure, st.traits.plantExposure);
});

test('staff events join the table only with NPC staff, and only where they fit', () => {
  const none = clinic();
  assert.equal(staffEventWeight(none, 'sickDay'), 0);
  const one = withStaff(clinic(), recruit('a'));
  assert.equal(staffEventWeight(one, 'sickDay'), 2);
  assert.equal(staffEventWeight(one, 'accident'), 0, 'a clinic is not dangerous work');
  assert.equal(staffEventWeight(withStaff(clinic({ archetype: 'garage' }), recruit('a')), 'accident'), 2);
  assert.equal(staffEventWeight(one, 'payDispute'), 0, 'a company with four or more unhappy staff only');
  const unhappy = withStaff(clinic({ stage: 2, capacity: 6 }), ...['a', 'b', 'c', 'd'].map((id) => recruit(id, 'floor', { loyalty: 30 })));
  assert.equal(staffEventWeight(unhappy, 'payDispute'), 3);
  assert.equal(staffEventWeight(one, 'lightFingers', { a: 'lightFingers' }), 3, 'a thief on the staff makes it likelier');
  // A drawn staff event names who it is about.
  for (let i = 0; i < 200; i++) {
    one.period.index = i;
    const e = drawEvent(one, 'test');
    if (e?.kind === 'sickDay') {
      assert.equal(e.staffId, 'stf_a');
      return;
    }
  }
  assert.fail('no sick day drawn in 200 weeks');
});

test('off sick: the post does nothing unless the event is answered', () => {
  const b = withStaff(clinic(), recruit('a', 'floor', { base: 14 }));
  const base = closeWeek(b).events.find((e) => e.type === 'periodClosed').digest.takings;
  const sick = closeWeek(b, { event: { kind: 'sickDay', staffId: 'stf_a' } });
  const digest = sick.events.find((e) => e.type === 'periodClosed').digest;
  assert.ok(digest.takings < base, 'no floor lift');
  assert.equal(digest.staff[0].kind, 'sick');
  const cover = closeWeek(b, { event: { kind: 'sickDay', staffId: 'stf_a' }, slots: [answered()] });
  assert.equal(cover.events.find((e) => e.type === 'periodClosed').digest.takings, base);
  const c = structuredClone(b);
  c.period.event = { kind: 'sickDay', staffId: 'stf_a' };
  assert.ok(idleStaff(c).has('stf_a'));
});

test('an accident at work: medical bills and a week out, unless patched up', () => {
  const b = withStaff(clinic({ archetype: 'garage' }), recruit('a'));
  const hurt = closeWeek(b, { event: { kind: 'accident', staffId: 'stf_a' } });
  const digest = hurt.events.find((e) => e.type === 'periodClosed').digest;
  assert.equal(digest.event.cost, st.events.accident[1]);
  assert.equal(staffOf(hurt.business, 'stf_a').outUntil, b.period.index + 1);
  assert.ok(idleStaff(hurt.business).has('stf_a'), 'still out the next week');
  const fixed = closeWeek(b, { event: { kind: 'accident', staffId: 'stf_a' }, slots: [answered()] });
  assert.equal(fixed.events.find((e) => e.type === 'periodClosed').digest.event.cost, undefined);
});

test('a poaching offer: the best hand leaves, unless answered, given a 10% raise, or devoted', () => {
  const b = withStaff(clinic(), recruit('a', 'floor', { base: 14 }), recruit('b', 'manager', { base: 9 }));
  const event = { kind: 'poaching', staffId: 'stf_a' };
  assert.equal(staffOf(closeWeek(b, { event }).business, 'stf_a'), null);
  assert.ok(staffOf(closeWeek(b, { event, slots: [answered()] }).business, 'stf_a'));
  const raised = apply(b, { type: 'propose', businessId: 'b1', kind: 'pay', staffId: 'stf_a', pct: 110 }, MED).business;
  assert.ok(staffOf(closeWeek(raised, { event }).business, 'stf_a'));
  const keen = withStaff(clinic(), recruit('a', 'floor', { base: 14, loyalty: 80 }));
  assert.ok(staffOf(closeWeek(keen, { event }).business, 'stf_a'));
});

test('light fingers: takings go missing unless the thief is caught; a caught thief with the trait is known for it', () => {
  const b = withStaff(clinic(), recruit('a'), recruit('b', 'manager', { loyalty: 30 }));
  const lost = closeWeek(b, { event: { kind: 'lightFingers' } }).events.find((e) => e.type === 'periodClosed').digest.event;
  assert.ok(lost.change < 0);
  const caught = closeWeek(b, { event: { kind: 'lightFingers' }, slots: [answered()], traits: { a: 'lightFingers' } }).business;
  assert.equal(staffOf(caught, 'stf_a').caught, true, 'the one with the trait, before the least loyal');
  assert.equal(staffOf(caught, 'stf_a').revealed, 'lightFingers');
});

test('the employee a staff event is about cannot be called in to answer it; the others can', () => {
  const b = withStaff(clinic(), recruit('a', 'security', { base: 13 }), recruit('b', 'floor', { base: 13 }));
  b.period.event = { kind: 'poaching', staffId: 'stf_a' };
  const ask = (staffId) => rollSpec(b, { type: 'respond', use: { kind: 'staff', staffId } }, 'med', { day: DAY });
  assert.equal(ask('stf_a').reason, 'staff-involved');
  assert.equal(ask('stf_b').ok, true);
  // The GM's service refuses it too.
  const out = apply(b, { type: 'respond', businessId: 'b1', use: { kind: 'staff', staffId: 'stf_a' } }, MED, { check: check(13, 6, 15), expect: false });
  assert.deepEqual([out.ok, out.reason], [false, 'staff-involved']);
  // An event about nobody in particular takes any employee.
  b.period.event = { kind: 'trouble' };
  assert.equal(ask('stf_a').ok, true);
});

test('a pay dispute: the staff down tools and lose loyalty, unless talked round or all given a bonus', () => {
  const staff = ['a', 'b', 'c', 'd'].map((id) => recruit(id, 'floor', { loyalty: 30 }));
  const b = withStaff(clinic({ stage: 2, capacity: 6, till: 20000 }), ...staff);
  const event = { kind: 'payDispute' };
  const struck = closeWeek(b, { event });
  assert.ok(struck.business.staff.every((s) => s.loyalty <= 30 + st.loyalty.paidWeek + st.loyalty.dispute));
  let bonused = b;
  for (const s of staff) bonused = apply(bonused, { type: 'bonus', businessId: 'b1', staffId: s.id, quarters: 1 }, MED).business;
  const c = structuredClone(bonused);
  c.period.event = event;
  assert.equal(idleStaff(c).size, 0, 'a bonus for everyone settles it');
});

test('a star turn answered well lifts Reputation', () => {
  const b = withStaff(clinic(), recruit('a'));
  const plain = closeWeek(b).business.state.reputation;
  const star = closeWeek(b, { event: { kind: 'starTurn' }, slots: [answered()] }).business.state.reputation;
  assert.ok(star > plain);
});

test('loose lips on a target\'s staff tell due diligence a band more', () => {
  const b = clinic({ stage: 2, till: 5000 });
  const target = { name: 'Rival', bands: {}, value: 10000 };
  const plain = applyDiligence(structuredClone(b), { result: { band: 'failure', success: false }, day: DAY, targetId: 't', target, by: 'med' });
  const leaky = applyDiligence(structuredClone(b), { result: { band: 'failure', success: false }, day: DAY, targetId: 't', target: { ...target, leaky: true }, by: 'med' });
  assert.equal(plain.band, 'failure');
  assert.equal(leaky.band, 'narrow');
  assert.ok(leaky.range);
});
