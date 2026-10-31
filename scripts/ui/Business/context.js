/**
 * Business window: the data each tab shows.
 * @file scripts/ui/Business/context.js
 */

import {
  ARCHETYPES, ACTION_IDS, partnerOf, holders, totalUnits, unitValue, shareOf, bookValue, drawAllowance, fundingShortfall,
  stateBands, lastDigest, gearValue, rollSpec, BUSINESS_DEFAULTS,
  daysLeft, activeProject, milestones, stepUpCheck, PROPOSAL_RULES, DISTRICTS, EVENTS, eventUses,
  projectOffer, PROJECT_KINDS, upgradesOf, protectionFactor, headcountOf,
  openLoans, bankCheck, angelCheck, averageProfit, freeCash, CHARTER_PARTS, charterRollCheck, charterPaid, quoteRange, charterSector,
  actionIdsFor, reportCheck, canRun, officersOf, infoCheck,
  POST_IDS, POSTS, levelOf, postBest, staffBase, goingRate, askingWage, postOpen, recruitCheck, archetypeOf,
  hasLoyalty, loyaltyBand, staffOf, vetCheck, bonusCheck, wageOf, postBase, trainingSkill, trainCheck, useKey, asksFor, askCheck, grantedShare, holderActorId, teamCheck, teamSize, teamOf, ABILITIES,
  sectorMultiple, floatOptions, PROSPECTUS_PARTS, prospectusCheck, payoutRatio,
} from '../../engine/index.js';
import { SkillAdapter } from '../../services/SkillAdapter.js';
import { MODULE_ID, SETTINGS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient, operatorRankOf, pendingBusinessRequests, investorActors, staffActors, jobsOf } from '../../services/BusinessClient.js';
import { SyndicateRepository } from '../../data/SyndicateRepository.js';
import { businessAccounts } from '../accounts.js';
import { MarketClock } from '../../services/MarketClockService.js';
import { L, whole, signed } from '../format.js';
import { weeklyBars, balanceLine } from '../components/chart.js';
import { actorLink } from '../actorLink.js';
import { isCharacter } from '../../utils/helpers.js';

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
 * Language keys with a company wording (the same key plus `Company`): from chartering on, the owners
 * are shareholders holding shares, not partners holding units. The record still calls them units.
 */
const COMPANY_TERMS = new Set([
  'NCI.Business.Tab.partners', 'NCI.Business.CapTable', 'NCI.Business.Partner', 'NCI.Business.Units', 'NCI.Business.UnitValue',
  'NCI.Business.PartnerStatus.active', 'NCI.Business.Agreement.decision', 'NCI.Business.Agreement.buyout', 'NCI.Business.HeirHint',
  'NCI.Business.LeaveConfirm', 'NCI.Business.CloseConfirm', 'NCI.Business.DecisionsHint', 'NCI.Business.InvestPrice',
  'NCI.Business.InvestOffer', 'NCI.Business.AngelIntro', 'NCI.Business.Rule.unanimous', 'NCI.Business.Rule.majority',
  'NCI.Business.WaitingVote', 'NCI.Business.LoanPending', 'NCI.Business.NoDraw', 'NCI.Business.TopUpHint', 'NCI.Business.HelpHint',
  'NCI.Business.BonusWaiting', 'NCI.Business.FixerTerms', 'NCI.Business.BankTerms', 'NCI.Business.Closed.closed', 'NCI.Project.Intro',
]);

/** A language key in the wording for this business's stage: shareholders and shares for a company and beyond. */
export const termKey = (business, key) => (business?.stage >= 2 && COMPANY_TERMS.has(key) ? `${key}Company` : key);

/** Localise in the wording for this business's stage (see termKey). */
export const LT = (business, key, data) => L(termKey(business, key), data);

/** The words for a step-up proposal by the stage it is made at: registering, chartering, listing. */
const STEP_UP_KEYS = Object.freeze(['stepUp', 'stepUpCharter', 'stepUpList']);

/**
 * The overview's charts, from the weekly digests the business keeps (the last 12): takings, upkeep
 * and profit by week, cash at each close, and each standing's band week by week. Only bands are
 * drawn for the standings, never the numbers behind them, as everywhere else in the window.
 */
function historyContext(business, bands) {
  const weeks = business.digests;
  const eb = (v) => `${whole(v)} eb`;
  const when = (d) => L('NCI.Business.WeekTo', { n: d.index, date: dayText(d.endDay) });
  const tip = (d) => L('NCI.Business.ChartTip', { week: when(d), takings: whole(d.takings), costs: whole(weekCosts(d)), profit: signed(d.profit) });
  const cashTip = (d, i) => {
    const m = weekMoney(weeks, i);
    return m.other == null
      ? `${when(d)}: ${L('NCI.Business.Till')} ${eb(d.till)}`
      : L('NCI.Business.CashTip', { week: when(d), till: whole(d.till), opening: whole(m.opening), takings: whole(d.takings), upkeep: whole(d.upkeep), wages: whole(m.wages), other: signed(m.other) });
  };
  return {
    weeks: weeks.length,
    title: weeks.length ? L('NCI.Business.HistoryTitle', { n: weeks.length }) : '',
    revenue: weeks.length ? weeklyBars(weeks.map((d) => ({ takings: d.takings, upkeep: weekCosts(d), profit: d.profit, tip: tip(d) })), {
      format: eb, labels: [when(weeks[0]), when(weeks.at(-1))],
    }) : '',
    cash: weeks.length > 1 ? balanceLine(weeks.map((d) => d.till), { format: eb, tips: weeks.map(cashTip) }) : '',
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
  const characters = game.actors.filter((a) => isCharacter(a));
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
    ...game.actors.filter((a) => isCharacter(a) && a.id !== actor?.id && a.hasPlayerOwner),
    // A syndicate can be invited as a partner too.
    ...SyndicateRepository.all().filter((s) => s.status === 'active' && s.id !== actor?.id),
  ].sort((a, b) => a.name.localeCompare(b.name));
  return {
    archetypes: archetypeOptions(),
    districts: districtOptions(),
    partners: others.map((a) => ({ id: a.id, name: a.name, who: actorLink(a.id, a.name) })),
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
    // A listed company shows as stage 3, though it runs on stage 2's numbers (B5b).
    stage: L(`NCI.Business.Stage.${business.listing?.status === 'listed' ? 3 : business.stage}`),
    // The company's ticker once the charter set it, listed or not (B4).
    ticker: business.company?.ticker ?? '',
    // Once its offering is on the market, the company can be opened on the terminal (B5c).
    onMarket: ['scheduled', 'listed'].includes(business.listing?.status) && !!business.company?.ticker,
    status,
    statusLabel: L(`NCI.Business.Status.${status}`),
    isForming: status === 'forming',
    isPending: status === 'pending',
    isOpen: status === 'open',
    isClosed: status === 'closed',
    closed: status === 'closed' ? LT(business, `NCI.Business.Closed.${business.closeReason ?? 'closed'}`, { date: dayText(business.closedDay ?? 0) }) : '',
    invited: me?.status === 'invited',
    offer: me?.status === 'invited' && me.offer ? LT(business, 'NCI.Business.InvestOffer', { amount: whole(me.offer.amount), price: me.offer.price.toFixed(2), units: whole(Math.floor(me.offer.amount / me.offer.price)) }) : '',
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
    ledger: ledgerContext(business, actor, canAct),
    partners: partnersContext(business, actor),
    projects: status === 'open' ? projectsContext(business, actor, canAct) : null,
    growth: status === 'open' ? growthContext(business, actor, canAct) : null,
    staff: status === 'open' ? staffContext(business, actor, canAct) : null,
    terms: Object.fromEntries(['CapTable', 'Partner', 'Units', 'HeirHint', 'DecisionsHint', 'AngelIntro', 'TopUpHint', 'HelpHint']
      .map((k) => [k, LT(business, `NCI.Business.${k}`)]).concat([['ProjectIntro', LT(business, 'NCI.Project.Intro')]])),
    waitingVote: business.proposals.length ? LT(business, 'NCI.Business.WaitingVote', { n: business.proposals.length }) : '',
  };
}

/** What a project of each kind does, from where the business stands now. */
function projectEffect(business, kind) {
  const P = BUSINESS_DEFAULTS.projects;
  const up = upgradesOf(business);
  const cap = BUSINESS_DEFAULTS.stages[business.stage]?.capacityCap ?? business.state.capacity;
  const offer = projectOffer(business, kind);
  switch (kind) {
    case 'expansion': {
      const gain = offer.gain ?? BUSINESS_DEFAULTS.stages[business.stage]?.expansion?.gain ?? 0;
      return L('NCI.Project.Effect.expansion', { now: business.state.capacity.toFixed(2), after: Math.min(cap, business.state.capacity + gain).toFixed(2), cap: cap.toFixed(2) });
    }
    case 'refit':
      return L('NCI.Project.Effect.refit', { now: business.state.costFactor.toFixed(3), after: Math.max(BUSINESS_DEFAULTS.costFloor, business.state.costFactor - P.refit.cut).toFixed(3) });
    case 'security':
      return L(up.security ? 'NCI.Project.Effect.security' : 'NCI.Project.Effect.securityNone', { level: up.security, max: P.security.levels, cut: Math.round((1 - protectionFactor(business)) * 100) });
    case 'storefront':
      return L(up.storefront.length ? 'NCI.Project.Effect.storefrontAgain' : 'NCI.Project.Effect.storefront', { rep: P.storefront.reputation, target: 50 + P.storefront.target });
    case 'staffRoom':
      return L('NCI.Project.Effect.staffRoom', { places: headcountOf(business), cap: P.staffRoom.paidCap });
    default:
      return '';
  }
}

/** Why a project cannot start, in words and, for money, in figures. */
function projectBlock(business, offer) {
  if (offer.reason === 'no-funds') return L('NCI.Project.NeedsCash', { cost: whole(offer.cost), till: whole(business.till) });
  return L(`NCI.Business.Reason.${offer.reason}`);
}

/**
 * The Projects tab: the business days a partner has left this week (in the table's header), the
 * project under way with its progress and who has worked on it, every kind of project with what it
 * would do, cost and take (each proposed from its own row), Capacity against the stage's ceiling, and
 * the projects finished.
 */
function projectsContext(business, actor, canAct) {
  const project = activeProject(business);
  const pending = business.proposals.some((x) => x.kind === 'project' || x.kind === 'expansion');
  const left = actor ? daysLeft(business, actor.id) : 0;
  const total = BUSINESS_DEFAULTS.businessDays;
  const stage = BUSINESS_DEFAULTS.stages[business.stage];
  const cap = stage?.capacityCap ?? business.state.capacity;
  const gain = stage?.expansion?.gain ?? 0;
  const pct = (v) => Math.max(0, Math.min(100, (v / cap) * 100)).toFixed(1);
  const crew = (p) => Object.entries(p.crew ?? {}).map(([id, n]) => `${nameOf(business, id)} ${n}`).join(', ');
  const name = (kind) => L(`NCI.Project.Kind.${kind}`);
  return {
    daysFree: canAct ? L('NCI.Project.DaysFree', { free: left, total }) : '',
    noDays: canAct && left <= 0,
    capacity: {
      text: L('NCI.Project.Capacity', { now: business.state.capacity.toFixed(2), cap: cap.toFixed(2) }),
      now: pct(business.state.capacity),
      next: pct(Math.min(cap - business.state.capacity, gain)),
      nextText: business.state.capacity < cap - 1e-6 ? L('NCI.Project.CapacityNext', { gain }) : L('NCI.Project.CapacityFull'),
    },
    active: project ? {
      id: project.id,
      name: name(project.kind),
      started: L('NCI.Project.Started', { date: dayText(project.startedDay), cost: whole(project.cost ?? 0) }),
      progress: L('NCI.Project.Progress', { days: project.days, need: project.daysNeeded }),
      pct: Math.round((project.days / Math.max(1, project.daysNeeded)) * 100),
      crew: crew(project) ? L('NCI.Project.Crew', { crew: crew(project) }) : L('NCI.Project.NoCrew'),
      effect: projectEffect(business, project.kind),
      canAdd: canAct && left > 0,
      max: Math.max(1, Math.min(left, project.daysNeeded - project.days)),
    } : null,
    kinds: PROJECT_KINDS.map((kind) => {
      const offer = projectOffer(business, kind);
      const def = kind === 'expansion' ? stage?.expansion : BUSINESS_DEFAULTS.projects[kind];
      const cost = offer.cost ?? (kind === 'expansion' ? def?.cost : def?.cost[business.stage]) ?? 0;
      const days = offer.days ?? (kind === 'expansion' ? def?.days : def?.days[business.stage]) ?? 0;
      return {
        kind,
        name: name(kind),
        hint: L(`NCI.Project.Hint.${kind}`),
        effect: projectEffect(business, kind),
        cost: whole(cost),
        days,
        canPropose: canAct && !pending && offer.ok,
        // Nothing more to say while one is running: the row above says so.
        blocked: offer.ok || offer.reason === 'project-running' ? '' : projectBlock(business, offer),
      };
    }),
    running: project ? L('NCI.Project.OneAtATime') : '',
    pending: pending ? L('NCI.Project.Pending') : '',
    done: business.projects.filter((x) => x.status === 'done').reverse().map((x) => ({
      name: name(x.kind ?? 'expansion'),
      done: dayText(x.doneDay ?? x.startedDay),
      started: dayText(x.startedDay),
      cost: x.cost != null ? whole(x.cost) : '',
      days: x.daysNeeded ?? '',
      result: L(`NCI.Project.Result.${x.kind ?? 'expansion'}`, { gain: x.gain ?? '' }),
      crew: crew(x),
    })),
  };
}

function growthContext(business, actor, canAct) {
  const threshold = Number(game.settings.get(MODULE_ID, SETTINGS.LISTING_THRESHOLD)) || BUSINESS_DEFAULTS.listing.threshold;
  const m = milestones(business, undefined, { day: BusinessClient.day(), threshold });
  const day = BusinessClient.day();
  const check = actor ? stepUpCheck(business, actor.id, day) : null;
  const pending = business.proposals.some((x) => x.kind === 'stepUp');
  return {
    stage: L(`NCI.Business.Stage.${business.stage}`),
    next: m.to != null ? L(`NCI.Business.Stage.${m.to}`) : '',
    available: m.available,
    later: m.available ? '' : L('NCI.Business.NextStageLater'),
    items: m.items.map((x) => ({
      label: L(`NCI.Business.Milestone.${x.id}`, { need: whole(x.need ?? 0) }),
      have: x.have == null ? '' : whole(x.have),
      met: x.met,
    })),
    // Registering is stage 0's step; the charter (stage 1) and the listing (stage 2) have their own.
    canPropose: business.stage === 0 && canAct && m.met && !business.stepUp?.approved && !pending,
    pending: pending ? L(`NCI.Business.${{ 0: 'StepUpPending', 1: 'StepUpPendingCharter', 2: 'StepUpPendingList' }[business.stage] ?? 'StepUpPending'}`) : '',
    agreed: business.stage === 0 && business.stepUp?.approved ? L('NCI.Business.StepUpAgreed') : '',
    retry: business.stepUp?.retryDay != null && day < business.stepUp.retryDay ? L('NCI.Business.StepUpRetry', { date: dayText(business.stepUp.retryDay) }) : '',
    canRoll: business.stage === 0 && canAct && !!check?.ok,
    gains: m.available ? L(business.stage === 2 ? 'NCI.Listing.Gains' : business.stage === 1 ? 'NCI.Charter.Gains' : 'NCI.Business.RegisterGains', { multiple: business.stage === 2 ? sectorMultiple(business) : '', sector: business.stage === 2 ? L(`NCI.Sector.${charterSector(business)}`) : '', ticker: business.company?.ticker ?? '' }) : '',
    charter: business.stage === 1 ? charterContext(business, actor, canAct, m, pending) : null,
    listing: business.stage === 2 ? listingContext(business, actor, canAct, m, pending) : null,
  };
}

/** Going public, for a chartered company (B5a): V, agreeing (the float), the GM, the prospectus rolls, the offer. */
function listingContext(business, actor, canAct, m, pending) {
  const l = business.listing;
  const day = BusinessClient.day();
  const status = l?.status ?? 'none';
  const runs = canAct && canRun(business, actor.id);
  const pct = (x) => Math.round(x * 100);
  const parts = PROSPECTUS_PARTS.map((part) => {
    const r = l?.rolls?.[part];
    return {
      part, label: L(`NCI.Listing.Part.${part}`),
      result: r ? L(r.success ? 'NCI.Charter.Passed' : 'NCI.Charter.Failed', { band: L(`NCI.Roll.Band.${r.band}`) }) : L('NCI.Charter.NotRolled'),
      canRoll: runs && status === 'prospectus' && prospectusCheck(business, part).ok,
    };
  });
  const delay = l?.retryDay != null && day < l.retryDay;
  return {
    valuation: L('NCI.Listing.Valuation', { v: whole(m.valuation ?? 0), multiple: sectorMultiple(business) }),
    history: (business.reports ?? []).slice(-3).filter((r) => r.valuation != null).map((r) => L('NCI.Listing.ReportV', { n: r.index, v: whole(r.valuation) })).join(' · '),
    floats: floatOptions().map((f) => ({ value: f, label: `${pct(f)}%` })),
    canPropose: canAct && m.met && !pending && ['none', 'failed', 'rejected'].includes(status) && !delay,
    feeText: L('NCI.Listing.Fee', { fee: whole(m.fee ?? 0) }),
    awaiting: status === 'awaiting' ? L('NCI.Listing.Awaiting', { float: pct(l.float), fee: whole(l.fee) }) : '',
    prospectus: status === 'prospectus' ? L('NCI.Listing.Prospectus') : '',
    parts: ['prospectus', 'ready', 'failed'].includes(status) && Object.keys(l.rolls ?? {}).length + (status === 'prospectus' ? 1 : 0) ? parts : [],
    ready: status === 'ready' ? L('NCI.Listing.Ready', { price: l.offer.price.toLocaleString(), shares: whole(l.offer.shares), float: pct(l.offer.float) }) : '',
    scheduled: status === 'scheduled' ? L('NCI.Listing.Scheduled', { ticker: business.company?.ticker ?? '', price: l.offer.price.toLocaleString(), shares: whole(l.offer.shares), date: dayText(l.listDay ?? day) }) : '',
    listed: status === 'listed' ? L('NCI.Listing.Listed', { ticker: business.company?.ticker ?? '', date: dayText(l.listedDay ?? day), price: l.offer.price.toLocaleString(), until: dayText((l.listedDay ?? day) + BUSINESS_DEFAULTS.listing.lockupDays) }) : '',
    refused: status === 'failed' ? L('NCI.Listing.Failed', { date: dayText(l.retryDay ?? day) }) : status === 'rejected' ? L('NCI.Listing.Rejected', { date: dayText(l.retryDay ?? day) }) : '',
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
    awaiting: status === 'awaiting' ? L(c.shortfall > 0 ? 'NCI.Charter.Awaiting' : 'NCI.Charter.AwaitingCovered', { quote: whole(c.quote), assets: whole(c.netAssets), shortfall: whole(c.shortfall) }) : '',
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
    closesOn: MarketClock.weekdayName(period.endDay),
    // Slots still free this week out of the stage's total, in the actions table's header.
    slotsFree: L('NCI.Business.SlotsFree', { free: Math.max(0, slots - period.slots.length), total: slots }),
    noSlots: period.slots.length >= slots,
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
        bonus: bonus ? LT(business, 'NCI.Business.BonusWaiting') : '',
        canRoll: runs && free && !slot,
        canHelp: canAct && !helped && !slot,
      };
    }),
    helped: actor && helped && canAct ? L('NCI.Business.AlreadyHelped') : '',
    event: eventContext(business, runs, free),
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
      ? (audit.exposure
        // A strong audit says what it found as well as what it left, after clearing some of it up.
        ? L(audit.found ? 'NCI.Company.AuditCleared' : 'NCI.Company.AuditResult', {
          date: dayText(audit.day), band: L(`NCI.Company.Exposure.${audit.exposure}`), found: audit.found ? L(`NCI.Company.Exposure.${audit.found}`) : '',
        })
        : L('NCI.Company.AuditFailed', { date: dayText(audit.day) }))
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
    // A staff event names the employee it is about (E2).
    hint: L(`NCI.Event.${event.kind}.Hint`, { name: event.staffId ? staffOf(business, event.staffId)?.name ?? '' : '' }),
    good: !!def.good,
    uses: L('NCI.Business.AnswerWith', { skills: uses.join(', ') }),
    answered: answer ? L('NCI.Business.TakenBy', { name: nameOf(business, answer.by), band: L(`NCI.Roll.Band.${answer.band}`) }) : '',
    security: def.security ? L('NCI.Business.SecurityNote') : '',
    canAnswer: canAct && free && !answer,
    ifNot: def.staff ? L(`NCI.Event.${event.kind}.IfNot`, { name: event.staffId ? staffOf(business, event.staffId)?.name ?? '' : '' }) : def.good ? L('NCI.Business.WindfallIfNot') : L('NCI.Business.EventIfNot'),
  };
}

/** One ledger entry in words, with its amount. */
function ledgerLine(business, e) {
  return {
    date: dayText(e.day),
    what: L(`NCI.Business.Ledger.${e.kind}${e.gear > 0 ? 'Gear' : ''}`, { name: e.actorId ? nameOf(business, e.actorId) : '', staff: e.staffName ?? '', project: e.project ? L(`NCI.Project.Kind.${e.project}`) : '', seller: e.sellerId ? nameOf(business, e.sellerId) : '', price: whole(e.price ?? 0), salvage: whole(e.salvage ?? 0), gear: whole(e.gear ?? 0) }),
    amount: e.amount ? signed(e.amount) : '',
    cls: e.amount > 0 ? 'nci-up' : e.amount < 0 ? 'nci-down' : '',
  };
}

/** Everything a week's profit takes off its takings: the upkeep, a staff event's bills, wages and loan interest. */
const weekCosts = (d) => d.upkeep + (d.event?.cost ?? 0) + (d.wages ?? 0) + (d.interest ?? 0);

/**
 * A week's cash, accounted for: the cash it started with (kept on the digest since it was recorded, or
 * the week before's close), the wages paid out of the cash, and everything else in or out (`other`):
 * event bills, loan interest and repayments, draws, top-ups, overtime, adverts, bonuses. The opening,
 * plus the takings, less the upkeep and wages, plus the other, is the cash at the close. `other` is
 * null when the opening is not known (the oldest week kept, closed before openings were recorded).
 */
function weekMoney(digests, i) {
  const d = digests[i];
  const opening = d.opening ?? digests[i - 1]?.till ?? null;
  const wages = d.paid ?? d.wages ?? 0;
  return { opening, wages, other: opening == null ? null : d.till - opening - d.takings + d.upkeep + wages };
}

/** Ledger entries the week's close writes; the cashbook shows them from the digest instead. */
const AT_CLOSE = new Set(['takings', 'upkeep', 'wages', 'medical']);
/** Entries made while the business was being set up, into the money held for it rather than its cash. */
const FORMING = new Set(['founded', 'contribution', 'setupLoss', 'refund']);

/**
 * The cashbook for one closed week: the income and expenses that make up its profit (the takings, the
 * week's event, the upkeep by part, medical bills, wages, loan interest), the loan repaid, and every
 * other payment in or out of the cash that week (overtime, hired help, adverts, bonuses, draws,
 * top-ups and the like), which do not count in the profit. A week closed before the digest kept the
 * upkeep's parts shows the upkeep as one line.
 */
export function cashbookContext(business, index) {
  const at = business.digests.findLastIndex((x) => x.index === index);
  const d = business.digests[at];
  if (!d) return { business: business.name, week: L('NCI.Business.Week', { n: index }), gone: L('NCI.Cashbook.Gone') };
  const row = digestRow(business, d, at);
  const line = (label, amount, note = '') => ({ label, note, amount: signed(amount), cls: amount > 0 ? 'nci-up' : amount < 0 ? 'nci-down' : '' });
  const change = d.event?.change ?? 0;
  const gross = d.gross ?? d.takings - change;
  const event = change ? line(L(`NCI.Event.${d.event.kind}.Name`), change, L(`NCI.Cashbook.Outcome.${d.event.outcome}`)) : null;
  // A windfall is income; what trouble cost is an expense.
  const income = [line(L('NCI.Cashbook.Takings'), gross, d.boost ? row.gig : ''), ...(change > 0 ? [event] : [])];
  const upkeep = d.costs
    ? ['running', 'rent', 'licence', 'protection'].filter((k) => d.costs[k]).map((k) => line(L(`NCI.Cashbook.Cost.${k}`), -d.costs[k]))
    : [line(L('NCI.Business.Upkeep'), -d.upkeep)];
  const expenses = [
    ...(change < 0 ? [event] : []),
    ...upkeep,
    ...(d.event?.cost ? [line(L('NCI.Cashbook.Medical'), -d.event.cost, L(`NCI.Event.${d.event.kind}.Name`))] : []),
    ...(d.wages ? [line(L('NCI.Cashbook.Wages'), -d.wages, d.owed ? L('NCI.Cashbook.Owed', { owed: whole(d.owed) }) : '')] : []),
    ...(d.interest ? [line(L('NCI.Cashbook.Interest'), -d.interest)] : []),
  ];
  const totalIn = gross + Math.max(change, 0);
  const totalOut = Math.max(-change, 0) + d.upkeep + (d.event?.cost ?? 0) + (d.wages ?? 0) + (d.interest ?? 0);
  // An entry made before entries were marked with their week is placed by its date (setting-up entries left out).
  const inWeek = (e) => (e.week != null ? e.week === d.index : e.day >= d.startDay && e.day <= d.endDay && !FORMING.has(e.kind));
  const others = business.ledger.filter((e) => inWeek(e) && !AT_CLOSE.has(e.kind) && e.amount);
  // Whatever moved the cash that the ledger no longer lists (an old week, or entries since trimmed), so the page still adds up.
  const money = weekMoney(business.digests, at);
  const listed = (d.event?.cost ?? 0) + (d.interest ?? 0) + (d.repaid ?? 0);
  const unlisted = money.other == null ? 0 : money.other + listed - others.reduce((a, e) => a + e.amount, 0);
  return {
    business: business.name,
    week: row.week,
    dates: row.dates,
    activity: [row.actions, row.event, row.people, row.loans].filter(Boolean),
    income,
    expenses,
    totalIn: signed(totalIn),
    totalOut: signed(-totalOut),
    profit: row.profit,
    profitCls: row.cls,
    repaid: d.repaid ? signed(-d.repaid) : '',
    other: others.map((e) => ledgerLine(business, e)),
    opening: row.opening,
    unlisted: unlisted ? signed(unlisted) : '',
    // Wages counted in the profit but not yet paid from the cash (+), or back pay paid this week (−).
    wageGap: (d.wages ?? 0) !== money.wages ? signed((d.wages ?? 0) - money.wages) : '',
    till: row.till,
  };
}

/**
 * One published monthly report, in detail: the real figures beside the reported ones (preparing a report
 * shifts only its profit), how it was prepared, and the weeks it sums while the digests still keep them.
 */
export function reportContext(business, index) {
  const r = (business.reports ?? []).find((x) => x.index === index);
  const title = L('NCI.Report.Heading', { n: index });
  if (!r) return { business: business.name, title, gone: L('NCI.Report.Gone') };
  const cls = (v) => (v > 0 ? 'nci-up' : v < 0 ? 'nci-down' : '');
  const row = (label, a, b = a, total = false) => ({ label, total, real: a || 0, reported: b || 0 });
  const line = ({ label, total, real, reported }) => ({
    label, total, real: signed(real), cls: cls(real), reported: signed(reported), reportedCls: cls(reported),
    diff: reported === real ? '–' : signed(reported - real), diffCls: cls(reported - real),
  });
  // Wages, loan interest and a staff event's bills: what the profit took off besides the upkeep.
  const otherCosts = r.takings - r.upkeep - r.profit;
  const prep = r.prep;
  const pct = r.profit ? Math.round(((r.reported - r.profit) / Math.abs(r.profit)) * 100) : 0;
  const weeks = business.digests.filter((d) => d.startDay >= r.fromDay && d.endDay <= r.toDay);
  return {
    business: business.name,
    title,
    dates: `${L('NCI.Company.ReportSpan', { from: dayText(r.fromDay), to: dayText(r.toDay) })} · ${L('NCI.Report.WeekCount', { n: r.weeks })}`,
    prepared: prep
      ? L(prep.bold ? 'NCI.Report.PreparedBold' : 'NCI.Report.Prepared', { name: nameOf(business, prep.by), band: L(`NCI.Roll.Band.${prep.band}`), total: prep.total ?? '', pct: signed(pct) })
      : L('NCI.Report.Standard'),
    trail: prep?.bold ? L('NCI.Report.Trail') : '',
    valuation: r.valuation != null ? L('NCI.Report.Valuation', { v: whole(r.valuation) }) : '',
    dividend: r.dividend ? L('NCI.Report.Dividend', { perShare: r.dividend.perShare.toLocaleString(), paid: whole(r.dividend.paid) }) : '',
    figures: [
      row(L('NCI.Business.Takings'), r.takings),
      row(L('NCI.Business.Upkeep'), -r.upkeep),
      row(L('NCI.Report.OtherCosts'), -otherCosts),
      row(L('NCI.Business.Profit'), r.profit, r.reported, true),
    ].map(line),
    weeks: weeks.map((d) => {
      const other = d.upkeep - weekCosts(d);
      return {
        week: L('NCI.Business.Week', { n: d.index }), dates: `${dayText(d.startDay)} – ${dayText(d.endDay)}`,
        takings: signed(d.takings), upkeep: signed(-d.upkeep), other: signed(other), otherCls: cls(other), profit: signed(d.profit), cls: cls(d.profit),
      };
    }),
    missing: weeks.length < r.weeks ? L('NCI.Report.Missing', { n: r.weeks - weeks.length }) : '',
  };
}

function ledgerContext(business, actor, canAct = false) {
  const last = lastDigest(business);
  const allowance = actor ? drawAllowance(business, actor.id) : 0;
  return {
    // A company's monthly report: how far into the month it is, and preparing it in the last week (B4b).
    // A listed company's dividends (B5c): the payout ratio, and proposing another.
    dividends: business.listing?.status === 'listed' ? {
      text: L('NCI.Dividend.Policy', { pct: Math.round(payoutRatio(business) * 100), yield: BUSINESS_DEFAULTS.listing.dividend.monthlyYield * 100, cap: whole(BUSINESS_DEFAULTS.listing.dividend.holderCap) }),
      options: Array.from({ length: 11 }, (_, i) => ({ value: i * 10, label: `${i * 10}%`, selected: i * 10 === Math.round(payoutRatio(business) * 100) })),
      canPropose: canAct && !business.proposals.some((x) => x.kind === 'payout'),
      pending: business.proposals.some((x) => x.kind === 'payout') ? L('NCI.Dividend.Pending') : '',
    } : null,
    report: business.stage >= 2 && business.status === 'open' ? {
      text: L('NCI.Company.ReportWeek', { n: (business.reportWeeks ?? 0) + 1, of: BUSINESS_DEFAULTS.report.weeks }),
      prepared: business.reportPrep ? L(business.reportPrep.bold ? 'NCI.Company.PreparedBold' : 'NCI.Company.Prepared', { band: L(`NCI.Roll.Band.${business.reportPrep.band}`) }) : '',
      canPrepare: canAct && canRun(business, actor.id) && reportCheck(business).ok,
    } : null,
    last: last ? digestRow(business, last, business.digests.length - 1) : null,
    digests: business.digests.map((d, i) => digestRow(business, d, i)).reverse(),
    entries: [...business.ledger].reverse().slice(0, LEDGER_ROWS).map((e) => ledgerLine(business, e)),
    allowance,
    allowanceText: allowance > 0 ? L('NCI.Business.DrawAllowance', { amount: whole(allowance) }) : LT(business, 'NCI.Business.NoDraw'),
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
    fixerText: LT(business, 'NCI.Business.FixerTerms', { limit: whole(limit), rate: f.rate * 100, weeks: f.weeks }),
    canFixer: canAct && !loans.some((l) => l.kind === 'fixer') && !pending('fixerLoan'),
    fixerLimit: limit,
    bankText: registered
      ? LT(business, 'NCI.Business.BankTerms', { profit: whole(averageProfit(business)) })
      : L('NCI.Business.BankLater'),
    canProposeBank: canAct && registered && !business.approved.bankLoan && !loans.some((l) => l.kind === 'bank') && !pending('bankLoan'),
    canRollBank: canAct && !!bank?.ok,
    bankRetry: business.retry.bankLoan != null && day < business.retry.bankLoan ? L('NCI.Business.BankRetry', { date: dayText(business.retry.bankLoan) }) : '',
    pending: ['fixerLoan', 'bankLoan'].some(pending) ? LT(business, 'NCI.Business.LoanPending') : '',
  };
}

/** One weekly digest for the Ledger tab and the cashbook; `i` is where it sits among the digests kept. */
function digestRow(business, d, i) {
  const money = weekMoney(business.digests, i);
  return {
    index: d.index,
    week: L('NCI.Business.Week', { n: d.index }),
    dates: `${dayText(d.startDay)} – ${dayText(d.endDay)}`,
    // Signed, as their effect on the cash: money in up, money out down.
    takings: signed(d.takings),
    takingsCls: d.takings > 0 ? 'nci-up' : '',
    upkeep: signed(-d.upkeep),
    upkeepCls: d.upkeep > 0 ? 'nci-down' : '',
    paidWages: money.wages ? signed(-money.wages) : '–',
    wagesCls: money.wages > 0 ? 'nci-down' : '',
    other: money.other == null ? '–' : signed(money.other),
    otherCls: money.other > 0 ? 'nci-up' : money.other < 0 ? 'nci-down' : '',
    opening: money.opening == null ? '' : whole(money.opening),
    profit: signed(d.profit),
    cls: d.profit > 0 ? 'nci-up' : d.profit < 0 ? 'nci-down' : 'nci-flat',
    till: whole(d.till),
    actions: d.actions.length
      ? d.actions.map((a) => L('NCI.Business.DigestAction', { action: L(a.action === 'respond' ? 'NCI.Business.Answer' : `NCI.Business.Action.${a.action}.Name`), name: nameOf(business, a.by), band: L(`NCI.Roll.Band.${a.band}`) })).join('; ')
      : L('NCI.Business.NoActions'),
    event: d.event ? L(`NCI.Business.EventOutcome.${d.event.outcome}`, { event: L(`NCI.Event.${d.event.kind}.Name`), change: signed(d.event.change) })
      + (d.event.cost ? ` ${L('NCI.Staff.DigestMedical', { cost: whole(d.event.cost) })}` : '') : '',
    // What happened to the staff: someone off sick, hurt, poached, caught, quitting, asking for a raise (E2).
    people: (d.staff ?? []).map((n) => L(`NCI.Staff.Note.${n.kind}`, { name: n.name, rival: n.rival ?? '' })).join(' '),
    gig: d.boost ? L('NCI.Business.DigestGig', { pct: signed(Math.round(d.boost * 100)) }) : '',
    // The wages have their own column; the note is only for what is still owed.
    wages: d.owed ? L('NCI.Staff.DigestOwed', { wages: whole(d.wages ?? 0), owed: whole(d.owed ?? 0) }) : '',
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
    priceLabel: LT(business, 'NCI.Business.InvestPrice', { price: unitValue(business).toFixed(2) }),
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

/** The skill an employee's post counts, and what it comes to: "Paramedic", "Medicine (rank 4)", "Cybertech, a level lower". */
function skillOf(staff, post, arch) {
  const best = postBest(staff, post, arch);
  if (!best.use) return { skill: '—', base: best.base };
  const skill = best.use.kind === 'ability'
    ? L('NCI.Staff.SkillAbility', { name: best.use.ability, rank: staffBase(staff, best.use) })
    : best.adj ? L('NCI.Staff.SkillLower', { name: best.use.skill }) : best.use.skill;
  return { skill, base: best.base };
}

/** What the partners know of someone's trait: what vetting (or catching a thief) showed. */
const traitText = (revealed) => (revealed ? L(`NCI.Staff.Trait.${revealed}`) : '');

/**
 * Applicants still waiting, by post, with what they ask (they are hired on it) and what vetting
 * showed. Until a strong vetting roll shows their exact skill, the partners see their level and their
 * ask as a share of the going rate; then the base and the eb. Each post's applicants can be vetted
 * together, once.
 */
function applicantsOf(business, { canAct, runs, pending }) {
  const day = BusinessClient.day();
  const waiting = (business.candidates ?? []).filter((c) => c.expires >= day);
  return [...new Set(waiting.map((c) => c.post))].map((post) => {
    const vet = vetCheck(business, post, day);
    return {
      post,
      label: postLabel(post),
      canVet: runs && vet.ok,
      vetText: L('NCI.Staff.VetHint', { cost: whole(BUSINESS_DEFAULTS.staff.vet.cost), dv: BUSINESS_DEFAULTS.staff.vet.dv }),
      people: waiting.filter((c) => c.post === post).map((c) => {
        const full = c.vetted === 'full';
        return {
          id: c.id,
          name: c.name,
          level: L(`NCI.Staff.Level.${c.level}`),
          base: full ? c.base : '',
          terms: full
            ? L('NCI.Staff.ApplicantTerms', { wage: whole(askingWage(business, c)), pct: Math.round((c.pct ?? 1) * 100), rate: whole(goingRate(c.base, business.stage)), date: dayText(c.expires) })
            : L('NCI.Staff.ApplicantAsks', { pct: Math.round((c.pct ?? 1) * 100), date: dayText(c.expires) }),
          vetted: c.vetted === 'failed' ? L('NCI.Staff.VetFailed') : c.revealed ? L('NCI.Staff.VetShows', { trait: traitText(c.revealed) }) : L('NCI.Staff.NotVetted'),
          bad: !!c.revealed && c.revealed !== 'none' && !BUSINESS_DEFAULTS.staff.traits.good.includes(c.revealed),
          canHire: canAct && !pending && postOpen(business, c.post).ok,
          canReject: runs,
        };
      }),
    };
  });
}

/** What the partners should know about an employee at a glance: a trait, a thief caught, someone hurt, a raise asked for. */
function staffNotes(business, s) {
  return [
    s.revealed && s.revealed !== 'none' ? traitText(s.revealed) : '',
    s.caught ? L('NCI.Staff.Caught') : '',
    s.outUntil != null && s.outUntil >= business.period.index ? L('NCI.Staff.Hurt') : '',
    s.ask ? L('NCI.Staff.Asks', { pct: Math.round(s.ask.pct * 100) }) : '',
    // Once the business has run into it (a two-jobs event), it knows they work for another business too (E3).
    s.knownElsewhere && s.elsewhere ? L('NCI.Staff.AlsoWorks', { name: s.elsewhere.name }) : '',
    // Shares granted (E3).
    s.grant ? L('NCI.Staff.GrantVesting', { pct: (Math.round(s.grant.share * 1000) / 10).toLocaleString(), date: dayText(s.grant.vestDay) }) : '',
    s.vested ? L('NCI.Staff.GrantVested', { pct: (Math.round(s.vested * 1000) / 10).toLocaleString() }) : '',
  ].filter(Boolean);
}

/** Loyalty as the partners see it: a band, or nothing for a player character. */
const loyaltyText = (s) => (hasLoyalty(s) && s.status === 'active' ? L(`NCI.Staff.Loyalty.${loyaltyBand(s.loyalty ?? 50)}`) : '');

/**
 * The Staff tab (DESIGN §33): the employees, the posts (each with a Hire button that opens the Hire
 * window, and a drop target for a character dragged from the Actors directory), and the applicants
 * waiting from an advert.
 */
function staffContext(business, actor, canAct) {
  const day = BusinessClient.day();
  const arch = archetypeOf(business);
  const pending = (kind) => business.proposals.some((x) => x.kind === kind);
  const max = headcountOf(business);
  const staff = business.staff ?? [];
  const posts = POST_IDS.filter((id) => POSTS[id].stage <= business.stage);
  const open = posts.filter((id) => postOpen(business, id).ok);
  const canHire = canAct && !pending('hire');
  return {
    // Places still free out of the stage's headcount, in the staff table's header.
    openRoles: L('NCI.Staff.OpenRoles', { free: Math.max(0, max - staff.length), max }),
    noRoles: staff.length >= max,
    rows: staff.map((s) => {
      const { skill, base } = skillOf(s, s.post, arch);
      return {
        id: s.id,
        name: s.name,
        who: actorLink(s.actorId, s.name),
        source: L(`NCI.Staff.Source.${s.source}`),
        post: postLabel(s.post),
        level: L(`NCI.Staff.Level.${levelOf(base)}`),
        skill,
        base,
        wage: s.source === 'team' ? L('NCI.Staff.Unpaid') : whole(s.wage),
        status: s.status === 'offered' ? L(s.source === 'npc' ? 'NCI.Staff.OfferedNpc' : 'NCI.Staff.Offered') : L('NCI.Staff.Since', { date: dayText(s.hiredDay ?? day) }),
        owed: s.owed ? L('NCI.Staff.Owed', { amount: whole(s.owed) }) : '',
        loyalty: loyaltyText(s),
        loyaltyBand: hasLoyalty(s) ? loyaltyBand(s.loyalty ?? 50) : '',
        notes: staffNotes(business, s),
        canManage: canAct && s.status === 'active',
        canFire: canAct && s.status === 'offered' && !pending('fire'),
      };
    }),
    applicants: applicantsOf(business, { canAct, runs: canAct && !!actor && canRun(business, actor.id), pending: pending('hire') }),
    posts: posts.map((id) => ({
      value: id,
      label: postLabel(id),
      hint: L(`NCI.Staff.PostHint.${id}`),
      canHire: canHire && open.includes(id),
    })),
    recruitText: L('NCI.Staff.RecruitHint', { cost: whole(BUSINESS_DEFAULTS.staff.recruit.cost[business.stage]), rate: BUSINESS_DEFAULTS.staff.rate[business.stage] }),
    noOpen: open.length ? '' : L('NCI.Staff.NoOpenPost'),
    pending: pending('hire') || pending('fire') ? L('NCI.Staff.Pending') : '',
  };
}

/**
 * The Hire window for one post: hiring a character, or advertising the job (a roll whose result
 * brings one to three applicants, listed on the Staff tab).
 * @param {object} account - the picked account (a character, or a syndicate as one of its officers)
 */
export function hireContext(business, account, post) {
  const day = BusinessClient.day();
  const canAct = !!account && BusinessClient.canAct(business, account.id) && !(account.isSyndicate && !account.isOfficer);
  const pending = business.proposals.some((x) => x.kind === 'hire');
  const open = postOpen(business, post);
  const advert = recruitCheck(business, post, day);
  const runs = canAct && canRun(business, account.id);
  const taken = new Set([...business.partners.filter((x) => ['invited', 'active', 'leaving'].includes(x.status)).map((x) => x.actorId), ...(business.staff ?? []).map((s) => s.actorId)]);
  return {
    business: business.name,
    post: postLabel(post),
    hint: L(`NCI.Staff.PostHint.${post}`),
    rateText: L('NCI.Staff.RateHint', { rate: BUSINESS_DEFAULTS.staff.rate[business.stage] }),
    blocked: !open.ok ? L(`NCI.Business.Reason.${open.reason}`) : !canAct ? L('NCI.Staff.CannotHire') : '',
    pending: pending ? L('NCI.Staff.Pending') : '',
    canHire: open.ok && canAct && !pending,
    people: staffActors().filter((a) => !taken.has(a.id)).sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ value: a.id, label: `${a.name}${a.source === 'npc' ? ` (${L('NCI.Staff.Source.npc')})` : ''}` })),
    advertText: L('NCI.Staff.AdvertiseHint', { cost: whole(BUSINESS_DEFAULTS.staff.recruit.cost[business.stage]) }),
    canAdvertise: runs && advert.ok && !pending,
    advertBlocked: open.ok && canAct && !advert.ok ? L(`NCI.Business.Reason.${advert.reason}`) : open.ok && canAct && !runs ? L('NCI.Company.NotOfficer') : '',
    team: teamContext(business, account, post, runs),
  };
}

/**
 * An Exec's team, in a role's Hire window (E3): shown to a partner with Teamwork, with the members they
 * have, the room left, and the level their rank gives; adding one names them (a name is offered).
 */
function teamContext(business, account, post, runs) {
  const actor = account && !account.isSyndicate ? game.actors.get(account.id) : null;
  const rank = actor ? SkillAdapter.baseFor(actor, ABILITIES.teamwork).base : 0;
  if (!(rank > 0)) return null;
  const can = teamCheck(business, actor.id, post, rank);
  const size = teamSize(rank);
  const members = teamOf(business, actor.id);
  const first = BUSINESS_DEFAULTS.staff.recruit.firstNames;
  const last = BUSINESS_DEFAULTS.staff.recruit.lastNames;
  const n = members.length + (business.staff ?? []).length;
  return {
    text: L('NCI.Staff.TeamHint', { rank, size }),
    have: L('NCI.Staff.TeamHave', { n: members.length, size, names: members.map((m) => m.name).join(', ') || '—' }),
    level: can.ok ? L('NCI.Staff.TeamLevel', { level: L(`NCI.Staff.Level.${levelOf(can.base)}`), base: can.base }) : '',
    blocked: !can.ok && can.reason !== 'no-teamwork' ? L(`NCI.Business.Reason.${can.reason}`) : !runs ? L('NCI.Company.NotOfficer') : '',
    suggested: `${first[(n * 7 + rank) % first.length]} ${last[(n * 11 + 3) % last.length]}`,
    canAdd: runs && can.ok,
  };
}

/**
 * The Employee window for one employee (E2): their pay and any raise they asked for, a bonus, moving
 * them to another post, and letting them go. Changing pay and firing are proposals; a bonus, a move
 * and refusing a raise are day-to-day running, for whoever runs the business.
 * @param {object} account - the picked account (a character, or a syndicate as one of its officers)
 */
export function employeeContext(business, account, staffId) {
  const s = staffOf(business, staffId);
  if (!s) return { name: '', blocked: L('NCI.Business.Reason.not-staff') };
  const arch = archetypeOf(business);
  const canAct = !!account && BusinessClient.canAct(business, account.id) && !(account.isSyndicate && !account.isOfficer) && s.status === 'active';
  const runs = canAct && canRun(business, account.id);
  const pending = (kind) => business.proposals.some((x) => x.kind === kind);
  const rate = goingRate(postBase(s, s.post, arch), business.stage);
  const { skill, base } = skillOf(s, s.post, arch);
  const bonus = bonusCheck(business, s.id, 1);
  const given = (business.period.staffBonus ?? {})[s.id];
  const moves = POST_IDS.filter((id) => id !== s.post && POSTS[id].stage <= business.stage && postOpen(business, id, undefined, s.id).ok);
  const severance = s.caught ? 0 : wageOf(business, s);
  return {
    business: business.name,
    name: s.name,
    who: actorLink(s.actorId, s.name),
    source: L(`NCI.Staff.Source.${s.source}`),
    post: postLabel(s.post),
    level: L(`NCI.Staff.Level.${levelOf(base)}`),
    skill,
    base,
    loyalty: loyaltyText(s),
    loyaltyBand: hasLoyalty(s) ? loyaltyBand(s.loyalty ?? 50) : '',
    loyaltyHint: hasLoyalty(s) ? L('NCI.Staff.LoyaltyHint') : L('NCI.Staff.LoyaltyPc'),
    notes: staffNotes(business, s),
    payText: s.source === 'team'
      ? L('NCI.Staff.TeamPay', { name: nameOf(business, s.leader) })
      : L('NCI.Staff.PayNow', { wage: whole(wageOf(business, s)), pct: Math.round(s.pct * 100), rate: whole(rate) }),
    pct: Math.round(s.pct * 100),
    canPay: canAct && !pending('pay') && s.source !== 'team',
    ask: s.ask ? L('NCI.Staff.AskText', { pct: Math.round(s.ask.pct * 100), wage: whole(Math.round(rate * s.ask.pct)) }) : '',
    askPct: s.ask ? Math.round(s.ask.pct * 100) : 0,
    canAgree: !!s.ask && canAct && !pending('pay'),
    canRefuse: !!s.ask && runs,
    bonusOptions: Array.from({ length: BUSINESS_DEFAULTS.staff.bonusQuarters }, (_, i) => ({
      value: i + 1,
      label: L(`NCI.Staff.BonusQuarter.${i + 1}`, { amount: whole(Math.round((wageOf(business, s) * (i + 1)) / 4)) }),
    })),
    bonusGiven: given ? L('NCI.Staff.BonusGiven', { amount: whole(given) }) : '',
    canBonus: runs && (bonus.ok || bonus.reason === 'no-funds') && !given,
    moves: moves.map((id) => ({ value: id, label: postLabel(id) })),
    canMove: runs && moves.length > 0,
    noMove: runs && !moves.length ? L('NCI.Staff.NoMove') : '',
    training: s.source === 'team' ? null : trainingContext(business, s, account, runs),
    onCall: onCallContext(business, s, account, runs),
    grant: s.source === 'team' ? null : grantContext(business, s, canAct, pending('grant')),
    fireText: L(s.caught ? 'NCI.Staff.FireCaught' : 'NCI.Staff.FireHint', { amount: whole(severance) }),
    canFire: canAct && !pending('fire'),
    pending: pending('pay') || pending('fire') ? L('NCI.Staff.Pending') : '',
    blocked: !canAct ? L('NCI.Staff.CannotManage') : '',
  };
}

/**
 * A share grant for an employee (E3, company only): one vesting, what has vested, and the shares the
 * partners could propose within what is left of the grants' 5%.
 */
function grantContext(business, s, canAct, pending) {
  if (business.stage < 2) return null;
  const g = BUSINESS_DEFAULTS.staff.grants;
  const left = Math.max(0, g.max - grantedShare(business));
  const steps = Math.floor((left + 1e-9) / g.step);
  const pct = (x) => (Math.round(x * 1000) / 10).toLocaleString();
  return {
    text: L('NCI.Staff.GrantHint', { max: pct(g.max), weeks: Math.round(g.vestDays / 7), loyalty: g.loyalty, floor: g.floor }),
    vesting: s.grant ? L('NCI.Staff.GrantVesting', { pct: pct(s.grant.share), date: dayText(s.grant.vestDay) }) : '',
    vested: s.vested ? L('NCI.Staff.GrantVested', { pct: pct(s.vested) }) : '',
    left: L('NCI.Staff.GrantLeft', { pct: pct(left) }),
    options: Array.from({ length: steps }, (_, i) => ({ value: (i + 1) * g.step * 100, label: `${pct((i + 1) * g.step)}%` })),
    canGrant: canAct && !pending && !s.grant && steps > 0,
    pending: pending ? L('NCI.Staff.Pending') : '',
  };
}

/**
 * A player character on the staff, on call (E3, DESIGN §33.11): what is asked of them this week, and
 * the rolls the account picked could ask of them now (a free action slot, the event, a help).
 */
function onCallContext(business, s, account, runs) {
  if (s.source !== 'pc') return null;
  const asks = asksFor(business, s.id);
  const label = (r) => (r.type === 'action' ? L('NCI.Staff.AskSlot', { action: L(`NCI.Business.Action.${r.action}.Name`) })
    : r.type === 'respond' ? L('NCI.Staff.AskRespond', { event: business.period.event ? L(`NCI.Event.${business.period.event.kind}.Name`) : '' })
      : L('NCI.Staff.AskHelp', { action: L(`NCI.Business.Action.${r.forAction}.Name`) }));
  const day = BusinessClient.day();
  const could = (roll) => runs && askCheck(business, s.id, roll).ok
    && (roll.type === 'assist'
      ? !business.period.slots.some((x) => x.action === roll.forAction) && !business.period.helpers.includes(s.id)
      : rollSpec(business, { ...roll, use: null }, account.id, { day }).ok);
  const ids = actionIdsFor(business.stage);
  const options = [
    ...ids.map((action) => ({ type: 'action', action })),
    { type: 'respond' },
    ...ids.map((forAction) => ({ type: 'assist', forAction })),
  ].filter(could).map((r) => ({ value: r.type === 'respond' ? 'respond' : `${r.type}:${r.action ?? r.forAction}`, label: label(r) }));
  return {
    text: L('NCI.Staff.OnCallHint'),
    asked: asks.map((a) => ({ id: a.id, text: L('NCI.Staff.AskedOf', { what: label(a.roll), name: nameOf(business, a.by) }), canCancel: runs })),
    options,
    canAsk: options.length > 0 && !asks.length,
    none: runs && !asks.length && !options.length ? L('NCI.Staff.AskNone') : '',
  };
}

/**
 * Training an employee (E3, DESIGN §33.5): the skill it would raise, what a mentor (the account picked,
 * if their own base is higher) or a course costs, and why it cannot be done now.
 */
function trainingContext(business, s, account, runs) {
  if (!hasLoyalty(s)) return { text: L('NCI.Staff.TrainPc') };
  const t = BUSINESS_DEFAULTS.staff.training;
  const skill = trainingSkill(business, s);
  if (!skill) return { text: L('NCI.Staff.TrainNone') };
  const day = BusinessClient.day();
  const actor = account && !account.isSyndicate ? game.actors.get(account.id) : null;
  const mentorBase = actor ? SkillAdapter.baseFor(actor, skill.use).base : 0;
  const days = account ? daysLeft(business, account.id) : 0;
  const course = trainCheck(business, s.id, { mentor: false, day });
  const mentor = trainCheck(business, s.id, { mentor: true, mentorBase, days, day });
  const cost = t.perPoint * skill.base;
  const reason = (r) => ({
    'train-delay': L('NCI.Staff.TrainNext', { date: dayText(r.next ?? day) }),
    'train-max': L('NCI.Staff.TrainMax'),
    'no-funds': L('NCI.Staff.TrainNoFunds'),
  })[r.reason] ?? '';
  return {
    text: L('NCI.Staff.TrainHint', { every: Math.round(t.every / 7), perPoint: t.perPoint, days: t.mentorDays, max: t.max, cap: t.cap }),
    now: L('NCI.Staff.TrainNow', { skill: skill.use.skill, base: skill.base, trained: s.training?.[useKey(skill.use)] ?? 0, max: t.max }),
    blocked: course.ok ? '' : reason(course),
    mentorText: course.ok
      ? (mentor.ok
        ? L('NCI.Staff.TrainMentorYes', { base: mentorBase, cost: whole(cost) })
        : L(mentor.reason === 'no-days' ? 'NCI.Staff.TrainMentorNoDays' : 'NCI.Staff.TrainMentorNo', { base: mentorBase, days: t.mentorDays }))
      : '',
    canMentor: runs && mentor.ok,
    canCourse: runs && course.ok,
    mentorCost: whole(cost),
    courseCost: whole(cost * t.courseFactor),
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
    overtime: j.overtime ? L('NCI.Staff.OvertimeDue', { amount: whole(j.overtime) }) : '',
    // Rolls a partner asked of them (E3).
    asks: (j.asks ?? []).map((a) => ({ id: a.id, text: L('NCI.Staff.Asked', { what: a.what, name: a.by, pay: whole(a.pay) }) })),
  }));
}

function partnersContext(business, actor) {
  const units = totalUnits(business);
  const value = unitValue(business);
  const me = actor ? partnerOf(business, actor.id) : null;
  const canAct = !!actor && BusinessClient.canAct(business, actor.id);
  const open = business.status === 'open';
  const characters = game.actors.filter((a) => isCharacter(a) && a.id !== actor?.id);
  const sweat = business.agreement.sweat;
  return {
    rows: business.partners.filter((p) => p.status !== 'declined').map((p) => ({
      actorId: p.actorId,
      name: p.name,
      // The shares the market holds after a listing (B5b) are shown as the public float.
      who: p.market ? L('NCI.Business.MarketHolder') : actorLink(holderActorId(business, p), p.name),
      status: LT(business, `NCI.Business.PartnerStatus.${p.status}`),
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
    unitValue: units > 0 ? LT(business, 'NCI.Business.UnitValue', { value: value.toFixed(2) }) : '',
    isCompany: business.stage >= 2,
    agreement: [
      sweat ? L('NCI.Business.Agreement.sweat', { name: nameOf(business, sweat.actorId), pct: sweat.pct }) : L('NCI.Business.Agreement.noSweat'),
      LT(business, 'NCI.Business.Agreement.decision'),
      LT(business, 'NCI.Business.Agreement.buyout', { days: business.agreement.buyoutDays }),
    ],
    heirOptions: [{ value: '', label: L('NCI.Business.NoHeir') }, ...characters.map((a) => ({ value: a.id, label: a.name }))]
      .map((o) => ({ ...o, selected: o.value === (me?.heirId ?? '') })),
    canSetHeir: !!me && ['active', 'leaving', 'invited'].includes(me.status),
    canLeave: open && me?.status === 'active' && holders(business).length > 1,
    canPropose: open && canAct && !business.proposals.some((x) => x.kind === 'close'),
    investors: open ? investorsContext(business, actor, canAct) : null,
    proposals: business.proposals.map((proposal) => ({
      id: proposal.id,
      // Stepping up is registering, chartering or listing, by the stage it is proposed at.
      text: L(`NCI.Business.Proposed.${proposal.kind === 'stepUp' ? STEP_UP_KEYS[business.stage] ?? 'stepUp' : proposal.kind}`, {
        name: nameOf(business, proposal.by),
        ticker: proposal.terms?.ticker ?? business.company?.ticker ?? '',
        float: proposal.terms?.float != null ? Math.round(proposal.terms.float * 100) : '',
        // Who a hire or a firing is about, and the post (DESIGN §33).
        who: proposal.terms?.name ?? '',
        post: proposal.terms?.post ? postLabel(proposal.terms.post) : '',
        pct: proposal.terms?.pct != null ? Math.round(proposal.terms.pct * 100) : '',
        share: proposal.terms?.share != null ? (Math.round(proposal.terms.share * 1000) / 10).toLocaleString() : '',
        ratio: proposal.terms?.ratio != null ? Math.round(proposal.terms.ratio * 100) : '',
        project: proposal.terms?.project ? L(`NCI.Project.Kind.${proposal.terms.project}`) : '',
      }),
      rule: LT(business, `NCI.Business.Rule.${PROPOSAL_RULES[proposal.kind]}`, { date: dayText(proposal.expires ?? proposal.day) }),
      // Each voter, linked to their character, and how they voted.
      voters: holders(business).filter((p) => p.voting).map((p) => {
        const state = proposal.votes[p.actorId] === true ? 'yes' : proposal.votes[p.actorId] === false ? 'no' : 'none';
        return { who: actorLink(holderActorId(business, p), p.name), state, label: L(`NCI.Business.Vote.${state}`) };
      }),
      canVote: !!me?.voting && ['active', 'leaving'].includes(me.status) && proposal.votes[actor.id] === undefined,
    })),
  };
}
