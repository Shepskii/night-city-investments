/**
 * GM Console Job Market tab: jobs at market corporations (N4, DESIGN §36.17)
 * @file scripts/ui/GMConsole/tabs/jobMarket.js
 * @description Setting up a market company's jobs, and each employer with its staff. Action handlers run with `this`
 *              set to the console window. Applications and promotions wait on Pending, which opens this tab.
 */

import { BUSINESS_DEFAULTS, bossBand, postRate, standingOf } from '../../../engine/index.js';
import { EmployerService } from '../../../services/EmployerService.js';
import { CompanyRepository } from '../../../data/CompanyRepository.js';
import { archetypeOptions } from '../../Business/context.js';
import { L, whole } from '../../format.js';
import { confirm } from '../shared.js';
import { actorLink } from '../../actorLink.js';

/** Say how it went: what was refused, in words, if there are any. */
function corpReport(done) {
  if (done?.ok) return ui.notifications.info(L('NCI.GMConsole.ActionOk'));
  const key = `NCI.Business.Reason.${done?.reason}`;
  return ui.notifications.warn(game.i18n.has(key) ? L(key) : L('NCI.GMConsole.ActionFailed'));
}

/** The kind, DV, place, hiring and roles, from the form block around the button. */
function corpFields(target) {
  const box = target.closest('.nci-form');
  const read = (name) => box?.querySelector(`[name="${name}"]`);
  return {
    archetype: read('corpKind')?.value,
    dv: Number(read('corpDv')?.value),
    location: read('corpLocation')?.value ?? '',
    ...(read('corpOpen') ? { open: read('corpOpen').checked } : {}),
    roles: Object.fromEntries(BUSINESS_DEFAULTS.npc.corp.posts.map((post) => [post, { count: Number(read(`corpCount_${post}`)?.value) || 0, wage: Number(read(`corpWage_${post}`)?.value) || 0 }])),
  };
}

async function onCorpCreate(event, target) {
  const box = target.closest('.nci-form');
  corpReport(await EmployerService.create({ companyId: box?.querySelector('[name="corpCompany"]')?.value, ...corpFields(target) }));
  this.render();
}

async function onCorpSave(event, target) {
  corpReport(await EmployerService.update(target.dataset.id, corpFields(target)));
  this.render();
}

async function onCorpRemove(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.Corp.Remove'), L('NCI.GMBusiness.Corp.RemoveConfirm')))) return;
  corpReport(await EmployerService.remove(target.dataset.id));
  this.render();
}

async function onCorpOffer(event, target) {
  const box = target.closest('.nci-form');
  corpReport(await EmployerService.offer(target.dataset.id, box?.querySelector('[name="corpOfferActor"]')?.value, box?.querySelector('[name="corpOfferPost"]')?.value));
  this.render();
}

async function onCorpDismiss(event, target) {
  if (!(await confirm(L('NCI.GMBusiness.Corp.Dismiss'), L('NCI.GMBusiness.Corp.DismissConfirm')))) return;
  corpReport(await EmployerService.dismiss(target.dataset.id, target.dataset.staff));
  this.render();
}

export const actions = {
  businessCorpCreate: onCorpCreate,
  businessCorpSave: onCorpSave,
  businessCorpRemove: onCorpRemove,
  businessCorpOffer: onCorpOffer,
  businessCorpDismiss: onCorpDismiss,
};

/** The roles grid: every post a corporation can offer, with what is set, or a suggested wage for a new one. */
const corpRoles = (roles = null) => BUSINESS_DEFAULTS.npc.corp.posts.map((post) => ({
  post,
  label: L(`NCI.Staff.Post.${post}`),
  count: roles?.[post]?.count ?? 0,
  wage: roles?.[post]?.wage ?? postRate(post, BUSINESS_DEFAULTS.npc.jobs.guideBase, 2),
}));

/** Market corporations' jobs (N4): the new employer form, and each employer with its staff. */
function corpContext() {
  const kinds = (selected) => archetypeOptions().map((o) => ({ ...o, selected: o.value === selected }));
  const players = game.actors.filter((a) => a.type === 'character' && a.hasPlayerOwner).sort((x, y) => x.name.localeCompare(y.name));
  const employers = EmployerService.all().map((e) => {
    const taken = new Set(e.staff.map((s) => s.actorId));
    return {
      id: e.id, name: e.name, ticker: e.ticker, dv: e.dv, location: e.location, open: e.open,
      kindName: L(`NCI.Business.Archetype.${e.archetype}.Name`),
      kinds: kinds(e.archetype),
      gone: !CompanyRepository.get(e.companyId),
      roles: corpRoles(e.roles),
      staff: e.staff.map((s) => {
        const value = Math.round(standingOf(s));
        return {
          id: s.id, who: actorLink(s.actorId, s.name), post: L(`NCI.Staff.Post.${s.post}`), wage: whole(s.wage),
          standing: s.status === 'offered' ? L('NCI.GMBusiness.Corp.Offered') : `${value} (${L(`NCI.Jobs.Standing.${bossBand(value)}`)})${s.warned ? `, ${L('NCI.GMBusiness.Corp.Warned')}` : ''}${s.promotions ? `, ${L('NCI.GMBusiness.Corp.Promoted', { n: s.promotions })}` : ''}`,
          dismissLabel: L(s.status === 'offered' ? 'NCI.GMBusiness.Corp.Withdraw' : 'NCI.GMBusiness.Corp.Dismiss'),
        };
      }),
      offer: {
        characters: players.filter((a) => !taken.has(a.id)).map((a) => ({ value: a.id, label: a.name })),
        posts: Object.entries(e.roles).filter(([post, r]) => e.staff.filter((s) => s.post === post).length < r.count).map(([post]) => ({ value: post, label: L(`NCI.Staff.Post.${post}`) })),
      },
    };
  });
  return {
    companies: CompanyRepository.all({ includeUnlisted: true }).filter((c) => !EmployerService.hasEmployer(c.id)).map((c) => ({ value: c.id, label: `${c.ticker} \u2014 ${c.name}` })),
    kinds: kinds('security'),
    dv: BUSINESS_DEFAULTS.npc.corp.dv,
    form: { roles: corpRoles() },
    employers,
  };
}

export function context() {
  return { jobMarket: corpContext() };
}
