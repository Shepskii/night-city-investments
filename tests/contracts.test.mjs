/**
 * Market contracts (C1, DESIGN §36.19): a corporation's order for a player's workshop, drawn or written, voted on,
 * filled from the benches or stock, and delivered or settled late.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_DEFAULTS as P, normalizeBusiness, applyBusinessRequest, advanceBusiness, productionWeek, businessReminders,
  drawContract, contractTerms, contractChance, contractItems, takesContracts, offerContract, dropContract, writeContract,
  signContract, fillContracts, stockToContract, contractsWeek, liveContracts, contractLimit, salePrice,
} from '../scripts/engine/index.js';

const SCANNER = { uuid: 'i.scanner', name: 'Medscanner', type: 'gear', img: '', price: 100 };
const SKIN = { uuid: 'i.skin', name: 'Skinweave', type: 'cyberware', img: '', price: 500 };
const BLACK = { uuid: 'i.black', name: 'Black Lace', type: 'drug', img: '', price: 50, illegal: true };
const BIOTECHNICA = { id: 'bt', name: 'Biotechnica', ticker: 'BTC', sector: 'biotech', factionId: 'f.bt', value: 0, listed: true };
const ARASAKA = { id: 'ara', name: 'Arasaka', ticker: 'ARA', sector: 'security', factionId: null, value: 0, listed: true };

function shop({ stage = 1, till = 5000, workshop = [stage], partners = null, npcRun = null } = {}) {
  return normalizeBusiness({
    id: 'b1', name: 'Back Room', archetype: 'clinic', status: 'open', stage, till, assets: 0,
    partners: partners ?? [{ actorId: 'med', name: 'Medtech', status: 'active', voting: true, cash: 0, gear: [], units: 100 }],
    officers: stage >= 2 ? ['med'] : [],
    upgrades: { workshop },
    ...(npcRun ? { npcRun } : {}),
    period: { index: 4, startDay: 21, endDay: 28, slots: [], bonuses: [], helpers: [], overtime: {}, draws: {} },
    state: { capacity: 1, reputation: 50, costFactor: 1, compliance: stage ? 50 : null },
  });
}
const relations = (over = {}) => ({ frequency: 1, corps: [BIOTECHNICA, ARASAKA], items: [SCANNER, SKIN, BLACK], ...over });
const MED = { id: 'med', name: 'Medtech', wealth: 0 };
const vote = (b, proposalId, yes, actor = MED, day = 30) => applyBusinessRequest({ business: b, request: { key: `v${Math.random()}`, type: 'vote', businessId: b.id, proposalId, yes }, actor, day });

/** A contract drawn from the first seed that gives one. */
function drawn(b, rel = relations()) {
  for (let i = 0; i < 200; i++) {
    const c = drawContract(b, rel, `seed${i}`, 28, P);
    if (c) return c;
  }
  return null;
}

test('who is offered: a player\'s open workshop, by a corporation in a sector that buys what it makes, at its standing', () => {
  assert.equal(contractChance(0), 0.1, 'neutral');
  assert.equal(contractChance(30), 0.2, 'friendly');
  assert.equal(contractChance(80), 0.3, 'allied');
  assert.equal(contractChance(-30), 0, 'wary: none');
  assert.equal(contractChance(-70), 0, 'hostile: none');
  assert.equal(takesContracts(shop()), true);
  assert.equal(takesContracts(shop({ workshop: [] })), false, 'no workshop');
  assert.equal(takesContracts(shop({ npcRun: { ownerId: 'n', auto: true } })), false, "an NPC's company");
  assert.deepEqual(contractItems(shop({ stage: 0 }), [SCANNER, SKIN, BLACK]).map((r) => r.uuid), ['i.scanner'], 'legal, and no dearer than the stage can make');

  const c = drawn(shop());
  assert.ok(c, 'drawn from some seed');
  assert.equal(c.status, 'held', 'it waits for the GM');
  assert.equal(c.corp.name, 'Biotechnica', 'a clinic sells to biotech, not security');
  assert.ok(!c.item.illegal && c.item.uuid !== 'i.black');
  assert.equal(c.advance, Math.round(c.total * 0.25));
  assert.equal(c.weeks, 4);

  // None: a wary buyer, contracts off, or the business already has its one.
  assert.equal(drawn(shop(), relations({ corps: [{ ...BIOTECHNICA, value: -30 }] })), null);
  assert.equal(drawn(shop(), relations({ frequency: 0 })), null);
  const full = shop();
  drawn(full);
  assert.equal(drawn(full), null, 'one at a time below a company');
  assert.equal(contractLimit(shop({ stage: 2 })), 2, 'a company may hold two');
  // The same seed draws the same offer.
  assert.deepEqual(drawContract(shop(), relations(), 'seedX', 28, P), drawContract(shop(), relations(), 'seedX', 28, P));
});

test('the terms: so many weeks of the benches at a run a week at most, at the market price, with a quarter up front', () => {
  // A registered business has two benches: 14 bench days a week, a Medscanner a day, so 14 a week.
  const t = contractTerms(shop(), SCANNER, 3, P);
  assert.equal(t.count, 42);
  assert.equal(t.total, 4200);
  assert.equal(t.advance, 1050);
  // A cheap item is held to a run's most a week.
  assert.equal(contractTerms(shop(), { ...SCANNER, price: 10 }, 2, P).count, 2 * P.production.runMax);
  // A long one comes to at least one.
  assert.equal(contractTerms(shop({ stage: 0, workshop: [0] }), SKIN, 2, P).count, 2, 'one bench, seven days each');
});

test('the GM offers it, changing the terms, or drops it; the partners vote, and signing pays the advance', () => {
  const b = shop();
  const c = drawn(b);
  assert.equal(offerContract(b, 'nope', {}, 28).reason, 'no-contract');
  const offered = offerContract(b, c.id, { count: 10, unit: 120, weeks: 3 }, 28);
  assert.equal(offered.ok, true);
  assert.equal(c.status, 'offered');
  assert.deepEqual([c.count, c.unit, c.total, c.advance, c.weeks], [10, 120, 1200, 300, 3]);
  const proposal = b.proposals.find((x) => x.kind === 'contract');
  assert.equal(proposal.expires, 28 + P.contracts.offerDays);
  assert.deepEqual(proposal.votes, {}, 'nobody has voted yet');

  const out = vote(b, proposal.id, true);
  assert.equal(out.ok, true, out.reason);
  const signed = out.business.contracts[0];
  assert.equal(signed.status, 'open');
  assert.equal(signed.due, 30 + 21);
  assert.equal(out.business.till, 5000 + 300, 'the advance is in the cash');
  assert.equal(out.business.ledger.at(-1).kind, 'contractAdvance');
  assert.ok(out.events.some((e) => e.type === 'contractSigned'));

  // Turned down: nothing lost.
  const no = shop();
  const d = drawn(no);
  offerContract(no, d.id, {}, 28);
  const refused = vote(no, d.id, false);
  assert.equal(refused.business.contracts[0].status, 'declined');
  assert.equal(refused.business.till, 5000);

  // Dropped by the GM: it was never seen.
  const gone = shop();
  const g = drawn(gone);
  assert.equal(dropContract(gone, g.id).ok, true);
  assert.equal(gone.contracts.length, 0);
});

test('an offer nobody votes on lapses after seven days', () => {
  const b = shop();
  const c = drawn(b);
  offerContract(b, c.id, {}, 22);
  const out = advanceBusiness(b, 30, { seed: 'c1' });
  assert.equal(out.business.contracts.find((x) => x.id === c.id).status, 'lapsed');
  assert.ok(out.events.some((e) => e.type === 'contractLapsed'));
  assert.equal(out.business.proposals.length, 0);
});

test('runs of the item fill the order first, then the shelves; stock can go towards it', () => {
  const b = shop();
  const c = writeContract(b, { corp: BIOTECHNICA, item: SCANNER, count: 10, weeks: 4 }, 28, P).contract;
  signContract(b, c.id, 28, P);
  // A run of 14 comes off the benches: 10 to the order, 4 on the shelves.
  b.production = { line: { ...SCANNER, qty: 20 }, run: { ...SCANNER, cost: 50, count: 14, left: 0 }, allowance: 0 };
  const out = { events: [] };
  productionWeek(b, 28, out, P);
  assert.equal(c.made, 10);
  assert.equal(c.cost, 500, 'what they cost stays in the assets until delivery');
  assert.equal(b.stock.find((s) => s.uuid === 'i.scanner').count, 4);
  assert.equal(out.events.find((e) => e.type === 'stockMade').count, 4, 'only the shelves\' share goes to the storeroom sheet');

  const more = writeContract(b, { corp: ARASAKA, item: SCANNER, count: 3 }, 28, P);
  assert.equal(more.reason, 'contract-limit', 'a registered business holds one');
  const company = shop({ stage: 2 });
  writeContract(company, { corp: BIOTECHNICA, item: SCANNER, count: 3 }, 28, P);
  assert.equal(writeContract(company, { corp: ARASAKA, item: SCANNER, count: 3 }, 28, P).ok, true, 'a company holds two');
  assert.equal(writeContract(company, { corp: ARASAKA, item: SCANNER, count: 3 }, 28, P).reason, 'contract-limit');
  assert.equal(writeContract(shop(), { corp: BIOTECHNICA, item: BLACK, count: 3 }, 28, P).reason, 'illegal-line');

  // Stock towards an order.
  const s = shop();
  const order = writeContract(s, { corp: BIOTECHNICA, item: SCANNER, count: 5 }, 28, P).contract;
  signContract(s, order.id, 28, P);
  s.stock = [{ ...SCANNER, cost: 50, count: 8, illegal: false }];
  const put = applyBusinessRequest({ business: s, request: { key: 'k1', type: 'contractStock', businessId: 'b1', contractId: order.id, count: 6 }, actor: MED, day: 29 });
  assert.equal(put.reason, 'bad-amount', 'no more than it still needs');
  const ok = applyBusinessRequest({ business: s, request: { key: 'k2', type: 'contractStock', businessId: 'b1', contractId: order.id, count: 5 }, actor: MED, day: 29 });
  assert.equal(ok.ok, true, ok.reason);
  assert.equal(ok.business.contracts[0].made, 5);
  assert.equal(ok.business.stock[0].count, 3);
  assert.ok(ok.events.some((e) => e.type === 'stockSold' && e.count === 5), 'the storeroom sheet gives them up');
  assert.equal(stockToContract(ok.business, order.id, 1, { events: [] }).reason, 'contract-full');
});

test('delivered: the rest of the price, standing up, and the profit is the price less the cost', () => {
  const b = shop();
  const c = writeContract(b, { corp: BIOTECHNICA, item: SCANNER, count: 10 }, 28, P).contract;
  signContract(b, c.id, 28, P);
  fillContracts(b, { ...SCANNER, cost: 50, count: 10 });
  b.assets = 500;
  const till = b.till;
  const out = { events: [] };
  const week = contractsWeek(b, 35, out, P);
  assert.equal(c.status, 'done');
  assert.equal(b.till, till + 1000 - 250, 'the price less the advance already paid');
  assert.equal(b.assets, 0);
  assert.equal(week.margin, 1000 - 500);
  const closeLines = b.ledger.filter((e) => e.day === 35 && e.kind.startsWith('contract'));
  assert.equal(closeLines.reduce((x, e) => x + e.amount, 0), b.till - till, 'the profit and the settling line add up to the cash');
  assert.deepEqual(out.events.find((e) => e.type === 'factionMove'), { type: 'factionMove', factionId: 'f.bt', amount: P.contracts.standing.done });
  assert.equal(out.events.find((e) => e.type === 'contractDone').contract.listed, true, 'a listed buyer\'s price lifts');
  assert.equal(liveContracts(b).length, 0);
});

test('late or short: what was made at the shop\'s price, the advance counted against it; standing and Reputation fall', () => {
  const b = shop();
  const c = writeContract(b, { corp: ARASAKA, item: SCANNER, count: 10 }, 28, P).contract;
  signContract(b, c.id, 28, P);
  fillContracts(b, { ...SCANNER, cost: 50, count: 4 });
  const till = b.till;
  // Not yet due: nothing happens.
  assert.equal(contractsWeek(b, 40, { events: [] }, P).late.length, 0);
  const out = { events: [] };
  const week = contractsWeek(b, c.due, out, P);
  const worth = 4 * salePrice(100, P);
  assert.equal(c.status, 'late');
  assert.equal(b.till, till + worth - 250);
  assert.equal(week.margin, worth - 200);
  assert.equal(b.state.reputation, 50 + P.contracts.reputation);
  assert.equal(out.events.some((e) => e.type === 'factionMove'), false, 'a buyer that is no faction has no standing to lose');

  // Nothing made: the advance goes back.
  const none = shop();
  const n = writeContract(none, { corp: BIOTECHNICA, item: SCANNER, count: 10 }, 28, P).contract;
  signContract(none, n.id, 28, P);
  const before = none.till;
  const lost = { events: [] };
  contractsWeek(none, n.due, lost, P);
  assert.equal(none.till, before - 250);
  assert.equal(lost.events.find((e) => e.type === 'factionMove').amount, P.contracts.standing.late);
});

test('a week\'s close: offers are drawn at a month\'s end, and a delivery counts in the profit and the digest', () => {
  const b = shop();
  // Week 4 closes a month (four weeks a report).
  let out = null;
  for (let i = 0; i < 200 && !out?.business.contracts.length; i++) out = advanceBusiness(shop(), 28, { seed: `m${i}`, relations: { contracts: relations() } });
  assert.equal(out.business.contracts[0].status, 'held');
  assert.ok(out.events.some((e) => e.type === 'contractDrawn'));
  // Not at another week's close.
  const mid = shop();
  mid.period.index = 5;
  for (let i = 0; i < 50; i++) assert.equal(advanceBusiness(mid, 28, { seed: `w${i}`, relations: { contracts: relations() } }).business.contracts.length, 0);

  const c = writeContract(b, { corp: BIOTECHNICA, item: SCANNER, count: 2 }, 22, P).contract;
  signContract(b, c.id, 22, P);
  fillContracts(b, { ...SCANNER, cost: 50, count: 2 });
  const closed = advanceBusiness(b, 28, { seed: 'd1' });
  const digest = closed.business.digests.at(-1);
  assert.equal(digest.contracts.margin, 100);
  assert.equal(digest.contracts.done[0].corp, 'Biotechnica');
  const plain = advanceBusiness(shop(), 28, { seed: 'd1' }).business.digests.at(-1);
  assert.equal(digest.profit - plain.profit, 100, 'the profit counts the price less the cost');
});

test('the buyer chases an order due at tomorrow\'s close that is still short', () => {
  const b = shop();
  const c = writeContract(b, { corp: ARASAKA, item: SCANNER, count: 10, weeks: 1 }, 20, P).contract;
  signContract(b, c.id, 20, P);
  const r = businessReminders(b, 27).find((x) => x.kind === 'contract');
  assert.ok(r, 'the close on day 28 settles it');
  assert.deepEqual(r.from, { kind: 'buyer', corp: c.corp });
  assert.equal(r.data.made, 0);
  fillContracts(b, { ...SCANNER, cost: 50, count: 10 });
  assert.equal(businessReminders(b, 27).some((x) => x.kind === 'contract'), false, 'made in full: nothing to chase');
});
