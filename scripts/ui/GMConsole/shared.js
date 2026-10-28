/**
 * Helpers the GM Console tabs share: reading form fields, confirming, and reporting results.
 * @file scripts/ui/GMConsole/shared.js
 */

import { CompanyRepository } from '../../data/CompanyRepository.js';
import { L } from '../format.js';

/** Read a named input from the form block that contains the clicked button. */
export function field(target, name) {
  const el = target.closest('.nci-form')?.querySelector(`[name="${name}"]`);
  if (!el) return undefined;
  return el.type === 'checkbox' ? el.checked : el.value;
}

/** Read a named input from the nearest enclosing gig card. */
export function gigField(target, name) {
  return target.closest('.nci-gig')?.querySelector(`[name="${name}"]`);
}

export async function confirm(title, content) {
  const result = await foundry.applications.api.DialogV2.confirm({
    window: { title },
    content: `<p>${content}</p>`,
    rejectClose: false,
    modal: true,
  });
  return !!result;
}

/** Tell the GM whether an action worked. */
export function report(result, okKey = 'NCI.GMConsole.ActionOk') {
  const ok = result === true || result?.ok === true || (typeof result === 'number' && result >= 0);
  if (ok) ui.notifications.info(L(okKey));
  else ui.notifications.warn(L('NCI.GMConsole.ActionFailed'));
  return ok;
}

/** Tell the GM what happened to a gig report or decision. */
export function gigResult(out) {
  const status = out?.status ?? 'failed';
  const key = ['applied', 'pending', 'unmatched', 'ignored', 'duplicate', 'disabled', 'invalid', 'not-gm'].includes(status) ? status : 'failed';
  const text = L(`NCI.Gig.Result.${key}`, { days: out?.delayDays ?? '' });
  if (out?.ok && key !== 'failed') ui.notifications.info(text);
  else ui.notifications.warn(text);
  return out?.ok;
}

export function targetLabel(target, byId) {
  if (target.type === 'market') return L('NCI.Controls.WholeMarket');
  if (target.type === 'sector') return L(`NCI.Sector.${target.id}`);
  return byId.get(target.id)?.ticker ?? target.id;
}

/** Every company, listed or not, by id. */
export function companiesById() {
  return new Map(CompanyRepository.all({ includeUnlisted: true }).map((c) => [c.id, c]));
}

/** Every company, listed or not, as select options. */
export function companyOptions() {
  return CompanyRepository.all({ includeUnlisted: true }).map((c) => ({ value: c.id, label: `${c.ticker} ${c.name}` }));
}
