/**
 * Broker system: connects NCM mail and market events to the broker and notification services.
 * @file scripts/init/registerBrokerSystem.js
 */

import { MODULE_ID, HOOKS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { BrokerRepository } from '../data/BrokerRepository.js';
import { FundRepository } from '../data/FundRepository.js';
import { BrokerService } from '../services/BrokerService.js';
import { NotificationService } from '../services/NotificationService.js';
import { FundService } from '../services/FundService.js';
import { StatementService } from '../services/StatementService.js';
import { TerminalAccess } from '../services/TerminalAccess.js';
import { PortfolioClient } from '../services/PortfolioClient.js';

export function registerBrokerSystem(initializer) {
  initializer.register('init', 50, 'Broker hooks', () => {
    // NCM fires this on the GM client that delivered the mail. Only the active GM acts on it.
    Hooks.on('night-city-messenger.message:sent', (data) => {
      if (isActiveGM()) BrokerService.onMessageSent(data);
    });

    Hooks.on(HOOKS.PORTFOLIO_EVENTS, (data) => {
      if (!isActiveGM()) return;
      NotificationService.onPortfolioEvents(data);
      StatementService.onPortfolioEvents(data);
    });
    Hooks.on(HOOKS.DIVIDEND_PAID, (data) => {
      if (isActiveGM()) NotificationService.onDividend(data);
    });
    Hooks.on(HOOKS.NEWS_POSTED, (item) => {
      if (isActiveGM()) NotificationService.onHeadline(item);
    });
    Hooks.on(HOOKS.PRICE_TICK, (data) => {
      if (!isActiveGM()) return;
      NotificationService.onTick(data);
      StatementService.onTick();
    });
  });

  initializer.register('ready', 55, 'Broker API', () => {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) return;
    api.brokers = {
      list: () => BrokerRepository.list(),
      get: (id) => BrokerRepository.get(id),
    };
    api.funds = {
      list: () => FundRepository.all(),
      get: (id) => FundRepository.get(id),
    };
    api.terminal = {
      claim: () => TerminalAccess.claim(),
      connect: (actor) => PortfolioClient.connectTerminal(actor),
    };
    if (api.gm) api.gm.funds = FundService;
  });
}
