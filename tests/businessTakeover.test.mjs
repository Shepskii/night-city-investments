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
const RAT = { id: 'rat', name: 'Corporate Raider', wealth: 0 };
const roll = (band) => ({ ok: true, result: { band, total: 20, dv: 17, approach: 'normal', luck: 0, extra: 0 } });

test('a takeover bid on a private company: anyone may bid; it waits for the GM, opens against book value, and holders tender; at the close the bidder buys what was tendered, the rest stay', async () => {
  const { openTakeover, settleTakeover, takeoverReference, takeoverPremium, unitValue } = await import('../scripts/engine/index.js');
  const b0 = company();
  const total = totalUnits(b0);
  assert.equal(apply(b0, { type: 'bid', businessId: 'b1', price: 0, shares: 10 }, RAT, { expect: false }).reason, 'bad-price');
  assert.equal(apply(b0, { type: 'bid', businessId: 'b1', price: 5, shares: total + 1 }, RAT, { expect: false }).reason, 'bad-qty');
  const price = Math.round(unitValue(b0) * 1.3 * 100) / 100;
  let b = apply(b0, { type: 'bid', businessId: 'b1', price, shares: 2000 }, RAT).business;
  assert.equal(b.takeover.status, 'awaiting');
  assert.equal(apply(b, { type: 'tender', businessId: 'b1', qty: 10 }, FIX, { expect: false }).reason, 'no-takeover', 'not before the GM approves');
  assert.equal(apply(b, { type: 'bid', businessId: 'b1', price, shares: 10 }, FIX, { expect: false }).reason, 'takeover-open');

  b = normalizeBusiness(structuredClone(b));
  openTakeover(b, { day: DAY, reference: takeoverReference(b) });
  assert.ok(Math.abs(takeoverPremium(b.takeover) - 0.3) < 0.01);
  assert.equal(b.takeover.escrow, Math.round(price * 2000));
  b = apply(b, { type: 'tender', businessId: 'b1', qty: 1000 }, FIX).business;
  assert.equal(apply(b, { type: 'tender', businessId: 'b1', qty: units(b, 'fix') + 1 }, FIX, { expect: false }).reason, 'bad-qty');
  b = apply(b, { type: 'tender', businessId: 'b1', qty: 1500 }, MED).business;

  const done = settleTakeover(b, { day: DAY + 8 });
  assert.equal(done.acquired, 2000, 'more was tendered than wanted: pro rata');
  assert.equal(units(b, 'rat'), 2000, 'the bidder now holds them');
  assert.equal(units(b, 'fix'), units(b0, 'fix') - 800);
  assert.equal(units(b, 'med'), units(b0, 'med') - 1200, 'the rest stay theirs');
  assert.equal(totalUnits(b), total, 'no shares made or lost');
  assert.equal(done.spent, done.transfers.reduce((a, r) => a + r.cash, 0));
  assert.equal(done.refund, Math.round(price * 2000) - done.spent);
  assert.equal(done.control, 2000 / total > 0.5);
  assert.equal(b.takeover, null);
  assert.equal(b.lastTakeover.acquired, 2000);
});

test('NPC holders and the float tender by the premium (all at 20%+, half at 10-20%, none below), and the officers\' defence roll moves the bars once', async () => {
  const { npcAcceptance } = await import('../scripts/engine/index.js');
  const A = E.takeover.accept;
  assert.equal(npcAcceptance({ price: 125, reference: 100 }), 1);
  assert.equal(npcAcceptance({ price: 115, reference: 100 }), 0.5);
  assert.equal(npcAcceptance({ price: 105, reference: 100 }), 0);
  assert.equal(npcAcceptance({ price: 125, reference: 100, defence: { shift: 0.08 } }), 0.5, 'a strong defence: 25% is now under the bar of 28%');
  assert.equal(npcAcceptance({ price: 116, reference: 100, defence: { shift: -0.05 } }), 1, 'a fumbled defence');
  assert.equal(A.all, 0.2);

  let b = normalizeBusiness({ ...company(), takeover: { status: 'open', bidderId: 'rat', bidderName: 'Raider', price: 10, shares: 100, reference: 9, endDay: DAY + 7, tenders: {}, defence: null } });
  b = apply(b, { type: 'defenceRoll', businessId: 'b1', use: { kind: 'skill', skill: 'Persuasion', stat: 'cool' } }, MED, { check: roll('strong') }).business;
  assert.equal(b.takeover.defence.shift, E.takeover.defence.shift.strong);
  assert.equal(apply(b, { type: 'defenceRoll', businessId: 'b1', use: { kind: 'skill', skill: 'Persuasion', stat: 'cool' } }, FIX, { check: roll('solid'), expect: false }).reason, 'defence-done');
});

test('scaled down, a takeover still buys exactly the shares it asked for: rounding goes to the largest remainders', async () => {
  const { settleTakeover } = await import('../scripts/engine/index.js');
  // The live case: a float of 252 and an NPC's 16 both tender, for an offer of 50.
  const b = normalizeBusiness({
    ...company(), listing: { status: 'listed', shares: 1311 },
    partners: [...company().partners, { actorId: 'npc:tyger', name: 'Tyger', status: 'active', cash: 0, gear: [], units: 16, voting: false, npc: true },
      { actorId: 'npc:market', name: '', status: 'active', cash: 0, gear: [], units: 252, voting: false, npc: true, market: true }],
    takeover: { status: 'open', bidderId: 'med', bidderName: 'Medtech', price: 368.76, shares: 50, reference: 295.01, endDay: DAY, escrow: 18438, tenders: {}, defence: null },
  });
  const done = settleTakeover(b, { day: DAY + 1, held: { med: 1000 }, sellable: {} });
  assert.equal(done.acquired, 50);
  assert.deepEqual(done.transfers.map((r) => [r.actorId, r.qty]).sort(), [['npc:market', 47], ['npc:tyger', 3]].sort());
  assert.equal(done.refund, 18438 - done.spent);
});
