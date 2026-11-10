/**
 * GM Console factions tab: the list of factions. Each business's standing is on the Businesses tab.
 * @file scripts/ui/GMConsole/tabs/factions.js
 * @description Action handlers run with `this` set to the console window (F1a, DESIGN §36.3).
 */

import { FACTION_KINDS } from '../../../engine/index.js';
import { FactionRepository } from '../../../data/FactionRepository.js';
import { DistrictService } from '../../../services/DistrictService.js';
import { ContactService } from '../../../services/ContactService.js';
import { NcmAdapter } from '../../../integrations/NcmAdapter.js';
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

/**
 * The Messenger contact a faction's mail comes from (M2), by the name the GM typed: blank lets the first mail make one.
 * @returns {Promise<boolean>} false for a name that isn't a contact
 */
async function saveContact(factionId, target) {
  const name = String(target.closest('[data-faction-row]')?.querySelector('[name="contact"]')?.value ?? '').trim();
  const key = `faction:${factionId}`;
  const current = ContactService.linked(key);
  if (!name) {
    if (current) await ContactService.link(key, null);
    return true;
  }
  if (current && NcmAdapter.contact(current)?.name === name) return true;
  const contact = NcmAdapter.allContacts().find((c) => c.name === name);
  if (!contact) {
    ui.notifications.warn(L('NCI.Faction.ContactUnknown', { name }));
    return false;
  }
  await ContactService.link(key, contact.id);
  return true;
}

async function onSave(event, target) {
  const before = FactionRepository.get(target.dataset.id);
  const saved = await FactionRepository.save({ ...before, ...rowFields(target), id: target.dataset.id });
  if (saved?.ok && !(await saveContact(target.dataset.id, target))) return;
  report(saved);
  this.render();
}

async function onRemove(event, target) {
  const faction = FactionRepository.get(target.dataset.id);
  if (!faction || !(await confirm(L('NCI.Faction.Remove'), L('NCI.Faction.RemoveConfirm', { name: faction.name })))) return;
  report(await FactionRepository.remove(faction.id));
  this.render();
}

/** The GM adjusts a district that came from Night City Map. */
async function onDistrictSave(event, target) {
  const box = target.closest('[data-district-row]');
  const value = (name) => box?.querySelector(`[name="${name}"]`)?.value;
  report(await DistrictService.saveNumbers(target.dataset.id, { traffic: value('traffic'), rent: value('rent'), risk: value('risk') }));
  this.render();
}

export const actions = {
  districtSave: onDistrictSave,
  factionImport: onImport,
  factionAdd: onAdd,
  factionSave: onSave,
  factionRemove: onRemove,
};

export function context() {
  const factions = FactionRepository.list();
  const kinds = (kind) => FACTION_KINDS.map((k) => ({ value: k, label: L(`NCI.Faction.Kind.${k}`), selected: k === kind }));
  const senders = ContactService.senders();
  const contactName = (id) => (senders[`faction:${id}`] ? NcmAdapter.contact(senders[`faction:${id}`])?.name ?? '' : '');
  const messenger = NcmAdapter.available();
  return {
    factions: {
      messenger,
      contactNames: messenger ? [...new Set(NcmAdapter.allContacts().map((c) => c.name).filter(Boolean))].sort((a, b) => a.localeCompare(b)) : [],
      rows: factions.map((f) => ({ ...f, districtText: f.districts.join(', '), kinds: kinds(f.kind), contactName: messenger ? contactName(f.id) : '' })),
      newKinds: kinds('gang'),
      districtIds: DistrictService.idList(),
      districts: DistrictService.rows(),
    },
  };
}
