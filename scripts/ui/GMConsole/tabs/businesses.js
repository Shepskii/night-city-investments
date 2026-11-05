/**
 * GM Console businesses tab: every player business with its true state, and what needs the GM.
 * @file scripts/ui/GMConsole/tabs/businesses.js
 * @description Action handlers run with `this` set to the console window.
 */

import { DistrictService } from '../../../services/DistrictService.js';
import { kindProfile, sceneCandidate, holders, totalUnits, bookValue, fundingShortfall, ARCHETYPES, traitOf, hasLoyalty, debtsOf, solvency, standingBand, turfFactions } from '../../../engine/index.js';
import { BusinessService, sceneHook } from '../../../services/BusinessService.js';
import { FactionRepository } from '../../../data/FactionRepository.js';
import { BusinessApp } from '../../Business/BusinessApp.js';
import { dayText, LT, holderWho, factionTerms } from '../../Business/context.js';
import { L, whole } from '../../format.js';
import { confirm, report } from '../shared.js';
import { actorLink } from '../../actorLink.js';
import { rewardRow } from './pending.js';
import { escapeHtml } from '../../../utils/text.js';

async function onApprove(event, target) {
  report(await BusinessService.approve(target.dataset.id));
}

async function onReject(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.Reject'), L('NCI.GMBusiness.RejectConfirm')))) return;
  report(await BusinessService.reject(target.dataset.id));
}

async function onCharterApprove(event, target) {
  report(await BusinessService.approveCharter(target.dataset.id));
}

async function onCharterReject(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.CharterReject'), L('NCI.GMBusiness.CharterRejectConfirm')))) return;
  report(await BusinessService.rejectCharter(target.dataset.id));
}

async function onListingApprove(event, target) {
  report(await BusinessService.approveListing(target.dataset.id));
}

async function onListingReject(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.ListingReject'), L('NCI.GMBusiness.ListingRejectConfirm')))) return;
  report(await BusinessService.rejectListing(target.dataset.id));
}

async function onCaseOpen(event, target) {
  report(await BusinessService.openCaseByHand(target.dataset.id));
}

async function onCaseDrop(event, target) {
  report(await BusinessService.dropCaseByHand(target.dataset.id));
}

async function onCaseFine(event, target) {
  const input = target.closest('.nci-gig, tr')?.querySelector('[name="caseFine"]');
  const fine = input ? Number(input.value) : null;
  report(await BusinessService.approveCaseFine(target.dataset.id, Number.isFinite(fine) ? fine : null));
}

async function onRestructure(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.Restructure'), L('NCI.GMBusiness.RestructureConfirm')))) return;
  report(await BusinessService.restructureBusiness(target.dataset.id));
}

async function onWindUp(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.WindUp'), L('NCI.GMBusiness.WindUpConfirm')))) return;
  report(await BusinessService.windUpBusiness(target.dataset.id));
}

async function onTakeoverApprove(event, target) {
  report(await BusinessService.approveTakeover(target.dataset.id));
}

async function onTakeoverReject(event, target) {
  report(await BusinessService.rejectTakeover(target.dataset.id));
}

async function onCampaignApprove(event, target) {
  report(await BusinessService.approveCampaign(target.dataset.id));
}

async function onCampaignReject(event, target) {
  report(await BusinessService.rejectCampaign(target.dataset.id));
}

async function onRoomApprove(event, target) {
  report(await BusinessService.approveBackRoom(target.dataset.id));
}

async function onRoomReject(event, target) {
  report(await BusinessService.rejectBackRoom(target.dataset.id));
}

async function onSceneRun(event, target) {
  report(await BusinessService.runScene(target.dataset.id));
}

async function onSceneWon(event, target) {
  report(await BusinessService.settleScene(target.dataset.id, true));
}

async function onSceneLost(event, target) {
  report(await BusinessService.settleScene(target.dataset.id, false));
}

async function onSceneRoll(event, target) {
  report(await BusinessService.sceneToRoll(target.dataset.id));
}

async function onDelist(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.Delist'), L('NCI.GMBusiness.DelistConfirm')))) return;
  report(await BusinessService.delist(target.dataset.id));
}

async function onGiveTime(event, target) {
  report(await BusinessService.giveTime(target.dataset.id));
}

async function onPartnerLeaves(event, target) {
  const actorId = target.closest('.nci-gig')?.querySelector('[name="leaver"]')?.value;
  if (!actorId) return;
  report(await BusinessService.partnerLeaves(target.dataset.id, actorId));
}

async function onRemove(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.Remove'), L('NCI.GMBusiness.RemoveConfirm')))) return;
  report(await BusinessService.remove(target.dataset.id));
}

/** A suggested REP and IP award (B7c), as set on its row. */
async function onRewardApply(event, target) {
  const row = target.closest('tr');
  const read = (name) => row?.querySelector(`[name="${name}"]`)?.value;
  report(await BusinessService.applyReward(target.dataset.id, target.dataset.reward, { rep: read('rewardRep') ?? 0, ip: read('rewardIp') ?? 0 }));
}

/** What became of stock the GM moved by hand (P1b). */
async function onStockSettle(event, target) {
  report(await BusinessService.settleStock(target.dataset.id, target.dataset.reward, target.dataset.yes));
}

async function onRewardDismiss(event, target) {
  report(await BusinessService.dismissReward(target.dataset.id, target.dataset.reward));
}

/** A team member's Loyalty, by hand, for what happened at the table (B7a). */
async function onTeamLoyalty(event, target) {
  report(await BusinessService.setTeamLoyalty(target.dataset.id, target.dataset.staff, target.closest('tr')?.querySelector('[name="teamLoyalty"]')?.value));
}

/** The GM answers a job offer for an NPC (DESIGN §32). */
async function onStaffAnswer(event, target) {
  report(await BusinessService.answerOffer(target.dataset.id, target.dataset.staff, target.dataset.yes === 'true'));
}

/** The GM answers a founding invitation for an NPC, with what it puts in. */
async function onNpcPartner(event, target) {
  const cash = target.closest('tr')?.querySelector('[name="npcCash"]')?.value ?? 0;
  report(await BusinessService.answerNpcPartner(target.dataset.id, target.dataset.staff, target.dataset.yes === 'true', cash));
}

function onOpen(event, target) {
  BusinessApp.open({ businessId: target.dataset.id });
}

/** The GM sets a business's standing with a faction by hand (F1a). */
async function onSetStanding(event, target) {
  const box = target.closest('.nci-gig');
  const factionId = box?.querySelector('[name="standingFaction"]')?.value;
  const value = Number(box?.querySelector('[name="standingValue"]')?.value);
  if (!factionId || !Number.isFinite(value)) return;
  report(await BusinessService.setStanding(target.dataset.id, factionId, value));
  this.render();
}

export const actions = {
  businessApprove: onApprove,
  businessCharterApprove: onCharterApprove,
  businessCharterReject: onCharterReject,
  businessListingApprove: onListingApprove,
  businessListingReject: onListingReject,
  businessDelist: onDelist,
  businessTakeoverApprove: onTakeoverApprove,
  businessRestructure: onRestructure,
  businessCaseOpen: onCaseOpen,
  businessCaseDrop: onCaseDrop,
  businessCaseFine: onCaseFine,
  businessWindUp: onWindUp,
  businessTakeoverReject: onTakeoverReject,
  businessGiveTime: onGiveTime,
  businessReject: onReject,
  businessPartnerLeaves: onPartnerLeaves,
  businessRemove: onRemove,
  businessOpen: onOpen,
  businessStaffAnswer: onStaffAnswer,
  businessNpcPartner: onNpcPartner,
  businessTeamLoyalty: onTeamLoyalty,
  businessRewardApply: onRewardApply,
  businessStockSettle: onStockSettle,
  businessRewardDismiss: onRewardDismiss,
  businessSetStanding: onSetStanding,
  businessCampaignApprove: onCampaignApprove,
  businessRoomApprove: onRoomApprove,
  businessRoomReject: onRoomReject,
  businessSceneRun: onSceneRun,
  businessSceneWon: onSceneWon,
  businessSceneLost: onSceneLost,
  businessSceneRoll: onSceneRoll,
  businessCampaignReject: onCampaignReject,
};

/** An employee as a row of the staff table: their true loyalty and hidden trait, for the GM. */
function staffRow(s, traits) {
  const trait = traitOf(traits, s);
  return {
    who: actorLink(s.actorId, s.name),
    post: L(`NCI.Staff.Post.${s.post}`),
    wage: whole(s.wage),
    loyalty: s.source === 'team' ? '' : hasLoyalty(s) ? s.loyalty ?? 50 : '',
    teamId: s.source === 'team' ? s.id : '',
    care: s.care ?? 0,
    trait: trait ? L(`NCI.Staff.Trait.${trait}`) : '',
    note: s.elsewhere ? L('NCI.GMBusiness.StaffElsewhere', { name: s.elsewhere.name }) : '',
  };
}

/** A business's true standing with each faction it has met or whose turf it is on, the friendliest first. */
function standingRows(b, hidden, factions) {
  const values = hidden.standing ?? {};
  const turf = new Set(turfFactions(factions, b.district).map((f) => f.id));
  return factions.filter((f) => values[f.id] || turf.has(f.id)).map((f) => {
    const value = values[f.id]?.value ?? 0;
    const band = standingBand(value);
    return { name: f.name, value, band, label: L(`NCI.Faction.Band.${band}`), turf: turf.has(f.id) ? L('NCI.Faction.Turf') : '' };
  }).sort((x, y) => y.value - x.value);
}

export function context() {
  const factions = FactionRepository.list();
  const factionOptions = factions.map((f) => ({ value: f.id, label: f.name }));
  const rows = BusinessService.snapshot().map(({ business: b, hidden }) => {
    const units = totalUnits(b);
    return {
      id: b.id,
      name: b.name,
      archetype: L(`NCI.Business.Archetype.${b.archetype}.Name`),
      status: L(`NCI.Business.Status.${b.status}`),
      isPending: b.status === 'pending',
      // A listing under way (B5a), and waiting for the GM.
      listing: b.listing && (['awaiting', 'prospectus', 'ready', 'scheduled'].includes(b.listing.status) || b.listing.review) ? {
        awaiting: b.listing.status === 'awaiting',
        // Under the delisting review (B5c): the GM delists it or gives it time.
        review: !!b.listing.review,
        text: L(`NCI.GMBusiness.Listing.${b.listing.review ? 'review' : b.listing.status}`, {
          value: whole(b.listing.review?.marketCap ?? 0), date: dayText(b.listing.review?.since ?? 0),
          ticker: b.company?.ticker ?? '', valuation: whole(b.listing.valuation ?? 0), float: Math.round((b.listing.float ?? 0) * 100), exposure: hidden.exposure ?? 0,
          price: b.listing.offer ? b.listing.offer.price.toLocaleString() : '', shares: whole(b.listing.offer?.shares ?? 0),
        }),
      } : null,
      // A regulator's case (R1), with the Exposure behind it; and opening one by hand.
      regCase: b.regCase ? {
        lost: b.regCase.status === 'lost',
        fine: b.regCase.fine ?? 0,
        text: b.regCase.status === 'notice'
          ? L('NCI.GMBusiness.CaseNotice', { why: L(`NCI.Regulator.Reason.${b.regCase.reason}`), date: dayText(b.regCase.endDay), exposure: hidden.exposure ?? 0 })
          : L('NCI.GMBusiness.CaseLost', { why: L(`NCI.Regulator.Reason.${b.regCase.reason}`), fine: whole(b.regCase.fine ?? 0), how: L(b.regCase.silent ? 'NCI.GMBusiness.CaseSilent' : b.regCase.fumble ? 'NCI.GMBusiness.CaseFumbled' : 'NCI.GMBusiness.CaseRolled'), more: b.regCase.serious ? L('NCI.GMBusiness.CaseSerious') : '' }),
      } : null,
      canOpenCase: !b.regCase && b.stage === 2 && b.status === 'open',
      // A back room (U1a): the truth, and whether it waits for the GM.
      backRoom: b.backRoom ? L({ pending: 'NCI.GMBusiness.RoomPending', shut: 'NCI.GMBusiness.RoomShut' }[b.backRoom.status] ?? 'NCI.GMBusiness.RoomOpen', { kind: L('NCI.BackRoom.KindLabel', { kind: L(`NCI.BackRoom.Kind.${b.backRoom.kind}`), profile: L(`NCI.BackRoom.Profile.${kindProfile(b.archetype, b.backRoom.kind)}.Name`) }), dirty: whole(b.backRoom.dirty ?? 0) }) : '',
      roomPending: b.backRoom?.status === 'pending',
      roomDeal: b.backRoom?.deal ? L('NCI.GMBusiness.RoomDeal', { gang: b.backRoom.deal.name, cut: Math.round(b.backRoom.deal.cut * 100) }) : '',
      // A big event the GM could play out, or is playing out (X1).
      bigEvent: sceneCandidate(b) ? L('NCI.GMBusiness.BigEvent', { event: L(`NCI.Event.${b.period.event.kind}.Name`), hook: sceneHook(b, b.period.event) }) : '',
      scene: b.scene ? L('NCI.GMBusiness.SceneOpen', { event: L(`NCI.Event.${b.scene.event.kind}.Name`), date: dayText(b.scene.day), hook: sceneHook(b, b.scene.event) }) : '',
      // A campaign waiting for the GM (F1c).
      campaign: b.campaign?.status === 'awaiting' ? L('NCI.GMBusiness.CampaignWaiting', {
        kind: L(`NCI.Business.Campaign.${b.campaign.kind}`), name: b.campaign.name, ticker: b.campaign.ticker, percent: b.campaign.percent, date: dayText(b.campaign.day),
      }) : '',
      // In administration (B6c): the GM restructures or winds it up.
      administration: b.administration ? L('NCI.GMBusiness.Administration', {
        date: dayText(b.administration.since), net: whole(solvency(b)), loans: whole(debtsOf(b).loans), wages: whole(debtsOf(b).wages), overdraft: whole(debtsOf(b).overdraft),
      }) : '',
      // A takeover offer (B6b): waiting for the GM, or open.
      takeover: b.takeover ? {
        awaiting: b.takeover.status === 'awaiting',
        text: L(`NCI.GMBusiness.Takeover.${b.takeover.status}`, {
          bidder: b.takeover.bidderName, price: b.takeover.price.toLocaleString(), shares: whole(b.takeover.shares), escrow: whole(Math.round(b.takeover.price * b.takeover.shares)),
          date: dayText(b.takeover.endDay ?? 0), tendered: whole(Object.values(b.takeover.tenders ?? {}).reduce((a, n) => a + n, 0)),
        }),
      } : null,
      charter: b.charter && ['rolling', 'awaiting', 'funding'].includes(b.charter.status) ? {
        awaiting: b.charter.status === 'awaiting',
        text: L(`NCI.GMBusiness.Charter.${b.charter.status}`, {
          ticker: b.charter.ticker, quote: whole(b.charter.quote ?? 0), assets: whole(b.charter.netAssets ?? 0), shortfall: whole(b.charter.shortfall ?? 0),
          rolls: Object.entries(b.charter.rolls ?? {}).map(([k, r]) => `${L(`NCI.Charter.Part.${k}`)} ${L(`NCI.Roll.Band.${r.band}`)}`).join(', ') || '—',
          date: dayText(b.charter.fundingEnds ?? 0),
        }),
      } : null,
      ticker: b.company?.ticker ?? '',
      isForming: b.status === 'forming',
      isOpen: b.status === 'open',
      location: [DistrictService.name(b.district), b.location].filter(Boolean).join(', '),
      // The owners, as a compact table: each name (HTML) links to their character.
      owners: b.partners.filter((p) => p.status !== 'declined').map((p) => ({
        who: holderWho(b, p, null, { truth: true }),
        status: LT(b, `NCI.Business.PartnerStatus.${p.status}`),
        units: b.status === 'open' || b.status === 'closed' ? whole(p.units ?? 0) : '',
        share: units > 0 && ['active', 'leaving'].includes(p.status) ? `${((p.units / units) * 100).toFixed(1)}%` : '',
        note: [p.voting === false ? L('NCI.Business.NonVoting') : '', (b.officers ?? []).includes(p.actorId) ? L('NCI.Company.Officer') : '',
          // Hidden ownership (B6d): each layer and its strength, from the hidden state.
          ...(b.masks?.[p.actorId] ?? []).map((m, i) => L('NCI.GMBusiness.Layer', { mask: m.kind === 'nominee' ? L('NCI.Ownership.Nominee', { broker: m.name }) : m.name, total: hidden.layers?.[p.actorId]?.[i] ?? '?' }))].filter(Boolean).join(', '),
      })),
      leavers: holders(b).filter((p) => p.status === 'active').map((p) => ({ value: p.actorId, label: p.name })),
      money: b.status === 'forming' || b.status === 'pending'
        ? L('NCI.GMBusiness.MoneyForming', { escrow: whole(b.escrow), short: whole(fundingShortfall(b) ?? 0) })
        : '',
      // Where an open business stands now: its cash, book value, Reputation, Capacity, and its hidden Exposure.
      rewards: (hidden.rewards ?? []).map((r) => {
        const row = rewardRow(b.name, b.id, r);
        return { item: row.item, needed: row.needed, ...row.controls() };
      }),
      stats: b.status === 'open' ? [
        [L('NCI.Business.Till'), `${whole(b.till)} eb`],
        [L('NCI.GMBusiness.BookValue'), `${whole(bookValue(b))} eb`],
        [L('NCI.Business.State.reputation'), b.state.reputation.toFixed(0)],
        [L('NCI.Business.State.capacity'), b.state.capacity.toFixed(2)],
        [L('NCI.GMBusiness.Exposure'), String(Math.round((hidden.exposure ?? 0) * 10) / 10)],
      ].map(([label, value]) => ({ label, value })) : [],
      setup: b.setup && b.status !== 'open' ? L(b.setup.passed ? 'NCI.GMBusiness.SetupPassed' : 'NCI.GMBusiness.SetupFailed', {
        band: L(`NCI.Roll.Band.${b.setup.band}`), cost: whole(b.setup.cost ?? 0), range: ARCHETYPES[b.archetype].setup.map(whole).join('–'),
      }) : '',
      // The GM sees true loyalty and hidden traits (E2).
      staff: (b.staff ?? []).filter((s) => s.status === 'active').map((s) => staffRow(s, hidden.traits)),
      // Standing (F1a): the numbers, which players only see as bands, and setting one by hand.
      standing: b.status === 'open' ? standingRows(b, hidden, factions) : [],
      factionOptions: b.status === 'open' ? factionOptions : [],
      factionTerms: b.status === 'open' ? factionTerms(b) : '',
      applicants: (b.candidates ?? []).length ? L('NCI.GMBusiness.Applicants', {
        list: b.candidates.map((c) => L('NCI.GMBusiness.ApplicantOne', {
          name: c.name, post: L(`NCI.Staff.Post.${c.post}`), base: c.base, trait: hidden.traits?.[c.id] ? `, ${L(`NCI.Staff.Trait.${hidden.traits[c.id]}`)}` : '',
        })).join(', '),
      }) : '',
      offers: (b.staff ?? []).filter((s) => s.status === 'offered' && s.source === 'npc').map((s) => ({
        id: s.id, text: escapeHtml(L('NCI.GMBusiness.StaffOffer', { name: '\u0000', post: L(`NCI.Staff.Post.${s.post}`), wage: whole(s.wage) })).replace('\u0000', actorLink(s.actorId, s.name)),
      })),
      closed: b.status === 'closed' ? L(`NCI.Business.Closed.${b.closeReason ?? 'closed'}`, { date: dayText(b.closedDay ?? 0) }) : '',
    };
  });
  return {
    businesses: {
      enabled: BusinessService.enabled(),
      pending: rows.filter((r) => r.isPending),
      // Suggested REP and IP wait with the rest, a closed business's too.
      rewards: rows.flatMap((r) => r.rewards),
      active: rows.filter((r) => !r.isPending && !r.closed),
      closed: rows.filter((r) => r.closed),
    },
  };
}
