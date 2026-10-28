/**
 * Price alerts
 * @file scripts/engine/alerts.js
 * @description A player can ask to be told when a stock or fund crosses a price, or moves a lot in
 *              one day. Alerts live on the portfolio (the GM writes them, like orders), are checked
 *              after every tick, and fire once when they first become true. A "once" alert is then
 *              removed; a repeating one is disarmed until the condition clears. Pure; no Foundry globals.
 *
 *   alert:  { id, assetId, kind: 'above'|'below'|'move', value, once, armed, createdTick }
 *             above / below: value is a price in eb
 *             move:          value is a percentage (5 means a move of 5% or more, up or down, in one day)
 *   fired:  { alertId, assetId, kind, value, price, prevClose, tick }
 */

import { normalizePortfolio } from './portfolioModel.js';
import { pathRange } from './pricePath.js';

export const ALERT_KINDS = ['above', 'below', 'move'];
export const MAX_ALERTS = 20;
export const ALERT_LOG_CAP = 10;
export const MOVE_RANGE = { min: 0.5, max: 50 };

/**
 * Is the alert's condition true for this quote? A price alert also counts the lowest and highest
 * prices of the run of ticks just made (`range`), so a price that crossed and came back still fires.
 */
export function alertMet(alert, quote, range = null) {
  if (!quote || !(quote.price > 0)) return false;
  switch (alert.kind) {
    case 'above': return Math.max(quote.price, range?.high ?? 0) >= alert.value;
    case 'below': return Math.min(quote.price, range?.low ?? Infinity) <= alert.value;
    case 'move': {
      if (!(quote.prevClose > 0)) return false;
      return (Math.abs(quote.price - quote.prevClose) / quote.prevClose) * 100 >= alert.value;
    }
    default: return false;
  }
}

/**
 * Add an alert.
 * @param {object} o
 * @param {{listed: boolean, active: boolean, price: number, prevClose?: number}} o.asset - the market entry
 * @returns {{ok: true, portfolio: object, alertId: string} | {ok: false, reason: string}}
 */
export function planAlert({ portfolio, key, assetId, kind, value, once = true, asset, tick }) {
  const p = normalizePortfolio(portfolio);
  const v = Number(value);
  if (!asset?.listed) return { ok: false, reason: 'unknown-asset' };
  if (!ALERT_KINDS.includes(kind)) return { ok: false, reason: 'invalid-alert' };
  if (!Number.isFinite(v) || v <= 0) return { ok: false, reason: 'invalid-alert' };
  if (kind === 'move' && (v < MOVE_RANGE.min || v > MOVE_RANGE.max)) return { ok: false, reason: 'invalid-alert' };
  if (p.alerts.length >= MAX_ALERTS) return { ok: false, reason: 'too-many-alerts' };
  if (p.alerts.some((a) => a.assetId === assetId && a.kind === kind && a.value === v)) return { ok: false, reason: 'alert-duplicate' };

  const alert = { id: `al_${key}`, assetId, kind, value: Math.round(v * 100) / 100, once: !!once, armed: true, createdTick: tick };
  // A price alert that is already true would fire on the next tick for no reason.
  if (kind !== 'move' && alertMet(alert, asset)) return { ok: false, reason: 'alert-already-met' };
  return { ok: true, portfolio: { ...p, alerts: [...p.alerts, alert] }, alertId: alert.id };
}

export function removeAlert(portfolio, alertId) {
  const p = normalizePortfolio(portfolio);
  if (!p.alerts.some((a) => a.id === alertId)) return { ok: false, reason: 'not-found', portfolio: p };
  return { ok: true, portfolio: { ...p, alerts: p.alerts.filter((a) => a.id !== alertId) } };
}

/**
 * Check every alert against today's quotes, and the prices along the run of ticks just made.
 * @param {Object<string, {price: number, prevClose: number}>} quotes - assetId -> quote
 * @param {object} [path] - pricePath.js; only the part since an alert was set counts for it
 * @returns {{portfolio: object, fired: object[], changed: boolean}}
 */
export function checkAlerts(portfolio, quotes, tick, path = null) {
  const p = normalizePortfolio(portfolio);
  if (!p.alerts.length) return { portfolio: p, fired: [], changed: false };

  const fired = [];
  const alerts = [];
  let changed = false;

  for (const a of p.alerts) {
    const q = quotes[a.assetId];
    if (!q) {
      alerts.push(a);
      continue;
    }
    const range = path ? pathRange(path, a.assetId, a.createdTick) : null;
    const met = alertMet(a, q, range);
    if (a.armed && met) {
      // Report the price that set it off: the run's high or low, when the price has since come back.
      const reached = a.kind === 'above' && q.price < a.value ? range.high : a.kind === 'below' && q.price > a.value ? range.low : q.price;
      fired.push({ alertId: a.id, assetId: a.assetId, kind: a.kind, value: a.value, price: reached, prevClose: q.prevClose, tick });
      changed = true;
      if (!a.once) alerts.push({ ...a, armed: false });
      continue;
    }
    if (!a.armed && !met) {
      alerts.push({ ...a, armed: true });
      changed = true;
      continue;
    }
    alerts.push(a);
  }

  if (!changed) return { portfolio: p, fired, changed: false };
  return {
    portfolio: { ...p, alerts, alertLog: [...p.alertLog, ...fired].slice(-ALERT_LOG_CAP) },
    fired,
    changed: true,
  };
}
