/**
 * Business window: the data each tab shows.
 * @file scripts/ui/Business/context.js
 */

import {
  ARCHETYPES, ACTION_IDS, partnerOf, holders, totalUnits, unitValue, shareOf, bookValue, drawAllowance, fundingShortfall,
  stateBands, lastDigest, weekdayOf, gearValue, rollSpec, BUSINESS_DEFAULTS,
  daysLeft, activeProject, expansionOffer, milestones, stepUpCheck, PROPOSAL_RULES, DISTRICTS, EVENTS, eventUses,
  openLoans, bankCheck, angelCheck, averageProfit, freeCash, CHARTER_PARTS, charterRollCheck, charterPaid, quoteRange, charterSector,
  actionIdsFor, reportCheck, canRun, officersOf, infoCheck,
  POST_IDS, POSTS, levelOf, postBase, goingRate, postOpen, recruitCheck, archetypeOf,
} from '../../engine/index.js';
import { MODULE_ID, SETTINGS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient, operatorRankOf, pendingBusinessRequests, investorActors, staffActors, jobsOf } from '../../services/BusinessClient.js';
import { SyndicateRepository } from '../../data/SyndicateRepository.js';
import { businessAccounts } from '../accounts.js';
import { MarketClock } from '../../services/MarketClockService.js';
import { L, whole, signed } from '../format.js';
import { weeklyBars, balanceLine } from '../components/chart.js';

const DAY_MS = 86_400_000;
const LEDGER_ROWS = 15;

/** A market day as a date, e.g. "2045-03-09". */
export const dayText = (day) => MarketClock.dateString(day * DAY_MS);

/** Each standing's bands, worst to best, so a week's band can be drawn as a level from 0 to 3. */
const BAND_LEVELS = {
  reputation: ['poor', 'modest', 'good', 'excellent'],
  capacity: ['cramped', 'room', 'busy', 'full'],
  costs: ['high', 'fair', 'lean', 'tight'],
  compliance: ['poor', 'shaky', 'sound', 'spotless'],
};

/**
 * The overview's charts, from the weekly digests the business keeps (the last 12): takings, upkeep
 * and profit by week, cash at each close, and each standing's band week by week. Only bands are
 * drawn for the standings, never the numbers behind them, as everywhere else in the window.
 */
function historyContext(business, bands) {
  const weeks = business.digests;
  const eb = (v) => `${whole(v)} eb`;
  const when = (d) => L('NCI.Business.WeekTo', { n: d.index, date: dayText(d.endDay) });
  const tip = (d) => `${when(d)}: ${L('NCI.Business.Takings')} ${eb(d.takings)}, ${L('NCI.Business.Upkeep')} ${eb(d.upkeep)}, ${L('NCI.Business.Profit')} ${eb(d.profit)}`;
  return {
    weeks: weeks.length,
    title: weeks.length ? L('NCI.Business.HistoryTitle', { n: weeks.length }) : '',
    revenue: weeks.length ? weeklyBars(weeks.map((d) => ({ takings: d.takings, upkeep: d.upkeep, profit: d.profit, tip: tip(d) })), {
      format: eb, labels: [when(weeks[0]), when(weeks.at(-1))],
    }) : '',
    cash: weeks.length > 1 ? balanceLine(weeks.map((d) => d.till), { format: eb, tips: weeks.map((d) => `${when(d)}: ${L('NCI.Business.Till')} ${eb(d.till)}`) }) : '',
    standings: Object.entries(bands).map(([key, band]) => ({
      // Capacity is how big the place is, not how well it is doing, so it is drawn on a neutral scale.
      neutral: key === 'capacity',
      label: L(`NCI.Business.State.${key}`),
      now: L(`NCI.Business.Band.${key}.${band}`),
      level: BAND_LEVELS[key]?.indexOf(band) ?? -1,
      // Oldest week on the left; the slots after the last week stay empty until later weeks fill them.
      cells: (() => {
        const filled = weeks.filter((d) => d.bands?.[key]).map((d) => ({
          level: BAND_LEVELS[key]?.indexOf(d.bands[key]) ?? -1,
          tip: `${when(d)}: ${L(`NCI.Business.Band.${key}.${d.bands[key]}`)}`,
        }));
        const empty = Math.max(0, BUSINESS_DEFAULTS.digestCap - filled.length);
        return [...filled, ...Array.from({ length: empty }, () => ({ level: -1, tip: '' }))];
      })(),
    })),
  };
}

const nameOf = (business, actorId) => partnerOf(business, actorId)?.name || (business.staff ?? []).find((s) => s.id === actorId)?.name || game.actors.get(actorId)?.name || '?';

/** Characters this user can act as: their own, or for a GM the player-owned ones (every character if none). */
export function usableActors() {
  const characters = game.actors.filter((a) => a.type === 'character');
  const usable = game.user.isGM ? characters.filter((a) => a.hasPlayerOwner) : characters.filter((a) => a.testUserPermission(game.user, 'OWNER'));
  return (game.user.isGM && !usable.length ? characters : usable).sort((a, b) => a.name.localeCompare(b.name));
}

/** Districts for the Start a business form, by name, after "none". */
export function districtOptions() {
  return [{ value: '', label: L('NCI.Business.NoDistrict') }, ...Object.keys(DISTRICTS)
    .map((id) => ({ value: id, label: L(`NCI.District.${id}`) }))
    .sort((a, b) => a.label.localeCompare(b.label))];
}

export function archetypeOptions() {
  return Object.keys(ARCHETYPES).map((id) => ({ value: id, label: L(`NCI.Business.Archetype.${id}.Name`), hint: L(`NCI.Business.Archetype.${id}.Hint`) }));
}

/** The header: which character, and which of their businesses. */
export function pickerContext(app) {
  // Characters, and the syndicates they are officers of (DESIGN §31, B3b).
  const actors = businessAccounts(usableActors());
  const actor = app.actor;
  const businesses = actor ? BusinessRepository.forActor(actor.id) : [];
  const requests = actor?.isSyndicate ? pendingBusinessRequests(actor.as).filter((r) => r.syndicateId === actor.id) : actor ? pendingBusinessRequests(actor) : [];
  return {
    actors: actors.map((a) => ({ id: a.id, name: a.name, selected: a.id === app.actorId })),
    businesses: businesses.map((b) => ({ id: b.id, label: `${b.name} (${L(`NCI.Business.Status.${b.status}`)})`, selected: b.id === app.businessId })),
    pending: requests.length,
    noGM: !game.users.activeGM,
    enabled: game.settings.get(MODULE_ID, SETTINGS.BUSINESSES_ENABLED) !== false,
  };
}

/** The Start a business form. */
export function startContext(app) {
  const actor = app.actor;
  const others = [
    ...game.actors.filter((a) => a.type === 'character' && a.id !== actor?.id && a.hasPlayerOwner),
    // A syndicate can be invited as a partner too.
    ...SyndicateRepository.all().filter((s) => s.status === 'active' && s.id !== actor?.id),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return {
    archetypes: archetypeOptions(),
    districts: districtOptions(),
    partners: others.map((a) => ({ id: a.id, name: a.name })),
    // A syndicate spends from its brokerage account.
    wealth: whole(actor?.isSyndicate ? freeCash(SyndicateRepository.portfolio(actor.id)) : actor?.system?.wealth?.value ?? 0),
    maxSweat: BUSINESS_DEFAULTS.maxSweatPct,
  };
}

/** Everything about one business, from one partner's point of view. */
export function businessContext(business, actor) {
  const me = actor ? partnerOf(business, actor.id) : null;
  const status = business.status;
  const bands = stateBands(business);
  const canAct = !!actor && BusinessClient.canAct(business, actor.id);
  return {
    id: business.id,
    name: business.name,
    archetype: L(`NCI.Business.Archetype.${business.archetype}.Name`),
    location: [business.district ? L(`NCI.District.${business.district}`) : '', business.location].filter(Boolean).join(', '),
    stage: L(`NCI.Business.Stage.${business.stage}`),
    status,
    statusLabel: L(`NCI.Business.Status.${status}`),
    isForming: status === 'forming',
    isPending: status === 'pending',
    isOpen: status === 'open',
    isClosed: status === 'closed',
    closed: status === 'closed' ? L(`NCI.Business.Closed.${business.closeReason ?? 'closed'}`, { date: dayText(business.closedDay ?? 0) }) : '',
    invited: me?.status === 'invited',
    offer: me?.status === 'invited' && me.offer ? L('NCI.Business.InvestOffer', { amount: whole(me.offer.amount), price: me.offer.price.toFixed(2), units: whole(Math.floor(me.offer.amount / me.offer.price)) }) : '',
    canAct,
    isPartner: !!me && ['active', 'leaving'].includes(me.status),
    bands: Object.entries(bands).map(([key, band]) => ({ label: L(`NCI.Business.State.${key}`), value: L(`NCI.Business.Band.${key}.${band}`) })),
    history: status === 'open' || status === 'closed' ? historyContext(business, bands) : null,
    till: whole(business.till),
    escrow: whole(business.escrow),
    assets: whole(business.assets),
    book: whole(bookValue(business)),
    myShare: me ? `${(shareOf(business, actor.id) * 100).toFixed(1)}%` : '',
    myValue: me ? whole(shareOf(business, actor.id) * bookValue(business)) : '',
    opened: business.openedDay != null ? dayText(business.openedDay) : '',
    forming: status === 'forming' ? formingContext(business, actor) : null,
    week: status === 'open' ? weekContext(business, actor, canAct) : null,
    ledger: ledgerContext(business, actor),
    partners: partnersContext(business, actor),
    projects: status === 'open' ? projectsContext(business, actor, canAct) : null,
    growth: status === 'open' ? growthContext(business, actor, canAct) : null,
    staff: status === 'open' ? staffContext(business, actor, canAct) : null,
    waitingVote: business.proposals.length ? L('NCI.Business.WaitingVote', { n: business.proposals.length }) : '',
  };
}

function projectsContext(business, actor, canAct) {
  const project = activeProject(business);
  const offer = expansionOffer(business);
  const pending = business.proposals.some((x) => x.kind === 'expansion');
  const left = actor ? daysLeft(business, actor.id) : 0;
  return {
    daysText: canAct ? L('NCI.Business.DaysLeft', { n: left }) : '',
    active: project ? {
      id: project.id,
      text: L('NCI.Business.ProjectProgress', { days: project.days, need: project.daysNeeded, gain: project.gain, date: dayText(project.startedDay) }),
      canAdd: canAct && left > 0,
      max: Math.min(left, project.daysNeeded - project.days),
    } : null,
    offer: !project && offer.ok ? L('NCI.Business.ExpansionOffer', { cost: whole(offer.cost), gain: offer.gain, days: offer.days }) : '',
    canPropose: canAct && !project && !pending && offer.ok,
    pending: pending ? L('NCI.Business.ExpansionPending') : '',
    blocked: !project && !offer.ok ? L(`NCI.Business.Reason.${offer.reason}`) : '',
    done: business.projects.filter((x) => x.status === 'done').reverse().map((x) => L('NCI.Business.ProjectDone', { gain: x.gain, date: dayText(x.doneDay ?? x.startedDay) })),
  };
}

function growthContext(business, actor, canAct) {
  const m = milestones(business);
  const day = BusinessClient.day();
  const check = actor ? stepUpCheck(business, actor.id, day) : null;
  const pending = business.proposals.some((x) => x.kind === 'stepUp');
  return {
    stage: L(`NCI.Business.Stage.${business.stage}`),
    next: m.to != null ? L(`NCI.Business.Stage.${m.to}`) : '',
    available: m.available,
    later: m.available ? '' : L('NCI.Business.NextStageLater'),
    items: m.items.map((x) => ({
      label: L(`NCI.Business.Milestone.${x.id}`, { need: whole(x.need) }),
      have: whole(x.have),
      met: x.met,
    })),
    canPropose: canAct && m.met && !business.stepUp?.approved && !pending,
    pending: pending ? L('NCI.Business.StepUpPending') : '',
    agreed: business.stepUp?.approved ? L('NCI.Business.StepUpAgreed') : '',
    retry: business.stepUp?.retryDay != null && day < business.stepUp.retryDay ? L('NCI.Business.StepUpRetry', { date: dayText(business.stepUp.retryDay) }) : '',
    canRoll: canAct && !!check?.ok,
    gains: m.available ? L(business.stage === 1 ? 'NCI.Charter.Gains' : 'NCI.Business.RegisterGains') : '',
    charter: business.stage === 1 ? charterContext(business, actor, canAct, m, pending) : null,
  };
}

/** The charter, for a registered business (DESIGN §32): agreeing, the three rolls, the GM, the funding. */
function charterContext(business, actor, canAct, m, pending) {
  const c = business.charter;
  const day = BusinessClient.day();
  const status = c?.status ?? 'none';
  const { kmin, kmax } = quoteRange(business);
  const parts = CHARTER_PARTS.map((part) => {
    const r = c?.rolls?.[part] ?? c?.kept?.[part];
    const spec = actor && status === 'rolling' ? charterRollCheck(business, actor.id, part) : null;
    return {
      part,
      label: L(`NCI.Charter.Part.${part}`),
      result: r ? L(r.success ? 'NCI.Charter.Passed' : 'NCI.Charter.Failed', { band: L(`NCI.Roll.Band.${r.band}`) }) : L('NCI.Charter.NotRolled'),
      done: !!r,
      canRoll: canAct && !!spec?.ok,
    };
  });
  const delay = c?.retryDay != null && day < c.retryDay;
  return {
    sector: L(`NCI.Sector.${charterSector(business)}`),
    range: L('NCI.Charter.Range', { min: whole(kmin), max: whole(kmax) }),
    canPropose: canAct && m.met && !pending && ['none', 'failed'].includes(status) && !delay,
    isRolling: status === 'rolling',
    isAwaiting: status === 'awaiting',
    isFunding: status === 'funding',
    parts: status === 'rolling' || status === 'awaiting' || status === 'funding' ? parts : [],
    ticker: c?.ticker ?? '',
    agreed: status === 'rolling' ? L('NCI.Charter.Agreed', { ticker: c.ticker }) : '',
    awaiting: status === 'awaiting' ? L('NCI.Charter.Awaiting', { quote: whole(c.quote), assets: whole(c.netAssets), shortfall: whole(c.shortfall) }) : '',
    funding: status === 'funding' ? L('NCI.Charter.Funding', {
      paid: whole(charterPaid(business)), shortfall: whole(c.shortfall), date: dayText(c.fundingEnds), max: whole(Math.round(c.shortfall * (1 + BUSINESS_DEFAULTS.charter.extraShare))),
    }) : '',
    canFund: status === 'funding' && !!actor && partnerOf(business, actor.id)?.status === 'active',
    refused: status === 'failed' ? L(c.reason === 'rejected' ? 'NCI.Charter.Rejected' : c.reason === 'lapsed' ? 'NCI.Charter.Lapsed' : 'NCI.Charter.Refused', { date: dayText(c.retryDay ?? day) }) : '',
    kept: status === 'failed' && Object.keys(c.kept ?? {}).length
      ? L('NCI.Charter.Kept', { parts: Object.keys(c.kept).map((k) => L(`NCI.Charter.Part.${k}`)).join(', ') })
      : '',
  };
}

function formingContext(business, actor) {
  const shortfall = fundingShortfall(business);
  const setup = business.setup;
  const me = actor ? partnerOf(business, actor.id) : null;
  const waiting = business.partners.filter((p) => p.status === 'invited').map((p) => p.name);
  const spec = actor ? rollSpec(business, { type: 'setupRoll' }, actor.id, { day: BusinessClient.day(), operatorRank: operatorRankOf(business) }) : null;
  const [min, max] = ARCHETYPES[business.archetype].setup;
  return {
    setupRange: L('NCI.Business.SetupRange', { min: whole(min), max: whole(max) }),
    passed: !!setup?.passed,
    setup: setup?.passed
      ? L('NCI.Business.SetupPassed', { band: L(`NCI.Roll.Band.${setup.band}`), cost: whole(setup.cost), capacity: setup.capacity })
      : setup ? L('NCI.Business.SetupFailed', { band: L(`NCI.Roll.Band.${setup.band}`), date: dayText(setup.retryDay) }) : '',
    shortfall: shortfall > 0 ? L('NCI.Business.Shortfall', { amount: whole(shortfall) }) : '',
    waiting: waiting.length ? L('NCI.Business.WaitingFor', { names: waiting.join(', ') }) : '',
    canRoll: !!spec?.ok,
    rollBlocked: spec && !spec.ok && me?.status === 'active' ? L(`NCI.Business.Reason.${spec.reason}`) : '',
    canContribute: me?.status === 'active',
  };
}

function weekContext(business, actor, canAct) {
  const period = business.period;
  const slots = BUSINESS_DEFAULTS.stages[business.stage]?.slots ?? 1;
  const taken = new Map(period.slots.map((s) => [s.action, s]));
  const helped = actor ? period.helpers.includes(actor.id) : true;
  const free = period.slots.length < slots;
  // A company is run by its officers; any holder may still help.
  const runs = canAct && canRun(business, actor.id);
  return {
    from: dayText(period.startDay),
    to: dayText(period.endDay),
    closesOn: L(`NCI.Weekday.${weekdayOf(period.endDay)}`),
    slotsText: L('NCI.Business.SlotsUsed', { used: period.slots.length, total: slots }),
    daysText: canAct ? L('NCI.Business.DaysLeft', { n: daysLeft(business, actor.id) }) : '',
    // A chartered company has the five company actions; a smaller business the shop actions.
    actions: actionIdsFor(business.stage).map((id) => {
      const slot = taken.get(id);
      const bonus = period.bonuses.some((b) => b.action === id && !b.used);
      return {
        id,
        name: L(`NCI.Business.Action.${id}.Name`),
        hint: L(`NCI.Business.Action.${id}.Hint`),
        taken: slot ? L('NCI.Business.TakenBy', { name: nameOf(business, slot.by), band: L(`NCI.Roll.Band.${slot.band}`) }) : '',
        bonus: bonus ? L('NCI.Business.BonusWaiting') : '',
        canRoll: runs && free && !slot,
        canHelp: canAct && !helped && !slot,
      };
    }),
    helped: actor && helped && canAct ? L('NCI.Business.AlreadyHelped') : '',
    event: eventContext(business, runs, free),
    report: business.stage >= 2 ? {
      text: L('NCI.Company.ReportWeek', { n: (business.reportWeeks ?? 0) + 1, of: BUSINESS_DEFAULTS.report.weeks }),
      prepared: business.reportPrep ? L(business.reportPrep.bold ? 'NCI.Company.PreparedBold' : 'NCI.Company.Prepared', { band: L(`NCI.Roll.Band.${business.reportPrep.band}`) }) : '',
      canPrepare: runs && reportCheck(business).ok,
    } : null,
    notOfficer: business.stage >= 2 && canAct && !runs ? L('NCI.Company.NotOfficer') : '',
    info: business.stage >= 2 ? infoContext(business, runs) : null,
    unworkedNote: L('NCI.Business.UnworkedNote'),
  };
}

/** A company's information rolls: the last internal audit, and what due diligence has found (B4c). */
function infoContext(business, runs) {
  const day = BusinessClient.day();
  const audit = business.lastAudit;
  const cost = BUSINESS_DEFAULTS.info;
  return {
    audit: audit
      ? (audit.exposure ? L('NCI.Company.AuditResult', { date: dayText(audit.day), band: L(`NCI.Company.Exposure.${audit.exposure}`) }) : L('NCI.Company.AuditFailed', { date: dayText(audit.day) }))
      : L('NCI.Company.NoAudit'),
    canAudit: runs && infoCheck(business, 'audit', day).ok,
    auditHint: L('NCI.Company.AuditHint', { cost: whole(cost.auditCost) }),
    canDiligence: runs && infoCheck(business, 'diligence', day).ok,
    diligenceHint: L('NCI.Company.DiligenceHint', { cost: whole(cost.diligenceCost) }),
    intel: [...(business.intel ?? [])].reverse().map((x) => ({
      name: x.name,
      date: dayText(x.day),
      found: x.bands
        ? L('NCI.Company.IntelFound', {
          bands: Object.entries(x.bands).map(([k, v]) => `${L(`NCI.Business.State.${k}`)} ${L(`NCI.Business.Band.${k}.${v}`)}`).join(', '),
          low: whole(x.range[0]), high: whole(x.range[1]),
        })
        : L('NCI.Company.IntelNothing'),
    })),
  };
}

/** This week's event, if there is one, and whether it can still be answered. */
function eventContext(business, canAct, free) {
  const event = business.period.event;
  if (!event || !EVENTS[event.kind]) return null;
  const def = EVENTS[event.kind];
  const answer = business.period.slots.find((s) => s.action === 'respond');
  const uses = eventUses(business, event.kind).map((u) => (u.kind === 'ability' ? u.ability : u.skill) + (u.dvAdd ? ` (DV +${u.dvAdd})` : ''));
  return {
    name: L(`NCI.Event.${event.kind}.Name`),
    hint: L(`NCI.Event.${event.kind}.Hint`),
    good: !!def.good,
    uses: L('NCI.Business.AnswerWith', { skills: uses.join(', ') }),
    answered: answer ? L('NCI.Business.TakenBy', { name: nameOf(business, answer.by), band: L(`NCI.Roll.Band.${answer.band}`) }) : '',
    security: def.security ? L('NCI.Business.SecurityNote') : '',
    canAnswer: canAct && free && !answer,
    ifNot: def.good ? L('NCI.Business.WindfallIfNot') : L('NCI.Business.EventIfNot'),
  };
}

function ledgerContext(business, actor) {
  const last = lastDigest(business);
  const allowance = actor ? drawAllowance(business, actor.id) : 0;
  return {
    last: last ? digestRow(business, last) : null,
    digests: [...business.digests].reverse().map((d) => digestRow(business, d)),
    entries: [...business.ledger].reverse().slice(0, LEDGER_ROWS).map((e) => ({
      date: dayText(e.day),
      what: L(`NCI.Business.Ledger.${e.kind}${e.gear > 0 ? 'Gear' : ''}`, { name: e.actorId ? nameOf(business, e.actorId) : '', staff: e.staffName ?? '', seller: e.sellerId ? nameOf(business, e.sellerId) : '', price: whole(e.price ?? 0), salvage: whole(e.salvage ?? 0), gear: whole(e.gear ?? 0) }),
      amount: e.amount ? signed(e.amount) : '',
      cls: e.amount > 0 ? 'nci-up' : e.amount < 0 ? 'nci-down' : '',
    })),
    allowance,
    allowanceText: allowance > 0 ? L('NCI.Business.DrawAllowance', { amount: whole(allowance) }) : L('NCI.Business.NoDraw'),
    canDraw: business.status === 'open' && allowance > 0,
    canTopUp: business.status === 'open' && (actor ? partnerOf(business, actor.id)?.status === 'active' : false),
    money: business.status === 'open' ? moneyContext(business, actor) : null,
    reports: business.stage >= 2 ? [...business.reports].reverse().map((r) => ({
      index: r.index,
      when: L('NCI.Company.ReportSpan', { from: dayText(r.fromDay), to: dayText(r.toDay) }),
      takings: whole(r.takings),
      upkeep: whole(r.upkeep),
      profit: signed(r.profit),
      reported: signed(r.reported),
      prep: r.prep ? L(r.prep.bold ? 'NCI.Company.PreparedBold' : 'NCI.Company.Prepared', { band: L(`NCI.Roll.Band.${r.prep.band}`) }) : L('NCI.Company.Standard'),
      cls: r.profit >= 0 ? 'nci-up' : 'nci-down',
    })) : null,
  };
}

/** Loans: those running, and what the partners can ask for. */
function moneyContext(business, actor) {
  const canAct = !!actor && BusinessClient.canAct(business, actor.id);
  const day = BusinessClient.day();
  const f = BUSINESS_DEFAULTS.loans.fixer;
  const limit = f.limits[Math.min(business.stage, f.limits.length - 1)];
  const loans = openLoans(business);
  const pending = (kind) => business.proposals.some((x) => x.kind === kind);
  const bank = actor ? bankCheck(business, actor.id, day) : null;
  const registered = business.stage >= BUSINESS_DEFAULTS.loans.bank.minStage;
  return {
    loans: loans.map((l) => ({
      id: l.id,
      text: L(`NCI.Business.Loan.${l.kind}`, { balance: whole(l.balance), rate: (l.rate * 100).toFixed(1), payment: whole(l.payment) }),
      missed: l.missed ? L('NCI.Business.LoanMissed', { n: l.missed }) : '',
      canRepay: canAct && business.till > 0,
      max: Math.min(l.balance, business.till),
    })),
    fixerText: L('NCI.Business.FixerTerms', { limit: whole(limit), rate: f.rate * 100, weeks: f.weeks }),
    canFixer: canAct && !loans.some((l) => l.kind === 'fixer') && !pending('fixerLoan'),
    fixerLimit: limit,
    bankText: registered
      ? L('NCI.Business.BankTerms', { profit: whole(averageProfit(business)) })
      : L('NCI.Business.BankLater'),
    canProposeBank: canAct && registered && !business.approved.bankLoan && !loans.some((l) => l.kind === 'bank') && !pending('bankLoan'),
    canRollBank: canAct && !!bank?.ok,
    bankRetry: business.retry.bankLoan != null && day < business.retry.bankLoan ? L('NCI.Business.BankRetry', { date: dayText(business.retry.bankLoan) }) : '',
    pending: ['fixerLoan', 'bankLoan'].some(pending) ? L('NCI.Business.LoanPending') : '',
  };
}

function digestRow(business, d) {
  return {
    week: L('NCI.Business.Week', { n: d.index }),
    dates: `${dayText(d.startDay)} – ${dayText(d.endDay)}`,
    takings: whole(d.takings),
    upkeep: whole(d.upkeep),
    profit: signed(d.profit),
    cls: d.profit > 0 ? 'nci-up' : d.profit < 0 ? 'nci-down' : 'nci-flat',
    till: whole(d.till),
    actions: d.actions.length
      ? d.actions.map((a) => L('NCI.Business.DigestAction', { action: L(a.action === 'respond' ? 'NCI.Business.Answer' : `NCI.Business.Action.${a.action}.Name`), name: nameOf(business, a.by), band: L(`NCI.Roll.Band.${a.band}`) })).join('; ')
      : L('NCI.Business.NoActions'),
    event: d.event ? L(`NCI.Business.EventOutcome.${d.event.outcome}`, { event: L(`NCI.Event.${d.event.kind}.Name`), change: signed(d.event.change) }) : '',
    gig: d.boost ? L('NCI.Business.DigestGig', { pct: signed(Math.round(d.boost * 100)) }) : '',
    wages: d.wages || d.owed ? L(d.owed ? 'NCI.Staff.DigestOwed' : 'NCI.Staff.DigestWages', { wages: whole(d.wages ?? 0), owed: whole(d.owed ?? 0) }) : '',
    loans: d.interest || d.repaid || d.missed?.length
      ? [L('NCI.Business.DigestLoans', { interest: whole(d.interest ?? 0), repaid: whole(d.repaid ?? 0) }), ...(d.missed ?? []).map((k) => L(`NCI.Business.DigestMissed.${k}`))].join(' ')
      : '',
  };
}

/** Investors: a character the partners invite, and an NPC angel found and pitched. */
function investorsContext(business, actor, canAct) {
  const registered = business.stage >= BUSINESS_DEFAULTS.investors.minStage;
  const day = BusinessClient.day();
  const pending = (kind) => business.proposals.some((x) => x.kind === kind);
  const angel = business.approved.angel;
  const check = actor ? angelCheck(business, actor.id, day) : null;
  const taken = new Set(business.partners.filter((x) => ['invited', 'active', 'leaving'].includes(x.status)).map((x) => x.actorId));
  return {
    registered,
    later: registered ? '' : L('NCI.Business.InvestorsLater'),
    candidates: investorActors().filter((a) => !taken.has(a.id)).sort((a, b) => a.name.localeCompare(b.name)).map((a) => ({ value: a.id, label: a.name })),
    bookPrice: unitValue(business).toFixed(2),
    canInvite: canAct && registered && !pending('investor'),
    canSeekAngel: canAct && registered && !angel && !pending('angel'),
    angel: angel ? L('NCI.Business.AngelFound', { name: angel.name, total: angel.total }) : '',
    canPitch: canAct && !!check?.ok,
    angelRetry: business.retry.angel != null && day < business.retry.angel ? L('NCI.Business.AngelRetry', { date: dayText(business.retry.angel) }) : '',
    holders: business.partners.filter((x) => x.npc).map((x) => x.name).join(', '),
  };
}

/** A post's name and what it does. */
const postLabel = (post) => L(`NCI.Staff.Post.${post}`);

/**
 * The Staff tab (DESIGN §33): the employees, the candidates recruiting found, and what the partners
 * can do: recruit for a post, hire a candidate or a character, let someone go.
 */
function staffContext(business, actor, canAct) {
  const day = BusinessClient.day();
  const arch = archetypeOf(business);
  const runs = canAct && canRun(business, actor.id);
  const pending = (kind) => business.proposals.some((x) => x.kind === kind);
  const max = BUSINESS_DEFAULTS.staff.headcount[business.stage] ?? 0;
  const staff = business.staff ?? [];
  const posts = POST_IDS.filter((id) => POSTS[id].stage <= business.stage);
  const open = posts.filter((id) => postOpen(business, id).ok);
  const recruit = open.length ? recruitCheck(business, open[0], day) : null;
  const taken = new Set([...business.partners.filter((x) => ['invited', 'active', 'leaving'].includes(x.status)).map((x) => x.actorId), ...staff.map((s) => s.actorId)]);
  const cost = BUSINESS_DEFAULTS.staff.recruit.cost[business.stage];
  return {
    headcount: L('NCI.Staff.Headcount', { n: staff.length, max }),
    rows: staff.map((s) => {
      const base = postBase(s, s.post, arch);
      return {
        id: s.id,
        name: s.name,
        source: L(`NCI.Staff.Source.${s.source}`),
        post: postLabel(s.post),
        level: L(`NCI.Staff.Level.${levelOf(base)}`),
        base,
        wage: whole(s.wage),
        status: s.status === 'offered' ? L(s.source === 'npc' ? 'NCI.Staff.OfferedNpc' : 'NCI.Staff.Offered') : L('NCI.Staff.Since', { date: dayText(s.hiredDay ?? day) }),
        owed: s.owed ? L('NCI.Staff.Owed', { amount: whole(s.owed) }) : '',
        canFire: canAct && !pending('fire'),
      };
    }),
    candidates: (business.candidates ?? []).filter((c) => c.expires >= day).map((c) => ({
      id: c.id,
      name: c.name,
      post: postLabel(c.post),
      level: L(`NCI.Staff.Level.${c.level}`),
      base: c.base,
      rate: whole(goingRate(c.base, business.stage)),
      expires: dayText(c.expires),
      canHire: canAct && !pending('hire') && postOpen(business, c.post).ok,
    })),
    // A character dragged from the Actors directory onto an open post proposes hiring them for it.
    posts: posts.map((id) => ({
      value: id,
      label: postLabel(id),
      hint: L(`NCI.Staff.PostHint.${id}`),
      open: open.includes(id),
      droppable: canAct && !pending('hire') && open.includes(id),
      holders: staff.filter((s) => s.post === id).map((s) => s.name).join(', '),
    })),
    openPosts: open.map((id) => ({ value: id, label: postLabel(id) })),
    canRecruit: runs && !!recruit?.ok,
    recruitText: L('NCI.Staff.RecruitHint', { cost: whole(cost) }),
    recruitBlocked: runs && open.length && recruit && !recruit.ok ? L(`NCI.Business.Reason.${recruit.reason}`) : !open.length ? L('NCI.Staff.NoOpenPost') : '',
    people: staffActors().filter((a) => !taken.has(a.id)).sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ value: a.id, label: `${a.name}${a.source === 'npc' ? ` (${L('NCI.Staff.Source.npc')})` : ''}` })),
    canHireActor: canAct && !pending('hire') && open.length > 0,
    canDrop: canAct && !pending('hire') && open.length > 0,
    rateText: L('NCI.Staff.RateHint', { rate: BUSINESS_DEFAULTS.staff.rate[business.stage] }),
    pending: pending('hire') || pending('fire') ? L('NCI.Staff.Pending') : '',
  };
}

/** The jobs a character holds or is offered, as the GM mirrored them onto the character. */
export function jobsContext(actor) {
  if (!actor || actor.isSyndicate) return [];
  return jobsOf(actor).map((j) => ({
    businessId: j.businessId,
    name: j.businessName,
    archetype: L(`NCI.Business.Archetype.${j.archetype}.Name`),
    post: postLabel(j.post),
    wage: whole(j.wage),
    offered: j.status === 'offered',
    since: j.hiredDay != null ? dayText(j.hiredDay) : '',
    owed: j.owed ? L('NCI.Staff.Owed', { amount: whole(j.owed) }) : '',
  }));
}

function partnersContext(business, actor) {
  const units = totalUnits(business);
  const value = unitValue(business);
  const me = actor ? partnerOf(business, actor.id) : null;
  const canAct = !!actor && BusinessClient.canAct(business, actor.id);
  const open = business.status === 'open';
  const characters = game.actors.filter((a) => a.type === 'character' && a.id !== actor?.id);
  const sweat = business.agreement.sweat;
  return {
    rows: business.partners.filter((p) => p.status !== 'declined').map((p) => ({
      actorId: p.actorId,
      name: p.name,
      status: L(`NCI.Business.PartnerStatus.${p.status}`),
      units: business.status === 'forming' ? '' : whole(p.units),
      share: units > 0 && ['active', 'leaving'].includes(p.status) ? `${((p.units / units) * 100).toFixed(1)}%` : '',
      put: L('NCI.Business.PutIn', { cash: whole(p.cash), gear: whole(gearValue(p)) }),
      gear: p.gear.map((g) => `${g.name} (${whole(g.value)})`).join(', '),
      voting: p.voting ? '' : L('NCI.Business.NonVoting'),
      heir: p.heirId ? L('NCI.Business.HeirIs', { name: game.actors.get(p.heirId)?.name ?? p.heirId }) : '',
      leaving: p.status === 'leaving' ? L('NCI.Business.LeavingSince', { date: dayText((p.leavingSince ?? 0) + business.agreement.buyoutDays) }) : '',
      buyout: p.status === 'leaving' && open && canAct && p.actorId !== actor?.id ? L('NCI.Business.BuyFor', { price: whole(Math.round(p.units * value)) }) : '',
      // A company's officers, and electing or dismissing one by a majority of the shares (B4c).
      officer: business.stage >= 2 && officersOf(business).includes(p.actorId) ? L('NCI.Company.Officer') : '',
      canElect: business.stage >= 2 && canAct && open && p.status === 'active' && p.voting && !officersOf(business).includes(p.actorId)
        && !business.proposals.some((x) => x.kind === 'elect'),
      canDismiss: business.stage >= 2 && canAct && open && officersOf(business).includes(p.actorId) && officersOf(business).length > 1
        && !business.proposals.some((x) => x.kind === 'dismiss'),
    })),
    unitValue: units > 0 ? value.toFixed(2) : '',
    isCompany: business.stage >= 2,
    agreement: [
      sweat ? L('NCI.Business.Agreement.sweat', { name: nameOf(business, sweat.actorId), pct: sweat.pct }) : L('NCI.Business.Agreement.noSweat'),
      L('NCI.Business.Agreement.decision'),
      L('NCI.Business.Agreement.buyout', { days: business.agreement.buyoutDays }),
    ],
    heirOptions: [{ value: '', label: L('NCI.Business.NoHeir') }, ...characters.map((a) => ({ value: a.id, label: a.name }))]
      .map((o) => ({ ...o, selected: o.value === (me?.heirId ?? '') })),
    canSetHeir: !!me && ['active', 'leaving', 'invited'].includes(me.status),
    canLeave: open && me?.status === 'active' && holders(business).length > 1,
    canPropose: open && canAct && !business.proposals.some((x) => x.kind === 'close'),
    investors: open ? investorsContext(business, actor, canAct) : null,
    proposals: business.proposals.map((proposal) => ({
      id: proposal.id,
      text: L(`NCI.Business.Proposed.${proposal.kind}`, {
        name: nameOf(business, proposal.by),
        // Who a hire or a firing is about, and the post (DESIGN §33).
        who: proposal.terms?.name ?? '',
        post: proposal.terms?.post ? postLabel(proposal.terms.post) : '',
      }),
      rule: L(`NCI.Business.Rule.${PROPOSAL_RULES[proposal.kind]}`, { date: dayText(proposal.expires ?? proposal.day) }),
      votes: holders(business).filter((p) => p.voting).map((p) => `${p.name}: ${L(`NCI.Business.Vote.${proposal.votes[p.actorId] === true ? 'yes' : proposal.votes[p.actorId] === false ? 'no' : 'none'}`)}`).join(', '),
      canVote: !!me?.voting && ['active', 'leaving'].includes(me.status) && proposal.votes[actor.id] === undefined,
    })),
  };
}
