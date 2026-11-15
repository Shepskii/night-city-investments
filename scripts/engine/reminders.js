/**
 * Reminders, the weekly business mail and adverts (M, DESIGN §36.4)
 * @file scripts/engine/reminders.js
 * @description What is about to run out for whom, a day ahead: a vote not yet cast, a story or a regulator's case
 *              not yet answered, a week closing with its action slots unused, a raise asked for, a charter's funding
 *              window, a takeover's tender, and cash short of the loans and wages due at the close. Also what is
 *              waiting on a business's runners for its weekly mail, and when a business may advertise. Pure; no
 *              Foundry globals. The GM's ReminderService sends them, each once, from whoever owns the deadline.
 */

import { BUSINESS_DEFAULTS } from './businessConfig.js';
import { voters } from './businessRecord.js';
import { openLoans } from './businessFinance.js';
import { activeMembers, syndicateUnits } from './syndicate.js';

/** Days ahead of a deadline that a reminder goes out. */
export const REMINDER_LEAD = 1;
/** A key is remembered this many days after it was sent, so it is never sent twice. */
export const REMINDER_KEEP_DAYS = 60;
/** At least this many days between two adverts from one business. */
export const AD_GAP_DAYS = 28;
/** A Promote this good sends an advert. */
export const AD_BANDS = Object.freeze(['strong', 'exceptional']);

/** Is a deadline tomorrow or today, and not yet past? */
export const dueSoon = (deadline, day, lead = REMINDER_LEAD) => deadline != null && Number.isFinite(Number(deadline)) && deadline >= day && deadline - day <= lead;

/** Those who hold a vote on a business proposal and have not cast it: characters or syndicates, by account id. */
function notVoted(b, proposal) {
  return voters(b).filter((x) => !x.npc && x.units > 0 && proposal.votes?.[x.actorId] == null).map((x) => x.actorId);
}

/** What the business must pay as its week closes: each open loan's interest and repayment, and the staff's wages. */
export function dueAtClose(b) {
  const loans = openLoans(b).reduce((a, l) => a + Math.round(l.balance * l.rate) + Math.min(l.payment, l.balance), 0);
  const wages = (b.staff ?? []).filter((s) => s.status === 'active').reduce((a, s) => a + (s.wage ?? 0) + (s.owed ?? 0), 0);
  return { loans, wages, total: loans + wages };
}

/**
 * One business's reminders due by `day`. `to` is `'runners'` (those running it), or a list of account ids (a
 * syndicate's id stands for its officers). `from` says who sends it.
 * @returns {{key: string, kind: string, to: 'runners'|string[], from: object, deadline: number, data: object}[]}
 */
export function businessReminders(b, day, p = BUSINESS_DEFAULTS) {
  if (b?.status !== 'open' || b.npcRun) return [];
  const out = [];
  const name = b.name;
  for (const proposal of b.proposals ?? []) {
    if (!dueSoon(proposal.expires, day)) continue;
    const to = notVoted(b, proposal);
    if (to.length) out.push({ key: `vote:${b.id}:${proposal.id}`, kind: 'vote', to, from: { kind: 'business' }, deadline: proposal.expires, data: { name, proposal: proposal.kind } });
  }
  const period = b.period;
  if (period && dueSoon(period.endDay, day)) {
    const event = period.event;
    const answered = (period.slots ?? []).some((s) => s.action === 'respond');
    // A gang's good word needs no answer; its tip to Vice is chased by whoever passed it on (G1).
    if (event?.kind === 'press' && !answered && event.story === 'snitch') {
      out.push({ key: `press:${b.id}:${period.index}`, kind: 'snitch', to: 'runners', from: { kind: 'source' }, deadline: period.endDay, data: { name, gang: event.grudge ?? '' } });
    } else if (event?.kind === 'press' && !answered && event.story !== 'friendly') {
      out.push({ key: `press:${b.id}:${period.index}`, kind: 'press', to: 'runners', from: { kind: 'outlet', name: event.factionName ?? '', factionId: event.factionId ?? null, ...(event.street ? { street: true } : {}) }, deadline: period.endDay, data: { name, outlet: event.factionName ?? '' } });
    }
    const slots = p.stages[b.stage]?.slots ?? 1;
    const left = slots - (period.slots ?? []).length;
    if (left > 0) out.push({ key: `slots:${b.id}:${period.index}`, kind: 'slots', to: 'runners', from: { kind: 'business' }, deadline: period.endDay, data: { name, left, slots } });
    // A raise asked for runs out at the month's end, which is this close.
    if (period.index % p.report.weeks === 0) {
      for (const s of (b.staff ?? []).filter((x) => x.status === 'active' && x.ask)) {
        out.push({ key: `raise:${b.id}:${s.id}:${s.ask.day}`, kind: 'raise', to: 'runners', from: { kind: 'staff', staffId: s.id }, deadline: period.endDay, data: { name, staff: s.name, pct: Math.round(s.ask.pct * 100) } });
      }
    }
    // A corporation's order settled at this close, short of its count (C1): the buyer chases it.
    for (const c of (b.contracts ?? []).filter((x) => x.status === 'open' && x.due != null && x.due <= period.endDay && x.made < x.count)) {
      out.push({ key: `contract:${b.id}:${c.id}`, kind: 'contract', to: 'runners', from: { kind: 'buyer', corp: c.corp }, deadline: period.endDay, data: { name, corp: c.corp.name, item: c.item.name, made: c.made, count: c.count } });
    }
    const due = dueAtClose(b);
    if (due.total > 0 && b.till < due.total) {
      out.push({ key: `cash:${b.id}:${period.index}`, kind: 'cash', to: 'runners', from: { kind: 'business' }, deadline: period.endDay, data: { name, till: b.till, loans: due.loans, wages: due.wages, total: due.total } });
    }
  }
  if (b.regCase?.status === 'notice' && dueSoon(b.regCase.endDay, day)) {
    out.push({ key: `case:${b.id}:${b.regCase.openedDay}`, kind: 'case', to: 'runners', from: { kind: 'regulator' }, deadline: b.regCase.endDay, data: { name } });
  }
  if (b.charter?.status === 'funding' && dueSoon(b.charter.fundingEnds, day)) {
    out.push({ key: `charter:${b.id}:${b.charter.fundingEnds}`, kind: 'charter', to: 'runners', from: { kind: 'business' }, deadline: b.charter.fundingEnds, data: { name, shortfall: b.charter.shortfall ?? 0 } });
  }
  const t = b.takeover;
  if (t?.status === 'open' && dueSoon(t.endDay, day)) {
    const to = b.partners.filter((x) => !x.npc && x.status === 'active' && x.units > 0 && x.actorId !== t.bidderId && !(t.tenders?.[x.actorId] > 0)).map((x) => x.actorId);
    if (to.length) out.push({ key: `takeover:${b.id}:${t.openDay}`, kind: 'takeover', to, from: { kind: 'exchange' }, deadline: t.endDay, data: { name, bidder: t.bidderName ?? '', price: t.price } });
  }
  return out;
}

/** A syndicate's votes closing: members with a say who have not voted. */
export function syndicateReminders(s, day) {
  if (s?.status && s.status !== 'active') return [];
  const units = syndicateUnits(s);
  const out = [];
  for (const proposal of s.proposals ?? []) {
    if (!dueSoon(proposal.ends, day)) continue;
    const to = activeMembers(s).filter((m) => (units > 0 ? m.units > 0 : true) && proposal.votes?.[m.actorId] == null).map((m) => m.actorId);
    if (to.length) out.push({ key: `svote:${s.id}:${proposal.id}`, kind: 'syndicateVote', to, from: { kind: 'syndicate' }, deadline: proposal.ends, data: { name: s.name, proposal: proposal.kind } });
  }
  return out;
}

/** A story about a character, open and not yet answered. */
export function storyReminders(stories, day) {
  return (stories ?? []).filter((x) => x.status === 'open' && x.answer == null && dueSoon(x.deadline, day)).map((x) => ({
    key: `cpress:${x.id}`, kind: 'characterPress', to: [x.actorId], from: { kind: 'outlet', name: x.outlet ?? '' }, deadline: x.deadline, data: { name: x.name ?? '', outlet: x.outlet ?? '' },
  }));
}

/** Drop what was sent long enough ago that it can't come round again. */
export function pruneSent(sent, day, keep = REMINDER_KEEP_DAYS) {
  return Object.fromEntries(Object.entries(sent ?? {}).filter(([, d]) => Number(d) >= day - keep));
}

/**
 * What waits on those running a business, for its weekly mail: votes the character hasn't cast, raises asked for,
 * applicants to look at, and a regulator's case open.
 * @param {string[]} accounts - the character's own id and any syndicate they act for
 */
export function waitingFor(b, accounts) {
  const mine = new Set(accounts);
  const votes = (b.proposals ?? []).filter((x) => voters(b).some((v) => mine.has(v.actorId) && x.votes?.[v.actorId] == null)).length;
  const raises = (b.staff ?? []).filter((s) => s.status === 'active' && s.ask).map((s) => s.name);
  const applicants = (b.candidates ?? []).length;
  const regCase = b.regCase?.status === 'notice';
  return { votes, raises, applicants, regCase };
}

/**
 * Whether a business may advertise now, and why: a storefront newly opened at this stage, or a strong Promote in a
 * week that has just closed. At most once in `AD_GAP_DAYS`. Only player businesses advertise.
 * @param {object} b
 * @param {object[]} closed - the digests of the weeks that just closed
 * @param {{lastDay?: number, storefronts?: number[]}} seen - this business's last advert and storefronts announced
 * @returns {'storefront'|'promote'|null}
 */
export function adReason(b, closed, seen, day) {
  if (b?.status !== 'open' || b.npcRun) return null;
  if (seen?.lastDay != null && day - seen.lastDay < AD_GAP_DAYS) return null;
  const front = (b.upgrades?.storefront ?? []).includes(b.stage) && !(seen?.storefronts ?? []).includes(b.stage);
  if (front) return 'storefront';
  const promoted = (closed ?? []).some((d) => (d.actions ?? []).some((a) => a.action === 'promote' && AD_BANDS.includes(a.band)));
  return promoted ? 'promote' : null;
}
