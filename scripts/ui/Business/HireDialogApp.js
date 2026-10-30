/**
 * Hire window: filling one post on a business's staff (DESIGN §33).
 * @file scripts/ui/Business/HireDialogApp.js
 * @description Opened from a post's Hire button on the Staff tab. The partners can propose hiring a
 *              character (a player character, or an NPC tagged staff or employee in Night City
 *              Messenger) at a share of the going rate, or advertise the job: a roll that brings one to
 *              three applicants, each with their own skill and the wage they ask, listed at the foot of
 *              the Staff tab. The window closes once the advert's roll is made. Everything is a request
 *              for the GM, as in the Business window.
 */

import { partnerOf, postOpen } from '../../engine/index.js';
import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient, staffActors } from '../../services/BusinessClient.js';
import { accountFor } from '../accounts.js';
import { BaseApplication } from '../BaseApplication.js';
import { RollDialogApp } from './RollDialogApp.js';
import { hireContext } from './context.js';
import { L } from '../format.js';

export class HireDialogApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    window: { title: 'NCI.Staff.HireTitle', icon: 'fas fa-user-plus', resizable: true },
    position: { width: 620, height: 'auto' },
    actions: {
      hireCharacter: HireDialogApp._onHireCharacter,
      advertise: HireDialogApp._onAdvertise,
      close: HireDialogApp._onClose,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/dialogs/hire.hbs` },
  };

  /** Open the window for one post of one business, as the account picked in the Business window. */
  static ask({ actorId, businessId, post }) {
    const id = `nci-hire-${businessId}-${post}`;
    const existing = foundry.applications.instances?.get?.(id);
    if (existing) {
      existing.actorId = actorId;
      existing.render({ force: true });
      return existing;
    }
    const app = new HireDialogApp({ id, actorId, businessId, post });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId;
    this.businessId = options.businessId;
    this.post = options.post;
    this._refresh = () => this.render();
  }

  get account() {
    return accountFor(this.actorId);
  }

  get business() {
    return BusinessRepository.get(this.businessId);
  }

  get title() {
    return L('NCI.Staff.HireTitle', { post: L(`NCI.Staff.Post.${this.post}`) });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Hooks.on(HOOKS.BUSINESSES_CHANGED, this._refresh);
  }

  /** The "Hire a character" block takes a character dragged from the Actors directory. */
  _onRender(context, options) {
    super._onRender?.(context, options);
    const zone = this.element?.querySelector('.nci-hiredrop');
    if (!zone) return;
    zone.addEventListener('dragover', (event) => {
      event.preventDefault();
      zone.classList.add('nci-over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('nci-over'));
    zone.addEventListener('drop', (event) => {
      zone.classList.remove('nci-over');
      this._onDropStaff(event);
    });
  }

  /**
   * A character dropped on the window: checked here as far as this client can (that they may be
   * hired, are not a partner or on the staff already, and the role is open), then, once confirmed, a
   * hire proposal for this role at the pay set in the form. The GM's side checks it all again.
   */
  async _onDropStaff(event) {
    event.preventDefault();
    const business = this.business;
    const account = this.account;
    if (!business || !account || (account.isSyndicate && !account.isOfficer)) return null;
    const data = TextEditor.getDragEventData(event);
    if (data?.type !== 'Actor' || !data.uuid) return ui.notifications.warn(L('NCI.Staff.DropActorOnly'));
    const actor = await fromUuid(data.uuid);
    if (!actor) return ui.notifications.warn(L('NCI.Staff.DropActorOnly'));
    const refuse = (reason) => ui.notifications.warn(L('NCI.Business.Refused', { reason: L(`NCI.Business.Reason.${reason}`) }));
    if (!staffActors().some((a) => a.id === actor.id)) return refuse('not-staff');
    const partner = partnerOf(business, actor.id);
    if (partner && ['active', 'leaving', 'invited'].includes(partner.status)) return refuse('is-partner');
    if ((business.staff ?? []).some((s) => s.actorId === actor.id)) return refuse('already-staff');
    const open = postOpen(business, this.post);
    if (!open.ok) return refuse(open.reason);
    const pct = Math.floor(Number(this.element?.querySelector('[name="staffPct"]')?.value) || 100);
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L('NCI.Business.Title') },
      content: `<p>${L('NCI.Staff.DropConfirm', { name: actor.name, post: L(`NCI.Staff.Post.${this.post}`), pct })}</p>`,
      rejectClose: false,
      modal: true,
    });
    if (!ok) return null;
    return this._send('propose', { kind: 'hire', actorId: actor.id, post: this.post, pct });
  }

  _onClose(options) {
    Hooks.off(HOOKS.BUSINESSES_CHANGED, this._refresh);
    super._onClose?.(options);
  }

  _send(type, payload) {
    const business = this.business;
    if (!this.account || !business) return null;
    return BusinessClient.submit(this.account, type, { businessId: business.id, ...payload });
  }

  static _onHireCharacter(event, target) {
    const form = target.closest('.nci-form');
    const actorId = form?.querySelector('[name="staffActor"]')?.value;
    const pct = Math.floor(Number(form?.querySelector('[name="staffPct"]')?.value) || 100);
    if (!actorId) return null;
    return this._send('propose', { kind: 'hire', actorId, post: this.post, pct });
  }

  /**
   * Advertise the job: the roll dialog. Once the roll is made this window closes; the applicants show
   * at the foot of the Staff tab when the GM has the roll. Cancelling the roll leaves it open.
   */
  static _onAdvertise() {
    const business = this.business;
    if (!business) return;
    RollDialogApp.ask({
      actorId: this.actorId,
      businessId: business.id,
      request: { type: 'recruitRoll', businessId: business.id, post: this.post },
      title: L('NCI.Staff.RecruitTitle', { post: L(`NCI.Staff.Post.${this.post}`), name: business.name }),
      afterRoll: () => this.close(),
    });
  }

  static _onClose() {
    return this.close();
  }

  async _prepareContext() {
    const business = this.business;
    if (!business) return { post: L(`NCI.Staff.Post.${this.post}`), blocked: L('NCI.Business.Reason.no-business'), people: [] };
    return hireContext(business, this.account, this.post);
  }
}
