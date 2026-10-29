/**
 * Trade dialog: place a buy or sell order for the selected character.
 * @file scripts/ui/TradeDialog/TradeDialogApp.js
 */

import {
  quote, estimateOrder, committedCash, reservedShares, heldQty, sessionActive, describeTerms, feeProfileOf, timeOf,
} from '../../engine/index.js';
import { MODULE_ID } from '../../utils/constants.js';
import { CompanyRepository } from '../../data/CompanyRepository.js';
import { FundRepository } from '../../data/FundRepository.js';
import { BrokerRepository } from '../../data/BrokerRepository.js';
import { MarketStore } from '../../data/MarketStore.js';
import { PortfolioRepository } from '../../data/PortfolioRepository.js';
import { PortfolioClient } from '../../services/PortfolioClient.js';
import { SyndicateClient } from '../../services/SyndicateClient.js';
import { accountFor } from '../accounts.js';
import { orderValue } from '../../engine/index.js';
import { TradingSettings } from '../../services/TradingSettings.js';
import { BaseApplication } from '../BaseApplication.js';
import { L, money, whole } from '../format.js';

export class TradeDialogApp extends BaseApplication {
  static DEFAULT_OPTIONS = {
    tag: 'form',
    window: { title: 'NCI.Trade.Title', icon: 'fas fa-right-left', resizable: false },
    position: { width: 440, height: 'auto' },
    form: { handler: TradeDialogApp._onSubmit, closeOnSubmit: false, submitOnChange: false },
    actions: { cancel: TradeDialogApp._onCancel },
  };

  static PARTS = {
    form: { template: `modules/${MODULE_ID}/templates/dialogs/trade.hbs` },
  };

  /** Open a trade window. `side` is 'buy' or 'sell'. */
  static trade({ actorId, assetId, side = 'buy' }) {
    const app = new TradeDialogApp({ id: `nci-trade-${String(actorId).replace(/[^\w-]/g, '_')}-${assetId}`, actorId, assetId, side });
    app.render({ force: true });
    return app;
  }

  constructor(options = {}) {
    super(options);
    this.actorId = options.actorId;
    this.assetId = options.assetId;
    this.side = options.side ?? 'buy';
  }

  static _onCancel() {
    return this.close();
  }

  static async _onSubmit(event, form, formData) {
    const data = foundry.utils.expandObject(formData.object);
    const actor = accountFor(this.actorId);
    const qty = Math.floor(Number(data.qty));
    if (!actor || !(qty >= 1)) return ui.notifications.warn(L('NCI.Reasons.invalid-qty'));

    const orderType = data.orderType ?? 'market';
    const limit = Number(data.limit);
    if (orderType !== 'market' && !(limit > 0)) return ui.notifications.warn(L('NCI.Reasons.invalid-limit'));

    const order = {
      route: data.route,
      side: data.side,
      assetId: this.assetId,
      qty,
      orderType,
      limit: orderType === 'market' ? null : limit,
      expiry: data.expiry ?? 'day',
    };
    // A syndicate order over the officers' limit goes to the members as a proposal (DESIGN §31).
    const pub = MarketStore.getPublic();
    const market = { [this.assetId]: { price: pub.companies?.[this.assetId]?.price ?? pub.funds?.[this.assetId]?.nav ?? 0 } };
    if (actor.isSyndicate && orderValue(order, market) > actor.syndicate.rules.tradeLimit) {
      await SyndicateClient.submit(actor.as, 'propose', { syndicateId: actor.id, kind: 'trade', order });
    } else {
      await PortfolioClient.submit(actor, 'placeOrder', order);
    }
    await this.close();
  }

  /**
   * The ways this character can place this order. Funds are broker-only; direct trading needs an open
   * terminal session unless the GM has switched the check off.
   */
  _routes({ isFund, portfolio, tick, fund }) {
    const mode = TradingSettings.mode();
    const direct = TradingSettings.direct();
    const broker = BrokerRepository.get(portfolio.brokerContactId);
    const routes = {};

    if (broker?.available) {
      const d = describeTerms(broker.terms);
      routes.broker = {
        enabled: true,
        label: L('NCI.Route.brokerNamed', { name: broker.name }),
        feeProfile: feeProfileOf(broker.terms),
        note: L('NCI.Trade.BrokerNote', { days: d.minDays === d.maxDays ? `${d.minDays}` : `${d.minDays}-${d.maxDays}` }),
        fundBps: isFund ? this._expectedFundBps(fund, broker.terms) : null,
      };
    } else {
      routes.broker = { enabled: false, label: L('NCI.Route.broker'), feeProfile: { flatFee: 0, commissionBps: 0 }, note: L('NCI.Trade.NoBroker') };
    }

    if (isFund) {
      routes.direct = { enabled: false, label: L('NCI.Route.direct'), feeProfile: { flatFee: 0, commissionBps: 0 }, note: L('NCI.Fund.BrokerOnly') };
    } else {
      const open = mode === 'open' || sessionActive(portfolio, tick);
      routes.direct = {
        enabled: open,
        label: L('NCI.Route.direct'),
        feeProfile: { flatFee: direct.flatFee, commissionBps: direct.commissionBps },
        note: open ? L('NCI.Trade.DirectNote') : L('NCI.Trade.DirectLocked'),
      };
    }
    return routes;
  }

  /** The broker's typical effect on a fund price, in bps, for the estimate (load net of rebate, less average timing). */
  _expectedFundBps(fund, terms) {
    const rebate = terms.loadRebate ?? 0;
    return {
      buy: (fund?.loadBps ?? 0) * (1 - rebate) - terms.timingMeanBps,
      sell: -((fund?.exitBps ?? 0) * (1 - rebate)) + terms.timingMeanBps,
    };
  }

  async _prepareContext() {
    const company = CompanyRepository.get(this.assetId);
    const fund = company ? null : FundRepository.get(this.assetId);
    const isFund = !!fund;
    const pub = MarketStore.getPublic();
    const price = isFund ? (pub.funds?.[this.assetId]?.nav ?? 0) : (pub.companies?.[this.assetId]?.price ?? 0);
    const q = isFund ? { bid: price, ask: price } : quote(price, company?.liquidity ?? 3);
    const actor = accountFor(this.actorId);
    const p = PortfolioRepository.get(actor);
    const held = heldQty(p.lots, this.assetId);
    const tick = timeOf(pub);

    const routes = this._routes({ isFund, portfolio: p, tick, fund });
    const settleDays = Math.max(TradingSettings.settlementDays(), isFund ? (fund.redeemDelay ?? 0) : 0);
    const route = routes.direct.enabled && !routes.broker.enabled ? 'direct' : routes.broker.enabled ? 'broker' : 'direct';
    this._ctx = { routes, bid: q.bid, ask: q.ask, isFund };

    const orderTypes = isFund
      ? { market: L('NCI.OrderType.market') }
      : { market: L('NCI.OrderType.market'), limit: L('NCI.OrderType.limit'), stop: L('NCI.OrderType.stop') };

    return {
      ticker: (company ?? fund)?.ticker ?? this.assetId,
      name: (company ?? fund)?.name ?? '',
      isFund,
      settleNote: settleDays > 0 ? L('NCI.Trade.SettleNote', { n: settleDays }) : '',
      side: this.side,
      sides: { buy: L('NCI.Side.buy'), sell: L('NCI.Side.sell') },
      orderTypes,
      expiries: { day: L('NCI.Expiry.day'), gtc: L('NCI.Expiry.gtc') },
      routeOptions: Object.fromEntries(Object.entries(routes).map(([key, r]) => [key, r.label])),
      route,
      routeNotes: Object.entries(routes).map(([key, r]) => ({ key, note: r.note, enabled: r.enabled })),
      price: money(price),
      bid: q.bid,
      ask: q.ask,
      bidText: money(q.bid),
      askText: money(q.ask),
      cash: whole(p.cash - committedCash(p.orders)),
      held,
      available: held - reservedShares(p.orders, this.assetId),
      actorName: actor?.name ?? '',
      syndicate: actor?.isSyndicate ? {
        officer: actor.isOfficer,
        note: actor.isOfficer ? L('NCI.Syndicate.TradeNote', { amount: actor.syndicate.rules.tradeLimit.toLocaleString() }) : L('NCI.Syndicate.NotOfficer'),
      } : null,
    };
  }

  _onRender(context, options) {
    super._onRender?.(context, options);
    const form = this.element;
    const update = () => this._updateEstimate(form);
    form.addEventListener('input', update);
    update();
  }

  /** Show the estimated cost or proceeds, and the route's note, as the player edits the form. */
  _updateEstimate(form) {
    const ctx = this._ctx;
    const get = (name) => form.querySelector(`[name="${name}"]`)?.value;
    const target = form.querySelector('.nci-estimate');
    if (!ctx || !target) return;

    const route = ctx.routes[get('route')] ?? ctx.routes.broker;
    form.querySelectorAll('[data-route-note]').forEach((n) => { n.hidden = n.dataset.routeNote !== get('route'); });
    form.querySelector('button[type="submit"]')?.toggleAttribute('disabled', !route.enabled);

    const side = get('side');
    const qty = Math.floor(Number(get('qty')));
    const type = get('orderType');
    const limit = Number(get('limit'));
    if (!(qty >= 1)) {
      target.textContent = '—';
      return;
    }

    let ref = side === 'buy' ? (type === 'limit' && limit > 0 ? Math.max(limit, ctx.ask) : ctx.ask) : ctx.bid;
    if (ctx.isFund && route.fundBps) ref *= 1 + route.fundBps[side] / 10000;
    const est = estimateOrder({ side, qty, price: ref, feeProfile: route.feeProfile });
    const label = side === 'buy' ? L('NCI.Trade.EstCost') : L('NCI.Trade.EstProceeds');
    target.textContent = `${label}: ${whole(est.total)} eb (${L('NCI.Trade.Fees')} ${whole(est.fees)} eb)`;
  }
}
