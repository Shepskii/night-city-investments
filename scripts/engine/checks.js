/**
 * Skill checks and terminal sessions
 * @file scripts/engine/checks.js
 * @description The Cyberpunk RED d10 roll, evaluating a skill check against a DV, and what a pass
 *              or fail means for a terminal session. Pure; no Foundry globals. The dice themselves
 *              are supplied by the caller (Foundry's Roll in the game, a stub in tests).
 */

import { TIME_EPS } from './clock.js';

/** Meeting the DV exactly counts as a success. */
export const TIE_SUCCEEDS = true;

/**
 * One CPR d10: a 10 adds another d10, a 1 subtracts another d10.
 * @param {() => number} nextD10 - returns an integer 1..10 each call
 * @returns {{total: number, rolls: number[], crit: 'success'|'fumble'|null}}
 */
export function cprD10(nextD10) {
  const first = nextD10();
  if (first === 10) {
    const extra = nextD10();
    return { total: 10 + extra, rolls: [first, extra], crit: 'success' };
  }
  if (first === 1) {
    const extra = nextD10();
    return { total: 1 - extra, rolls: [first, extra], crit: 'fumble' };
  }
  return { total: first, rolls: [first], crit: null };
}

/**
 * Evaluate stat + skill + roll against a DV.
 * @param {{stat: number, level: number, roll: {total: number, crit?: string|null}, dv: number}} o
 */
export function evaluateCheck({ stat, level, roll, dv }) {
  const base = (Number(stat) || 0) + (Number(level) || 0);
  const total = base + roll.total;
  const success = TIE_SUCCEEDS ? total >= dv : total > dv;
  return { base, roll: roll.total, total, dv, success, margin: total - dv, crit: roll.crit ?? null };
}

/**
 * What a check result does to a character's terminal access.
 * Pass: a session through the end of the tick window. Fail: a lockout, doubled after a fumble.
 * @returns {{passed: boolean, session?: object, lockoutUntilTick?: number}}
 */
export function planSession({ check, tick, sessionTicks, lockoutTicks, dt = 1, source = 'network', terminalId = null }) {
  if (check.success) {
    return {
      passed: true,
      session: {
        source,
        terminalId,
        grantedTick: tick,
        // The session setting counts game days: one day covers the connection's own tick, and with
        // finer ticks it runs until a day has passed.
        validThroughTick: tick + Math.max(1, sessionTicks) - dt,
        total: check.total,
        dv: check.dv,
      },
    };
  }
  const lock = Math.max(1, lockoutTicks) * (check.crit === 'fumble' ? 2 : 1);
  return { passed: false, lockoutUntilTick: tick + lock };
}

/** Does the portfolio have a live terminal session at this tick? */
export function sessionActive(portfolio, tick) {
  const s = portfolio?.session;
  return !!s && tick >= s.grantedTick - TIME_EPS && tick <= s.validThroughTick + TIME_EPS;
}

/** Is the character locked out of the terminal at this tick? */
export function lockedOut(portfolio, tick) {
  return (portfolio?.lockoutUntilTick ?? 0) > tick;
}
