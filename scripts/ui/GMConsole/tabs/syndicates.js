/**
 * GM Console syndicates tab: every player syndicate, its members and account, and what needs the GM.
 * @file scripts/ui/GMConsole/tabs/syndicates.js
 * @description Action handlers run with `this` set to the console window (DESIGN §31).
 */

import { navOf, syndicateUnits, isLiquid } from '../../../engine/index.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { SyndicateRepository } from '../../../data/SyndicateRepository.js';
import { CompanyRepository } from '../../../data/CompanyRepository.js';
import { FundRepository } from '../../../data/FundRepository.js';
import { SyndicateService } from '../../../services/SyndicateService.js';
import { SyndicateCash } from '../../../services/SyndicateCash.js';
import { HeatService } from '../../../services/HeatService.js';
import { describeProposal } from '../../MarketTerminal/syndicateContext.js';
import { L, money, whole } from '../../format.js';
import { confirm, report } from '../shared.js';

async function onApprove(event, target) {
  report(await SyndicateService.approve(target.dataset.id));
}

async function onReject(event, target) {
  if (!(await confirm(L('NCI.GMSyndicate.Reject'), L('NCI.GMSyndicate.RejectConfirm')))) return;
  report(await SyndicateService.reject(target.dataset.id));
}

async function onPass(event, target) {
  report(await SyndicateService.decide(target.dataset.id, target.dataset.proposal, 'pass'));
}

async function onVeto(event, target) {
  report(await SyndicateService.decide(target.dataset.id, target.dataset.proposal, 'veto'));
}

async function onClose(event, target) {
  if (!(await confirm(L('NCI.GMSyndicate.Close'), L('NCI.GMSyndicate.CloseConfirm')))) return;
  report(await SyndicateService.close(target.dataset.id));
}

export const actions = {
  syndicateApprove: onApprove,
  syndicateReject: onReject,
  syndicatePass: onPass,
  syndicateVeto: onVeto,
  syndicateClose: onClose,
};

/** How many syndicates are waiting for the GM, for the tab's label. */
export function waiting() {
  return SyndicateRepository.all().filter((s) => s.status === 'pending').length;
}

export function context() {
  const pub = MarketStore.getPublic();
  const prices = {
    ...Object.fromEntries(Object.entries(pub.companies ?? {}).map(([id, s]) => [id, s.price])),
    ...Object.fromEntries(Object.entries(pub.funds ?? {}).map(([id, s]) => [id, s.nav])),
  };
  const tickerOf = (id) => CompanyRepository.get(id)?.ticker ?? FundRepository.get(id)?.ticker ?? id;
  const rows = SyndicateRepository.all().map((s) => {
    const portfolio = SyndicateRepository.portfolio(s.id);
    const stakes = SyndicateCash.stakesOf(s.id);
    const { total, nav } = navOf(s, portfolio, prices, stakes);
    const units = syndicateUnits(s);
    const held = {};
    for (const lot of portfolio.lots) held[lot.assetId] = (held[lot.assetId] ?? 0) + lot.qty;
    return {
      id: s.id,
      name: s.name,
      status: L(`NCI.GMSyndicate.Status.${s.status}`),
      isPending: s.status === 'pending',
      isActive: s.status === 'active',
      isClosed: s.status === 'closed',
      members: s.members.filter((m) => ['active', 'invited'].includes(m.status)).map((m) => {
        const share = m.status === 'active' && units > 0 ? `, ${((m.units / units) * 100).toFixed(0)}%` : '';
        return `${m.name} (${m.status === 'invited' ? L('NCI.Syndicate.Invited') : L(`NCI.Syndicate.Role.${m.role}`)}${share})`;
      }).join(', '),
      money: L('NCI.GMSyndicate.Money', { cash: whole(portfolio.cash), total: whole(total), nav: money(nav), limit: whole(s.rules.tradeLimit) }),
      holdings: Object.keys(held).length ? Object.entries(held).map(([id, qty]) => `${tickerOf(id)} ${qty}`).join(', ') : L('NCI.GMSyndicate.NoHoldings'),
      heat: s.status === 'active' && HeatService.enabled() ? L('NCI.GMSyndicate.Heat', { heat: HeatService.heatOf(s.id).toFixed(1), tier: L(`NCI.Heat.Tier.${HeatService.tierOf(s.id)}`) }) : '',
      waitingRedemptions: s.redemptions.filter((r) => r.status === 'waiting').length,
      proposals: s.proposals.map((p) => ({ id: p.id, text: describeProposal(s, p) })),
      liquid: isLiquid(portfolio, stakes),
    };
  });
  return {
    syndicates: {
      enabled: SyndicateService.enabled(),
      pending: rows.filter((r) => r.isPending),
      active: rows.filter((r) => r.isActive),
      closed: rows.filter((r) => r.isClosed),
    },
  };
}
