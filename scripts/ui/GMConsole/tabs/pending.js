/**
 * GM Console pending tab: every decision waiting for the GM, across the other tabs.
 * @file scripts/ui/GMConsole/tabs/pending.js
 * @description One row per decision, in the console's tab order. The tab buttons count these same rows,
 *              so a button and the table always agree. Things that settle themselves, like a syndicate's
 *              votes and a takeover's open offer, are not here. Each row has the buttons and fields of its
 *              home tab, whose own action handlers do the work; a click elsewhere on the row opens that tab.
 */

import { L } from '../../format.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { SyndicateRepository } from '../../../data/SyndicateRepository.js';
import { BusinessService } from '../../../services/BusinessService.js';
import { HeatService } from '../../../services/HeatService.js';
import { sceneCandidate } from '../../../engine/index.js';
import { penaltyText, context as heatContext } from './heat.js';
import { context as gigContext } from './gigs.js';
import { StoryService } from '../../../services/StoryService.js';

/** `controls`, built only when the tab is drawn, gives a row's `{fields, buttons}`; the counts on the tab buttons need none. */
const row = (tab, item, need, params, controls) => ({ tab, type: L(`NCI.Pending.Kind.${need}`), item, needed: L(`NCI.Pending.Need.${need}`, params), controls });

const button = (action, label, icon, id, extra = {}) => ({ action, label: L(label), icon, id, ...extra });
const yes = 'fa-check';
const no = 'fa-xmark';
const numberField = (name, label, value, extra = {}) => ({ type: 'number', name, label, value, ...extra });
const useTarget = (gig) => (gig?.confirmTarget ? [{ isCheck: true, name: 'gigUseTarget', label: L('NCI.Gig.ConfirmTarget') }] : []);

const GIG_CONTROLS = {
  mapping: (id, gig) => ({
    fields: [
      { isSelect: true, name: 'gigCompany', options: [{ value: '', label: L('NCI.Gig.ChooseCompany') }, { value: 'ignore', label: L('NCI.Gig.Ignore') }, ...(gig?.options ?? [])] },
      { isCheck: true, name: 'gigRemember', checked: true, label: L('NCI.Gig.Remember') },
    ],
    buttons: [button('gigMap', 'NCI.Gig.Map', 'fa-link', id), button('gigDiscard', 'NCI.Gig.Discard', no, id)],
  }),
  review: (id, gig) => ({
    fields: [
      ...useTarget(gig),
      numberField('gigPercent', L('NCI.Gig.Percent'), gig?.percent, { step: 0.1 }),
      numberField('gigDelay', L('NCI.Gig.Delay'), gig?.delayDays, { min: 0, max: 30, step: 1 }),
      { type: 'text', name: 'gigHeadline', label: L('NCI.Gig.HeadlineLabel'), value: gig?.headline ?? '' },
    ],
    buttons: [button('gigApprove', 'NCI.Gig.Approve', yes, id), button('gigDiscard', 'NCI.Gig.Discard', no, id)],
  }),
  business: (id, gig) => ({
    fields: useTarget(gig),
    buttons: [button('gigApproveBusiness', 'NCI.Gig.Approve', yes, id), button('gigDiscard', 'NCI.Gig.Discard', no, id)],
  }),
};

const gigRows = () => MarketStore.getGigs().pending.map((p) => row('gigs', p.title || p.client || '—', p.kind, undefined, ({ gigs }) => GIG_CONTROLS[p.kind](p.id, gigs.get(p.id))));

const heatRows = () => HeatService.snapshot().penalties.filter((p) => p.status === 'pending')
  .map((p) => row('heat', p.name, 'penalty', { penalty: penaltyText(p) }, ({ penalties }) => {
    const penalty = penalties.get(p.id);
    return {
      fields: [penalty?.isFine
        ? numberField('penaltyAmount', L('NCI.Heat.FineAmount'), penalty.amount, { min: 0, step: 10 })
        : numberField('penaltyDays', penalty?.daysLabel, penalty?.days, { min: 0, max: 30, step: 1 })],
      buttons: [button('heatApprove', 'NCI.Heat.Approve', yes, p.id), button('heatDismiss', 'NCI.Heat.Dismiss', no, p.id)],
    };
  }));

function businessRows() {
  return BusinessService.snapshot().filter(({ business: b }) => b.status !== 'closed').flatMap(({ business: b }) => {
    const need = (kind, params, ...buttons) => row('businesses', b.name, kind, params, () => ({ buttons }));
    const act = (action, label, icon, extra) => button(action, `NCI.GMBusiness.${label}`, icon, b.id, extra);
    return [
      b.status === 'pending' && need('approval', undefined, act('businessApprove', 'Approve', yes), act('businessReject', 'Reject', no)),
      b.charter?.status === 'awaiting' && need('charter', undefined, act('businessCharterApprove', 'CharterApprove', 'fa-file-signature'), act('businessCharterReject', 'CharterReject', no)),
      b.listing?.status === 'awaiting' && need('listing', undefined, act('businessListingApprove', 'ListingApprove', 'fa-chart-line'), act('businessListingReject', 'ListingReject', no)),
      b.listing?.review && need('delisting', undefined, act('businessDelist', 'Delist', 'fa-ban'), act('businessGiveTime', 'GiveTime', 'fa-hourglass-half')),
      b.takeover?.status === 'awaiting' && need('takeover', { bidder: b.takeover.bidderName }, act('businessTakeoverApprove', 'TakeoverApprove', yes), act('businessTakeoverReject', 'TakeoverReject', no)),
      b.administration && need('administration', undefined, act('businessRestructure', 'Restructure', 'fa-scale-balanced'), act('businessWindUp', 'WindUp', 'fa-skull')),
      b.regCase?.status === 'lost' && row('businesses', b.name, 'case', undefined, () => ({
        fields: [numberField('caseFine', L('NCI.GMBusiness.CaseFine'), b.regCase.fine ?? 0, { min: 0, step: 100 })],
        buttons: [act('businessCaseFine', 'CaseApprove', 'fa-gavel'), act('businessCaseDrop', 'CaseDrop', no)],
      })),
      b.campaign?.status === 'awaiting' && need('campaign', { name: b.campaign.name }, act('businessCampaignApprove', 'CampaignApprove', yes), act('businessCampaignReject', 'CampaignReject', no)),
      b.backRoom?.status === 'pending' && need('backRoom', { kind: L(`NCI.BackRoom.Kind.${b.backRoom.kind}`) }, act('businessRoomApprove', 'RoomApprove', yes), act('businessRoomReject', 'RoomReject', no)),
      sceneCandidate(b) && need('scene', { event: L(`NCI.Event.${b.period.event.kind}.Name`) }, act('businessSceneRun', 'SceneRun', 'fa-masks-theater')),
      b.scene && need('sceneOpen', { event: L(`NCI.Event.${b.scene.event.kind}.Name`) }, act('businessSceneWon', 'SceneWon', yes), act('businessSceneLost', 'SceneLost', no), act('businessSceneRoll', 'SceneRoll', 'fa-dice-d10')),
      ...(b.stockQueries ?? []).map((q) => need('stockMoved', { count: q.count, name: q.name },
        act('businessStockSettle', 'StockSold', 'fa-cash-register', { reward: q.id, yes: 'sold' }),
        act('businessStockSettle', 'StockGiven', 'fa-hand-holding', { reward: q.id, yes: 'given' }),
        act('businessStockSettle', 'StockLost', no, { reward: q.id, yes: 'lost' }))),
      ...(b.staff ?? []).filter((s) => s.status === 'offered' && s.source === 'npc')
        .map((s) => need('offer', { name: s.name, post: L(`NCI.Staff.Post.${s.post}`) },
          act('businessStaffAnswer', 'StaffAccept', 'fa-handshake', { staff: s.id, yes: 'true' }), act('businessStaffAnswer', 'StaffDecline', no, { staff: s.id, yes: 'false' }))),
      // An NPC invited to found it: the GM answers, and says what it puts in (DESIGN §36.16).
      ...b.partners.filter((x) => x.npc && x.status === 'invited').map((x) => row('businesses', b.name, 'npcPartner', { name: x.name }, () => ({
        fields: [numberField('npcCash', L('NCI.GMBusiness.NpcPuts'), 0, { min: 0, step: 100 })],
        buttons: [
          act('businessNpcPartner', 'NpcAccept', 'fa-handshake', { staff: x.actorId, yes: 'true' }),
          act('businessNpcPartner', 'NpcDecline', no, { staff: x.actorId, yes: 'false' }),
        ],
      }))),
    ].filter(Boolean);
  });
}

/** A suggested REP and IP award's row, for here and for its business's entry on the Businesses tab. */
export function rewardRow(businessName, businessId, r) {
  return {
    item: r.name,
    needed: L('NCI.Pending.Need.reward', { what: L(`NCI.Reward.Kind.${r.kind}`, { name: businessName }) }),
    controls: () => ({
      fields: [
        ...(r.rep > 0 ? [numberField('rewardRep', L('NCI.Reward.Rep'), r.rep, { min: 0, max: 10, step: 1 })] : []),
        ...(r.ip > 0 ? [numberField('rewardIp', L('NCI.Reward.Ip'), r.ip, { min: 0, step: 5 })] : []),
      ],
      buttons: [button('businessRewardApply', 'NCI.Reward.Apply', yes, businessId, { reward: r.id }), button('businessRewardDismiss', 'NCI.Reward.Dismiss', no, businessId, { reward: r.id })],
    }),
  };
}

// A wound-up business's suggestions still wait, though it is closed.
const rewardRows = () => BusinessService.snapshot().flatMap(({ business: b, hidden }) => (hidden.rewards ?? []).map((r) => {
  const { item, needed, controls } = rewardRow(b.name, b.id, r);
  return { tab: 'businesses', type: L('NCI.Pending.Kind.reward'), item, needed, controls };
}));

const syndicateRows = () => SyndicateRepository.all().filter((s) => s.status === 'pending').map((s) => row('syndicates', s.name, 'syndicate', undefined, () => ({
  buttons: [button('syndicateApprove', 'NCI.GMSyndicate.Approve', yes, s.id), button('syndicateReject', 'NCI.GMSyndicate.Reject', no, s.id)],
})));

const storyRows = () => StoryService.pending().map((s) => row('events', s.media, 'story', { name: s.name }, () => ({
  buttons: [button('storyApprove', 'NCI.Story.Approve', yes, s.id), button('storyReject', 'NCI.Story.Reject', no, s.id)],
})));

const rows = () => [...storyRows(), ...businessRows(), ...rewardRows(), ...syndicateRows(), ...heatRows(), ...gigRows()];

/** How many decisions wait on each tab, and in all under `pending`. */
export function waiting() {
  const all = rows();
  const counts = { pending: all.length };
  for (const { tab } of all) counts[tab] = (counts[tab] ?? 0) + 1;
  return counts;
}

export const actions = {};

export function context() {
  const all = rows();
  // What the gig and penalty fields start from, as their own tabs show them.
  const byId = (list) => new Map(list.map((x) => [x.id, x]));
  const { gig } = all.some((r) => r.tab === 'gigs') ? gigContext() : { gig: { needsMapping: [], review: [], businessGigs: [] } };
  const made = {
    gigs: byId([...gig.needsMapping, ...gig.review, ...gig.businessGigs]),
    penalties: byId(all.some((r) => r.tab === 'heat') ? heatContext().heat.pendingPenalties : []),
  };
  return {
    pendingRows: all.map(({ controls, ...r }) => ({
      ...r,
      fields: [],
      buttons: [],
      ...controls?.(made),
    })),
  };
}
