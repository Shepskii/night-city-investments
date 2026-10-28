/**
 * Monte-Carlo preview
 * @file scripts/engine/preview.js
 * @description Shows the GM the range of outcomes a planned bias, shock or glide could produce
 *              before it is applied. Each scenario is run over many simulated futures and compared
 *              with the same futures without it (same random numbers, so the gap is the effect and
 *              not luck). The futures use their own seeds, never the world's, so the preview cannot
 *              reveal what will really happen. Pure; no Foundry globals.
 */

import { stepMarket } from './marketModel.js';
import { collectImpacts, makeImpact } from './impactKernel.js';
import { DEFAULT_MODEL_CONFIG } from './config.js';
import { addTime, timeOf } from './clock.js';
import {
  normalizeControls, resolveControls, pruneControls, dropImpacts, makeBias, makeGlide, parseTarget,
  percentToAmount, SHOCK_PERSISTENCE, glideFeasible,
} from './marketControls.js';

export const PREVIEW_PATHS = 200;
export const PREVIEW_MAX_TICKS = 120;

const percentile = (sorted, p) => {
  const idx = (sorted.length - 1) * p;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
};

/**
 * The controls as they would be with the scenario added.
 * @param {object} controls
 * @param {{kind: 'bias'|'shock'|'glide'}} scenario
 * @param {number} tick - the current tick; the scenario starts after it
 */
export function applyScenario(controls, scenario, tick) {
  const c = normalizeControls(controls);
  if (scenario.kind === 'bias') {
    const target = parseTarget(scenario.target);
    if (!target) return c;
    return { ...c, biases: [...c.biases, makeBias({ id: 'preview', target, value: scenario.value, startTick: tick + 1, duration: scenario.days, decay: scenario.decay })] };
  }
  if (scenario.kind === 'shock') {
    const target = parseTarget(scenario.target);
    if (!target) return c;
    const shape = SHOCK_PERSISTENCE[scenario.persistence] ?? SHOCK_PERSISTENCE.standard;
    const impact = makeImpact({
      id: 'preview', target, amount: percentToAmount(scenario.percent), onsetTick: tick + Math.max(0, Math.floor(scenario.delayDays || 0)), source: 'preview', ...shape,
    });
    return { ...c, impacts: [...c.impacts, impact] };
  }
  if (scenario.kind === 'glide') {
    const glide = makeGlide({ id: 'preview', companyId: scenario.companyId, target: scenario.target, startTick: tick + 1, duration: scenario.days, noise: scenario.noise });
    return { ...c, glides: [...c.glides.filter((g) => g.companyId !== scenario.companyId), glide] };
  }
  return c;
}

/** Which companies a scenario is about, in the order they are averaged. */
export function scenarioTargets(scenario, companies) {
  const active = companies.filter((c) => c.status === 'active' && c.listed !== false);
  if (scenario.kind === 'glide') return [scenario.companyId];
  const target = parseTarget(scenario.target);
  if (!target) return [];
  if (target.type === 'company') return [target.id];
  if (target.type === 'sector') return active.filter((c) => c.sector === target.id).map((c) => c.id);
  return active.map((c) => c.id);
}

function level(state, ids, start) {
  if (ids.length === 1) return state.companies[ids[0]].price;
  const sum = ids.reduce((s, id) => s + state.companies[id].price / start[id], 0);
  return (sum / ids.length) * 100;
}

/** Simulate `paths` futures and return each path's tracked level at every tick. */
export function simulatePaths({ state, companies, seed, controls, ticks, paths, trackIds, config = DEFAULT_MODEL_CONFIG }) {
  const start = Object.fromEntries(trackIds.map((id) => [id, state.companies[id].price]));
  const out = [];
  for (let i = 0; i < paths; i++) {
    let s = state;
    let c = normalizeControls(controls);
    const pathSeed = `${seed}|preview|${i}`;
    const series = [];
    for (let t = 0; t < ticks; t++) {
      // The preview steps a game day at a time, starting from where the real clock is.
      const time = addTime(timeOf(s), 1);
      const impacts = collectImpacts(c.impacts, companies, time, 1);
      const step = stepMarket({ state: s, companies, seed: pathSeed, config, controls: resolveControls(c, time, 1), impacts });
      s = step.state;
      c = pruneControls(dropImpacts(c, impacts.expired), time, 1);
      series.push(level(s, trackIds, start));
    }
    out.push(series);
  }
  return out;
}

function cone(matrix, ticks) {
  const p10 = [];
  const p50 = [];
  const p90 = [];
  for (let t = 0; t < ticks; t++) {
    const col = matrix.map((row) => row[t]).sort((a, b) => a - b);
    p10.push(percentile(col, 0.1));
    p50.push(percentile(col, 0.5));
    p90.push(percentile(col, 0.9));
  }
  return { p10, p50, p90 };
}

/**
 * Compare a scenario with doing nothing.
 * @returns {{ok: false, reason: string} | {ok: true, trackIds: string[], single: boolean, start: number, ticks: number, paths: number,
 *   baseline: object, scenario: object, summary: object}}
 */
export function previewScenario({ state, companies, seed, controls, scenario, ticks = 30, paths = PREVIEW_PATHS, config = DEFAULT_MODEL_CONFIG }) {
  const n = Math.min(PREVIEW_MAX_TICKS, Math.max(1, Math.floor(ticks)));
  const trackIds = scenarioTargets(scenario, companies).filter((id) => state.companies[id]);
  if (!trackIds.length) return { ok: false, reason: 'no-targets' };

  if (scenario.kind === 'glide' && !glideFeasible(state.companies[scenario.companyId].price, Number(scenario.target), scenario.days)) {
    return { ok: false, reason: 'glide-too-steep' };
  }

  const args = { state, companies, seed, ticks: n, paths, trackIds, config };
  const base = simulatePaths({ ...args, controls });
  const test = simulatePaths({ ...args, controls: applyScenario(controls, scenario, state.time ?? state.tickIndex) });

  const single = trackIds.length === 1;
  const start = single ? state.companies[trackIds[0]].price : 100;
  const baseCone = cone(base, n);
  const testCone = cone(test, n);
  const last = n - 1;
  const higher = test.filter((row, i) => row[last] > base[i][last]).length / paths;
  const change = (v) => (v - start) / start;

  return {
    ok: true,
    trackIds,
    single,
    start,
    ticks: n,
    paths,
    baseline: baseCone,
    scenario: testCone,
    summary: {
      baselineMedianChange: change(baseCone.p50[last]),
      scenarioMedianChange: change(testCone.p50[last]),
      scenarioLow: change(testCone.p10[last]),
      scenarioHigh: change(testCone.p90[last]),
      higherShare: higher,
    },
  };
}
