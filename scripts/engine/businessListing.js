/**
 * Player businesses: going public (B5a)
 * @file scripts/engine/businessListing.js
 * @description DESIGN §26.4a: a chartered company's market valuation V, recorded at each monthly
 *              report; the listing checklist; agreeing to list (every shareholder with a vote, naming
 *              the float), the listing fee and the GM's approval; the two prospectus rolls (the filing,
 *              the offering) and the offer they set: a price per share and the shares floated. The
 *              listing itself (the market entry and the IPO) is B5b. Pure; no Foundry globals.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail, totalUnits, clamp } from './businessRecord.js';
import { netAssets, charterSector } from './businessCharter.js';
import { bandPassed, dvOf } from './rolls.js';

/** The ledger entries that are cash newly paid in: kept out of V until the lock-in has passed. */
const PAID_IN = new Set(['investment', 'contribution', 'charterFund', 'angel']);

/** The sector's earnings multiple (a GM table, 6 to 14 by default). */
export const sectorMultiple = (b, p = BUSINESS_DEFAULTS) => p.listing.multiples[charterSector(b, p)] ?? p.listing.multiples.other;

/**
 * The market valuation V (§26.4a): net assets, less cash paid in within the lock-in, plus the last three
 * monthly reports' reported profit, annualised (never below zero), times the sector multiple. What the
 * reports showed counts, so aggressive reporting lifts it, as it would in the market.
 */
export function valuation(b, day, p = BUSINESS_DEFAULTS) {
  const l = p.listing;
  const locked = (b.ledger ?? []).filter((e) => PAID_IN.has(e.kind) && e.amount > 0 && day - e.day < l.lockinDays).reduce((a, e) => a + e.amount, 0);
  const recent = (b.reports ?? []).slice(-3);
  const annual = recent.length ? (recent.reduce((a, r) => a + (r.reported ?? r.profit ?? 0), 0) / recent.length) * 13 : 0;
  return Math.round(Math.max(0, netAssets(b) - locked) + Math.max(0, annual) * sectorMultiple(b, p));
}

/**
 * The listing checklist (§26.4a), shown, not rolled: V at the threshold now and on the last three
 * reports, a track record, Compliance, no unresolved concerns (the GM's service marks hidden Exposure
 * over its cap as `listingConcerns`), and the fee in the cash.
 * @param {{day: number, threshold?: number}} o - `threshold` is the world setting
 */
export function listingMilestones(b, { day, threshold } = {}, p = BUSINESS_DEFAULTS) {
  const l = p.listing;
  const t = threshold ?? l.threshold;
  const v = valuation(b, day, p);
  const reports = b.reports ?? [];
  let sustained = 0;
  for (const r of [...reports].reverse()) {
    if ((r.valuation ?? 0) < t) break;
    sustained++;
  }
  const since = b.company?.charteredDay ?? b.charter?.formedDay ?? day;
  const fee = Math.round(v * l.fee);
  const items = [
    { id: 'valuation', have: v, need: t, met: v >= t },
    { id: 'sustained', have: sustained, need: l.sustained, met: sustained >= l.sustained },
    { id: 'reports', have: reports.length, need: l.minReports, met: reports.length >= l.minReports },
    { id: 'listedDays', have: Math.max(0, day - since), need: l.minDays, met: day - since >= l.minDays },
    { id: 'listingCompliance', have: Math.round(b.state.compliance ?? 0), need: l.compliance, met: (b.state.compliance ?? 0) >= l.compliance },
    { id: 'concerns', have: null, need: null, met: !b.listingConcerns },
    { id: 'listingFee', have: b.till, need: fee, met: b.till >= fee },
  ];
  return { to: 3, items, met: items.every((x) => x.met), available: true, valuation: v, fee };
}

/** The floats the shareholders may agree to: 20% to 40% of the company, in 5% steps. */
export function floatOptions(p = BUSINESS_DEFAULTS) {
  const l = p.listing;
  const out = [];
  for (let f = l.minFloat; f <= l.maxFloat + 1e-9; f += l.floatStep) out.push(Math.round(f * 100) / 100);
  return out;
}

/** Whether the shareholders can agree to list now: the checklist met, a float allowed, no listing under way or waiting out a refusal. */
export function canList(b, { float, day, threshold } = {}, p = BUSINESS_DEFAULTS) {
  if (b.stage !== 2) return fail('no-step-up');
  const status = b.listing?.status;
  if (status && !['failed', 'rejected'].includes(status)) return fail('already-agreed');
  if (b.listing?.retryDay != null && day < b.listing.retryDay) return fail('listing-delay');
  const f = Math.round(Number(float) * 100) / 100;
  if (!floatOptions(p).includes(f)) return fail('bad-float');
  if (!listingMilestones(b, { day, threshold }, p).met) return fail('milestones');
  return { ok: true, float: f };
}

/** The shareholders have agreed: the listing fee (a share of V) is paid, and it waits for the GM. */
export function startListing(b, { float, day }, p = BUSINESS_DEFAULTS) {
  const v = valuation(b, day, p);
  const fee = Math.round(v * p.listing.fee);
  if (b.till < fee) return fail('no-funds');
  b.till -= fee;
  addLedger(b, { day, kind: 'listingFee', amount: -fee }, p);
  b.listing = { status: 'awaiting', agreedDay: day, float, fee, valuation: v, rolls: {}, retryDay: null };
  return { ok: true };
}

/** GM: approve a listing waiting for it: the prospectus rolls open. */
export function approveListing(b) {
  if (b.listing?.status !== 'awaiting') return fail('not-awaiting');
  b.listing.status = 'prospectus';
  return { ok: true };
}

/** GM: turn a listing down. The fee is not refunded; they may agree again later. */
export function rejectListing(b, day, p = BUSINESS_DEFAULTS) {
  if (!['awaiting', 'prospectus'].includes(b.listing?.status)) return fail('not-awaiting');
  Object.assign(b.listing, { status: 'rejected', retryDay: day + p.listing.retryDays });
  addLedger(b, { day, kind: 'listingRejected', amount: 0 }, p);
  return { ok: true };
}

/** The two prospectus rolls. */
export const PROSPECTUS_PARTS = Object.freeze(['filing', 'offering']);

/** Whether a prospectus roll can be made now, and how (the company's DV, its skills). */
export function prospectusCheck(b, part, p = BUSINESS_DEFAULTS) {
  if (b.listing?.status !== 'prospectus') return fail('no-listing');
  if (!PROSPECTUS_PARTS.includes(part)) return fail('bad-part');
  if (b.listing.rolls?.[part]) return fail('part-done');
  return { ok: true, dv: dvOf(p.listing.dv), uses: [...p.listing.uses[part]] };
}

/**
 * Record a prospectus roll. A failure ends this attempt (the fee is spent; they may agree again after
 * the refiling delay). Once both pass, the offer is set: the price per share is V per share times a
 * factor from the two results (a Bold roll doubles its part), and the float is what the shareholders
 * agreed, capped by the demand the offering found.
 * @returns {{passed: boolean, ready: boolean, failed: boolean}}
 */
export function applyProspectusRoll(b, actorId, part, result, day, p = BUSINESS_DEFAULTS) {
  const l = p.listing;
  const passed = bandPassed(result.band);
  b.listing.rolls = { ...(b.listing.rolls ?? {}), [part]: { band: result.band, success: passed, bold: result.approach === 'bold', total: result.total, by: actorId, day } };
  if (!passed) {
    Object.assign(b.listing, { status: 'failed', retryDay: day + l.retryDays });
    addLedger(b, { day, kind: 'listingFailed', amount: 0 }, p);
    return { passed, ready: false, failed: true };
  }
  if (!PROSPECTUS_PARTS.every((x) => b.listing.rolls[x]?.success)) return { passed, ready: false, failed: false };
  const factor = PROSPECTUS_PARTS.reduce((a, x) => a + (l.factor[b.listing.rolls[x].band] ?? 0) * (b.listing.rolls[x].bold ? 2 : 1), 0) / PROSPECTUS_PARTS.length;
  const v = valuation(b, day, p);
  const shares = totalUnits(b);
  const price = Math.max(1, Math.round((v / Math.max(1, shares)) * (1 + clamp(factor, -l.maxFactor, l.maxFactor)) * 100) / 100);
  const float = Math.min(b.listing.float, l.demand[b.listing.rolls.offering.band] ?? l.minFloat);
  // New shares, so the float is that share of the company after the offering.
  const floated = Math.round((shares * float) / (1 - float));
  Object.assign(b.listing, { status: 'ready', valuation: v, offer: { price, float, shares: floated, factor: Math.round(factor * 1000) / 1000 } });
  addLedger(b, { day, kind: 'listingReady', amount: 0 }, p);
  return { passed, ready: true, failed: false };
}
