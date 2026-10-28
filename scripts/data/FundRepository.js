/**
 * Fund repository: fund definitions live in a world setting (public: players can see what a fund holds).
 * @file scripts/data/FundRepository.js
 */

import { sanitizeFund } from '../engine/index.js';
import { MODULE_ID, SETTINGS } from '../utils/constants.js';
import { CompanyRepository } from './CompanyRepository.js';

const clone = (v) => foundry.utils.deepClone(v);

function read() {
  const stored = clone(game.settings.get(MODULE_ID, SETTINGS.FUND_DEFS) ?? {});
  return stored.funds ? stored : { schema: 1, funds: {} };
}

export const FundRepository = {
  all() {
    return Object.values(read().funds).sort((a, b) => a.ticker.localeCompare(b.ticker));
  },

  get(id) {
    return read().funds[id] ?? null;
  },

  getByTicker(ticker) {
    const t = String(ticker ?? '').toUpperCase();
    return this.all().find((f) => f.ticker === t) ?? null;
  },

  /** Component text for the editor, one "TICKER percent" per line. */
  componentsText(fund) {
    const total = fund.components.reduce((s, c) => s + c.weight, 0) || 1;
    return fund.components
      .map((c) => `${CompanyRepository.get(c.companyId)?.ticker ?? c.companyId} ${Math.round((c.weight / total) * 1000) / 10}`)
      .join('\n');
  },

  /**
   * Validate a fund form without storing it. Component tickers are turned into company ids.
   * @param {object} input - form data (`components` is text like "ARA 30, MIL 20"); include `id` to update
   * @returns {{ok: true, fund: object} | {ok: false, errors: string[], unknown?: string[]}}
   */
  prepare(input) {
    if (!game.user.isGM) return { ok: false, errors: ['gm-only'] };

    const companies = CompanyRepository.all({ includeUnlisted: true });
    const result = sanitizeFund(input, { knownIds: companies.map((c) => c.ticker) });
    if (!result.ok) return result;
    const fund = result.fund;

    fund.components = fund.components.map((c) => ({ ...c, companyId: CompanyRepository.getByTicker(c.companyId)?.id ?? c.companyId }));

    const taken = CompanyRepository.getByTicker(fund.ticker) || this.all().some((f) => f.ticker === fund.ticker && f.id !== fund.id);
    if (taken) return { ok: false, errors: ['ticker-taken'] };
    if (!input.id && this.get(fund.id)) return { ok: false, errors: ['ticker-taken'] };
    return { ok: true, fund };
  },

  /** Validate and store a fund. GM only. The fund service uses `prepare` so it can keep the NAV continuous. */
  async save(input) {
    const result = this.prepare(input);
    if (result.ok) await this.put(result.fund);
    return result;
  },

  /** Store a definition as it is (no validation). */
  async put(fund) {
    const data = read();
    data.funds[fund.id] = fund;
    await game.settings.set(MODULE_ID, SETTINGS.FUND_DEFS, data);
  },

  async remove(id) {
    const data = read();
    if (!data.funds[id]) return false;
    delete data.funds[id];
    await game.settings.set(MODULE_ID, SETTINGS.FUND_DEFS, data);
    return true;
  },
};
