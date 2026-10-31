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

const units = (b, id) => b.partners.find((x) => x.actorId === id).units;

test('a rights issue: voted by a majority, each holder may take their share of the new shares at book value for 14 days, paid into the cash; the rest lapses', async () => {
  const { unitValue, rightsLeft, issueOffer } = await import('../scripts/engine/index.js');
  const b0 = company();
  const total = totalUnits(b0);
  const price = Math.round(unitValue(b0) * 100) / 100;
  assert.equal(issueOffer(b0, 0.07).reason, 'bad-issue');
  const out = apply(b0, { type: 'propose', businessId: 'b1', kind: 'issue', pct: 0.2 }, MED);
  let b = out.business;
  const issue = b.capital.issue;
  assert.deepEqual([issue.kind, issue.shares, issue.price], ['rights', Math.round(total * 0.2), price], 'the Medtech\'s majority carried it');
  const medShare = Math.floor((issue.shares * units(b0, 'med')) / total);
  assert.equal(rightsLeft(b, 'med'), medShare);

  const till = b.till;
  const taken = apply(b, { type: 'rightsTake', businessId: 'b1', qty: 10 }, FIX);
  b = taken.business;
  assert.equal(units(b, 'fix'), units(b0, 'fix') + 10);
  assert.equal(b.till, till + Math.round(10 * price));
  assert.equal(taken.wealth.fix, -Math.round(10 * price), 'paid from the account');
  assert.equal(apply(b, { type: 'rightsTake', businessId: 'b1', qty: rightsLeft(b, 'fix') + 1 }, FIX, { expect: false }).reason, 'bad-qty');
  assert.equal(apply(b, { type: 'rightsTake', businessId: 'b1', qty: 1 }, { ...FIX, wealth: 0 }, { expect: false }).reason, 'insufficient-funds');
  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'issue', pct: 0.1 }, MED, { expect: false }).reason, 'issue-open');

  // After the window it closes, and what was not taken lapses.
  const later = advanceBusiness(b, DAY + E.capital.issue.windowDays + 1, { weekday: MONDAY });
  assert.equal(later.business.capital.issue, null);
  assert.equal(apply(later.business, { type: 'rightsTake', businessId: 'b1', qty: 1 }, MED, { expect: false, day: DAY + 20 }).reason, 'no-issue');
});

test('a tender buyback: voted with a budget from the cash, holders sell shares back at book value until the budget or the window runs out', async () => {
  const { unitValue, buybackOffer } = await import('../scripts/engine/index.js');
  const b0 = company();
  const price = Math.round(unitValue(b0) * 100) / 100;
  assert.equal(buybackOffer(b0, b0.till + 1).reason, 'no-funds');
  assert.equal(buybackOffer(b0, 100).reason, 'bad-amount');
  let b = apply(b0, { type: 'propose', businessId: 'b1', kind: 'buyback', budget: 2000 }, MED).business;
  assert.deepEqual([b.capital.buyback.kind, b.capital.buyback.price], ['tender', price]);
  const max = Math.floor(2000 / price);
  assert.equal(apply(b, { type: 'sellBack', businessId: 'b1', qty: max + 1 }, FIX, { expect: false }).reason, 'over-budget');
  const sold = apply(b, { type: 'sellBack', businessId: 'b1', qty: max }, FIX);
  b = sold.business;
  assert.equal(units(b, 'fix'), units(b0, 'fix') - max, 'the shares retired');
  assert.equal(totalUnits(b), totalUnits(b0) - max);
  assert.equal(sold.wealth.fix, Math.round(max * price), 'paid to the seller');
  assert.equal(b.till, b0.till - Math.round(max * price));
  assert.equal(apply(b, { type: 'sellBack', businessId: 'b1', qty: 1 }, MED, { expect: false }).reason, 'over-budget');
  const later = advanceBusiness(b, DAY + E.capital.buyback.windowDays + 1, { weekday: MONDAY });
  assert.equal(later.business.capital.buyback, null);
});

test('only a company issues or buys back, and not while a listing is under way', async () => {
  const { issueOffer, buybackOffer } = await import('../scripts/engine/index.js');
  const shop = normalizeBusiness({ ...company(), stage: 1 });
  assert.equal(issueOffer(shop, 0.1).reason, 'not-company');
  const listing = normalizeBusiness({ ...company(), listing: { status: 'prospectus' } });
  assert.equal(buybackOffer(listing, 1000).reason, 'listing-open');
});
