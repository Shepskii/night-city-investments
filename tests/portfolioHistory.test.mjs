import test from 'node:test';
import assert from 'node:assert/strict';
import { portfolioPnl } from '../scripts/engine/portfolioHistory.js';

const history = (closes, startTick = 10) => ({ schema: 1, series: { ARA: { startTick, closes: closes.map((c) => c * 100) } } });
const entry = (ts, kind, amount, qty = 0, assetId = null) => ({ ts, kind, assetId, qty, amount, ref: 'x' });

test('nothing to chart with no ledger, or only today in it', () => {
  assert.deepEqual(portfolioPnl({ cash: 100, lots: [], ledger: [] }, history([1]), { day: 10 }), []);
  assert.deepEqual(portfolioPnl({ cash: 100, lots: [], ledger: [entry(10, 'deposit', 100)] }, history([1]), { day: 10 }), []);
});

test('a holding rising in price is profit, day by day', () => {
  const p = { cash: 0, lots: [{ assetId: 'ARA', qty: 10 }], ledger: [entry(10, 'deposit', 1000), entry(10, 'buy', -1000, 10, 'ARA')] };
  assert.deepEqual(portfolioPnl(p, history([100, 110, 90]), { day: 12 }), [0, 100, -100]);
});

test('money moved in or out is not profit, nor is it a loss', () => {
  const p = { cash: 300, lots: [], ledger: [entry(10, 'deposit', 500), entry(11, 'deposit', 300), entry(12, 'withdraw', -500)] };
  assert.deepEqual(portfolioPnl(p, history([1, 1, 1]), { day: 12 }), [0, 0, 0]);
});

test('a syndicate account: members paying in and business money are not profit either', () => {
  const p = { cash: 700, lots: [], ledger: [entry(10, 'memberDeposit', 1000), entry(11, 'businessOut', -300), entry(12, 'memberDeposit', 0)] };
  assert.deepEqual(portfolioPnl(p, history([1, 1, 1]), { day: 12 }), [0, 0, 0]);
});

test('fees and fines are losses, dividends are profit, and a sale still settling still counts', () => {
  const p = {
    cash: 40,
    lots: [],
    ledger: [
      entry(10, 'deposit', 100),
      entry(11, 'fee', -10),
      entry(12, 'dividend', 50, 5, 'ARA'),
      entry(13, 'fine', -100),
      entry(14, 'cover', 0),
    ],
  };
  assert.deepEqual(portfolioPnl(p, history([1, 1, 1, 1, 1]), { day: 14 }), [0, -10, 40, -60, -60]);
  const sold = { cash: 0, lots: [], ledger: [entry(10, 'deposit', 100), entry(10, 'buy', -100, 1, 'ARA'), entry(12, 'sell', 150, 1, 'ARA')] };
  assert.deepEqual(portfolioPnl(sold, history([100, 120, 150]), { day: 12, unsettled: 150 }), [0, 20, 50]);
});

test('share changes are undone the right way: splits, write-offs, delistings', () => {
  const split = { cash: 0, lots: [{ assetId: 'ARA', qty: 20 }], ledger: [entry(10, 'buy', -100, 10, 'ARA'), entry(11, 'split', 0, 10, 'ARA')] };
  assert.deepEqual(portfolioPnl(split, history([10, 5]), { day: 11 }), [0, 0], 'twice the shares at half the price');
  const gone = { cash: 0, lots: [], ledger: [entry(10, 'buy', -100, 10, 'ARA'), entry(11, 'writeoff', 0, 10, 'ARA')] };
  assert.deepEqual(portfolioPnl(gone, history([10, 10]), { day: 11 }), [0, -100]);
  const delisted = { cash: 80, lots: [], ledger: [entry(10, 'buy', -100, 10, 'ARA'), entry(11, 'delisting', 80, -10, 'ARA')] };
  assert.deepEqual(portfolioPnl(delisted, history([10, 10]), { day: 11 }), [0, -20]);
});

test('today uses the live price, and the line goes no further back than asked or than the ledger', () => {
  const p = { cash: 0, lots: [{ assetId: 'ARA', qty: 1 }], ledger: [entry(10, 'buy', -100, 1, 'ARA')] };
  assert.deepEqual(portfolioPnl(p, history([100, 100]), { day: 11, prices: { ARA: 130 } }), [0, 30]);
  assert.equal(portfolioPnl(p, history(Array(50).fill(100)), { day: 59, days: 30 }).length, 30);
  assert.equal(portfolioPnl(p, history(Array(50).fill(100)), { day: 59, days: 90 }).length, 50);
});

test('a company with no history left is valued at its price now', () => {
  const p = { cash: 0, lots: [{ assetId: 'NEW', qty: 2 }], ledger: [entry(10, 'buy', -20, 2, 'NEW')] };
  assert.deepEqual(portfolioPnl(p, history([1]), { day: 11, prices: { NEW: 10 } }), [0, 0]);
});
