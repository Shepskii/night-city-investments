/**
 * Insolvency (B6c)
 * @file scripts/engine/businessInsolvency.js
 * @description A chartered or listed company whose net assets (cash and assets, less its loans, the
 *              wages it owes and any overdraft) are below zero at `insolvency.periods` weekly closes in a
 *              row goes into administration. Its weeks still close, but its owners cannot act, draw,
 *              vote or move capital; cash put in can bring it back above zero, and a close above zero
 *              ends administration by itself. Otherwise the GM decides: restructure it (the debts become
 *              shares for its creditors, the old holders diluted) or wind it up (assets sold cheaply;
 *              owed wages first, then the loans, then the holders by shares). Side and registered
 *              businesses keep B1's failure rule. Pure.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail, totalUnits, unitValue, close, holders, clamp } from './businessRecord.js';
import { isListed } from './businessListing.js';

const cents = (v) => Math.round(v * 100) / 100;

/** Requests refused while a company is in administration: acting, drawing, deciding and capital. */
export const ADMINISTRATION_REFUSES = Object.freeze([
  'action', 'assist', 'respond', 'addDays', 'draw', 'propose', 'stepUpRoll', 'loanRoll', 'angelRoll', 'prospectusRoll',
  'recruitRoll', 'vetRoll', 'bonus', 'train', 'askStaff', 'addTeam', 'rightsTake', 'sellBack', 'issueRoll', 'buybackRoll',
  'bid', 'tender', 'defenceRoll',
]);

/** What the company owes: its loans, the wages it has not paid, and any overdraft. */
export function debtsOf(b) {
  const loans = (b.loans ?? []).filter((l) => l.balance > 0).reduce((a, l) => a + l.balance, 0);
  const wages = (b.staff ?? []).filter((s) => s.status === 'active').reduce((a, s) => a + (s.owed ?? 0), 0);
  const overdraft = Math.max(0, -(b.till ?? 0));
  return { loans: Math.round(loans), wages: Math.round(wages), overdraft: Math.round(overdraft), total: Math.round(loans + wages + overdraft) };
}

/** Net assets for insolvency: cash and assets less every debt (not held at zero, unlike the charter's). */
export function solvency(b) {
  return Math.round(Math.max(0, b.till ?? 0) + (b.assets ?? 0) - debtsOf(b).total);
}

/**
 * At a company's weekly close: count the closes in a row below zero; at `periods` it goes into
 * administration, and one at or above zero brings it out.
 * @returns {{entered: boolean, ended: boolean}}
 */
export function checkSolvency(b, day, p = BUSINESS_DEFAULTS) {
  if (b.stage < 2) return { entered: false, ended: false };
  const net = solvency(b);
  b.insolventPeriods = net < 0 ? (b.insolventPeriods ?? 0) + 1 : 0;
  if (b.administration && net >= 0) {
    b.administration = null;
    addLedger(b, { day, kind: 'administrationEnded', amount: 0 }, p);
    return { entered: false, ended: true };
  }
  if (!b.administration && b.insolventPeriods >= p.insolvency.periods) {
    b.administration = { since: day, net };
    b.proposals = [];
    // A rights issue, a tender or a roll not yet made stops; a listed offering already on the market settles.
    const c = b.capital ?? {};
    if (c.issue && !(c.issue.kind === 'offering' && c.issue.status === 'open')) c.issue = null;
    if (c.buyback) c.buyback = null;
    b.capital = { issue: c.issue ?? null, buyback: null };
    addLedger(b, { day, kind: 'administration', amount: 0 }, p);
    return { entered: true, ended: false };
  }
  if (b.administration) b.administration.net = net;
  return { entered: false, ended: false };
}

/** A week's upkeep, from the last few weekly digests. */
function weeklyUpkeep(b) {
  const recent = (b.digests ?? []).slice(-4);
  return recent.length ? recent.reduce((a, d) => a + (d.upkeep ?? 0), 0) / recent.length : 0;
}

/**
 * The GM restructures a company in administration. First its cash pays what it can of its debts (the
 * wages owed, then the loans), keeping `reserveWeeks` of upkeep as working cash; what is still owed (and
 * any overdraft) is written off for new shares at half its book value per share after those payments,
 * held by its creditors as one NPC holder without a vote. The old holders are diluted only by what the
 * cash could not cover; its standing suffers, and it leaves administration with a clean sheet. A player
 * character's owed wage is paid into `out.wealth`.
 * @returns {{ok: true, paid: number, shares: number, price: number, debts: number} | {ok: false, reason: string}}
 */
export function restructure(b, day, p = BUSINESS_DEFAULTS, out = null) {
  if (!b.administration) return fail('not-administration');
  const r = p.insolvency.restructure;
  const debts = debtsOf(b);
  let spare = Math.max(0, b.till - Math.round(weeklyUpkeep(b) * r.reserveWeeks));
  let paid = 0;
  const pay = (amount) => {
    const n = Math.min(spare, Math.round(amount));
    spare -= n;
    paid += n;
    b.till -= n;
    return n;
  };
  for (const s of (b.staff ?? []).filter((x) => x.status === 'active' && x.owed > 0)) {
    const n = pay(s.owed);
    s.owed -= n;
    if (n > 0 && s.source === 'pc' && s.actorId && out) out.wealth[s.actorId] = (out.wealth[s.actorId] ?? 0) + n;
  }
  for (const l of (b.loans ?? []).filter((x) => x.balance > 0)) l.balance -= pay(l.balance);
  const rest = debtsOf(b).total;
  const price = Math.max(r.minPrice, cents(unitValue({ ...b, till: Math.max(0, b.till) }) * r.priceShare));
  const shares = rest > 0 ? Math.max(1, Math.round(rest / price)) : 0;
  b.loans = (b.loans ?? []).map((l) => (l.balance > 0 ? { ...l, balance: 0, writtenOff: day } : l));
  for (const s of b.staff ?? []) if (s.owed) s.owed = 0;
  b.till = Math.max(0, b.till);
  if (paid > 0) addLedger(b, { day, kind: 'debtsPaid', amount: -paid }, p);
  const creditors = b.partners.find((x) => x.actorId === 'npc:creditors');
  if (shares > 0 && creditors) Object.assign(creditors, { status: 'active', units: creditors.units + shares });
  else if (shares > 0) b.partners.push({ actorId: 'npc:creditors', name: '', status: 'active', cash: 0, gear: [], units: shares, voting: false, heirId: null, leavingSince: null, npc: true, creditors: true });
  if (isListed(b)) b.listing.shares = (b.listing.shares ?? 0) + shares;
  b.state.reputation = clamp(b.state.reputation + r.reputation, 0, 100);
  if (b.state.compliance != null) b.state.compliance = clamp(b.state.compliance + r.compliance, 0, 100);
  b.administration = null;
  b.insolventPeriods = 0;
  b.losingPeriods = 0;
  addLedger(b, { day, kind: 'restructured', amount: 0, price: shares }, p);
  return { ok: true, paid, shares, price, debts: debts.total };
}

/**
 * The GM winds a company in administration up. Its assets sell at `salvage` of their book value; with
 * the cash, that pays the wages owed first (a player character's to their eddies), then the loans,
 * then what is left goes to the holders by shares. A private company's player holders are paid in
 * eddies here; a listed company's per-share amount is paid by the service into brokerage balances.
 * The business closes.
 * @returns {{ok: true, pot: number, wages: number, loans: number, left: number, perShare: number}}
 */
export function windUp(b, day, out, p = BUSINESS_DEFAULTS) {
  if (!b.administration) return fail('not-administration');
  const listed = isListed(b);
  const salvage = Math.round((b.assets ?? 0) * p.insolvency.salvage);
  const total = Math.max(0, b.till) + salvage;
  let pot = total;
  let wages = 0;
  for (const s of (b.staff ?? []).filter((x) => x.status === 'active' && x.owed > 0)) {
    const paid = Math.min(pot, s.owed);
    pot -= paid;
    wages += paid;
    if (paid > 0 && s.source === 'pc' && s.actorId) out.wealth[s.actorId] = (out.wealth[s.actorId] ?? 0) + paid;
  }
  const owed = debtsOf(b).loans;
  const loans = Math.min(pot, owed);
  pot -= loans;
  const left = pot;
  const shares = listed ? (b.listing.shares ?? totalUnits(b)) : totalUnits(b);
  const perShare = shares > 0 ? Math.floor((left / shares) * 100) / 100 : 0;
  if (!listed) {
    for (const x of holders(b).filter((y) => !y.npc)) {
      const share = Math.floor(x.units * perShare);
      if (share > 0) out.wealth[x.actorId] = (out.wealth[x.actorId] ?? 0) + share;
    }
  }
  addLedger(b, { day, kind: 'woundUp', amount: -(wages + loans + Math.round(left)), salvage }, p);
  b.loans = (b.loans ?? []).map((l) => (l.balance > 0 ? { ...l, balance: 0, writtenOff: day } : l));
  b.till = 0;
  b.assets = 0;
  b.administration = null;
  if (listed) Object.assign(b.listing, { status: 'delisted', delistedDay: day, woundUp: true });
  close(b, day, 'woundUp');
  out.events.push({ type: 'closed', reason: 'woundUp', paid: Math.round(left) });
  return { ok: true, pot: Math.round(total), wages, loans, left, perShare };
}
