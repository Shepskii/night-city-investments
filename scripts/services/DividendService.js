/**
 * Dividend service: declares and pays dividends. GM client only.
 * @file scripts/services/DividendService.js
 * @description After each tick it checks every company's schedule against the in-world date. A due
 *              dividend is paid to every portfolio once (keyed by company and period). The first
 *              time a company is seen only its current period is recorded, so importing companies
 *              does not trigger an instant payout.
 */

import { dividendDue, dividendPerShare, periodKey, payDividend } from '../engine/index.js';
import { HOOKS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { MarketClock } from './MarketClockService.js';
import { PortfolioService } from './PortfolioService.js';
import { NewsService } from './NewsService.js';

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

class DividendServiceImpl {
  constructor() {
    this._queue = Promise.resolve();
  }

  _enqueue(fn) {
    this._queue = this._queue.then(fn).catch((error) => log.error('Dividend service task failed', error));
    return this._queue;
  }

  /** Check every schedule after a market tick. */
  onTick() {
    if (!isActiveGM()) return Promise.resolve();
    return this._enqueue(() => this._check());
  }

  /**
   * GM: pay a one-off dividend now.
   * @returns {Promise<number>} portfolios paid
   */
  declareSpecial(companyId, perShare) {
    if (!isActiveGM()) return Promise.resolve(0);
    return this._enqueue(async () => {
      const company = CompanyRepository.get(companyId);
      const pub = MarketStore.getPublic();
      const amount = Math.round(Number(perShare) * 100) / 100;
      if (!company || !(amount > 0) || !pub.companies?.[companyId]) return 0;

      let count = 0;
      // The schedule key is left alone; only the "last paid" details change.
      await MarketStore.updateDividendRecords((records) => {
        count = (records[companyId]?.specials ?? 0) + 1;
        return {
          ...records,
          [companyId]: { ...records[companyId], specials: count, perShare: amount, tick: pub.time ?? pub.tickIndex ?? 0, date: MarketClock.dateString() },
        };
      });
      return this._pay(company, amount, `special-${count}`, pub.companies[companyId].price, pub.time ?? pub.tickIndex ?? 0, true);
    });
  }

  async _check() {
    const pub = MarketStore.getPublic();
    if (!pub.schema) return;

    const date = MarketClock.date();
    const tick = pub.time ?? pub.tickIndex ?? 0;
    // Read once to decide; every write goes through `updateDividendRecords`, which merges into a fresh read.
    const records = MarketStore.getDividendRecords();
    const marks = {};

    for (const company of CompanyRepository.all({ includeUnlisted: true })) {
      const d = company.dividend;
      if (!d || d.policy === 'none') continue;
      const price = pub.companies?.[company.id]?.price;
      if (!price) continue;

      const record = records[company.id];
      if (!record?.lastKey) {
        marks[company.id] = periodKey(d.frequency, date);
        continue;
      }

      const due = dividendDue(company, date, record.lastKey);
      if (!due.due) continue;

      const perShare = dividendPerShare(company, price);
      await MarketStore.updateDividendRecords((current) => ({
        ...current, [company.id]: { ...current[company.id], lastKey: due.key, perShare, tick, date: MarketClock.dateString() },
      }));
      if (perShare > 0) await this._pay(company, perShare, due.key, price, tick, false);
    }

    if (Object.keys(marks).length) {
      await MarketStore.updateDividendRecords((current) => {
        const next = { ...current };
        for (const [id, lastKey] of Object.entries(marks)) next[id] = { ...current[id], lastKey };
        return next;
      });
    }
  }

  /** Pay every portfolio and announce it. */
  async _pay(company, perShare, key, price, tick, special) {
    const payouts = [];
    const paid = await PortfolioService.transformAll((portfolio, actor) => {
      if (!portfolio.lots.some((l) => l.assetId === company.id)) return null;
      const r = payDividend({ portfolio, assetId: company.id, perShare, key, price, tick });
      if (r.paid && r.payout > 0) payouts.push({ actorId: actor.id, payout: r.payout });
      return { portfolio: r.portfolio, changed: true };
    });

    await NewsService.post({
      headline: L(special ? 'NCI.News.SpecialDividend' : 'NCI.News.Dividend', { name: company.name, amount: perShare.toFixed(2) }),
      tone: 'up',
      companyIds: [company.id],
    });
    Hooks.callAll(HOOKS.DIVIDEND_PAID, { companyId: company.id, perShare, key, portfolios: paid, payouts });
    return paid;
  }
}

export const DividendService = new DividendServiceImpl();
