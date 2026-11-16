/**
 * Start a syndicate: a window for its name and who to invite (B3).
 * @file scripts/ui/MarketTerminal/SyndicateFoundApp.js
 * @description Opened from the Start a syndicate button on the market window's Brokerage page, as a business is
 *              started from its own form. The character becomes its first officer; those invited can join or
 *              decline. Founding is a request for the GM, as before.
 */

import { MODULE_ID } from '../../utils/constants.js';
import { SyndicateClient } from '../../services/SyndicateClient.js';
import { accountFor } from '../accounts.js';
import { BaseApplication } from '../BaseApplication.js';
import { characterSyndicates } from './syndicateContext.js';
import { L } from '../format.js';

export class SyndicateFoundApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    tag: 'form',
    window: { title: 'NCI.Syndicate.Found', icon: 'fas fa-people-group', resizable: false },
    position: { width: 560, height: 'auto' },
    form: { handler: SyndicateFoundApp._onSubmit, closeOnSubmit: false, submitOnChange: false },
    actions: { cancel: SyndicateFoundApp._onCancel },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/dialogs/syndicate-found.hbs` },
  };

  /** Open the window for one character; one window at a time. */
  static ask(actorId) {
    const id = 'nci-syndicate-found';
    const existing = foundry.applications.instances?.get?.(id);
    if (existing) {
      existing.actorId = actorId;
      existing.render({ force: true });
      existing.bringToFront?.();
      return existing;
    }
    const app = new SyndicateFoundApp({ id, actorId });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId;
  }

  get actor() {
    return accountFor(this.actorId);
  }

  async _prepareContext() {
    const actor = this.actor;
    return { name: actor?.name ?? '', invites: actor ? (characterSyndicates(actor)?.inviteOptions ?? []) : [] };
  }

  static _onCancel() {
    return this.close();
  }

  static async _onSubmit(event, form) {
    const actor = this.actor;
    if (!actor || actor.isSyndicate) return undefined;
    const name = String(form.elements.synName?.value ?? '').trim();
    if (name.length < 2) return ui.notifications.warn(L('NCI.Syndicate.Reason.bad-name'));
    const invite = [...form.querySelectorAll('input[name="synInvite"]:checked')].map((i) => i.value);
    const key = await SyndicateClient.submit(actor, 'found', { name, invite });
    if (key) await this.close();
    return key;
  }
}
