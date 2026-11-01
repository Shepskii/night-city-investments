/**
 * Market Terminal: what the Portfolio tab shows about syndicates (DESIGN §30).
 * @file scripts/ui/MarketTerminal/syndicateContext.js
 */

import { navOf, memberOf, freeCash, freeUnits, isLiquid, syndicateUnits, activeMembers, limitLeft, dayIndex } from '../../engine/index.js';
import { MODULE_ID, SETTINGS } from '../../utils/constants.js';
import { PortfolioRepository } from '../../data/PortfolioRepository.js';
import { SyndicateRepository } from '../../data/SyndicateRepository.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { MarketClock } from '../../services/MarketClockService.js';
import { pendingSyndicateRequests } from '../../services/SyndicateClient.js';
import { describeProposal, reasonText } from '../../services/SyndicateMail.js';
import { syndicateKey } from '../accounts.js';
import { L, money, whole, signed } from '../format.js';
import { actorLink } from '../actorLink.js';
import { isCharacter } from '../../utils/helpers.js';

const DAY_MS = 86_400_000;
const LEDGER_ROWS = 10;
const dayText = (day) => MarketClock.dateString(day * DAY_MS);
const units = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });


/**
 * The Syndicate panel, for a syndicate's account picked as one of its members.
 * @param {object} account - from accounts.memberAccount
 * @param {object} portfolio - the syndicate's account
 * @param {Object<string, number>} prices
 * @param {number} [stakes] - its business stakes at book value, which count in its value
 */
export function syndicateContext(account, portfolio, prices, stakes = 0) {
  const s = account.syndicate;
  const meId = account.as.id;
  const me = memberOf(s, meId);
  const { total, nav } = navOf(s, portfolio, prices, stakes);
  const all = syndicateUnits(s);
  const share = (m) => (all > 0 ? `${((m.units / all) * 100).toFixed(1)}%` : '—');
  const weight = (p, yes) => {
    const voters = activeMembers(s);
    const of = (m) => (all > 0 ? m.units : 1);
    const sum = voters.filter((m) => p.votes[m.actorId] === yes).reduce((a, m) => a + of(m), 0);
    const base = all > 0 ? all : voters.length;
    return base > 0 ? `${Math.round((sum / base) * 100)}%` : '0%';
  };
  const others = s.members.filter((m) => m.status === 'active' && m.actorId !== meId);
  const waiting = pendingSyndicateRequests(account.as).filter((r) => r.syndicateId === s.id);
  const candidates = game.actors
    .filter((a) => isCharacter(a) && a.hasPlayerOwner && !['active', 'invited'].includes(memberOf(s, a.id)?.status))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: s.id,
    name: s.name,
    isOfficer: account.isOfficer,
    role: L(`NCI.Syndicate.Role.${me.role}`),
    nav: money(nav),
    total: whole(total),
    myUnits: units(me.units),
    myValue: whole(me.units * nav),
    myShare: share(me),
    freeUnits: units(freeUnits(s, meId)),
    myCash: whole(freeCash(PortfolioRepository.get(account.as))),
    limit: whole(s.rules.tradeLimit),
    limitText: L('NCI.Syndicate.LimitText', { amount: whole(s.rules.tradeLimit), days: s.rules.proposalDays }),
    limitLeft: account.isOfficer ? L('NCI.Syndicate.LimitLeft', { left: whole(limitLeft(s, meId, dayIndex(MarketClock.nowMs()))) }) : '',
    pending: waiting.length,
    members: s.members.filter((m) => ['active', 'invited'].includes(m.status)).map((m) => ({
      name: m.name || game.actors.get(m.actorId)?.name || '?',
      who: actorLink(m.actorId, m.name),
      role: m.status === 'invited' ? L('NCI.Syndicate.Invited') : L(`NCI.Syndicate.Role.${m.role}`),
      units: m.status === 'active' ? units(m.units) : '',
      share: m.status === 'active' ? share(m) : '',
      value: m.status === 'active' ? whole(m.units * nav) : '',
      leaving: m.leaving ? L('NCI.Syndicate.Leaving') : '',
      isMe: m.actorId === meId,
    })),
    proposals: s.proposals.map((p) => {
      // The vote shown is the one this member last sent, if the GM has not handled it yet, else the one recorded.
      const sentVote = waiting.filter((r) => r.type === 'vote' && r.proposalId === p.id).at(-1);
      const vote = sentVote ? !!sentVote.yes : p.votes[meId];
      const said = vote === true ? 'yes' : vote === false ? 'no' : null;
      return {
        id: p.id,
        text: describeProposal(s, p),
        by: L('NCI.Syndicate.ProposedBy', { name: memberOf(s, p.by)?.name ?? '?', date: dayText(p.ends) }),
        yes: weight(p, true),
        no: weight(p, false),
        voted: !!said,
        voteText: said ? L(sentVote ? `NCI.Syndicate.VoteSent.${said}` : `NCI.Syndicate.Voted.${said}`) : '',
        // Once voted, the one button left changes the vote.
        changeTo: said ? (said === 'yes' ? 'false' : 'true') : null,
        changeLabel: said ? L(`NCI.Syndicate.ChangeTo.${said === 'yes' ? 'no' : 'yes'}`) : '',
      };
    }),
    redemptions: s.redemptions.filter((r) => r.status === 'waiting').map((r) => L('NCI.Syndicate.RedemptionLine', {
      name: memberOf(s, r.actorId)?.name ?? '?', units: units(r.units), date: dayText(r.payableDay),
    })),
    ledger: [...s.ledger].reverse().slice(0, LEDGER_ROWS).map((e) => ({
      date: dayText(e.day),
      text: L(`NCI.Syndicate.Ledger.${e.kind}`, {
        name: memberOf(s, e.actorId)?.name ?? '', units: units(e.units ?? 0), business: e.business || '?', text: e.text ?? '',
        reason: e.reason ? reasonText(e.reason) : '',
      }),
      // Money in (a member paying in, a business paying out) reads as a gain; everything else as money out.
      amount: e.amount ? signed(['deposit', 'businessIn'].includes(e.kind) ? e.amount : -e.amount) : '',
    })),
    proposeKinds: [
      ...(candidates.length ? [{ value: 'admit', label: L('NCI.Syndicate.Kind.admit') }] : []),
      ...(others.length ? ['remove', 'officer', 'member'].map((k) => ({ value: k, label: L(`NCI.Syndicate.Kind.${k}`) })) : []),
      { value: 'limit', label: L('NCI.Syndicate.Kind.limit') },
      ...(isLiquid(portfolio, stakes) ? [{ value: 'dissolve', label: L('NCI.Syndicate.Kind.dissolve') }] : []),
    ],
    candidates: candidates.map((a) => ({ id: a.id, name: a.name })),
    others: others.map((m) => ({ id: m.actorId, name: m.name })),
    soleMember: activeMembers(s).length === 1,
  };
}

/**
 * For a character's own account: invitations to answer, syndicates they are in (with the value per
 * unit, the account's value and the character's units), and founding a new one.
 * @param {Object<string, number>} [prices]
 */
export function characterSyndicates(actor, prices = {}) {
  if (game.settings.get(MODULE_ID, SETTINGS.SYNDICATES_ENABLED) === false) return null;
  const mine = SyndicateRepository.forActor(actor.id).filter((s) => s.status !== 'closed');
  return {
    invitations: mine.filter((s) => memberOf(s, actor.id)?.status === 'invited').map((s) => ({
      id: s.id, name: s.name, founder: memberOf(s, s.founderId)?.name ?? '?', pending: s.status === 'pending',
    })),
    memberships: mine.filter((s) => memberOf(s, actor.id)?.status === 'active').map((s) => {
      const { total, nav } = navOf(s, SyndicateRepository.portfolio(s.id), prices, BusinessRepository.stakesOf(s.id));
      const mineUnits = memberOf(s, actor.id).units;
      return {
        key: syndicateKey(s.id, actor.id),
        name: s.name,
        pending: s.status === 'pending',
        role: L(`NCI.Syndicate.Role.${memberOf(s, actor.id).role}`),
        nav: money(nav),
        total: whole(total),
        units: units(mineUnits),
        value: whole(mineUnits * nav),
      };
    }),
    inviteOptions: game.actors
      .filter((a) => isCharacter(a) && a.hasPlayerOwner && a.id !== actor.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ id: a.id, name: a.name, who: actorLink(a.id, a.name) })),
  };
}
