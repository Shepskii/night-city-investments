/**
 * GM Console businesses tab: every player business with its true state, and what needs the GM.
 * @file scripts/ui/GMConsole/tabs/businesses.js
 * @description Action handlers run with `this` set to the console window.
 */

import { holders, totalUnits, bookValue, lastDigest, fundingShortfall, ARCHETYPES } from '../../../engine/index.js';
import { BusinessService } from '../../../services/BusinessService.js';
import { BusinessApp } from '../../Business/BusinessApp.js';
import { dayText } from '../../Business/context.js';
import { L, whole, signed } from '../../format.js';
import { confirm, report } from '../shared.js';

async function onApprove(event, target) {
  report(await BusinessService.approve(target.dataset.id));
}

async function onReject(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.Reject'), L('NCI.GMBusiness.RejectConfirm')))) return;
  report(await BusinessService.reject(target.dataset.id));
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

function onOpen(event, target) {
  BusinessApp.open({ businessId: target.dataset.id });
}

export const actions = {
  businessApprove: onApprove,
  businessReject: onReject,
  businessPartnerLeaves: onPartnerLeaves,
  businessRemove: onRemove,
  businessOpen: onOpen,
};

/** How many businesses are waiting for the GM, for the tab's label. */
export function waiting() {
  return BusinessService.snapshot().filter(({ business }) => business.status === 'pending').length;
}

export function context() {
  const rows = BusinessService.snapshot().map(({ business: b, hidden }) => {
    const units = totalUnits(b);
    const last = lastDigest(b);
    return {
      id: b.id,
      name: b.name,
      archetype: L(`NCI.Business.Archetype.${b.archetype}.Name`),
      status: L(`NCI.Business.Status.${b.status}`),
      isPending: b.status === 'pending',
      isForming: b.status === 'forming',
      isOpen: b.status === 'open',
      location: b.location,
      partners: b.partners.filter((p) => p.status !== 'declined').map((p) => {
        const share = units > 0 && ['active', 'leaving'].includes(p.status) ? ` ${((p.units / units) * 100).toFixed(0)}%` : '';
        return `${p.name} (${L(`NCI.Business.PartnerStatus.${p.status}`)}${share})`;
      }).join(', '),
      leavers: holders(b).filter((p) => p.status === 'active').map((p) => ({ value: p.actorId, label: p.name })),
      money: b.status === 'forming' || b.status === 'pending'
        ? L('NCI.GMBusiness.MoneyForming', { escrow: whole(b.escrow), short: whole(fundingShortfall(b) ?? 0) })
        : L('NCI.GMBusiness.MoneyOpen', { till: whole(b.till), book: whole(bookValue(b)) }),
      setup: b.setup ? L(b.setup.passed ? 'NCI.GMBusiness.SetupPassed' : 'NCI.GMBusiness.SetupFailed', {
        band: L(`NCI.Roll.Band.${b.setup.band}`), cost: whole(b.setup.cost ?? 0), range: ARCHETYPES[b.archetype].setup.map(whole).join('–'),
      }) : '',
      state: b.status === 'open'
        ? L('NCI.GMBusiness.State', { rep: b.state.reputation.toFixed(0), cap: b.state.capacity.toFixed(2), cost: b.state.costFactor.toFixed(3), exposure: hidden.exposure ?? 0 })
        : '',
      last: last ? L('NCI.GMBusiness.LastWeek', { n: last.index, profit: signed(last.profit), takings: whole(last.takings), upkeep: whole(last.upkeep) }) : '',
      week: b.status === 'open' ? L('NCI.GMBusiness.Week', { n: b.period.index, end: dayText(b.period.endDay), used: b.period.slots.length }) : '',
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
