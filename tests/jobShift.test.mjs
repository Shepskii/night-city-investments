import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  createNpcCompany, recordApplication, decideApplication, canShift, workShift, shiftLift, payShiftBonuses, shiftWeek, decidePromotion, standingOf, bossBand, shiftUses, shiftedIn, noteShiftDay,
  advanceBusiness, wageOf, postRate, promotedWage, BUSINESS_DEFAULTS as P,
} from '../scripts/engine/index.js';

const DAY = 20003;
const R = P.npc.shift;
const ctx = { basesOf: () => ({}) };

/** A company with a player character, pc1, working the floor. */
function employed(over = {}) {
  const made = createNpcCompany({ id: 'n1', name: 'Kiroshi Fish', archetype: 'clinic', owner: { id: 'npc1', name: 'Mr Hands' }, stage: 1, level: 'skilled', profile: 'steady', cash: 5000, day: DAY, weekday: 1, seed: 'test', ...over });
  const b = made.business;
  recordApplication(b, { id: 'a1', actorId: 'pc1', name: 'Boar', post: 'floor', band: 'solid', day: DAY });
  decideApplication(b, 'a1', true, b.period.startDay - 1, ctx);
  b.period.event = null;
  return { b, staff: b.staff.find((s) => s.actorId === 'pc1') };
}
const out = () => ({ wealth: {}, events: [] });

test('standing starts at 50 and is shown as a band', () => {
  const { staff } = employed();
  assert.equal(standingOf(staff), 50);
  assert.equal(bossBand(19), 'thinIce');
  assert.equal(bossBand(20), 'shaky');
  assert.equal(bossBand(50), 'reliable');
  assert.equal(bossBand(75), 'trusted');
});

test('one shift a week, only by a player on the staff', () => {
  const { b } = employed();
  assert.equal(canShift(b, 'pc1').ok, true);
  assert.equal(canShift(b, 'pc2').reason, 'not-staff');
  assert.equal(workShift(b, 'pc1', 'solid').ok, true);
  assert.equal(canShift(b, 'pc1').reason, 'shift-done');
  assert.equal(canShift({ ...b, npcRun: null }, 'pc1').reason, 'job-closed');
});

test('the role\'s own skills', () => {
  const { b, staff } = employed();
  assert.ok(shiftUses(b, staff).length);
});

test('a shift lifts the takings, and a fumble costs', () => {
  const { b } = employed();
  assert.equal(shiftLift(b), 0);
  workShift(b, 'pc1', 'strong');
  assert.equal(shiftLift(b), R.lift.strong);
  b.period.shifts.pc1 = 'fumble';
  assert.equal(shiftLift(b), R.lift.fumble);
});

test('a good shift pays a bonus from the cash, as far as it goes', () => {
  const { b, staff } = employed();
  workShift(b, 'pc1', 'exceptional');
  const till = b.till;
  const paid = payShiftBonuses(b, DAY);
  assert.equal(paid.pc1, Math.round(staff.wage * R.bonus.exceptional));
  assert.equal(b.till, till - paid.pc1);
  assert.equal(b.ledger.at(-1).kind, 'shiftBonus');
  const poor = employed().b;
  workShift(poor, 'pc1', 'exceptional');
  poor.till = 10;
  assert.equal(payShiftBonuses(poor, DAY).pc1, 10);
  const failed = employed().b;
  workShift(failed, 'pc1', 'failure');
  assert.deepEqual(payShiftBonuses(failed, DAY), {});
});

test('standing moves with the shift, and a missed week costs', () => {
  const week = (band) => {
    const { b, staff } = employed();
    if (band) workShift(b, 'pc1', band);
    shiftWeek(b, 1, DAY, out());
    return staff.standing;
  };
  for (const band of Object.keys(R.moves)) assert.equal(week(band), 50 + R.moves[band], band);
  assert.equal(week(null), 50 + R.skip);
});

test('a shift worked at another job that week costs nothing here', () => {
  const { b, staff } = employed();
  const { startDay, endDay } = b.period;
  shiftWeek(b, 1, DAY, out(), P, { pc1: [startDay + 2] });
  assert.equal(staff.standing, 50, 'excused');
  const late = employed();
  shiftWeek(late.b, 1, DAY, out(), P, { pc1: [late.b.period.endDay] });
  assert.equal(late.staff.standing, 50 + R.skip, 'a shift after the week ended does not count');
  assert.equal(shiftedIn({ pc1: [startDay] }, 'pc1', startDay, endDay), true);
  assert.equal(shiftedIn({}, 'pc1', startDay, endDay), false);
  let days = {};
  for (let d = 0; d < 12; d++) days = noteShiftDay(days, 'pc1', d);
  assert.deepEqual(days.pc1, [4, 5, 6, 7, 8, 9, 10, 11], 'the last few kept');
});

test('a part week, or one they were hired during, costs nothing', () => {
  const part = employed();
  shiftWeek(part.b, 0.5, DAY, out());
  assert.equal(part.staff.standing, 50);
  const fresh = employed();
  fresh.staff.hiredDay = fresh.b.period.startDay + 2;
  shiftWeek(fresh.b, 1, DAY, out());
  assert.equal(fresh.staff.standing, 50);
});

test('four missed weeks bring a warning, the next the sack with a week\'s pay', () => {
  const { b, staff } = employed();
  const weeks = [];
  for (let i = 0; i < 4; i++) {
    const o = out();
    shiftWeek(b, 1, DAY, o);
    weeks.push(o.events.map((e) => e.type));
  }
  assert.deepEqual(weeks.slice(0, 3), [[], [], []]);
  assert.deepEqual(weeks[3], ['shiftWarned']);
  assert.equal(staff.warned, true);
  const o = out();
  shiftWeek(b, 1, DAY, o);
  assert.equal(o.events[0].type, 'shiftSacked');
  assert.ok(o.wealth.pc1 > 0, 'a week\'s pay');
  assert.equal(b.staff.some((s) => s.actorId === 'pc1'), false);
});

test('a good week after a warning lifts it', () => {
  const { b, staff } = employed();
  staff.standing = 15;
  staff.warned = true;
  workShift(b, 'pc1', 'exceptional');
  shiftWeek(b, 1, DAY, out());
  assert.equal(staff.standing, 30);
  assert.equal(staff.warned, undefined);
});

test('trusted brings a promotion for the GM, then a raise or not now', () => {
  const { b, staff } = employed();
  staff.standing = 70;
  workShift(b, 'pc1', 'solid');
  shiftWeek(b, 1, DAY, out());
  assert.equal(staff.promotion, true);
  const before = staff.pct;
  assert.equal(decidePromotion(b, staff.id, true, DAY).ok, true);
  assert.equal(staff.pct, Math.round((before + R.raise) * 100) / 100);
  assert.equal(staff.standing, R.afterPromotion);
  assert.equal(staff.promotion, undefined);
  assert.equal(decidePromotion(b, staff.id, true, DAY).reason, 'no-promotion');
  staff.standing = 90;
  shiftWeek(b, 1, DAY + 7, out());
  assert.equal(staff.promotion, undefined, 'not again so soon');
  shiftWeek(b, 1, DAY + R.promoteEvery, out());
  assert.equal(staff.promotion, true);
  decidePromotion(b, staff.id, false, DAY + R.promoteEvery);
  assert.equal(staff.pct, Math.round((before + R.raise) * 100) / 100, 'not now: no raise');
});

test('a promotion at the wage cap lifts the cap: one at the top is raised too', () => {
  const { b, staff } = employed();
  staff.pct = 5;
  staff.wage = wageOf(b, staff);
  const guide = postRate(staff.post, P.npc.jobs.guideBase, b.stage);
  assert.equal(staff.wage, Math.round(guide * P.npc.jobs.wageCap), 'at the cap');
  staff.promotion = true;
  const promised = promotedWage(b, staff);
  decidePromotion(b, staff.id, true, DAY);
  assert.equal(staff.promotions, 1);
  assert.equal(staff.wage, Math.round(guide * (P.npc.jobs.wageCap + R.raise)));
  assert.equal(staff.wage, promised, 'Pending shows what Promote pays');
  staff.promotion = true;
  decidePromotion(b, staff.id, true, DAY + R.promoteEvery);
  assert.equal(staff.wage, Math.round(guide * (P.npc.jobs.wageCap + 2 * R.raise)), 'and again');
  staff.promotion = true;
  decidePromotion(b, staff.id, false, DAY + 2 * R.promoteEvery);
  assert.equal(staff.promotions, 2, 'not now: no step up');
});

test('a player business has no shifts', () => {
  const { b, staff } = employed();
  b.npcRun = null;
  assert.equal(canShift(b, 'pc1').reason, 'job-closed');
  shiftWeek(b, 1, DAY, out());
  assert.equal(staff.standing, undefined);
});

test('a real week closes with the shift on it: lift, bonus on the payslip, standing', () => {
  const { b } = employed();
  workShift(b, 'pc1', 'strong');
  const result = advanceBusiness(b, b.period.endDay, { weekday: 1, seed: 'test' });
  const slip = result.events.find((e) => e.type === 'payslip' && e.actorId === 'pc1');
  assert.ok(slip.bonus > 0);
  assert.equal(result.business.staff.find((s) => s.actorId === 'pc1').standing, 50 + R.moves.strong);
  assert.equal(result.business.period.shifts, undefined, 'a new week starts clean');
});

test('every word is there', () => {
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url))).NCI;
  for (const [, band] of R.bands) assert.ok(lang.Jobs.Standing[band], band);
  for (const k of ['shift-done', 'no-promotion']) assert.ok(lang.Business.Reason[k], k);
  for (const k of ['Work', 'ShiftTitle', 'ShiftHint', 'ShiftDone', 'StandingLine', 'Warned', 'WarnedMail', 'Sacked', 'Promoted', 'Promote', 'NotNow', 'JobSubject']) assert.ok(lang.Jobs[k], k);
  assert.ok(lang.Jobs.Payslip.Bonus);
  assert.ok(lang.Jobs.NoJobs && lang.Business.Tab.jobs, 'the Jobs tab');
  assert.ok(lang.Business.Done.shiftRoll);
  assert.ok(lang.Business.Ledger.shiftBonus);
  assert.ok(lang.Pending.Kind.promotion && lang.Pending.Need.promotion);
});
