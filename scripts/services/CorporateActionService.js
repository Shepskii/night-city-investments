/**
 * Corporate action service: splits, buyouts, delistings, bankruptcies, GM price changes.
 * @file scripts/services/CorporateActionService.js
 * @description GM client only. Each action changes the company's status or the market state, then
 *              every portfolio, then announces itself in the news feed.
 */

import {
  isValidSplitRatio, autoSplitRatio, splitMarketState, scaleHistory, splitPortfolio, cashOutPortfolio,
  writeOffPortfolio, setCompanyPrice, replaceLastClose, logEntry, timeOf,
} from '../engine/index.js';
import { HOOKS } from '../utils/constants.js';
import { isActiveGM, L } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { TickService } from './TickService.js';
import { PortfolioService } from './PortfolioService.js';
import { NewsService } from './NewsService.js';
import { FundService } from './FundService.js';
import { SerialQueue } from '../utils/queue.js';

const eb = (n) => Number(n).toFixed(2);

class CorporateActionServiceImpl {
  constructor() {
    this._queue = new SerialQueue('Corporate action', { ok: false, error: 'failed' });
  }

  /** After a market tick: split any company whose auto-split threshold has been reached. */
  onTick() {
    if (!isActiveGM()) return Promise.resolve();
    return this._queue.run(async () => {
      const pub = MarketStore.getPublic();
      for (const company of CompanyRepository.all({ includeUnlisted: true })) {
        const price = pub.companies?.[company.id]?.price;
        const ratio = company.status === 'active' && price ? autoSplitRatio(company, price) : null;
        if (ratio) await this._split(company.id, ratio);
      }
    });
  }

  /** N-for-1 stock split. */
  split(companyId, ratio) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, error: 'not-active-gm' });
    return this._queue.run(() => this._split(companyId, Number(ratio)));
  }

  /** The company is bought out: holders are paid `price` per share in cash. */
  buyout(companyId, price) {
    return this._cashOut(companyId, 'buyout', Number(price));
  }

  /** The company leaves the market: holders are paid its last price in cash. */
  delist(companyId) {
    return this._cashOut(companyId, 'delist', null);
  }

  /** The company fails: shares become worthless. */
  bankrupt(companyId) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, error: 'not-active-gm' });
    return this._queue.run(async () => {
      const company = CompanyRepository.get(companyId);
      if (!company) return { ok: false, error: 'unknown-asset' };
      const tick = MarketStore.time();

      await CompanyRepository.save({ ...company, status: 'bankrupt' });
      const portfolios = await PortfolioService.transformAll((p) => writeOffPortfolio(p, company.id, tick));
      await NewsService.post({ headline: L('NCI.News.Bankrupt', { name: company.name }), tone: 'down', companyIds: [company.id] });
      Hooks.callAll(HOOKS.CORPORATE_ACTION, { type: 'bankrupt', companyId: company.id, portfolios });
      return { ok: true, portfolios };
    });
  }

  /**
   * GM escape hatch: set a company's price directly. Fair value moves with it unless told not to.
   */
  setPrice(companyId, price, { alsoFair = true } = {}) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, error: 'not-active-gm' });
    return this._queue.run(async () => {
      const company = CompanyRepository.get(companyId);
      const next = Math.round(Number(price) * 100) / 100;
      if (!company || !(next >= 1)) return { ok: false, error: 'price-invalid' };

      let old = null;
      await TickService.mutateState(({ state, history }) => {
        old = state.companies[companyId]?.price ?? null;
        return {
          state: setCompanyPrice(state, companyId, next, { alsoFair }),
          history: replaceLastClose(history, companyId, next),
        };
      });
      await TickService.updateControls((controls, { tick }) => logEntry(controls, {
        ts: Date.now(), tick, kind: 'setPrice', companyId, from: old, to: next,
      }));
      return { ok: true, from: old, to: next };
    });
  }

  async _split(companyId, ratio) {
    const company = CompanyRepository.get(companyId);
    if (!company) return { ok: false, error: 'unknown-asset' };
    if (!isValidSplitRatio(ratio)) return { ok: false, error: 'invalid-ratio' };
    const tick = MarketStore.time();

    // Funds that hold this company take on N times the shares first, so their value does not move.
    await FundService.onSplit(companyId, ratio);
    await TickService.mutateState(({ state, history }) => ({
      state: splitMarketState(state, companyId, ratio),
      history: scaleHistory(history, companyId, 1 / ratio),
    }));
    await CompanyRepository.save({ ...company, splitFactor: (company.splitFactor ?? 1) * ratio });
    const portfolios = await PortfolioService.transformAll((p) => splitPortfolio(p, companyId, ratio, tick));
    await NewsService.post({ headline: L('NCI.News.Split', { name: company.name, ratio }), tone: 'neutral', companyIds: [companyId] });
    Hooks.callAll(HOOKS.CORPORATE_ACTION, { type: 'split', companyId, ratio, portfolios });
    return { ok: true, portfolios };
  }

  _cashOut(companyId, kind, price) {
    if (!isActiveGM()) return Promise.resolve({ ok: false, error: 'not-active-gm' });
    return this._queue.run(async () => {
      const company = CompanyRepository.get(companyId);
      const pub = MarketStore.getPublic();
      if (!company || !pub.companies?.[companyId]) return { ok: false, error: 'unknown-asset' };

      const payPrice = kind === 'buyout' ? Math.round(price * 100) / 100 : pub.companies[companyId].price;
      if (!(payPrice > 0)) return { ok: false, error: 'price-invalid' };
      const tick = timeOf(pub);

      await CompanyRepository.save({ ...company, status: kind === 'buyout' ? 'acquired' : 'delisted' });
      const portfolios = await PortfolioService.transformAll((p) => cashOutPortfolio(p, companyId, payPrice, kind, tick));
      await NewsService.post({
        headline: L(kind === 'buyout' ? 'NCI.News.Buyout' : 'NCI.News.Delist', { name: company.name, price: eb(payPrice) }),
        tone: 'neutral',
        companyIds: [companyId],
      });
      Hooks.callAll(HOOKS.CORPORATE_ACTION, { type: kind, companyId, price: payPrice, portfolios });
      return { ok: true, portfolios, price: payPrice };
    });
  }
}

export const CorporateActionService = new CorporateActionServiceImpl();
