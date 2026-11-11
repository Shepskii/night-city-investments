/**
 * Syndicate mail: tells members by Night City Messenger what their syndicate has done (DESIGN §30).
 * @file scripts/services/SyndicateMail.js
 * @description GM client only. Every active member hears about a proposal when it opens, and about
 *              its outcome (passed, turned down, lapsed, vetoed, or passed but impossible), a trade or
 *              business payment the members agreed that then failed, and the syndicate being wound up.
 *              A member hears alone about their own redemption being paid. The mail comes from the
 *              syndicate's treasury, in its voice (M3 step 5), with a motion's number in the subject, or from
 *              the market wire without Messenger. A world setting turns it off. Also words a proposal for the windows.
 */

import { memberOf, motionTones, voteTones, refNumber } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { L, log } from '../utils/helpers.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { MarketClock } from './MarketClockService.js';
import { MailService } from './MailService.js';
import { ContactService } from './ContactService.js';
import { OrgMail } from './OrgMail.js';

const DAY_MS = 86_400_000;
const eb = (n) => Math.round(Number(n) || 0).toLocaleString();
const units = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 });
const tickerOf = (id) => CompanyRepository.get(id)?.ticker ?? FundRepository.get(id)?.ticker ?? id;
const dayText = (day) => MarketClock.displayDate(day * DAY_MS);

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
    const all = (subject, lines, footer = '') => mails.push({ to: 'all', subject, lines, footer });
    // The treasury's words, or the plain ones if it has none; a motion keeps its number from tabling to outcome.
    const voiced = (kind, tones, data, plain) => OrgMail.treasury(kind, tones, { syndicate: s.name, ...data })?.paragraphs ?? plain;
    const motion = (e, subject) => (e.proposalId ? `${L('NCI.SyndicateMail.Motion', { ref: refNumber(`motion:${s.id}:${e.proposalId}`) })}: ${subject}` : subject);
    // A proposal the same change also settled (the proposer's units carried it at once) has nothing left to
    // vote on: its members hear only how it ended.
    const settled = new Set(events.filter((e) => e.type !== 'proposed' && /^proposal/.test(e.type)).map((e) => e.proposalId));
    for (const e of events) {
      const text = e.proposal ? describeProposal(s, e.proposal) : '';
      switch (e.type) {
        case 'proposed': {
          if (settled.has(e.proposalId)) break;
          const by = memberOf(s, e.proposal.by)?.name ?? '?';
          const date = dayText(e.proposal.ends);
          all(motion(e, L('NCI.SyndicateMail.Proposed.Subject')), voiced('proposed', motionTones(e.proposal), { what: text, by, date }, [text, L('NCI.SyndicateMail.Proposed.Body', { name: by })]), L('NCI.SyndicateMail.Proposed.Footer', { date }));
          break;
        }
        case 'proposalPassed':
          // What the GM did is the rules' business, so it goes in the footer.
          all(motion(e, L('NCI.SyndicateMail.Passed.Subject')), voiced('passed', voteTones(s, e), { what: text }, [text, L('NCI.SyndicateMail.Passed.Body')]), e.forced ? L('NCI.SyndicateMail.Passed.Forced') : '');
          break;
        case 'proposalFailed':
          all(motion(e, L('NCI.SyndicateMail.Failed.Subject')), voiced('failed', voteTones(s, e), { what: text }, [text, L('NCI.SyndicateMail.Failed.Body')]));
          break;
        case 'proposalLapsed':
          all(motion(e, L('NCI.SyndicateMail.Lapsed.Subject')), voiced('lapsed', [], { what: text }, [text, L('NCI.SyndicateMail.Lapsed.Body')]));
          break;
        case 'proposalVetoed':
          all(motion(e, L('NCI.SyndicateMail.Vetoed.Subject')), voiced('vetoed', [], { what: text }, [text]), L('NCI.SyndicateMail.Vetoed.Body'));
          break;
        case 'proposalVoid': {
          const reason = reasonText(e.reason);
          all(motion(e, L('NCI.SyndicateMail.Void.Subject')), voiced('void', [], { what: text, reason }, [text, L('NCI.SyndicateMail.Void.Body', { reason })]));
          break;
        }
        case 'agreedFailed': {
          const reason = reasonText(e.reason);
          all(L('NCI.SyndicateMail.AgreedFailed.Subject'), voiced('agreedFailed', [], { what: e.text ?? '', reason }, [e.text ?? '', L('NCI.SyndicateMail.AgreedFailed.Body', { reason })]));
          break;
        }
        case 'redeemed': {
          const terms = { units: units(e.units), name: s.name, amount: eb(e.amount) };
          mails.push({ to: e.actorId, subject: `${s.name}: ${L('NCI.SyndicateMail.Redeemed.Subject')}`, lines: voiced('redeemed', [], terms, [L('NCI.SyndicateMail.Redeemed.Body', terms)]) });
          break;
        }
        case 'dissolved':
          // Closed, it has no active members left: tell those who were members at the end.
          for (const actorId of e.actorIds ?? []) {
            mails.push({ to: actorId, subject: `${s.name}: ${L('NCI.SyndicateMail.Dissolved.Subject')}`, lines: voiced('dissolved', [], {}, [L('NCI.SyndicateMail.Dissolved.Body')]) });
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
    // The syndicate's treasury writes to its members (M3).
    const treasury = await ContactService.syndicate(s).catch(() => null);
    for (const mail of this.build(s, events)) {
      try {
        const to = mail.to === 'all' ? SyndicateRepository.account(s.id) : game.actors.get(mail.to);
        if (!to) continue;
        const sent = treasury ? await MailService.fromContact(treasury, to, { subject: mail.subject, lines: mail.lines, footer: mail.footer ?? '' }) : null;
        if (!sent?.ok) await MailService.fromWire(to, { subject: mail.subject, lines: mail.lines, footer: mail.footer ?? '' });
      } catch (error) {
        log.warn('Syndicate mail failed', error);
      }
    }
  },
};
