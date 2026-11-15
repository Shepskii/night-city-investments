/**
 * New NPC business: a window for making a company owned and run by one of the GM's NPCs (N1, GM only).
 * @file scripts/ui/NpcCompany/NpcCompanyApp.js
 * @description Opened from the GM Console's NPC Businesses tab, as a new market company is from Market Companies.
 */

import { MODULE_ID } from '../../utils/constants.js';
import { BusinessService } from '../../services/BusinessService.js';
import { BaseApplication } from '../BaseApplication.js';
import { matchInvites } from '../Business/BusinessApp.js';
import { npcForm } from '../GMConsole/tabs/businesses.js';
import { L } from '../../utils/helpers.js';

/** Find the owner by typing, as a world can hold hundreds of NPCs. */
export function ownerSearch(root) {
  const search = root.querySelector('[name="npcOwnerSearch"]');
  if (!search) return;
  const owner = root.querySelector('[name="npcOwner"]');
  const options = [...root.querySelectorAll('[data-npc-owner]')];
  const names = options.map((o) => o.dataset.name);
  const show = (shown) => options.forEach((o, i) => { o.style.display = shown.has(i) ? '' : 'none'; });
  const pick = (o) => {
    owner.value = o.dataset.id;
    search.value = o.dataset.name;
    show(new Set());
  };
  search.addEventListener('input', () => {
    owner.value = '';
    show(new Set(matchInvites(search.value, names)));
  });
  search.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    const first = options.find((o) => o.style.display !== 'none');
    if (first) pick(first);
  });
  options.forEach((o) => o.addEventListener('click', (event) => {
    event.preventDefault();
    pick(o);
  }));
}

export class NpcCompanyApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    id: 'nci-npc-company',
    tag: 'form',
    window: { title: 'NCI.GMBusiness.Npc.Title', icon: 'fas fa-building', resizable: false },
    position: { width: 600, height: 'auto' },
    form: { handler: NpcCompanyApp._onSubmit, closeOnSubmit: false, submitOnChange: false },
    actions: { cancel: NpcCompanyApp._onCancel },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/gm/npc-company.hbs` },
  };

  /** Open the window, for the GM only. */
  static open(options = {}) {
    if (!game.user.isGM) return null;
    return super.open(options);
  }

  static _onCancel() {
    return this.close();
  }

  static async _onSubmit(event, form, formData) {
    const read = (name) => formData.object[name] ?? '';
    const done = await BusinessService.createNpcCompany({
      name: read('npcName'), archetype: read('npcArchetype'), district: read('npcDistrict'), location: read('npcLocation'), ownerId: read('npcOwner'),
      stage: read('npcStage'), level: read('npcLevel'), profile: read('npcProfile'), cash: read('npcCash'), ticker: read('npcTicker'),
    });
    if (!done.ok) {
      const key = `NCI.GMBusiness.Npc.Reason.${done.reason}`;
      ui.notifications.warn(game.i18n.has(key) ? L(key) : L('NCI.GMConsole.ActionFailed'));
      return;
    }
    ui.notifications.info(L('NCI.GMBusiness.Npc.Created', { name: done.business.name }));
    await this.close();
  }

  async _prepareContext() {
    return { npcForm: npcForm() };
  }

  async _onRender(context, options) {
    await super._onRender?.(context, options);
    ownerSearch(this.element);
  }
}
