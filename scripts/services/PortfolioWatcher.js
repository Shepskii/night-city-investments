/**
 * Portfolio watcher: tells players what happened to their requests and orders.
 * @file scripts/services/PortfolioWatcher.js
 */

import { HOOKS, MODULE_ID } from '../utils/constants.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { PortfolioClient } from './PortfolioClient.js';

const L = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const eb = (n) => `${Math.round(n).toLocaleString()} eb`;
const price = (n) => Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const tickerOf = (assetId) => CompanyRepository.get(assetId)?.ticker ?? FundRepository.get(assetId)?.ticker ?? assetId;

/** Human description of an order, e.g. "BUY 10 ARA (limit 95.00)". */
export function describeOrder(o) {
  if (o.type === 'ipo') return L('NCI.Ipo.OrderText', { qty: o.requestedQty ?? o.qty, ticker: tickerOf(o.assetId), price: price(o.offerPrice ?? o.fillPrice ?? 0) });
  const type = o.type === 'market' ? L('NCI.OrderType.market') : `${L(`NCI.OrderType.${o.type}`)} ${price(o.limit)}`;
  return `${L(`NCI.Side.${o.side}`)} ${o.qty} ${tickerOf(o.assetId)} (${type})`;
}

export const PortfolioWatcher = {
  _seenResults: new Set(),
  _orderStatus: new Map(),

  /** Remember the current state so that only later changes are announced. */
  snapshot() {
    for (const actor of game.actors.filter((a) => a.type === 'character' && a.isOwner)) {
      const p = PortfolioRepository.get(actor);
      p.results.forEach((r) => this._seenResults.add(r.key));
      p.orders.forEach((o) => this._orderStatus.set(o.id, o.status));
    }
  },

  /** Hook for `updateActor` on every client. */
  onActorUpdate(actor, changes) {
    if (!foundry.utils.hasProperty(changes, `flags.${MODULE_ID}`)) return;
    Hooks.callAll(HOOKS.PORTFOLIO_UPDATED, actor.id);
    if (!actor.isOwner) return;

    PortfolioClient.prune(actor);
    const p = PortfolioRepository.get(actor);

    for (const result of p.results) {
      if (this._seenResults.has(result.key)) continue;
      this._seenResults.add(result.key);
      if (PortfolioClient.submitted.has(result.key)) this._announceResult(result);
    }

    for (const order of p.orders) {
      const before = this._orderStatus.get(order.id);
      this._orderStatus.set(order.id, order.status);
      // A GM would be told about every player's orders, so only players hear about fills.
      if (game.user.isGM || before === order.status || before === undefined) continue;
      this._announceOrder(order);
    }
  },

  _announceResult(r) {
    if (!r.ok) {
      ui.notifications.warn(L('NCI.Notify.RequestFailed', { reason: L(`NCI.Reasons.${r.reason}`) }));
      return;
    }
    const days = (to) => Math.max(1, (to ?? 0) - (r.tick ?? 0));
    switch (r.type) {
      case 'setDrip':
        ui.notifications.info(L(r.enabled ? 'NCI.Notify.DripOn' : 'NCI.Notify.DripOff'));
        break;
      case 'setBroker':
        ui.notifications.info(L(r.brokerId ? 'NCI.Notify.BrokerSet' : 'NCI.Notify.BrokerCleared'));
        break;
      case 'connectTerminal':
        if (r.already) ui.notifications.info(L('NCI.Notify.SessionAlready'));
        else if (r.passed) ui.notifications.info(L('NCI.Notify.SessionOpen', { total: r.total, dv: r.dv }));
        else ui.notifications.warn(L('NCI.Notify.SessionFailed', { total: r.total, dv: r.dv }));
        break;
      case 'placeOrder':
        ui.notifications.info(r.route === 'broker'
          ? L('NCI.Notify.OrderSentToBroker', { days: days(r.eligibleTick) })
          : L('NCI.Notify.OrderPlaced', { amount: '' }));
        break;
      case 'withdraw':
        ui.notifications.info(r.pending
          ? L('NCI.Notify.WithdrawalQueued', { amount: eb(r.amount), days: days(r.releaseTick) })
          : L('NCI.Notify.Withdrawn', { amount: eb(r.amount) }));
        break;
      case 'cancelWithdrawal':
        ui.notifications.info(L('NCI.Notify.WithdrawalCancelled'));
        break;
      case 'subscribeIpo':
        ui.notifications.info(L('NCI.Notify.IpoSubscribed', { amount: eb(r.reserve) }));
        break;
      case 'setAlert':
        ui.notifications.info(L('NCI.Notify.AlertSet'));
        break;
      case 'removeAlert':
        ui.notifications.info(L('NCI.Notify.AlertRemoved'));
        break;
      case 'requestStatement':
        ui.notifications.info(L('NCI.Notify.StatementRequested'));
        break;
      case 'heatAction': {
        const text = L(`NCI.Heat.Action.Result.${r.outcome}`, { action: L(`NCI.Heat.Action.${r.action}.Name`), total: r.total, dv: r.dv, cost: eb(r.cost) });
        (r.passed ? ui.notifications.info : ui.notifications.warn).call(ui.notifications, text);
        break;
      }
      default: {
        const key = { deposit: 'Deposited', cancelOrder: 'OrderCancelled' }[r.type];
        if (key) ui.notifications.info(L(`NCI.Notify.${key}`, { amount: r.amount !== undefined ? eb(r.amount) : '' }));
      }
    }
  },

  _announceOrder(o) {
    const text = describeOrder(o);
    if (o.status === 'filled') {
      ui.notifications.info(L('NCI.Notify.OrderFilled', { order: text, price: price(o.fillPrice) }));
    } else if (o.status === 'rejected') {
      ui.notifications.warn(L('NCI.Notify.OrderRejected', { order: text, reason: L(`NCI.Reasons.${o.reason}`) }));
    } else if (o.status === 'expired') {
      ui.notifications.info(L('NCI.Notify.OrderExpired', { order: text }));
    }
  },
};
