/**
 * Broker-handled withdrawals
 * @file scripts/engine/withdrawals.js
 * @description A withdrawal through a broker takes the money out of the brokerage balance at once
 *              (so it cannot be spent twice), then the broker pays it out later as claimable eddies
 *              in a Night City Messenger mail. NCM's claim flow credits the character's wealth, so
 *              nothing here touches wealth. Pure; no Foundry globals.
 *
 *   status: 'pending' -> 'paid' | 'cancelled' | 'failed'
 */

import { normalizePortfolio } from './portfolioModel.js';
import { planWithdrawalHold, releaseHold } from './cash.js';
import { TIME_EPS } from './clock.js';

export const withdrawalId = (key) => `w_${key}`;

/**
 * Place a hold and record the pending withdrawal.
 * @returns {{ok: true, portfolio: object, withdrawal: object} | {ok: false, reason: string}}
 */
export function holdWithdrawal({ portfolio, key, amount, fee = 0, brokerId, tick, latency, minWithdrawal = 0 }) {
  const p = normalizePortfolio(portfolio);
  const plan = planWithdrawalHold({ cash: p.cash, amount, fee, minWithdrawal });
  if (!plan.ok) return plan;

  const id = withdrawalId(key);
  const withdrawal = { id, amount, fee, brokerId, submittedTick: tick, releaseTick: tick + latency, status: 'pending' };
  const ledger = [...p.ledger, { ts: tick, kind: 'withdraw', assetId: null, qty: 0, amount: -amount, ref: id }];
  if (fee) ledger.push({ ts: tick, kind: 'fee', assetId: null, qty: 0, amount: -fee, ref: id });
  return { ok: true, portfolio: { ...p, cash: plan.cash, ledger, withdrawals: [...p.withdrawals, withdrawal] }, withdrawal };
}

/** Withdrawals whose payout time has arrived. */
export function dueWithdrawals(portfolio, tick) {
  return normalizePortfolio(portfolio).withdrawals.filter((w) => w.status === 'pending' && tick >= w.releaseTick - TIME_EPS);
}

/** The broker has paid: the money is on its way to the character as claimable eddies. */
export function markWithdrawalPaid(portfolio, id, tick) {
  const p = normalizePortfolio(portfolio);
  if (!p.withdrawals.some((w) => w.id === id && w.status === 'pending')) return { portfolio: p, changed: false };
  return {
    portfolio: { ...p, withdrawals: p.withdrawals.map((w) => (w.id === id ? { ...w, status: 'paid', paidTick: tick } : w)) },
    changed: true,
  };
}

/** Give a pending withdrawal back to the balance (cancelled by the player, or the mail could not be sent). */
export function refundWithdrawal(portfolio, id, tick, status = 'cancelled') {
  const p = normalizePortfolio(portfolio);
  const w = p.withdrawals.find((x) => x.id === id && x.status === 'pending');
  if (!w) return { ok: false, reason: 'not-found', portfolio: p };
  return refundOf(p, w, id, tick, status);
}

/**
 * A payout was marked paid just before its mail was sent, and the mail failed: undo it and give the
 * money back. (Marking paid first means a crash can never pay twice.)
 */
export function failPaidWithdrawal(portfolio, id, tick) {
  const p = normalizePortfolio(portfolio);
  const w = p.withdrawals.find((x) => x.id === id && x.status === 'paid');
  if (!w) return { ok: false, reason: 'not-found', portfolio: p };
  return refundOf(p, w, id, tick, 'failed');
}

function refundOf(p, w, id, tick, status) {
  const { cash } = releaseHold({ cash: p.cash, hold: w });
  return {
    ok: true,
    portfolio: {
      ...p,
      cash,
      ledger: [...p.ledger, { ts: tick, kind: 'withdraw-refund', assetId: null, qty: 0, amount: w.amount + w.fee, ref: id }],
      withdrawals: p.withdrawals.map((x) => (x.id === id ? { ...x, status, closedTick: tick } : x)),
    },
    withdrawal: w,
  };
}
