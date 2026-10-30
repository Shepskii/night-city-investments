import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  applyBusinessRequest, advanceBusiness, approveBusinessCharter, rejectBusinessCharter, normalizeBusiness, charterMilestones, capitalQuote,
  quoteRange, netAssets, unitValue, totalUnits, sharesOf, BUSINESS_DEFAULTS,
} from '../scripts/engine/index.js';
import { resolveRoll } from '../scripts/engine/rolls.js';

const MED = { id: 'med', name: 'Medtech', wealth: 50000 };
const FIX = { id: 'fix', name: 'Fixer', wealth: 50000 };
const ACTORS = { med: 'Medtech', fix: 'Fixer' };
const MONDAY = 1;
const DAY = 20003;
const check = (base, die, dv) => ({ ok: true, result: resolveRoll({ base, roll: { total: die, crit: die >= 11 ? 'success' : die <= 0 ? 'fumble' : null }, dv }) });
const cybertech = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };
const BUSINESS = { kind: 'skill', skill: 'Business', stat: 'int' };
const BUREAUCRACY = { kind: 'skill', skill: 'Bureaucracy', stat: 'int' };
const ACCOUNTING = { kind: 'skill', skill: 'Accounting', stat: 'int' };

function apply(business, request, actor, extra = {}) {
  const out = applyBusinessRequest({
    business, request: { key: extra.key ?? `k${Math.random()}`, ...request }, actor, day: extra.day ?? DAY, check: extra.check,
    context: { approval: false, weekday: MONDAY, actors: ACTORS, newId: 'b1', seed: 'test', growthRate: 1, tickers: ['ARA'], ...extra.context },
  });
  if (extra.expect !== false) assert.equal(out.ok, true, `${request.type}: ${out.reason}`);
  return out;
}

/**
 * A registered clinic ready to charter: registered 13 weeks ago, earning 450 eb a week, one expansion
 * finished, 6,000 eb in its cash and 3,000 eb of fit-out. The Medtech holds 3,000 units, the Fixer 1,500.
 */
function ready({ till = 6000 } = {}) {
  let b = apply(null, { type: 'found', name: 'Back Room', archetype: 'clinic', cash: 3000, invite: ['fix'] }, MED).business;
  b = apply(b, { type: 'join', businessId: 'b1', cash: 1500 }, FIX).business;
  b = apply(b, { type: 'setupRoll', businessId: 'b1', use: cybertech }, MED, { check: check(14, 9, 13) }).business;
  const out = normalizeBusiness({
    ...b, stage: 1, till, assets: 3000, registeredDay: DAY - 91, state: { ...b.state, capacity: 2, compliance: 50, reputation: 55 },
    projects: [{ id: 'x1', kind: 'expansion', status: 'done', stage: 1 }],
  });
  delete out.period.event;
  out.period = { ...out.period, startDay: DAY, endDay: DAY + 7 };
  out.digests = [0, 1, 2, 3].map((i) => ({ index: i + 10, startDay: DAY - 28 + 7 * i, endDay: DAY - 21 + 7 * i, profit: 450, takings: 900, upkeep: 450, till }));
  return out;
}

/** Agree to charter as BRC (both partners vote yes). */
function agreed(b = ready()) {
  let out = apply(b, { type: 'propose', businessId: 'b1', kind: 'stepUp', ticker: 'brc' }, MED);
  out = apply(out.business, { type: 'vote', businessId: 'b1', proposalId: out.business.proposals[0].id, yes: true }, FIX);
  return out.business;
}

const roll = (b, part, use, [base, die, dv], actor = MED) => apply(b, { type: 'charterRoll', businessId: 'b1', part, use }, actor, { check: check(base, die, dv) });

test('chartering needs 12 weeks registered, 400 eb a week, a finished expansion and the filing fee', () => {
  const m = charterMilestones(ready());
  assert.deepEqual(m.items.map((x) => [x.id, x.met]), [['registeredWeeks', true], ['charterProfit', true], ['expansions', true], ['charterFee', true]]);
  assert.equal(charterMilestones({ ...ready(), projects: [] }).met, false, 'no expansion');
  assert.equal(charterMilestones(normalizeBusiness({ ...ready(), registeredDay: DAY - 40 })).met, false, 'too new');
  assert.equal(charterMilestones(ready({ till: 1000 })).met, false, 'cannot pay the fee');
});

test('every partner agrees to charter under a free ticker; the fee is paid when they do', () => {
  const b = ready();
  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'stepUp', ticker: 'a' }, MED, { expect: false }).reason, 'bad-ticker');
  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'stepUp', ticker: 'ara' }, MED, { expect: false }).reason, 'ticker-taken');
  const waiting = apply(b, { type: 'propose', businessId: 'b1', kind: 'stepUp', ticker: 'brc' }, MED).business;
  assert.equal(waiting.charter, null, 'unanimous: the Fixer has not voted');
  const c = agreed();
  assert.deepEqual([c.charter.status, c.charter.ticker], ['rolling', 'BRC']);
  assert.equal(c.till, 6000 - BUSINESS_DEFAULTS.charter.fee);
  assert.equal(apply(c, { type: 'stepUpRoll', businessId: 'b1', use: BUREAUCRACY }, MED, { check: check(14, 6, 15), expect: false }).reason, 'no-step-up', 'no registration roll for a registered business');
});

test('a failed business plan is a setback; a failed capital structure refuses the charter, keeping what passed', () => {
  let b = agreed();
  b = roll(b, 'plan', BUSINESS, [10, 1, 13]).business;
  assert.equal(b.charter.rolls.plan.success, false);
  assert.equal(b.charter.status, 'rolling', 'only a setback');
  b = roll(b, 'registration', BUREAUCRACY, [10, 7, 15], FIX).business;
  assert.equal(apply(b, { type: 'charterRoll', businessId: 'b1', part: 'registration', use: BUREAUCRACY }, MED, { check: check(10, 7, 15), expect: false }).reason, 'part-rolled', 'each part is rolled once');
  const refused = roll(b, 'capital', ACCOUNTING, [8, 3, 15]).business;
  assert.equal(refused.charter.status, 'failed');
  assert.equal(refused.charter.retryDay, DAY + 7);
  assert.deepEqual(Object.keys(refused.charter.kept), ['registration'], 'the passed registration is kept; the failed plan is not');
  assert.equal(apply(refused, { type: 'propose', businessId: 'b1', kind: 'stepUp', ticker: 'brc' }, MED, { expect: false }).reason, 'charter-delay');

  // Agreed again a week later: the registration is carried over, so only the plan and capital are rolled.
  const again = apply(normalizeBusiness({ ...refused, till: 6000 }), { type: 'propose', businessId: 'b1', kind: 'stepUp', ticker: 'brc' }, MED, { day: DAY + 8 });
  const voted = apply(again.business, { type: 'vote', businessId: 'b1', proposalId: again.business.proposals[0].id, yes: true }, FIX, { day: DAY + 8 }).business;
  assert.ok(voted.charter.rolls.registration, 'kept');
});

test('the capital quote runs from the top of the range at a bare pass to the bottom at a margin of 8, by sector', () => {
  const b = ready();
  const { kmin, kmax } = quoteRange(b);
  assert.deepEqual([kmin, kmax], [5000, 12000], 'a clinic is health: factor 1');
  assert.equal(capitalQuote(b, { margin: 0 }), 12000);
  assert.equal(capitalQuote(b, { margin: 4 }), 8500);
  assert.equal(capitalQuote(b, { margin: 8 }), 5000);
  assert.equal(capitalQuote(b, { margin: 5, crit: true }), 5000, 'a critical adds 4');
  assert.deepEqual(quoteRange({ ...b, archetype: 'gunShop' }), { kmin: 6500, kmax: 15600 }, 'arms: factor 1.3');
});

test('with all three rolled the charter waits for the GM; with no shortfall it is formed on approval', () => {
  let b = agreed();
  b = roll(b, 'plan', BUSINESS, [10, 6, 13]).business;
  b = roll(b, 'registration', BUREAUCRACY, [10, 7, 15]).business;
  b = roll(b, 'capital', ACCOUNTING, [10, 13, 15]).business;
  assert.equal(b.charter.status, 'awaiting');
  assert.equal(b.charter.quote, 5000, 'a critical: the bottom of the range');
  assert.equal(b.charter.netAssets, netAssets(b), 'cash and fit-out, less loans');
  assert.equal(b.charter.shortfall, 0, '4,000 eb of cash and 3,000 eb of fit-out cover it');
  const units = b.partners.map((p) => p.units);
  const formed = approveBusinessCharter(b, DAY).business;
  assert.equal(formed.stage, 2);
  assert.deepEqual(formed.company, { ticker: 'BRC', sector: 'health', charteredDay: DAY });
  assert.deepEqual(formed.partners.map((p) => sharesOf(formed, p.actorId)), units, 'units become shares one for one');
  assert.deepEqual(formed.officers, ['med', 'fix'], 'those who ran it become its first officers');
  assert.equal(formed.state.reputation, 55 + 3, 'a solid plan: Reputation +3');
  assert.equal(formed.state.compliance, 50 + 3, 'a solid registration: Compliance +3');
});

test('a shortfall is paid in during the funding window; each payment buys shares at book value', () => {
  let b = agreed(ready({ till: 2500 }));
  b = roll(b, 'plan', BUSINESS, [10, 3, 13]).business;
  b = roll(b, 'registration', BUREAUCRACY, [10, 5, 15]).business;
  b = roll(b, 'capital', ACCOUNTING, [10, 6, 15]).business;
  assert.equal(b.charter.quote, 11100);
  assert.equal(b.charter.shortfall, 11100 - (500 + 3000));
  assert.equal(apply(b, { type: 'charterFund', businessId: 'b1', cash: 100 }, MED, { expect: false }).reason, 'not-funding', 'not before the GM approves');
  b = approveBusinessCharter(b, DAY).business;
  assert.equal(b.charter.fundingEnds, DAY + 14);
  const price = unitValue(b);
  const units = totalUnits(b);
  assert.equal(apply(b, { type: 'charterFund', businessId: 'b1', cash: 20000 }, MED, { expect: false }).reason, 'over-funded');
  let out = apply(b, { type: 'charterFund', businessId: 'b1', cash: 4000 }, MED);
  assert.deepEqual(out.wealth, { med: -4000 });
  assert.equal(out.business.stage, 1, 'not yet');
  out = apply(out.business, { type: 'charterFund', businessId: 'b1', cash: 3600 }, FIX);
  assert.equal(out.business.stage, 2, 'formed when the shortfall is met');
  assert.equal(totalUnits(out.business), units + Math.floor(4000 / price) + Math.floor(3600 / price), 'new shares at book value');
  assert.equal(out.business.till, 500 + 7600);
});

test('a funding window that lapses refunds everyone; the GM can turn a charter down', () => {
  let b = agreed(ready({ till: 2500 }));
  b = roll(b, 'plan', BUSINESS, [10, 3, 13]).business;
  b = roll(b, 'registration', BUREAUCRACY, [10, 5, 15]).business;
  b = roll(b, 'capital', ACCOUNTING, [10, 6, 15]).business;
  const turnedDown = rejectBusinessCharter(b, DAY);
  assert.equal(turnedDown.business.charter.status, 'failed');
  b = approveBusinessCharter(b, DAY).business;
  b = apply(b, { type: 'charterFund', businessId: 'b1', cash: 1000 }, MED).business;
  const lapsed = advanceBusiness(b, DAY + 15, { weekday: MONDAY, seed: 'test' });
  assert.equal(lapsed.business.charter.status, 'failed');
  assert.equal(lapsed.business.charter.reason, 'lapsed');
  assert.equal(lapsed.wealth.med, 1000, 'refunded');
  assert.equal(lapsed.business.stage, 1);
});
