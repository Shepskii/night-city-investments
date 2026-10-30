/**
 * A chartered company's week and month
 * @file scripts/engine/businessCompany.js
 * @description Stage 2 (DESIGN §26.4, §32, B4b): what the five company actions do to the week, and the
 *              monthly report every four weeks, with its preparation roll. Pure; no Foundry globals.
 *              The rest of the weekly close (takings, upkeep, loans, events) is the business's own.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { clamp, fail, addLedger, partnerOf, holders, voters, stateBands, bookValue } from './businessRecord.js';
import { dvOf, approachOf, bandPassed } from './rolls.js';

const BANDS = ['fumble', 'failure', 'narrow', 'solid', 'strong', 'exceptional'];

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

// ── Officers (B4c) ───────────────────────────────────────────────────────────

/**
 * A company's officers: holders with a vote whom the shareholders elected (at the charter, every partner
 * with a vote). Below stage 2 every partner with a vote runs the business, so this is not consulted.
 */
export const officersOf = (b) => (b.officers ?? []).filter((id) => voters(b).some((x) => x.actorId === id));

/** Can this partner act for the business (take a slot, answer an event, prepare the report)? */
export const canRun = (b, actorId) => b.stage < 2 || officersOf(b).includes(actorId);

/** Whether an election (`elect`) or a dismissal (`dismiss`) of this holder can be proposed. */
export function officerProposal(b, kind, actorId) {
  if (b.stage < 2) return fail('not-company');
  const target = partnerOf(b, actorId);
  if (!target || !holders(b).includes(target) || !target.voting) return fail('bad-partner');
  const officers = officersOf(b);
  if (kind === 'elect' && officers.includes(actorId)) return fail('already-officer');
  if (kind === 'dismiss' && !officers.includes(actorId)) return fail('not-officer');
  if (kind === 'dismiss' && officers.length <= 1) return fail('last-officer');
  return { ok: true, terms: { actorId } };
}

/** A passed election or dismissal. */
export function applyOfficerProposal(b, kind, actorId) {
  const officers = new Set(officersOf(b));
  if (kind === 'elect') officers.add(actorId);
  else officers.delete(actorId);
  b.officers = [...officers];
  return { ok: true };
}

// ── Information rolls (B4c) ──────────────────────────────────────────────────

/** An Exposure figure as a band the players can be told. */
export function exposureBand(exposure, p = BUSINESS_DEFAULTS) {
  return p.info.exposureBands.find(([below]) => (Number(exposure) || 0) < below)[1];
}

/** Whether an internal audit or due diligence can be made now, its DV, skills and cost. */
export function infoCheck(b, kind, day, p = BUSINESS_DEFAULTS) {
  if (b.stage < 2) return fail('not-company');
  const last = kind === 'audit' ? b.lastAudit : (b.intel ?? []).at(-1);
  if (last && day < last.day + p.info.cooldown) return fail('info-delay');
  const cost = kind === 'audit' ? p.info.auditCost : p.info.diligenceCost;
  if (b.till < cost) return fail('no-funds');
  return { ok: true, dv: dvOf(p.info.dv), uses: [...(kind === 'audit' ? p.info.auditUses : p.info.diligenceUses)], cost };
}

/**
 * Record an internal audit. A pass tells the officers the Exposure band; strong or better wipes some of
 * it out (returned as a negative Exposure, for the hidden record).
 * @param {number} exposure - the company's Exposure now (hidden; the GM's service passes it)
 */
export function applyInternalAudit(b, { result, day, exposure, by }, p = BUSINESS_DEFAULTS) {
  b.till -= p.info.auditCost;
  addLedger(b, { day, kind: 'audit', amount: -p.info.auditCost, actorId: by }, p);
  const cut = result.success ? (p.info.auditCut[result.band] ?? 0) : 0;
  b.lastAudit = { day, band: result.band, by, ...(result.success ? { exposure: exposureBand(Math.max(0, exposure - cut), p) } : {}) };
  return { exposure: -cut };
}

/**
 * Record due diligence on another business: on a pass, its state bands and a range for its value (the
 * better the roll, the narrower), kept with this company's intelligence.
 * @param {{name: string, bands: object, value: number}|null} target - what the GM's service found
 */
export function applyDiligence(b, { result: rolled, day, targetId, target, by }, p = BUSINESS_DEFAULTS) {
  b.till -= p.info.diligenceCost;
  addLedger(b, { day, kind: 'diligence', amount: -p.info.diligenceCost, actorId: by }, p);
  // Loose lips on the target's staff (E2): what the roll finds counts a band better.
  const band = target?.leaky ? BANDS[Math.min(BANDS.length - 1, BANDS.indexOf(rolled.band) + 1)] : rolled.band;
  const result = { ...rolled, band, success: bandPassed(band) };
  const spread = p.info.spread[result.band];
  const entry = {
    targetId, name: target?.name ?? '', day, band: result.band, by,
    ...(result.success && target ? {
      bands: target.bands,
      range: [Math.round((target.value * (1 - spread)) / 100) * 100, Math.round((target.value * (1 + spread)) / 100) * 100],
    } : {}),
  };
  b.intel = [...(b.intel ?? []), entry].slice(-p.info.intelCap);
  return entry;
}

/** What due diligence on a business can see: its name, its state bands and its book value. */
export const diligenceView = (t, p = BUSINESS_DEFAULTS) => ({ name: t.name, bands: stateBands(t, p), value: bookValue(t) });

