import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createNpcCompany, hasJobBoard, openRoles, boardEntry, canApply, recordApplication, decideApplication, autoHires, wageOf, useKey, BUSINESS_DEFAULTS as P } from '../scripts/engine/index.js';

const DAY = 20003;
const company = (over = {}) => {
  const out = createNpcCompany({ id: 'n1', name: 'Kiroshi Fish', archetype: 'clinic', owner: { id: 'npc1', name: 'Mr Hands' }, stage: 1, level: 'skilled', profile: 'steady', cash: 5000, day: DAY, weekday: 1, seed: 'test', ...over });
  assert.equal(out.ok, true, out.reason);
  return out.business;
};
const ctx = { basesOf: () => ({ 'skill:Cybertech': 12 }) };
const apply = (b, band = 'solid', actorId = 'pc1', post = 'floor', day = DAY) => recordApplication(b, { id: `a_${actorId}`, actorId, name: 'Boar', post, band, day });

test('only an NPC\'s open business, registered or larger, has a board', () => {
  assert.equal(hasJobBoard(company()), true);
  assert.equal(hasJobBoard(company({ stage: 0 })), false);
  assert.deepEqual(openRoles(company({ stage: 0 })), []);
  assert.equal(hasJobBoard({ ...company(), npcRun: null }), false);
  assert.equal(hasJobBoard({ ...company(), status: 'closed' }), false);
});

test('it offers open roles, not filled ones or the back room\'s', () => {
  const roles = openRoles(company()).map((r) => r.post);
  assert.ok(roles.includes('floor'));
  assert.equal(roles.includes('manager'), false, 'it has one');
  for (const post of ['hand', 'launderer', 'fixer']) assert.equal(roles.includes(post), false);
});

test('a role says what skills it takes and a rough wage', () => {
  const floor = openRoles(company()).find((r) => r.post === 'floor');
  assert.ok(floor.uses.length);
  assert.ok(floor.wage > 0);
});

test('what players are shown', () => {
  const entry = boardEntry(company(), 'Mr Hands');
  assert.equal(entry.owner, 'Mr Hands');
  assert.equal(entry.dv, 15);
  assert.equal('till' in entry, false);
  assert.equal(boardEntry(company({ stage: 0 }), 'x'), null);
});

test('who can\'t apply', () => {
  const b = company();
  assert.equal(canApply(b, 'pc1', 'floor', DAY).ok, true);
  assert.equal(canApply(b, 'npc1', 'floor', DAY).reason, 'is-partner');
  assert.equal(canApply(b, 'pc1', 'manager', DAY).reason, 'post-taken');
  assert.equal(canApply(b, 'pc1', 'hand', DAY).reason, 'job-closed');
  assert.equal(canApply(company({ stage: 0 }), 'pc1', 'floor', DAY).reason, 'job-closed');
});

test('a failed roll is refused at once, and they wait a week', () => {
  const b = company();
  assert.equal(apply(b, 'failure').result, 'refused');
  assert.deepEqual(b.applications, []);
  assert.equal(canApply(b, 'pc1', 'floor', DAY + 6).reason, 'job-wait');
  assert.equal(canApply(b, 'pc1', 'floor', DAY + 7).ok, true);
  assert.equal(apply(company(), 'fumble').result, 'refused');
});

test('a pass waits for the GM, and one application at a time', () => {
  const b = company();
  assert.equal(apply(b, 'narrow').result, 'waiting');
  assert.equal(b.applications.length, 1);
  assert.equal(canApply(b, 'pc1', 'floor', DAY + 30).reason, 'job-waiting');
  assert.equal(canApply(b, 'pc2', 'floor', DAY).ok, true, 'someone else may');
});

test('hired, they start at once, paid by how the roll went', () => {
  const wageFor = (band) => {
    const b = company();
    apply(b, band);
    const out = decideApplication(b, 'a_pc1', true, DAY, ctx);
    assert.equal(out.ok, true, out.reason);
    assert.deepEqual(b.applications, []);
    assert.equal(out.staff.status, 'active');
    assert.equal(out.staff.source, 'pc');
    assert.equal(out.staff.hiredDay, DAY);
    return out.staff.pct;
  };
  assert.equal(wageFor('narrow'), 0.9);
  assert.equal(wageFor('solid'), 1);
  assert.equal(wageFor('strong'), 1.1);
  assert.equal(wageFor('exceptional'), 1.2);
});

test('an NPC company caps what it pays a player character, week after week', () => {
  const b = company();
  apply(b, 'exceptional');
  const out = decideApplication(b, 'a_pc1', true, DAY, { basesOf: () => Object.fromEntries(openRoles(b).find((r) => r.post === 'floor').uses.map((u) => [useKey(u), 18])) });
  const guide = openRoles(company()).find((r) => r.post === 'floor').wage;
  assert.equal(out.staff.wage, Math.round(guide * P.npc.jobs.wageCap));
  assert.equal(wageOf(b, out.staff), Math.round(guide * P.npc.jobs.wageCap));
  assert.equal(wageOf({ ...b, npcRun: null }, out.staff) > out.staff.wage, true, 'a business run by players pays what the rule says');
});

test('turned down, the application goes', () => {
  const b = company();
  apply(b);
  const out = decideApplication(b, 'a_pc1', false, DAY, ctx);
  assert.deepEqual([out.ok, out.hired], [true, false]);
  assert.deepEqual(b.applications, []);
  assert.deepEqual(b.staff.filter((s) => s.actorId === 'pc1'), []);
});

test('a role filled meanwhile can\'t be given twice', () => {
  const b = company();
  apply(b, 'solid', 'pc1', 'floor');
  apply(b, 'solid', 'pc2', 'floor');
  apply(b, 'solid', 'pc3', 'floor');
  assert.equal(decideApplication(b, 'a_pc1', true, DAY, ctx).ok, true);
  assert.equal(decideApplication(b, 'a_pc2', true, DAY, ctx).reason, 'no-headcount');
  assert.equal(b.applications.length, 2, 'it stays for the GM to turn down');
  assert.equal(decideApplication(b, 'gone', true, DAY, ctx).reason, 'no-application');
});

test('which rolls a world may hire by itself', () => {
  assert.equal(autoHires('narrow'), false);
  for (const band of ['solid', 'strong', 'exceptional']) assert.equal(autoHires(band), true);
});

test('every wage band and word is there', () => {
  for (const band of P.npc.jobs.autoBands) assert.ok(P.npc.jobs.pct[band]);
  const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url))).NCI;
  for (const k of ['job-closed', 'job-waiting', 'job-wait', 'no-application']) assert.ok(lang.Business.Reason[k], k);
  assert.ok(lang.Business.Done.jobApply);
  assert.ok(lang.Pending.Kind.jobApplication);
  assert.ok(lang.Pending.Need.jobApplication);
  assert.ok(lang.Settings.JobAuto.Name);
});
