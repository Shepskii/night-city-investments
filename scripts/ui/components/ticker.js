/**
 * Market ticker: the data and markup for the compact strip.
 * @file scripts/ui/components/ticker.js
 * @description Pure; no Foundry globals. The strip shows the NC index, then either the companies the
 *              player is watching (up to four) or, with nothing watched, the biggest movers of the
 *              day. `tickerView` works out the numbers and `tickerHtml` builds the markup.
 */

import { equalWeightIndex } from '../../engine/index.js';
import { escapeHtml } from '../../utils/text.js';

const signedPct = (f) => `${f >= 0 ? '+' : ''}${(f * 100).toFixed(2)}%`;
const cls = (f) => (f > 0 ? 'nci-up' : f < 0 ? 'nci-down' : 'nci-flat');

export const TICKER_WATCH_MAX = 4;

/**
 * @param {object} o
 * @param {Object<string, {price: number, prevClose: number}>} o.quotes - companyId -> today's quote
 * @param {{id: string, ticker: string, initialPrice: number, splitFactor?: number}[]} o.companies - the companies shown
 * @param {number} [o.perSide] - how many gainers and how many losers to show when nothing is watched
 * @param {string[]} [o.watched] - company ids the player watches, in the order they were added. The first
 *        four that are trading are shown; if none are, the strip falls back to the movers
 * @returns {{level: number, change: number, movers: {ticker: string, change: number}[], watching: boolean}|null}
 */
export function tickerView({ quotes, companies, perSide = 2, watched = [] }) {
  const traded = companies.filter((c) => quotes[c.id]?.price > 0);
  if (!traded.length) return null;

  const idx = equalWeightIndex(traded.map((c) => ({
    price: quotes[c.id].price,
    prevClose: quotes[c.id].prevClose,
    base: c.initialPrice / (c.splitFactor ?? 1),
  })));

  const changeOf = (c) => (quotes[c.id].prevClose ? (quotes[c.id].price - quotes[c.id].prevClose) / quotes[c.id].prevClose : 0);
  const byId = new Map(traded.map((c) => [c.id, c]));
  const picked = [...new Set(watched)].map((id) => byId.get(id)).filter(Boolean).slice(0, TICKER_WATCH_MAX);
  if (picked.length) {
    return { level: idx.level, change: idx.changePct, movers: picked.map((c) => ({ ticker: c.ticker, change: changeOf(c) })), watching: true };
  }

  const moves = traded
    .map((c) => ({ ticker: c.ticker, change: changeOf(c) }))
    .sort((a, b) => b.change - a.change);
  const gainers = moves.filter((m) => m.change > 0).slice(0, perSide);
  const losers = moves.filter((m) => m.change < 0).slice(-perSide).reverse();

  return {
    level: idx.level,
    change: idx.changePct,
    movers: [...gainers, ...losers],
    watching: false,
  };
}

/** The strip's inner markup. `label` is the localised index name. */
export function tickerHtml(view, label) {
  if (!view) return '';
  const movers = view.movers
    .map((m) => `<span class="nci-tk-mover ${view.watching ? 'nci-tk-watched ' : ''}${cls(m.change)}">${escapeHtml(m.ticker)} ${signedPct(m.change)}</span>`)
    .join('');
  return `<span class="nci-tk-index">${escapeHtml(label)} ${view.level.toFixed(2)} <span class="${cls(view.change)}">${signedPct(view.change)}</span></span>${movers}`;
}
