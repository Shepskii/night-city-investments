/**
 * Syndicate system: wires the syndicate executor, client and watcher into Foundry's hooks (DESIGN §31).
 * @file scripts/init/registerSyndicateSystem.js
 * @description Lapsed proposals and due redemptions are settled after each market tick, as a step
 *              of registerTickSequence.js. The syndicate's orders are worked with everyone else's,
 *              because a syndicate is one of PortfolioRepository.accounts().
 */

import { MODULE_ID, FLAGS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { SyndicateRepository } from '../data/SyndicateRepository.js';
import { SyndicateService } from '../services/SyndicateService.js';
import { SyndicateClient } from '../services/SyndicateClient.js';
import { SyndicateWatcher } from '../services/SyndicateWatcher.js';

export function registerSyndicateSystem(initializer) {
  initializer.register('init', 42, 'Syndicate hooks', () => {
    Hooks.on('updateActor', (actor, changes) => {
      SyndicateWatcher.onActorUpdate(actor, changes);
      if (isActiveGM() && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.SYNDICATE_OUTBOX}`)) {
        SyndicateService.processActor(actor);
      }
    });
    for (const hook of ['createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry']) {
      Hooks.on(hook, (journal, changes) => SyndicateWatcher.onJournal(journal, hook === 'updateJournalEntry' ? changes : null));
    }
  });

  initializer.register('ready', 49, 'Syndicate startup', async () => {
    SyndicateWatcher.snapshot();
    if (isActiveGM()) await SyndicateService.sweepAll();
  });

  initializer.register('ready', 50, 'Syndicate API', () => {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) return;
    api.syndicates = {
      list: () => SyndicateRepository.all(),
      get: (id) => SyndicateRepository.get(id),
      portfolio: (id) => SyndicateRepository.portfolio(id),
      forActor: (actor) => SyndicateRepository.forActor(actor?.id ?? actor),
      submit: (actor, type, payload) => SyndicateClient.submit(actor, type, payload),
      trade: (actor, syndicateId, type, payload) => SyndicateClient.trade(actor, syndicateId, type, payload),
      approve: (id) => SyndicateService.approve(id),
      reject: (id) => SyndicateService.reject(id),
      decide: (id, proposalId, how) => SyndicateService.decide(id, proposalId, how),
      close: (id) => SyndicateService.close(id),
    };
  });
}
