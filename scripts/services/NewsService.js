/**
 * News service: posts public headlines. GM client only.
 * @file scripts/services/NewsService.js
 */

import { makeNewsItem, addNews } from '../engine/index.js';
import { HOOKS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { MarketStore } from '../data/MarketStore.js';
import { MarketClock } from './MarketClockService.js';
import { SerialQueue } from '../utils/queue.js';

class NewsServiceImpl {
  constructor() {
    this._queue = new SerialQueue('Posting news', null);
  }

  /**
   * Add a headline to the public feed.
   * @param {{headline: string, tone?: 'up'|'down'|'neutral', companyIds?: string[], source?: string}} o - `source` is passed to listeners only; it is not stored in the public feed
   */
  post({ headline, tone = 'neutral', companyIds = [], source = null }) {
    if (!isActiveGM() || !String(headline ?? '').trim()) return Promise.resolve(null);
    return this._queue.run(async () => {
      const item = makeNewsItem({
        id: foundry.utils.randomID(10),
        tick: MarketStore.time(),
        date: MarketClock.dateString(),
        headline,
        tone,
        companyIds,
      });
      await MarketStore.setNews(addNews(MarketStore.getNews(), item));
      Hooks.callAll(HOOKS.NEWS_POSTED, source ? { ...item, source } : item);
      return item;
    });
  }
}

export const NewsService = new NewsServiceImpl();
