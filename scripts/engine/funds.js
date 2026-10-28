/**
 * Pooled funds
 * @file scripts/engine/funds.js
 * @description Fund definitions and net asset value (NAV). A fund holds fixed amounts of several
 *              companies, so its NAV is derived from their prices, not simulated. The NAV also
 *              earns the components' dividend yield and pays the fund's expense ratio, a little
 *              each tick. Funds can only be traded through a broker. Pure; no Foundry globals.
 *
 *   def:   { id, ticker, name, kind, components:[{companyId, weight}], expenseRatio, loadBps,
 *            exitBps, minBuy, initialNav, status, description }
 *   state: { nav, prevNav, divisor, accrual }
 */

import { normalizeTicker } from './companyConfig.js';
import { annualYield, periodKey } from './dividends.js';

export const FUND_KINDS = ['index', 'sector', 'themed', 'managed'];
export const FUND_STATUSES = ['active', 'closed'];
export const FUND_REBALANCE = ['none', 'monthly', 'quarterly'];
export const FUND_DISTRIBUTION = ['accumulating', 'distributing'];
export const FUND_DIST_FREQUENCIES = ['monthly', 'quarterly'];
/** Longest a fund may hold a seller's money after a redemption, in ticks. */
export const MAX_REDEEM_DELAY = 10;
/** Most a manager can add to (or lose from) the fund's yearly return, as a fraction. */
export const MAX_MANAGER_ALPHA = 0.1;
export const TICKS_PER_YEAR = 365;

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const num = (v, fallback) => (Number.isFinite(Number(v)) && v !== '' && v !== null ? Number(v) : fallback);
const round2 = (n) => Math.round(n * 100) / 100;
const round6 = (n) => Math.round(n * 1e6) / 1e6;

/**
 * Parse "ARA 30, MIL 20" (or one per line; ":" or "=" also work; a bare ticker has weight 1).
 * @param {string|object[]} input - text, or an array of { companyId | ticker, weight }
 * @param {Set<string>|string[]|null} known - valid company ids; unknown ones are reported
 * @returns {{components: object[], unknown: string[]}}
 */
export function parseComponents(input, known = null) {
  const entries = Array.isArray(input)
    ? input.map((c) => [c.companyId ?? c.ticker, c.weight ?? 1])
    : String(input ?? '').split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean).map((s) => {
      const m = s.match(/^([A-Za-z0-9.]+)\s*[:=\s]?\s*(\d+(?:\.\d+)?)?\s*%?$/);
      return m ? [m[1], m[2] === undefined ? 1 : Number(m[2])] : [s, NaN];
    });

  const allowed = known ? new Set([...known].map((k) => String(k).toUpperCase())) : null;
  const merged = new Map();
  const unknown = [];
  for (const [raw, weight] of entries) {
    const id = String(raw ?? '').toUpperCase();
    if (!id || !(weight > 0) || (allowed && !allowed.has(id))) {
      if (id) unknown.push(id);
      continue;
    }
    merged.set(id, (merged.get(id) ?? 0) + weight);
  }
  return { components: [...merged].map(([companyId, weight]) => ({ companyId, weight })), unknown };
}

/** Target value shares for rebalancing, as { companyId: fraction }. Anything that is not a positive number is dropped. */
function cleanTargets(targets) {
  const out = {};
  for (const [id, v] of Object.entries(targets)) {
    const n = Number(v);
    if (n > 0) out[String(id).toUpperCase()] = round6(n);
  }
  return out;
}

/** Scale component weights so they add up to 1. */
export function normalizeWeights(components) {
  const total = components.reduce((s, c) => s + c.weight, 0);
  return total > 0 ? components.map((c) => ({ ...c, weight: round6(c.weight / total) })) : components;
}

/**
 * Validate and normalise a fund definition.
 * @returns {{ok: true, fund: object} | {ok: false, errors: string[]}}
 */
export function sanitizeFund(input, { knownIds = null } = {}) {
  const errors = [];
  const name = String(input.name ?? '').trim();
  const ticker = normalizeTicker(input.ticker);
  if (!name) errors.push('name-required');
  if (ticker.length < 2) errors.push('ticker-invalid');

  const { components, unknown } = parseComponents(input.components, knownIds);
  if (!components.length) errors.push('components-invalid');
  if (unknown.length) errors.push('components-unknown');
  if (errors.length) return { ok: false, errors, unknown };

  return {
    ok: true,
    fund: {
      id: input.id ? String(input.id) : ticker,
      ticker,
      name,
      kind: FUND_KINDS.includes(input.kind) ? input.kind : 'themed',
      components: normalizeWeights(components),
      expenseRatio: round6(clamp(num(input.expenseRatio, 0.008), 0, 0.05)),
      loadBps: clamp(Math.round(num(input.loadBps, 75)), 0, 500),
      exitBps: clamp(Math.round(num(input.exitBps, 25)), 0, 500),
      minBuy: Math.max(0, Math.round(num(input.minBuy, 100))),
      initialNav: Math.max(1, round2(num(input.initialNav, 100))),
      status: FUND_STATUSES.includes(input.status) ? input.status : 'active',
      rebalance: FUND_REBALANCE.includes(input.rebalance) ? input.rebalance : 'none',
      distribution: FUND_DISTRIBUTION.includes(input.distribution) ? input.distribution : 'accumulating',
      distributionFrequency: FUND_DIST_FREQUENCIES.includes(input.distributionFrequency) ? input.distributionFrequency : 'quarterly',
      redeemDelay: clamp(Math.round(num(input.redeemDelay, 0)), 0, MAX_REDEEM_DELAY),
      managerAlpha: round6(clamp(num(input.managerAlpha, 0), -MAX_MANAGER_ALPHA, MAX_MANAGER_ALPHA)),
      ...(input.targets && typeof input.targets === 'object' ? { targets: cleanTargets(input.targets) } : {}),
      description: String(input.description ?? '').trim().slice(0, 600),
    },
  };
}

/** Value of one fund unit's worth of holdings before dividing by the divisor. */
export function fundValue(components, prices) {
  return components.reduce((sum, c) => sum + c.weight * (prices[c.companyId] ?? 0), 0);
}

/** Start a fund at its initial NAV given today's prices. */
export function makeFundState(fund, prices) {
  const value = fundValue(fund.components, prices);
  return {
    nav: fund.initialNav, prevNav: fund.initialNav, divisor: value > 0 ? value / fund.initialNav : 1, accrual: 1,
    rebalanceKey: null, distKey: null, owed: 0, lastDist: null,
  };
}

/** Recompute the NAV for current prices without moving time (after a split or a GM price change). */
export function refreshFundState(state, fund, prices) {
  const nav = Math.max(0.01, round2((fundValue(fund.components, prices) / state.divisor) * state.accrual));
  return { ...state, nav };
}

/**
 * Keep the NAV where it is while the fund's holdings change (the GM edits its components), by
 * adjusting the divisor. Without this, editing a fund would make its price jump.
 */
export function rebaseFundState(state, fund, prices) {
  const value = fundValue(fund.components, prices);
  if (!(value > 0) || !(state.nav > 0) || !(state.accrual > 0)) return state;
  return { ...state, divisor: value / (state.nav / state.accrual) };
}

/**
 * The fund's daily income from its components' dividends, as a fraction of its value.
 * @param {Object<string, object>} companiesById - company definitions
 */
export function fundDailyYield(fund, prices, companiesById) {
  const value = fundValue(fund.components, prices);
  if (!(value > 0)) return 0;
  const income = fund.components.reduce((sum, c) => {
    const price = prices[c.companyId] ?? 0;
    return sum + c.weight * price * annualYield(companiesById[c.companyId], price);
  }, 0);
  return income / value / TICKS_PER_YEAR;
}

/**
 * Advance one tick of `dt` days: dividends accrue in, the expense ratio comes out, the manager's
 * alpha (a yearly excess return, negative for a poor manager) is added, and the NAV follows prices.
 * A distributing fund does not add the dividends to its NAV: it sets them aside (`owed`, per unit)
 * to pay out. `newDay` is whether the tick starts a new game day, which is when `prevNav` moves on.
 */
export function stepFundState(state, fund, prices, companiesById = {}, { dt = 1, newDay = true } = {}) {
  const dailyYield = fundDailyYield(fund, prices, companiesById);
  const distributing = fund.distribution === 'distributing';
  const daily = ((distributing ? 0 : dailyYield) - fund.expenseRatio / TICKS_PER_YEAR + (fund.managerAlpha ?? 0) / TICKS_PER_YEAR) * dt;
  const accrual = state.accrual * (1 + daily);
  const nav = Math.max(0.01, round2((fundValue(fund.components, prices) / state.divisor) * accrual));
  const owed = distributing ? (state.owed ?? 0) + state.nav * dailyYield * dt : 0;
  return { ...state, prevNav: newDay ? state.nav : state.prevNav, nav, accrual, owed };
}

/**
 * Is a distribution due on this date? Same rule as rebalancing: the first date a fund is seen only
 * records its period.
 * @returns {{due: boolean, key?: string, mark?: string}}
 */
export function distributionDue(fund, state, date) {
  if (fund.distribution !== 'distributing') return { due: false };
  const key = periodKey(fund.distributionFrequency ?? 'quarterly', date);
  if (state.distKey === key) return { due: false };
  if (state.distKey === null || state.distKey === undefined) return { due: false, mark: key };
  return { due: true, key };
}

/**
 * Set the income owed so far aside as this period's distribution (whole cents per unit). It stays on
 * the state until the next one so that paying it can be retried safely: each portfolio is paid once.
 */
export function applyDistribution(state, key, tick = 0) {
  const perUnit = round2(state.owed ?? 0);
  return {
    ...state,
    distKey: key,
    owed: round6((state.owed ?? 0) - perUnit),
    lastDist: perUnit > 0 ? { key, perUnit, tick } : (state.lastDist ?? null),
  };
}

/**
 * Prices as a fund should see them: a bankrupt company is worth nothing; delisted and acquired
 * companies keep their last price (their holders were paid out at it).
 */
export function fundPrices(prices, companiesById) {
  const out = { ...prices };
  for (const [id, c] of Object.entries(companiesById)) {
    if (c?.status === 'bankrupt') out[id] = 0;
  }
  return out;
}

/** After an N-for-1 split the fund holds N times the shares, so its value is unchanged. */
export function splitFundComponents(fund, companyId, ratio) {
  if (!fund.components.some((c) => c.companyId === companyId)) return fund;
  return {
    ...fund,
    components: fund.components.map((c) => (c.companyId === companyId ? { ...c, weight: round6(c.weight * ratio) } : c)),
  };
}

/** Combined component list as display rows: share of current value, newest prices. */
export function fundComposition(fund, prices) {
  const total = fundValue(fund.components, prices);
  return fund.components
    .map((c) => ({ companyId: c.companyId, share: total > 0 ? (c.weight * (prices[c.companyId] ?? 0)) / total : 0 }))
    .sort((a, b) => b.share - a.share);
}

/**
 * The value mix the fund aims for, as { companyId: fraction of value }. Taken from the fund as
 * first set up (or last edited), so rebalancing returns it to that mix after prices have drifted.
 */
export function fundTargets(fund, prices) {
  const out = {};
  for (const c of fundComposition(fund, prices)) if (c.share > 0) out[c.companyId] = round6(c.share);
  return out;
}

/**
 * Is a rebalance due on this date? The first date a fund is seen only records its period, so
 * creating or importing a fund never rebalances at once.
 * @param {{year: number, month: number, day: number}} date
 * @returns {{due: boolean, key?: string, mark?: string}} `mark`: store this key without rebalancing
 */
export function rebalanceDue(fund, state, date) {
  if (!fund.rebalance || fund.rebalance === 'none') return { due: false };
  const key = periodKey(fund.rebalance, date);
  if (state.rebalanceKey === key) return { due: false };
  if (state.rebalanceKey === null || state.rebalanceKey === undefined) return { due: false, mark: key };
  return { due: true, key };
}

/**
 * Re-weight the fund's holdings back to its target value mix. A company that has gone bankrupt
 * (price 0) drops out and the rest are scaled up. Returns the fund unchanged when there is nothing to do.
 */
export function rebalanceComponents(fund, prices) {
  const targets = fund.targets ?? fundTargets(fund, prices);
  const live = fund.components.filter((c) => (prices[c.companyId] ?? 0) > 0 && targets[c.companyId] > 0);
  if (!live.length) return fund;
  const raw = live.map((c) => ({ companyId: c.companyId, weight: targets[c.companyId] / prices[c.companyId] }));
  const total = raw.reduce((s, c) => s + c.weight, 0);
  const dead = fund.components.filter((c) => !live.includes(c));
  return { ...fund, components: [...raw.map((c) => ({ ...c, weight: round6(c.weight / total) })), ...dead] };
}

/**
 * Rebalance and keep the NAV exactly where it was (the divisor is rebased).
 * @returns {{fund: object, state: object}}
 */
export function applyRebalance(fund, state, prices, key) {
  const next = rebalanceComponents(fund, prices);
  return { fund: next, state: rebaseFundState({ ...state, rebalanceKey: key }, next, prices) };
}
