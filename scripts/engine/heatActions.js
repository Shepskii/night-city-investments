/**
 * Cover-up actions
 * @file scripts/engine/heatActions.js
 * @description Things a character can do about their heat. Each needs a skill roll, a Cyberpunk RED
 *              check of stat + skill + 1d10 against a DV, costs eddies from the brokerage balance
 *              whether or not it works, and then cannot be repeated for a while. The player rolls the
 *              dice on their own client when they press the button; the GM side reads them back from
 *              the chat card and passes the result in as `supplied`, like the terminal check. Pure; no
 *              Foundry globals.
 *
 *   mask   Trading     wash and offset trades so the pattern is harder to see
 *   books  Accounting  make the paperwork say something else
 *   front  Business    route the trades through a front company: a little off now, and a cover
 *                      that cuts the heat from audits for a week
 *   bribe  Bribery     pay the right person to look the other way: the most, but it can backfire
 */

import { evaluateCheck } from './checks.js';
import { normalizeHeat, decayHeat, currentHeat, HEAT_TUNING } from './heat.js';
import { isFrozen } from './heatPenalty.js';

export const HEAT_ACTION_IDS = ['mask', 'books', 'front', 'bribe'];

export const HEAT_ACTIONS = Object.freeze({
  mask: { skill: 'Trading', stat: 'int', dv: 13, cost: 150, cooldown: 1, reduce: 8, cover: null, fail: 0, fumble: 4 },
  books: { skill: 'Accounting', stat: 'int', dv: 15, cost: 500, cooldown: 3, reduce: 15, cover: null, fail: 0, fumble: 6 },
  front: { skill: 'Business', stat: 'int', dv: 15, cost: 1500, cooldown: 7, reduce: 5, cover: { ticks: 7, factor: 0.5 }, fail: 0, fumble: 8 },
  bribe: { skill: 'Bribery', stat: 'cool', dv: 17, cost: 3000, cooldown: 7, reduce: 30, cover: null, fail: 8, fumble: 20 },
});

/** A critical success (a natural 10) does half as much again. */
export const CRIT_BONUS = 1.5;
export const APPLIED_CAP = 20;

const round1 = (n) => Math.round(n * 10) / 10;

/** Cooldown, in ticks left, for one action. */
export const cooldownLeft = (portfolio, actionId, tick) => Math.max(0, (portfolio?.heatCooldowns?.[actionId] ?? 0) - tick);

/**
 * Can the character try this action now? (Not whether it will work.)
 * @returns {{ok: true} | {ok: false, reason: 'heat-off'|'unknown-action'|'account-frozen'|'on-cooldown'|'insufficient-funds'}}
 */
export function canAttempt({ portfolio, actionId, tick, enabled = true }) {
  const def = HEAT_ACTIONS[actionId];
  if (!enabled) return { ok: false, reason: 'heat-off' };
  if (!def) return { ok: false, reason: 'unknown-action' };
  if (isFrozen(portfolio, tick)) return { ok: false, reason: 'account-frozen' };
  if (cooldownLeft(portfolio, actionId, tick) > 0) return { ok: false, reason: 'on-cooldown' };
  if (portfolio.cash < def.cost) return { ok: false, reason: 'insufficient-funds' };
  return { ok: true };
}

/**
 * What a check does. A pass takes heat off; a miss does nothing, or backfires (a bribe that is
 * refused, or any fumble).
 * @returns {{outcome: 'critical'|'success'|'failure'|'fumble', passed: boolean, reduce: number, add: number, coverTicks: number, coverFactor: number|null}}
 */
export function actionOutcome(actionId, check) {
  const def = HEAT_ACTIONS[actionId];
  const none = { reduce: 0, add: 0, coverTicks: 0, coverFactor: null };
  if (check.success) {
    const critical = check.crit === 'success';
    const k = critical ? CRIT_BONUS : 1;
    return {
      outcome: critical ? 'critical' : 'success',
      passed: true,
      reduce: round1(def.reduce * k),
      add: 0,
      coverTicks: def.cover ? Math.round(def.cover.ticks * k) : 0,
      coverFactor: def.cover?.factor ?? null,
    };
  }
  if (check.crit === 'fumble') return { ...none, outcome: 'fumble', passed: false, add: def.fumble };
  return { ...none, outcome: 'failure', passed: false, add: def.fail };
}

/**
 * The executor's step for one 'heatAction' request: take the cost, start the cooldown, and report
 * the outcome. The heat itself is changed afterwards by the GM service, from this result.
 * @param {object} o
 * @param {object} o.portfolio
 * @param {{key: string, action: string}} o.request
 * @param {number} o.tick
 * @param {boolean} o.enabled
 * @param {{stat: number, level: number, dv: number, roll: {total: number, rolls?: number[], crit?: string|null}}|undefined} o.supplied - the rolled check
 * @returns {{portfolio: object, result: object}}
 */
export function runHeatAction({ portfolio, request, tick, enabled, supplied }) {
  const actionId = request.action;
  const can = canAttempt({ portfolio, actionId, tick, enabled });
  if (!can.ok) return { portfolio, result: { ok: false, reason: can.reason } };
  if (!supplied || supplied.failed) return { portfolio, result: { ok: false, reason: supplied?.failed ?? 'no-check' } };

  const def = HEAT_ACTIONS[actionId];
  const check = evaluateCheck({ stat: supplied.stat, level: supplied.level, roll: supplied.roll, dv: supplied.dv ?? def.dv });
  const outcome = actionOutcome(actionId, check);
  const next = {
    ...portfolio,
    cash: portfolio.cash - def.cost,
    ledger: [...portfolio.ledger, { ts: tick, kind: 'cover', assetId: null, qty: 0, amount: -def.cost, ref: request.key }],
    heatCooldowns: { ...(portfolio.heatCooldowns ?? {}), [actionId]: tick + def.cooldown },
  };
  return {
    portfolio: next,
    result: {
      ok: true, action: actionId, cost: def.cost, total: check.total, dv: check.dv, rolls: supplied.roll.rolls ?? [supplied.roll.total], crit: check.crit, ...outcome,
    },
  };
}

// ── Effect on the heat record ────────────────────────────────────────────────

/**
 * Apply a successful or backfired action to a character's heat. Idempotent: a request key already
 * applied does nothing, so the same result can be reconciled again after a crash.
 * @param {object} heat
 * @param {{actorId: string, name?: string, key: string, action: string, tick: number, date?: string}} who
 * @param {{reduce: number, add: number, coverTicks?: number, coverFactor?: number|null}} effect
 * @returns {{heat: object, applied: boolean}}
 */
export function applyHeatEffect(heat, { actorId, name = '', key, action, tick, date = '' }, effect, tuning = HEAT_TUNING) {
  const current = normalizeHeat(heat);
  const before = current.characters[actorId];
  if (before?.applied?.includes(key)) return { heat: current, applied: false };

  const faded = before ? decayHeat(before.heat, before.tick, tick, tuning.halfLifeTicks) : 0;
  const value = round1(Math.max(0, Math.min(tuning.maxHeat, faded - (effect.reduce ?? 0) + (effect.add ?? 0))));
  const cover = effect.coverTicks > 0 && effect.coverFactor
    ? { until: tick + effect.coverTicks, factor: effect.coverFactor }
    : before?.cover;
  const change = round1((effect.add ?? 0) - (effect.reduce ?? 0));

  return {
    applied: true,
    heat: {
      ...current,
      characters: {
        ...current.characters,
        [actorId]: {
          ...before,
          heat: value,
          tick,
          name: name || before?.name || actorId,
          ...(cover ? { cover } : {}),
          applied: [...(before?.applied ?? []), key].slice(-APPLIED_CAP),
          log: [...(before?.log ?? []), { tick, date, gain: change, action, companyId: null, sourceKey: key, trades: 0 }].slice(-tuning.logCap),
        },
      },
    },
  };
}

/** GM: set a character's heat outright (0 clears it). */
export function setCharacterHeat(heat, { actorId, name = '', value, tick, date = '' }, tuning = HEAT_TUNING) {
  const current = normalizeHeat(heat);
  const before = current.characters[actorId];
  const v = round1(Math.max(0, Math.min(tuning.maxHeat, Number(value) || 0)));
  const was = before ? currentHeat(before, tick) : 0;
  return {
    ...current,
    characters: {
      ...current.characters,
      [actorId]: {
        ...before,
        heat: v,
        tick,
        name: name || before?.name || actorId,
        log: [...(before?.log ?? []), { tick, date, gain: round1(v - was), action: 'gm', companyId: null, sourceKey: `gm:${tick}`, trades: 0 }].slice(-tuning.logCap),
      },
    },
  };
}

/** Remember the highest tier a character has been warned about (so a warning is not sent twice). */
export function setWarned(heat, actorId, rank) {
  const before = heat?.characters?.[actorId];
  if (!before || before.warned === rank) return heat;
  const current = normalizeHeat(heat);
  return { ...current, characters: { ...current.characters, [actorId]: { ...before, warned: rank } } };
}

/** Add a penalty to the record, or replace one with the same id. */
export function upsertPenalty(heat, penalty, tuning = HEAT_TUNING) {
  const current = normalizeHeat(heat);
  const exists = current.penalties.some((p) => p.id === penalty.id);
  const penalties = exists ? current.penalties.map((p) => (p.id === penalty.id ? penalty : p)) : [...current.penalties, penalty];
  return { ...current, penalties: penalties.slice(-tuning.penaltyCap) };
}
