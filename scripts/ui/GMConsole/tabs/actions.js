/**
 * GM Console corporate actions tab: special dividends, splits, buyouts, delistings and bankruptcies.
 * @file scripts/ui/GMConsole/tabs/actions.js
 * @description Action handlers run with `this` set to the console window.
 */

import { L, money } from '../../format.js';
import { CompanyRepository } from '../../../data/CompanyRepository.js';
import { CorporateActionService } from '../../../services/CorporateActionService.js';
import { DividendService } from '../../../services/DividendService.js';
import { field, confirm, report, companyOptions } from '../shared.js';

async function onSpecialDividend(event, target) {
  report(await DividendService.declareSpecial(field(target, 'divCompany'), Number(field(target, 'divAmount'))));
}

async function onSplit(event, target) {
  const id = field(target, 'splitCompany');
  const ratio = Math.floor(Number(field(target, 'splitRatio')));
  const company = CompanyRepository.get(id);
  if (!company || !(await confirm(L('NCI.Actions.Split'), L('NCI.Actions.SplitConfirm', { name: company.name, ratio })))) return;
  report(await CorporateActionService.split(id, ratio));
}

async function onBuyout(event, target) {
  const id = field(target, 'buyoutCompany');
  const price = Number(field(target, 'buyoutPrice'));
  const company = CompanyRepository.get(id);
  if (!company || !(await confirm(L('NCI.Actions.Buyout'), L('NCI.Actions.BuyoutConfirm', { name: company.name, price: money(price) })))) return;
  report(await CorporateActionService.buyout(id, price));
}

async function onDelist(event, target) {
  const id = field(target, 'endCompany');
  const company = CompanyRepository.get(id);
  if (!company || !(await confirm(L('NCI.Actions.Delist'), L('NCI.Actions.DelistConfirm', { name: company.name })))) return;
  report(await CorporateActionService.delist(id));
}

async function onBankrupt(event, target) {
  const id = field(target, 'endCompany');
  const company = CompanyRepository.get(id);
  if (!company || !(await confirm(L('NCI.Actions.Bankrupt'), L('NCI.Actions.BankruptConfirm', { name: company.name })))) return;
  report(await CorporateActionService.bankrupt(id));
}

export const actions = {
  specialDividend: onSpecialDividend,
  splitStock: onSplit,
  buyoutStock: onBuyout,
  delistStock: onDelist,
  bankruptStock: onBankrupt,
};

export function context() {
  return { companyOptions: companyOptions() };
}
