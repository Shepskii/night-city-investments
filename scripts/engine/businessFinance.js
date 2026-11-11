/**
 * Player businesses: money from outside
 * @file scripts/engine/businessFinance.js
 * @description Loans and investors for B2 (DESIGN §27.0): a fixer's loan, a bank loan after a roll,
 *              repayments as each week closes, a character buying in at an agreed price, and an NPC
 *              angel won with an opposed roll. Pure; no Foundry globals. The partners' agreement
 *              comes first, through proposals (business.js); what is here is what happens after.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { dvOf } from './rolls.js';
import { createRng } from './rng.js';
import { partnerOf, unitValue, bookValue, addLedger, fail, clamp } from './businessRecord.js';

/** A digest's profit as a full week's. */
const weekly = (d) => (d.endDay - d.startDay > 0 ? (d.profit * 7) / (d.endDay - d.startDay) : d.profit);

/** Average weekly profit over the last four weeks, a bank's measure of what the business can carry. */
export function averageProfit(b) {
  const recent = b.digests.slice(-4);
  return recent.length ? recent.reduce((a, d) => a + weekly(d), 0) / recent.length : 0;
}

export const openLoans = (b) => b.loans.filter((l) => l.balance > 0);

// ── Loans ────────────────────────────────────────────────────────────────────

/** Whether a fixer will lend this much now. */
export function fixerOffer(b, amount, p = BUSINESS_DEFAULTS) {
  const f = p.loans.fixer;
  const limit = f.limits[Math.min(b.stage, f.limits.length - 1)];
  const value = Math.floor(Number(amount) || 0);
  if (openLoans(b).some((l) => l.kind === 'fixer')) return fail('loan-open');
  if (value < 100 || value > limit) return fail('bad-amount');
  return { ok: true, amount: value, limit };
}

export function makeLoan(b, { id, kind, amount, rate, weeks, day }, p) {
  const loan = { id, kind, principal: amount, balance: amount, rate, payment: Math.ceil(amount / weeks), startedDay: day, missed: 0 };
  b.loans = [...b.loans, loan];
  b.till += amount;
  addLedger(b, { day, kind: 'loan', amount, loanKind: kind }, p);
  return loan;
}

export function takeFixerLoan(b, id, amount, day, p = BUSINESS_DEFAULTS) {
  const offer = fixerOffer(b, amount, p);
  if (!offer.ok) return offer;
  const f = p.loans.fixer;
  return { ok: true, loan: makeLoan(b, { id, kind: 'fixer', amount: offer.amount, rate: f.rate, weeks: f.weeks, day }, p) };
}

/** Whether the bank-loan roll can be made now: registered, agreed by the partners, and not waiting after a refusal. */
export function bankCheck(b, actorId, day, p = BUSINESS_DEFAULTS) {
  const bank = p.loans.bank;
  const me = partnerOf(b, actorId);
  if (b.status !== 'open') return fail('not-open');
  if (me?.status !== 'active' || !me.voting) return fail('not-partner');
  if (b.stage < bank.minStage) return fail('not-registered');
  if (!b.approved?.bankLoan) return fail('not-agreed');
  if (b.retry?.bankLoan != null && day < b.retry.bankLoan) return fail('bank-delay');
  if (openLoans(b).some((l) => l.kind === 'bank')) return fail('loan-open');
  return { ok: true, dv: dvOf(bank.dv), uses: [...bank.uses] };
}

/**
 * The bank's answer to the roll. The band sets the limit (weeks of average profit) and the rate; the
 * loan is what the partners asked for, up to the limit. A refusal waits before they can ask again.
 */
export function applyBankRoll(b, { id, result, amount, day }, p = BUSINESS_DEFAULTS) {
  const bank = p.loans.bank;
  b.approved = { ...b.approved, bankLoan: false };
  if (!result.success) {
    b.retry = { ...b.retry, bankLoan: day + bank.delay };
    return { granted: 0, limit: 0 };
  }
  const limit = Math.max(0, Math.floor(averageProfit(b) * bank.limitWeeks[result.band] / 100) * 100);
  const granted = Math.min(limit, Math.max(0, Math.floor(Number(amount) || 0)));
  if (granted < 100) return { granted: 0, limit };
  makeLoan(b, { id, kind: 'bank', amount: granted, rate: bank.rate[result.band], weeks: bank.weeks, day }, p);
  return { granted, limit };
}

/** Pay off some of a loan early, from the till. */
export function repayLoan(b, loanId, amount, day, p = BUSINESS_DEFAULTS) {
  const loan = b.loans.find((l) => l.id === loanId && l.balance > 0);
  if (!loan) return fail('no-loan');
  const value = Math.min(loan.balance, Math.floor(Number(amount) || 0));
  if (value < 1) return fail('bad-amount');
  if (value > b.till) return fail('no-funds');
  b.till -= value;
  loan.balance -= value;
  addLedger(b, { day, kind: 'repay', amount: -value, loanKind: loan.kind }, p);
  return { ok: true };
}

/**
 * Each week's repayments, as the week closes: interest on the balance and a share of the principal.
 * A payment the till cannot cover is missed: the fixer adds a late fee, costs Reputation and sends
 * collectors next week; the bank adds a late fee and the business's Compliance suffers.
 * @returns {{interest: number, principal: number, missed: string[]}}
 */
export function payLoans(b, day, p = BUSINESS_DEFAULTS) {
  let interest = 0;
  let principal = 0;
  const missed = [];
  for (const loan of openLoans(b)) {
    const due = Math.round(loan.balance * loan.rate);
    const part = Math.min(loan.payment, loan.balance);
    if (b.till - interest - principal >= due + part) {
      interest += due;
      principal += part;
      loan.balance -= part;
      continue;
    }
    const terms = p.loans[loan.kind];
    loan.missed += 1;
    loan.balance += due + Math.round(part * terms.lateFee);
    missed.push(loan.kind);
    if (loan.kind === 'fixer') {
      b.state.reputation = clamp(b.state.reputation + terms.reputation, 0, 100);
      b.collectors = true;
    } else if (b.state.compliance != null) {
      b.state.compliance = clamp(b.state.compliance + terms.compliance, 0, 100);
    }
    addLedger(b, { day, kind: 'missedPayment', amount: 0, loanKind: loan.kind }, p);
  }
  return { interest, principal, missed };
}

// ── Investors ────────────────────────────────────────────────────────────────

/** Whether a character may be offered a stake: registered, not already a partner, a sensible amount and price. */
export function investorOffer(b, { actorId, amount, price }, actors = {}, p = BUSINESS_DEFAULTS) {
  if (b.stage < p.investors.minStage) return fail('not-registered');
  if (!actorId || !(actorId in actors)) return fail('bad-partner');
  const existing = [partnerOf(b, actorId), partnerOf(b, `npc:${actorId}`)].find((x) => x && ['invited', 'active', 'leaving'].includes(x.status));
  if (existing) return fail('already-partner');
  const cash = Math.floor(Number(amount) || 0);
  const perUnit = Number(price) > 0 ? Math.round(Number(price) * 100) / 100 : Math.round(unitValue(b) * 100) / 100;
  if (cash < 100) return fail('bad-amount');
  if (!(perUnit > 0)) return fail('bad-price');
  return { ok: true, actorId, amount: cash, price: perUnit };
}

/**
 * Once every partner has agreed, the character is invited to buy in on those terms. An NPC (one of `npcs`, by actor
 * id) is invited as a silent partner under an `npc:` id, as at a founding, and the GM answers for it (`answerNpcInvestor`).
 */
export function inviteInvestor(b, terms, actors, npcs = {}) {
  const npc = terms.actorId in npcs;
  const actorId = npc ? `npc:${terms.actorId}` : terms.actorId;
  const existing = partnerOf(b, actorId);
  const entry = {
    actorId, ...(npc ? { actorRef: terms.actorId, npc: true } : {}), name: actors[terms.actorId] ?? npcs[terms.actorId] ?? terms.actorId,
    status: 'invited', cash: 0, gear: [], units: 0, voting: !npc, heirId: null, leavingSince: null, offer: { amount: terms.amount, price: terms.price },
  };
  if (existing) Object.assign(existing, entry);
  else b.partners.push(entry);
}

/**
 * The GM answers for an NPC invited to invest in a running business. It buys in on the terms the partners agreed, with
 * money that comes off no sheet, and holds its units without a vote. An NPC invited before this, under its own actor
 * id and with a vote, becomes a silent partner as it joins.
 * @param {object} b - the business, changed in place
 * @param {string} partnerId - `npc:<actor id>`, or an older invitation's actor id
 */
export function answerNpcInvestor(b, partnerId, yes, day, p = BUSINESS_DEFAULTS) {
  if (b.status !== 'open') return fail('not-open');
  const x = b.partners.find((y) => y.actorId === partnerId && y.status === 'invited' && y.offer);
  if (!x) return fail('not-invited');
  if (!yes) {
    x.status = 'declined';
    delete x.offer;
    return { ok: true };
  }
  if (!x.npc) Object.assign(x, { actorRef: x.actorId, actorId: `npc:${x.actorId}`, npc: true, voting: false });
  return acceptInvestment(b, x, Infinity, day, p);
}

/** The invited character pays in and receives new units at the agreed price. The money goes into the till. */
export function acceptInvestment(b, partner, wealth, day, p = BUSINESS_DEFAULTS) {
  const { amount, price } = partner.offer;
  if (amount > wealth) return fail('insufficient-funds');
  partner.units = Math.floor(amount / price);
  partner.cash = amount;
  partner.status = 'active';
  delete partner.offer;
  b.till += amount;
  addLedger(b, { day, kind: 'investment', amount, actorId: partner.actorId }, p);
  return { ok: true, amount };
}

/** Whether the angel roll can be made now. */
export function angelCheck(b, actorId, day, p = BUSINESS_DEFAULTS) {
  const me = partnerOf(b, actorId);
  if (b.status !== 'open') return fail('not-open');
  if (me?.status !== 'active' || !me.voting) return fail('not-partner');
  if (b.stage < p.investors.minStage) return fail('not-registered');
  if (!b.approved?.angel) return fail('not-agreed');
  if (b.retry?.angel != null && day < b.retry.angel) return fail('angel-delay');
  return { ok: true, dv: b.approved.angel.total, uses: [...p.investors.angel.uses] };
}

/**
 * Find an angel once the partners agree to look for one: its skill total (the base plus a d10, drawn
 * from the seed and the proposal so it is the same on every client) is the DV the pitch is rolled
 * against, as an opposed roll. The partners know who they are pitching to.
 */
export function findAngel(b, seed, proposalId, names = [], p = BUSINESS_DEFAULTS) {
  const rng = createRng(seed, 'angel', b.id, proposalId);
  const total = p.investors.angel.base + rng.int(1, 10);
  const name = names.length ? names[rng.int(0, names.length - 1)] : 'Angel investor';
  b.approved = { ...b.approved, angel: { total, name } };
}

/**
 * The pitch to the angel. The roll's band sets how much of the book value it puts in and at what
 * premium on the unit price. The angel holds units without a vote; its share of the profit stays in
 * the business, and it is paid out like any holder if the business closes.
 */
export function applyAngelRoll(b, { id, result, day }, p = BUSINESS_DEFAULTS) {
  const angel = p.investors.angel;
  const { name } = b.approved.angel;
  const band = result.band;
  b.approved = { ...b.approved, angel: false };
  if (!result.success) {
    b.retry = { ...b.retry, angel: day + angel.delay };
    return { band, amount: 0 };
  }
  const amount = Math.round((bookValue(b) * angel.share[band]) / 100) * 100;
  const price = Math.max(0.01, Math.round(unitValue(b) * (1 + angel.premium[band]) * 100) / 100);
  if (amount < 100) return { band, amount: 0 };
  b.partners.push({ actorId: `npc:${id}`, name, status: 'active', cash: amount, gear: [], units: Math.floor(amount / price), voting: false, heirId: null, leavingSince: null, npc: true });
  b.till += amount;
  addLedger(b, { day, kind: 'angel', amount, name }, p);
  return { band, amount, price };
}
