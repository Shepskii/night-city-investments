import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createEmployer, updateEmployer, normalizeEmployer, employerRoles, employerBoardEntry, canApplyEmployer, recordApplication, decideEmployerApplication,
  offerEmployerJob, answerEmployer, dismissEmployee, canShiftEmployer, workEmployerShift, decideEmployerPromotion, promotedEmployerWage,
  closeEmployerWeeks, employerJob, employeesOf, isEmployerId, BUSINESS_DEFAULTS as P,
} from '../scripts/engine/index.js';

const DAY = 30000;
const R = P.npc.shift;

function arasaka(over = {}) {
  const made = createEmployer({ id: 'emp_ara', companyId: 'ARA', name: 'Arasaka', ticker: 'ARA', archetype: 'security', dv: 17, roles: { security: { count: 2, wage: 400 }, sales: { count: 1, wage: 300 } }, day: DAY, ...over });
  assert.equal(made.ok, true, made.reason);
  return made.employer;
}

/** pc1 hired on a solid roll. */
function hired() {
  const e = arasaka();
  recordApplication(e, { id: 'a1', actorId: 'pc1', name: 'Boar', post: 'security', band: 'solid', day: DAY });
  const done = decideEmployerApplication(e, 'a1', true, DAY);
  assert.equal(done.ok, true);
  return { e, staff: done.staff };
}

test('an employer needs a company, a kind and a role', () => {
  assert.equal(isEmployerId(arasaka().id), true);
  assert.equal(createEmployer({ id: 'emp_x', companyId: '', archetype: 'security', roles: { floor: { count: 1, wage: 100 } }, day: DAY }).reason, 'no-company');
  assert.equal(createEmployer({ id: 'emp_x', companyId: 'X', archetype: 'nope', roles: { floor: { count: 1, wage: 100 } }, day: DAY }).reason, 'bad-archetype');
  assert.equal(createEmployer({ id: 'emp_x', companyId: 'X', archetype: 'clinic', roles: { hand: { count: 1, wage: 100 }, floor: { count: 0, wage: 100 } }, day: DAY }).reason, 'no-roles', 'back room posts and empty roles are dropped');
});

test('the board shows roles with places free, with the kind\'s skills', () => {
  const e = arasaka();
  const entry = employerBoardEntry(e);
  assert.equal(entry.ticker, 'ARA');
  assert.equal(entry.dv, 17);
  assert.deepEqual(entry.roles.map((r) => [r.post, r.wage]), [['security', 400], ['sales', 300]]);
  assert.ok(entry.roles[0].uses.length);
  updateEmployer(e, { open: false });
  assert.equal(employerBoardEntry(e), null, 'not hiring');
});

test('apply once a week; a pass waits for the GM and is hired on a wage by the roll', () => {
  const e = arasaka();
  assert.equal(canApplyEmployer(e, 'pc1', 'security', DAY).ok, true);
  recordApplication(e, { id: 'a1', actorId: 'pc1', name: 'Boar', post: 'security', band: 'strong', day: DAY });
  assert.equal(canApplyEmployer(e, 'pc1', 'security', DAY).reason, 'job-waiting');
  const done = decideEmployerApplication(e, 'a1', true, DAY + 1);
  assert.equal(done.staff.wage, Math.round(400 * P.npc.jobs.pct.strong));
  assert.equal(canApplyEmployer(e, 'pc1', 'sales', DAY + 1).reason, 'already-staff');
  recordApplication(e, { id: 'a2', actorId: 'pc2', name: 'Vex', post: 'sales', band: 'failure', day: DAY });
  assert.equal(canApplyEmployer(e, 'pc2', 'sales', DAY + 3).reason, 'job-wait');
  assert.equal(canApplyEmployer(e, 'pc2', 'sales', DAY + P.npc.jobs.waitDays).ok, true);
});

test('a full role closes', () => {
  const e = arasaka();
  offerEmployerJob(e, { actorId: 'pc2', name: 'Vex', post: 'sales' }, DAY);
  assert.equal(canApplyEmployer(e, 'pc3', 'sales', DAY).reason, 'job-closed', 'an offer holds the place');
  assert.equal(offerEmployerJob(e, { actorId: 'pc3', name: 'Kit', post: 'sales' }, DAY).reason, 'post-full');
});

test('the GM\'s offer: accepted at the role\'s wage, or turned down; quitting is at once', () => {
  const e = arasaka();
  const offered = offerEmployerJob(e, { actorId: 'pc2', name: 'Vex', post: 'sales' }, DAY).staff;
  assert.equal(offered.status, 'offered');
  assert.equal(offered.wage, 300);
  assert.equal(canShiftEmployer(e, 'pc2').reason, 'not-staff', 'not until accepted');
  assert.equal(answerEmployer(e, 'pc2', 'acceptJob', DAY + 2).ok, true);
  assert.equal(offered.hiredDay, DAY + 2);
  assert.equal(answerEmployer(e, 'pc2', 'declineJob', DAY + 2).reason, 'not-offered');
  assert.equal(answerEmployer(e, 'pc2', 'quitJob', DAY + 3).ok, true);
  assert.equal(e.staff.length, 0);
});

test('a new wage for a role reaches those in it', () => {
  const { e, staff } = hired();
  updateEmployer(e, { roles: { security: { count: 2, wage: 500 }, sales: { count: 1, wage: 300 } } });
  assert.equal(staff.wage, 500);
});

test('one shift a week; the close pays the wage and the bonus from outside, and moves standing', () => {
  const { e, staff } = hired();
  assert.equal(workEmployerShift(e, 'pc1', 'exceptional').ok, true);
  assert.equal(canShiftEmployer(e, 'pc1').reason, 'shift-done');
  const out = closeEmployerWeeks(e, DAY + 7);
  assert.equal(out.weeks, 1);
  const slip = out.events.find((x) => x.type === 'payslip');
  assert.equal(slip.paid, 400, 'hired on its first day: a whole week');
  assert.equal(slip.bonus, Math.round(400 * R.bonus.exceptional));
  assert.equal(staff.standing, R.start + R.moves.exceptional);
  assert.deepEqual(e.period, { startDay: DAY + 7, endDay: DAY + 14, shifts: {} });
  assert.equal(closeEmployerWeeks(e, DAY + 13).weeks, 0, 'not before the week ends');
});

test('hired part way through, a part week\'s pay and no penalty', () => {
  const e = arasaka();
  offerEmployerJob(e, { actorId: 'pc2', name: 'Vex', post: 'sales' }, DAY);
  answerEmployer(e, 'pc2', 'acceptJob', DAY + 4);
  const out = closeEmployerWeeks(e, DAY + 7);
  assert.equal(out.events[0].paid, Math.round((300 * 3) / 7));
  assert.equal(e.staff[0].standing, R.start);
});

test('missed weeks warn and then sack with a week\'s pay, caught up if the calendar jumps', () => {
  const { e } = hired();
  const out = closeEmployerWeeks(e, DAY + 7 * 5);
  assert.equal(out.weeks, 5);
  assert.deepEqual(out.events.filter((x) => x.type !== 'payslip').map((x) => x.type), ['shiftWarned', 'shiftSacked']);
  assert.equal(out.wealth.pc1, 400);
  assert.equal(e.staff.length, 0);
  assert.equal(out.events.filter((x) => x.type === 'payslip').length, 5, 'paid for each week worked');
});

test('a long jump starts afresh from today', () => {
  const e = arasaka();
  const out = closeEmployerWeeks(e, DAY + 7 * (P.npc.corp.catchUp + 10));
  assert.equal(out.weeks, P.npc.corp.catchUp);
  assert.equal(e.period.startDay, DAY + 7 * (P.npc.corp.catchUp + 10));
});

test('trusted brings a promotion: 10% more, with no cap', () => {
  const { e, staff } = hired();
  staff.standing = 70;
  workEmployerShift(e, 'pc1', 'solid');
  closeEmployerWeeks(e, DAY + 7);
  assert.equal(staff.promotion, true);
  const promised = promotedEmployerWage(staff);
  assert.equal(decideEmployerPromotion(e, staff.id, true, DAY + 7).ok, true);
  assert.equal(staff.wage, promised);
  assert.equal(staff.wage, Math.round(400 * (P.npc.jobs.pct.solid + R.raise)));
  assert.equal(staff.standing, R.afterPromotion);
  assert.equal(decideEmployerPromotion(e, staff.id, true, DAY + 7).reason, 'no-promotion');
});

test('the GM lets one go with a week\'s pay', () => {
  const { e, staff } = hired();
  const done = dismissEmployee(e, staff.id);
  assert.equal(done.paid, 400);
  assert.equal(e.staff.length, 0);
});

test('Your jobs gets the shape a business job has, with the shift', () => {
  const { e, staff } = hired();
  const job = employerJob(e, staff);
  assert.equal(job.businessId, 'emp_ara');
  assert.equal(job.corp, true);
  assert.equal(job.boss.band, 'reliable');
  assert.equal(job.boss.dv, 17);
  assert.ok(job.boss.uses.length);
  workEmployerShift(e, 'pc1', 'narrow');
  assert.equal(employerJob(e, staff).boss.done, 'narrow');
});

test('employees count as insiders on their company', () => {
  const { e } = hired();
  offerEmployerJob(e, { actorId: 'pc2', name: 'Vex', post: 'sales' }, DAY);
  assert.deepEqual(employeesOf([e], 'ARA'), ['pc1'], 'not one only offered');
  assert.deepEqual(employeesOf([e], 'MIL'), []);
});

test('a stored record reads back the same', () => {
  const { e } = hired();
  workEmployerShift(e, 'pc1', 'strong');
  assert.deepEqual(normalizeEmployer(JSON.parse(JSON.stringify(e))), e);
});
