import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  payDividend, emptyPortfolio, normalizePortfolio, splitPortfolio, cashOutPortfolio, writeOffPortfolio,
  splitMarketState, scaleHistory, autoSplitRatio, isValidSplitRatio, appendClose, emptyHistory, getSeries,
  emptyControls, makeBias, biasValueAt, resolveControls, pruneControls, dropImpacts, logEntry, setCompanyPrice,
  makeImpact, collectImpacts, createInitialState, stepMarket, runTicks, applyRequests, LOG_CAP, PAID_CAP,
} from '../scripts/engine/index.js';
import { SAMPLE_COMPANIES } from '../tools/sample-companies.mjs';

const lot = (over = {}) => ({ id: 'l1', assetType: 'stock', assetId: 'ARA', qty: 10, unitCost: 100, acquiredTick: 1, ...over });
const withLots = (lots, over = {}) => ({ ...emptyPortfolio(), cash: 1000, lots, ...over });

// ── Dividends ─────────────────────────────────────────────────────────────────

test('a dividend pays holders and is recorded', () => {
  const r = payDividend({ portfolio: withLots([lot()]), assetId: 'ARA', perShare: 2.5, key: '2045-Q1', price: 100, tick: 5 });
  assert.equal(r.paid, true);
  assert.equal(r.payout, 25);
  assert.equal(r.portfolio.cash, 1025);
  assert.equal(r.portfolio.stats.dividends, 25);
  assert.deepEqual(r.portfolio.ledger.at(-1), { ts: 5, kind: 'dividend', assetId: 'ARA', qty: 10, amount: 25, ref: '2045-Q1' });
});

test('a dividend is never paid twice for the same period', () => {
  const once = payDividend({ portfolio: withLots([lot()]), assetId: 'ARA', perShare: 2, key: 'k', price: 100, tick: 5 });
  const twice = payDividend({ portfolio: once.portfolio, assetId: 'ARA', perShare: 2, key: 'k', price: 100, tick: 6 });
  assert.equal(twice.paid, false);
  assert.equal(twice.portfolio.cash, once.portfolio.cash);
  const next = payDividend({ portfolio: once.portfolio, assetId: 'ARA', perShare: 2, key: 'k2', price: 100, tick: 9 });
  assert.equal(next.paid, true);
});

test('shares bought on the declaration tick do not earn the dividend', () => {
  const r = payDividend({ portfolio: withLots([lot({ acquiredTick: 5 })]), assetId: 'ARA', perShare: 2, key: 'k', price: 100, tick: 5 });
  assert.equal(r.paid, false);
  assert.equal(r.payout, 0);
  assert.equal(r.portfolio.cash, 1000);
  const mixed = payDividend({ portfolio: withLots([lot({ qty: 4 }), lot({ id: 'l2', qty: 6, acquiredTick: 5 })]), assetId: 'ARA', perShare: 2, key: 'k', price: 100, tick: 5 });
  assert.equal(mixed.payout, 8);
});

test('holders of other companies and non-holders get nothing, but the period is still marked', () => {
  const r = payDividend({ portfolio: withLots([lot({ assetId: 'MIL' })]), assetId: 'ARA', perShare: 2, key: 'k', price: 100, tick: 5 });
  assert.equal(r.portfolio.cash, 1000);
  assert.ok(r.portfolio.paid.includes('ARA:k'));
});

test('reinvestment buys whole shares and keeps the remainder as cash', () => {
  const p = withLots([lot({ qty: 100 })], { drip: { ARA: true } });
  const r = payDividend({ portfolio: p, assetId: 'ARA', perShare: 2.5, key: 'k', price: 80, tick: 5 });
  assert.equal(r.payout, 250);
  assert.equal(r.portfolio.lots.at(-1).qty, 3);
  assert.equal(r.portfolio.lots.at(-1).drip, true);
  assert.equal(r.portfolio.cash, 1000 + 250 - 240);
  assert.deepEqual(r.portfolio.ledger.map((l) => l.kind), ['dividend', 'drip']);
  assert.equal(r.portfolio.stats.dividends, 250);
});

test('the paid list is capped', () => {
  let p = emptyPortfolio();
  for (let i = 0; i < PAID_CAP + 20; i++) p = payDividend({ portfolio: p, assetId: 'ARA', perShare: 1, key: `k${i}`, price: 1, tick: 5 }).portfolio;
  assert.ok(p.paid.length <= PAID_CAP + 1);
});

test('setDrip request toggles reinvestment', () => {
  const r = applyRequests({
    portfolio: emptyPortfolio(), requests: [{ key: 'a', type: 'setDrip', assetId: 'ARA', enabled: true }, { key: 'b', type: 'setDrip', assetId: '' }],
    wealth: 0, tick: 1, market: {}, settings: { feeProfile: {} },
  });
  assert.equal(r.portfolio.drip.ARA, true);
  assert.equal(r.portfolio.results[1].ok, false);
  assert.deepEqual(normalizePortfolio({}).drip, {});
});

// ── Splits, cash-outs, write-offs ─────────────────────────────────────────────

test('split ratio rules and auto-split trigger', () => {
  assert.equal(isValidSplitRatio(2), true);
  assert.equal(isValidSplitRatio(1), false);
  assert.equal(isValidSplitRatio(2.5), false);
  assert.equal(isValidSplitRatio(21), false);
  const company = { split: { auto: true, above: 500, ratio: 2 } };
  assert.equal(autoSplitRatio(company, 499), null);
  assert.equal(autoSplitRatio(company, 500), 2);
  assert.equal(autoSplitRatio({ split: { auto: false, above: 1, ratio: 2 } }, 999), null);
  assert.equal(autoSplitRatio({}, 999), null);
});

test('splitting multiplies shares, divides cost and rescales open orders, keeping total value', () => {
  const p = withLots([lot({ qty: 10, unitCost: 100 })], {
    orders: [{ id: 'o1', status: 'open', assetId: 'ARA', side: 'sell', qty: 4, type: 'limit', limit: 120, reserve: 0 }, { id: 'o2', status: 'filled', assetId: 'ARA', qty: 1 }],
  });
  const { portfolio, changed } = splitPortfolio(p, 'ARA', 4, 7);
  assert.equal(changed, true);
  assert.equal(portfolio.lots[0].qty, 40);
  assert.equal(portfolio.lots[0].unitCost, 25);
  assert.equal(portfolio.orders[0].qty, 16);
  assert.equal(portfolio.orders[0].limit, 30);
  assert.equal(portfolio.orders[1].qty, 1, 'closed orders are history and stay as they were');
  assert.deepEqual(portfolio.ledger.at(-1), { ts: 7, kind: 'split', assetId: 'ARA', qty: 30, amount: 0, ref: '1:4' });
  assert.equal(splitPortfolio(p, 'MIL', 2).changed, false);
  assert.equal(splitPortfolio(p, 'ARA', 1).changed, false);
});

test('split rescales market state and history so charts stay continuous', () => {
  const state = createInitialState({ companies: SAMPLE_COMPANIES });
  const next = splitMarketState(state, 'ARA', 4);
  assert.equal(next.companies.ARA.price, 60);
  assert.equal(next.companies.ARA.prevClose, 60);
  assert.equal(next.companies.ARA.fair, 60);
  assert.equal(next.companies.MIL.price, state.companies.MIL.price);
  assert.equal(state.companies.ARA.price, 240, 'input is not mutated');
  let h = appendClose(emptyHistory(), 'ARA', 0, 240);
  h = appendClose(h, 'ARA', 1, 248);
  assert.deepEqual(getSeries(scaleHistory(h, 'ARA', 1 / 4), 'ARA'), [60, 62]);
  assert.equal(scaleHistory(h, 'NOPE', 0.5), h);
});

test('buyout pays holders in cash, removes the position, cancels orders and records realised profit', () => {
  const p = withLots([lot({ qty: 10, unitCost: 100 })], {
    orders: [{ id: 'o1', status: 'open', assetId: 'ARA', side: 'buy', qty: 5, reserve: 500 }],
  });
  const r = cashOutPortfolio(p, 'ARA', 150, 'buyout', 9);
  assert.equal(r.payout, 1500);
  assert.equal(r.portfolio.cash, 2500);
  assert.equal(r.portfolio.lots.length, 0);
  assert.equal(r.portfolio.orders[0].status, 'cancelled');
  assert.equal(r.portfolio.orders[0].reason, 'buyout');
  assert.equal(r.portfolio.stats.realized, 500);
  assert.equal(r.portfolio.ledger.at(-1).kind, 'buyout');
  assert.equal(cashOutPortfolio(p, 'MIL', 1, 'delist').changed, false);
});

test('bankruptcy wipes the position and books the loss', () => {
  const p = withLots([lot({ qty: 10, unitCost: 100 })]);
  const r = writeOffPortfolio(p, 'ARA', 4);
  assert.equal(r.loss, 1000);
  assert.equal(r.portfolio.lots.length, 0);
  assert.equal(r.portfolio.cash, 1000, 'no cash comes back');
  assert.equal(r.portfolio.stats.realized, -1000);
  assert.equal(r.portfolio.ledger.at(-1).kind, 'writeoff');
});

// ── GM controls ───────────────────────────────────────────────────────────────

test('a flat bias applies inside its window only; linear decay fades to zero', () => {
  const flat = makeBias({ id: 'b', target: { type: 'market' }, value: 1, startTick: 5, duration: 4 });
  assert.deepEqual([4, 5, 8, 9].map((t) => biasValueAt(flat, t)), [0, 1, 1, 0]);
  const lin = makeBias({ id: 'b', target: { type: 'market' }, value: 2, startTick: 0, duration: 4, decay: 'linear' });
  assert.deepEqual([0, 1, 2, 3, 4].map((t) => biasValueAt(lin, t)), [2, 1.5, 1, 0.5, 0]);
});

test('bias values are clamped to the allowed range', () => {
  assert.equal(makeBias({ id: 'b', target: { type: 'market' }, value: 99, startTick: 0, duration: 1 }).value, 3);
  assert.equal(makeBias({ id: 'b', target: { type: 'market' }, value: -99, startTick: 0, duration: 0 }).value, -3);
});

test('resolveControls sums market, sector and company biases and reports regime and halt', () => {
  const c = {
    ...emptyControls(),
    volMult: 1.5,
    haltAll: true,
    forceRegime: { regime: 'crash', untilTick: 6 },
    biases: [
      makeBias({ id: '1', target: { type: 'market' }, value: 1, startTick: 1, duration: 10 }),
      makeBias({ id: '2', target: { type: 'market' }, value: 0.5, startTick: 1, duration: 10 }),
      makeBias({ id: '3', target: { type: 'sector', id: 'arms' }, value: -1, startTick: 1, duration: 10 }),
      makeBias({ id: '4', target: { type: 'company', id: 'ARA' }, value: 2, startTick: 1, duration: 2 }),
    ],
  };
  const r = resolveControls(c, 2);
  assert.equal(r.globalBias, 1.5);
  assert.deepEqual(r.sectorBias, { arms: -1 });
  assert.deepEqual(r.companyBias, { ARA: 2 });
  assert.equal(r.volMult, 1.5);
  assert.equal(r.frozenAll, true);
  assert.equal(r.forceRegime, 'crash');
  assert.equal(resolveControls(c, 7).forceRegime, undefined);
  assert.deepEqual(resolveControls(c, 4).companyBias, {});
  assert.equal(resolveControls(null, 1).globalBias, 0);
});

test('pruneControls drops finished biases and regimes; dropImpacts and logEntry behave', () => {
  const c = {
    ...emptyControls(),
    forceRegime: { regime: 'bear', untilTick: 5 },
    biases: [makeBias({ id: 'a', target: { type: 'market' }, value: 1, startTick: 1, duration: 3 }), makeBias({ id: 'b', target: { type: 'market' }, value: 1, startTick: 1, duration: 30 })],
    impacts: ['x', 'y', 'z'],
  };
  const p = pruneControls(c, 5);
  assert.deepEqual(p.biases.map((b) => b.id), ['b']);
  assert.equal(p.forceRegime, null);
  assert.deepEqual(dropImpacts(c, [0, 2]).impacts, ['y']);
  assert.equal(dropImpacts(c, []), c);
  let logged = emptyControls();
  for (let i = 0; i < LOG_CAP + 5; i++) logged = logEntry(logged, { i });
  assert.equal(logged.log.length, LOG_CAP);
  assert.equal(logged.log.at(-1).i, LOG_CAP + 4);
});

test('setCompanyPrice moves fair value too unless told not to', () => {
  const s = createInitialState({ companies: SAMPLE_COMPANIES });
  const a = setCompanyPrice(s, 'ARA', 300);
  assert.equal(a.companies.ARA.price, 300);
  assert.equal(a.companies.ARA.prevClose, 240);
  assert.ok(Math.abs(a.companies.ARA.fair - 300) < 1e-9);
  assert.equal(setCompanyPrice(s, 'ARA', 300, { alsoFair: false }).companies.ARA.fair, 240);
  assert.equal(setCompanyPrice(s, 'ARA', 0.1).companies.ARA.price, 1);
  assert.equal(setCompanyPrice(s, 'NOPE', 5), s);
});

// ── Controls driving the model ────────────────────────────────────────────────

const avgPrice = (controlsFor, ticks = 30, seeds = 25) => {
  let total = 0;
  for (let s = 0; s < seeds; s++) {
    const { state } = runTicks({
      state: createInitialState({ companies: SAMPLE_COMPANIES }), companies: SAMPLE_COMPANIES, seed: `c${s}`, ticks,
      controlsAt: (t) => resolveControls(controlsFor, t),
    });
    total += state.companies.ARA.price;
  }
  return total / seeds;
};

test('a sentiment bias moves the market in the chosen direction', () => {
  const up = { ...emptyControls(), biases: [makeBias({ id: 'u', target: { type: 'market' }, value: 1, startTick: 1, duration: 30 })] };
  const down = { ...emptyControls(), biases: [makeBias({ id: 'd', target: { type: 'market' }, value: -1, startTick: 1, duration: 30 })] };
  const base = avgPrice(emptyControls());
  assert.ok(avgPrice(up) > base);
  assert.ok(avgPrice(down) < base);
});

test('a company bias moves only that company', () => {
  const c = { ...emptyControls(), biases: [makeBias({ id: 'u', target: { type: 'company', id: 'ARA' }, value: 2, startTick: 1, duration: 10 })] };
  const run = (controls) => runTicks({ state: createInitialState({ companies: SAMPLE_COMPANIES }), companies: SAMPLE_COMPANIES, seed: 'z', ticks: 10, controlsAt: (t) => resolveControls(controls, t) }).state;
  const biased = run(c);
  const plain = run(emptyControls());
  assert.ok(biased.companies.ARA.price > plain.companies.ARA.price);
  assert.equal(biased.companies.MIL.price, plain.companies.MIL.price);
});

test('halting the whole market freezes every price', () => {
  const state = createInitialState({ companies: SAMPLE_COMPANIES });
  const step = stepMarket({ state, companies: SAMPLE_COMPANIES, seed: 'h', controls: resolveControls({ ...emptyControls(), haltAll: true }, 1) });
  for (const c of SAMPLE_COMPANIES) assert.equal(step.state.companies[c.id].price, state.companies[c.id].price);
});

test('a forced regime is applied, and a scheduled impact moves the target after its delay', () => {
  const state = createInitialState({ companies: SAMPLE_COMPANIES });
  const forced = stepMarket({ state, companies: SAMPLE_COMPANIES, seed: 'f', controls: resolveControls({ ...emptyControls(), forceRegime: { regime: 'crash', untilTick: 3 } }, 1) });
  assert.equal(forced.regime, 'crash');

  const impact = makeImpact({ id: 'i1', target: { type: 'company', id: 'ARA' }, amount: -0.2, onsetTick: 3 });
  const lone = [{ id: 'ARA', initialPrice: 100, volatility: 1, beta: 0, sectorBeta: 0 }];
  let s = createInitialState({ companies: lone });
  const prices = [];
  for (let t = 1; t <= 10; t++) {
    s = stepMarket({ state: s, companies: lone, seed: 'q', impacts: collectImpacts([impact], lone, t) }).state;
    prices.push(s.companies.ARA.price);
  }
  assert.ok(Math.abs(prices[0] - 100) < 5 && Math.abs(prices[1] - 100) < 5, 'no effect before onset');
  assert.ok(prices[9] < 90, 'effect shows after onset');
  assert.equal(impact.id, 'i1');
});
