/**
 * Fund distribution service: pays distributing funds' income to their holders. GM client only.
 * @file scripts/services/FundDistributionService.js
 * @description A distributing fund sets its dividend income aside each tick and, at the end of each
 *              month or quarter, fixes it as a per-unit distribution (see engine/funds.js). This
 *              pays that to every holder as cash (or reinvests it if they have switched on
 *              reinvestment for the fund), once each, then announces it. Payment is keyed by fund
 *              and period, so running it every tick is safe.
 */

import { payDividend } from '../engine/index.js';
import { HOOKS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { FundRepository } from '../data/FundRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { MarketClock } from './MarketClockService.js';
import { PortfolioService } from './PortfolioService.js';
import { NewsService } from './NewsService.js';

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

export const FundDistributionService = {
  /** After a market tick: pay any distribution that has been fixed. */
  async onTick() {
    if (!isActiveGM()) return;
    const pub = MarketStore.getPublic();
    for (const fund of FundRepository.all()) {
      const state = pub.funds?.[fund.id];
      if (fund.distribution !== 'distributing' || !(state?.lastDist?.perUnit > 0)) continue;
      await this._pay(fund, state);
    }
  },

  async _pay(fund, state) {
    const { key, perUnit, tick } = state.lastDist;
    const paidKey = `dist-${key}`;
    const payouts = [];
    const portfolios = await PortfolioService.transformAll((portfolio, actor) => {
      if (!portfolio.lots.some((l) => l.assetId === fund.id)) return null;
      const r = payDividend({ portfolio, assetId: fund.id, perShare: perUnit, key: paidKey, price: state.nav, tick });
      if (r.paid && r.payout > 0) payouts.push({ actorId: actor.id, payout: r.payout });
      const marked = r.portfolio.paid.length !== portfolio.paid.length || r.paid;
      return marked ? { portfolio: r.portfolio, changed: true } : null;
    });

    // Announce each distribution once, whoever was paid.
    const records = MarketStore.getDividendRecords();
    if (records[fund.id]?.lastKey === paidKey) return;
    records[fund.id] = { ...records[fund.id], lastKey: paidKey, perShare: perUnit, tick, date: MarketClock.dateString() };
    await MarketStore.setDividendRecords(records);
    await NewsService.post({ headline: L('NCI.News.FundDistribution', { name: fund.name, amount: perUnit.toFixed(2) }), tone: 'up' });
    Hooks.callAll(HOOKS.DIVIDEND_PAID, { companyId: fund.id, perShare: perUnit, key: paidKey, portfolios, payouts });
  },
};
