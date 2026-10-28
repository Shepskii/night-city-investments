/**
 * Broker mail to requests
 * @file scripts/engine/brokerMail.js
 * @description Turns a parsed command from a player's mail to their broker (see orderParser.js)
 *              into an executor request, or a reason the broker cannot act on it. Mail always goes
 *              through the broker route. Pure; no Foundry globals.
 */

import { OPEN, reservedShares } from './portfolioModel.js';
import { heldQty } from './orderEngine.js';

/** Short reference shown in broker mail so a client can quote it back: `CANCEL <ref>`. */
export const orderRef = (id) => String(id).slice(-6).toUpperCase();

/**
 * @param {object} o
 * @param {object} o.parsed - result of parseOrderText()
 * @param {string} o.key - idempotency key for the request, e.g. `mail_<messageId>`
 * @param {object} o.portfolio
 * @param {(ticker: string) => ({assetId: string, kind: 'stock'|'fund'}|null)} o.resolveAsset
 * @returns {{ok: true, request: object} | {ok: true, reply: 'status'|'statement'|'help'} | {ok: false, reason: string, ticker?: string}}
 */
export function mailCommandToRequest({ parsed, key, portfolio, resolveAsset }) {
  if (!parsed?.ok) return { ok: false, reason: parsed?.error ?? 'unrecognised' };

  switch (parsed.cmd) {
    case 'buy':
    case 'sell': {
      const asset = resolveAsset(parsed.ticker);
      if (!asset) return { ok: false, reason: 'unknown-asset', ticker: parsed.ticker };

      let qty = parsed.qty;
      if (qty === 'all') {
        qty = heldQty(portfolio.lots, asset.assetId) - reservedShares(portfolio.orders, asset.assetId);
        if (qty <= 0) return { ok: false, reason: 'insufficient-shares', ticker: parsed.ticker };
      }
      const orderType = parsed.type ?? 'market';
      return {
        ok: true,
        request: {
          key,
          type: 'placeOrder',
          route: 'broker',
          side: parsed.cmd,
          assetId: asset.assetId,
          qty,
          orderType,
          limit: orderType === 'market' ? null : parsed.limit,
          // A broker keeps working a limit or stop order until it triggers.
          expiry: orderType === 'market' ? 'day' : 'gtc',
        },
      };
    }
    case 'withdraw':
      return { ok: true, request: { key, type: 'withdraw', amount: parsed.amount } };

    case 'cancel': {
      const ref = String(parsed.ref).toUpperCase();
      const order = portfolio.orders.find((o) => o.status === OPEN && orderRef(o.id) === ref);
      if (order) return { ok: true, request: { key, type: 'cancelOrder', orderId: order.id } };
      const pending = portfolio.withdrawals.find((w) => w.status === 'pending' && orderRef(w.id) === ref);
      if (pending) return { ok: true, request: { key, type: 'cancelWithdrawal', withdrawalId: pending.id } };
      return { ok: false, reason: 'not-found' };
    }
    case 'status':
    case 'statement':
    case 'help':
      return { ok: true, reply: parsed.cmd };
    default:
      return { ok: false, reason: 'unrecognised' };
  }
}
