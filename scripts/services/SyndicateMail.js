/**
 * Syndicate mail: tells members by Night City Messenger what their syndicate has done (DESIGN §30).
 * @file scripts/services/SyndicateMail.js
 * @description GM client only. Every active member hears about a proposal when it opens, and about
 *              its outcome (passed, turned down, lapsed, vetoed, or passed but impossible), a trade or
 *              business payment the members agreed that then failed, and the syndicate being wound up.
 *              A member hears alone about their own redemption being paid. The mail comes from the
 *              market wire. A world setting turns it off. Also words a proposal for the windows.
 */

import { memberOf } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { L, log } from '../utils/helpers.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { MarketClock } from './MarketClockService.js';
import { MailService } from './MailService.js';

const DAY_MS = 86_400_000;
const eb = (n) => Math.round(Number(n) || 0).toLocaleString();
const units = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const tickerOf = (id) => CompanyRepository.get(id)?.ticker ?? FundRepository.get(id)?.ticker ?? id;
const dayText = (day) => MarketClock.dateString(day * DAY_MS);

/** One proposal in words. */
export function describeProposal(s, p) {
  const name = memberOf(s, p.actorId)?.name || game.actors.get(p.actorId)?.name || '?';
  switch (p.kind) {
    case 'trade':
      return L('NCI.Syndicate.Proposal.trade', { side: L(`NCI.Side.${p.order.side}`), qty: p.order.qty, ticker: tickerOf(p.order.assetId), value: eb(p.value ?? 0) });
    case 'role':
      return L(`NCI.Syndicate.Proposal.role.${p.role}`, { name });
    case 'limit':
      return L('NCI.Syndicate.Proposal.limit', { amount: eb(p.amount) });
    case 'business': {
      const business = p.business?.businessId ? BusinessRepository.get(p.business.businessId) : null;
      return L(`NCI.Syndicate.Proposal.business.${p.business?.type}`, { name: business?.name ?? p.label ?? p.business?.name ?? '?', amount: eb(p.amount ?? 0) });
    }
    default:
      return L(`NCI.Syndicate.Proposal.${p.kind}`, { name });
  }
}

/** A refusal reason in words, from whichever list it belongs to (syndicate, market or business). */
export function reasonText(reason) {
  for (const key of [`NCI.Syndicate.Reason.${reason}`, `NCI.Reasons.${reason}`, `NCI.Business.Reason.${reason}`]) {
    const text = L(key);
    if (text !== key) return text;
  }
  return reason ?? '';
}

export const SyndicateMail = {
  enabled() {
    return game.settings.get(MODULE_ID, SETTINGS.SYNDICATE_MAIL) !== false;
  },

  /**
   * The mail a syndicate's events call for: `{ to: 'all' | actorId, subject, lines }`.
   * @param {object} s - the syndicate record (after the change)
   * @param {object[]} events
   */
  build(s, events) {
    const mails = [];
    const all = (subject, lines) => mails.push({ to: 'all', subject, lines });
    // A proposal the same change also settled (the proposer's units carried it at once) has nothing left to
    // vote on: its members hear only how it ended.
    const settled = new Set(events.filter((e) => e.type !== 'proposed' && /^proposal/.test(e.type)).map((e) => e.proposalId));
    for (const e of events) {
      const text = e.proposal ? describeProposal(s, e.proposal) : '';
      switch (e.type) {
        case 'proposed':
          if (settled.has(e.proposalId)) break;
          all(L('NCI.SyndicateMail.Proposed.Subject'), [text, L('NCI.SyndicateMail.Proposed.Body', { name: memberOf(s, e.proposal.by)?.name ?? '?', date: dayText(e.proposal.ends) })]);
          break;
        case 'proposalPassed':
          all(L('NCI.SyndicateMail.Passed.Subject'), [text, L(e.forced ? 'NCI.SyndicateMail.Passed.Forced' : 'NCI.SyndicateMail.Passed.Body')]);
          break;
        case 'proposalFailed':
          all(L('NCI.SyndicateMail.Failed.Subject'), [text, L('NCI.SyndicateMail.Failed.Body')]);
          break;
        case 'proposalLapsed':
          all(L('NCI.SyndicateMail.Lapsed.Subject'), [text, L('NCI.SyndicateMail.Lapsed.Body')]);
          break;
        case 'proposalVetoed':
          all(L('NCI.SyndicateMail.Vetoed.Subject'), [text, L('NCI.SyndicateMail.Vetoed.Body')]);
          break;
        case 'proposalVoid':
          all(L('NCI.SyndicateMail.Void.Subject'), [text, L('NCI.SyndicateMail.Void.Body', { reason: reasonText(e.reason) })]);
          break;
        case 'agreedFailed':
          all(L('NCI.SyndicateMail.AgreedFailed.Subject'), [e.text ?? '', L('NCI.SyndicateMail.AgreedFailed.Body', { reason: reasonText(e.reason) })]);
          break;
        case 'redeemed':
          mails.push({ to: e.actorId, subject: `${s.name}: ${L('NCI.SyndicateMail.Redeemed.Subject')}`, lines: [L('NCI.SyndicateMail.Redeemed.Body', { units: units(e.units), name: s.name, amount: eb(e.amount) })] });
          break;
        case 'dissolved':
          // Closed, it has no active members left: tell those who were members at the end.
          for (const actorId of e.actorIds ?? []) {
            mails.push({ to: actorId, subject: `${s.name}: ${L('NCI.SyndicateMail.Dissolved.Subject')}`, lines: [L('NCI.SyndicateMail.Dissolved.Body')] });
          }
          break;
        default:
      }
    }
    return mails;
  },

  /** Send the mail a syndicate's events call for. GM only; a failed send is logged, never thrown. */
  async send(syndicateId, events) {
    if (!this.enabled() || !events?.length) return;
    const s = SyndicateRepository.get(syndicateId);
    if (!s) return;
    for (const mail of this.build(s, events)) {
      try {
        const to = mail.to === 'all' ? SyndicateRepository.account(s.id) : game.actors.get(mail.to);
        if (to) await MailService.fromWire(to, { subject: mail.subject, lines: mail.lines });
      } catch (error) {
        log.warn('Syndicate mail failed', error);
      }
    }
  },
};
