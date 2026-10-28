/**
 * Statement service: builds brokerage statements and mails them. GM client only.
 * @file scripts/services/StatementService.js
 * @description Two ways a statement is sent:
 *   - on request (the Portfolio tab button, or "STATEMENT" mailed to a broker): always sent, by mail,
 *     from the player's broker or the market wire. It does not move the monthly baseline.
 *   - monthly, on the first tick of each in-world month, to players who opted in to the "statements"
 *     category. The baseline moves forward whether or not it is sent, so a player who opts in later
 *     still gets one month, not everything since the start.
 *   The first time a portfolio is seen it only records a baseline.
 */

import { buildStatement, baselineStatement, closeStatement, statementDue, monthKey } from '../engine/index.js';
import { isActiveGM } from '../utils/helpers.js';
import { MarketStore } from '../data/MarketStore.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { MarketClock } from './MarketClockService.js';
import { PortfolioService } from './PortfolioService.js';
import { NotificationService } from './NotificationService.js';
import { MailService } from './MailService.js';

export const StatementService = {
  /** assetId -> price now, for companies and funds. */
  prices() {
    const pub = MarketStore.getPublic();
    return {
      ...Object.fromEntries(Object.entries(pub.companies ?? {}).map(([id, s]) => [id, s.price])),
      ...Object.fromEntries(Object.entries(pub.funds ?? {}).map(([id, s]) => [id, s.nav])),
    };
  },

  build(actor) {
    return buildStatement({
      portfolio: PortfolioRepository.get(actor),
      prices: this.prices(),
      tick: MarketStore.time(),
    });
  },

  /**
   * Mail a statement now. From the player's broker if they have one, otherwise from the market wire.
   * @returns {Promise<{ok: boolean, error?: string}>}
   */
  async sendRequested(actor) {
    if (!isActiveGM()) return { ok: false, error: 'not-active-gm' };
    const spec = MailService.statement(this.build(actor));
    const brokerId = PortfolioRepository.get(actor).brokerContactId;
    return brokerId ? MailService.fromBroker(brokerId, actor, spec) : MailService.fromWire(actor, spec);
  },

  /** Hook for `PORTFOLIO_EVENTS`: a player pressed "Send me a statement". */
  async onPortfolioEvents({ actorId, results = [] }) {
    if (!isActiveGM()) return;
    const actor = game.actors.get(actorId);
    if (actor && results.some((r) => r.type === 'requestStatement' && r.ok)) await this.sendRequested(actor);
  },

  /** After a tick: send the monthly statements that have come due. */
  onTick() {
    if (!isActiveGM()) return Promise.resolve(0);
    return this._monthly();
  },

  async _monthly() {
    const key = monthKey(MarketClock.date());
    const tick = MarketStore.time();
    const prices = this.prices();
    const sends = [];

    await PortfolioService.transformAll((portfolio, actor) => {
      const due = statementDue(portfolio, key);
      if (!due) return null;
      if (due === 'baseline') return { portfolio: baselineStatement(portfolio, prices, tick, key), changed: true };
      const statement = buildStatement({ portfolio, prices, tick });
      sends.push({ actor, statement, brokerId: portfolio.brokerContactId });
      return { portfolio: closeStatement(portfolio, statement, key), changed: true };
    });

    for (const { actor, statement, brokerId } of sends) {
      await NotificationService.notify(actor, 'statements', MailService.statement(statement), brokerId);
    }
    return sends.length;
  },
};
