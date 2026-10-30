/**
 * A chartered company's week and month
 * @file scripts/engine/businessCompany.js
 * @description Stage 2 (DESIGN §26.4, §32, B4b): what the five company actions do to the week, and the
 *              monthly report every four weeks, with its preparation roll. Pure; no Foundry globals.
 *              The rest of the weekly close (takings, upkeep, loans, events) is the business's own.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { clamp, fail, addLedger } from './businessRecord.js';
import { dvOf, approachOf } from './rolls.js';

/**
 * Apply the company's actions this week. Returns what the rest of the close needs: the multiplier on
 * the takings (contracts and shortcuts; none taken is an unworked week), the share of protection money
 * paid, and the Exposure the shortcuts left.
 */
export function companyWeek(b, { growthRate = 1, params: p = BUSINESS_DEFAULTS } = {}) {
  const fx = p.company;
  const slot = (action) => b.period.slots.find((s) => s.action === action);
  const scale = (s) => approachOf(s.approach).effect;
  let mult = 1;
  let worked = false;
  let exposure = 0;

  const contracts = slot('contracts');
  if (contracts) {
    mult *= 1 + (fx.contracts[contracts.band] - 1) * scale(contracts);
    b.state.reputation += fx.contractsReputation[contracts.band] * scale(contracts) * growthRate;
    worked = true;
  }
  const shortcuts = slot('shortcuts');
  if (shortcuts) {
    mult *= 1 + (fx.shortcuts[shortcuts.band] - 1) * scale(shortcuts);
    exposure += fx.shortcutsExposure[shortcuts.band];
    if (shortcuts.band === 'fumble' && b.state.compliance != null) b.state.compliance -= fx.shortcutsFumbleCompliance;
    worked = true;
  }
  const books = slot('books');
  if (books) b.state.costFactor = Math.max(p.costFloor, b.state.costFactor - fx.books[books.band] * scale(books));
  const relations = slot('relations');
  if (relations) b.state.reputation += fx.relations[relations.band] * scale(relations) * growthRate;
  const permits = slot('permits');
  let protection = 1;
  if (permits) {
    if (b.state.compliance != null) b.state.compliance += fx.permits[permits.band] * scale(permits);
    protection = 1 - fx.permitsProtection[permits.band] * scale(permits);
  }
  b.state.reputation = clamp(b.state.reputation, 0, 100);
  if (b.state.compliance != null) b.state.compliance = clamp(b.state.compliance, 0, 100);
  return { workMult: worked ? mult : p.unworked, protection, worked, exposure };
}

/** Weeks closed since the last report, and the week the next report closes on. */
export const reportWeek = (b, p = BUSINESS_DEFAULTS) => ({ done: b.reportWeeks ?? 0, of: p.report.weeks });

/** Whether the monthly report can be prepared now: a company, in the report's last week, not yet prepared. */
export function reportCheck(b, p = BUSINESS_DEFAULTS) {
  if (b.stage < 2) return fail('not-company');
  if ((b.reportWeeks ?? 0) !== p.report.weeks - 1) return fail('not-report-week');
  if (b.reportPrep) return fail('report-prepared');
  return { ok: true, dv: dvOf(p.report.dv), uses: [...p.report.uses] };
}

/**
 * After a company's week closes: count it toward the month, and on the fourth publish the monthly
 * report, which sums the weeks since the last one. Without preparation it reports what it earned; a
 * prepared report shifts the profit by its band (doubled when Bold, aggressive reporting).
 */
export function closeReportWeek(b, day, out, p = BUSINESS_DEFAULTS) {
  const r = p.report;
  b.reportWeeks = (b.reportWeeks ?? 0) + 1;
  if (b.reportWeeks < r.weeks) return null;
  const weeks = b.digests.slice(-r.weeks);
  const sum = (key) => weeks.reduce((a, d) => a + (d[key] ?? 0), 0);
  const profit = sum('profit');
  const prep = b.reportPrep;
  const shift = prep ? (r.shift[prep.band] ?? 0) * (prep.bold ? 2 : 1) : 0;
  const report = {
    index: (b.reports.at(-1)?.index ?? 0) + 1,
    fromDay: weeks[0]?.startDay ?? day,
    toDay: day,
    weeks: weeks.length,
    takings: sum('takings'),
    upkeep: sum('upkeep'),
    profit,
    reported: Math.round(profit + Math.abs(profit) * shift),
    ...(prep ? { prep: { band: prep.band, bold: prep.bold, total: prep.total, by: prep.by } } : {}),
  };
  b.reports = [...b.reports, report].slice(-r.cap);
  b.reportWeeks = 0;
  b.reportPrep = null;
  addLedger(b, { day, kind: 'report', amount: 0, report: report.index }, p);
  out.events.push({ type: 'reportPublished', report });
  return report;
}
