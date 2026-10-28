/**
 * Event impact kernel
 * @file scripts/engine/impactKernel.js
 * @description Turns a queued event (gig outcome, GM shock, news) into per-tick log-return
 *              increments with a delay, a ramp-up, and a decay toward a permanent remainder.
 *
 *   H(t) = A * (1 - exp(-(t - onset) / tauUp)) * (p + (1 - p) * exp(-(t - onset) / tauDown))
 *   increment at tick t = H(t) - H(t - 1)
 *
 * The permanent part p also shifts fair value, so the price does not simply revert.
 */

export const IMPACT_DEFAULTS = Object.freeze({
  tauUp: 1.5,
  tauDown: 12,
  permanent: 0.35,
});

/**
 * Build an impact record.
 * @param {object} o
 * @param {{type: 'company'|'sector'|'market', id?: string}} o.target
 * @param {number} o.amount - total log-return A (0.05 is about +5%)
 * @param {number} o.onsetTick - first tick at which the effect can appear
 * @param {string} [o.sourceKey] - idempotency key, e.g. "gig:<id>:done"
 */
export function makeImpact({ id = null, target, amount, onsetTick, sourceKey = null, source = 'manual', tauUp, tauDown, permanent, meta = {} }) {
  return {
    id,
    target,
    amount,
    onsetTick,
    tauUp: tauUp ?? IMPACT_DEFAULTS.tauUp,
    tauDown: tauDown ?? IMPACT_DEFAULTS.tauDown,
    permanent: permanent ?? IMPACT_DEFAULTS.permanent,
    sourceKey,
    source,
    meta,
  };
}

/** Cumulative log-return response at tick t. */
export function cumulativeResponse(impact, tick) {
  const dt = tick - impact.onsetTick;
  if (dt <= 0) return 0;
  const ramp = 1 - Math.exp(-dt / impact.tauUp);
  const decay = impact.permanent + (1 - impact.permanent) * Math.exp(-dt / impact.tauDown);
  return impact.amount * ramp * decay;
}

/** Cumulative response of only the permanent component. */
export function permanentResponse(impact, tick) {
  const dt = tick - impact.onsetTick;
  if (dt <= 0) return 0;
  return impact.amount * impact.permanent * (1 - Math.exp(-dt / impact.tauUp));
}

/** Log-return increment over the tick ending at `tick` (a game day), which lasted `dt` days. */
export function increment(impact, tick, dt = 1) {
  return cumulativeResponse(impact, tick) - cumulativeResponse(impact, tick - dt);
}

/** Increment of the permanent component over the same tick, applied to fair value. */
export function fairIncrement(impact, tick, dt = 1) {
  return permanentResponse(impact, tick) - permanentResponse(impact, tick - dt);
}

/** True once the transient part has faded and the ramp is complete. */
export function isExpired(impact, tick) {
  const horizon = 8 * Math.max(impact.tauUp, impact.tauDown);
  return tick - impact.onsetTick > horizon;
}

function appliesTo(impact, company) {
  const { type, id } = impact.target;
  if (type === 'company') return id === company.id;
  if (type === 'sector') return id === company.sector;
  return type === 'market';
}

/**
 * Sum every impact's increments for one tick. `tick` is the game day the tick arrives at and `dt` how many days it covers.
 * Market-wide impacts are scaled by each company's beta.
 * @returns {{returns: Object<string, number>, fairShift: Object<string, number>, expired: number[]}}
 *          `expired` lists indexes into `impacts` that can be dropped.
 */
export function collectImpacts(impacts, companies, tick, dt = 1) {
  const returns = {};
  const fairShift = {};
  const expired = [];
  for (const c of companies) {
    returns[c.id] = 0;
    fairShift[c.id] = 0;
  }
  impacts.forEach((impact, index) => {
    if (isExpired(impact, tick)) {
      expired.push(index);
      return;
    }
    const inc = increment(impact, tick, dt);
    const fair = fairIncrement(impact, tick, dt);
    for (const c of companies) {
      if (!appliesTo(impact, c)) continue;
      const scale = impact.target.type === 'market' ? (c.beta ?? 1) : 1;
      returns[c.id] += inc * scale;
      fairShift[c.id] += fair * scale;
    }
  });
  return { returns, fairShift, expired };
}

/**
 * Size of a gig outcome's market impact.
 *   A = sign * clamp(k * log10(1 + reward / refReward) + floor, cap), failures weighted heavier.
 * @param {'done'|'failed'} outcome
 * @param {number} reward - eb
 */
export function gigImpactAmount({ outcome, reward, refReward = 1000, k = 0.03, floor = 0.005, cap = 0.08, failWeight = 1.3 }) {
  const base = Math.min(cap, k * Math.log10(1 + Math.max(0, reward) / refReward) + floor);
  return outcome === 'failed' ? -Math.min(cap, base * failWeight) : base;
}

/** Diminishing returns when a company has already received recent impacts. */
export function saturate(amount, recentAbsTotal, softCap = 0.1) {
  const room = Math.max(0, 1 - recentAbsTotal / softCap);
  return amount * room;
}
