import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, normalizeBusiness, rollSpec, BUSINESS_DEFAULTS, valuation, listingMilestones, approveBusinessListing,
  rejectBusinessListing, sectorMultiple, floatOptions, totalUnits,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const ACTORS = { med: 'Medtech', fix: 'Fixer' };
const MONDAY = 1;
const DAY = 20003;
const L = BUSINESS_DEFAULTS.listing;
const E = BUSINESS_DEFAULTS;
const check = (base, die, dv, levers = {}) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv, levers }) });
const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };
const ACCOUNTING = { kind: 'skill', skill: 'Accounting', stat: 'int' };
const TRADING = { kind: 'skill', skill: 'Trading', stat: 'cool' };

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: ACTORS, newId: 'b1', seed: 'test', growthRate: 1, listingThreshold: 100000, ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** A clinic chartered 60 days ago, with three monthly reports of 2,000 eb, all at a valuation of 300,000. */
function company({ reported = 2000, reportV = 300000, compliance = 60 } = {}) {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(14, 9, 13) }).business;
  const reports = [1, 2, 3].map((index) => ({ index, fromDay: DAY - 90 + index * 28, toDay: DAY - 62 + index * 28, weeks: 4, takings: 5000, upkeep: 3000, profit: reported, reported, valuation: reportV }));
  const out = normalizeBusiness({
    ...b, stage: 2, till: 20000, assets: 10000, company: { ticker: 'BRC', sector: 'health', charteredDay: DAY - 60 }, officers: ['med', 'fix'],
    state: { ...b.state, capacity: 4, compliance, reputation: 55 }, reports,
    // Founded long ago: its founding money is past the lock-in.
    ledger: b.ledger.map((e) => ({ ...e, day: DAY - 100 })),
  });
  delete out.period.event;
  return out;
}


const R = E.regulator;

test('the chance of a case rises with Exposure; the regulator\'s total adds a bonus by band', async () => {
  const { caseChance, regulatorTotal } = await import('../scripts/engine/index.js');
  assert.deepEqual([caseChance(0), caseChance(5), caseChance(15), caseChance(30)], [0, 0.05, 0.15, 0.35], 'clean, low, moderate, high');
  assert.deepEqual([regulatorTotal(0, () => 0), regulatorTotal(5, () => 0), regulatorTotal(15, () => 0), regulatorTotal(30, () => 0.99)], [15, 15, 17, 28]);
});

test('a case opens once on a company, on triggers too; an officer may answer; only a company can have one', async () => {
  const { openCase, caseAnswerCheck, caseTrigger, caseOf, caseBribe } = await import('../scripts/engine/index.js');
  const b = company();
  assert.equal(openCase(normalizeBusiness({ ...company(), stage: 1 }), { reason: 'gm', day: DAY }).reason, 'not-company');
  assert.equal(openCase(b, { reason: 'report', day: DAY }).ok, true);
  assert.deepEqual([caseOf(b).status, caseOf(b).endDay], ['notice', DAY + R.notice]);
  assert.equal(openCase(b, { reason: 'gm', day: DAY }).reason, 'case-open');
  assert.equal(caseAnswerCheck(b, 'med').ok, true);
  assert.equal(caseAnswerCheck(b, 'nobody').reason, 'not-officer');
  assert.equal(caseTrigger([{ type: 'fired', exposure: 5 }]), 'plant');
  assert.equal(caseTrigger([{ type: 'fired' }]), null, 'firing an honest employee');
  assert.equal(caseTrigger([{ type: 'roll', action: 'shortcuts', band: 'fumble' }]), 'shortcuts');
  assert.equal(caseTrigger([{ type: 'roll', action: 'shortcuts', band: 'failure' }]), null);
  assert.equal(caseBribe({ skill: 'Bribery' }), R.bribe);
  assert.equal(caseBribe({ skill: 'Accounting' }), 0);
});

test('a lost case proposes 5% of book value (10% at high Exposure); the GM\'s approval takes the fine and Compliance, even past zero', async () => {
  const { openCase, loseCase, applyCaseLoss, bookValue } = await import('../scripts/engine/index.js');
  const b = company();
  openCase(b, { reason: 'report', day: DAY });
  const book = bookValue(b);
  assert.equal(loseCase(structuredClone(b), { day: DAY, exposure: 30 }).fine, Math.round(book * R.fineHigh), 'high Exposure');
  const lost = loseCase(b, { day: DAY, exposure: 5 });
  assert.equal(lost.fine, Math.round(book * R.fine));
  assert.deepEqual([b.regCase.status, b.regCase.serious], ['lost', false]);
  const till = b.till;
  const compliance = b.state.compliance;
  const done = applyCaseLoss(b, { day: DAY, fine: till + 500 });
  assert.equal(done.fine, till + 500, 'the GM may change it');
  assert.equal(b.till, -500);
  assert.equal(b.state.compliance, compliance + R.compliance);
  assert.equal(b.regCase, null);
});

test('a serious loss stops a listing application; with none, the last three reports go back to their real figures', async () => {
  const { openCase, loseCase, applyCaseLoss } = await import('../scripts/engine/index.js');
  const applying = normalizeBusiness({ ...company(), listing: { status: 'prospectus', float: 0.25, rolls: {} } });
  openCase(applying, { reason: 'report', day: DAY });
  loseCase(applying, { day: DAY, exposure: 0, fumble: true });
  assert.equal(applying.regCase.serious, true, 'a fumble is serious');
  assert.equal(applyCaseLoss(applying, { day: DAY }).stopped, true);
  assert.deepEqual([applying.listing.status, applying.listing.retryDay], ['failed', DAY + L.retryDays]);

  const inflated = company();
  inflated.reports = inflated.reports.map((r) => ({ ...r, profit: 2000, reported: 2600, valuation: 900000 }));
  openCase(inflated, { reason: 'report', day: DAY });
  loseCase(inflated, { day: DAY, exposure: 30 });
  assert.equal(applyCaseLoss(inflated, { day: DAY }).restated, 3);
  assert.ok(inflated.reports.every((r) => r.reported === 2000 && r.restated === DAY && r.valuation < 900000));

  const plain = company();
  openCase(plain, { reason: 'report', day: DAY });
  loseCase(plain, { day: DAY, exposure: 5 });
  const done = applyCaseLoss(plain, { day: DAY });
  assert.deepEqual([done.stopped, done.restated], [false, 0], 'an ordinary loss is only the fine and Compliance');
});

test('the GM can drop a case', async () => {
  const { openCase, dropCase } = await import('../scripts/engine/index.js');
  const b = company();
  assert.equal(dropCase(b, DAY).reason, 'no-case');
  openCase(b, { reason: 'gm', day: DAY });
  assert.equal(dropCase(b, DAY).ok, true);
  assert.equal(b.regCase, null);
});
