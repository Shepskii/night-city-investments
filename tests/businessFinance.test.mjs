import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, rollSpec, normalizeBusiness, shareOf, unitValue, totalUnits, averageProfit, SKILLS, BUSINESS_DEFAULTS,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const SOLO = { id: 'solo', name: 'Solo', wealth: 3000 };
const ACTORS = { med: 'Medtech', fix: 'Fixer', solo: 'Solo' };
const MONDAY = 1;
const DAY = 20003;
const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv }) });
const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: extra.key ?? `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: ACTORS, newId: 'b1', seed: 'test', growthRate: 1, ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/** A two-partner clinic (Medtech 3,000 units, Fixer 1,500) with no event this week, at `stage`, with four weeks of 200 eb profit behind it. */
function clinic(stage = 0, till = 3000) {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(14, 9, 13) }).business;
  const out = normalizeBusiness({ ...b, stage, till, state: { ...b.state, capacity: 1, compliance: stage ? 50 : null } });
  delete out.period.event;
  out.digests = [0, 1, 2, 3].map((i) => ({ index: i + 1, startDay: DAY - 28 + 7 * i, endDay: DAY - 21 + 7 * i, profit: 200, takings: 400, upkeep: 200, till }));
  return out;
}

const closeWeek = (b) => advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' });
const noEvent = (b) => {
  delete b.period.event;
  return b;
};

test('a fixer lends on a majority of units, and is repaid with interest as each week closes', () => {
  const b = apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'fixerLoan', amount: 1000 }, MED).business;
  assert.equal(b.till, 4000, 'the Medtech holds the majority, so it passes at once');
  const loan = b.loans[0];
  assert.deepEqual([loan.kind, loan.balance, loan.rate, loan.payment], ['fixer', 1000, 0.05, 100]);

  const plain = closeWeek(clinic()).business.digests.at(-1);
  const week = closeWeek(b).business;
  const d = week.digests.at(-1);
  assert.deepEqual([d.interest, d.repaid], [50, 100]);
  assert.equal(d.profit, plain.profit - 50, 'interest counts against the profit');
  assert.equal(week.loans[0].balance, 900);
  assert.equal(week.till, 4000 + d.profit - 100);
  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'fixerLoan', amount: 500 }, MED, { expect: false }).reason, 'loan-open');
  assert.equal(apply(clinic(), { type: 'propose', businessId: 'b1', kind: 'fixerLoan', amount: 5000 }, MED, { expect: false }).reason, 'bad-amount', 'over a side business\'s limit');
});

test('a missed fixer payment costs a late fee and Reputation, and the collectors come next week', () => {
  const b = apply(clinic(0, 0), { type: 'propose', businessId: 'b1', kind: 'fixerLoan', amount: 1000 }, MED).business;
  b.till = -800; // spent, and the week will not cover it
  const week = closeWeek(b).business;
  assert.equal(week.loans[0].missed, 1);
  assert.equal(week.loans[0].balance, 1000 + 50 + 10);
  assert.deepEqual(week.digests.at(-1).missed, ['fixer']);
  assert.equal(week.period.event.kind, 'collectors');
});

test('only a registered business can go to a bank, after the partners agree and a roll', () => {
  assert.equal(apply(clinic(0), { type: 'propose', businessId: 'b1', kind: 'bankLoan' }, MED, { expect: false }).reason, 'not-registered');
  let b = apply(clinic(1), { type: 'propose', businessId: 'b1', kind: 'bankLoan' }, MED).business;
  assert.equal(b.approved.bankLoan, true);
  const spec = rollSpec(b, { type: 'loanRoll', use: SKILLS.accounting }, 'fix', { day: DAY });
  assert.equal(spec.dv, 15);
  assert.equal(averageProfit(b), 200);

  const strong = apply(b, { type: 'loanRoll', businessId: 'b1', use: SKILLS.accounting, amount: 9999 }, FIX, { check: check(12, 9, 15) });
  const loan = strong.business.loans[0];
  assert.deepEqual([loan.kind, loan.principal, loan.rate], ['bank', 200 * 14, 0.01], 'strong: 14 weeks of profit, at 1% a week');
  assert.equal(strong.business.approved.bankLoan, false, 'the agreement is used up');

  const refused = apply(b, { type: 'loanRoll', businessId: 'b1', use: SKILLS.accounting, amount: 1000 }, FIX, { check: check(6, 4, 15) }).business;
  assert.equal(refused.loans.length, 0);
  assert.equal(refused.retry.bankLoan, DAY + 14);
});

test('a missed bank payment costs Compliance; a loan can be paid off early', () => {
  let b = apply(clinic(1), { type: 'propose', businessId: 'b1', kind: 'bankLoan' }, MED).business;
  b = apply(b, { type: 'loanRoll', businessId: 'b1', use: SKILLS.accounting, amount: 1000 }, FIX, { check: check(10, 6, 15) }).business;
  const early = apply(b, { type: 'repayLoan', businessId: 'b1', loanId: b.loans[0].id, amount: 400 }, FIX).business;
  assert.equal(early.loans[0].balance, 600);
  assert.equal(early.till, b.till - 400);

  b.till = -900;
  const missed = noEvent(closeWeek(b).business);
  assert.ok(missed.state.compliance < 50);
  assert.deepEqual(missed.digests.at(-1).missed, ['bank']);
});

test('a character buys in on terms every partner agreed', () => {
  assert.equal(apply(clinic(0), { type: 'propose', businessId: 'b1', kind: 'investor', actorId: 'solo', amount: 1000 }, MED, { expect: false }).reason, 'not-registered');
  let b = apply(clinic(1), { type: 'propose', businessId: 'b1', kind: 'investor', actorId: 'solo', amount: 1000 }, MED).business;
  assert.equal(b.proposals.length, 1, 'unanimous');
  b = apply(b, { type: 'vote', businessId: 'b1', proposalId: b.proposals[0].id, yes: true }, FIX).business;
  const invited = b.partners.find((x) => x.actorId === 'solo');
  assert.equal(invited.status, 'invited');
  const price = invited.offer.price;
  assert.equal(price, Math.round(unitValue(b) * 100) / 100, 'at book value unless the partners set a price');

  const joined = apply(b, { type: 'join', businessId: 'b1' }, SOLO);
  assert.deepEqual(joined.wealth, { solo: -1000 });
  const solo = joined.business.partners.find((x) => x.actorId === 'solo');
  assert.deepEqual([solo.status, solo.voting, solo.units], ['active', true, Math.floor(1000 / price)]);
  assert.equal(joined.business.till, b.till + 1000);
  assert.ok(shareOf(joined.business, 'solo') > 0.1);

  const poor = apply(b, { type: 'join', businessId: 'b1' }, { ...SOLO, wealth: 500 }, { expect: false });
  assert.equal(poor.reason, 'insufficient-funds');
});

test('only a character the service allows can be proposed as an investor', () => {
  const out = apply(clinic(1), { type: 'propose', businessId: 'b1', kind: 'investor', actorId: 'solo', amount: 1000 }, MED, { expect: false, context: { investors: ['med', 'fix'] } });
  assert.equal(out.reason, 'not-investor');
  assert.equal(apply(clinic(1), { type: 'propose', businessId: 'b1', kind: 'investor', actorId: 'solo', amount: 1000 }, MED, { context: { investors: ['solo'] } }).ok, true);
});

test('an angel is found when every partner agrees, then pitched with an opposed roll', () => {
  let b = apply(clinic(1), { type: 'propose', businessId: 'b1', kind: 'angel' }, MED).business;
  b = apply(b, { type: 'vote', businessId: 'b1', proposalId: b.proposals[0].id, yes: true }, FIX).business;
  const angel = b.approved.angel;
  assert.ok(angel.total >= 13 && angel.total <= 22, `the angel's 12 + d10: ${angel.total}`);
  assert.ok(BUSINESS_DEFAULTS.investors.angel.names.includes(angel.name));
  assert.equal(rollSpec(b, { type: 'angelRoll', use: SKILLS.persuasion }, 'fix', { day: DAY }).dv, angel.total, 'the pitch is rolled against the angel\'s total');

  const units = totalUnits(b);
  const won = apply(b, { type: 'angelRoll', businessId: 'b1', use: SKILLS.persuasion }, FIX, { check: check(angel.total, 3, angel.total) }).business;
  const npc = won.partners.find((x) => x.npc);
  assert.equal(npc.name, angel.name);
  assert.equal(npc.voting, false);
  assert.ok(totalUnits(won) > units);
  assert.equal(won.till, b.till + npc.cash);
  assert.equal(rollSpec(won, { type: 'action', action: 'work', use: cybertech }, npc.actorId, { day: DAY }).reason, 'not-partner', 'an angel does not run the business');

  const lost = apply(b, { type: 'angelRoll', businessId: 'b1', use: SKILLS.persuasion }, FIX, { check: check(angel.total - 6, 3, angel.total) }).business;
  assert.equal(lost.partners.some((x) => x.npc), false);
  assert.equal(lost.retry.angel, DAY + 14);
});

test('a payment the week\'s own takings cover is made, even if the till was short before the week closed', () => {
  const b = apply(clinic(0, 0), { type: 'propose', businessId: 'b1', kind: 'fixerLoan', amount: 1000 }, MED).business;
  b.till = 130; // less than the 150 due, but the week's own earnings make up the rest
  const week = closeWeek(b).business;
  const d = week.digests.at(-1);
  assert.ok(130 + d.takings - d.upkeep >= 150, `the week earned ${d.takings - d.upkeep}`);
  assert.deepEqual(d.missed, []);
  assert.deepEqual([d.interest, d.repaid], [50, 100]);
  assert.equal(week.till, 130 + d.takings - d.upkeep - 150);
});
