/**
 * Market news feed
 * @file scripts/engine/newsFeed.js
 * @description Public headlines about the market. Pure; no Foundry globals.
 *   { schema, items: [{ id, tick, date, headline, tone, companyIds }] }  newest last
 */

export const NEWS_CAP = 100;
export const NEWS_TONES = ['up', 'down', 'neutral'];

export const emptyNews = () => ({ schema: 1, items: [] });

/** Build a news item, cleaning the fields. */
export function makeNewsItem({ id, tick, date = '', headline, tone = 'neutral', companyIds = [] }) {
  return {
    id,
    tick,
    date,
    headline: String(headline ?? '').trim().slice(0, 200),
    tone: NEWS_TONES.includes(tone) ? tone : 'neutral',
    companyIds: [...new Set(companyIds)].filter(Boolean),
  };
}

/** Append an item, keeping the newest NEWS_CAP. Items with no headline are ignored. */
export function addNews(feed, item, cap = NEWS_CAP) {
  const base = feed?.items ? feed : emptyNews();
  if (!item.headline) return base;
  return { ...base, items: [...base.items, item].slice(-cap) };
}

/** Newest first, optionally only items that mention a company. */
export function latestNews(feed, { companyId = null, limit = 30 } = {}) {
  const items = (feed?.items ?? []).filter((i) => !companyId || i.companyIds.includes(companyId));
  return items.slice(-limit).reverse();
}
