/**
 * Fund service: creating, editing and closing pooled funds. GM client only.
 * @file scripts/services/FundService.js
 */

import { cashOutPortfolio, splitFundComponents } from '../engine/index.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { FundRepository } from '../data/FundRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { STARTER_FUNDS } from '../data/starter-funds.js';
import { TickService } from './TickService.js';
import { PortfolioService } from './PortfolioService.js';
import { NewsService } from './NewsService.js';

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

export const FundService = {
  /**
   * Create or update a fund from form data.
   * @returns {Promise<{ok: true, fund: object} | {ok: false, errors: string[]}>}
   */
  async save(input) {
    if (!isActiveGM()) return { ok: false, errors: ['not-active-gm'] };
    const result = FundRepository.prepare(input);
    if (!result.ok) return result;
    await TickService.saveFund(result.fund);
    return result;
  },

  /** Create the starter funds that do not exist yet. */
  async importStarter() {
    let created = 0;
    let skipped = 0;
    for (const def of STARTER_FUNDS) {
      if (FundRepository.getByTicker(def.ticker)) {
        skipped++;
        continue;
      }
      const result = await this.save(def);
      if (result.ok) created++;
      else skipped++;
    }
    return { created, skipped };
  },

  /**
   * Close a fund: every holder is paid its current NAV in cash and the fund is removed.
   * @returns {Promise<{ok: boolean, portfolios?: number}>}
   */
  async liquidate(id) {
    if (!isActiveGM()) return { ok: false };
    const fund = FundRepository.get(id);
    const pub = MarketStore.getPublic();
    const nav = pub.funds?.[id]?.nav;
    if (!fund || !(nav > 0)) return { ok: false };

    const tick = pub.time ?? pub.tickIndex ?? 0;
    const portfolios = await PortfolioService.transformAll((p) => cashOutPortfolio(p, id, nav, 'delist', tick));
    await FundRepository.remove(id);
    await TickService.syncCompanies();
    await NewsService.post({ headline: L('NCI.News.FundClosed', { name: fund.name, price: nav.toFixed(2) }), tone: 'neutral' });
    log.info(`Fund ${id} closed; ${portfolios} portfolio(s) paid out`);
    return { ok: true, portfolios };
  },

  /**
   * A company in some funds split N-for-1: those funds hold N times the shares, so their value is
   * unchanged. Run BEFORE the market prices are split.
   */
  async onSplit(companyId, ratio) {
    for (const fund of FundRepository.all()) {
      const next = splitFundComponents(fund, companyId, ratio);
      if (next !== fund) await FundRepository.put(next);
    }
  },
};
