import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyRequests, runOrders, GTC_TICKS } from '../scripts/engine/executor.js';
import {
  emptyPortfolio, normalizePortfolio, valuePortfolio, committedCash, reservedShares, estimateOrder,
  trimPortfolio, openOrders, CLOSED_ORDER_CAP, LEDGER_CAP, PROCESSED_CAP, RESULT_CAP,
} from '../scripts/engine/portfolioModel.js';

const market = (over = {}) => ({
  ARA: { listed: true, active: true, price: 100, liquidity: 5 },
  MIL: { listed: true, active: true, price: 50, liquidity: 3 },
  ...over,
});
const settings = (over = {}) => ({ depositFee: 0, feeProfile: { flatFee: 0, commissionBps: 0 }, instant: false, ...over });

let n = 0;
const req = (type, extra = {}) => ({ key: `k${++n}`, type, ...extra });
const run = (portfolio, requests, { wealth = 10000, tick = 5, m = market(), s = settings() } = {}) =>
  applyRequests({ portfolio, requests, wealth, tick, market: m, settings: s });

test('normalizePortfolio fills missing fields and does not mutate', () => {
  const stored = { cash: 50 };
  const p = normalizePortfolio(stored);
  assert.equal(p.cash, 50);
  assert.deepEqual(p.lots, []);
  assert.equal(p.stats.realized, 0);
  assert.deepEqual(stored, { cash: 50 });
  assert.deepEqual(normalizePortfolio(null), emptyPortfolio());
});

test('deposit moves wealth into the balance and logs the ledger', () => {
  const r = run(emptyPortfolio(), [req('deposit', { amount: 1000 })]);
  assert.equal(r.portfolio.cash, 1000);
  assert.equal(r.wealth, 9000);
  assert.deepEqual(r.portfolio.ledger.map((l) => [l.kind, l.amount]), [['deposit', 1000]]);
  assert.equal(r.portfolio.results[0].ok, true);
});

test('deposit fee is charged and shown as its own ledger line', () => {
  const r = run(emptyPortfolio(), [req('deposit', { amount: 1000 })], { s: settings({ depositFee: 20 }) });
  assert.equal(r.portfolio.cash, 980);
  assert.equal(r.wealth, 9000);
  assert.deepEqual(r.portfolio.ledger.map((l) => [l.kind, l.amount]), [['deposit', 1000], ['fee', -20]]);
});

test('deposit and withdraw failures are reported and change nothing', () => {
  const dep = run(emptyPortfolio(), [req('deposit', { amount: 99999 })]);
  assert.equal(dep.portfolio.cash, 0);
  assert.equal(dep.wealth, 10000);
  assert.deepEqual(dep.portfolio.results[0], { key: dep.portfolio.results[0].key, type: 'deposit', tick: 5, ok: false, reason: 'insufficient-wealth' });
  const wd = run(emptyPortfolio(), [req('withdraw', { amount: 10 })]);
  assert.equal(wd.portfolio.results[0].reason, 'insufficient-balance');
  assert.equal(run(emptyPortfolio(), [req('deposit', { amount: -5 })]).portfolio.results[0].reason, 'invalid-amount');
});

test('withdraw returns balance to wealth', () => {
  const funded = run(emptyPortfolio(), [req('deposit', { amount: 1000 })]);
  const r = run(funded.portfolio, [req('withdraw', { amount: 400 })], { wealth: funded.wealth });
  assert.equal(r.portfolio.cash, 600);
  assert.equal(r.wealth, 9400);
});

test('replaying a request key does nothing the second time', () => {
  const request = req('deposit', { amount: 500 });
  const once = run(emptyPortfolio(), [request]);
  const twice = run(once.portfolio, [request], { wealth: once.wealth });
  assert.equal(twice.changed, false);
  assert.equal(twice.portfolio.cash, 500);
  assert.equal(twice.wealth, 9500);
});

test('several requests in one batch use the running wealth', () => {
  const r = run(emptyPortfolio(), [req('deposit', { amount: 6000 }), req('deposit', { amount: 6000 })]);
  assert.equal(r.portfolio.cash, 6000);
  assert.equal(r.portfolio.results[1].reason, 'insufficient-wealth');
});

const funded = (cash = 5000) => {
  const r = run(emptyPortfolio(), [req('deposit', { amount: cash })]);
  return { portfolio: r.portfolio, wealth: r.wealth };
};

test('a market buy waits for the next tick, then fills at the ask', () => {
  const { portfolio, wealth } = funded();
  const placed = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth });
  const order = placed.portfolio.orders[0];
  assert.equal(order.status, 'open');
  assert.equal(order.eligibleTick, 6);
  assert.equal(placed.portfolio.cash, 5000, 'cash is reserved, not spent, until the fill');
  assert.ok(order.reserve >= 1000);

  assert.equal(runOrders({ portfolio: placed.portfolio, tick: 5, market: market() }).events.length, 0, 'not eligible yet');

  const filled = runOrders({ portfolio: placed.portfolio, tick: 6, market: market() });
  assert.equal(filled.events[0].type, 'orderFilled');
  const p = filled.portfolio;
  assert.equal(p.orders[0].status, 'filled');
  assert.equal(p.lots.length, 1);
  assert.equal(p.lots[0].qty, 10);
  const ask = Math.round(100 * 1.003 * 100) / 100; // liquidity 5 spread 0.6%
  assert.equal(p.orders[0].fillPrice, ask);
  assert.equal(p.cash, 5000 - Math.round(10 * ask));
});

test('instant execution fills in the same call', () => {
  const { portfolio, wealth } = funded();
  const r = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 5 })], { wealth, s: settings({ instant: true }) });
  assert.equal(r.portfolio.orders[0].status, 'filled');
  assert.equal(r.events[0].type, 'orderFilled');
  assert.equal(r.portfolio.lots[0].qty, 5);
});

test('buy validation: funds are checked against cash minus open buy reserves', () => {
  const { portfolio, wealth } = funded(1500);
  const first = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth });
  assert.equal(first.portfolio.results.at(-1).ok, true);
  const second = run(first.portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth });
  assert.equal(second.portfolio.results.at(-1).reason, 'insufficient-funds');
  assert.equal(openOrders(second.portfolio).length, 1);
  assert.ok(committedCash(second.portfolio.orders) > 0);
});

test('placement validation: bad input and unknown or halted assets', () => {
  const { portfolio, wealth } = funded();
  const reason = (extra, m) => run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 1, ...extra })], { wealth, m }).portfolio.results.at(-1).reason;
  assert.equal(reason({ side: 'hold' }), 'invalid-side');
  assert.equal(reason({ qty: 0 }), 'invalid-qty');
  assert.equal(reason({ qty: 1.5 }), 'invalid-qty');
  assert.equal(reason({ orderType: 'weird' }), 'invalid-order');
  assert.equal(reason({ orderType: 'limit' }), 'invalid-limit');
  assert.equal(reason({ assetId: 'NOPE' }), 'unknown-asset');
  assert.equal(reason({}, market({ ARA: { listed: true, active: false, price: 100, liquidity: 5 } })), 'halted');
  assert.equal(reason({ assetId: 'MIL', qty: 1000 }), 'insufficient-funds');
});

test('selling needs shares and reserves them against other open sells', () => {
  const { portfolio, wealth } = funded();
  const bought = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth, s: settings({ instant: true }) });
  assert.equal(run(bought.portfolio, [req('placeOrder', { side: 'sell', assetId: 'ARA', qty: 11 })], { wealth }).portfolio.results.at(-1).reason, 'insufficient-shares');

  const s1 = run(bought.portfolio, [req('placeOrder', { side: 'sell', assetId: 'ARA', qty: 6 })], { wealth });
  assert.equal(reservedShares(s1.portfolio.orders, 'ARA'), 6);
  const s2 = run(s1.portfolio, [req('placeOrder', { side: 'sell', assetId: 'ARA', qty: 6 })], { wealth });
  assert.equal(s2.portfolio.results.at(-1).reason, 'insufficient-shares');
});

test('selling realises profit using FIFO cost and updates stats', () => {
  const { portfolio, wealth } = funded();
  const bought = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth, s: settings({ instant: true }) });
  const cashAfterBuy = bought.portfolio.cash;
  const higher = market({ ARA: { listed: true, active: true, price: 120, liquidity: 5 } });
  const sold = run(bought.portfolio, [req('placeOrder', { side: 'sell', assetId: 'ARA', qty: 10 })], { wealth, m: higher, s: settings({ instant: true }) });
  assert.equal(sold.portfolio.lots.length, 0);
  assert.ok(sold.portfolio.stats.realized > 150);
  assert.ok(sold.portfolio.cash > cashAfterBuy + 1100);
  assert.equal(sold.events[0].realized, sold.portfolio.stats.realized);
});

test('limit buy waits until the ask drops to the limit', () => {
  const { portfolio, wealth } = funded();
  const placed = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 5, orderType: 'limit', limit: 95, expiry: 'gtc' })], { wealth });
  const o = placed.portfolio.orders[0];
  assert.equal(o.expiresTick, o.eligibleTick + GTC_TICKS);
  const miss = runOrders({ portfolio: placed.portfolio, tick: 6, market: market() });
  assert.equal(miss.portfolio.orders[0].status, 'open');
  const hit = runOrders({ portfolio: miss.portfolio, tick: 7, market: market({ ARA: { listed: true, active: true, price: 94, liquidity: 5 } }) });
  assert.equal(hit.portfolio.orders[0].status, 'filled');
});

test('a day order that does not trigger expires on its first eligible tick', () => {
  const { portfolio, wealth } = funded();
  const placed = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 5, orderType: 'limit', limit: 50 })], { wealth });
  const r = runOrders({ portfolio: placed.portfolio, tick: 6, market: market() });
  assert.equal(r.portfolio.orders[0].status, 'expired');
  assert.equal(r.events[0].type, 'orderExpired');
});

test('a stop sell triggers when the price falls to the stop', () => {
  const { portfolio, wealth } = funded();
  const bought = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth, s: settings({ instant: true }) });
  const placed = run(bought.portfolio, [req('placeOrder', { side: 'sell', assetId: 'ARA', qty: 10, orderType: 'stop', limit: 90, expiry: 'gtc' })], { wealth });
  const stays = runOrders({ portfolio: placed.portfolio, tick: 6, market: market() });
  assert.equal(stays.portfolio.orders.at(-1).status, 'open');
  const falls = runOrders({ portfolio: stays.portfolio, tick: 7, market: market({ ARA: { listed: true, active: true, price: 85, liquidity: 5 } }) });
  assert.equal(falls.portfolio.orders.at(-1).status, 'filled');
  assert.equal(falls.portfolio.lots.length, 0);
});

test('an order is rejected at fill time if the company has been halted or funds vanished', () => {
  const { portfolio, wealth } = funded();
  const placed = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth });
  const halted = runOrders({ portfolio: placed.portfolio, tick: 6, market: market({ ARA: { listed: true, active: false, price: 100, liquidity: 5 } }) });
  assert.equal(halted.portfolio.orders[0].reason, 'halted');

  const drained = run(placed.portfolio, [req('withdraw', { amount: 5000 })], { wealth });
  const rejected = runOrders({ portfolio: drained.portfolio, tick: 6, market: market() });
  assert.equal(rejected.portfolio.orders[0].status, 'rejected');
  assert.equal(rejected.portfolio.orders[0].reason, 'insufficient-funds');
});

test('commission is charged on fills', () => {
  const { portfolio, wealth } = funded();
  const r = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth, s: settings({ instant: true, feeProfile: { flatFee: 5, commissionBps: 100 } }) });
  const o = r.portfolio.orders[0];
  assert.equal(o.fees, 5 + Math.round(Math.round(10 * o.fillPrice) / 100));
  assert.ok(r.portfolio.ledger.some((l) => l.kind === 'fee'));
});

test('cancelling an open order frees its reserve; unknown ids are rejected', () => {
  const { portfolio, wealth } = funded();
  const placed = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 })], { wealth });
  const id = placed.portfolio.orders[0].id;
  const cancelled = run(placed.portfolio, [req('cancelOrder', { orderId: id })], { wealth });
  assert.equal(cancelled.portfolio.orders[0].status, 'cancelled');
  assert.equal(committedCash(cancelled.portfolio.orders), 0);
  assert.equal(run(cancelled.portfolio, [req('cancelOrder', { orderId: id })], { wealth }).portfolio.results.at(-1).reason, 'not-found');
  assert.equal(run(emptyPortfolio(), [req('mystery')]).portfolio.results[0].reason, 'unknown-request');
});

test('valuePortfolio computes positions, totals and unrealised P&L', () => {
  const { portfolio, wealth } = funded();
  const bought = run(portfolio, [req('placeOrder', { side: 'buy', assetId: 'ARA', qty: 10 }), req('placeOrder', { side: 'buy', assetId: 'MIL', qty: 20 })], { wealth, s: settings({ instant: true }) });
  const v = valuePortfolio(bought.portfolio, { ARA: 110, MIL: 50 });
  assert.equal(v.positions.length, 2);
  assert.equal(v.positions[0].assetId, 'ARA');
  assert.equal(v.positions[0].value, 1100);
  assert.equal(v.holdings, 1100 + 1000);
  assert.equal(v.total, v.cash + v.holdings);
  assert.equal(v.unrealized, v.holdings - v.cost);
  assert.ok(v.positions[0].unrealizedPct > 0);
});

test('estimateOrder: buys add fees, sells subtract them', () => {
  const fp = { flatFee: 2, commissionBps: 100 };
  assert.deepEqual(estimateOrder({ side: 'buy', qty: 10, price: 100, feeProfile: fp }), { gross: 1000, fees: 12, total: 1012 });
  assert.deepEqual(estimateOrder({ side: 'sell', qty: 10, price: 100, feeProfile: fp }), { gross: 1000, fees: 12, total: 988 });
});

test('trimPortfolio keeps history bounded but never drops open orders', () => {
  const closed = Array.from({ length: CLOSED_ORDER_CAP + 10 }, (_, i) => ({ id: `c${i}`, status: 'filled' }));
  const p = {
    ...emptyPortfolio(),
    orders: [{ id: 'open1', status: 'open' }, ...closed],
    ledger: Array.from({ length: LEDGER_CAP + 5 }, (_, i) => ({ i })),
    processed: Array.from({ length: PROCESSED_CAP + 5 }, (_, i) => `p${i}`),
    results: Array.from({ length: RESULT_CAP + 5 }, (_, i) => ({ i })),
  };
  const t = trimPortfolio(p);
  assert.equal(t.orders.filter((o) => o.status === 'filled').length, CLOSED_ORDER_CAP);
  assert.ok(t.orders.some((o) => o.id === 'open1'));
  assert.equal(t.ledger.length, LEDGER_CAP);
  assert.equal(t.processed.length, PROCESSED_CAP);
  assert.equal(t.results.length, RESULT_CAP);
});
