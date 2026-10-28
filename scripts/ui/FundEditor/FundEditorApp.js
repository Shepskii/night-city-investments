/**
 * Fund Editor: create or edit a pooled fund (GM only).
 * @file scripts/ui/FundEditor/FundEditorApp.js
 */

import { FUND_KINDS, FUND_REBALANCE, FUND_DISTRIBUTION, FUND_DIST_FREQUENCIES } from '../../engine/index.js';
import { MODULE_ID } from '../../utils/constants.js';
import { FundRepository } from '../../data/FundRepository.js';
import { FundService } from '../../services/FundService.js';
import { BaseApplication } from '../BaseApplication.js';
import { L } from '../../utils/helpers.js';


const DEFAULTS = {
  name: '',
  ticker: '',
  kind: 'themed',
  expenseRatio: 0.008,
  loadBps: 75,
  exitBps: 25,
  minBuy: 100,
  initialNav: 100,
  rebalance: 'none',
  distribution: 'accumulating',
  distributionFrequency: 'quarterly',
  redeemDelay: 0,
  managerAlpha: 0,
  description: '',
};

export class FundEditorApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    tag: 'form',
    window: { title: 'NCI.FundEditor.Title', icon: 'fas fa-layer-group', resizable: false },
    position: { width: 520, height: 'auto' },
    form: { handler: FundEditorApp._onSubmit, closeOnSubmit: false, submitOnChange: false },
    actions: { cancel: FundEditorApp._onCancel },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/gm/fund-editor.hbs` },
  };

  /** Open an editor for an existing fund, or a blank one when `fundId` is null. */
  static edit(fundId = null) {
    if (!game.user.isGM) return null;
    const app = new FundEditorApp({ id: `nci-fund-editor-${fundId ?? 'new'}`, fundId });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.fundId = options.fundId ?? null;
  }

  static _onCancel() {
    return this.close();
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const result = await FundService.save({
      ...data,
      expenseRatio: Number(data.expensePct) / 100,
      managerAlpha: Number(data.alphaPct) / 100,
      id: this.fundId ?? undefined,
    });

    if (!result.ok) {
      for (const error of result.errors) ui.notifications.warn(L(`NCI.Errors.${error}`));
      if (result.unknown?.length) ui.notifications.warn(L('NCI.FundEditor.Unknown', { list: result.unknown.join(', ') }));
      return;
    }
    ui.notifications.info(L('NCI.Editor.Saved', { name: result.fund.name }));
    await this.close();
  }

  async _prepareContext() {
    const existing = this.fundId ? FundRepository.get(this.fundId) : null;
    const fund = { ...DEFAULTS, ...(existing ?? {}) };
    return {
      isNew: !existing,
      fund: { ...fund, expensePct: Math.round(fund.expenseRatio * 10000) / 100, alphaPct: Math.round((fund.managerAlpha ?? 0) * 10000) / 100 },
      components: existing ? FundRepository.componentsText(existing) : '',
      kinds: Object.fromEntries(FUND_KINDS.map((k) => [k, L(`NCI.FundKind.${k}`)])),
      rebalances: Object.fromEntries(FUND_REBALANCE.map((r) => [r, L(`NCI.FundRebalance.${r}`)])),
      distributions: Object.fromEntries(FUND_DISTRIBUTION.map((d) => [d, L(`NCI.FundDistribution.Option.${d}`)])),
      distributionFrequencies: Object.fromEntries(FUND_DIST_FREQUENCIES.map((r) => [r, L(`NCI.FundRebalance.${r}`)])),
    };
  }
}
