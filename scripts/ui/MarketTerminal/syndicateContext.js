/**
 * Market Terminal: what the Portfolio tab shows about syndicates (DESIGN §31).
 * @file scripts/ui/MarketTerminal/syndicateContext.js
 */

import { navOf, memberOf, freeCash, freeUnits, isLiquid, syndicateUnits, activeMembers } from '../../engine/index.js';
import { MODULE_ID, SETTINGS } from '../../utils/constants.js';
import { PortfolioRepository } from '../../data/PortfolioRepository.js';
import { SyndicateRepository } from '../../data/SyndicateRepository.js';
import { CompanyRepository } from '../../data/CompanyRepository.js';
import { FundRepository } from '../../data/FundRepository.js';
import { MarketClock } from '../../services/MarketClockService.js';
import { pendingSyndicateRequests } from '../../services/SyndicateClient.js';
import { syndicateKey } from '../accounts.js';
import { L, money, whole, signed } from '../format.js';

const DAY_MS = 86_400_000;
const LEDGER_ROWS = 10;
const dayText = (day) => MarketClock.dateString(day * DAY_MS);
const units = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const tickerOf = (id) => CompanyRepository.get(id)?.ticker ?? FundRepository.get(id)?.ticker ?? id;

/** One proposal in words. */
function describe(s, p) {
  const name = memberOf(s, p.actorId)?.name || game.actors.get(p.actorId)?.name || '?';
  switch (p.kind) {
    case 'trade':
      return L('NCI.Syndicate.Proposal.trade', { side: L(`NCI.Side.${p.order.side}`), qty: p.order.qty, ticker: tickerOf(p.order.assetId), value: whole(p.value ?? 0) });
    case 'role':
      return L(`NCI.Syndicate.Proposal.role.${p.role}`, { name });
    case 'limit':
      return L('NCI.Syndicate.Proposal.limit', { amount: whole(p.amount) });
    default:
      return L(`NCI.Syndicate.Proposal.${p.kind}`, { name });
  }
}

/**
 * The Syndicate panel, for a syndicate's account picked as one of its members.
 * @param {object} account - from accounts.memberAccount
 * @param {object} portfolio - the syndicate's account
 * @param {Object<string, number>} prices
 */
export function syndicateContext(account, portfolio, prices) {
  const s = account.syndicate;
  const meId = account.as.id;
  const me = memberOf(s, meId);
  const { total, nav } = navOf(s, portfolio, prices);
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
  const candidates = game.actors
    .filter((a) => a.type === 'character' && a.hasPlayerOwner && !['active', 'invited'].includes(memberOf(s, a.id)?.status))
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
    pending: pendingSyndicateRequests(account.as).filter((r) => r.syndicateId === s.id).length,
    members: s.members.filter((m) => ['active', 'invited'].includes(m.status)).map((m) => ({
      name: m.name || game.actors.get(m.actorId)?.name || '?',
      role: m.status === 'invited' ? L('NCI.Syndicate.Invited') : L(`NCI.Syndicate.Role.${m.role}`),
      units: m.status === 'active' ? units(m.units) : '',
      share: m.status === 'active' ? share(m) : '',
      value: m.status === 'active' ? whole(m.units * nav) : '',
      leaving: m.leaving ? L('NCI.Syndicate.Leaving') : '',
      isMe: m.actorId === meId,
    })),
    proposals: s.proposals.map((p) => ({
      id: p.id,
      text: describe(s, p),
      by: L('NCI.Syndicate.ProposedBy', { name: memberOf(s, p.by)?.name ?? '?', date: dayText(p.ends) }),
      yes: weight(p, true),
      no: weight(p, false),
      votedYes: p.votes[meId] === true,
      votedNo: p.votes[meId] === false,
    })),
    redemptions: s.redemptions.filter((r) => r.status === 'waiting').map((r) => L('NCI.Syndicate.RedemptionLine', {
      name: memberOf(s, r.actorId)?.name ?? '?', units: units(r.units), date: dayText(r.payableDay),
    })),
    ledger: [...s.ledger].reverse().slice(0, LEDGER_ROWS).map((e) => ({
      date: dayText(e.day),
      text: L(`NCI.Syndicate.Ledger.${e.kind}`, { name: memberOf(s, e.actorId)?.name ?? '', units: units(e.units ?? 0) }),
      amount: e.amount ? signed(e.kind === 'deposit' ? e.amount : -e.amount) : '',
    })),
    proposeKinds: [
      ...(candidates.length ? [{ value: 'admit', label: L('NCI.Syndicate.Kind.admit') }] : []),
      ...(others.length ? ['remove', 'officer', 'member'].map((k) => ({ value: k, label: L(`NCI.Syndicate.Kind.${k}`) })) : []),
      { value: 'limit', label: L('NCI.Syndicate.Kind.limit') },
      ...(isLiquid(portfolio) ? [{ value: 'dissolve', label: L('NCI.Syndicate.Kind.dissolve') }] : []),
    ],
    candidates: candidates.map((a) => ({ id: a.id, name: a.name })),
    others: others.map((m) => ({ id: m.actorId, name: m.name })),
    soleMember: activeMembers(s).length === 1,
  };
}

/** For a character's own account: invitations to answer, syndicates they are in, and founding a new one. */
export function characterSyndicates(actor) {
  if (game.settings.get(MODULE_ID, SETTINGS.SYNDICATES_ENABLED) === false) return null;
  const mine = SyndicateRepository.forActor(actor.id).filter((s) => s.status !== 'closed');
  return {
    invitations: mine.filter((s) => memberOf(s, actor.id)?.status === 'invited').map((s) => ({
      id: s.id, name: s.name, founder: memberOf(s, s.founderId)?.name ?? '?', pending: s.status === 'pending',
    })),
    memberships: mine.filter((s) => memberOf(s, actor.id)?.status === 'active').map((s) => ({
      key: syndicateKey(s.id, actor.id),
      name: s.name,
      pending: s.status === 'pending',
      role: L(`NCI.Syndicate.Role.${memberOf(s, actor.id).role}`),
    })),
    inviteOptions: game.actors
      .filter((a) => a.type === 'character' && a.hasPlayerOwner && a.id !== actor.id)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((a) => ({ id: a.id, name: a.name })),
  };
}
