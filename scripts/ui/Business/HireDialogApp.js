/**
 * Hire window: filling one post on a business's staff (DESIGN §33).
 * @file scripts/ui/Business/HireDialogApp.js
 * @description Opened from a post's Hire button on the Staff tab. The partners can propose hiring a
 *              character (a player character, or an NPC tagged staff or employee in Night City
 *              Messenger) at a share of the going rate, or advertise the job: a roll that brings one to
 *              three applicants, each with their own skill and the wage they ask, who wait here to be
 *              hired. Everything is a request for the GM, as in the Business window.
 */

import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient } from '../../services/BusinessClient.js';
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
      hireApplicant: HireDialogApp._onHireApplicant,
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

  static _onHireApplicant(event, target) {
    return this._send('propose', { kind: 'hire', candidateId: target.dataset.id });
  }

  /** Advertise the job: the roll dialog, and the applicants come back here when the GM has it. */
  static _onAdvertise() {
    const business = this.business;
    if (!business) return;
    RollDialogApp.ask({
      actorId: this.actorId,
      businessId: business.id,
      request: { type: 'recruitRoll', businessId: business.id, post: this.post },
      title: L('NCI.Staff.RecruitTitle', { post: L(`NCI.Staff.Post.${this.post}`), name: business.name }),
    });
  }

  static _onClose() {
    return this.close();
  }

  async _prepareContext() {
    const business = this.business;
    if (!business) return { post: L(`NCI.Staff.Post.${this.post}`), blocked: L('NCI.Business.Reason.no-business'), people: [], applicants: [] };
    return hireContext(business, this.account, this.post);
  }
}
