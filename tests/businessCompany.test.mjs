import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, normalizeBusiness, rollSpec, reportCheck, BUSINESS_DEFAULTS,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const ACTORS = { med: 'Medtech', fix: 'Fixer' };
const MONDAY = 1;
const DAY = 20003;
const check = (base, die, dv, levers = {}) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv, levers }) });
const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };
const BUSINESS = { kind: 'skill', skill: 'Business', stat: 'int' };
const BRIBERY = { kind: 'skill', skill: 'Bribery', stat: 'cool' };
const ACCOUNTING = { kind: 'skill', skill: 'Accounting', stat: 'int' };
const BUREAUCRACY = { kind: 'skill', skill: 'Bureaucracy', stat: 'int' };

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: ACTORS, newId: 'b1', seed: 'test', growthRate: 1, ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** A chartered company with no event this week: Reputation 55, Compliance 50, Capacity 4. */
function company() {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(14, 9, 13) }).business;
  const out = normalizeBusiness({
    ...b, stage: 2, till: 20000, assets: 10000, company: { ticker: 'BRC', sector: 'health', charteredDay: DAY - 1 }, officers: ['med', 'fix'],
    state: { ...b.state, capacity: 4, compliance: 50, reputation: 55 },
  });
  delete out.period.event;
  return out;
}

const take = (b, action, use, die, extra = {}) => apply(b, { type: 'action', businessId: 'b1', action, use }, extra.actor ?? MED, { check: check(14, die, 17, extra.levers) }).business;
const close = (b) => {
  const out = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' });
  delete out.business.period.event;
  return out;
};

test('a company takes the five company actions, with three slots, at DV 17; the shop actions are gone', () => {
  const b = company();
  assert.equal(rollSpec(b, { type: 'action', action: 'contracts', use: BUSINESS }, 'med', { day: DAY }).dv, 17);
  const alt = rollSpec(b, { type: 'action', action: 'contracts', use: { kind: 'skill', skill: 'Persuasion', stat: 'cool' } }, 'med', { day: DAY });
  assert.equal(alt.dv, 19, 'an alternative skill at DV +2');
  assert.equal(rollSpec(b, { type: 'action', action: 'work', use: cybertech }, 'med', { day: DAY }).reason, 'bad-action');
  let c = take(b, 'contracts', BUSINESS, 6);
  c = take(c, 'books', ACCOUNTING, 6, { actor: FIX });
  c = take(c, 'permits', BUREAUCRACY, 6);
  assert.equal(rollSpec(c, { type: 'action', action: 'relations', use: { kind: 'skill', skill: 'Trading', stat: 'cool' } }, 'fix', { day: DAY }).reason, 'no-slot');
});

test('the company actions move the week: contracts the takings, the books the cost, permits Compliance, shortcuts a trail', () => {
  const quiet = close(company()).business.digests.at(-1);
  assert.equal(quiet.worked, false, 'no contracts: an unworked week');

  let b = take(company(), 'contracts', BUSINESS, 8);
  b = take(b, 'books', ACCOUNTING, 8, { actor: FIX });
  b = take(b, 'permits', BUREAUCRACY, 8);
  const out = close(b);
  const week = out.business.digests.at(-1);
  assert.equal(week.worked, true);
  assert.ok(week.takings > quiet.takings, `contracts lift the takings: ${week.takings} > ${quiet.takings}`);
  assert.ok(out.business.state.costFactor < 1, 'the books cut the Cost base');
  assert.ok(out.business.state.compliance > 50, 'permits lift Compliance');

  const shady = close(take(company(), 'shortcuts', BRIBERY, 8));
  assert.ok(shady.events.some((e) => e.type === 'shortcuts' && e.exposure > 0), 'shortcuts always leave Exposure');
  assert.ok(shady.business.digests.at(-1).takings > quiet.takings);
});

test('every four weeks the company publishes a report; it can be prepared only in its last week', () => {
  let b = company();
  assert.equal(reportCheck(b).reason, 'not-report-week');
  for (let i = 0; i < 3; i++) b = close(b).business;
  assert.equal(b.reportWeeks, 3);
  assert.equal(reportCheck(b).ok, true, 'the fourth week');
  const prepared = apply(b, { type: 'reportRoll', businessId: 'b1', use: ACCOUNTING }, MED, { check: check(14, 8, 15) }).business;
  assert.equal(prepared.reportPrep.band, 'strong');
  assert.equal(reportCheck(prepared).reason, 'report-prepared');
  const out = close(prepared);
  const report = out.business.reports.at(-1);
  assert.equal(report.weeks, 4);
  assert.equal(report.profit, out.business.digests.slice(-4).reduce((a, d) => a + d.profit, 0));
  assert.equal(report.reported, Math.round(report.profit + Math.abs(report.profit) * BUSINESS_DEFAULTS.report.shift.strong));
  assert.equal(out.business.reportWeeks, 0);
  assert.ok(out.events.some((e) => e.type === 'reportPublished'));
});

test('aggressive reporting (Bold) doubles the shift and leaves Exposure; an unprepared report shows what was earned', () => {
  let b = company();
  for (let i = 0; i < 3; i++) b = close(b).business;
  const bold = apply(b, { type: 'reportRoll', businessId: 'b1', use: ACCOUNTING }, MED, { check: check(14, 8, 15, { approach: 'bold' }) });
  assert.equal(bold.business.reportPrep.bold, true);
  assert.ok(bold.events.find((e) => e.action === 'report').exposure >= BUSINESS_DEFAULTS.report.boldExposure);
  const boldReport = close(bold.business).business.reports.at(-1);
  const shift = BUSINESS_DEFAULTS.report.shift[bold.business.reportPrep.band] * 2;
  assert.equal(boldReport.reported, Math.round(boldReport.profit + Math.abs(boldReport.profit) * shift));
  const plain = close(b).business.reports.at(-1);
  assert.equal(plain.reported, plain.profit);
  assert.equal(plain.prep, undefined);
});

test('only officers run a company; any holder may still help, and officers are elected and dismissed by a majority of shares', () => {
  const b = normalizeBusiness({ ...company(), officers: ['med'] });
  assert.equal(rollSpec(b, { type: 'action', action: 'contracts', use: BUSINESS }, 'fix', { day: DAY }).reason, 'not-officer');
  assert.equal(rollSpec(b, { type: 'assist', forAction: 'contracts', use: { kind: 'skill', skill: 'Library Search', stat: 'int' } }, 'fix', { day: DAY }).ok, true, 'a holder may help');
  const elected = apply(b, { type: 'propose', businessId: 'b1', kind: 'elect', actorId: 'fix' }, MED).business;
  assert.deepEqual(elected.officers.sort(), ['fix', 'med'], 'the Medtech holds the majority');
  assert.equal(apply(elected, { type: 'propose', businessId: 'b1', kind: 'elect', actorId: 'fix' }, MED, { expect: false }).reason, 'already-officer');
  const dismissed = apply(elected, { type: 'propose', businessId: 'b1', kind: 'dismiss', actorId: 'fix' }, MED).business;
  assert.deepEqual(dismissed.officers, ['med']);
  assert.equal(apply(dismissed, { type: 'propose', businessId: 'b1', kind: 'dismiss', actorId: 'med' }, MED, { expect: false }).reason, 'last-officer');
});

test('an internal audit costs eb, can be done once a week, and tells the officers the Exposure band; a strong one wipes some out', () => {
  const b = company();
  const out = apply(b, { type: 'auditRoll', businessId: 'b1', use: ACCOUNTING }, MED, { check: check(14, 8, 15), context: { exposure: 12 } });
  assert.equal(out.business.till, b.till - BUSINESS_DEFAULTS.info.auditCost);
  assert.equal(out.business.lastAudit.band, 'strong');
  assert.equal(out.business.lastAudit.exposure, 'low', '12 less the 5 a strong audit wipes out: low');
  assert.equal(out.business.lastAudit.found, 'low', 'what it found, before clearing some up');
  // The test world's case: 6 found ("low"), an exceptional audit clears it all; it says it found low.
  const cleared = apply(b, { type: 'auditRoll', businessId: 'b1', use: ACCOUNTING }, MED, { check: check(14, 10, 15), context: { exposure: 6 } }).business;
  assert.deepEqual([cleared.lastAudit.found, cleared.lastAudit.exposure], ['low', 'clean']);
  const nothing = apply(b, { type: 'auditRoll', businessId: 'b1', use: ACCOUNTING }, MED, { check: check(14, 10, 15), context: { exposure: 0 } }).business;
  assert.equal(nothing.lastAudit.found, undefined, 'nothing to clear: only the band');
  assert.equal(out.events.find((e) => e.action === 'audit').exposure, -5);
  assert.equal(rollSpec(out.business, { type: 'auditRoll', use: ACCOUNTING }, 'med', { day: DAY + 3 }).reason, 'info-delay');
  assert.equal(rollSpec(out.business, { type: 'auditRoll', use: ACCOUNTING }, 'med', { day: DAY + 7 }).ok, true);
  const blind = apply(b, { type: 'auditRoll', businessId: 'b1', use: ACCOUNTING }, MED, { check: check(8, 3, 15), context: { exposure: 40 } }).business;
  assert.equal(blind.lastAudit.exposure, undefined, 'a failed audit reveals nothing');
});

test('due diligence on another business tells how it stands and roughly what it is worth', () => {
  const target = { name: 'Rival Clinic', bands: { reputation: 'good', capacity: 'busy', costs: 'fair' }, value: 40000 };
  const ctx = { targets: { rival: target } };
  const b = company();
  assert.equal(rollSpec(b, { type: 'diligenceRoll', use: { kind: 'skill', skill: 'Library Search', stat: 'int' } }, 'med', { day: DAY }).reason, 'bad-target');
  // The player's roll dialog has only the name typed: a rival's name may be rolled for, the company's own may not.
  assert.equal(rollSpec(b, { type: 'diligenceRoll', targetName: 'Some Rival', use: { kind: 'skill', skill: 'Library Search', stat: 'int' } }, 'med', { day: DAY }).ok, true);
  assert.equal(rollSpec(b, { type: 'diligenceRoll', targetName: ` ${b.name.toUpperCase()} `, use: { kind: 'skill', skill: 'Library Search', stat: 'int' } }, 'med', { day: DAY }).reason, 'bad-target');
  assert.equal(rollSpec(b, { type: 'diligenceRoll', targetId: b.id, use: { kind: 'skill', skill: 'Library Search', stat: 'int' } }, 'med', { day: DAY }).reason, 'bad-target');
  const out = apply(b, { type: 'diligenceRoll', businessId: 'b1', targetId: 'rival', use: { kind: 'skill', skill: 'Library Search', stat: 'int' } }, MED, { check: check(14, 8, 15), context: ctx }).business;
  const found = out.intel.at(-1);
  assert.deepEqual([found.name, found.bands.reputation], ['Rival Clinic', 'good']);
  assert.deepEqual(found.range, [36000, 44000], 'a strong roll: within 10%');
  assert.equal(out.till, b.till - BUSINESS_DEFAULTS.info.diligenceCost);
  const miss = apply(b, { type: 'diligenceRoll', businessId: 'b1', targetId: 'rival', use: { kind: 'skill', skill: 'Library Search', stat: 'int' } }, MED, { check: check(8, 3, 15), context: ctx }).business;
  assert.equal(miss.intel.at(-1).bands, undefined);
});
