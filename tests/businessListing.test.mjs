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

test('V is net assets plus a year of reported profit at the sector multiple; cash paid in recently waits out the lock-in', () => {
  const b = company();
  assert.equal(sectorMultiple(b), L.multiples.health);
  assert.equal(valuation(b, DAY), 30000 + 2000 * 13 * L.multiples.health);
  // A lump sum paid in just now does not count yet.
  const topped = normalizeBusiness({ ...b, till: b.till + 50000, ledger: [...b.ledger, { day: DAY - 3, kind: 'investment', amount: 50000 }] });
  assert.equal(valuation(topped, DAY), valuation(b, DAY));
  assert.equal(valuation(topped, DAY + L.lockinDays), valuation(b, DAY) + 50000);
  // Losses are valued at assets alone.
  assert.equal(valuation(company({ reported: -500 }), DAY), 30000);
});

test('the checklist: V now and on three reports, track record, Compliance, no concerns, the fee', () => {
  const ok = listingMilestones(company(), { day: DAY, threshold: 100000 });
  assert.equal(ok.met, true, JSON.stringify(ok.items.filter((x) => !x.met)));
  const short = listingMilestones(company({ reportV: 50000 }), { day: DAY, threshold: 100000 });
  assert.equal(short.items.find((x) => x.id === 'sustained').met, false, 'a spike does not count: three reports in a row');
  assert.equal(listingMilestones(company({ compliance: 40 }), { day: DAY, threshold: 100000 }).items.find((x) => x.id === 'listingCompliance').met, false);
  const worried = normalizeBusiness({ ...company(), listingConcerns: true });
  assert.equal(listingMilestones(worried, { day: DAY, threshold: 100000 }).items.find((x) => x.id === 'concerns').met, false, 'hidden Exposure over its cap');
  assert.equal(listingMilestones(company(), { day: DAY }).met, false, 'at the default 500,000 it is not yet worth enough');
  assert.deepEqual(floatOptions(), [0.2, 0.25, 0.3, 0.35, 0.4]);
});

test('listing: every shareholder agrees with a float, the fee is paid, the GM approves, both prospectus rolls pass, and the offer is set', () => {
  const b = company();
  const v = valuation(b, DAY);
  let out = apply(b, { type: 'propose', businessId: 'b1', kind: 'stepUp', float: 0.3 }, MED).business;
  assert.equal(out.listing, null, 'every shareholder with a vote: waiting for the Fixer');
  out = apply(out, { type: 'vote', businessId: 'b1', proposalId: out.proposals[0].id, yes: true }, FIX).business;
  assert.equal(out.listing.status, 'awaiting');
  assert.equal(out.till, b.till - Math.round(v * L.fee));
  assert.equal(apply(b, { type: 'propose', businessId: 'b1', kind: 'stepUp', float: 0.33 }, MED, { expect: false }).reason, 'bad-float');
  // The prospectus rolls wait for the GM.
  assert.equal(rollSpec(out, { type: 'prospectusRoll', part: 'filing', use: ACCOUNTING }, 'med', { day: DAY }).reason, 'no-listing');
  out = approveBusinessListing(out, DAY).business;
  assert.equal(out.listing.status, 'prospectus');
  assert.equal(rollSpec(out, { type: 'prospectusRoll', part: 'filing', use: ACCOUNTING }, 'med', { day: DAY }).dv, 17);
  out = apply(out, { type: 'prospectusRoll', businessId: 'b1', part: 'filing', use: ACCOUNTING }, MED, { check: check(14, 9, 17) }).business; // 23: strong
  assert.equal(out.listing.status, 'prospectus', 'one roll to go');
  out = apply(out, { type: 'prospectusRoll', businessId: 'b1', part: 'offering', use: TRADING }, FIX, { check: check(14, 5, 17) }).business; // 19: solid
  assert.equal(out.listing.status, 'ready');
  const { offer } = out.listing;
  const perShare = out.listing.valuation / totalUnits(out);
  assert.ok(Math.abs(offer.price - Math.round(perShare * (1 + (L.factor.strong + L.factor.solid) / 2) * 100) / 100) < 0.02, 'V per share, lifted by the strong filing');
  assert.equal(offer.float, L.demand.solid, 'a solid offering caps the float at 25%');
  assert.equal(offer.shares, Math.round((totalUnits(out) * 0.25) / 0.75));
});

test('a failed prospectus roll ends the attempt (the fee spent) until the refiling delay; the GM can turn a listing down', () => {
  let b = apply(company(), { type: 'propose', businessId: 'b1', kind: 'stepUp', float: 0.2 }, MED).business;
  b = apply(b, { type: 'vote', businessId: 'b1', proposalId: b.proposals[0].id, yes: true }, FIX).business;
  const approved = approveBusinessListing(b, DAY).business;
  const failed = apply(approved, { type: 'prospectusRoll', businessId: 'b1', part: 'filing', use: ACCOUNTING }, MED, { check: check(8, 3, 17) }).business;
  assert.deepEqual([failed.listing.status, failed.listing.retryDay], ['failed', DAY + L.retryDays]);
  assert.equal(apply(failed, { type: 'propose', businessId: 'b1', kind: 'stepUp', float: 0.2 }, MED, { expect: false }).reason, 'listing-delay');
  assert.equal(apply(failed, { type: 'propose', businessId: 'b1', kind: 'stepUp', float: 0.2 }, MED, { day: DAY + L.retryDays }).ok, true, 'again after the delay');
  const turned = rejectBusinessListing(b, DAY).business;
  assert.equal(turned.listing.status, 'rejected');
});

test('each monthly report records V', () => {
  const b = normalizeBusiness({ ...company(), reportWeeks: BUSINESS_DEFAULTS.report.weeks - 1 });
  const out = advanceBusiness(b, b.period.endDay, { weekday: MONDAY, seed: 'test' }).business;
  const r = out.reports.at(-1);
  assert.equal(r.index, 4);
  assert.ok(r.valuation > 0);
});

test('the lock-up: locked shares are held but cannot be sold until it ends; free ones go first', async () => {
  const { validateOrder, consumeLotsFifo, sellableQty, heldQty } = await import('../scripts/engine/orderEngine.js');
  const lots = [
    { id: 'l1', assetId: 'PLAY', qty: 100, unitCost: 10, acquiredTick: 1, lockedUntil: 30 },
    { id: 'l2', assetId: 'PLAY', qty: 20, unitCost: 12, acquiredTick: 5 },
  ];
  assert.deepEqual([heldQty(lots, 'PLAY'), sellableQty(lots, 'PLAY', 10), sellableQty(lots, 'PLAY', 30)], [120, 20, 120]);
  const sell = (qty, tick) => validateOrder({ order: { side: 'sell', assetId: 'PLAY', qty }, price: 10, cash: 0, lots, tick });
  assert.equal(sell(30, 10).reason, 'locked-up');
  assert.equal(sell(20, 10).ok, true);
  assert.equal(sell(30, 31).ok, true, 'free once the lock-up ends');
  const out = consumeLotsFifo(lots, 'PLAY', 20, 10);
  assert.deepEqual(out.lots.map((l) => [l.id, l.qty]), [['l1', 100]], 'the free lot is sold, the locked one kept');
  assert.equal(consumeLotsFifo(lots, 'PLAY', 21, 10), null);
});

test('after listing, a report points the price at V per share, moved at most earningsCap either way', async () => {
  const { earningsTarget, earningsAmount } = await import('../scripts/engine/index.js');
  const b = normalizeBusiness({ ...company(), listing: { status: 'listed', shares: 2000 } });
  assert.equal(earningsTarget(b, { valuation: 300000 }), 150);
  assert.ok(Math.abs(earningsAmount(150, 100) - Math.log(1.5)) < 1e-9);
  assert.equal(earningsAmount(400, 100), L.earningsCap, 'a doubling and more is held to the cap');
  assert.equal(earningsAmount(10, 100), -L.earningsCap);
  assert.equal(earningsAmount(0, 100), 0);
});
