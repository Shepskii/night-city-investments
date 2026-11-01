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


const roll = (band, total = 18) => ({ ok: true, result: { band, total, dv: 15, approach: 'normal', luck: 0, extra: 0 } });
const BUREAUCRACY = { kind: 'skill', skill: 'Bureaucracy', stat: 'int' };
const hide = { ok: true, fee: 500, broker: 'Vex' };

test('layers: the broker\'s nominee first, then named shells, up to three; a failed roll adds none; the strength goes to the hidden state, not the record', async () => {
  const { masksOf, outerMask } = await import('../scripts/engine/index.js');
  let b = company();
  assert.equal(apply(b, { type: 'hideRoll', businessId: 'b1', use: BUREAUCRACY }, MED, { check: roll('solid'), context: { hide: { ok: false, reason: 'no-broker' } }, expect: false }).reason, 'no-broker');
  const failed = apply(b, { type: 'hideRoll', businessId: 'b1', use: BUREAUCRACY }, MED, { check: roll('failure', 12), context: { hide } });
  assert.equal(masksOf(failed.business, 'med').length, 0);
  assert.equal(failed.events.find((e) => e.type === 'layerRolled').fee, 500, 'the fee is paid anyway');

  const one = apply(b, { type: 'hideRoll', businessId: 'b1', use: BUREAUCRACY }, MED, { check: roll('solid', 19), context: { hide } });
  b = one.business;
  assert.deepEqual(outerMask(b, 'med'), { kind: 'nominee', name: 'Vex', day: DAY, lastFee: DAY });
  assert.deepEqual(one.layerTotals, [{ holderId: 'med', index: 0, total: 19 }]);
  assert.equal(JSON.stringify(b.masks).includes('19'), false, 'the strength is not on the record');

  assert.equal(apply(b, { type: 'hideRoll', businessId: 'b1', use: BUREAUCRACY }, MED, { check: roll('solid'), context: { hide }, expect: false }).reason, 'no-name');
  b = apply(b, { type: 'hideRoll', businessId: 'b1', name: 'Kestrel Holdings', use: BUREAUCRACY }, MED, { check: roll('strong', 22), context: { hide } }).business;
  const fixed = apply(b, { type: 'hideRoll', businessId: 'b1', use: BUREAUCRACY }, FIX, { check: roll('solid'), context: { hide } }).business;
  assert.equal(apply(fixed, { type: 'hideRoll', businessId: 'b1', name: 'kestrel holdings', use: BUREAUCRACY }, FIX, { check: roll('solid'), context: { hide }, expect: false }).reason, 'name-taken', 'a shell name must be new on this register');
  b = apply(b, { type: 'hideRoll', businessId: 'b1', name: 'Arc Light', use: BUREAUCRACY }, MED, { check: roll('solid'), context: { hide } }).business;
  assert.deepEqual(masksOf(b, 'med').map((m) => m.name), ['Vex', 'Kestrel Holdings', 'Arc Light']);
  assert.equal(apply(b, { type: 'hideRoll', businessId: 'b1', name: 'Fourth', use: BUREAUCRACY }, MED, { check: roll('solid'), context: { hide }, expect: false }).reason, 'layers-full');

  b = apply(b, { type: 'dropLayer', businessId: 'b1' }, MED).business;
  assert.equal(outerMask(b, 'med').name, 'Kestrel Holdings', 'the outermost comes off');
});

test('monthly fees fall due every 28 days; a lapsed layer takes the ones outside it; a holder who sells out loses their masks', async () => {
  const { layerFeesDue, dropLayers, pruneMasks, layerFees } = await import('../scripts/engine/index.js');
  const b = normalizeBusiness({ ...company(), masks: { med: [{ kind: 'nominee', name: 'Vex', day: DAY, lastFee: DAY }, { kind: 'shell', name: 'K', day: DAY + 5, lastFee: DAY + 5 }] } });
  assert.deepEqual(layerFeesDue(b, DAY + 27), []);
  assert.deepEqual(layerFeesDue(b, DAY + 28), [{ holderId: 'med', index: 0 }]);
  assert.equal(layerFeesDue(b, DAY + 33).length, 2);
  dropLayers(b, 'med', 0);
  assert.equal(b.masks.med, undefined, 'the nominee lapsing takes the shell outside it');
  assert.deepEqual(layerFees(100000), { setup: 1000, monthly: 250 });
  assert.deepEqual(layerFees(1000), { setup: 500, monthly: 50 }, 'the minimums');
  const gone = normalizeBusiness({ ...company(), masks: { fix: [{ kind: 'nominee', name: 'Vex', day: DAY, lastFee: DAY }] } });
  gone.partners.find((x) => x.actorId === 'fix').units = 0;
  assert.equal(pruneMasks(gone), true);
  assert.deepEqual(gone.masks, {});
});

test('concealment: hiding more than 5% of a listed company; NCPD\'s monthly look rises with heat, and sees through when its roll beats the outer layer plus 2 for each beneath', async () => {
  const { concealedHolders, layerDefence, auditConcealment, unmask } = await import('../scripts/engine/index.js');
  const total = totalUnits(company());
  const listed = normalizeBusiness({ ...company(), listing: { status: 'listed', shares: total }, masks: { med: [{ kind: 'nominee', name: 'Vex', day: DAY, lastFee: DAY }] } });
  assert.deepEqual(concealedHolders(listed).map((x) => x.holderId), ['med']);
  assert.deepEqual(concealedHolders(normalizeBusiness({ ...listed, listing: null })), [], 'a private company has no disclosure threshold');
  assert.equal(layerDefence([17, 21]), 23);
  assert.equal(layerDefence([]), 0);
  const seq = (...xs) => () => xs.shift();
  assert.equal(auditConcealment([20], 0, seq(0.5)).audited, false, '10% at no heat');
  assert.equal(auditConcealment([20], 100, seq(0.55, 0.9)).audited, true, '60% at 100 heat (the most)');
  // NCPD rolls 14 + 1d10: 0.95 is a 10, so 24 against 21 + 2 = 23.
  assert.deepEqual(auditConcealment([17, 21], 0, seq(0.01, 0.95)), { audited: true, total: 24, defence: 23, unmasked: true });
  assert.equal(auditConcealment([17, 21], 0, seq(0.01, 0.5)).unmasked, false, '20 does not beat 23');
  assert.equal(unmask(listed, 'med'), true);
  assert.deepEqual(listed.masks, {});
});
