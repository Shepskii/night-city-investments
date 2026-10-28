/**
 * Business window: the data each tab shows.
 * @file scripts/ui/Business/context.js
 */

import {
  ARCHETYPES, ACTION_IDS, partnerOf, holders, totalUnits, unitValue, shareOf, bookValue, drawAllowance, fundingShortfall,
  stateBands, lastDigest, weekdayOf, gearValue, rollSpec, BUSINESS_DEFAULTS,
} from '../../engine/index.js';
import { MODULE_ID, SETTINGS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient, operatorRankOf, pendingBusinessRequests } from '../../services/BusinessClient.js';
import { MarketClock } from '../../services/MarketClockService.js';
import { L, whole, signed } from '../format.js';

const DAY_MS = 86_400_000;
const LEDGER_ROWS = 15;

/** A market day as a date, e.g. "2045-03-09". */
export const dayText = (day) => MarketClock.dateString(day * DAY_MS);

const nameOf = (business, actorId) => partnerOf(business, actorId)?.name || game.actors.get(actorId)?.name || '?';

/** Characters this user can act as: their own, or for a GM the player-owned ones (every character if none). */
export function usableActors() {
  const characters = game.actors.filter((a) => a.type === 'character');
  const usable = game.user.isGM ? characters.filter((a) => a.hasPlayerOwner) : characters.filter((a) => a.testUserPermission(game.user, 'OWNER'));
  return (game.user.isGM && !usable.length ? characters : usable).sort((a, b) => a.name.localeCompare(b.name));
}

export function archetypeOptions() {
  return Object.keys(ARCHETYPES).map((id) => ({ value: id, label: L(`NCI.Business.Archetype.${id}.Name`), hint: L(`NCI.Business.Archetype.${id}.Hint`) }));
}

/** The header: which character, and which of their businesses. */
export function pickerContext(app) {
  const actors = usableActors();
  const actor = app.actor;
  const businesses = actor ? BusinessRepository.forActor(actor.id) : [];
  return {
    actors: actors.map((a) => ({ id: a.id, name: a.name, selected: a.id === actor?.id })),
    businesses: businesses.map((b) => ({ id: b.id, label: `${b.name} (${L(`NCI.Business.Status.${b.status}`)})`, selected: b.id === app.businessId })),
    pending: actor ? pendingBusinessRequests(actor).length : 0,
    noGM: !game.users.activeGM,
    enabled: game.settings.get(MODULE_ID, SETTINGS.BUSINESSES_ENABLED) !== false,
  };
}

/** The Start a business form. */
export function startContext(app) {
  const actor = app.actor;
  const others = game.actors.filter((a) => a.type === 'character' && a.id !== actor?.id && a.hasPlayerOwner).sort((a, b) => a.name.localeCompare(b.name));
  return {
    archetypes: archetypeOptions(),
    partners: others.map((a) => ({ id: a.id, name: a.name })),
    wealth: whole(actor?.system?.wealth?.value ?? 0),
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
    location: business.location,
    stage: L(`NCI.Business.Stage.${business.stage}`),
    status,
    statusLabel: L(`NCI.Business.Status.${status}`),
    isForming: status === 'forming',
    isPending: status === 'pending',
    isOpen: status === 'open',
    isClosed: status === 'closed',
    closed: status === 'closed' ? L(`NCI.Business.Closed.${business.closeReason ?? 'closed'}`, { date: dayText(business.closedDay ?? 0) }) : '',
    invited: me?.status === 'invited',
    canAct,
    isPartner: !!me && ['active', 'leaving'].includes(me.status),
    bands: [
      { label: L('NCI.Business.State.reputation'), value: L(`NCI.Business.Band.reputation.${bands.reputation}`) },
      { label: L('NCI.Business.State.capacity'), value: L(`NCI.Business.Band.capacity.${bands.capacity}`) },
      { label: L('NCI.Business.State.costs'), value: L(`NCI.Business.Band.costs.${bands.costs}`) },
    ],
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
  return {
    from: dayText(period.startDay),
    to: dayText(period.endDay),
    closesOn: L(`NCI.Weekday.${weekdayOf(period.endDay)}`),
    slotsText: L('NCI.Business.SlotsUsed', { used: period.slots.length, total: slots }),
    actions: ACTION_IDS.map((id) => {
      const slot = taken.get(id);
      const bonus = period.bonuses.some((b) => b.action === id && !b.used);
      return {
        id,
        name: L(`NCI.Business.Action.${id}.Name`),
        hint: L(`NCI.Business.Action.${id}.Hint`),
        taken: slot ? L('NCI.Business.TakenBy', { name: nameOf(business, slot.by), band: L(`NCI.Roll.Band.${slot.band}`) }) : '',
        bonus: bonus ? L('NCI.Business.BonusWaiting') : '',
        canRoll: canAct && free && !slot,
        canHelp: canAct && !helped && !slot,
      };
    }),
    helped: actor && helped && canAct ? L('NCI.Business.AlreadyHelped') : '',
    unworkedNote: L('NCI.Business.UnworkedNote'),
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
      what: L(`NCI.Business.Ledger.${e.kind}${e.gear > 0 ? 'Gear' : ''}`, { name: e.actorId ? nameOf(business, e.actorId) : '', seller: e.sellerId ? nameOf(business, e.sellerId) : '', price: whole(e.price ?? 0), salvage: whole(e.salvage ?? 0), gear: whole(e.gear ?? 0) }),
      amount: e.amount ? signed(e.amount) : '',
      cls: e.amount > 0 ? 'nci-up' : e.amount < 0 ? 'nci-down' : '',
    })),
    allowance,
    allowanceText: allowance > 0 ? L('NCI.Business.DrawAllowance', { amount: whole(allowance) }) : L('NCI.Business.NoDraw'),
    canDraw: business.status === 'open' && allowance > 0,
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
      ? d.actions.map((a) => L('NCI.Business.DigestAction', { action: L(`NCI.Business.Action.${a.action}.Name`), name: nameOf(business, a.by), band: L(`NCI.Roll.Band.${a.band}`) })).join('; ')
      : L('NCI.Business.NoActions'),
  };
}

function partnersContext(business, actor) {
  const units = totalUnits(business);
  const value = unitValue(business);
  const me = actor ? partnerOf(business, actor.id) : null;
  const canAct = !!actor && BusinessClient.canAct(business, actor.id);
  const open = business.status === 'open';
  const proposal = business.proposals.find((p) => p.kind === 'close');
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
    })),
    unitValue: units > 0 ? value.toFixed(2) : '',
    agreement: [
      sweat ? L('NCI.Business.Agreement.sweat', { name: nameOf(business, sweat.actorId), pct: sweat.pct }) : L('NCI.Business.Agreement.noSweat'),
      L('NCI.Business.Agreement.decision'),
      L('NCI.Business.Agreement.buyout', { days: business.agreement.buyoutDays }),
    ],
    heirOptions: [{ value: '', label: L('NCI.Business.NoHeir') }, ...characters.map((a) => ({ value: a.id, label: a.name }))]
      .map((o) => ({ ...o, selected: o.value === (me?.heirId ?? '') })),
    canSetHeir: !!me && ['active', 'leaving', 'invited'].includes(me.status),
    canLeave: open && me?.status === 'active' && holders(business).length > 1,
    canPropose: open && canAct && !proposal,
    proposal: proposal ? {
      id: proposal.id,
      text: L('NCI.Business.CloseProposed', { name: nameOf(business, proposal.by) }),
      votes: holders(business).filter((p) => p.voting).map((p) => `${p.name}: ${L(`NCI.Business.Vote.${proposal.votes[p.actorId] === true ? 'yes' : proposal.votes[p.actorId] === false ? 'no' : 'none'}`)}`).join(', '),
      canVote: !!me?.voting && ['active', 'leaving'].includes(me.status) && proposal.votes[actor.id] === undefined,
    } : null,
  };
}
