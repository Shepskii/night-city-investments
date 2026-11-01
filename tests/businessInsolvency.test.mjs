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


const units = (b, id) => b.partners.find((x) => x.actorId === id)?.units ?? 0;

test('a company with net assets below zero at two closes in a row goes into administration: no actions, draws or votes, but cash in; a close above zero ends it', async () => {
  const { checkSolvency, solvency, debtsOf } = await import('../scripts/engine/index.js');
  const b = normalizeBusiness({ ...company(), till: 500, assets: 1000, loans: [{ id: 'l1', kind: 'bank', principal: 3000, balance: 3000, rate: 0.01, payment: 150, startedDay: DAY - 50, missed: 0 }] });
  assert.deepEqual(debtsOf(b), { loans: 3000, wages: 0, overdraft: 0, total: 3000 });
  assert.equal(solvency(b), 500 + 1000 - 3000);
  b.proposals = [{ id: 'p1', kind: 'payout', by: 'med', day: DAY, expires: DAY + 7, votes: {} }];
  assert.equal(checkSolvency(b, DAY).entered, false, 'one close is not enough');
  assert.equal(checkSolvency(b, DAY + 7).entered, true);
  assert.equal(b.administration.since, DAY + 7);
  assert.deepEqual(b.proposals, [], 'open proposals end');

  assert.equal(apply(b, { type: 'draw', businessId: 'b1', amount: 10 }, MED, { expect: false }).reason, 'administration');
  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'buyback', budget: 500 }, MED, { expect: false }).reason, 'administration');
  const topped = apply(b, { type: 'contribute', businessId: 'b1', cash: 2000 }, MED).business;
  assert.equal(topped.till, 2500, 'cash in is still taken');
  assert.equal(checkSolvency(topped, DAY + 14).ended, true, 'above zero at the close: out');
  assert.equal(topped.administration, null);

  const shop = normalizeBusiness({ ...b, stage: 1, administration: null, insolventPeriods: 0 });
  checkSolvency(shop, DAY);
  assert.equal(checkSolvency(shop, DAY + 7).entered, false, 'a registered business keeps B1\'s failure rule');
});

test('restructuring turns the debts into shares for the creditors at half book value per share, diluting the holders, with standing hits', async () => {
  const { restructure, unitValue } = await import('../scripts/engine/index.js');
  const b = normalizeBusiness({ ...company(), till: -400, assets: 10000, administration: { since: DAY, net: -100 },
    loans: [{ id: 'l1', kind: 'bank', principal: 9000, balance: 9000, rate: 0.01, payment: 450, startedDay: DAY - 50, missed: 0 }] });
  b.staff = [{ id: 's1', name: 'Nix', status: 'active', source: 'recruit', owed: 300, post: 'floor' }];
  const total = totalUnits(b);
  const rep = b.state.reputation;
  const price = Math.round(unitValue({ ...b, till: 0 }) * 0.5 * 100) / 100;
  const done = restructure(b, DAY + 1);
  assert.equal(done.debts, 9000 + 300 + 400);
  assert.equal(done.price, price);
  assert.equal(done.shares, Math.round(9700 / price));
  assert.equal(units(b, 'npc:creditors'), done.shares);
  assert.equal(b.partners.find((x) => x.actorId === 'npc:creditors').voting, false);
  assert.equal(totalUnits(b), total + done.shares);
  assert.deepEqual([b.loans[0].balance, b.staff[0].owed, b.till], [0, 0, 0], 'a clean sheet');
  assert.equal(b.state.reputation, rep - 10);
  assert.equal(b.administration, null);
});

test('winding up: the assets sell at half value; owed wages first, then the loans, then the holders by shares in eddies; the business closes', async () => {
  const { windUp } = await import('../scripts/engine/index.js');
  const b = normalizeBusiness({ ...company(), till: 1000, assets: 10000, administration: { since: DAY, net: -100 },
    loans: [{ id: 'l1', kind: 'bank', principal: 4000, balance: 4000, rate: 0.01, payment: 200, startedDay: DAY - 50, missed: 0 }] });
  b.staff = [{ id: 's1', name: 'Pat', actorId: 'pc1', status: 'active', source: 'pc', owed: 500, post: 'floor' }];
  const total = totalUnits(b);
  const out = { wealth: {}, events: [] };
  const done = windUp(b, DAY + 1, out);
  // 1,000 cash + 5,000 for the assets = 6,000: 500 wages, 4,000 loans, 1,500 to the holders.
  assert.deepEqual([done.pot, done.wages, done.loans, done.left], [6000, 500, 4000, 1500]);
  assert.equal(out.wealth.pc1, 500, 'the player character\'s owed wage');
  assert.equal(out.wealth.med, Math.floor(units(b, 'med') * done.perShare));
  assert.equal(done.perShare, Math.floor((1500 / total) * 100) / 100);
  assert.equal(b.status, 'closed');
  assert.equal(b.closeReason, 'woundUp');
});
