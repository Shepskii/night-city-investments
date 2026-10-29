/**
 * Portfolio system: wires the executor, client and watcher into Foundry's hooks.
 * @file scripts/init/registerPortfolioSystem.js
 */

import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { PortfolioRepository } from '../data/PortfolioRepository.js';
import { PortfolioService } from '../services/PortfolioService.js';
import { PortfolioClient } from '../services/PortfolioClient.js';
import { PortfolioWatcher } from '../services/PortfolioWatcher.js';
import { NetworkWatcher } from '../services/NetworkWatcher.js';

export function registerPortfolioSystem(initializer) {
  initializer.register('init', 40, 'Portfolio hooks', () => {
    // Every client: tell windows and players. The active GM also acts on new requests.
    Hooks.on('updateActor', (actor, changes) => {
      PortfolioWatcher.onActorUpdate(actor, changes);
      if (isActiveGM() && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.OUTBOX}`)) {
        PortfolioService.processActor(actor);
      }
    });
    // Working open orders after each tick is part of registerTickSequence.js.
  });

  initializer.register('ready', 45, 'Portfolio startup', async () => {
    PortfolioWatcher.snapshot();
    if (isActiveGM()) await PortfolioService.sweepAll();
  });

  // A player who leaves CorpNet in Night City Messenger loses their direct-trading session.
  initializer.register('ready', 51, 'CorpNet watch', () => NetworkWatcher.start());

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
