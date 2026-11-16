/**
 * A Lawman's investigation (X2d, DESIGN §36.20)
 * @file scripts/engine/businessInquiry.js
 * @description Backup against an NPC's business or a market corporation, once in a while, for a fee. Against an
 *              NPC's business a pass opens a regulator's case, which the GM runs; against a corporation it drops the
 *              price by the roll, with a headline, and costs standing with it. A fumble draws heat and a smear.
 *              Evidence, a story about the target lately, adds to the roll. Pure.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { bandPassed } from './rolls.js';

/** Days until this Lawman can open another investigation; 0 when they can now. */
export function inquiryWait(lastDay, day, p = BUSINESS_DEFAULTS) {
  return Number.isFinite(lastDay) ? Math.max(0, lastDay + p.roles.inquiry.days - day) : 0;
}

/**
 * A corporation's place by size among the market's corporations: 0 for the smallest third, 2 for the largest.
 * @param {{ticker: string, cap: number}[]} corps
 */
export function corpTier(corps, ticker) {
  const sorted = [...corps].sort((a, b) => (a.cap - b.cap) || a.ticker.localeCompare(b.ticker));
  const at = sorted.findIndex((c) => c.ticker === ticker);
  if (at < 0 || !sorted.length) return 0;
  return Math.min(2, Math.floor((at * 3) / sorted.length));
}

/** The DV of an investigation: a set one for an NPC's business, by size for a corporation. */
export function inquiryDv(target, corps = [], p = BUSINESS_DEFAULTS) {
  const dv = p.roles.inquiry.dv;
  return target.kind === 'npc' ? dv.npc : dv.corp[corpTier(corps, target.ticker)];
}

/** Whether there is evidence: a story about this ticker within the last few weeks, by anyone. */
export function hasEvidence(recent, ticker, day, p = BUSINESS_DEFAULTS) {
  if (!ticker) return false;
  return (recent ?? []).some((s) => s.ticker === ticker && day - s.day >= 0 && day - s.day < p.roles.inquiry.evidenceDays);
}

/** The DV the roll is resolved against: evidence adds to the roll, which is the same as taking it off the DV. */
export const inquiryTarget = (dv, evidence, p = BUSINESS_DEFAULTS) => dv - (evidence ? p.roles.inquiry.evidence : 0);

/**
 * What the roll does.
 * @returns {{outcome: 'success'|'failure'|'fumble', regCase: boolean, percent: number, standing: number, heat: number, story: boolean}}
 */
export function inquiryEffect(band, target, p = BUSINESS_DEFAULTS) {
  const rules = p.roles.inquiry;
  const none = { regCase: false, percent: 0, standing: 0, heat: 0, story: false };
  if (band === 'fumble') return { ...none, outcome: 'fumble', heat: rules.heat, story: true };
  if (!bandPassed(band)) return { ...none, outcome: 'failure' };
  if (target.kind === 'npc') return { ...none, outcome: 'success', regCase: true };
  return { ...none, outcome: 'success', percent: -(rules.drop[band] ?? 0), standing: rules.standing };
}
