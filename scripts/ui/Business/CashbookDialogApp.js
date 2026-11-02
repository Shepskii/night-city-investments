/**
 * Cashbook window: one closed week of a business, in detail.
 * @file scripts/ui/Business/CashbookDialogApp.js
 * @description Opened by clicking a week in the Reports tab's weekly digests. Shows the income and
 *              expenses that make up the week's profit, the loan repaid, every other payment in or out
 *              of the cash that week, and the cash at the close. Read-only.
 */

import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BaseApplication } from '../BaseApplication.js';
import { cashbookContext } from './context.js';
import { L } from '../format.js';

export class CashbookDialogApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    window: { title: 'NCI.Cashbook.Title', icon: 'fas fa-book', resizable: true },
    position: { width: 620, height: 'auto' },
    actions: {
      close: CashbookDialogApp._onClose,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/dialogs/cashbook.hbs` },
  };

  /** Open the cashbook for one week of one business. */
  static ask({ businessId, index, officer = true }) {
    const id = `nci-cashbook-${businessId}-${index}`;
    const existing = foundry.applications.instances?.get?.(id);
    if (existing) {
      existing.officer = officer;
      existing.render({ force: true });
      return existing;
    }
    const app = new CashbookDialogApp({ id, businessId, index, officer });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.businessId = options.businessId;
    this.index = options.index;
    // Whether the viewer may see what a company's crime was (U1).
    this.officer = options.officer !== false;
    this._refresh = () => this.render();
  }

  get business() {
    return BusinessRepository.get(this.businessId);
  }

  get title() {
    return L('NCI.Cashbook.Title', { name: this.business?.name ?? '', n: this.index });
  }

  _onFirstRender(context, options) {
    super._onFirstRender?.(context, options);
    Hooks.on(HOOKS.BUSINESSES_CHANGED, this._refresh);
  }

  _onClose(options) {
    Hooks.off(HOOKS.BUSINESSES_CHANGED, this._refresh);
    super._onClose?.(options);
  }

  static _onClose() {
    return this.close();
  }

  async _prepareContext() {
    const business = this.business;
    if (!business) return { gone: L('NCI.Business.Reason.no-business') };
    return cashbookContext(business, this.index, this.officer);
  }
}
