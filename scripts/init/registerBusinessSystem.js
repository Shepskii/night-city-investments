/**
 * Business system: wires the business executor, client and watcher into Foundry's hooks.
 * @file scripts/init/registerBusinessSystem.js
 * @description The weekly close runs after each market tick, as a step of registerTickSequence.js.
 */

import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { BusinessService } from '../services/BusinessService.js';
import { BusinessClient } from '../services/BusinessClient.js';
import { BusinessWatcher } from '../services/BusinessWatcher.js';

export function registerBusinessSystem(initializer) {
  initializer.register('init', 41, 'Business hooks', () => {
    Hooks.on('updateActor', (actor, changes) => {
      BusinessWatcher.onActorUpdate(actor, changes);
      if (isActiveGM() && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.BUSINESS_OUTBOX}`)) {
        BusinessService.processActor(actor);
      }
    });
    for (const hook of ['createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry']) {
      Hooks.on(hook, (journal, changes) => BusinessWatcher.onJournal(journal, hook === 'updateJournalEntry' ? changes : null));
    }
  });

  initializer.register('ready', 47, 'Business startup', async () => {
    BusinessWatcher.snapshot();
    if (isActiveGM()) await BusinessService.sweepAll();
  });

  initializer.register('ready', 48, 'Business API', () => {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) return;
    api.businesses = {
      list: () => BusinessRepository.all(),
      get: (id) => BusinessRepository.get(id),
      forActor: (actor) => BusinessRepository.forActor(actor?.id ?? actor),
      submit: (actor, type, payload) => BusinessClient.submit(actor, type, payload),
      roll: (actor, business, request, options) => BusinessClient.roll(actor, business, request, options),
    };
  });
}
