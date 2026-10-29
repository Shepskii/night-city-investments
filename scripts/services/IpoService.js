/**
 * IPO service: lists scheduled companies and fills their subscriptions. GM client only.
 * @file scripts/services/IpoService.js
 * @description After each tick, any unlisted company whose listing date has arrived goes public:
 *              its price is set to the offer price, its history starts fresh, and every player
 *              subscription is filled (pro rata if the offer is capped and oversubscribed).
 */

import {
  ipoStatus, ipoPrice, ipoDemand, allocationRatio, settleIpoOrders, setCompanyPrice, resetSeries, dayIndex, dayOf, normalizePortfolio, timeOf,
} from '../engine/index.js';
import { HOOKS } from '../utils/constants.js';
import { isActiveGM, L } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { MarketClock } from './MarketClockService.js';
import { TickService } from './TickService.js';
import { PortfolioService } from './PortfolioService.js';
import { NewsService } from './NewsService.js';
import { SerialQueue } from '../utils/queue.js';


class IpoServiceImpl {
  constructor() {
    this._queue = new SerialQueue('IPO service task', { ok: false, error: 'failed' });
  }

  /** After a market tick: list every company whose date has come. */
  onTick() {
    if (!isActiveGM()) return Promise.resolve();
    return this._queue.run(async () => {
      const today = dayIndex(MarketClock.nowMs());
      for (const company of CompanyRepository.all({ includeUnlisted: true })) {
        if (ipoStatus(company, today).state === 'due') await this._list(company.id);
      }
    });
  }

  /** GM: list a company now, whatever its date. */
  listNow(companyId) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, error: 'not-active-gm' });
    return this._queue.run(() => this._list(companyId));
  }

  async _list(companyId) {
    const company = CompanyRepository.get(companyId);
    const pub = MarketStore.getPublic();
    if (!company || company.listed || !pub.companies?.[companyId]) return { ok: false, error: 'unknown-asset' };

    const price = ipoPrice(company);
    const tick = timeOf(pub);
    const portfolios = PortfolioRepository.accounts()
      .filter((a) => PortfolioRepository.hasPortfolio(a))
      .map((a) => normalizePortfolio(PortfolioRepository.get(a)));
    const demand = ipoDemand(portfolios, companyId);
    const ratio = allocationRatio(demand, company.ipo?.allocation ?? 0);

    await CompanyRepository.save({ ...company, listed: true, ipo: { ...company.ipo, date: '' } });
    await TickService.mutateState(({ state, history }) => {
      const set = setCompanyPrice(state, companyId, price, { alsoFair: true });
      const entry = { ...set.companies[companyId], price, prevClose: price, fair: price, vol: 1, floorTicks: 0 };
      return {
        state: { ...set, companies: { ...set.companies, [companyId]: entry } },
        history: resetSeries(history, companyId, dayOf(timeOf(state)), price),
      };
    });

    let filled = 0;
    const holders = await PortfolioService.transformAll((p) => {
      const out = settleIpoOrders(p, companyId, price, ratio, tick);
      filled += out.filled;
      return out.changed ? out : null;
    });

    await NewsService.post({
      headline: L('NCI.News.Ipo', { name: company.name, ticker: company.ticker, price: price.toFixed(2) }),
      tone: 'up',
      companyIds: [companyId],
    });
    if (ratio < 1) {
      await NewsService.post({
        headline: L('NCI.News.IpoOversubscribed', { name: company.name, pct: Math.round(ratio * 100) }),
        tone: 'neutral',
        companyIds: [companyId],
      });
    }
    Hooks.callAll(HOOKS.CORPORATE_ACTION, { type: 'ipo', companyId, price, demand, ratio, filled, portfolios: holders });
    return { ok: true, price, demand, ratio, filled, portfolios: holders };
  }
}

export const IpoService = new IpoServiceImpl();
