/**
 * GM Console production tab: what each kind of business can make.
 * @file scripts/ui/GMConsole/tabs/production.js
 * @description Action handlers run with `this` set to the console window (P1a, DESIGN §36.10).
 */

import { ARCHETYPES, tierOf, takesContracts, contractItems, contractSectors, contractLimit, liveContracts } from '../../../engine/index.js';
import { ProductionCatalog } from '../../../data/ProductionCatalog.js';
import { BusinessRepository } from '../../../data/BusinessRepository.js';
import { BusinessService } from '../../../services/BusinessService.js';
import { dayText } from '../../Business/context.js';
import { L, whole } from '../../format.js';
import { report } from '../shared.js';

/** The Write a contract form (C1): a player's workshop, a corporation, and an item off that business's list. */
function contractForm(app) {
  const businesses = BusinessRepository.all().filter((b) => takesContracts(b)).sort((x, y) => x.name.localeCompare(y.name));
  const chosen = businesses.find((b) => b.id === app.contractBusiness) ?? businesses[0] ?? null;
  if (!chosen) return { businesses: [], none: L('NCI.Contract.NoWorkshops') };
  const sectors = contractSectors(chosen);
  const corps = BusinessService.contractCorps().sort((x, y) => Number(sectors.includes(y.sector)) - Number(sectors.includes(x.sector)) || x.name.localeCompare(y.name));
  const full = liveContracts(chosen).length >= contractLimit(chosen);
  return {
    businesses: businesses.map((b) => ({ value: b.id, label: b.name, selected: b.id === chosen.id })),
    corps: corps.map((c) => ({ value: c.id, label: `${c.ticker} — ${c.name}${sectors.includes(c.sector) ? '' : ` (${L(`NCI.Sector.${c.sector}`)})`}` })),
    items: contractItems(chosen, ProductionCatalog.list(chosen.archetype)).map((r) => ({ value: r.uuid, label: `${r.name} (${whole(r.price)} eb)` })),
    weeks: 4,
    full: full ? L('NCI.Contract.Full', { name: chosen.name, n: contractLimit(chosen) }) : '',
  };
}

/** Every contract waiting, offered or open, for the GM to see at a glance (C1). */
const contractRows = () => BusinessRepository.all().flatMap((b) => liveContracts(b).map((c) => ({
  business: b.name, corp: c.corp.name, item: c.item.name, progress: `${c.made} / ${c.count}`, total: whole(c.total),
  status: L(`NCI.Contract.Status.${c.status}`, { date: c.due != null ? dayText(c.due) : '', expires: c.expires != null ? dayText(c.expires) : '' }),
})));

const chosen = (app) => (ARCHETYPES[app.productionArchetype] ? app.productionArchetype : Object.keys(ARCHETYPES)[0]);

export function context(app) {
  const archetype = chosen(app);
  const rows = ProductionCatalog.list(archetype).map((r) => {
    const tier = tierOf(r.price);
    return {
      ...r,
      priceText: whole(r.price),
      tier: tier ? L(`NCI.Production.Tier.${tier.id}`) : L('NCI.Production.TooDear'),
      dv: tier?.dv ?? '',
      typeName: L(`NCI.Production.ItemType.${r.type}`),
    };
  });
  return {
    production: {
      archetypes: Object.keys(ARCHETYPES).map((id) => ({ id, label: L(`NCI.Business.Archetype.${id}.Name`), selected: id === archetype })),
      archetype,
      rows,
      removed: ProductionCatalog.removed(archetype),
      contract: contractForm(app),
      contracts: contractRows(),
    },
  };
}

async function onAdd(event, target) {
  const box = target.closest('[data-production-add]');
  report(await ProductionCatalog.add(chosen(this), box?.querySelector('[name="uuid"]')?.value ?? ''));
  this.render();
}

async function onRemove(event, target) {
  report(await ProductionCatalog.remove(chosen(this), target.dataset.uuid));
  this.render();
}

async function onRestore(event, target) {
  report(await ProductionCatalog.restore(chosen(this), target.dataset.uuid));
  this.render();
}

async function onIllegal(event, target) {
  report(await ProductionCatalog.setIllegal(target.dataset.uuid, target.dataset.illegal !== 'true'));
  this.render();
}

/** The GM writes a contract by hand (C1). */
async function onWriteContract(event, target) {
  const box = target.closest('[data-contract-form]');
  const read = (name) => box?.querySelector(`[name="${name}"]`)?.value ?? '';
  const done = await BusinessService.writeContract(read('contractBusiness'), {
    companyId: read('contractCorp'), uuid: read('contractItem'), count: read('contractCount'), unit: read('contractUnit'), weeks: read('contractWeeks'),
  });
  if (done.ok) ui.notifications.info(L('NCI.Contract.Written'));
  else ui.notifications.warn(game.i18n.has(`NCI.Contract.Reason.${done.reason}`) ? L(`NCI.Contract.Reason.${done.reason}`) : L('NCI.GMConsole.ActionFailed'));
  this.render();
}

export const actions = {
  productionWriteContract: onWriteContract,
  productionAdd: onAdd,
  productionRemove: onRemove,
  productionRestore: onRestore,
  productionIllegal: onIllegal,
};
