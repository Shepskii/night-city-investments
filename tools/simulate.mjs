/**
 * Monte-Carlo calibration harness for the price model. Runs without Foundry.
 *
 *   node tools/simulate.mjs [--seeds 200] [--ticks 365] [--start-regime sideways]
 *
 * Prints, per company: annualised volatility, typical max drawdown, and the spread of final
 * prices. Also reports how much time the market spends in each regime and the average
 * pairwise correlation. Use it to check the model against the targets in docs/DESIGN.md §5.5:
 * visible movement within a session, but no routine -90% in a week.
 */

import { createInitialState, stepMarket } from '../scripts/engine/index.js';
import { SAMPLE_COMPANIES } from './sample-companies.mjs';

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
}

const SEEDS = Number(arg('seeds', 200));
const TICKS = Number(arg('ticks', 365));
const START_REGIME = arg('start-regime', 'sideways');

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const std = (xs) => {
  const m = mean(xs);
  return Math.sqrt(mean(xs.map((x) => (x - m) ** 2)));
};
const quantile = (xs, q) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))];
};
function correlation(a, b) {
  const ma = mean(a);
  const mb = mean(b);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < a.length; i++) {
    num += (a[i] - ma) * (b[i] - mb);
    da += (a[i] - ma) ** 2;
    db += (b[i] - mb) ** 2;
  }
  return num / Math.sqrt(da * db);
}

const stats = Object.fromEntries(SAMPLE_COMPANIES.map((c) => [c.id, { annVol: [], maxDd: [], final: [], worstWeek: [] }]));
const regimeTicks = {};
const corrSamples = [];

for (let s = 0; s < SEEDS; s++) {
  let state = createInitialState({ companies: SAMPLE_COMPANIES, regime: START_REGIME });
  const series = Object.fromEntries(SAMPLE_COMPANIES.map((c) => [c.id, [c.initialPrice]]));
  const rets = Object.fromEntries(SAMPLE_COMPANIES.map((c) => [c.id, []]));

  for (let t = 0; t < TICKS; t++) {
    const step = stepMarket({ state, companies: SAMPLE_COMPANIES, seed: `sim-${s}` });
    state = step.state;
    regimeTicks[step.regime] = (regimeTicks[step.regime] ?? 0) + 1;
    for (const c of SAMPLE_COMPANIES) {
      series[c.id].push(state.companies[c.id].price);
      rets[c.id].push(step.results[c.id].r);
    }
  }

  for (const c of SAMPLE_COMPANIES) {
    const prices = series[c.id];
    let peak = prices[0];
    let dd = 0;
    for (const p of prices) {
      peak = Math.max(peak, p);
      dd = Math.max(dd, 1 - p / peak);
    }
    let worstWeek = 0;
    for (let i = 7; i < prices.length; i++) worstWeek = Math.max(worstWeek, 1 - prices[i] / prices[i - 7]);
    const st = stats[c.id];
    st.annVol.push(std(rets[c.id]) * Math.sqrt(365));
    st.maxDd.push(dd);
    st.final.push(prices[prices.length - 1] / prices[0]);
    st.worstWeek.push(worstWeek);
  }

  const ids = SAMPLE_COMPANIES.map((c) => c.id);
  const pairs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) pairs.push(correlation(rets[ids[i]], rets[ids[j]]));
  corrSamples.push(mean(pairs));
}

const pct = (x) => `${(x * 100).toFixed(1)}%`;
console.log(`Night City Investments price model: ${SEEDS} seeds x ${TICKS} ticks, start regime ${START_REGIME}\n`);
console.log('ticker  annVol   maxDD(med)  worstWeek(p95)  final p5 / median / p95');
for (const c of SAMPLE_COMPANIES) {
  const st = stats[c.id];
  console.log(
    `${c.id.padEnd(6)}  ${pct(mean(st.annVol)).padStart(6)}   ${pct(quantile(st.maxDd, 0.5)).padStart(8)}    ${pct(quantile(st.worstWeek, 0.95)).padStart(10)}      ` +
      `${quantile(st.final, 0.05).toFixed(2)}x / ${quantile(st.final, 0.5).toFixed(2)}x / ${quantile(st.final, 0.95).toFixed(2)}x`,
  );
}
const totalTicks = Object.values(regimeTicks).reduce((a, b) => a + b, 0);
console.log('\nTime in regime: ' + Object.entries(regimeTicks).map(([r, n]) => `${r} ${pct(n / totalTicks)}`).join(', '));
console.log(`Average pairwise return correlation: ${mean(corrSamples).toFixed(2)}`);
