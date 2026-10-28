/**
 * Insider-trading consequences
 * @file scripts/engine/heatPenalty.js
 * @description What heat does to a character: a warning at "noticed", an enquiry and a slower, dearer
 *              broker at "flagged", and a penalty (a fine, a frozen account, or a broker who walks
 *              away) when "investigated". Pure; no Foundry globals. The service decides who is told
 *              and when the GM has to approve; this file only plans and applies.
 */

import { hashSeed, mulberry32 } from './rng.js';
import { HEAT_TIERS, HEAT_TUNING, heatTier } from './heat.js';
import { OPEN } from './portfolioModel.js';

export const PENALTY_KINDS = ['fine', 'freeze', 'dropBroker'];
export const PENALTY_STATUSES = ['pending', 'applied', 'dismissed'];

/** How many wordings each part of the heat mail has in lang/en.json under NCI.Mail.Heat. */
export const HEAT_MAIL_VARIANTS = Object.freeze({ WarningSubject: 4, WarningLine: 4, WarningAdvice: 3, EnquirySubject: 2, EnquiryLine: 3, EnquiryAdvice: 2 });

export const PENALTY_TUNING = Object.freeze({
  /** Chance of each penalty. A broker can only drop a character who has one, so that share goes to the others. */
  weights: { fine: 0.5, freeze: 0.3, dropBroker: 0.2 },
  /** A fine is this share of what the suspicious trades moved, rising with heat from the first to the second. */
  finePct: { min: 0.1, max: 0.25 },
  minFine: 100,
  freezeDays: { min: 2, max: 5 },
  banDays: 14,
  /** Heat left once an investigation has run its course. */
  heatAfter: 0.5,
  /** Flagged or worse: new broker orders are slower and dearer. */
  scrutiny: { latencyAdd: 1, feeMult: 1.5 },
});

export const tierRank = (tier) => Math.max(0, HEAT_TIERS.indexOf(tier));

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/** What being watched does to new broker orders. Nothing below "flagged". */
export function scrutinyFor(tier, tuning = PENALTY_TUNING) {
  return tierRank(tier) >= tierRank('flagged') ? { ...tuning.scrutiny } : { latencyAdd: 0, feeMult: 1 };
}

/** Is the account frozen at this tick? */
export const isFrozen = (portfolio, tick) => (portfolio?.frozenUntilTick ?? 0) > tick;

/** Has this broker refused the character, and until when? */
export const brokerBanned = (portfolio, brokerId, tick) => !!brokerId && (portfolio?.brokerBans?.[brokerId] ?? 0) > tick;

// ── Warnings ─────────────────────────────────────────────────────────────────

/**
 * Which warnings should go out now that a character's heat is `heat`, given the highest tier they
 * have already been warned about (`warnedRank`, 0 for none).
 * Warnings go out once for each tier crossed upward. Falling back below a tier re-arms it.
 * @returns {{send: ('noticed'|'flagged')[], warnedRank: number, tier: string}}
 */
export function warningsFor({ heat, warnedRank = 0 }, tiers = HEAT_TUNING.tiers) {
  const tier = heatTier(heat, tiers);
  const rank = tierRank(tier);
  const send = [];
  for (let r = warnedRank + 1; r <= Math.min(rank, tierRank('flagged')); r++) send.push(HEAT_TIERS[r]);
  return { send, warnedRank: rank, tier };
}

// ── Penalties ────────────────────────────────────────────────────────────────

/** Weighted pick from `weights`, from a stream seeded by the parts. */
function weighted(weights, ...seedParts) {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let roll = mulberry32(hashSeed('heat-penalty', ...seedParts))() * total;
  for (const [key, w] of entries) {
    roll -= w;
    if (roll < 0) return key;
  }
  return entries.at(-1)[0];
}

/**
 * Choose what an investigation finds. The same audit always gives the same answer.
 * @param {object} o
 * @param {string} o.actorId
 * @param {string} o.sourceKey - the audit's gig key
 * @param {number} o.heat - the character's heat after the audit (75 or more)
 * @param {{gross: number}[]} o.trades - the suspicious trades in this audit
 * @param {string|null} o.brokerId - the character's broker, if any
 * @returns {{kind: 'fine'|'freeze'|'dropBroker', amount?: number, days?: number, brokerId?: string, banDays?: number}}
 */
export function planInvestigation({ actorId, sourceKey, heat, trades, brokerId = null }, tuning = PENALTY_TUNING) {
  const weights = { ...tuning.weights };
  if (!brokerId) delete weights.dropBroker;
  const kind = weighted(weights, actorId, sourceKey);
  const severity = clamp((heat - HEAT_TUNING.tiers.investigated) / (HEAT_TUNING.maxHeat - HEAT_TUNING.tiers.investigated), 0, 1);

  if (kind === 'fine') {
    const moved = trades.reduce((s, t) => s + (t.gross ?? 0), 0);
    const pct = tuning.finePct.min + (tuning.finePct.max - tuning.finePct.min) * severity;
    return { kind, amount: Math.max(tuning.minFine, Math.round((moved * pct) / 10) * 10) };
  }
  if (kind === 'freeze') {
    return { kind, days: tuning.freezeDays.min + Math.round((tuning.freezeDays.max - tuning.freezeDays.min) * severity) };
  }
  return { kind, brokerId, banDays: tuning.banDays };
}

/** A pending or settled penalty, as kept on the heat record. */
export function makePenalty({ id, actorId, name, plan, tick, date = '', sourceKey, heat, status = 'pending' }) {
  const { kind, ...params } = plan;
  return { id, actorId, name, kind, params, status, tick, date, sourceKey, heat };
}

/** Clamp a GM's edits to a penalty's size and length. */
export function sanitizePenaltyEdits(kind, { amount, days } = {}, tuning = PENALTY_TUNING) {
  if (kind === 'fine') {
    const n = Math.round(Number(amount));
    return Number.isFinite(n) ? { amount: Math.max(0, Math.min(1_000_000, n)) } : null;
  }
  if (kind === 'freeze') {
    const n = Math.floor(Number(days));
    return Number.isFinite(n) ? { days: Math.max(1, Math.min(30, n)) } : null;
  }
  return kind === 'dropBroker' ? { banDays: Math.max(0, Math.min(60, Math.floor(Number(days)) || tuning.banDays)) } : null;
}

// ── Applying a penalty to a portfolio ────────────────────────────────────────

const cancelOrders = (p, tick, reason, keep) => ({
  ...p,
  orders: p.orders.map((o) => (o.status === OPEN && !keep(o) ? { ...o, status: 'cancelled', reason, closedTick: tick } : o)),
});

/**
 * Take a fine from the brokerage cash. Takes what there is if the cash falls short.
 * @returns {{portfolio: object, paid: number, shortfall: number}}
 */
export function applyFine(portfolio, { amount, tick, ref = 'heat' }) {
  const owed = Math.max(0, Math.round(amount));
  const paid = Math.min(owed, Math.max(0, Math.floor(portfolio.cash)));
  if (!paid) return { portfolio, paid: 0, shortfall: owed };
  return {
    portfolio: { ...portfolio, cash: portfolio.cash - paid, ledger: [...portfolio.ledger, { ts: tick, kind: 'fine', assetId: null, qty: 0, amount: -paid, ref }] },
    paid,
    shortfall: owed - paid,
  };
}

/** Freeze the account for `days` ticks. Open trading orders are voided; IPO subscriptions are left alone. */
export function applyFreeze(portfolio, { days, tick }) {
  const until = tick + Math.max(1, Math.floor(days));
  const frozen = { ...portfolio, frozenUntilTick: Math.max(portfolio.frozenUntilTick ?? 0, until) };
  return { portfolio: cancelOrders(frozen, tick, 'frozen', (o) => o.type === 'ipo'), untilTick: frozen.frozenUntilTick };
}

/** The broker walks away: unassigned, refuses to take the character back for a while, orders through them cancelled. */
export function applyBrokerDrop(portfolio, { brokerId, banDays, tick }) {
  const id = brokerId ?? portfolio.brokerContactId;
  if (!id) return { portfolio, dropped: false };
  const dropped = {
    ...portfolio,
    brokerContactId: portfolio.brokerContactId === id ? null : portfolio.brokerContactId,
    brokerBans: { ...(portfolio.brokerBans ?? {}), [id]: tick + Math.max(0, Math.floor(banDays ?? PENALTY_TUNING.banDays)) },
  };
  return { portfolio: cancelOrders(dropped, tick, 'broker-dropped', (o) => o.route !== 'broker' || o.brokerId !== id), dropped: true, brokerId: id };
}
