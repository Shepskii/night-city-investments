/**
 * Brokerage balance, deposits, and withdrawals
 * @file scripts/engine/cash.js
 * @description Pure planning functions for moving eb between CPR wealth and the brokerage
 *              balance. Each returns the new balances; the caller applies them. No Foundry globals.
 */

const isWhole = (n) => Number.isInteger(n) && n > 0;

/** Move eb from CPR wealth into the brokerage balance. `fee` is taken from the deposited amount. */
export function planDeposit({ wealth, cash, amount, fee = 0 }) {
  if (!isWhole(amount)) return { ok: false, reason: 'invalid-amount' };
  if (wealth < amount) return { ok: false, reason: 'insufficient-wealth' };
  if (amount <= fee) return { ok: false, reason: 'below-fee' };
  return { ok: true, wealth: wealth - amount, cash: cash + amount - fee, fee };
}

/**
 * Place a hold for a broker-processed withdrawal. The amount plus the fee leaves the balance
 * immediately so it cannot be traded or withdrawn twice; the broker pays it out later by mail.
 */
export function planWithdrawalHold({ cash, amount, fee = 0, minWithdrawal = 0 }) {
  if (!isWhole(amount)) return { ok: false, reason: 'invalid-amount' };
  if (amount < minWithdrawal) return { ok: false, reason: 'below-minimum' };
  if (cash < amount + fee) return { ok: false, reason: 'insufficient-balance' };
  return { ok: true, cash: cash - amount - fee, hold: { amount, fee } };
}

/** Give a held withdrawal back to the balance (cancelled, or the mail failed to send). */
export function releaseHold({ cash, hold }) {
  return { cash: cash + hold.amount + hold.fee };
}

/** Immediate withdrawal straight into CPR wealth, used when no broker is assigned. */
export function planDirectWithdrawal({ wealth, cash, amount }) {
  if (!isWhole(amount)) return { ok: false, reason: 'invalid-amount' };
  if (cash < amount) return { ok: false, reason: 'insufficient-balance' };
  return { ok: true, cash: cash - amount, wealth: wealth + amount };
}
