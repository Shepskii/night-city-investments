/**
 * GM Console businesses tab: every player business with its true state, and what needs the GM.
 * @file scripts/ui/GMConsole/tabs/businesses.js
 * @description Action handlers run with `this` set to the console window.
 */

import { holders, totalUnits, bookValue, fundingShortfall, ARCHETYPES, traitOf, hasLoyalty } from '../../../engine/index.js';
import { BusinessService } from '../../../services/BusinessService.js';
import { BusinessApp } from '../../Business/BusinessApp.js';
import { dayText, LT } from '../../Business/context.js';
import { L, whole } from '../../format.js';
import { confirm, report } from '../shared.js';
import { actorLink } from '../../actorLink.js';
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

async function onPartnerLeaves(event, target) {
  const actorId = target.closest('.nci-gig')?.querySelector('[name="leaver"]')?.value;
  if (!actorId) return;
  report(await BusinessService.partnerLeaves(target.dataset.id, actorId));
}

async function onRemove(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.Remove'), L('NCI.GMBusiness.RemoveConfirm')))) return;
  report(await BusinessService.remove(target.dataset.id));
}

/** The GM answers a job offer for an NPC (DESIGN §33). */
async function onStaffAnswer(event, target) {
  report(await BusinessService.answerOffer(target.dataset.id, target.dataset.staff, target.dataset.yes === 'true'));
}

function onOpen(event, target) {
  BusinessApp.open({ businessId: target.dataset.id });
}

export const actions = {
  businessApprove: onApprove,
  businessCharterApprove: onCharterApprove,
  businessCharterReject: onCharterReject,
  businessReject: onReject,
  businessPartnerLeaves: onPartnerLeaves,
  businessRemove: onRemove,
  businessOpen: onOpen,
  businessStaffAnswer: onStaffAnswer,
};

/** How many businesses are waiting for the GM, for the tab's label. */
export function waiting() {
  return BusinessService.snapshot().filter(({ business }) => business.status === 'pending' || business.charter?.status === 'awaiting'
    || (business.staff ?? []).some((s) => s.status === 'offered' && s.source === 'npc')).length;
}

/** An employee's true loyalty and hidden trait, for the GM. */
function staffExtra(s, traits) {
  const trait = traitOf(traits, s);
  return [
    hasLoyalty(s) ? L('NCI.GMBusiness.StaffLoyalty', { loyalty: s.loyalty ?? 50 }) : '',
    trait ? L('NCI.GMBusiness.StaffTrait', { trait: L(`NCI.Staff.Trait.${trait}`) }) : '',
    s.elsewhere ? L('NCI.GMBusiness.StaffElsewhere', { name: s.elsewhere.name }) : '',
  ].filter(Boolean).map((x) => `, ${x}`).join('');
}

export function context() {
  const rows = BusinessService.snapshot().map(({ business: b, hidden }) => {
    const units = totalUnits(b);
    return {
      id: b.id,
      name: b.name,
      archetype: L(`NCI.Business.Archetype.${b.archetype}.Name`),
      status: L(`NCI.Business.Status.${b.status}`),
      isPending: b.status === 'pending',
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
      location: [b.district ? L(`NCI.District.${b.district}`) : '', b.location].filter(Boolean).join(', '),
      // The owners, as a compact table: each name (HTML) links to their character.
      owners: b.partners.filter((p) => p.status !== 'declined').map((p) => ({
        who: actorLink(p.actorId, p.name),
        status: LT(b, `NCI.Business.PartnerStatus.${p.status}`),
        units: b.status === 'open' || b.status === 'closed' ? whole(p.units ?? 0) : '',
        share: units > 0 && ['active', 'leaving'].includes(p.status) ? `${((p.units / units) * 100).toFixed(1)}%` : '',
        note: [p.voting === false ? L('NCI.Business.NonVoting') : '', (b.officers ?? []).includes(p.actorId) ? L('NCI.Company.Officer') : ''].filter(Boolean).join(', '),
      })),
      leavers: holders(b).filter((p) => p.status === 'active').map((p) => ({ value: p.actorId, label: p.name })),
      money: b.status === 'forming' || b.status === 'pending'
        ? L('NCI.GMBusiness.MoneyForming', { escrow: whole(b.escrow), short: whole(fundingShortfall(b) ?? 0) })
        : '',
      // Where an open business stands now: its cash, book value, Reputation, Capacity, and its hidden Exposure.
      stats: b.status === 'open' ? [
        [L('NCI.Business.Till'), `${whole(b.till)} eb`],
        [L('NCI.GMBusiness.BookValue'), `${whole(bookValue(b))} eb`],
        [L('NCI.Business.State.reputation'), b.state.reputation.toFixed(0)],
        [L('NCI.Business.State.capacity'), b.state.capacity.toFixed(2)],
        [L('NCI.GMBusiness.Exposure'), String(hidden.exposure ?? 0)],
      ].map(([label, value]) => ({ label, value })) : [],
      setup: b.setup && b.status !== 'open' ? L(b.setup.passed ? 'NCI.GMBusiness.SetupPassed' : 'NCI.GMBusiness.SetupFailed', {
        band: L(`NCI.Roll.Band.${b.setup.band}`), cost: whole(b.setup.cost ?? 0), range: ARCHETYPES[b.archetype].setup.map(whole).join('–'),
      }) : '',
      // HTML, as the partners. The GM sees true loyalty and hidden traits (E2).
      staff: (b.staff ?? []).filter((s) => s.status === 'active')
        .map((s) => escapeHtml(L('NCI.GMBusiness.StaffOne', { name: '\u0000', post: L(`NCI.Staff.Post.${s.post}`), wage: whole(s.wage), extra: staffExtra(s, hidden.traits) })).replace('\u0000', actorLink(s.actorId, s.name))).join(', '),
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
      active: rows.filter((r) => !r.isPending && !r.closed),
      closed: rows.filter((r) => r.closed),
    },
  };
}
