/**
 * Regulators (R1)
 * @file scripts/engine/businessRegulator.js
 * @description Exposure with teeth. A regulator may open a case on a chartered or listed company: by a
 *              chance at each monthly report that rises with its Exposure band, or at once on a trigger
 *              (a fired corp plant, a fumbled Shortcuts roll, a big holder unmasked), or by the GM's
 *              hand. The company has `notice` days for an officer to answer with one opposed roll. A win
 *              clears half its Exposure. A loss, or silence, waits on the GM: a fine scaled to book
 *              value and a Compliance hit, and on a fumble or at high Exposure a listing application
 *              stopped or its reports restated. The band and the regulator's total stay with the GM's
 *              service: nothing here shows Exposure to players. Pure.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { addLedger, fail, bookValue, clamp } from './businessRecord.js';
import { exposureBand, canRun } from './businessCompany.js';
import { valuation, isListed } from './businessListing.js';

/** A listing application not yet on the market: a lost case can stop it. */
const APPLYING = ['awaiting', 'prospectus', 'ready'];

/** The case on a company now, if any. */
export const caseOf = (b) => b.regCase ?? null;

/** The chance a regulator looks at this monthly report, by Exposure. */
export const caseChance = (exposure, p = BUSINESS_DEFAULTS) => p.regulator.chance[exposureBand(exposure, p)] ?? 0;

/** The regulator's total: its base, a d10 (from `rng`, numbers in [0, 1)), and a bonus by Exposure band. */
export function regulatorTotal(exposure, rng, p = BUSINESS_DEFAULTS) {
  const r = p.regulator;
  return r.base + 1 + Math.floor(rng() * 10) + (r.bonus[exposureBand(exposure, p)] ?? 0);
}

/** Open a case, if the company can have one and has none: a chartered or listed company, open. */
export function openCase(b, { reason, day }, p = BUSINESS_DEFAULTS) {
  if (b.stage !== 2 || b.status !== 'open') return fail('not-company');
  if (b.regCase) return fail('case-open');
  b.regCase = { status: 'notice', reason, openedDay: day, endDay: day + p.regulator.notice };
  addLedger(b, { day, kind: 'caseOpened', amount: 0 }, p);
  return { ok: true };
}

/** Whether this partner can answer the case now: an officer, while the notice runs and before it is answered. */
export function caseAnswerCheck(b, actorId) {
  if (b.regCase?.status !== 'notice') return fail('no-case');
  if (!canRun(b, actorId)) return fail('not-officer');
  return { ok: true };
}

/** What Bribery costs the company to answer with; other skills cost nothing. */
export const caseBribe = (use, p = BUSINESS_DEFAULTS) => (use?.skill === 'Bribery' ? p.regulator.bribe : 0);

/** The bribe for an answer in Bribery, from the cash, whatever comes of it. */
export function payCaseBribe(b, amount, day, p = BUSINESS_DEFAULTS) {
  b.till -= amount;
  addLedger(b, { day, kind: 'caseBribe', amount: -amount }, p);
}

/** A won case: closed. The service clears half the hidden Exposure (`clearShare`). */
export function winCase(b, day, p = BUSINESS_DEFAULTS) {
  b.regCase = null;
  addLedger(b, { day, kind: 'caseWon', amount: 0 }, p);
  return { ok: true };
}

/**
 * A lost case (or one nobody answered): it waits on the GM with its proposed fine. A fumble, or high
 * Exposure, makes it serious: a listing application stops, or the reports are restated.
 */
export function loseCase(b, { day, exposure, fumble = false, silent = false }, p = BUSINESS_DEFAULTS) {
  const band = exposureBand(exposure, p);
  const high = band === 'high';
  const fine = Math.round(Math.max(0, bookValue(b)) * (high ? p.regulator.fineHigh : p.regulator.fine));
  b.regCase = { ...b.regCase, status: 'lost', lostDay: day, fine, serious: fumble || high, silent, fumble };
  addLedger(b, { day, kind: 'caseLost', amount: 0 }, p);
  return { ok: true, fine };
}

/**
 * The GM confirms a lost case: the fine (which they may have changed) comes from the cash, even past
 * zero, Compliance falls, and if it is serious a listing application stops, or the reports of the last
 * three months go back to their real figures.
 * @returns {{ok: true, fine: number, stopped: boolean, restated: number} | {ok: false, reason: string}}
 */
export function applyCaseLoss(b, { day, fine = null }, p = BUSINESS_DEFAULTS) {
  const c = b.regCase;
  if (c?.status !== 'lost') return fail('no-case');
  const amount = Math.max(0, Math.round(fine ?? c.fine));
  b.till -= amount;
  b.state.compliance = clamp((b.state.compliance ?? 0) + p.regulator.compliance, 0, 100);
  addLedger(b, { day, kind: 'caseFine', amount: -amount }, p);
  let stopped = false;
  let restated = 0;
  if (c.serious) {
    if (APPLYING.includes(b.listing?.status)) {
      Object.assign(b.listing, { status: 'failed', retryDay: day + p.listing.retryDays });
      addLedger(b, { day, kind: 'listingStopped', amount: 0 }, p);
      stopped = true;
    } else {
      for (const r of (b.reports ?? []).slice(-3)) {
        if (r.reported !== r.profit) {
          r.reported = r.profit;
          r.restated = day;
          restated++;
        }
      }
      if (restated) {
        const v = valuation(b, day, p);
        for (const r of (b.reports ?? []).slice(-3)) if (r.restated === day && r.valuation != null) r.valuation = Math.min(r.valuation, v);
        addLedger(b, { day, kind: 'reportsRestated', amount: 0, price: restated }, p);
      }
    }
  }
  b.regCase = null;
  return { ok: true, fine: amount, stopped, restated, listed: isListed(b) };
}

/** The GM drops a case, at any stage: nothing else happens. */
export function dropCase(b, day, p = BUSINESS_DEFAULTS) {
  if (!b.regCase) return fail('no-case');
  b.regCase = null;
  addLedger(b, { day, kind: 'caseDropped', amount: 0 }, p);
  return { ok: true };
}

/** What an event opens a case for at once: a fired corp plant, or a fumbled Shortcuts roll. */
export function caseTrigger(events = []) {
  if (events.some((e) => e.type === 'fired' && e.exposure > 0)) return 'plant';
  if (events.some((e) => e.type === 'roll' && e.action === 'shortcuts' && e.band === 'fumble')) return 'shortcuts';
  return null;
}
