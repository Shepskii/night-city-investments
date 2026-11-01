/**
 * GM Console gigs tab: gig outcomes from Night City Map, client mappings and history.
 * @file scripts/ui/GMConsole/tabs/gigs.js
 * @description Action handlers run with `this` set to the console window.
 */

import { L } from '../../format.js';
import { CompanyRepository } from '../../../data/CompanyRepository.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { BusinessRepository } from '../../../data/BusinessRepository.js';
import { GigImpactService } from '../../../services/GigImpactService.js';
import { field, gigField, report, gigResult, companyOptions } from '../shared.js';

const BRIDGE_ID = 'night-city-map-night-city-investments-bridge';

async function onGigApprove(event, target) {
  const edits = {
    percent: Number(gigField(target, 'gigPercent')?.value),
    delayDays: Number(gigField(target, 'gigDelay')?.value),
    headline: gigField(target, 'gigHeadline')?.value ?? '',
    useTarget: !!gigField(target, 'gigUseTarget')?.checked,
  };
  gigResult(await GigImpactService.approve(target.dataset.id, edits));
}

async function onGigApproveBusiness(event, target) {
  gigResult(await GigImpactService.approveBusiness(target.dataset.id, { useTarget: !!gigField(target, 'gigUseTarget')?.checked }));
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
  gigApproveBusiness: onGigApproveBusiness,
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
  const businesses = new Map(BusinessRepository.all().map((b) => [b.id, b.name]));
  // The other parties a gig moves (F1a), and a target only found in its text, which the GM must tick.
  const parties = (p) => {
    const textTarget = p.target?.how === 'text';
    return {
      alsos: (p.extras ?? []).map((e) => ({ text: L(`NCI.Gig.Also.${e.role}`, { name: e.name, percent: sign(e.percent) }), unsure: textTarget && e.role === 'target' })),
      targetNote: p.target ? L(textTarget ? 'NCI.Gig.TargetFound' : 'NCI.Gig.TargetTagged', { name: p.target.name }) : '',
      confirmTarget: textTarget,
    };
  };
  const target = (h) => (h.companyId ? label(h.companyId) : h.businessId ? L('NCI.Gig.BusinessLabel', { name: businesses.get(h.businessId) ?? h.businessId }) : '—');
  const ownEffect = (h) => L('NCI.Gig.BusinessEffect', { reputation: sign(h.reputation ?? 0), takings: sign(Math.round((h.takings ?? 0) * 100)) });
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
      ...parties(p),
      company: label(p.companyId),
      percent: p.percent,
      delayDays: p.delayDays,
      headline: p.headline ?? '',
      how: L(`NCI.Gig.How.${p.how}`),
    })),
    businessGigs: gigs.pending.filter((p) => p.kind === 'business').map((p) => ({
      ...base(p),
      ...parties(p),
      business: businesses.get(p.businessId) ?? p.businessId,
      // A gig tagged for the business, for a faction, also moves its standing with them (F1a).
      effect: [ownEffect(p), ...(p.factionName ? [L('NCI.Gig.StandingEffect', { faction: p.factionName })] : [])].join('; '),
      weaker: p.recent ? L('NCI.Gig.Weaker', { n: p.recent }) : '',
      how: L(`NCI.Gig.How.${p.how}`),
    })),
    mappings: Object.entries(gigs.mappings).map(([key, m]) => ({
      key,
      label: m.label,
      target: m.companyId === 'ignore' ? L('NCI.Gig.Ignore') : label(m.companyId),
    })),
    history: gigs.history.slice(-15).reverse().map((h) => ({
      ...base(h),
      company: target(h),
      status: L(`NCI.Gig.Status.${h.status}`),
      applied: h.status === 'applied',
      effect: h.status !== 'applied' ? '' : h.businessId ? ownEffect(h) : `${sign(h.percent)}%`,
    })),
    outcomes: ['done', 'failed'].map((o) => ({ value: o, label: L(`NCI.Gig.Outcome.${o}`) })),
  };
}
