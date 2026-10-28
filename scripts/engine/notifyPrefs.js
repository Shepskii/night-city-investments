/**
 * Notification preferences and the daily digest
 * @file scripts/engine/notifyPrefs.js
 * @description What a player has opted in to hear about, and how. Pure; no Foundry globals.
 */

export const NOTIFY_CATEGORIES = ['fills', 'dividends', 'alerts', 'statements', 'movers', 'tips', 'headlines', 'digest'];
export const NOTIFY_CHANNELS = ['mail', 'chat', 'off'];
/** The "holdings movers" notice goes out when a holding moves at least this much (percent) in a day. */
export const MOVER_DEFAULT_PCT = 5;
export const MOVER_RANGE = { min: 1, max: 50 };

/**
 * Order confirmations, dividends and the price alerts a player set themselves are on by default;
 * monthly statements, holdings movers, headlines and the digest are opt-in.
 */
export const NOTIFY_DEFAULTS = Object.freeze({
  fills: 'mail', dividends: 'mail', alerts: 'mail', statements: 'off', movers: 'off', tips: 'off', headlines: 'off', digest: 'off',
});

/** A player's chosen movers threshold, clamped to a sensible range. */
export function moverThreshold(stored) {
  const n = Number(stored);
  if (!Number.isFinite(n) || n <= 0) return MOVER_DEFAULT_PCT;
  return Math.min(MOVER_RANGE.max, Math.max(MOVER_RANGE.min, Math.round(n * 10) / 10));
}

/**
 * Holdings that moved by at least `thresholdPct` since the last tick, biggest first.
 * @param {object} portfolio
 * @param {Object<string, {price: number, prevClose: number}>} quotes
 * @returns {{assetId: string, price: number, changePct: number, delta: number, qty: number}[]}
 */
export function moversOf(portfolio, quotes, thresholdPct) {
  const qty = new Map();
  for (const lot of portfolio.lots) qty.set(lot.assetId, (qty.get(lot.assetId) ?? 0) + lot.qty);
  const out = [];
  for (const [assetId, n] of qty) {
    const q = quotes[assetId];
    if (!q || !(q.prevClose > 0)) continue;
    const changePct = (q.price - q.prevClose) / q.prevClose;
    if (Math.abs(changePct) * 100 >= thresholdPct) {
      out.push({ assetId, qty: n, price: q.price, changePct, delta: Math.round(n * (q.price - q.prevClose)) });
    }
  }
  return out.sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

/** A player's stored preferences, with defaults filled in and anything invalid ignored. */
export function normalizeNotify(stored) {
  const out = { ...NOTIFY_DEFAULTS };
  for (const key of NOTIFY_CATEGORIES) {
    if (NOTIFY_CHANNELS.includes(stored?.[key])) out[key] = stored[key];
  }
  return out;
}

/**
 * Today's summary of a portfolio: total value, the change since the last tick, and the biggest movers.
 * @param {object} portfolio
 * @param {Object<string, {price: number, prevClose: number}>} quotes - assetId -> prices
 * @returns {{holdings: number, change: number, changePct: number, movers: object[]} | null} null with no holdings
 */
export function digestOf(portfolio, quotes, { maxMovers = 3 } = {}) {
  const byAsset = new Map();
  for (const lot of portfolio.lots) byAsset.set(lot.assetId, (byAsset.get(lot.assetId) ?? 0) + lot.qty);
  if (!byAsset.size) return null;

  let now = 0;
  let before = 0;
  const movers = [];
  for (const [assetId, qty] of byAsset) {
    const q = quotes[assetId];
    if (!q) continue;
    const delta = Math.round(qty * (q.price - q.prevClose));
    now += qty * q.price;
    before += qty * q.prevClose;
    movers.push({ assetId, qty, price: q.price, changePct: q.prevClose ? (q.price - q.prevClose) / q.prevClose : 0, delta });
  }
  movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));
  return {
    holdings: Math.round(now),
    change: Math.round(now - before),
    changePct: before ? (now - before) / before : 0,
    movers: movers.slice(0, maxMovers),
  };
}
