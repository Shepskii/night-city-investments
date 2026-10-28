import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createInitialState, stepMarket, runTicks, addTime, dayOf, minutesToDays, TIME_EPS,
  collectImpacts, makeImpact, makeBias, makeGlide, resolveControls, pruneControls, restoreExpired, biasValueAt,
  appendClose, truncateHistory, emptyHistory, getSeries,
  makeFundState, stepFundState, planSession, sessionActive, applyRequests, emptyPortfolio, mergeState, splitState,
  payDividend,
} from '../scripts/engine/index.js';

const COMPANIES = [
  { id: 'AAA', ticker: 'AAA', sector: 'tech', initialPrice: 100, volatility: 3, beta: 1, sectorBeta: 1, liquidity: 3 },
  { id: 'BBB', ticker: 'BBB', sector: 'arms', initialPrice: 50, volatility: 4, beta: 1.2, sectorBeta: 1, liquidity: 3 },
];
const TENTH = minutesToDays(10);

// ── The clock ────────────────────────────────────────────────────────────────

test('a day of small steps lands on the whole day, and a tick moves the clock by its length', () => {
  let t = 0;
  for (let i = 0; i < 144; i++) t = addTime(t, TENTH);
  assert.equal(dayOf(t), 1, 'the 144th ten-minute tick completes the day');
  assert.ok(Math.abs(t - 1) < 1e-6);
  assert.equal(dayOf(t - TENTH), 0);
  assert.equal(addTime(5, 1), 6, 'whole days add exactly');
  assert.equal(minutesToDays(1440), 1);
  assert.ok(TIME_EPS > 0);

  const s0 = createInitialState({ companies: COMPANIES });
  assert.deepEqual([s0.tickIndex, s0.time], [0, 0]);
  const s1 = stepMarket({ state: s0, companies: COMPANIES, seed: 'x', dt: TENTH });
  assert.deepEqual([s1.state.tickIndex, s1.state.time, s1.newDay], [1, addTime(0, TENTH), false]);
  assert.equal(stepMarket({ state: s0, companies: COMPANIES, seed: 'x' }).newDay, true, 'a whole-day tick always starts a new day');
});

test('the whole-day tick is unchanged by the clock work', () => {
  const day = stepMarket({ state: createInitialState({ companies: COMPANIES }), companies: COMPANIES, seed: 'fixed' });
  const explicit = stepMarket({ state: createInitialState({ companies: COMPANIES }), companies: COMPANIES, seed: 'fixed', dt: 1 });
  assert.deepEqual(day.state, explicit.state);
  assert.equal(day.state.time, 1);
});

test('a company\'s previous close moves on once a game day, not each tick', () => {
  let state = createInitialState({ companies: COMPANIES });
  const opening = state.companies.AAA.price;
  const closes = [];
  for (let i = 0; i < 150; i++) {
    state = stepMarket({ state, companies: COMPANIES, seed: 'close', dt: TENTH }).state;
    closes.push(state.companies.AAA.prevClose);
  }
  assert.equal(closes[0], opening, 'during the first day it is the opening price');
  assert.equal(closes[142], opening);
  assert.notEqual(closes[149], opening, 'after the day turns it is the last price of the day');
  assert.equal(new Set(closes.slice(0, 143)).size, 1);
});

// ── Volatility and drift do not depend on how fine the ticks are ──────────────

const dailyReturns = (dt, days, paths) => {
  const perDay = Math.round(1 / dt);
  const out = [];
  for (let p = 0; p < paths; p++) {
    let state = createInitialState({ companies: COMPANIES });
    const { state: end } = runTicks({ state, companies: COMPANIES, seed: `vol-${p}`, ticks: perDay * days, dt });
    out.push(Math.log(end.companies.AAA.price / state.companies.AAA.price));
  }
  return out;
};
const stats = (xs) => {
  const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - mean) ** 2, 0) / (xs.length - 1));
  return { mean, sd };
};

test('movement over ten days is about the same whether the market ticks daily or every ten minutes', () => {
  const daily = stats(dailyReturns(1, 10, 300));
  const fine = stats(dailyReturns(TENTH, 10, 60));
  const ratio = fine.sd / daily.sd;
  assert.ok(ratio > 0.7 && ratio < 1.4, `volatility ratio ${ratio.toFixed(2)} (daily ${daily.sd.toFixed(4)}, fine ${fine.sd.toFixed(4)})`);
  assert.ok(Math.abs(fine.mean - daily.mean) < 0.05, `drift ${fine.mean.toFixed(4)} vs ${daily.mean.toFixed(4)}`);
  assert.ok(fine.sd < 0.3, 'and a ten-minute tick does not move a stock like a whole day');
});

test('a single ten-minute tick is tiny next to a whole-day one', () => {
  const state = createInitialState({ companies: COMPANIES });
  const move = (dt) => {
    const out = [];
    for (let p = 0; p < 80; p++) out.push(Math.abs(Math.log(stepMarket({ state, companies: COMPANIES, seed: `one-${p}`, dt }).state.companies.AAA.price / 100)));
    return out.reduce((a, b) => a + b, 0) / out.length;
  };
  assert.ok(move(TENTH) < move(1) / 5, `${move(TENTH).toFixed(5)} vs ${move(1).toFixed(5)}`);
});

// ── Events happen over game days ─────────────────────────────────────────────

const impactAt = (days) => makeImpact({ id: 'i', target: { type: 'company', id: 'AAA' }, amount: 0.05, onsetTick: days, source: 'gm' });
const cumulative = (impact, dt, upToDays) => {
  let total = 0;
  for (let t = dt; t <= upToDays + 1e-9; t = addTime(t, dt)) total += collectImpacts([impact], COMPANIES, t, dt).returns.AAA;
  return total;
};

test('an impact adds up to the same total over the same days at any tick size', () => {
  for (const days of [1, 3, 10, 30]) {
    const a = cumulative(impactAt(2), 1, days);
    const b = cumulative(impactAt(2), TENTH, days);
    assert.ok(Math.abs(a - b) < 1e-6, `${days} days: ${a} vs ${b}`);
  }
  assert.equal(cumulative(impactAt(2), TENTH, 2), 0, 'nothing before the delay has passed');
  assert.ok(cumulative(impactAt(2), TENTH, 2.5) > 0, 'and it starts after it');
});

test('a sentiment bias lasts its number of days whatever the tick is', () => {
  const bias = makeBias({ id: 'b', target: { type: 'market' }, value: 1, startTick: 3, duration: 2 });
  const ticks = (dt) => {
    let n = 0;
    for (let t = addTime(0, dt); t < 8; t = addTime(t, dt)) if (biasValueAt(bias, t)) n++;
    return n * dt;
  };
  assert.ok(Math.abs(ticks(1) - 2) < 1e-9);
  assert.ok(Math.abs(ticks(TENTH) - 2) < 1e-6, 'two days of ticks');

  const controls = { biases: [bias], glides: [], impacts: [], forceRegime: null };
  assert.equal(pruneControls(controls, 4.99, TENTH).biases.length, 1, 'still there on the last day');
  assert.equal(pruneControls(controls, 5, TENTH).biases.length, 0, 'gone when its days are up');
  assert.equal(resolveControls(controls, 2.9, TENTH).globalBias, 0);
  assert.equal(resolveControls(controls, 3, TENTH).globalBias, 1);
});

test('a bias moves the price by the same amount over its days at any tick size', () => {
  const total = (dt, days) => {
    let state = createInitialState({ companies: [{ ...COMPANIES[0], volatility: 1 }] });
    const noBias = { biases: [], glides: [], impacts: [] };
    const biased = { biases: [makeBias({ id: 'b', target: { type: 'company', id: 'AAA' }, value: 2, startTick: dt, duration: days })], glides: [], impacts: [] };
    const run = (controls) => {
      let s = state;
      for (let t = dt; t <= days + 1e-9; t = addTime(t, dt)) {
        s = stepMarket({ state: s, companies: COMPANIES.slice(0, 1), seed: 'bias', controls: resolveControls(controls, t, dt), dt }).state;
      }
      return Math.log(s.companies.AAA.price);
    };
    return run(biased) - run(noBias);
  };
  const a = total(1, 5);
  const b = total(TENTH, 5);
  assert.ok(a > 0 && b > 0);
  assert.ok(Math.abs(a - b) / a < 0.25, `${a} vs ${b}`);
});

test('a glide lands on its target at the end of its days, at any tick size', () => {
  const glide = makeGlide({ id: 'g', companyId: 'AAA', target: 130, startTick: TENTH, duration: 2, noise: 0.5 });
  let state = createInitialState({ companies: COMPANIES.slice(0, 1) });
  const controls = { biases: [], glides: [glide], impacts: [] };
  let steps = 0;
  for (let t = TENTH; t < 4; t = addTime(t, TENTH)) {
    const resolved = resolveControls(controls, t, TENTH);
    if (!resolved.glide.AAA) break;
    state = stepMarket({ state, companies: COMPANIES.slice(0, 1), seed: 'g', controls: resolved, dt: TENTH }).state;
    steps++;
  }
  assert.equal(steps, 288, 'two days of ten-minute ticks');
  assert.equal(state.companies.AAA.price, 130);
});

test('undoing a tick puts back biases that the tick used up, on the day clock', () => {
  const bias = makeBias({ id: 'b', target: { type: 'market' }, value: 1, startTick: 1, duration: 1 });
  const before = { biases: [bias], glides: [], impacts: [] };
  const after = pruneControls(before, 2, TENTH);
  assert.equal(after.biases.length, 0);
  assert.equal(restoreExpired(after, before, 2, TENTH).biases.length, 1);
  assert.equal(restoreExpired(after, before, 1.5, TENTH).biases.length, 0, 'not when the undone tick was before it ended');
});

// ── History keeps one close per game day ─────────────────────────────────────

test('history holds one close per game day however many ticks there are', () => {
  let h = emptyHistory();
  for (const [day, price] of [[0, 100], [0, 101], [0, 102], [1, 103], [1, 104], [2, 105]]) h = appendClose(h, 'AAA', day, price);
  assert.deepEqual(getSeries(h, 'AAA'), [102, 104, 105]);
  assert.equal(h.series.AAA.startTick, 0);

  h = appendClose(h, 'AAA', 5, 110);
  assert.deepEqual(getSeries(h, 'AAA'), [102, 104, 105, 105, 105, 110], 'a skipped day repeats the one before');
  assert.deepEqual(getSeries(truncateHistory(h, 1), 'AAA'), [102, 104]);
});

// ── Funds, sessions and dividends ────────────────────────────────────────────

test('a fund accrues its expense ratio per game day, not per tick', () => {
  const fund = { components: [{ companyId: 'AAA', weight: 1 }], expenseRatio: 0.0365, initialNav: 100 };
  const prices = { AAA: 100 };
  const accrue = (dt, n) => {
    let s = makeFundState(fund, prices);
    for (let i = 0; i < n; i++) s = stepFundState(s, fund, prices, {}, { dt, newDay: false });
    return s.accrual;
  };
  assert.ok(Math.abs(accrue(1, 10) - accrue(TENTH, 1440)) < 1e-5, 'ten days is ten days');
  const s = stepFundState(makeFundState(fund, prices), fund, prices, {}, { dt: TENTH, newDay: false });
  assert.equal(s.prevNav, 100, 'prevNav holds until the day turns');
  const moved = stepFundState({ ...makeFundState(fund, prices), nav: 120 }, fund, prices, {}, { dt: TENTH, newDay: true });
  assert.equal(moved.prevNav, 120);
});

test('a terminal session lasts its number of days, and a next-tick fill waits one tick', () => {
  const check = { success: true, total: 20, dv: 13 };
  const day = planSession({ check, tick: 5, sessionTicks: 1, lockoutTicks: 1 });
  assert.equal(day.session.validThroughTick, 5, 'a whole-day tick: just that day');
  const fine = planSession({ check, tick: 5, sessionTicks: 1, lockoutTicks: 1, dt: TENTH });
  const portfolio = { session: fine.session };
  assert.equal(sessionActive(portfolio, addTime(5, 100 * TENTH)), true, 'still open most of a day later');
  assert.equal(sessionActive(portfolio, addTime(5, 150 * TENTH)), false, 'and closed after it');
  assert.equal(planSession({ check: { success: false, crit: null }, tick: 5, sessionTicks: 1, lockoutTicks: 2, dt: TENTH }).lockoutUntilTick, 7, 'a lockout is days');

  const market = { AAA: { listed: true, active: true, price: 100, liquidity: 3 } };
  const place = (dt) => applyRequests({
    portfolio: { ...emptyPortfolio(), cash: 5000 },
    requests: [{ key: 'k', type: 'placeOrder', route: 'direct', side: 'buy', assetId: 'AAA', qty: 1, orderType: 'market', expiry: 'day' }],
    wealth: 0, tick: 3, market, settings: { mode: 'open', instant: false, dt },
  }).portfolio.orders[0];
  assert.equal(place(1).eligibleTick, 4);
  assert.ok(Math.abs(place(TENTH).eligibleTick - (3 + TENTH)) < 1e-9, 'the next tick, which is ten minutes on');
});

test('a dividend goes to shares held from before the payout day', () => {
  const lot = (id, acquiredTick) => ({ id, assetId: 'AAA', qty: 10, unitCost: 1, acquiredTick });
  const portfolio = { ...emptyPortfolio(), lots: [lot('early', 3.5), lot('same-day', 7.2), lot('after', 7.9)] };
  const out = payDividend({ portfolio, assetId: 'AAA', perShare: 1, key: 'q1', price: 100, tick: 7.5 });
  assert.equal(out.payout, 10, 'only the lot bought before day 7 qualifies');
});

test('the public state carries the clock, and an old market without one falls back to its tick count', () => {
  const state = { ...createInitialState({ companies: COMPANIES }), tickIndex: 7, time: 7.5 };
  const { pub, hidden } = splitState(state, 3);
  assert.equal(pub.time, 7.5);
  assert.equal(mergeState(pub, hidden).time, 7.5);
  const old = { ...pub };
  delete old.time;
  assert.equal(mergeState(old, hidden).time, 7, 'one tick was one day before the clock existed');
});
