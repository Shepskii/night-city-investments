/**
 * Business system: wires the business executor, client and watcher into Foundry's hooks.
 * @file scripts/init/registerBusinessSystem.js
 * @description The weekly close runs after each market tick, as a step of registerTickSequence.js.
 */

import { MODULE_ID, FLAGS, HOOKS, SETTINGS } from '../utils/constants.js';
import { isActiveGM } from '../utils/helpers.js';
import { BusinessRepository } from '../data/BusinessRepository.js';
import { BusinessService } from '../services/BusinessService.js';
import { BusinessClient } from '../services/BusinessClient.js';
import { JobService } from '../services/JobService.js';
import { BusinessWatcher } from '../services/BusinessWatcher.js';
import { DistrictService } from '../services/DistrictService.js';

export function registerBusinessSystem(initializer) {
  initializer.register('init', 41, 'Business hooks', () => {
    Hooks.on('updateActor', (actor, changes) => {
      BusinessWatcher.onActorUpdate(actor, changes);
      if (isActiveGM() && foundry.utils.hasProperty(changes, `flags.${MODULE_ID}.${FLAGS.BUSINESS_OUTBOX}`)) {
        BusinessService.processActor(actor);
      }
    });
    // Switching the underworld off stops any illegal production (P1c).
    for (const hook of ['createSetting', 'updateSetting']) {
      Hooks.on(hook, (setting) => {
        if (setting.key === `${MODULE_ID}.${SETTINGS.UNDERWORLD}` && isActiveGM()) BusinessService.dropIllegalLines();
        // The GM's districts on Night City Map (DESIGN §36.15).
        if (setting.key === 'night-city-map.state') DistrictService.sync();
      });
    }
    // A storeroom's items only change by the service's hand or the GM's (P1b).
    for (const hook of ['deleteItem', 'updateItem']) {
      Hooks.on(hook, (item) => {
        const businessId = item.parent?.getFlag?.(MODULE_ID, 'stockFor');
        if (businessId && isActiveGM()) BusinessService.reconcileStock(businessId);
      });
    }
    for (const hook of ['createJournalEntry', 'updateJournalEntry', 'deleteJournalEntry']) {
      Hooks.on(hook, (journal, changes) => BusinessWatcher.onJournal(journal, hook === 'updateJournalEntry' ? changes : null));
    }
    // A player company's IPO listed on the market: finish its listing (B5b).
    Hooks.on(HOOKS.CORPORATE_ACTION, (action) => {
      if (isActiveGM() && action?.type === 'ipo') BusinessService.onIpo(action.companyId);
    });
  });

  // Before anything reads a faction's turf or closes a week.
  initializer.register('ready', 12, 'Districts', async () => {
    await DistrictService.load();
    await DistrictService.sync();
  });

  initializer.register('ready', 47, 'Business startup', async () => {
    BusinessWatcher.snapshot();
    if (isActiveGM()) await BusinessService.sweepAll();
    // So the job board isn't empty until the next tick (N2), and jobs at NPC companies show their shift from the start (N3).
    if (isActiveGM()) {
      await JobService.publish();
      for (const business of BusinessRepository.all().filter((b) => b.npcRun && b.status === 'open')) await BusinessService._syncJobs(business);
    }
  });

  initializer.register('ready', 48, 'Business API', () => {
    const api = game.modules.get(MODULE_ID)?.api;
    if (!api) return;
    // For a map: what anyone in the street could see of each business, and nothing behind it (B7e).
    if (api.gm) api.gm.businessDirectory = () => BusinessService.directory();
    api.businesses = {
      list: () => BusinessRepository.all(),
      get: (id) => BusinessRepository.get(id),
      forActor: (actor) => BusinessRepository.forActor(actor?.id ?? actor),
      submit: (actor, type, payload) => BusinessClient.submit(actor, type, payload),
      roll: (actor, business, request, options) => BusinessClient.roll(actor, business, request, options),
    };
  });
}
