/**
 * GM Console production tab: what each kind of business can make.
 * @file scripts/ui/GMConsole/tabs/production.js
 * @description Action handlers run with `this` set to the console window (P1a, DESIGN §36.10).
 */

import { ARCHETYPES, tierOf } from '../../../engine/index.js';
import { ProductionCatalog } from '../../../data/ProductionCatalog.js';
import { L, whole } from '../../format.js';
import { report } from '../shared.js';

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

export const actions = {
  productionAdd: onAdd,
  productionRemove: onRemove,
  productionRestore: onRestore,
  productionIllegal: onIllegal,
};
