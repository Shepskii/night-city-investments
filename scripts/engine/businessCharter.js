/**
 * Chartering a business
 * @file scripts/engine/businessCharter.js
 * @description Registered business to chartered company (DESIGN §32, B4a): the milestones, the three
 *              charter rolls, the capital quote with the business's net assets credited, the GM's
 *              approval, the funding window, and forming the company (stage 2). Pure; no Foundry
 *              globals. The record's `charter` is null until the partners agree to charter, then:
 *              `{ status, ticker, agreedDay, rolls, quote, netAssets, shortfall, escrow, fundingEnds, retryDay, kept }`
 *              with status 'rolling' → 'awaiting' (the GM) → 'funding' → 'formed', or 'failed'.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, clamp, fail, holders, int, partnerOf, unitValue, totalUnits } from './businessRecord.js';
import { dvOf } from './rolls.js';

export const CHARTER_PARTS = Object.freeze(['plan', 'registration', 'capital']);

/** The market sector a business charters into, from its type. */
export const charterSector = (b, p = BUSINESS_DEFAULTS) => p.charter.sectors[b.archetype] ?? 'other';

/** The capital quote's range for this business: the Startup tier times its sector's factor. */
export function quoteRange(b, p = BUSINESS_DEFAULTS) {
  const f = p.charter.sectorFactor[charterSector(b, p)] ?? 1;
  return { kmin: Math.round(p.charter.kmin * f), kmax: Math.round(p.charter.kmax * f) };
}

/** The quote from the capital structure roll's margin (a critical adds 4), rounded to 100 eb (§26.2a). */
export function capitalQuote(b, { margin, crit = false }, p = BUSINESS_DEFAULTS) {
  const { kmin, kmax } = quoteRange(b, p);
  const m = margin + (crit ? 4 : 0);
  return Math.round((kmax - (kmax - kmin) * clamp(m / 8, 0, 1)) / 100) * 100;
}

/** What the business is worth toward the quote: its cash and fit-out, less what it owes on loans. */
export function netAssets(b) {
  const owed = (b.loans ?? []).filter((l) => l.balance > 0).reduce((a, l) => a + l.balance, 0);
  return Math.max(0, int(b.till) + int(b.assets) - Math.round(owed));
}

/** The day the business registered: recorded since B4, or found in its ledger. */
export function registeredDay(b) {
  if (b.registeredDay != null) return b.registeredDay;
  return b.ledger.find((e) => e.kind === 'registered')?.day ?? b.openedDay ?? 0;
}

const weekly = (d) => (d.profit * 7) / Math.max(1, d.endDay - d.startDay);

/** The milestones for chartering: weeks registered, recent profit, an expansion finished, the fee. */
export function charterMilestones(b, p = BUSINESS_DEFAULTS) {
  const c = p.charter;
  // Whole weeks from registering to the start of this week (the digests alone are capped at 12).
  const since = registeredDay(b);
  const registeredWeeks = Math.max(0, Math.floor(((b.period?.startDay ?? since) - since) / 7));
  const recent = b.digests.slice(-4);
  const avg = recent.length ? recent.reduce((a, d) => a + weekly(d), 0) / recent.length : 0;
  const expansions = b.projects.filter((x) => x.kind === 'expansion' && x.status === 'done').length;
  const items = [
    { id: 'registeredWeeks', have: Math.floor(registeredWeeks), need: c.minWeeks },
    { id: 'charterProfit', have: Math.round(avg), need: c.minProfit },
    { id: 'expansions', have: expansions, need: c.minExpansions },
    { id: 'charterFee', have: b.till, need: c.fee },
  ].map((x) => ({ ...x, met: x.have >= x.need }));
  return { to: 2, items, met: items.every((x) => x.met), available: true };
}

/** A ticker: two to five letters, upper case. */
export const cleanTicker = (t) => String(t ?? '').trim().toUpperCase().replace(/[^A-Z]/g, '').slice(0, 5);

/**
 * Whether the partners can agree to charter now: the milestones, a free ticker, and no charter under way
 * or waiting out a refusal.
 * @param {string[]} [taken] - tickers already in use (market companies and other charters)
 */
export function canCharter(b, { ticker, day, taken = [] }, p = BUSINESS_DEFAULTS) {
  if (b.stage !== 1) return fail('no-step-up');
  if (b.charter && !['failed'].includes(b.charter.status)) return fail('already-agreed');
  if (b.charter?.retryDay != null && day < b.charter.retryDay) return fail('charter-delay');
  if (!charterMilestones(b, p).met) return fail('milestones');
  const t = cleanTicker(ticker);
  if (t.length < 2) return fail('bad-ticker');
  if (taken.map(cleanTicker).includes(t)) return fail('ticker-taken');
  return { ok: true, ticker: t };
}

/**
 * The partners have agreed (the proposal passed): the fee is paid, and the rolls are open. Parts that
 * passed within the keep window of a refused charter are carried over.
 */
export function startCharter(b, { ticker, day }, p = BUSINESS_DEFAULTS) {
  const c = p.charter;
  if (b.till < c.fee) return fail('no-funds');
  b.till -= c.fee;
  addLedger(b, { day, kind: 'charterFee', amount: -c.fee }, p);
  const kept = Object.fromEntries(Object.entries(b.charter?.kept ?? {}).filter(([, r]) => r && day <= r.day + c.keepDays));
  b.charter = { status: 'rolling', ticker: cleanTicker(ticker), agreedDay: day, rolls: { ...kept }, quote: null, netAssets: null, shortfall: null, escrow: {}, fundingEnds: null, retryDay: null };
  return { ok: true };
}

/** Whether a partner can make this charter roll now, and its DV and skills. */
export function charterRollCheck(b, actorId, part, p = BUSINESS_DEFAULTS) {
  const me = partnerOf(b, actorId);
  if (b.status !== 'open') return fail('not-open');
  if (me?.status !== 'active' || !me.voting) return fail('not-partner');
  if (b.charter?.status !== 'rolling') return fail('not-agreed');
  if (!CHARTER_PARTS.includes(part)) return fail('bad-part');
  if (b.charter.rolls[part]) return fail('part-rolled');
  const spec = p.charter.parts[part];
  return { ok: true, dv: dvOf(spec.dv), uses: [...spec.uses] };
}

/**
 * Record a charter roll. A failed capital structure roll refuses the charter (the parts that passed are
 * kept for a while); once all three are in, the quote is set and the charter waits for the GM.
 */
export function applyCharterRoll(b, actorId, part, result, day, p = BUSINESS_DEFAULTS) {
  const c = p.charter;
  b.charter.rolls[part] = { band: result.band, success: !!result.success, margin: result.margin ?? 0, crit: result.band === 'exceptional', by: actorId, day };
  if (part === 'capital' && !result.success) {
    const kept = Object.fromEntries(Object.entries(b.charter.rolls).filter(([k, r]) => k !== 'capital' && r.success));
    b.charter = { status: 'failed', ticker: b.charter.ticker, retryDay: day + (result.band === 'fumble' ? c.fumbleRefile : c.refile), kept };
    b.stepUp = null;
    addLedger(b, { day, kind: 'charterRefused', amount: 0, actorId }, p);
    return { refused: true };
  }
  if (CHARTER_PARTS.every((k) => b.charter.rolls[k])) {
    const cap = b.charter.rolls.capital;
    const quote = capitalQuote(b, { margin: cap.margin, crit: cap.crit }, p);
    const assets = netAssets(b);
    Object.assign(b.charter, { status: 'awaiting', quote, netAssets: assets, shortfall: Math.max(0, quote - assets) });
    return { awaiting: true };
  }
  return { rolled: true };
}

/** What has been paid in so far toward the shortfall. */
export const charterPaid = (b) => Object.values(b.charter?.escrow ?? {}).reduce((a, x) => a + x, 0);

/**
 * GM: approve a charter waiting for it. With no shortfall the company is formed at once; otherwise the
 * funding window opens.
 * @returns {{ok: true, formed: boolean} | {ok: false, reason: string}}
 */
export function approveCharter(b, day, p = BUSINESS_DEFAULTS) {
  if (b.charter?.status !== 'awaiting') return fail('not-awaiting');
  if (b.charter.shortfall <= 0) {
    formCompany(b, day, p);
    return { ok: true, formed: true };
  }
  Object.assign(b.charter, { status: 'funding', fundingEnds: day + p.charter.fundingDays, escrow: {} });
  return { ok: true, formed: false };
}

/**
 * End a charter that will not be formed (the GM turned it down, or the funding window lapsed): every
 * payment is refunded; the fee is not. The partners may agree again.
 * @returns {Object<string, number>} actorId -> eddies to refund
 */
export function dropCharter(b, day, reason, p = BUSINESS_DEFAULTS) {
  const refunds = { ...(b.charter?.escrow ?? {}) };
  const kept = Object.fromEntries(Object.entries(b.charter?.rolls ?? {}).filter(([k, r]) => k !== 'capital' && r?.success));
  b.charter = { status: 'failed', ticker: b.charter?.ticker ?? '', retryDay: day, kept, reason };
  b.stepUp = null;
  addLedger(b, { day, kind: 'charterDropped', amount: 0, reason }, p);
  return refunds;
}

/**
 * A partner pays toward the shortfall while the funding window is open (at most the shortfall plus the
 * extra allowed, all told). The company is formed once the shortfall is met.
 * @returns {{ok: true, cash: number, formed: boolean} | {ok: false, reason: string}}
 */
export function fundCharter(b, actor, cash, day, p = BUSINESS_DEFAULTS) {
  const me = partnerOf(b, actor.id);
  if (b.charter?.status !== 'funding') return fail('not-funding');
  if (me?.status !== 'active') return fail('not-partner');
  const amount = int(cash);
  if (amount < 1) return fail('bad-amount');
  if (amount > actor.wealth) return fail('insufficient-funds');
  const room = Math.round(b.charter.shortfall * (1 + p.charter.extraShare)) - charterPaid(b);
  if (amount > room) return fail('over-funded');
  b.charter.escrow = { ...b.charter.escrow, [actor.id]: (b.charter.escrow[actor.id] ?? 0) + amount };
  addLedger(b, { day, kind: 'charterFund', amount, actorId: actor.id }, p);
  const formed = charterPaid(b) >= b.charter.shortfall;
  if (formed) formCompany(b, day, p);
  return { ok: true, cash: amount, formed };
}

/**
 * Form the company: stage 2. What was paid in buys new shares at the book value per unit before it
 * (existing units become shares one for one), goes into the cash, and the business plan and
 * registration bands shift Reputation and Compliance.
 */
export function formCompany(b, day, p = BUSINESS_DEFAULTS) {
  const c = p.charter;
  const price = totalUnits(b) > 0 ? unitValue(b) : 1;
  for (const [actorId, cash] of Object.entries(b.charter.escrow ?? {})) {
    const partner = partnerOf(b, actorId);
    if (!partner) continue;
    partner.units += Math.floor(cash / price);
    partner.cash += cash;
  }
  const paid = charterPaid(b);
  b.till += paid;
  const rolls = b.charter.rolls;
  b.state.reputation = clamp(b.state.reputation + (c.reputation[rolls.plan?.band] ?? 0), 0, 100);
  b.state.compliance = clamp((b.state.compliance ?? p.complianceBaseline) + (c.compliance[rolls.registration?.band] ?? 0), 0, 100);
  b.stage = 2;
  b.company = { ticker: b.charter.ticker, sector: charterSector(b, p), charteredDay: day };
  // Those who ran the business become its first officers; later the shareholders elect them (B4c).
  b.officers = holders(b).filter((x) => x.voting).map((x) => x.actorId);
  b.charter = { ...b.charter, status: 'formed', formedDay: day };
  b.stepUp = null;
  addLedger(b, { day, kind: 'chartered', amount: paid }, p);
  return b;
}

/** Holders' shares in a company are its units, one for one (DESIGN §32). */
export const sharesOf = (b, actorId) => (holders(b).find((x) => x.actorId === actorId)?.units ?? 0);
