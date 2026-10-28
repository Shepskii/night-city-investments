import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, stepMarket, runTicks, dailySigma } from '../scripts/engine/marketModel.js';
import { DEFAULT_MODEL_CONFIG, REGIMES } from '../scripts/engine/config.js';
import { makeImpact, collectImpacts } from '../scripts/engine/impactKernel.js';
import { SAMPLE_COMPANIES } from '../tools/sample-companies.mjs';

const fresh = () => createInitialState({ companies: SAMPLE_COMPANIES });

test('a tick is deterministic for the same seed', () => {
  const a = stepMarket({ state: fresh(), companies: SAMPLE_COMPANIES, seed: 'x' });
  const b = stepMarket({ state: fresh(), companies: SAMPLE_COMPANIES, seed: 'x' });
  assert.deepEqual(a, b);
});

test('different seeds diverge', () => {
  const a = stepMarket({ state: fresh(), companies: SAMPLE_COMPANIES, seed: 'x' });
  const b = stepMarket({ state: fresh(), companies: SAMPLE_COMPANIES, seed: 'y' });
  assert.notDeepEqual(a.state.companies, b.state.companies);
});

test('input state is not mutated', () => {
  const state = fresh();
  const snapshot = JSON.stringify(state);
  stepMarket({ state, companies: SAMPLE_COMPANIES, seed: 'x' });
  assert.equal(JSON.stringify(state), snapshot);
});

test('catch-up in one call equals stepping one at a time', () => {
  const batch = runTicks({ state: fresh(), companies: SAMPLE_COMPANIES, seed: 's', ticks: 10 });
  let state = fresh();
  for (let i = 0; i < 10; i++) state = stepMarket({ state, companies: SAMPLE_COMPANIES, seed: 's' }).state;
  assert.deepEqual(batch.state, state);
});

test('prices stay finite and above the floor over a long run', () => {
  const { state } = runTicks({ state: fresh(), companies: SAMPLE_COMPANIES, seed: 'long', ticks: 730 });
  for (const s of Object.values(state.companies)) {
    assert.ok(Number.isFinite(s.price));
    assert.ok(s.price >= DEFAULT_MODEL_CONFIG.minPrice);
  }
  assert.ok(REGIMES.includes(state.regime));
});

test('higher volatility rating moves more on average', () => {
  const calm = { id: 'CALM', initialPrice: 100, volatility: 1, beta: 0 };
  const wild = { id: 'WILD', initialPrice: 100, volatility: 5, beta: 0 };
  assert.ok(dailySigma(wild) > dailySigma(calm));
  let calmSum = 0;
  let wildSum = 0;
  for (let s = 0; s < 40; s++) {
    const { steps } = runTicks({ state: createInitialState({ companies: [calm, wild] }), companies: [calm, wild], seed: `v${s}`, ticks: 60 });
    for (const st of steps) {
      calmSum += Math.abs(st.results.CALM.r);
      wildSum += Math.abs(st.results.WILD.r);
    }
  }
  assert.ok(wildSum > calmSum * 3);
});

test('positive bias lifts prices relative to no bias', () => {
  const run = (bias) => {
    let total = 0;
    for (let s = 0; s < 30; s++) {
      const { state } = runTicks({
        state: fresh(), companies: SAMPLE_COMPANIES, seed: `b${s}`, ticks: 40,
        controlsAt: () => ({ globalBias: bias }),
      });
      total += state.companies.ARA.price;
    }
    return total / 30;
  };
  assert.ok(run(1) > run(0));
  assert.ok(run(-1) < run(0));
});

test('frozen and non-active companies do not move', () => {
  const companies = SAMPLE_COMPANIES.map((c) => (c.id === 'MIL' ? { ...c, status: 'halted' } : c));
  const step = stepMarket({ state: fresh(), companies, seed: 'f', controls: { frozen: ['ARA'] } });
  assert.equal(step.results.MIL.close, step.results.MIL.open);
  assert.equal(step.results.ARA.close, step.results.ARA.open);
  assert.notEqual(step.results.BIO.close, step.results.BIO.open);
});

test('forced regime is honoured', () => {
  const step = stepMarket({ state: fresh(), companies: SAMPLE_COMPANIES, seed: 'r', controls: { forceRegime: 'crash' } });
  assert.equal(step.regime, 'crash');
});

test('a positive impact raises the target with a delay', () => {
  const company = { id: 'ARA', initialPrice: 100, volatility: 1, beta: 0, sectorBeta: 0 };
  const impact = makeImpact({ target: { type: 'company', id: 'ARA' }, amount: 0.1, onsetTick: 3, sourceKey: 'gig:1:done' });
  let state = createInitialState({ companies: [company] });
  const cfg = { ...DEFAULT_MODEL_CONFIG, sigmaMarket: 0, sigmaSector: 0, jumpChance: 0, volatilityDaily: [0, 0, 0, 0, 0] };
  const prices = [];
  for (let t = 1; t <= 20; t++) {
    const impacts = collectImpacts([impact], [company], t);
    state = stepMarket({ state, companies: [company], seed: 'i', config: { ...cfg, defaultDrift: 0, regimes: { ...cfg.regimes, sideways: { ...cfg.regimes.sideways, meanDuration: 1e9, drift: 0 } } }, impacts }).state;
    prices.push(state.companies.ARA.price);
  }
  assert.equal(prices[0], 100);
  assert.equal(prices[1], 100);
  assert.ok(prices[4] > 100, 'rises after onset');
  assert.ok(prices[19] > 103, 'keeps a permanent part');
});
