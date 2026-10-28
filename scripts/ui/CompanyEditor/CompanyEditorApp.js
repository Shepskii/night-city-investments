/**
 * Company Editor: create or edit a company (GM only).
 * @file scripts/ui/CompanyEditor/CompanyEditorApp.js
 */

import { SECTORS, DIVIDEND_POLICIES, DIVIDEND_FREQUENCIES, COMPANY_STATUSES } from '../../engine/index.js';
import { MODULE_ID } from '../../utils/constants.js';
import { CompanyRepository } from '../../data/CompanyRepository.js';
import { BaseApplication } from '../BaseApplication.js';
import { L } from '../../utils/helpers.js';


const choices = (values, prefix) => Object.fromEntries(values.map((v) => [v, L(`${prefix}.${v}`)]));

const DEFAULTS = {
  name: '',
  ticker: '',
  sector: 'other',
  hq: '',
  ceo: '',
  aliases: [],
  listed: true,
  initialPrice: 100,
  sharesOutstanding: 1_000_000,
  volatility: 3,
  beta: 1,
  liquidity: 3,
  dividend: { policy: 'none', frequency: 'quarterly', perShare: 0, yield: 0, payoutDay: 1 },
  split: { auto: false, above: 500, ratio: 2 },
  ipo: { date: '', price: null, windowDays: 0, allocation: 0 },
  status: 'active',
  loreText: '',
};

export class CompanyEditorApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    tag: 'form',
    window: { title: 'NCI.Editor.Title', icon: 'fas fa-building', resizable: false },
    position: { width: 560, height: 'auto' },
    form: { handler: CompanyEditorApp._onSubmit, closeOnSubmit: false, submitOnChange: false },
    actions: { cancel: CompanyEditorApp._onCancel },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/gm/company-editor.hbs` },
  };

  /** Open an editor for an existing company, or a blank one when `companyId` is null. `prefill` fills a new one in (a suggested name and ticker). */
  static edit(companyId = null, prefill = null) {
    if (!game.user.isGM) return null;
    const app = new CompanyEditorApp({ id: `nci-company-editor-${companyId ?? 'new'}`, companyId, prefill });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.companyId = options.companyId ?? null;
    this.prefill = options.prefill ?? null;
  }

  static _onCancel() {
    return this.close();
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const loreChanged = data.lore !== data.loreOriginal;
    const result = await CompanyRepository.save(
      { ...data, id: this.companyId ?? undefined },
      this.companyId && !loreChanged ? {} : { lore: data.lore ?? '' },
    );

    if (!result.ok) {
      for (const error of result.errors) ui.notifications.warn(L(`NCI.Errors.${error}`));
      return;
    }
    ui.notifications.info(L('NCI.Editor.Saved', { name: result.company.name }));
    await this.close();
  }

  async _prepareContext() {
    const existing = this.companyId ? CompanyRepository.get(this.companyId) : null;
    const company = { ...DEFAULTS, ...(existing ?? this.prefill ?? {}) };
    return {
      isNew: !existing,
      company: { ...company, aliases: (company.aliases ?? []).join(', ') },
      sectors: choices(SECTORS, 'NCI.Sector'),
      policies: choices(DIVIDEND_POLICIES, 'NCI.DividendPolicy'),
      frequencies: choices(DIVIDEND_FREQUENCIES, 'NCI.Frequency'),
      statuses: choices(COMPANY_STATUSES, 'NCI.Status'),
      ratings: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, `${n}`])),
      volatilities: Object.fromEntries([1, 2, 3, 4, 5].map((n) => [n, `${n} - ${L(`NCI.Vol.${n}`)}`])),
    };
  }
}
