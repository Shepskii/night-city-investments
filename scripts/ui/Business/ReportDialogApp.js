/**
 * Monthly report window: one of a company's published reports, in detail.
 * @file scripts/ui/Business/ReportDialogApp.js
 * @description Opened by clicking a report in the Ledger tab's monthly reports. Shows the weeks it
 *              sums, the real figures beside the reported ones, and how it was prepared. Read-only.
 */

import { MODULE_ID, HOOKS } from '../../utils/constants.js';
import { BusinessRepository } from '../../data/BusinessRepository.js';
import { BaseApplication } from '../BaseApplication.js';
import { reportContext } from './context.js';
import { L } from '../format.js';

export class ReportDialogApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    window: { title: 'NCI.Report.Title', icon: 'fas fa-file-invoice-dollar', resizable: true },
    position: { width: 640, height: 'auto' },
    actions: {
      close: ReportDialogApp._onClose,
    },
  };

  static PARTS = {
    body: { template: `modules/${MODULE_ID}/templates/dialogs/report.hbs` },
  };

  /** Open one monthly report of one company. */
  static ask({ businessId, index }) {
    const id = `nci-report-${businessId}-${index}`;
    const existing = foundry.applications.instances?.get?.(id);
    if (existing) {
      existing.render({ force: true });
      return existing;
    }
    const app = new ReportDialogApp({ id, businessId, index });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.businessId = options.businessId;
    this.index = options.index;
    this._refresh = () => this.render();
  }

  get business() {
    return BusinessRepository.get(this.businessId);
  }

  get title() {
    return L('NCI.Report.Title', { name: this.business?.name ?? '', n: this.index });
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
    return reportContext(business, this.index);
  }
}
