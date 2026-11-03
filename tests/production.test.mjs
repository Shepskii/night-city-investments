/**
 * Production (P1a, DESIGN §36.10): the workshop, the Fabrication table, runs, the Maker post and stock on the record.
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  BUSINESS_DEFAULTS as P, benchesOf, hasWorkshop, madeByDefault, makesThings, produceCheck, productionWeek, projectOffer,
  rollSpec, runOffer, setLine, staffShifts, tierOf, topTierOf, looseStock, normalizeBusiness, bookValue, salesLimit, salesWeek, salePrice,
  buyStock, consignStock, takeBackStock, handOffer, handStock, stockCost, clearStock, raiseStockQuery, settleStockQuery,
} from '../scripts/engine/index.js';
import { addProjectDays, startProject } from '../scripts/engine/businessGrowth.js';

const USE = { kind: 'skill', skill: 'Cybertech', stat: 'tech' };

function shop({ stage = 0, till = 5000, archetype = 'clinic', workshop = [0] } = {}) {
  return normalizeBusiness({
    id: 'b1', name: 'Back Room', archetype, status: 'open', stage, till,
    partners: [{ actorId: 'med', name: 'Medtech', status: 'active', voting: true, cash: 0, gear: [], units: 100 }],
    upgrades: { workshop },
    period: { index: 1, startDay: 0, endDay: 7, slots: [], bonuses: [], helpers: [], overtime: {}, draws: {} },
    state: { capacity: 1, reputation: 50, costFactor: 1 },
  });
}
const PREMIUM = { uuid: 'i.premium', name: 'Medscanner', type: 'gear', img: '', price: 100 };
const EXPENSIVE = { uuid: 'i.expensive', name: 'Skinweave', type: 'cyberware', img: '', price: 500 };
const LUXURY = { uuid: 'i.luxury', name: 'Cryotank', type: 'gear', img: '', price: 5000 };
const week = (b, band) => {
  b.period.slots = band ? [{ action: 'produce', by: 'med', band }] : [];
  const out = { events: [] };
  productionWeek(b, 6, out, P);
  return out;
};

test('the Fabrication table: price sets the category, and materials are one category down', () => {
  assert.equal(tierOf(10).materials, 5, 'the book: a cheap item costs 5 to fabricate');
  assert.equal(tierOf(20).id, 'everyday');
  assert.equal(tierOf(100).dv, 17);
  assert.equal(tierOf(500).materials, 100);
  assert.equal(tierOf(1000).materials, 500);
  assert.equal(tierOf(5000).materials, 1000);
  assert.equal(tierOf(10000).materials, 5000, 'Super Luxury: half its price');
  assert.equal(tierOf(10000).days, 28);
  assert.equal(tierOf(600).id, 'veryExpensive', 'between prices, the category above');
  assert.equal(tierOf(0), null, 'no price, no category');
  assert.equal(tierOf(20000), null);
});

test('what each business type makes by default, and how far its stage goes', () => {
  assert.ok(madeByDefault('gunShop', { type: 'weapon', name: 'x' }));
  assert.ok(madeByDefault('gunShop', { type: 'itemUpgrade', kind: 'weapon', name: 'x' }));
  assert.ok(!madeByDefault('gunShop', { type: 'itemUpgrade', kind: 'vehicle', name: 'x' }), 'a garage\'s upgrades, not a gun shop\'s');
  assert.ok(madeByDefault('bar', { type: 'gear', name: 'MRE' }));
  assert.ok(!madeByDefault('bar', { type: 'gear', name: 'Cryotank' }));
  assert.ok(!madeByDefault('courier', { type: 'gear', name: 'MRE' }));
  assert.ok(!makesThings(shop({ archetype: 'courier' })));
  assert.deepEqual([0, 1, 2].map((stage) => topTierOf(shop({ stage })).id), ['premium', 'veryExpensive', 'luxury']);
});

test('the workshop project: refused where nothing is made, once a stage, more benches when built again', () => {
  assert.equal(projectOffer(shop({ archetype: 'courier', workshop: [] }), 'workshop').reason, 'no-workshop-use');
  const b = shop({ workshop: [], till: 20000 });
  assert.equal(hasWorkshop(b), false);
  assert.equal(projectOffer(b, 'workshop').cost, 1500);
  assert.ok(startProject(b, 'workshop', 'p1', 0).ok);
  assert.equal(b.till, 18500);
  assert.equal(b.assets, 1500, 'what it builds is worth what it cost');
  assert.ok(addProjectDays(b, 'med', 'p1', 3, { day: 1 }).ok);
  assert.equal(benchesOf(b), 1, 'finished, it has its bench');
  const built = shop({ workshop: [0] });
  assert.equal(benchesOf(built), 1);
  assert.equal(projectOffer(built, 'workshop').reason, 'built-here');
  built.stage = 1;
  assert.equal(projectOffer(built, 'workshop').cost, 4000, 'after stepping up, it can be built again');
  assert.equal(benchesOf(shop({ stage: 1, workshop: [0, 1] })), 2);
  assert.equal(benchesOf(shop({ stage: 2, workshop: [0, 2] })), 4);
});

test('choosing a line: the stage caps it, and no item stops it', () => {
  const b = shop();
  assert.equal(setLine(b, EXPENSIVE, 5).reason, 'line-too-dear');
  assert.equal(setLine(shop({ workshop: [] }), PREMIUM, 5).reason, 'no-workshop');
  assert.ok(setLine(b, PREMIUM, 3).ok);
  assert.equal(b.production.line.qty, 3);
  assert.ok(setLine(b, PREMIUM, 500).ok);
  assert.equal(b.production.line.qty, P.production.runMax);
  assert.ok(setLine(b, null).ok);
  assert.equal(b.production.line, null);
});

test('a run: bench time sets how many, capped by the run limit and what the partners asked for', () => {
  const b = shop();
  setLine(b, PREMIUM);
  assert.equal(runOffer(b, b.production.line).size, 7, 'one bench, a day each');
  setLine(b, PREMIUM, 3);
  assert.equal(runOffer(b, b.production.line).size, 3);
  const big = shop({ stage: 2, workshop: [2] });
  setLine(big, { ...PREMIUM, price: 20 });
  assert.equal(runOffer(big, big.production.line).size, P.production.runMax, 'the run limit, not 224');
  const lux = shop({ stage: 2, workshop: [2] });
  setLine(lux, LUXURY);
  assert.equal(runOffer(lux, lux.production.line).size, 1, 'one, however long it takes');
});

test('the roll is refused before any dice: no workshop, no line, a run going, no money for one item', () => {
  const ask = (b) => rollSpec(b, { type: 'action', action: 'produce', use: USE }, 'med', { day: 1 });
  assert.equal(ask(shop({ workshop: [] })).reason, 'no-workshop');
  const b = shop();
  assert.equal(ask(b).reason, 'no-line');
  setLine(b, PREMIUM);
  const spec = ask(b);
  assert.ok(spec.ok, spec.reason);
  assert.equal(spec.dv, 17, 'the book\'s DV, not the stage\'s');
  assert.ok(spec.uses.some((u) => u.ability === 'Maker'));
  assert.ok(spec.uses.some((u) => u.skill === 'Cybertech'), 'and the trade\'s skills');
  b.till = 49;
  assert.equal(produceCheck(b).reason, 'no-funds');
  b.till = 5000;
  b.production.run = { uuid: 'x', left: 5 };
  assert.equal(ask(b).reason, 'run-going');
});

test('the week\'s close: the band sets how many come out, and only those use materials', () => {
  const b = shop();
  setLine(b, PREMIUM);
  const out = week(b, 'solid');
  assert.equal(b.stock[0].count, 5, 'three quarters of 7, rounded down');
  assert.equal(b.till, 5000 - 250);
  assert.deepEqual(out.events, [{ type: 'stockMade', item: { uuid: 'i.premium', type: 'gear' }, count: 5 }]);
  assert.equal(b.ledger.at(-1).kind, 'materials');
  assert.ok(b.pendingNotes.some((n) => n.kind === 'madeStock'));
  week(b, 'narrow');
  assert.equal(b.stock.length, 1, 'the same item stacks');
  assert.equal(b.stock[0].count, 8);
});

test('a failed roll costs the week, not the materials, and nothing happens without a slot', () => {
  const b = shop();
  setLine(b, PREMIUM);
  const out = week(b, 'failure');
  assert.equal(b.till, 5000);
  assert.equal(b.stock.length, 0);
  assert.deepEqual(out.events, []);
  assert.ok(b.pendingNotes.some((n) => n.kind === 'runFailed'));
  week(b, null);
  assert.equal(b.stock.length, 0);
});

test('a long item stays on the benches for weeks, paid at the start; a passed roll always makes at least one', () => {
  const b = shop({ stage: 1, workshop: [0], till: 5000 });
  setLine(b, EXPENSIVE);
  assert.equal(benchesOf(b), 1);
  week(b, 'narrow');
  assert.equal(b.stock[0].count, 1, 'a week\'s work at one bench, and half of one is one');
  const lux = shop({ stage: 2, workshop: [2], till: 5000 });
  setLine(lux, LUXURY);
  assert.equal(week(lux, 'narrow').events[0].count, 1, 'a Luxury item takes 28 bench days; four benches do 28 a week');
  const slow = shop({ stage: 2, workshop: [0], till: 5000 });
  setLine(slow, LUXURY);
  week(slow, 'solid');
  assert.equal(slow.till, 4000, 'materials at the start');
  assert.equal(slow.production.run.left, 21);
  assert.equal(slow.stock.length, 0);
  assert.equal(produceCheck(slow).reason, 'run-going');
  for (let i = 0; i < 2; i += 1) week(slow, null);
  assert.equal(slow.stock.length, 0);
  const done = week(slow, null);
  assert.equal(slow.stock[0].count, 1);
  assert.equal(slow.production.run, null);
  assert.equal(done.events[0].count, 1);
  assert.equal(slow.till, 4000, 'and nothing more after');
});

test('the cash can stop a run short, or stop it altogether', () => {
  const b = shop({ till: 120 });
  setLine(b, PREMIUM);
  week(b, 'exceptional');
  assert.equal(b.stock[0].count, 2);
  assert.equal(b.till, 20);
  const broke = shop({ till: 10 });
  setLine(broke, PREMIUM);
  week(broke, 'strong');
  assert.equal(broke.stock.length, 0);
  assert.ok(broke.pendingNotes.some((n) => n.kind === 'runNoCash'));
});

test('items that do not stack fill the storeroom; those that do never do', () => {
  const b = shop({ stage: 2, workshop: [2], till: 500000 });
  const gun = { uuid: 'w', name: 'Pistol', type: 'weapon', img: '', price: 100 };
  b.stock = [{ ...gun, cost: 50, count: 95 }];
  setLine(b, gun, 20);
  assert.equal(looseStock(b), 95);
  assert.equal(runOffer(b, b.production.line).size, 5, 'room for five more');
  b.stock[0].count = 100;
  assert.equal(produceCheck(b).reason, 'store-full');
  setLine(b, { ...gun, type: 'gear' }, 20);
  assert.ok(produceCheck(b).ok, 'gear stacks');
});

test('the Maker runs the line in a week nobody did, at the book\'s DV, and not a second time', () => {
  const b = shop();
  b.staff = [{ id: 's1', name: 'Tyger', post: 'maker', status: 'active', source: 'npc', bases: { 'skill:Cybertech': 14 }, pct: 1, loyalty: 60 }];
  staffShifts(b, 'seed', P);
  assert.equal(b.period.slots.length, 0, 'no line, nothing to run');
  setLine(b, PREMIUM);
  staffShifts(b, 'seed', P);
  const slot = b.period.slots.find((s) => s.action === 'produce');
  assert.ok(slot?.staff);
  assert.equal(slot.dv, 17);
  staffShifts(b, 'seed', P);
  assert.equal(b.period.slots.filter((s) => s.action === 'produce').length, 1);
  const partner = shop();
  partner.staff = b.staff;
  setLine(partner, PREMIUM);
  partner.period.slots = [{ action: 'produce', by: 'med', band: 'solid' }];
  staffShifts(partner, 'seed', P);
  assert.equal(partner.period.slots.filter((s) => s.action === 'produce').length, 1, 'a partner got there first');
});

test('illegal items stay off every line for now (P1c brings the back room\'s runs)', () => {
  const b = shop();
  assert.equal(setLine(b, { ...PREMIUM, illegal: true }).reason, 'illegal-line');
  assert.equal(b.production.line, null);
  setLine(b, PREMIUM);
  b.production.line.illegal = true;
  assert.equal(produceCheck(b).reason, 'illegal-line', 'marked illegal after the line was set');
});

test('Careful and Bold move the yield, as they move any action\'s effect', () => {
  const made = (approach) => {
    const b = shop({ stage: 1, workshop: [1] });
    setLine(b, PREMIUM, 8);
    b.period.slots = [{ action: 'produce', by: 'med', band: 'solid', approach }];
    productionWeek(b, 6, { events: [] }, P);
    return b.stock[0]?.count ?? 0;
  };
  assert.equal(made('standard'), 6, 'three quarters of 8');
  assert.equal(made('careful'), 4, 'and three quarters of that');
  assert.equal(made('bold'), 7, 'and a quarter more');
});

test('a short week gives the benches less time', () => {
  const b = shop();
  setLine(b, PREMIUM);
  b.period.endDay = 3;
  week(b, 'exceptional');
  assert.equal(b.stock[0].count, 3, 'three days at one bench, a day each');
  const long = shop({ stage: 1, workshop: [0] });
  setLine(long, EXPENSIVE);
  long.period.endDay = 3;
  week(long, 'exceptional');
  assert.equal(long.production.run.left, 4, 'one item, with 4 of its 7 bench days to go');
  assert.equal(long.stock.length, 0);
});

// ── P1b: selling, buying, consigning, closing ──────────
const stack = (over = {}) => ({ uuid: 'i.scanner', name: 'Medscanner', type: 'gear', img: '', price: 100, cost: 50, count: 10, illegal: false, ...over });
const selling = (stock, { till = 1000, assets = 1000, rep = 40 } = {}) => {
  const b = shop({ till });
  b.assets = assets;
  b.stock = stock;
  b.state.reputation = rep;
  return b;
};
const sell = (b, takings = 400) => {
  const out = { wealth: {}, events: [] };
  return { out, sales: salesWeek(b, takings, 7, out, P) };
};

test('the sales limit: half the takings, moved by the Reputation band', () => {
  const at = (rep) => salesLimit(selling([], { rep }), 400);
  assert.equal(at(20), 150, 'Poor, 0.75');
  assert.equal(at(40), 200, 'Modest, 1');
  assert.equal(at(55), 220, 'Good, 1.1');
  assert.equal(at(80), 250, 'Excellent, 1.25');
  assert.equal(salePrice(100), 70);
});

test('a week\'s sales: up to the limit, into the cash, with only what it made over cost as profit', () => {
  const b = selling([stack()]);
  const { sales, out } = sell(b);
  assert.equal(sales.sold, 140, 'two at 70 eb within 200 eb');
  assert.equal(sales.margin, 40, 'twenty over cost on each');
  assert.equal(b.till, 1140);
  assert.equal(b.assets, 900, 'what they cost leaves the books');
  assert.equal(b.stock[0].count, 8);
  assert.equal(b.production.allowance, 60, 'the rest carries');
  assert.deepEqual(out.events[0], { type: 'stockSold', uuid: 'i.scanner', name: 'Medscanner', itemType: 'gear', owner: null, count: 2 });
  assert.equal(bookValue(b), 2040, 'book value rises by the profit alone');
  assert.ok(b.ledger.some((e) => e.kind === 'stockSales' && e.amount === 40));
  assert.ok(b.ledger.some((e) => e.kind === 'stockCostBack' && e.amount === 100));
});

test('unused limit carries, up to four weeks, so a dear item can sell, and holds cheaper ones back', () => {
  const dear = stack({ uuid: 'i.dear', name: 'Skinweave', price: 500, cost: 100, count: 1 });
  const b = selling([stack({ uuid: 'i.cheap', name: 'Chip', price: 10, cost: 5, count: 5 }), dear]);
  sell(b);
  assert.equal(b.stock.find((s) => s.uuid === 'i.cheap').count, 5, 'the limit is held for the dear one');
  assert.equal(b.production.allowance, 200);
  sell(b);
  assert.equal(b.stock.some((s) => s.uuid === 'i.dear'), false, 'two weeks: 400 eb buys the 350 eb sale');
  assert.equal(b.stock.length, 0, 'and what is left of it sells the cheap ones');
});

test('an item beyond four weeks of limit does not stop the rest', () => {
  const b = selling([stack({ uuid: 'i.dear', price: 5000, cost: 1000, count: 1 }), stack({ uuid: 'i.cheap', name: 'Chip', price: 10, cost: 5, count: 3 })]);
  const { sales } = sell(b);
  assert.equal(sales.sold, 21);
  assert.equal(b.stock.length, 1);
  assert.equal(b.stock[0].uuid, 'i.dear');
  const saving = selling([stack({ uuid: 'i.big', price: 1000, cost: 500, count: 1 })]);
  for (let i = 0; i < 3; i += 1) sell(saving);
  assert.equal(saving.stock.length, 1, 'three weeks: 600 eb');
  sell(saving);
  assert.equal(saving.stock.length, 0, 'the fourth: 800 eb buys a 700 eb sale');
  const capped = selling([stack({ uuid: 'i.big', price: 5000, cost: 1000, count: 1 })]);
  for (let i = 0; i < 8; i += 1) sell(capped);
  assert.equal(capped.production.allowance, 800, 'saved up to four weeks, and no further');
});

test('illegal items are not for the shop, and no stock saves no limit', () => {
  const b = selling([stack({ illegal: true })]);
  assert.equal(sell(b).sales.sold, 0);
  assert.equal(b.stock[0].count, 10);
  const empty = selling([]);
  sell(empty);
  assert.equal(empty.production.allowance, 0);
});

test('a partner buys at cost, or at a company at the shop\'s price', () => {
  const b = selling([stack()]);
  const out = { wealth: {}, events: [] };
  const buyer = { id: 'med', name: 'Medtech', wealth: 1000 };
  assert.ok(buyStock(b, buyer, 'i.scanner', 2, 7, out).ok);
  assert.equal(out.wealth.med, -100);
  assert.equal(b.till, 1100);
  assert.equal(b.assets, 900);
  assert.equal(bookValue(b), 2000, 'at cost, the books do not move');
  assert.equal(out.events[0].actorId, 'med');
  assert.equal(buyStock(b, { ...buyer, wealth: 10 }, 'i.scanner', 1, 7, out).reason, 'insufficient-funds');
  assert.equal(buyStock(b, buyer, 'i.scanner', 99, 7, out).reason, 'bad-amount');
  assert.equal(buyStock(b, buyer, 'nothing', 1, 7, out).reason, 'no-stock');
  const company = selling([stack()]);
  company.stage = 2;
  const paid = { wealth: {}, events: [] };
  assert.ok(buyStock(company, buyer, 'i.scanner', 1, 7, paid).ok);
  assert.equal(paid.wealth.med, -70);
});

test('handing stock over: to a partner, for nothing, and it leaves the books', () => {
  const b = selling([stack()]);
  const partner = { actorId: 'fix', name: 'Fixer' };
  assert.equal(handOffer(b, partner, 'i.scanner', 99).reason, 'bad-amount');
  const offer = handOffer(b, partner, 'i.scanner', 2);
  assert.ok(offer.ok);
  const out = { wealth: {}, events: [] };
  assert.ok(handStock(b, offer.terms, 7, out).ok);
  assert.equal(b.stock[0].count, 8);
  assert.equal(b.assets, 900);
  assert.equal(b.till, 1000);
  assert.equal(out.events[0].actorId, 'fix');
  b.stock[0].count = 1;
  assert.equal(handStock(b, offer.terms, 7, out).reason, 'no-stock', 'it may have sold while they voted');
});

const consigned = (over = {}) => ({ uuid: 'Actor.a.Item.b', name: 'Own Gun', value: 200, img: '', item: { name: 'Own Gun', type: 'weapon', system: {}, _sourceId: 'b' }, ...over });

test('consigning: theirs until sold, 70% of the sale to them, no part of the books', () => {
  const b = selling([]);
  const out = { wealth: {}, events: [] };
  assert.equal(consignStock(b, { id: 'fix', name: 'Fixer' }, [{ name: 'x', value: 5 }], 7, out).reason, 'not-your-item', 'only off their own sheet');
  assert.ok(consignStock(b, { id: 'fix', name: 'Fixer' }, [consigned()], 7, out).ok);
  assert.equal(b.stock[0].owner, 'fix');
  assert.equal(b.stock[0].price, 200);
  assert.equal(stockCost(b), 0);
  assert.equal(looseStock(b), 0, 'it takes no room from the shop\'s own');
  assert.equal(out.events[0].item._sourceId, undefined);
  assert.equal(bookValue(b), 2000);
  const { sales, out: sold } = sell(b);
  assert.equal(sales.sold, 140);
  assert.equal(sold.wealth.fix, 98, '70% of the 140 eb sale, 49% of market');
  assert.equal(sales.kept, 42);
  assert.equal(sales.margin, 42, 'the shop\'s cut is all profit');
  assert.equal(b.till, 1042);
  assert.equal(b.assets, 1000);
  assert.deepEqual(sold.events[0].owner, 'fix');
});

test('a stacked consignment counts its units, ammunition by the box', () => {
  const b = selling([]);
  const out = { wealth: {}, events: [] };
  consignStock(b, { id: 'fix', name: 'Fixer' }, [consigned({ value: 30, item: { name: 'Rounds', type: 'ammo', system: { amount: 30 }, _sourceId: 'c' } })], 7, out);
  assert.equal(b.stock[0].count, 3);
  assert.equal(b.stock[0].price, 10);
});

test('a consignment goes back only to its owner', () => {
  const b = selling([stack({ uuid: 'g', owner: 'fix', cost: 0, count: 2 })]);
  const out = { wealth: {}, events: [] };
  assert.equal(takeBackStock(b, { id: 'med', name: 'Medtech' }, 'g', 7, out).reason, 'not-your-item');
  assert.ok(takeBackStock(b, { id: 'fix', name: 'Fixer' }, 'g', 7, out).ok);
  assert.equal(b.stock.length, 0);
  assert.deepEqual([out.events[0].actorId, out.events[0].owner, out.events[0].count], ['fix', 'fix', 2]);
  assert.equal(b.assets, 1000, 'it never was the business\'s');
});

test('closing: stock counts at cost, consignments go home, and the sheet goes', () => {
  const b = selling([stack({ count: 4 }), stack({ uuid: 'g', name: 'Own Gun', owner: 'fix', cost: 0, count: 1 })]);
  b.production.run = { cost: 100, count: 1, left: 7 };
  assert.equal(stockCost(b), 300);
  const out = { wealth: {}, events: [] };
  assert.equal(clearStock(b, out), 300);
  assert.deepEqual(b.stock, []);
  assert.equal(b.production.run, null);
  const closed = out.events.find((e) => e.type === 'stockClosed');
  assert.equal(closed.returned.length, 1);
  assert.equal(closed.returned[0].owner, 'fix');
  const quiet = { wealth: {}, events: [] };
  assert.equal(clearStock(normalizeBusiness({ id: 'x', archetype: 'clinic', partners: [] }), quiet), 0);
  assert.deepEqual(quiet.events, [], 'no workshop or stock, nothing to clear');
});

test('moved by hand: the GM is asked, and each answer settles the books', () => {
  const asked = (over) => {
    const b = selling([stack(over)]);
    raiseStockQuery(b, b.stock[0], 2, 7);
    return b;
  };
  const b = asked();
  assert.equal(b.stock[0].count, 8);
  assert.equal(b.assets, 1000, 'on the books until the GM says');
  const id = b.stockQueries[0].id;
  const out = { wealth: {}, events: [] };
  assert.equal(settleStockQuery(b, id, 'nonsense', 7, out).reason, 'bad-query');
  assert.ok(settleStockQuery(b, id, 'sold', 7, out).ok);
  assert.equal(b.till, 1140);
  assert.equal(b.assets, 900);
  assert.deepEqual(b.stockQueries, []);
  assert.equal(settleStockQuery(b, id, 'sold', 7, out).reason, 'no-query');
  const lost = asked();
  settleStockQuery(lost, lost.stockQueries[0].id, 'lost', 7, out);
  assert.equal(lost.till, 1000);
  assert.equal(lost.assets, 900);
  const theirs = asked({ owner: 'fix', cost: 0 });
  const paid = { wealth: {}, events: [] };
  settleStockQuery(theirs, theirs.stockQueries[0].id, 'sold', 7, paid);
  assert.equal(paid.wealth.fix, 98);
  assert.equal(theirs.till, 1042);
  assert.equal(theirs.assets, 1000);
});

test('materials stand in the assets, so a run leaves book value alone', () => {
  const b = selling([], { assets: 0 });
  setLine(b, PREMIUM);
  week(b, 'solid');
  assert.equal(b.till, 750);
  assert.equal(b.assets, 250);
  assert.equal(bookValue(b), 1000);
  assert.equal(stockCost(b), 250);
});
