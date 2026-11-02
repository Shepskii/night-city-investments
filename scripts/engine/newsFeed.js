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

/**
 * Put each company's or fund's ticker after its name in a headline, the first time it comes, wherever the headline
 * came from: the module's own wording, a GM's or a player's. One that already gives the ticker is left alone, so
 * this can run again on a headline already done.
 * @param {string} headline
 * @param {{name: string, ticker: string}[]} assets
 */
export function withTickers(headline, assets) {
  const text = String(headline ?? '');
  const tickerOf = new Map((assets ?? []).filter((a) => a?.name && a.ticker && a.name !== a.ticker).map((a) => [a.name, a.ticker]));
  if (!tickerOf.size) return text;
  // Longest first, so a name inside a longer one does not take its place.
  const names = [...tickerOf.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  const done = new Set();
  return text.replace(new RegExp(`(?<![\\p{L}\\p{N}])(?:${names.join('|')})(?![\\p{L}\\p{N}])`, 'gu'), (name) => {
    const ticker = tickerOf.get(name);
    if (done.has(ticker) || text.includes(`(${ticker})`)) return name;
    done.add(ticker);
    return `${name} (${ticker})`;
  });
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
