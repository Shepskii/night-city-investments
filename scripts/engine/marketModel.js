/**
 * Market price model
 * @file scripts/engine/marketModel.js
 * @description One tick of the market. Pure and deterministic: the same (state, seed, controls,
 *              impacts) always yields the same result. No Foundry globals.
 *
 *   r_i = drift_i + beta_i * M + sectorBeta_i * S_sector + eps_i + jump_i
 *         + impacts_i + bias_i + kappa * ln(F_i / P_i)
 *
 *   M   market factor: regime drift plus noise; the regime is a sticky Markov chain
 *   S   sector factor noise
 *   eps fat-tailed noise scaled by a GARCH-style volatility ratio
 *   F   fair value: follows the systematic parts and permanent impacts, not the noise
 */

import { createRng } from './rng.js';
import { DEFAULT_MODEL_CONFIG, COMPANY_DEFAULTS } from './config.js';
import { addTime, dayOf } from './clock.js';

const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Fill in omitted company fields. */
export function normalizeCompany(company) {
  return { ...COMPANY_DEFAULTS, ...company };
}

/** Base daily sigma for a company, from its 1..5 volatility rating. */
export function dailySigma(company, config = DEFAULT_MODEL_CONFIG) {
  const rating = clamp(Math.round(company.volatility ?? COMPANY_DEFAULTS.volatility), 1, 5);
  return config.volatilityDaily[rating - 1];
}

function freshCompanyState(company) {
  const c = normalizeCompany(company);
  // After a stock split the price basis is the original price divided by the cumulative split factor.
  const price = round2(c.price ?? c.initialPrice / (c.splitFactor ?? 1));
  return { price, prevClose: price, fair: price, vol: 1, floorTicks: 0 };
}

/**
 * Build the starting state.
 * @param {object} o
 * @param {object[]} o.companies - each needs `id` and `initialPrice`
 */
export function createInitialState({ companies, tickIndex = 0, regime = 'sideways' }) {
  const state = { tickIndex, time: tickIndex, regime, regimeAge: 0, companies: {} };
  for (const c of companies) state.companies[c.id] = freshCompanyState(c);
  return state;
}

/** Add a company to an existing state (new listing or IPO). */
export function addCompanyToState(state, company) {
  return { ...state, companies: { ...state.companies, [company.id]: freshCompanyState(company) } };
}

/** Choose the regime for the next tick. `dt` is the tick's length in days, so a regime lasts as long in days however fine the ticks are. */
export function nextRegime(current, rng, config = DEFAULT_MODEL_CONFIG, dt = 1) {
  const def = config.regimes[current];
  if (!def) return 'sideways';
  const p = dt === 1 ? 1 / def.meanDuration : 1 - (1 - 1 / def.meanDuration) ** dt;
  if (!rng.chance(p)) return current;
  return rng.weighted(def.next);
}

/**
 * Advance the market by one tick.
 *
 * @param {object} o
 * @param {object} o.state - from createInitialState / a previous step (not mutated)
 * @param {object[]} o.companies - company definitions
 * @param {number|string} o.seed - world seed
 * @param {object} [o.config]
 * @param {object} [o.controls] - GM steering for this tick:
 *        { globalBias, sectorBias:{}, companyBias:{}, volMult, companyVolMult:{}, forceRegime, frozen:[ids] }
 *        Bias values are in units of the company's base daily sigma.
 * @param {{returns: Object, fairShift: Object}} [o.impacts] - from collectImpacts()
 */
export function stepMarket({ state, companies, seed, config = DEFAULT_MODEL_CONFIG, controls = {}, impacts = null, dt = 1 }) {
  const tick = state.tickIndex + 1;
  const time = addTime(state.time ?? state.tickIndex, dt);
  const newDay = dayOf(time) > dayOf(state.time ?? state.tickIndex);
  const rootDt = Math.sqrt(dt);
  const defs = companies.map(normalizeCompany).sort((a, b) => (a.id < b.id ? -1 : 1));

  const regimeRng = createRng(seed, tick, 'regime');
  const regime = controls.forceRegime ?? nextRegime(state.regime, regimeRng, config, dt);
  const regimeDef = config.regimes[regime] ?? config.regimes.sideways;
  const regimeChanged = regime !== state.regime;

  const globalVolMult = controls.volMult ?? 1;
  const marketRng = createRng(seed, tick, 'market');
  // Rates (drift, pull toward fair value, bias) scale with the tick's length, random movement with its square root.
  const M = regimeDef.drift * dt + config.sigmaMarket * rootDt * regimeDef.volMult * globalVolMult * marketRng.normal();

  const sectorShock = {};
  for (const sector of [...new Set(defs.map((c) => c.sector))].sort()) {
    sectorShock[sector] = config.sigmaSector * rootDt * createRng(seed, tick, `sector:${sector}`).normal();
  }

  const garchA = config.garchA * dt;
  const garchB = dt === 1 ? config.garchB : config.garchB ** dt;
  const nextCompanies = { ...state.companies };
  const results = {};

  for (const c of defs) {
    const prev = state.companies[c.id];
    if (!prev) continue;
    const prevClose = newDay ? prev.price : prev.prevClose;

    if (c.status !== 'active' || controls.frozenAll || controls.frozen?.includes(c.id)) {
      nextCompanies[c.id] = { ...prev, prevClose };
      results[c.id] = { open: prev.price, close: prev.price, r: 0, circuitBreaker: false, frozen: true };
      continue;
    }

    const rng = createRng(seed, tick, c.id);
    const baseSigma = dailySigma(c, config);
    const sigmaBar = baseSigma * globalVolMult * (controls.companyVolMult?.[c.id] ?? 1);
    const z = rng.studentT(config.studentDf);
    const eps = sigmaBar * rootDt * Math.sqrt(prev.vol) * z;

    const jumpRoll = rng.chance(config.jumpChance * dt);
    const jumpSize = rng.normal();
    const jump = jumpRoll ? jumpSize * config.jumpSigmaMult * sigmaBar : 0;

    const drift = (c.drift ?? config.defaultDrift) * dt;
    const systematic = drift + c.beta * M + c.sectorBeta * sectorShock[c.sector];
    const bias = ((controls.globalBias ?? 0) + (controls.sectorBias?.[c.sector] ?? 0) + (controls.companyBias?.[c.id] ?? 0)) * baseSigma * dt;
    const impact = impacts?.returns?.[c.id] ?? 0;
    const reversion = config.kappa * dt * Math.log(prev.fair / prev.price);

    const raw = systematic + eps + jump + impact + bias + reversion;
    const glide = controls.glide?.[c.id];
    let r = clamp(raw, -config.maxMove, config.maxMove);
    let price = round2(Math.max(config.minPrice, prev.price * Math.exp(r)));
    let fairStep = systematic + (impacts?.fairShift?.[c.id] ?? 0);

    if (glide) {
      // Scripted path: an even share of the remaining distance, some of the usual noise on top,
      // and no noise at all on the last tick so it lands on the target.
      const need = Math.log(glide.target / prev.price) / glide.remaining;
      const last = glide.remaining <= 1;
      r = clamp(need + (last ? 0 : (eps + jump) * glide.noise), -config.maxMove, config.maxMove);
      price = last ? round2(Math.max(config.minPrice, glide.target)) : round2(Math.max(config.minPrice, prev.price * Math.exp(r)));
      fairStep = need;
    }

    const fair = prev.fair * Math.exp(fairStep);
    // Volatility ratio h: h' = (1 - a - b) + (a * z^2 + b) * h
    const vol = clamp(
      1 - garchA - garchB + (garchA * z * z + garchB) * prev.vol,
      config.garchMin,
      config.garchMax,
    );

    nextCompanies[c.id] = {
      price,
      prevClose,
      fair,
      vol,
      floorTicks: price <= config.minPrice ? (prev.floorTicks ?? 0) + 1 : 0,
    };
    results[c.id] = { open: prev.price, close: price, r, circuitBreaker: Math.abs(raw) > config.circuitBreaker, frozen: false };
  }

  return {
    state: {
      tickIndex: tick,
      time,
      regime,
      regimeAge: regimeChanged ? 0 : state.regimeAge + 1,
      companies: nextCompanies,
    },
    tickIndex: tick,
    time,
    newDay,
    regime,
    regimeChanged,
    marketReturn: M,
    results,
  };
}

/**
 * Advance several ticks of `dt` days each. `impactsAt(tick, time)` and `controlsAt(tick, time)` may
 * supply per-tick inputs; `time` is the game day the tick arrives at.
 * @returns {{state: object, steps: object[]}}
 */
export function runTicks({ state, companies, seed, ticks, config, controlsAt, impactsAt, dt = 1 }) {
  let current = state;
  const steps = [];
  for (let i = 0; i < ticks; i++) {
    const t = current.tickIndex + 1;
    const time = addTime(current.time ?? current.tickIndex, dt);
    const step = stepMarket({
      state: current,
      companies,
      seed,
      config,
      controls: controlsAt?.(t, time) ?? {},
      impacts: impactsAt?.(t, time) ?? null,
      dt,
    });
    steps.push(step);
    current = step.state;
  }
  return { state: current, steps };
}
