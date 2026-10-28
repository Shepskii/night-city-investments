/**
 * GM Console gigs tab: gig outcomes from Night City Map, client mappings and history.
 * @file scripts/ui/GMConsole/tabs/gigs.js
 * @description Action handlers run with `this` set to the console window.
 */

import { L } from '../../format.js';
import { CompanyRepository } from '../../../data/CompanyRepository.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { GigImpactService } from '../../../services/GigImpactService.js';
import { field, gigField, report, gigResult, companyOptions } from '../shared.js';

const BRIDGE_ID = 'night-city-map-night-city-investments-bridge';

async function onGigApprove(event, target) {
  const edits = {
    percent: Number(gigField(target, 'gigPercent')?.value),
    delayDays: Number(gigField(target, 'gigDelay')?.value),
    headline: gigField(target, 'gigHeadline')?.value ?? '',
  };
  gigResult(await GigImpactService.approve(target.dataset.id, edits));
}

async function onGigDiscard(event, target) {
  await GigImpactService.discard(target.dataset.id);
}

async function onGigMap(event, target) {
  const choice = gigField(target, 'gigCompany')?.value;
  if (!choice) return ui.notifications.warn(L('NCI.Gig.ChooseCompany'));
  const remember = gigField(target, 'gigRemember')?.checked !== false;
  await GigImpactService.mapClient(target.dataset.id, choice, { remember });
}

async function onGigAddMapping(event, target) {
  const client = field(target, 'mapClientName');
  const choice = field(target, 'mapCompany');
  if (!String(client ?? '').trim() || !choice) return ui.notifications.warn(L('NCI.Gig.Result.invalid'));
  report((await GigImpactService.addMapping(client, choice))?.ok);
}

async function onGigRemoveMapping(event, target) {
  await GigImpactService.removeMapping(target.dataset.key);
}

async function onGigReport(event, target) {
  const out = await GigImpactService.reportManual({
    client: field(target, 'reportClient') ?? '',
    outcome: field(target, 'reportOutcome'),
    reward: field(target, 'reportReward'),
    companyId: field(target, 'reportCompany') ?? '',
  });
  gigResult(out);
}

async function onGigClearHistory() {
  await GigImpactService.clearHistory();
}

export const actions = {
  gigApprove: onGigApprove,
  gigDiscard: onGigDiscard,
  gigMap: onGigMap,
  gigAddMapping: onGigAddMapping,
  gigRemoveMapping: onGigRemoveMapping,
  gigReport: onGigReport,
  gigClearHistory: onGigClearHistory,
};

export function context() {
  return { gig: build(companyOptions()) };
}

function build(companyOptions) {
  const gigs = MarketStore.getGigs();
  const byId = new Map(CompanyRepository.all({ includeUnlisted: true }).map((c) => [c.id, c]));
  const label = (id) => (byId.has(id) ? `${byId.get(id).ticker} ${byId.get(id).name}` : id);
  const sign = (n) => `${n > 0 ? '+' : ''}${n}`;
  const base = (p) => ({
    id: p.id,
    title: p.title,
    client: p.client || '—',
    outcome: L(`NCI.Gig.Outcome.${p.outcome}`),
    up: p.outcome === 'done',
    reward: Number(p.reward ?? 0).toLocaleString(),
    date: p.date,
    reason: p.reason ? L(`NCI.Gig.Reason.${p.reason}`) : '',
  });

  return {
    bridge: !!game.modules?.get(BRIDGE_ID)?.active,
    approval: GigImpactService.approvalRequired(),
    needsMapping: gigs.pending.filter((p) => p.kind === 'mapping').map((p) => ({
      ...base(p),
      possible: p.candidates?.length ? L('NCI.Gig.Possible', { names: p.candidates.map(label).join(', ') }) : '',
      options: companyOptions.map((o) => ({ ...o, selected: o.value === p.candidates?.[0] })),
    })),
    review: gigs.pending.filter((p) => p.kind === 'review').map((p) => ({
      ...base(p),
      company: label(p.companyId),
      percent: p.percent,
      delayDays: p.delayDays,
      headline: p.headline ?? '',
      how: L(`NCI.Gig.How.${p.how}`),
    })),
    mappings: Object.entries(gigs.mappings).map(([key, m]) => ({
      key,
      label: m.label,
      target: m.companyId === 'ignore' ? L('NCI.Gig.Ignore') : label(m.companyId),
    })),
    history: gigs.history.slice(-15).reverse().map((h) => ({
      ...base(h),
      company: h.companyId ? label(h.companyId) : '—',
      status: L(`NCI.Gig.Status.${h.status}`),
      applied: h.status === 'applied',
      effect: h.status === 'applied' ? `${sign(h.percent)}%` : '',
    })),
    outcomes: ['done', 'failed'].map((o) => ({ value: o, label: L(`NCI.Gig.Outcome.${o}`) })),
  };
}
