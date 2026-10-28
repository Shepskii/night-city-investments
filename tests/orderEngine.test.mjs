import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeFees, checkTrigger, validateOrder, consumeLotsFifo, executeFill, heldQty, positionSummary,
} from '../scripts/engine/orderEngine.js';
import { quote } from '../scripts/engine/quotes.js';

const empty = () => ({ cash: 10000, lots: [], ledger: [] });
const buy = (over = {}) => ({ id: 'o1', side: 'buy', assetId: 'ARA', qty: 10, ...over });

test('fees combine flat and bps', () => {
  assert.equal(computeFees(1000, { flatFee: 5, commissionBps: 100 }), 15);
  assert.equal(computeFees(1000), 0);
});

test('quote has bid below and ask above the price', () => {
  const q = quote(100, 3);
  assert.ok(q.bid < 100 && q.ask > 100);
  assert.ok(quote(100, 1).ask - quote(100, 1).bid > q.ask - q.bid);
});

test('market, limit and stop triggers', () => {
  const q = { bid: 99, ask: 101, mid: 100 };
  assert.equal(checkTrigger({ side: 'buy', type: 'market' }, q).price, 101);
  assert.equal(checkTrigger({ side: 'sell', type: 'market' }, q).price, 99);
  assert.equal(checkTrigger({ side: 'buy', type: 'limit', limit: 100 }, q).triggered, false);
  assert.equal(checkTrigger({ side: 'buy', type: 'limit', limit: 102 }, q).triggered, true);
  assert.equal(checkTrigger({ side: 'sell', type: 'limit', limit: 100 }, q).triggered, false);
  assert.equal(checkTrigger({ side: 'sell', type: 'stop', limit: 105 }, q).triggered, true);
  assert.equal(checkTrigger({ side: 'sell', type: 'stop', limit: 95 }, q).triggered, false);
});

test('validation catches the common failures', () => {
  const p = empty();
  const base = { order: buy(), price: 100, cash: p.cash, lots: p.lots };
  assert.equal(validateOrder(base).ok, true);
  assert.equal(validateOrder({ ...base, assetActive: false }).reason, 'halted');
  assert.equal(validateOrder({ ...base, order: buy({ qty: 0 }) }).reason, 'invalid-qty');
  assert.equal(validateOrder({ ...base, order: buy({ qty: 1.5 }) }).reason, 'invalid-qty');
  assert.equal(validateOrder({ ...base, order: buy({ qty: 1000 }) }).reason, 'insufficient-funds');
  assert.equal(validateOrder({ ...base, order: buy({ side: 'sell' }) }).reason, 'insufficient-shares');
  assert.equal(validateOrder({ ...base, minOrder: 5000 }).reason, 'below-minimum');
});

test('buy reduces cash, adds a lot with fees in the basis, and logs the ledger', () => {
  const r = executeFill({ portfolio: empty(), order: buy(), price: 100, fees: 10, tick: 3 });
  assert.equal(r.ok, true);
  assert.equal(r.portfolio.cash, 10000 - 1000 - 10);
  assert.equal(r.portfolio.lots.length, 1);
  assert.equal(r.portfolio.lots[0].unitCost, 101);
  assert.deepEqual(r.portfolio.ledger.map((l) => l.kind), ['buy', 'fee']);
});

test('buy fails without funds and does not mutate', () => {
  const p = { cash: 50, lots: [], ledger: [] };
  const r = executeFill({ portfolio: p, order: buy(), price: 100, tick: 1 });
  assert.equal(r.ok, false);
  assert.equal(p.cash, 50);
});

test('sell consumes the oldest lots first and reports realised P&L', () => {
  let p = empty();
  p = executeFill({ portfolio: p, order: buy({ id: 'a', qty: 10 }), price: 100, tick: 1, lotId: 'L1' }).portfolio;
  p = executeFill({ portfolio: p, order: buy({ id: 'b', qty: 10 }), price: 200, tick: 2, lotId: 'L2' }).portfolio;
  const r = executeFill({ portfolio: p, order: buy({ id: 's', side: 'sell', qty: 15 }), price: 150, fees: 0, tick: 3 });
  assert.equal(r.ok, true);
  assert.equal(heldQty(r.portfolio.lots, 'ARA'), 5);
  assert.equal(r.portfolio.lots[0].id, 'L2');
  // basis: 10 * 100 + 5 * 200 = 2000; proceeds 15 * 150 = 2250
  assert.equal(r.realized, 250);
});

test('cannot sell more than held', () => {
  const r = executeFill({ portfolio: empty(), order: buy({ side: 'sell' }), price: 100, tick: 1 });
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'insufficient-shares');
  assert.equal(consumeLotsFifo([], 'ARA', 1), null);
});

test('position summary', () => {
  const p = executeFill({ portfolio: empty(), order: buy(), price: 100, tick: 1 }).portfolio;
  const s = positionSummary(p.lots, 'ARA', 120);
  assert.equal(s.qty, 10);
  assert.equal(s.avgCost, 100);
  assert.equal(s.value, 1200);
  assert.equal(s.unrealized, 200);
});
