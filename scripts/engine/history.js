/**
 * Price history storage
 * @file scripts/engine/history.js
 * @description Per-company ring buffer of daily closes, stored as integer cents to keep the
 *              persisted setting small. Pure; no Foundry globals.
 *
 *   { schema: 1, series: { ARA: { startTick: 40, closes: [24000, 24150, ...] } } }
 */

export const HISTORY_CAP = 365;
export const HISTORY_SCHEMA = 1;

export const emptyHistory = () => ({ schema: HISTORY_SCHEMA, series: {} });

const toCents = (price) => Math.round(price * 100);

/**
 * Record a close for a game day. Returns a new history; the input is not mutated. A series starts
 * on the day it was first recorded and drops its oldest entry past `cap`. Several ticks in one day
 * keep updating that day's close, so a series holds one close per game day however often the market
 * ticks, and a day with no tick in it repeats the one before.
 */
export function appendClose(history, id, day, price, cap = HISTORY_CAP) {
  const prev = history.series[id] ?? { startTick: day, closes: [] };
  const cents = toCents(price);
  let closes = [...prev.closes];
  let startTick = prev.startTick;
  const lastDay = startTick + closes.length - 1;
  if (closes.length && day <= lastDay) {
    closes[closes.length - 1] = cents;
  } else {
    const gap = closes.length ? Math.min(day - lastDay - 1, cap) : 0;
    for (let i = 0; i < gap; i++) closes.push(closes[closes.length - 1]);
    closes.push(cents);
  }
  if (closes.length > cap) {
    const drop = closes.length - cap;
    closes = closes.slice(drop);
    startTick += drop;
  }
  return { ...history, series: { ...history.series, [id]: { startTick, closes } } };
}

/** Replace the latest close, used when the GM sets a price directly. */
export function replaceLastClose(history, id, price) {
  const series = history.series?.[id];
  if (!series?.closes.length) return history;
  const closes = [...series.closes.slice(0, -1), toCents(price)];
  return { ...history, series: { ...history.series, [id]: { ...series, closes } } };
}

/**
 * Remove every close after game day `day` (undoing ticks). A series that only started after that
 * day is dropped.
 */
export function truncateHistory(history, day) {
  const series = {};
  for (const [id, s] of Object.entries(history.series ?? {})) {
    const keep = day - s.startTick + 1;
    if (keep <= 0) continue;
    series[id] = { ...s, closes: s.closes.slice(0, keep) };
  }
  return { ...history, series };
}

/** Start a company's history again from a single close (used when it is listed). */
export function resetSeries(history, id, day, price) {
  return { ...history, series: { ...history.series, [id]: { startTick: day, closes: [toCents(price)] } } };
}

/** Drop the series of companies that no longer exist. */
export function pruneHistory(history, keepIds) {
  const keep = new Set(keepIds);
  const series = Object.fromEntries(Object.entries(history.series).filter(([id]) => keep.has(id)));
  return { ...history, series };
}

/** Closes for a company as prices, oldest first. Optionally only the last `last` entries. */
export function getSeries(history, id, last = null) {
  const closes = history?.series?.[id]?.closes ?? [];
  const slice = last ? closes.slice(-last) : closes;
  return slice.map((c) => c / 100);
}

/** High, low and change over a series of prices. */
export function rangeStats(prices) {
  if (!prices.length) return { high: null, low: null, change: 0 };
  const first = prices[0];
  const lastPrice = prices[prices.length - 1];
  return {
    high: Math.max(...prices),
    low: Math.min(...prices),
    change: first ? (lastPrice - first) / first : 0,
  };
}
