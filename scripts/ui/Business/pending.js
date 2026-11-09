/**
 * Business window: the Pending tab
 * @file scripts/ui/Business/pending.js
 * @description Everything waiting for a character, across their businesses, the businesses of the syndicates they
 *              are officers of, their jobs and their syndicates. One row for each thing they could settle now,
 *              read from what the other tabs would offer them, with that tab's own buttons and fields. The week's
 *              optional actions are not here, nor is anything already waiting on someone else.
 */

import { MODULE_ID, SETTINGS, FLAGS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { SyndicateRepository } from '../../data/SyndicateRepository.js';
import { accountFor, businessAccounts, ownerOf, syndicateKey } from '../accounts.js';
import { syndicateContext, characterSyndicates } from '../MarketTerminal/syndicateContext.js';
import { L } from '../format.js';
import { businessContext, jobsContext } from './context.js';
import { BusinessClient } from '../../services/BusinessClient.js';

const need = (key, params) => L(`NCI.Business.Pending.Need.${key}`, params);
const number = (name, label, value, extra = {}) => ({ name, label: L(label), value, type: 'number', ...extra });

/** Anything a business's own tabs would let this account settle. `act` carries out a tab's action as that account. */
function businessRows(business, account) {
  const key = account.key ?? account.id;
  const c = businessContext(business, account);
  const where = account.isSyndicate ? `${business.name} (${account.syndicate?.name ?? account.name})` : business.name;
  const row = (tab, needed, buttons, fields = []) => ({ where, needed, account: key, business: business.id, tab, buttons, fields });
  const act = (action, label, icon, data = {}) => ({ do: action, label: L(label), icon, account: key, business: business.id, ...data });

  if (c.invited) {
    return [c.offer
      ? row('overview', c.offer, [act('join', 'NCI.Business.Accept', 'fa-handshake'), act('decline', 'NCI.Business.Decline', 'fa-xmark')])
      : row('overview', need('invited'), [act('join', 'NCI.Business.Join', 'fa-handshake'), act('decline', 'NCI.Business.Decline', 'fa-xmark')], [number('cash', 'NCI.Business.Cash', 0, { min: 0, step: 50 })])];
  }

  const { partners, growth, ledger, week, forming, regCase } = c;
  const { takeover, capital, investors } = partners ?? {};
  const charter = growth?.charter;
  const listing = growth?.listing;
  const rolls = (parts, action, label, tab = 'growth') => (parts ?? []).filter((p) => p.canRoll)
    .map((p) => row(tab, need(label, { part: p.label }), [act(action, 'NCI.Charter.Roll', 'fa-dice-d10', { part: p.part })]));
  return [
    ...(partners?.proposals ?? []).filter((p) => p.canVote).map((p) => row('partners', p.text, [
      act('vote', 'NCI.Business.VoteYes', 'fa-check', { id: p.id, yes: 'true' }),
      act('vote', 'NCI.Business.VoteNo', 'fa-xmark', { id: p.id, yes: 'false' }),
    ])),
    regCase?.canAnswer && row('overview', regCase.text, [act('answerCase', 'NCI.Regulator.Answer', 'fa-scale-balanced')]),
    takeover?.canTender && row('partners', takeover.text, [act('tender', 'NCI.Takeover.Tender', 'fa-handshake')], [number('tenderQty', 'NCI.Takeover.TenderQty', takeover.tendered, { min: 0, max: takeover.most, step: 1 })]),
    takeover?.canDefend && row('partners', need('defend'), [act('defenceRoll', 'NCI.Takeover.Defend', 'fa-shield-halved')]),
    capital?.rights?.canTake && row('partners', capital.rights.mine, [act('takeRights', 'NCI.Capital.Take', 'fa-file-signature')], [number('rightsQty', 'NCI.Capital.Shares', capital.rights.left, { min: 1, max: capital.rights.left, step: 1 })]),
    capital?.offering?.canRoll && row('partners', capital.offering.text, [act('issueRoll', 'NCI.Capital.OfferingRollButton', 'fa-dice-d10')]),
    capital?.market?.canRoll && row('partners', capital.market.text, [act('buybackRoll', 'NCI.Capital.TimingRollButton', 'fa-dice-d10')]),
    capital?.tender?.canSell && row('partners', capital.tender.text, [act('sellBack', 'NCI.Capital.SellBack', 'fa-hand-holding-dollar')], [number('sellBackQty', 'NCI.Capital.Shares', 1, { min: 1, max: capital.tender.max, step: 1 })]),
    forming?.canRoll && row('overview', need('setup'), [act('setupRoll', 'NCI.Business.SetupRoll', 'fa-dice-d10')]),
    growth?.canRoll && row('growth', growth.agreed, [act('stepUpRoll', 'NCI.Business.StepUpRoll', 'fa-dice-d10')]),
    ...rolls(charter?.parts, 'charterRoll', 'charter'),
    charter?.canFund && row('growth', charter.funding, [act('charterFund', 'NCI.Charter.Fund', 'fa-coins')], [number('cash', 'NCI.Business.Cash', 0, { min: 1, step: 100 })]),
    ...rolls(listing?.parts, 'prospectusRoll', 'prospectus'),
    ledger?.money?.canRollBank && row('ledger', need('bank'), [act('loanRoll', 'NCI.Business.BankRoll', 'fa-dice-d10')], [number('bankAmount', 'NCI.Business.LoanAmount', 1000, { min: 100, step: 100 })]),
    investors?.canPitch && row('partners', investors.angel, [act('angelRoll', 'NCI.Business.AngelRoll', 'fa-dice-d10')]),
    ledger?.report?.canPrepare && row('reports', need('report'), [act('reportRoll', 'NCI.Company.Prepare', 'fa-file-invoice-dollar')]),
    week?.backRoom?.offer && week.backRoom.canPropose && row('backRoom', week.backRoom.offer, [act('gangDeal', 'NCI.BackRoom.TakeDeal', 'fa-handshake')]),
  ].filter(Boolean);
}

/** A character's jobs: offers to answer, and rolls a partner has asked of them. */
function jobRows(character) {
  const row = (job, needed, buttons) => ({ where: job.name, needed, account: character.id, tab: 'overview', buttons, fields: [] });
  const act = (action, label, icon, data) => ({ do: action, label: L(label), icon, account: character.id, ...data });
  return jobsContext(character).flatMap((job) => [
    ...(job.offered ? [row(job, need('job', { post: job.post }), [
      act('acceptJob', 'NCI.Staff.Accept', 'fa-handshake', { id: job.businessId }),
      act('declineJob', 'NCI.Staff.Decline', 'fa-xmark', { id: job.businessId }),
    ])] : []),
    ...job.asks.map((ask) => row(job, ask.text, [
      act('rollAsked', 'NCI.Staff.RollAsked', 'fa-dice-d10', { business: job.businessId, id: ask.id }),
      act('declineAsk', 'NCI.Staff.DeclineAsk', 'fa-xmark', { business: job.businessId, id: ask.id }),
    ])),
  ]);
}

/** A character's syndicates: invitations, and proposals they have not voted on. A click on the row opens the terminal. */
function syndicateRows(character) {
  if (game.settings.get(MODULE_ID, SETTINGS.SYNDICATES_ENABLED) === false) return [];
  const invited = (characterSyndicates(character)?.invitations ?? []).map((s) => ({
    where: s.name, needed: need('syndicate', { founder: s.founder }), account: character.id, terminal: 'investments', fields: [],
    buttons: [
      { do: 'synJoin', label: L('NCI.Syndicate.Join'), icon: 'fa-check', account: character.id, syndicate: s.id },
      { do: 'synDecline', label: L('NCI.Syndicate.Decline'), icon: 'fa-xmark', account: character.id, syndicate: s.id },
    ],
  }));
  const votes = SyndicateRepository.forActor(character.id).filter((s) => s.status === 'active').flatMap((s) => {
    const account = accountFor(syndicateKey(s.id, character.id));
    if (!account) return [];
    return syndicateContext(account, SyndicateRepository.portfolio(s.id), {}).proposals.filter((p) => !p.voted).map((p) => ({
      where: s.name, needed: p.text, account: account.key, terminal: 'brokerage', fields: [],
      buttons: [
        { do: 'synVote', label: L('NCI.Syndicate.Yes'), icon: 'fa-check', account: account.key, syndicate: s.id, id: p.id, yes: 'true' },
        { do: 'synVote', label: L('NCI.Syndicate.No'), icon: 'fa-xmark', account: account.key, syndicate: s.id, id: p.id, yes: 'false' },
      ],
    }));
  });
  return [...invited, ...votes];
}

/** A story in the press about this character, not yet answered. */
function pressRows(character) {
  const notice = character.getFlag?.(MODULE_ID, FLAGS.PRESS_NOTICE);
  if (!notice || notice.answered) return [];
  return [{
    where: notice.outlet, needed: need('press', { days: Math.max(0, notice.deadline - BusinessClient.day()) }), account: character.id, tab: 'overview', fields: [],
    buttons: [{ do: 'answerPress', label: L('NCI.Press.Char.Answer'), icon: 'fa-comment', account: character.id }],
  }];
}

/**
 * Every row for whichever character is behind the picked account.
 * @param {object} picked - the account picked in the window: a character, or a syndicate as one of its members
 */
export function pendingRows(picked) {
  const character = ownerOf(picked);
  if (!character) return [];
  // Only officers act for a syndicate in its businesses.
  const accounts = businessAccounts([character]).map((a) => accountFor(a.id)).filter((a) => a && (!a.isSyndicate || a.isOfficer));
  const owned = accounts.flatMap((account) => BusinessRepository.forActor(account.id)
    .filter((b) => b.status !== 'closed').flatMap((b) => businessRows(b, account)));
  return [...pressRows(character), ...owned, ...jobRows(character), ...syndicateRows(character)];
}
