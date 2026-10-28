import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPath, addToPath, pathRange, checkTrigger, applyRequests, runOrders, emptyPortfolio, planAlert, checkAlerts,
} from '../scripts/engine/index.js';

/** A run of ticks at times 6, 7, 8 where ARA dips to 92 and ends back at 100. */
const dip = () => {
  const path = emptyPath();
  addToPath(path, 6, { ARA: 96 });
  addToPath(path, 7, { ARA: 92 });
  addToPath(path, 8, { ARA: 100 });
  return path;
};

test('the range of a path, over all of it or a span of it', () => {
  assert.deepEqual(pathRange(dip(), 'ARA'), { low: 92, high: 100 });
  assert.deepEqual(pathRange(dip(), 'ARA', 8), { low: 100, high: 100 }, 'from a time on');
  assert.deepEqual(pathRange(dip(), 'ARA', 6, 6), { low: 96, high: 96 }, 'up to a time');
  assert.equal(pathRange(dip(), 'MIL'), null, 'nothing for an asset not on it');
  assert.equal(pathRange(dip(), 'ARA', 9), null, 'nothing after it ends');
});

test('a limit the run reached and left fills at the limit', () => {
  const q = { bid: 99, ask: 101, mid: 100, spread: 0.02 };
  const buy = { side: 'buy', type: 'limit', limit: 95 };
  assert.equal(checkTrigger(buy, q).triggered, false, 'the end price alone misses it');
  assert.deepEqual(checkTrigger(buy, q, { low: 92, high: 100 }), { triggered: true, price: 95 });
  assert.equal(checkTrigger(buy, q, { low: 96, high: 100 }).triggered, false, 'the ask never came down to it');

  const sell = { side: 'sell', type: 'limit', limit: 105 };
  assert.deepEqual(checkTrigger(sell, q, { low: 95, high: 108 }), { triggered: true, price: 105 });
  assert.equal(checkTrigger(sell, q, { low: 95, high: 106 }).triggered, false, 'the bid stayed under it');

  assert.equal(checkTrigger({ side: 'buy', type: 'limit', limit: 102 }, q, { low: 92, high: 100 }).price, 101, 'met at the end: the end price, as before');
});

test('a stop the run reached and left fills at its level, across the spread', () => {
  const q = { bid: 99, ask: 101, mid: 100, spread: 0.02 };
  assert.deepEqual(checkTrigger({ side: 'sell', type: 'stop', limit: 94 }, q, { low: 92, high: 100 }), { triggered: true, price: 93.06 });
  assert.deepEqual(checkTrigger({ side: 'buy', type: 'stop', limit: 104 }, q, { low: 98, high: 105 }), { triggered: true, price: 105.04 });
  assert.equal(checkTrigger({ side: 'sell', type: 'stop', limit: 90 }, q, { low: 92, high: 100 }).triggered, false);
});

test('an order only counts the part of the run while it was live', () => {
  const market = { ARA: { listed: true, active: true, price: 100, liquidity: 5 } };
  const settings = { depositFee: 0, feeProfile: { flatFee: 0, commissionBps: 0 }, instant: false };
  const run = (tick) => {
    const funded = applyRequests({ portfolio: emptyPortfolio(), requests: [{ key: 'd', type: 'deposit', amount: 5000 }], wealth: 5000, tick, market, settings });
    return applyRequests({
      portfolio: funded.portfolio, requests: [{ key: 'o', type: 'placeOrder', side: 'buy', assetId: 'ARA', qty: 5, orderType: 'limit', limit: 95, expiry: 'gtc' }],
      wealth: 0, tick, market, settings,
    }).portfolio;
  };

  const early = runOrders({ portfolio: run(5), tick: 8, market, path: dip() });
  assert.equal(early.portfolio.orders[0].status, 'filled', 'live through the dip: filled');
  assert.equal(early.portfolio.lots[0].unitCost, 95, 'at the limit');

  const late = runOrders({ portfolio: run(7.5), tick: 8, market, path: dip() });
  assert.equal(late.portfolio.orders[0].status, 'open', 'placed after the dip: still waiting');

  assert.equal(runOrders({ portfolio: run(5), tick: 8, market }).portfolio.orders[0].status, 'open', 'and with no path, only the end counts');
});

test('a price alert fires on a price the run reached and left, and says what it reached', () => {
  const asset = { listed: true, active: true, price: 100, prevClose: 100 };
  const set = (kind, value, tick = 5) => planAlert({ portfolio: emptyPortfolio(), key: `${kind}${value}`, assetId: 'ARA', kind, value, once: true, asset, tick }).portfolio;
  const quotes = { ARA: { price: 100, prevClose: 99 } };

  const below = checkAlerts(set('below', 93), quotes, 8, dip());
  assert.equal(below.fired.length, 1);
  assert.equal(below.fired[0].price, 92, 'the low it reached, not where it ended');
  assert.equal(checkAlerts(set('below', 93), quotes, 8).fired.length, 0, 'the end price alone would miss it');
  assert.equal(checkAlerts(set('below', 93, 7.5), quotes, 8, dip()).fired.length, 0, 'a dip before the alert was set does not count');
});
