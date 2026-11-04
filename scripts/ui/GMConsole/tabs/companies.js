/**
 * GM Console companies tab: the company list, the editor and IPO listings.
 * @file scripts/ui/GMConsole/tabs/companies.js
 * @description Action handlers run with `this` set to the console window.
 */

import { ipoStatus, dayIndex } from '../../../engine/index.js';
import { L, money } from '../../format.js';
import { CompanyRepository } from '../../../data/CompanyRepository.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { MarketClock } from '../../../services/MarketClockService.js';
import { ImportService } from '../../../services/ImportService.js';
import { IpoService } from '../../../services/IpoService.js';
import { CompanyEditorApp } from '../../CompanyEditor/CompanyEditorApp.js';
import { confirm, report } from '../shared.js';

function onNew() {
  CompanyEditorApp.edit(null);
}

function onEdit(event, target) {
  CompanyEditorApp.edit(target.dataset.id);
}

async function onDelete(event, target) {
  const company = CompanyRepository.get(target.dataset.id);
  if (!company) return;
  if (!(await confirm(L('NCI.GMConsole.DeleteCompany'), L('NCI.GMConsole.DeleteConfirm', { name: company.name })))) return;
  await CompanyRepository.remove(company.id);
}

async function onImportStarter() {
  const { created, skipped } = await ImportService.importStarter();
  ui.notifications.info(L('NCI.GMConsole.ImportDone', { created, skipped }));
}

async function onListNow(event, target) {
  const company = CompanyRepository.get(target.dataset.id);
  if (!company || !(await confirm(L('NCI.Ipo.ListNow'), L('NCI.Ipo.ListNowConfirm', { name: company.name })))) return;
  report((await IpoService.listNow(company.id))?.ok);
}

export const actions = {
  newCompany: onNew,
  editCompany: onEdit,
  deleteCompany: onDelete,
  importStarter: onImportStarter,
  listNow: onListNow,
};

export function context() {
  const pub = MarketStore.getPublic();
  const today = dayIndex(MarketClock.nowMs());
  const ipoText = (c) => {
    const st = ipoStatus(c, today);
    if (st.state === 'none') return '';
    return st.state === 'due' ? L('NCI.Ipo.ListingToday') : L(st.state === 'window' ? 'NCI.Ipo.WindowOpen' : 'NCI.Ipo.ListsOn', { n: st.daysToList, date: MarketClock.showDate(c.ipo.date) });
  };
  return {
    companies: CompanyRepository.all({ includeUnlisted: true }).map((c) => ({
      id: c.id,
      ticker: c.ticker,
      name: c.name,
      sector: L(`NCI.Sector.${c.sector}`),
      price: pub.companies?.[c.id] ? money(pub.companies[c.id].price) : '—',
      status: L(`NCI.Status.${c.status}`),
      listed: c.listed,
      ipoText: ipoText(c),
      canList: !c.listed && !!pub.companies?.[c.id],
    })),
  };
}
