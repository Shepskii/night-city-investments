import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  emptyPortfolio, executeFill, valuePortfolio, releaseSettled, runOrders, applyRequests, normalizePortfolio, movedMoneySince,
  buildStatement, sanitizeFund, makeFundState, stepFundState, distributionDue, applyDistribution, payDividend,
  moversOf, moverThreshold, normalizeNotify, NOTIFY_CATEGORIES, MOVER_DEFAULT_PCT,
} from '../scripts/engine/index.js';
import { tickerView, tickerHtml } from '../scripts/ui/components/ticker.js';

const holding = (over = {}) => ({
  ...emptyPortfolio(),
  cash: 1000,
  lots: [{ id: 'l1', assetType: 'stock', assetId: 'A', qty: 10, unitCost: 50, acquiredTick: 1 }],
  ...over,
});
const sellOrder = { id: 'o1', side: 'sell', assetType: 'stock', assetId: 'A', qty: 4 };

// ── Sale settlement and fund redemption delays ───────────────────────────────

test('a sale with a settlement delay is owed, not spendable, until it settles', () => {
  const instant = executeFill({ portfolio: holding(), order: sellOrder, price: 100, fees: 5, tick: 3 });
  assert.equal(instant.portfolio.cash, 1000 + 395, 'with no delay the money arrives at once');
  assert.equal(instant.settleTicks, 0);

  const slow = executeFill({ portfolio: holding(), order: sellOrder, price: 100, fees: 5, tick: 3, settleTicks: 2 });
  assert.equal(slow.portfolio.cash, 1000, 'cash has not moved');
  assert.deepEqual(slow.portfolio.unsettled, [{ id: 'us_o1', assetId: 'A', amount: 395, releaseTick: 5 }]);
  assert.equal(slow.realized, 395 - 200, 'profit is still realised at the sale');
  assert.equal(slow.portfolio.lots[0].qty, 6, 'the shares are gone');
  assert.equal(slow.portfolio.ledger.some((e) => e.kind === 'sell'), true);

  const v = valuePortfolio(slow.portfolio, { A: 100 });
  assert.equal(v.unsettled, 395);
  assert.equal(v.total, 1000 + 600 + 395, 'it still counts towards the value');
  assert.equal(valuePortfolio(holding(), { A: 100 }).unsettled, 0);

  assert.equal(releaseSettled(slow.portfolio, 4).released, 0, 'not yet');
  const done = releaseSettled(slow.portfolio, 5);
  assert.equal(done.released, 395);
  assert.equal(done.portfolio.cash, 1395);
  assert.deepEqual(done.portfolio.unsettled, []);
});

test('settling proceeds cannot be spent, and are released by the next request after the date', () => {
  const market = { A: { listed: true, active: true, price: 100, prevClose: 100, liquidity: 5 } };
  const settings = { mode: 'open', instant: true, direct: {}, settlementDays: 2 };
  const run = (p, tick, requests) => applyRequests({ portfolio: p, requests, wealth: 0, tick, market, settings });
  const res = (out, key) => out.portfolio.results.find((r) => r.key === key);

  let out = run(holding({ cash: 0 }), 3, [{ key: 's', type: 'placeOrder', route: 'direct', side: 'sell', assetId: 'A', qty: 5, orderType: 'market' }]);
  assert.equal(res(out, 's').ok, true);
  assert.equal(out.portfolio.cash, 0);
  assert.equal(out.portfolio.unsettled.length, 1);
  assert.equal(out.events[0].settleDays, 2, 'the fill says how long the money takes');

  out = run(out.portfolio, 4, [{ key: 'b', type: 'placeOrder', route: 'direct', side: 'buy', assetId: 'A', qty: 1, orderType: 'market' }]);
  assert.equal(res(out, 'b').reason, 'insufficient-funds', 'settling money is not spendable');
  out = run(out.portfolio, 4, [{ key: 'w', type: 'withdraw', amount: 100 }]);
  assert.equal(res(out, 'w').reason, 'insufficient-balance');

  out = run(out.portfolio, 5, [{ key: 'd', type: 'setDrip', assetId: 'A', enabled: true }]);
  assert.ok(out.portfolio.cash > 400, 'released once the date has come');
  assert.equal(out.portfolio.unsettled.length, 0);
});

test('a fund can hold a seller\'s money longer than the market-wide delay, and buys are never delayed', () => {
  const fund = { listed: true, active: true, kind: 'fund', price: 100, prevClose: 100, liquidity: 5, fund: { loadBps: 0, exitBps: 0, minBuy: 0, redeemDelay: 3 } };
  const mk = (qty) => holding({ lots: [{ id: 'f1', assetType: 'fund', assetId: 'F', qty, unitCost: 100, acquiredTick: 1 }] });
  const order = { id: 'o', side: 'sell', assetType: 'fund', assetId: 'F', qty: 2, type: 'market', route: 'broker', eligibleTick: 5, expiresTick: 6, status: 'open', submittedTick: 1, feeProfile: {}, terms: { loadRebate: 0, timingMeanBps: 0, timingSigmaBps: 0 } };
  const run = (delay) => runOrders({ portfolio: { ...mk(5), orders: [order] }, tick: 5, market: { F: fund }, settleDays: delay });

  assert.equal(run(0).portfolio.unsettled[0].releaseTick, 8, 'the fund\'s own delay applies');
  assert.equal(run(5).portfolio.unsettled[0].releaseTick, 10, 'the longer of the two wins');
  assert.equal(run(1).events[0].settleDays, 3);

  const buy = { ...order, id: 'b', side: 'buy', reserve: 300 };
  const bought = runOrders({ portfolio: { ...mk(0), orders: [buy] }, tick: 5, market: { F: fund }, settleDays: 4 });
  assert.equal(bought.events[0].type, 'orderFilled');
  assert.equal(bought.portfolio.unsettled.length, 0, 'buying is not delayed');
});

test('statements count settling money, and undo treats a settling sale as moved money', () => {
  const slow = executeFill({ portfolio: holding(), order: sellOrder, price: 100, fees: 0, tick: 3, settleTicks: 2 }).portfolio;
  const s = buildStatement({ portfolio: slow, prices: { A: 100 }, tick: 4 });
  assert.equal(s.closing.unsettled, 400);
  assert.equal(s.closing.total, 1000 + 600 + 400);
  assert.equal(movedMoneySince(slow, 3), true);
  assert.deepEqual(normalizePortfolio({}).unsettled, []);
});

// ── Distributing funds ───────────────────────────────────────────────────────

const payer = { A: { status: 'active', dividend: { policy: 'yield', frequency: 'quarterly', yield: 0.04 } } };
const mkFund = (over = {}) => sanitizeFund({ name: 'Inc', ticker: 'INC', components: 'A 1', expenseRatio: 0, ...over }).fund;

test('fund config keeps distribution and redemption settings in range', () => {
  const f = mkFund({ distribution: 'distributing', distributionFrequency: 'monthly', redeemDelay: 3 });
  assert.deepEqual([f.distribution, f.distributionFrequency, f.redeemDelay], ['distributing', 'monthly', 3]);
  const d = mkFund({});
  assert.deepEqual([d.distribution, d.distributionFrequency, d.redeemDelay], ['accumulating', 'quarterly', 0]);
  assert.equal(mkFund({ distribution: 'weird', distributionFrequency: 'weekly' }).distribution, 'accumulating');
  assert.equal(mkFund({ redeemDelay: 99 }).redeemDelay, 10);
  assert.equal(mkFund({ redeemDelay: -4 }).redeemDelay, 0);
});

test('a distributing fund sets its dividends aside instead of adding them to its value', () => {
  const prices = { A: 100 };
  const run = (fund) => {
    let s = makeFundState(fund, prices);
    for (let i = 0; i < 365; i++) s = stepFundState(s, fund, prices, payer);
    return s;
  };
  const acc = run(mkFund());
  const dist = run(mkFund({ distribution: 'distributing' }));
  assert.ok(acc.nav > 103.9 && acc.nav < 104.2, `accumulating grows by the 4% yield: ${acc.nav}`);
  assert.equal(dist.nav, 100, 'a distributing fund\'s value stays with its holdings');
  assert.ok(dist.owed > 3.8 && dist.owed < 4.2, `and it owes holders about 4 eb a unit: ${dist.owed}`);
  assert.equal(acc.owed, 0);
});

test('a distribution is fixed once a period, carries the remainder, and records when it was made', () => {
  const fund = mkFund({ distribution: 'distributing', distributionFrequency: 'quarterly' });
  const date = (month) => ({ year: 2046, month, day: 4 });
  assert.deepEqual(distributionDue(mkFund(), { distKey: '2046-Q1' }, date(4)), { due: false }, 'accumulating funds never distribute');
  assert.deepEqual(distributionDue(fund, { distKey: null }, date(2)), { due: false, mark: '2046-Q1' });
  assert.deepEqual(distributionDue(fund, { distKey: '2046-Q1' }, date(3)), { due: false });
  assert.deepEqual(distributionDue(fund, { distKey: '2046-Q1' }, date(4)), { due: true, key: '2046-Q2' });
  assert.deepEqual(distributionDue(mkFund({ distribution: 'distributing', distributionFrequency: 'monthly' }), { distKey: '2046-03' }, date(4)), { due: true, key: '2046-04' });

  const out = applyDistribution({ owed: 1.2345, distKey: '2046-Q1', lastDist: null }, '2046-Q2', 91);
  assert.deepEqual(out.lastDist, { key: '2046-Q2', perUnit: 1.23, tick: 91 });
  assert.equal(out.distKey, '2046-Q2');
  assert.ok(Math.abs(out.owed - 0.0045) < 1e-9, 'the part cent stays owed');

  const nothing = applyDistribution({ owed: 0.001, lastDist: { key: 'old', perUnit: 2, tick: 1 } }, '2046-Q3', 180);
  assert.deepEqual(nothing.lastDist, { key: 'old', perUnit: 2, tick: 1 }, 'a distribution of nothing leaves the last one as it was');
});

test('a distribution pays only those who held before it, once, and can be reinvested', () => {
  const holder = holding({ cash: 0, lots: [{ id: 'l', assetType: 'fund', assetId: 'F', qty: 100, unitCost: 100, acquiredTick: 10 }] });
  const first = payDividend({ portfolio: holder, assetId: 'F', perShare: 1.23, key: 'dist-2046-Q2', price: 100, tick: 91 });
  assert.equal(first.paid, true);
  assert.equal(first.portfolio.cash, 123);
  const again = payDividend({ portfolio: first.portfolio, assetId: 'F', perShare: 1.23, key: 'dist-2046-Q2', price: 100, tick: 91 });
  assert.equal(again.paid, false, 'running it again pays nothing');
  const latecomer = holding({ cash: 0, lots: [{ id: 'l', assetType: 'fund', assetId: 'F', qty: 100, unitCost: 100, acquiredTick: 95 }] });
  assert.equal(payDividend({ portfolio: latecomer, assetId: 'F', perShare: 1.23, key: 'dist-2046-Q2', price: 100, tick: 91 }).paid, false, 'bought after: nothing');
  const drip = payDividend({ portfolio: { ...holder, drip: { F: true } }, assetId: 'F', perShare: 3, key: 'k', price: 100, tick: 91 });
  assert.equal(drip.portfolio.lots.at(-1).qty, 3, 'reinvested into whole units');
});

// ── Holdings movers ──────────────────────────────────────────────────────────

test('movers are the holdings that moved at least the threshold, biggest first', () => {
  const p = holding({ lots: [
    { id: '1', assetId: 'A', qty: 10 }, { id: '2', assetId: 'B', qty: 5 }, { id: '3', assetId: 'C', qty: 1 }, { id: '4', assetId: 'D', qty: 2 },
  ] });
  const quotes = {
    A: { price: 106, prevClose: 100 }, B: { price: 90, prevClose: 100 }, C: { price: 101, prevClose: 100 }, D: { price: 5, prevClose: 0 },
  };
  const movers = moversOf(p, quotes, 5);
  assert.deepEqual(movers.map((m) => m.assetId), ['B', 'A']);
  assert.equal(movers[0].delta, -50);
  assert.equal(movers[1].delta, 60);
  assert.deepEqual(moversOf(p, quotes, 20), []);
  assert.equal(moversOf(p, { A: { price: 99.5, prevClose: 100 } }, 0.5).length, 1, 'exactly at the threshold counts');
});

test('the movers threshold is clamped, and the category is opt-in', () => {
  assert.equal(moverThreshold(undefined), MOVER_DEFAULT_PCT);
  assert.equal(moverThreshold('abc'), MOVER_DEFAULT_PCT);
  assert.equal(moverThreshold(0), MOVER_DEFAULT_PCT);
  assert.equal(moverThreshold(0.2), 1);
  assert.equal(moverThreshold(500), 50);
  assert.equal(moverThreshold('7.25'), 7.3);
  assert.ok(NOTIFY_CATEGORIES.includes('movers'));
  assert.equal(normalizeNotify({}).movers, 'off');
});

// ── Ticker strip ─────────────────────────────────────────────────────────────

test('the ticker shows the index and the biggest gainers and losers', () => {
  const companies = ['A', 'B', 'C', 'D', 'E'].map((t) => ({ id: t, ticker: t, initialPrice: 100 }));
  const quotes = {
    A: { price: 105, prevClose: 100 }, B: { price: 103, prevClose: 100 }, C: { price: 101, prevClose: 100 },
    D: { price: 90, prevClose: 100 }, E: { price: 100, prevClose: 100 },
  };
  const view = tickerView({ quotes, companies });
  assert.deepEqual(view.movers.map((m) => m.ticker), ['A', 'B', 'D'], 'two best, and the one loser; flat ones are left out');
  assert.ok(Math.abs(view.level - 100 * ((105 + 103 + 101 + 90 + 100) / 500)) < 1e-9);
  assert.ok(Math.abs(view.change - (-0.002)) < 1e-9, 'the index fell 0.2% on the day');

  const html = tickerHtml(view, 'NC');
  assert.ok(html.includes('NC 99.80') || html.includes('NC 99.8'), html);
  assert.ok(html.includes('nci-up">A +5.00%') && html.includes('nci-down">D -10.00%'));
  assert.equal(view.watching, false, 'nothing watched, so the movers');
  assert.equal(tickerView({ quotes: {}, companies }), null, 'nothing to show before the market starts');
  assert.equal(tickerHtml(null, 'NC'), '');
  assert.ok(!tickerHtml({ level: 100, change: 0, movers: [{ ticker: '<b>x</b>', change: 0.01 }] }, 'NC').includes('<b>'), 'tickers are escaped');
});

test('a watchlist replaces the movers, keeps the index, and shows at most four in the order added', () => {
  const companies = ['A', 'B', 'C', 'D', 'E', 'F'].map((t) => ({ id: t, ticker: t, initialPrice: 100 }));
  const quotes = {
    A: { price: 105, prevClose: 100 }, B: { price: 103, prevClose: 100 }, C: { price: 101, prevClose: 100 },
    D: { price: 90, prevClose: 100 }, E: { price: 100, prevClose: 100 }, F: { price: 120, prevClose: 100 },
  };
  const plain = tickerView({ quotes, companies });

  const one = tickerView({ quotes, companies, watched: ['E'] });
  assert.deepEqual(one.movers.map((m) => m.ticker), ['E'], 'a flat watched company is shown');
  assert.equal(one.watching, true);
  assert.equal(one.level, plain.level, 'the index is the whole market, not the watchlist');
  assert.equal(one.change, plain.change);

  const many = tickerView({ quotes, companies, watched: ['D', 'A', 'F', 'E', 'B', 'C'] });
  assert.deepEqual(many.movers.map((m) => m.ticker), ['D', 'A', 'F', 'E'], 'the first four, in order');

  const html = tickerHtml(one, 'NC');
  assert.ok(html.includes('nci-tk-watched') && html.includes(`NC ${plain.level.toFixed(2)}`), html);
  assert.ok(!tickerHtml(plain, 'NC').includes('nci-tk-watched'), 'movers carry no watch mark');
});

test('a watchlist of things that cannot be shown falls back to the movers', () => {
  const companies = ['A', 'B'].map((t) => ({ id: t, ticker: t, initialPrice: 100 }));
  const quotes = { A: { price: 105, prevClose: 100 } };
  const gone = tickerView({ quotes, companies, watched: ['B', 'deleted', 'B'] });
  assert.equal(gone.watching, false, 'an unpriced or deleted company does not count');
  assert.deepEqual(gone.movers.map((m) => m.ticker), ['A']);

  const mixed = tickerView({ quotes, companies, watched: ['B', 'A', 'A', 'x'] });
  assert.deepEqual(mixed.movers.map((m) => m.ticker), ['A'], 'skips the unpriced, de-duplicates');
  assert.equal(mixed.watching, true);
});
