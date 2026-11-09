/**
 * Broker mail to requests
 * @file scripts/engine/brokerMail.js
 * @description Turns a parsed command from a player's mail to their broker (see orderParser.js)
 *              into an executor request, or a reason the broker cannot act on it. Mail always goes
 *              through the broker route. Pure; no Foundry globals.
 */

import { OPEN, reservedShares } from './portfolioModel.js';
import { heldQty } from './orderEngine.js';
import { mailLines, parseOrderLine } from './orderParser.js';

/** Short reference shown in broker mail so a client can quote it back: `CANCEL <ref>`. */
export const orderRef = (id) => String(id).slice(-6).toUpperCase();

// Everyday words: "Help!" or "Status" on a line of a longer mail is someone talking.
const WHOLE_MESSAGE_ONLY = new Set(['status', 'statement', 'help']);

/**
 * The market command in a mail to a broker, or null if the mail is not market business and is the GM's to answer.
 * A broker can be a character players also talk to, so a mail only counts if it holds a real command: a ticker on this
 * market, the sender's own order reference, or a one-word request that is the whole message.
 * @param {object} o
 * @param {string} o.text - the subject, a line break, then the body
 * @param {object} o.portfolio - the sender's
 * @param {(ticker: string) => ({assetId: string, kind: 'stock'|'fund'}|null)} o.resolveAsset
 * @returns {object|null} a result of parseOrderLine() for mailCommandToRequest()
 */
export function marketCommand({ text, portfolio, resolveAsset }) {
  const [subject = '', ...rest] = String(text ?? '').split(/\r?\n/);
  const body = mailLines(rest.join('\n'));
  const wholeMessage = body.length === 1 ? body[0] : body.length ? null : subject.trim();
  let failure = null;
  for (const line of [subject, ...body]) {
    const parsed = parseOrderLine(line);
    if (!parsed) continue;
    if (!parsed.ok) {
      const market = parsed.error === 'bad-amount' || (parsed.ticker && resolveAsset(parsed.ticker));
      if (market) failure ??= parsed;
      continue;
    }
    if (WHOLE_MESSAGE_ONLY.has(parsed.cmd) && line.trim() !== wholeMessage) continue;
    const read = mailCommandToRequest({ parsed, key: '', portfolio, resolveAsset });
    if (!read.ok && (read.reason === 'unknown-asset' || read.reason === 'not-found')) continue;
    return parsed;
  }
  return failure;
}

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
