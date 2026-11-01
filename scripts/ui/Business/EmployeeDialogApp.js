/**
 * Employee window: managing one employee on a business's staff (DESIGN §32, E2).
 * @file scripts/ui/Business/EmployeeDialogApp.js
 * @description Opened from an employee's Manage button on the Staff tab. The partners can propose a
 *              change of pay (agreeing to a raise the employee asked for is one), and propose letting
 *              them go; whoever runs the business can pay a bonus, move them to another post that has
 *              room, train them (E3), or turn down a raise they asked for. Everything is a request for the GM, as in
 *              the Business window.
 */

import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BusinessClient } from '../../services/BusinessClient.js';
import { accountFor } from '../accounts.js';
import { BaseApplication } from '../BaseApplication.js';
import { RollDialogApp } from './RollDialogApp.js';
import { employeeContext } from './context.js';
import { L } from '../format.js';

export class EmployeeDialogApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    window: { title: 'NCI.Staff.ManageTitle', icon: 'fas fa-id-badge', resizable: true },
    position: { width: 600, height: 'auto' },
    actions: {
      proposePay: EmployeeDialogApp._onProposePay,
      agreeRaise: EmployeeDialogApp._onAgreeRaise,
      refuseRaise: EmployeeDialogApp._onRefuseRaise,
      payBonus: EmployeeDialogApp._onPayBonus,
      movePost: EmployeeDialogApp._onMovePost,
      trainStaff: EmployeeDialogApp._onTrain,
      askStaff: EmployeeDialogApp._onAsk,
      proposeGrant: EmployeeDialogApp._onProposeGrant,
      cancelAsk: EmployeeDialogApp._onCancelAsk,
      fireStaff: EmployeeDialogApp._onFire,
      close: EmployeeDialogApp._onClose,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/dialogs/employee.hbs` },
  };

  /** Open the window for one employee of one business, as the account picked in the Business window. */
  static ask({ actorId, businessId, staffId }) {
    const id = `nci-employee-${businessId}-${staffId}`;
    const existing = foundry.applications.instances?.get?.(id);
    if (existing) {
      existing.actorId = actorId;
      existing.render({ force: true });
      return existing;
    }
    const app = new EmployeeDialogApp({ id, actorId, businessId, staffId });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId;
    this.businessId = options.businessId;
    this.staffId = options.staffId;
    this._refresh = () => this.render();
  }

  get account() {
    return accountFor(this.actorId);
  }

  get business() {
    return BusinessRepository.get(this.businessId);
  }

  get title() {
    const staff = (this.business?.staff ?? []).find((s) => s.id === this.staffId);
    return L('NCI.Staff.ManageTitle', { name: staff?.name ?? '' });
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
    return BusinessClient.submit(this.account, type, { businessId: business.id, staffId: this.staffId, ...payload });
  }

  _value(name) {
    return this.element?.querySelector(`[name="${name}"]`)?.value;
  }

  static _onProposePay() {
    const pct = Math.floor(Number(this._value('payPct')) || 0);
    if (!pct) return null;
    return this._send('propose', { kind: 'pay', pct });
  }

  static _onAgreeRaise(event, target) {
    return this._send('propose', { kind: 'pay', pct: Number(target.dataset.pct) });
  }

  static _onRefuseRaise() {
    return this._send('refuseRaise', {});
  }

  static _onPayBonus() {
    return this._send('bonus', { quarters: Number(this._value('bonusQuarters')) || 1 });
  }

  static _onMovePost() {
    const post = this._value('movePost');
    return post ? this._send('movePost', { post }) : null;
  }

  /**
   * Train them: on a course (twice the eb), or mentored by the account picked, a roll of their own
   * (Education) made in the roll dialog, spending their business days.
   */
  static _onTrain(event, target) {
    if (target.dataset.mentor !== 'true') return this._send('train', {});
    const business = this.business;
    const staff = (business?.staff ?? []).find((s) => s.id === this.staffId);
    if (!business || !staff || !this.account) return null;
    return RollDialogApp.ask({
      actorId: this.actorId, businessId: business.id,
      request: { type: 'trainRoll', businessId: business.id, staffId: this.staffId },
      title: L('NCI.Staff.TrainTitle', { name: staff.name, business: business.name }),
    });
  }

  /** Propose a share grant for them (E3, company only): a share of the company, voted on by the shares. */
  static _onProposeGrant() {
    const pct = Number(this._value('grantPct'));
    return pct > 0 ? this._send('propose', { kind: 'grant', pct }) : null;
  }

  /** Ask a player character on the staff for one of this week's rolls (E3). */
  static _onAsk() {
    const value = this._value('askRoll');
    if (!value) return null;
    const [type, id] = value.split(':');
    const roll = type === 'action' ? { type, action: id } : type === 'assist' ? { type, forAction: id } : { type: 'respond' };
    return this._send('askStaff', { roll });
  }

  static _onCancelAsk(event, target) {
    return this._send('cancelAsk', { askId: target.dataset.id });
  }

  static async _onFire() {
    const ok = await foundry.applications.api.DialogV2.confirm({
      window: { title: L('NCI.Business.Title') }, content: `<p>${L('NCI.Staff.FireConfirm')}</p>`, rejectClose: false, modal: true,
    });
    if (!ok) return null;
    const sent = await this._send('propose', { kind: 'fire' });
    if (sent) await this.close();
    return sent;
  }

  static _onClose() {
    return this.close();
  }

  async _prepareContext() {
    const business = this.business;
    if (!business) return { name: '', blocked: L('NCI.Business.Reason.no-business') };
    return employeeContext(business, this.account, this.staffId);
  }
}
