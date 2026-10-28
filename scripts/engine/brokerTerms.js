/**
 * Broker terms
 * @file scripts/engine/brokerTerms.js
 * @description Turns a broker's Accounting skill into the terms they trade on, and defines the
 *              direct-trading terms they are measured against. Pure; no Foundry globals.
 *
 * Rules that always hold, whatever the settings:
 *   - a broker's commission and flat fee never exceed the direct-trade ones
 *   - a broker always takes at least one market tick; a direct trade takes none
 */

import { createRng } from './rng.js';
import { DIRECT_DEFAULTS, BROKER_TUNING } from './config.js';

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const lerp = (a, b, t) => a + (b - a) * t;
const round2 = (n) => Math.round(n * 100) / 100;

/** Accounting total as CPR rolls it: governing stat plus skill level. */
export function accountingTotal({ stat = 0, level = 0 } = {}) {
  return clamp(Math.round(Number(stat) || 0) + Math.round(Number(level) || 0), 0, 30);
}

/** Position of a skill total between the tuning's low and high ends, 0..1. */
export function skillFraction(total, tuning = BROKER_TUNING) {
  return clamp((total - tuning.skillMin) / (tuning.skillMax - tuning.skillMin), 0, 1);
}

/** Named grade for a skill total, e.g. 'rookie' to 'elite'. */
export function skillGrade(total, tuning = BROKER_TUNING) {
  return (tuning.grades.find((g) => total <= g.upTo) ?? tuning.grades.at(-1)).key;
}

/** Normalise the GM's direct-trading settings. */
export function directTerms(direct = {}) {
  const d = { ...DIRECT_DEFAULTS, ...direct };
  return {
    commissionBps: Math.max(0, Number(d.commissionBps) || 0),
    flatFee: Math.max(0, Math.round(Number(d.flatFee) || 0)),
    dv: clamp(Math.round(Number(d.dv) || DIRECT_DEFAULTS.dv), 1, 40),
    sessionTicks: Math.max(1, Math.round(Number(d.sessionTicks) || 1)),
    lockoutTicks: Math.max(1, Math.round(Number(d.lockoutTicks) || 1)),
    network: String(d.network || DIRECT_DEFAULTS.network),
  };
}

/**
 * The terms a broker with this Accounting total trades on.
 * @param {number} total - INT + Accounting level
 * @param {object} [direct] - the GM's direct-trading settings
 */
export function brokerTerms(total, direct = {}, tuning = BROKER_TUNING) {
  const d = directTerms(direct);
  const t = skillFraction(total, tuning);
  const factor = lerp(tuning.costFactor.min, tuning.costFactor.max, t);
  const band = tuning.latencyBands.find((b) => total <= b.upTo) ?? tuning.latencyBands.at(-1);

  // Never at or above direct, however the tuning is edited.
  const commissionBps = d.commissionBps > 0 ? Math.min(round2(d.commissionBps * factor), round2(d.commissionBps * 0.95)) : 0;
  const flatFee = Math.min(Math.round(d.flatFee * factor), d.flatFee);

  return {
    total,
    grade: skillGrade(total, tuning),
    costFactor: round2(factor),
    commissionBps,
    flatFee,
    latency: { min: Math.max(1, band.min), max: Math.max(1, band.max) },
    loadRebate: round2(tuning.fund.loadRebateMax * t),
    timingMeanBps: round2(lerp(tuning.fund.timingMeanBps.min, tuning.fund.timingMeanBps.max, t)),
    timingSigmaBps: tuning.fund.timingSigmaBps,
  };
}

/** The fee profile used by order maths: { flatFee, commissionBps }. */
export const feeProfileOf = (terms) => ({ flatFee: terms.flatFee, commissionBps: terms.commissionBps });

/**
 * How many ticks a particular order takes, picked from the broker's range.
 * Deterministic for a given seed and key, so a replay gives the same answer.
 */
export function pickLatency(terms, seed, key) {
  const { min, max } = terms.latency;
  if (min >= max) return min;
  return createRng(seed, 'latency', key).int(min, max);
}

/**
 * How much better (positive) or worse (negative) than the NAV a broker's timing is on one fund
 * order, in basis points. Skilled brokers usually beat the NAV; unskilled ones often do not.
 */
export function fundTiming({ terms, seed, key }) {
  const z = createRng(seed, 'fund-timing', key).normal();
  return round2(terms.timingMeanBps + terms.timingSigmaBps * z);
}

/**
 * Per-unit price of a fund order. The fund's entry (buy) or exit (sell) charge is cut by the
 * broker's rebate, then the broker's timing moves the price in the client's favour or against them.
 * @param {'buy'|'sell'} side
 * @param {{loadBps: number, exitBps: number}} fund
 * @param {{loadRebate: number}} terms
 * @param {number} timingBps
 */
export function fundExecutionPrice({ side, nav, fund, terms, timingBps }) {
  const rebate = clamp(terms.loadRebate ?? 0, 0, 1);
  const bps = side === 'buy'
    ? (fund.loadBps ?? 0) * (1 - rebate) - timingBps
    : -((fund.exitBps ?? 0) * (1 - rebate)) + timingBps;
  return Math.max(0.01, round2(nav * (1 + bps / 10000)));
}

/** A plain-language summary of a broker's terms, for the picker. */
export function describeTerms(terms) {
  return {
    grade: terms.grade,
    total: terms.total,
    commissionPct: round2(terms.commissionBps / 100),
    flatFee: terms.flatFee,
    minDays: terms.latency.min,
    maxDays: terms.latency.max,
  };
}
