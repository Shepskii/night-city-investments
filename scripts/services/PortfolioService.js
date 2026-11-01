/**
 * Portfolio service: the GM-side executor.
 * @file scripts/services/PortfolioService.js
 * @description Runs only on the active GM client. It reads each player's outbox, applies the
 *              requests with the pure executor, moves CPR wealth for deposits and withdrawals,
 *              writes the portfolio, works open orders after every market tick, and pays broker
 *              withdrawals by mail when they fall due. Everything goes through one serial queue.
 */

import {
  applyRequests, runOrders, OPEN, PROCESSED_CAP, lockedOut, sessionActive, dueWithdrawals, markWithdrawalPaid, failPaidWithdrawal,
  ipoStatus, ipoPrice, dayIndex, checkAlerts, releaseSettled, HEAT_ACTIONS, canAttempt, currentHeat, heatTier, scrutinyFor,
  dailySellCap, TIME_EPS,
} from '../engine/index.js';
import { HOOKS, MODULE_ID, SETTINGS } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { CompanyRepository } from '../data/CompanyRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { BrokerRepository } from '../data/BrokerRepository.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { WealthAdapter } from './WealthAdapter.js';
import { TradingSettings } from './TradingSettings.js';
import { TerminalAccess } from './TerminalAccess.js';
import { SkillAdapter } from './SkillAdapter.js';
import { MailService } from './MailService.js';
import { MarketClock } from './MarketClockService.js';
import { TickService } from './TickService.js';
import { SerialQueue } from '../utils/queue.js';

class PortfolioServiceImpl {
  constructor() {
    this._queue = new SerialQueue('Portfolio service task');
  }

  /** assetId -> { listed, active, price, liquidity, kind?, fund?, ipo? } for every company and fund that has a price. */
  market() {
    const pub = MarketStore.getPublic();
    const today = dayIndex(MarketClock.nowMs());
    const out = {};
    for (const c of CompanyRepository.all({ includeUnlisted: true })) {
      const s = pub.companies?.[c.id];
      if (!s) continue;
      const open = ipoStatus(c, today).state === 'window';
      // A listed player company's secondary offering is subscribed for like an IPO (B6a).
      const offering = c.listed && c.offering && today <= c.offering.endDay;
      out[c.id] = {
        listed: c.listed,
        active: c.status === 'active',
        price: s.price,
        prevClose: s.prevClose,
        liquidity: c.liquidity,
        ...(open ? { ipo: { open: true, price: ipoPrice(c) } } : {}),
        ...(offering ? { ipo: { open: true, price: c.offering.price } } : {}),
      };
    }
    for (const f of FundRepository.all()) {
      const s = pub.funds?.[f.id];
      if (!s) continue;
      out[f.id] = {
        listed: true,
        active: f.status === 'active',
        kind: 'fund',
        price: s.nav,
        prevClose: s.prevNav,
        liquidity: 5,
        fund: { loadBps: f.loadBps, exitBps: f.exitBps, minBuy: f.minBuy, redeemDelay: f.redeemDelay ?? 0 },
      };
    }
    return out;
  }

  /**
   * The market as the GM's executor trades on it: with each listed player company's liquidity cap
   * (B5c), the shares the market will still buy from players today, after what every account sold.
   */
  tradingMarket() {
    const market = this.market();
    const listed = BusinessRepository.all().filter((b) => b.listing?.status === 'listed' && market[b.company?.ticker]);
    if (!listed.length) return market;
    const today = Math.floor(this.tick() + TIME_EPS);
    const sold = {};
    for (const account of PortfolioRepository.accounts().filter((a) => PortfolioRepository.hasPortfolio(a))) {
      for (const o of PortfolioRepository.get(account).orders ?? []) {
        if (o.side === 'sell' && o.status === 'filled' && Math.floor((o.filledTick ?? -1) + TIME_EPS) === today) sold[o.assetId] = (sold[o.assetId] ?? 0) + o.qty;
      }
    }
    for (const b of listed) {
      const id = b.company.ticker;
      market[id] = { ...market[id], sellCap: Math.max(0, dailySellCap(b, this._fixerOperator(b)) - (sold[id] ?? 0)) };
    }
    return market;
  }

  /** The best Operator rank among a company's officers who are Fixers (a syndicate officer counts its own officers). */
  _fixerOperator(b) {
    const actorsOf = (id) => {
      const actor = game.actors.get(id);
      if (actor) return [actor];
      return (SyndicateRepository.get(id)?.members ?? []).filter((m) => m.status === 'active' && m.role === 'officer').map((m) => game.actors.get(m.actorId)).filter(Boolean);
    };
    return Math.max(0, ...(b.officers ?? []).flatMap(actorsOf).map((actor) => SkillAdapter.readAbility(actor, 'Operator').rank));
  }

  /**
   * The `settings` the pure executor takes: trading rules, every broker's terms, and any dice results.
   * With an actor it also carries the insider-trading state: whether cover-up actions are on, and the
   * slower, dearer broker a character the authorities are watching has to put up with.
   */
  settings(checks = {}, actor = null) {
    const heatOn = this.heatEnabled();
    return {
      ...TradingSettings.forExecutor(),
      brokers: BrokerRepository.executorMap(),
      checks,
      dt: TickService.tickDays,
      heat: { enabled: heatOn },
      ...(heatOn && actor && game.settings.get(MODULE_ID, SETTINGS.HEAT_CONSEQUENCES) !== false ? { scrutiny: this.scrutinyOf(actor) } : {}),
    };
  }

  heatEnabled() {
    return game.settings.get(MODULE_ID, SETTINGS.HEAT_ENABLED) === true;
  }

  /** How closely this character is being watched: nothing below "flagged". GM only, since the record is hidden. */
  scrutinyOf(actor) {
    const entry = MarketStore.getHeat().characters[actor.id];
    return scrutinyFor(heatTier(currentHeat(entry, this.tick())));
  }

  tick() {
    return MarketStore.time();
  }

  /** Handle whatever is waiting in one actor's outbox. */
  processActor(actor) {
    if (!isActiveGM()) return Promise.resolve();
    return this._queue.run(() => this._process(actor));
  }

  /** Handle every actor's outbox, and pay any withdrawals that are due. Run at startup. */
  sweepAll() {
    if (!isActiveGM()) return Promise.resolve();
    return this._queue.run(async () => {
      for (const actor of this._accounts()) {
        await this._process(actor);
        await this._payWithdrawals(actor);
      }
    });
  }

  /**
   * Work every open order against the new prices, check price alerts, then pay withdrawals that are due.
   * @param {{path?: object}} [tick] - the `priceTick` payload; its `path` holds the prices along the run
   */
  onTick(tick = null) {
    if (!isActiveGM()) return Promise.resolve();
    const path = tick?.path ?? null;
    return this._queue.run(async () => {
      for (const actor of this._accounts()) {
        await this._release(actor);
        await this._process(actor);
        await this._runOrders(actor, path);
        await this._checkAlerts(actor, path);
        await this._payWithdrawals(actor);
      }
    });
  }

  /** Sale proceeds that have finished settling become spendable. */
  async _release(actor) {
    const portfolio = PortfolioRepository.get(actor);
    if (!portfolio.unsettled.length) return;
    const out = releaseSettled(portfolio, this.tick());
    if (!out.released) return;
    await PortfolioRepository.save(actor, out.portfolio);
    this._emit(actor, [{ type: 'proceedsReleased', amount: out.released }], []);
  }

  /** Tell the player about any price alert that has just come true. */
  async _checkAlerts(actor, path = null) {
    const portfolio = PortfolioRepository.get(actor);
    if (!portfolio.alerts.length) return;
    const quotes = Object.fromEntries(Object.entries(this.market()).map(([id, m]) => [id, { price: m.price, prevClose: m.prevClose }]));
    const out = checkAlerts(portfolio, quotes, this.tick(), path);
    if (!out.changed) return;
    await PortfolioRepository.save(actor, out.portfolio);
    this._emit(actor, out.fired.map((f) => ({ type: 'alertFired', ...f })), []);
  }

  /**
   * Apply one request that did not come from the outbox (a broker mail). Resolves with
   * { result, events, portfolio }.
   */
  applyNow(actor, request) {
    if (!isActiveGM()) return Promise.resolve(null);
    return this._queue.run(async () => {
      const portfolio = PortfolioRepository.get(actor);
      const wealth = WealthAdapter.get(actor);
      const out = applyRequests({
        portfolio, requests: [request], wealth, tick: this.tick(), market: this.tradingMarket(), settings: this.settings({}, actor),
      });
      if (out.wealth !== wealth) await WealthAdapter.set(actor, out.wealth, 'Night City Investments: brokerage transfer');
      await PortfolioRepository.save(actor, out.portfolio);
      const result = out.portfolio.results.find((r) => r.key === request.key) ?? null;
      this._emit(actor, out.events, result ? [result] : []);
      return { result, events: out.events, portfolio: out.portfolio };
    });
  }

  /** Run a task in step with order processing (syndicate requests change members' portfolios too). */
  exclusive(fn) {
    return this._queue.run(fn);
  }

  /** Every account: the characters and the active syndicates (DESIGN §30). */
  _accounts() {
    return PortfolioRepository.accounts();
  }

  /** Remember that a mail has been handled, even if it produced no request. */
  markProcessed(actor, key) {
    if (!isActiveGM()) return Promise.resolve();
    return this._queue.run(async () => {
      const p = PortfolioRepository.get(actor);
      if (p.processed.includes(key)) return;
      await PortfolioRepository.save(actor, { ...p, processed: [...p.processed, key].slice(-PROCESSED_CAP) });
    });
  }

  /**
   * Apply a change to every portfolio, in step with order processing. Used by dividends and
   * corporate actions.
   * @param {(portfolio: object, actor: Actor) => ({portfolio: object, changed: boolean} | null)} fn
   * @returns {Promise<number>} how many portfolios changed
   */
  transformAll(fn) {
    if (!isActiveGM()) return Promise.resolve(0);
    return this._queue.run(async () => {
      let changedCount = 0;
      for (const actor of this._accounts()) {
        if (!PortfolioRepository.hasPortfolio(actor)) continue;
        const out = fn(PortfolioRepository.get(actor), actor);
        if (!out?.changed) continue;
        await PortfolioRepository.save(actor, out.portfolio);
        changedCount++;
      }
      return changedCount;
    });
  }

  /**
   * Change one portfolio, in step with order processing. Used for penalties.
   * @param {Actor} actor
   * @param {(portfolio: object) => ({portfolio: object, changed?: boolean} & object) | null} fn
   * @returns {Promise<object|null>} whatever `fn` returned
   */
  transformActor(actor, fn) {
    if (!isActiveGM()) return Promise.resolve(null);
    return this._queue.run(async () => {
      const out = fn(PortfolioRepository.get(actor));
      if (out?.portfolio && out.changed !== false) await PortfolioRepository.save(actor, out.portfolio);
      return out ?? null;
    });
  }

  /**
   * A connect request and a cover-up action each carry the roll the player made. Read it back from
   * its chat card here, once each, and only when a roll would matter (the same cheap checks the
   * executor makes, so a refused request does not burn a card).
   */
  async _checks(actor, pending, portfolio, tick) {
    const checks = {};
    if (TradingSettings.mode() === 'terminal') {
      const request = pending.find((r) => r.type === 'connectTerminal');
      if (request && !lockedOut(portfolio, tick) && !sessionActive(portfolio, tick)) checks[request.key] = await TerminalAccess.buildCheck(actor, request);
    }

    // Each action is judged against the portfolio as the earlier ones in the batch leave it.
    let money = portfolio.cash;
    const cooldowns = { ...(portfolio.heatCooldowns ?? {}) };
    for (const request of pending.filter((r) => r.type === 'heatAction')) {
      const can = canAttempt({ portfolio: { ...portfolio, cash: money, heatCooldowns: cooldowns }, actionId: request.action, tick, enabled: this.heatEnabled() });
      if (!can.ok) continue;
      const def = HEAT_ACTIONS[request.action];
      const verified = await SkillAdapter.verify(actor, request, { dv: def.dv, skill: def.skill, stat: def.stat });
      checks[request.key] = verified.ok
        ? { stat: verified.stat, level: verified.level, dv: verified.dv, roll: verified.roll }
        : { failed: verified.reason };
      if (!verified.ok) continue;
      money -= def.cost;
      cooldowns[request.action] = tick + def.cooldown;
    }
    return checks;
  }

  async _process(actor) {
    const pending = PortfolioRepository.pending(actor);
    if (!pending.length) return;

    const portfolio = PortfolioRepository.get(actor);
    const wealth = WealthAdapter.get(actor);
    const tick = this.tick();
    const checks = await this._checks(actor, pending, portfolio, tick);
    const result = applyRequests({
      portfolio, requests: pending, wealth, tick, market: this.tradingMarket(), settings: this.settings(checks, actor),
    });
    if (!result.changed) return;

    // Wealth first: a failed write loses nothing for the player's balance, and the outbox retries.
    if (result.wealth !== wealth) {
      await WealthAdapter.set(actor, result.wealth, 'Night City Investments: brokerage transfer');
    }
    await PortfolioRepository.save(actor, result.portfolio);
    const keys = new Set(pending.map((r) => r.key));
    this._emit(actor, result.events, result.portfolio.results.filter((r) => keys.has(r.key)));
  }

  async _runOrders(actor, path = null) {
    const portfolio = PortfolioRepository.get(actor);
    if (!portfolio.orders.some((o) => o.status === OPEN)) return;

    const result = runOrders({
      portfolio,
      tick: this.tick(),
      market: this.tradingMarket(),
      path,
      feeProfile: TradingSettings.forExecutor().direct,
      seed: TradingSettings.seed(),
      settleDays: TradingSettings.settlementDays(),
    });
    // A sale waiting on the liquidity cap moves to the next day without changing its status (B5c).
    const changed = result.portfolio.orders.length !== portfolio.orders.length
      || result.portfolio.orders.some((o, i) => o.status !== portfolio.orders[i]?.status || o.eligibleTick !== portfolio.orders[i]?.eligibleTick);
    if (!changed) return;

    await PortfolioRepository.save(actor, result.portfolio);
    this._emit(actor, result.events, []);
  }

  /**
   * Pay each due withdrawal as a mail with the money attached. The withdrawal is marked paid BEFORE
   * the mail goes, so a crash in between can never pay twice; if the mail then fails, it is undone
   * and the money goes back to the balance.
   */
  async _payWithdrawals(actor) {
    const tick = this.tick();
    for (const w of dueWithdrawals(PortfolioRepository.get(actor), tick)) {
      const marked = markWithdrawalPaid(PortfolioRepository.get(actor), w.id, tick);
      if (!marked.changed) continue;
      await PortfolioRepository.save(actor, marked.portfolio);

      const spec = MailService.withdrawalPaid(w);
      const sent = await MailService.fromBroker(w.brokerId, actor, spec);
      if (sent.ok) {
        this._emit(actor, [{ type: 'withdrawalPaid', withdrawalId: w.id, amount: w.amount, fee: w.fee, brokerId: w.brokerId }], []);
        continue;
      }

      log.warn(`Withdrawal ${w.id} could not be mailed (${sent.error}); refunding`);
      const undone = failPaidWithdrawal(PortfolioRepository.get(actor), w.id, tick);
      if (undone.ok) await PortfolioRepository.save(actor, undone.portfolio);
      this._emit(actor, [{ type: 'withdrawalFailed', withdrawalId: w.id, amount: w.amount, fee: w.fee, brokerId: w.brokerId }], []);
    }
  }

  _emit(actor, events, results) {
    for (const event of events) {
      if (event.type === 'orderFilled') Hooks.callAll(HOOKS.ORDER_FILLED, { actorId: actor.id, ...event });
    }
    if (events.length || results.length) Hooks.callAll(HOOKS.PORTFOLIO_EVENTS, { actorId: actor.id, events, results });
  }
}

export const PortfolioService = new PortfolioServiceImpl();
