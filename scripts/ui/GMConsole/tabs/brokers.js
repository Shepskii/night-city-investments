/**
 * GM Console brokers tab: brokers, their terms, and terminal access grants.
 * @file scripts/ui/GMConsole/tabs/brokers.js
 * @description Action handlers run with `this` set to the console window.
 */

import { L } from '../../format.js';
import { BrokerRepository } from '../../../data/BrokerRepository.js';
import { TerminalAccess } from '../../../services/TerminalAccess.js';
import { TradingSettings } from '../../../services/TradingSettings.js';
import { field, confirm, report } from '../shared.js';

async function onAddBrokerActor(event, target) {
  const id = field(target, 'brokerActor');
  if (!id) return;
  report(await BrokerRepository.makeBrokerFromActor(id));
  this.render();
}

async function onAddBrokerContact(event, target) {
  const id = field(target, 'brokerContact');
  if (!id) return;
  report(await BrokerRepository.makeBrokerFromContact(id));
  this.render();
}

async function onToggleBroker(event, target) {
  await BrokerRepository.setDef(target.dataset.id, { enabled: target.dataset.enabled !== 'true' });
  this.render();
}

async function onRemoveBroker(event, target) {
  const broker = BrokerRepository.get(target.dataset.id);
  if (!broker) return;
  if (!(await confirm(L('NCI.GMConsole.RemoveBroker'), L('NCI.GMConsole.RemoveBrokerConfirm', { name: broker.name })))) return;
  const out = await BrokerRepository.remove(broker.id);
  if (out.ok) ui.notifications.info(L('NCI.GMConsole.BrokerRemoved', { name: broker.name }));
  else ui.notifications.warn(L(`NCI.GMConsole.RemoveBrokerRefused.${out.reason}`, { names: (out.names ?? []).join(', ') }));
  this.render();
}

/** Save the manual rating and minimum withdrawal in this broker's table row. */
async function onSaveBroker(event, target) {
  const row = target.closest('tr');
  const manual = row?.querySelector('[name="manualTotal"]');
  const patch = { minWithdrawal: Math.max(0, Math.floor(Number(row?.querySelector('[name="minWithdrawal"]')?.value) || 0)) };
  if (manual) patch.manualTotal = Math.max(0, Math.min(30, Math.floor(Number(manual.value) || 0)));
  report(await BrokerRepository.setDef(target.dataset.id, patch));
  this.render();
}

async function onToggleGrant(event, target) {
  const actor = game.actors.get(target.dataset.id);
  if (!actor) return;
  await TerminalAccess.setGrant(actor, !TerminalAccess.granted(actor));
  this.render();
}

export const actions = {
  addBrokerActor: onAddBrokerActor,
  addBrokerContact: onAddBrokerContact,
  toggleBroker: onToggleBroker,
  removeBroker: onRemoveBroker,
  saveBroker: onSaveBroker,
  toggleGrant: onToggleGrant,
};

export function context() {
  return { broker: build() };
}

function build() {
  const direct = TradingSettings.direct();
  const useOf = (id) => {
    const use = BrokerRepository.usage(id);
    const names = [...use.assigned, ...use.busy];
    return { inUse: names.length ? L('NCI.GMConsole.BrokerInUse', { names: names.join(', ') }) : '', canRemove: !names.length };
  };
  const brokers = BrokerRepository.list().map((b) => ({
    ...useOf(b.id),
    id: b.id,
    name: b.name,
    source: b.skill.source === 'sheet' ? L('NCI.GMConsole.SkillSheet') : L('NCI.GMConsole.SkillManual'),
    manual: b.skill.source === 'manual',
    noSkillItem: b.skill.source === 'sheet' && !b.skill.found,
    total: b.skill.total,
    grade: L(`NCI.Grade.${b.grade}`),
    voice: b.personality ? L(`NCI.Voice.${b.personality}`) : L('NCI.Voice.standard'),
    commission: `${(b.terms.commissionBps / 100).toFixed(2)}%`,
    flatFee: b.terms.flatFee,
    days: b.terms.latency.min === b.terms.latency.max ? `${b.terms.latency.min}` : `${b.terms.latency.min}-${b.terms.latency.max}`,
    enabled: b.enabled,
    minWithdrawal: b.minWithdrawal,
  }));
  const actors = game.actors.filter((a) => a.hasPlayerOwner);
  return {
    brokers,
    direct: { commission: `${(direct.commissionBps / 100).toFixed(2)}%`, flatFee: direct.flatFee, dv: direct.dv, network: direct.network },
    terminalMode: TradingSettings.mode() === 'terminal',
    actorOptions: game.actors.filter((a) => a.type === 'character' || a.type === 'npc').map((a) => ({ value: a.id, label: a.name })),
    contactOptions: BrokerRepository.candidateContacts().map((c) => ({ value: c.id, label: c.name })),
    grants: actors.map((a) => ({ id: a.id, name: a.name, granted: TerminalAccess.granted(a) })),
  };
}
