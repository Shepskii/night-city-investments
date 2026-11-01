/**
 * GM Console factions tab: the list of factions, and each business's true standing with them
 * @file scripts/ui/GMConsole/tabs/factions.js
 * @description Action handlers run with `this` set to the console window (F1a, DESIGN §36.3).
 */

import { DISTRICTS, FACTION_KINDS, standingBand } from '../../../engine/index.js';
import { FactionRepository } from '../../../data/FactionRepository.js';
import { BusinessRepository } from '../../../data/BusinessRepository.js';
import { MarketStore } from '../../../data/MarketStore.js';
import { BusinessService } from '../../../services/BusinessService.js';
import { L } from '../../format.js';
import { confirm, report } from '../shared.js';

/** A district list as the GM types it: ids separated by commas or spaces. */
const parseDistricts = (value) => String(value ?? '').split(/[\s,]+/).filter(Boolean);

/** What the row or form holding this button says. */
const rowFields = (target) => {
  const box = target.closest('[data-faction-row]');
  const value = (name) => box?.querySelector(`[name="${name}"]`)?.value ?? '';
  return { name: value('name'), kind: value('kind'), ticker: value('ticker'), districts: parseDistricts(value('districts')) };
};

async function onImport() {
  report(await FactionRepository.importStarter());
  this.render();
}

async function onAdd(event, target) {
  report(await FactionRepository.save(rowFields(target)));
  this.render();
}

async function onSave(event, target) {
  const before = FactionRepository.get(target.dataset.id);
  report(await FactionRepository.save({ ...before, ...rowFields(target), id: target.dataset.id }));
  this.render();
}

async function onRemove(event, target) {
  const faction = FactionRepository.get(target.dataset.id);
  if (!faction || !(await confirm(L('NCI.Faction.Remove'), L('NCI.Faction.RemoveConfirm', { name: faction.name })))) return;
  report(await FactionRepository.remove(faction.id));
  this.render();
}

async function onSetStanding(event, target) {
  const box = target.closest('[data-standing-row]');
  const factionId = box?.querySelector('[name="standingFaction"]')?.value;
  const value = Number(box?.querySelector('[name="standingValue"]')?.value);
  if (!factionId || !Number.isFinite(value)) return;
  report(await BusinessService.setStanding(target.dataset.id, factionId, value));
  this.render();
}

export const actions = {
  factionImport: onImport,
  factionAdd: onAdd,
  factionSave: onSave,
  factionRemove: onRemove,
  factionSetStanding: onSetStanding,
};

export function context() {
  const factions = FactionRepository.list();
  const hidden = MarketStore.getBusinessesHidden();
  const kinds = (kind) => FACTION_KINDS.map((k) => ({ value: k, label: L(`NCI.Faction.Kind.${k}`), selected: k === kind }));
  return {
    factions: {
      rows: factions.map((f) => ({ ...f, districtText: f.districts.join(', '), kinds: kinds(f.kind) })),
      newKinds: kinds('gang'),
      districtIds: Object.keys(DISTRICTS).join(', '),
      options: factions.map((f) => ({ value: f.id, label: f.name })),
      // Every open business's true standing; what its players see is only the band.
      businesses: BusinessRepository.all().filter((b) => b.status === 'open').map((b) => ({
        id: b.id,
        name: b.name,
        standings: Object.entries(hidden[b.id]?.standing ?? {}).flatMap(([id, e]) => {
          const faction = factions.find((f) => f.id === id);
          return faction ? [{ name: faction.name, value: e.value, band: L(`NCI.Faction.Band.${standingBand(e.value)}`) }] : [];
        }),
      })),
    },
  };
}
