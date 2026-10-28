/**
 * Portfolio system: wires the executor, client and watcher into Foundry's hooks.
 * @file scripts/init/registerPortfolioSystem.js
 */

import { MODULE_ID, FLAGS, HOOKS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { PortfolioService } from '../services/PortfolioService.js';
import { PortfolioClient } from '../services/PortfolioClient.js';
import { PortfolioWatcher } from '../services/PortfolioWatcher.js';
import { HeatService } from '../services/HeatService.js';

export function registerPortfolioSystem(initializer) {
  initializer.register('init', 40, 'Portfolio hooks', () => {
    // Every client: tell windows and players. The active GM also acts on new requests.
    Hooks.on('updateActor', (actor, changes) => {
      PortfolioWatcher.onActorUpdate(actor, changes);
      if (isActiveGM() && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.OUTBOX}`)) {
        PortfolioService.processActor(actor);
      }
    });

    // After each market tick the active GM works open orders, then the heat audit looks at what filled
    // (so it never waits a tick for an order that is about to fill).
    Hooks.on(HOOKS.PRICE_TICK, () => {
      if (isActiveGM()) PortfolioService.onTick().then(() => HeatService.onTick());
    });
  });

  initializer.register('ready', 45, 'Portfolio startup', async () => {
    PortfolioWatcher.snapshot();
    if (isActiveGM()) await PortfolioService.sweepAll();
  });

  initializer.register('ready', 46, 'Portfolio API', () => {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) return;
    api.portfolio = {
      get: (actor) => PortfolioRepository.get(actor),
      pending: (actor) => PortfolioRepository.pending(actor),
      deposit: (actor, amount) => PortfolioClient.submit(actor, 'deposit', { amount }),
      withdraw: (actor, amount) => PortfolioClient.submit(actor, 'withdraw', { amount }),
      placeOrder: (actor, order) => PortfolioClient.submit(actor, 'placeOrder', order),
      cancelOrder: (actor, orderId) => PortfolioClient.submit(actor, 'cancelOrder', { orderId }),
    };
  });
}
