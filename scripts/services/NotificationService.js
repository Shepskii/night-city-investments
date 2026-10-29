/**
 * Notification service: tells players about their orders, dividends, news and portfolio, if they
 * have opted in. GM client only.
 * @file scripts/services/NotificationService.js
 * @description Each player chooses, per category, mail (from their broker or the market wire),
 *              a private chat message, or nothing. Broker withdrawals are not a notification: the
 *              payout mail carries the money, so it is always sent (see PortfolioService).
 */

import { normalizeNotify, digestOf, valuePortfolio, moversOf, moverThreshold } from '../engine/index.js';
import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { MarketStore } from '../data/MarketStore.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { MailService, html } from './MailService.js';

export const NotificationService = {
  /** A character's notification choices, with defaults filled in. */
  prefs(actor) {
    return normalizeNotify(actor?.getFlag?.(MODULE_ID, FLAGS.PREFS)?.notify);
  },

  /** Users who should see a private message about this character. */
  _recipients(actor) {
    const owners = game.users.filter((u) => !u.isGM && actor.testUserPermission?.(u, 'OWNER'));
    return (owners.length ? owners : game.users.filter((u) => u.isGM)).map((u) => u.id);
  },

  /**
   * Deliver one notice by the channel the player chose for the category.
   * @param {Actor} actor
   * @param {'fills'|'dividends'|'headlines'|'digest'} category
   * @param {{subject: string, lines: string[]}} spec
   * @param {string|null} brokerId - send from this broker, or from the market wire when null
   */
  async notify(actor, category, spec, brokerId = null) {
    const channel = this.prefs(actor)[category];
    if (channel === 'off') return { ok: true, skipped: true };

    if (channel === 'chat') {
      if (typeof ChatMessage === 'undefined') return { ok: false };
      await ChatMessage.create({
        whisper: this._recipients(actor),
        speaker: { alias: brokerId ? 'Broker' : 'Market Wire' },
        content: `<div class="nci-chat"><strong>${html([spec.subject])}</strong>${html(spec.lines)}</div>`,
      });
      return { ok: true };
    }

    const sent = brokerId ? await MailService.fromBroker(brokerId, actor, spec) : await MailService.fromWire(actor, spec);
    if (!sent.ok) log.warn(`Notification mail to ${actor.name} failed: ${sent.error}`);
    return sent;
  },

  /**
   * Portfolio events and request results: broker-handled orders get confirmations.
   * Orders placed by mail already got a reply, so their "received" notice is skipped.
   */
  async onPortfolioEvents({ actorId, events = [], results = [] }) {
    if (!isActiveGM()) return;
    const actor = PortfolioRepository.accountOf(actorId);
    if (!actor) return;
    const portfolio = PortfolioRepository.get(actor);

    for (const ev of events) {
      if (ev.type === 'alertFired') {
        await this.notify(actor, 'alerts', MailService.alert(ev));
        continue;
      }
      if (ev.type === 'withdrawalFailed') {
        if (ev.brokerId) await MailService.fromBroker(ev.brokerId, actor, MailService.withdrawalFailed(ev));
        continue;
      }
      if (ev.route !== 'broker' || !ev.brokerId) continue;
      if (ev.type === 'orderFilled') await this.notify(actor, 'fills', MailService.orderFilled(ev), ev.brokerId);
      else if (ev.type === 'orderRejected') await this.notify(actor, 'fills', MailService.orderRejected(ev), ev.brokerId);
      else if (ev.type === 'orderExpired') await this.notify(actor, 'fills', MailService.orderExpired(ev), ev.brokerId);
    }

    for (const res of results) {
      if (!res.ok || MailService.mailKeys.has(res.key) || !portfolio.brokerContactId) continue;
      if (res.type === 'placeOrder' && res.route === 'broker') {
        const order = portfolio.orders.find((o) => o.id === res.orderId);
        if (order) await this.notify(actor, 'fills', MailService.orderAccepted(order, { tick: res.tick }), portfolio.brokerContactId);
      } else if (res.type === 'withdraw' && res.pending) {
        await this.notify(actor, 'fills', MailService.withdrawalQueued({ ...res, tick: res.tick }), portfolio.brokerContactId);
      }
    }
  },

  /** A dividend has been paid: tell each holder who opted in. */
  async onDividend({ companyId, perShare, payouts = [] }) {
    if (!isActiveGM()) return;
    const name = CompanyRepository.get(companyId)?.name ?? FundRepository.get(companyId)?.name ?? companyId;
    for (const { actorId, payout } of payouts) {
      const actor = PortfolioRepository.accountOf(actorId);
      if (actor) await this.notify(actor, 'dividends', MailService.dividend({ name, perShare, payout }));
    }
  },

  /**
   * A headline was published: mail it to everyone who opted in to headlines. One that came from a gig
   * outcome reads like a rumour, so a player with a broker hears it from them, in their voice.
   */
  async onHeadline(item) {
    if (!isActiveGM()) return;
    for (const actor of game.actors.filter((a) => a.type === 'character' && PortfolioRepository.hasPortfolio(a))) {
      if (this.prefs(actor).headlines === 'off') continue;
      const brokerId = item.source === 'gig' ? PortfolioRepository.get(actor).brokerContactId ?? null : null;
      await this.notify(actor, 'headlines', brokerId ? MailService.gigHeadline(item) : MailService.headline(item), brokerId);
    }
  },

  /**
   * After a tick: send the daily digest and the big-movers notice to holders who opted in. Both are
   * about a day's move, so with finer ticks they go out only when a new game day has started.
   * @param {{newDay?: boolean}} [tick] - the price-tick hook's data
   */
  async onTick(tick = null) {
    if (!isActiveGM()) return;
    if (tick && tick.newDay === false) return;
    const pub = MarketStore.getPublic();
    const quotes = {};
    for (const [id, s] of Object.entries(pub.companies ?? {})) quotes[id] = { price: s.price, prevClose: s.prevClose };
    for (const [id, s] of Object.entries(pub.funds ?? {})) quotes[id] = { price: s.nav, prevClose: s.prevNav };

    for (const actor of game.actors.filter((a) => a.type === 'character' && PortfolioRepository.hasPortfolio(a))) {
      const prefs = this.prefs(actor);
      const portfolio = PortfolioRepository.get(actor);
      if (prefs.digest !== 'off') {
        const d = digestOf(portfolio, quotes);
        if (d) await this.notify(actor, 'digest', MailService.digest(d));
      }
      if (prefs.movers !== 'off') {
        const threshold = this.moverPct(actor);
        const movers = moversOf(portfolio, quotes, threshold);
        if (movers.length) await this.notify(actor, 'movers', MailService.movers(movers, threshold));
      }
    }
  },

  /** The daily move, in percent, at which a holding counts as a mover for this character. */
  moverPct(actor) {
    return moverThreshold(actor?.getFlag?.(MODULE_ID, FLAGS.PREFS)?.moverPct);
  },

  /** A short account summary for a broker's STATUS reply. */
  statusOf(actor, prices, tickerOf) {
    const p = PortfolioRepository.get(actor);
    const v = valuePortfolio(p, prices);
    return {
      cash: p.cash,
      holdings: v.holdings,
      openOrders: p.orders.filter((o) => o.status === 'open').length,
      positions: v.positions.map((pos) => ({ ticker: tickerOf(pos.assetId), qty: pos.qty, value: pos.value, pnl: pos.unrealized })),
    };
  },
};
