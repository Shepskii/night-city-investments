/**
 * GM market controls
 * @file scripts/engine/marketControls.js
 * @description The GM's steering of the market, kept as data: sentiment biases with a duration and
 *              decay, a forced regime, a volatility multiplier, a market-wide halt, and a queue of
 *              scheduled impacts. Controls act on model parameters rather than raw prices, so the
 *              market stays plausible. Pure; no Foundry globals.
 *
 *   { schema, biases[], impacts[], volMult, companyVolMult{}, forceRegime, haltAll, log[] }
 */

import { TIME_EPS } from './clock.js';

export const CONTROLS_SCHEMA = 1;
export const LOG_CAP = 50;
export const MAX_BIAS = 3;

export const emptyControls = () => ({
  schema: CONTROLS_SCHEMA,
  biases: [],
  impacts: [],
  volMult: 1,
  companyVolMult: {},
  forceRegime: null,
  haltAll: false,
  glides: [],
  log: [],
});

export function normalizeControls(c) {
  const base = emptyControls();
  if (!c) return base;
  return {
    ...base,
    ...c,
    biases: c.biases ?? [],
    impacts: c.impacts ?? [],
    glides: c.glides ?? [],
    companyVolMult: c.companyVolMult ?? {},
    log: c.log ?? [],
  };
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** Turn a form value like "market", "sector:arms" or "company:ARA" into a target object. */
export function parseTarget(key) {
  const [type, ...rest] = String(key ?? '').split(':');
  const id = rest.join(':');
  if (type === 'market') return { type: 'market' };
  if ((type === 'sector' || type === 'company') && id) return { type, id };
  return null;
}

/** How long and how lasting a GM shock is. */
export const SHOCK_PERSISTENCE = {
  temporary: { permanent: 0.1, tauDown: 6 },
  standard: { permanent: 0.35, tauDown: 12 },
  lasting: { permanent: 0.8, tauDown: 20 },
};

/** Percent change (e.g. -8) to the log-return the impact kernel expects. */
export const percentToAmount = (percent) => Math.log(1 + clamp(Number(percent), -90, 500) / 100);

/**
 * A bias: extra drift for a target, in units of each company's daily sigma per game day, for a number of days.
 * @param {object} o
 * @param {string} o.id
 * @param {{type: 'market'|'sector'|'company', id?: string}} o.target
 * @param {number} o.value - sigma units per day, -3..3
 * @param {number} o.startTick - the game day it starts (a bias, glide or impact "tick" field holds a time in game days)
 * @param {number} o.duration - days it lasts
 * @param {'flat'|'linear'} [o.decay] - linear fades to zero over the duration
 */
export function makeBias({ id, target, value, startTick, duration, decay = 'flat', label = '' }) {
  return {
    id,
    target,
    value: clamp(Number(value), -MAX_BIAS, MAX_BIAS),
    startTick,
    duration: Math.max(1, Math.floor(duration)),
    decay: decay === 'linear' ? 'linear' : 'flat',
    label,
  };
}

/** The bias's effect at a tick (0 outside its window). Times are game days. */
export function biasValueAt(bias, tick) {
  const elapsed = tick - bias.startTick;
  if (elapsed < -TIME_EPS || elapsed >= bias.duration - TIME_EPS) return 0;
  return bias.decay === 'linear' ? bias.value * (1 - Math.max(0, elapsed) / bias.duration) : bias.value;
}

export const GLIDE_NOISE = { low: 0.25, medium: 0.5, high: 1 };
export const MAX_GLIDE_DAYS = 180;
/** A glide may not ask for more than this log-return per tick (about 20%). */
export const MAX_GLIDE_STEP = 0.2;

/**
 * A scripted glide: steer one company toward a target price, landing on it exactly on the last
 * tick. `noise` is the share of the normal random movement kept on the way (0 is a straight line).
 * It first applies on `startTick` and lasts `duration` ticks.
 */
export function makeGlide({ id, companyId, target, startTick, duration, noise = GLIDE_NOISE.medium }) {
  return {
    id,
    companyId,
    target: Math.round(Number(target) * 100) / 100,
    startTick,
    duration: clamp(Math.floor(duration), 1, MAX_GLIDE_DAYS),
    noise: clamp(Number(noise), 0, 1),
  };
}

/** The last tick a glide applies to, for a day-long tick. */
export const glideEndTick = (g) => g.startTick + g.duration - 1;

/** Can this glide be flown from `price`? It must be a real move that is not absurdly steep. */
export function glideFeasible(price, target, duration) {
  if (!(price > 0) || !(target >= 1)) return false;
  const days = clamp(Math.floor(duration), 1, MAX_GLIDE_DAYS);
  return Math.abs(Math.log(target / price)) / days <= MAX_GLIDE_STEP;
}

/**
 * Combine every active control into the object `stepMarket` expects for a tick. `tick` is the game
 * day the tick arrives at and `dt` how many days it covers.
 */
export function resolveControls(controls, tick, dt = 1) {
  const c = normalizeControls(controls);
  const out = {
    globalBias: 0,
    sectorBias: {},
    companyBias: {},
    volMult: c.volMult,
    companyVolMult: c.companyVolMult,
    frozenAll: c.haltAll,
    glide: {},
  };
  for (const g of c.glides) {
    const last = g.startTick + g.duration - dt;
    if (tick < g.startTick - TIME_EPS || tick > last + TIME_EPS) continue;
    out.glide[g.companyId] = { target: g.target, remaining: Math.max(1, Math.round((last - tick) / dt) + 1), noise: g.noise };
  }
  for (const bias of c.biases) {
    const v = biasValueAt(bias, tick);
    if (!v) continue;
    const { type, id } = bias.target;
    if (type === 'market') out.globalBias += v;
    else if (type === 'sector') out.sectorBias[id] = (out.sectorBias[id] ?? 0) + v;
    else if (type === 'company') out.companyBias[id] = (out.companyBias[id] ?? 0) + v;
  }
  if (c.forceRegime && tick <= c.forceRegime.untilTick + TIME_EPS) out.forceRegime = c.forceRegime.regime;
  return out;
}

/** Drop biases and forced regimes whose time has passed. */
export function pruneControls(controls, tick, dt = 1) {
  const c = normalizeControls(controls);
  return {
    ...c,
    biases: c.biases.filter((b) => tick < b.startTick + b.duration - TIME_EPS),
    glides: c.glides.filter((g) => tick < g.startTick + g.duration - dt - TIME_EPS),
    forceRegime: c.forceRegime && tick < c.forceRegime.untilTick - TIME_EPS ? c.forceRegime : null,
  };
}

/**
 * Undoing the tick `snapshotTick + 1` re-runs `pruneControls`' effect backwards: anything it removed
 * comes back, while everything else the GM has done since is left alone.
 * @param {object} current - controls now
 * @param {object} before - controls as they were before the undone tick
 * @param {number} undoneTick - the tick being undone (its game day)
 */
export function restoreExpired(current, before, undoneTick, dt = 1) {
  const now = normalizeControls(current);
  const old = normalizeControls(before);
  const have = (list) => new Set(list.map((x) => x.id));
  const biasIds = have(now.biases);
  const glideIds = have(now.glides);
  const gone = (g) => !(undoneTick < g.startTick + g.duration - dt - TIME_EPS);
  return {
    ...now,
    biases: [...now.biases, ...old.biases.filter((b) => !(undoneTick < b.startTick + b.duration - TIME_EPS) && !biasIds.has(b.id))],
    glides: [...now.glides, ...old.glides.filter((g) => gone(g) && !glideIds.has(g.id))],
    forceRegime: now.forceRegime ?? (old.forceRegime && !(undoneTick < old.forceRegime.untilTick - TIME_EPS) ? old.forceRegime : null),
  };
}

/** Remove impacts the kernel reports as finished (by index). */
export function dropImpacts(controls, indexes) {
  if (!indexes.length) return controls;
  const drop = new Set(indexes);
  return { ...controls, impacts: controls.impacts.filter((_, i) => !drop.has(i)) };
}

/** Append an audit entry, keeping the newest LOG_CAP. */
export function logEntry(controls, entry) {
  const c = normalizeControls(controls);
  return { ...c, log: [...c.log, entry].slice(-LOG_CAP) };
}

/**
 * Set a company's price directly (the GM escape hatch). By default fair value moves with it,
 * otherwise the model would pull the price straight back.
 */
export function setCompanyPrice(state, id, price, { alsoFair = true, minPrice = 1 } = {}) {
  const c = state.companies[id];
  if (!c) return state;
  const next = Math.max(minPrice, Math.round(price * 100) / 100);
  return {
    ...state,
    companies: {
      ...state.companies,
      [id]: { ...c, prevClose: c.price, price: next, fair: alsoFair ? c.fair * (next / c.price) : c.fair },
    },
  };
}
