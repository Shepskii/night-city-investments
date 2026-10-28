/**
 * GM Console funds tab: the fund list, the editor and closing funds.
 * @file scripts/ui/GMConsole/tabs/funds.js
 * @description Action handlers run with `this` set to the console window.
 */

import { L, money } from '../../format.js';
import { FundRepository } from '../../../data/FundRepository.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { FundService } from '../../../services/FundService.js';
import { FundEditorApp } from '../../FundEditor/FundEditorApp.js';
import { confirm, report } from '../shared.js';

function onNewFund() {
  FundEditorApp.edit(null);
}

function onEditFund(event, target) {
  FundEditorApp.edit(target.dataset.id);
}

async function onCloseFund(event, target) {
  const fund = FundRepository.get(target.dataset.id);
  if (!fund || !(await confirm(L('NCI.GMConsole.CloseFund'), L('NCI.GMConsole.CloseFundConfirm', { name: fund.name })))) return;
  report((await FundService.liquidate(fund.id)).ok);
}

async function onImportFunds() {
  const { created, skipped } = await FundService.importStarter();
  ui.notifications.info(L('NCI.GMConsole.ImportDone', { created, skipped }));
}

export const actions = {
  newFund: onNewFund,
  editFund: onEditFund,
  closeFund: onCloseFund,
  importFunds: onImportFunds,
};

export function context() {
  const pub = MarketStore.getPublic();
  return {
    funds: FundRepository.all().map((f) => ({
      id: f.id,
      ticker: f.ticker,
      name: f.name,
      kind: L(`NCI.FundKind.${f.kind}`),
      nav: pub.funds?.[f.id] ? money(pub.funds[f.id].nav) : '—',
      holdings: f.components.length,
      fees: `${(f.expenseRatio * 100).toFixed(2)}% / ${f.loadBps}-${f.exitBps} bps`,
    })),
  };
}
