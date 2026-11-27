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
import { EmployerService } from '../services/EmployerService.js';
import { BusinessWatcher } from '../services/BusinessWatcher.js';
import { DistrictService } from '../services/DistrictService.js';
import { NetArchitectAdapter, NET_ARCHITECT_ID, FORK_HOOKS } from '../integrations/NetArchitectAdapter.js';

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
      await EmployerService.syncAll();
    }
  });

  // Real NET runs on the NET module (X2a): its own GM client fills a taken shard, and follows and settles a run.
  initializer.register('ready', 49, 'NET Architect', () => {
    if (!NetArchitectAdapter.present()) return;
    // Which targets have a map goes out with the job board; publish it again now this is set up.
    if (isActiveGM()) JobService.publish().catch((error) => console.error('night-city-investments | publishing the job board failed', error));
    const here = () => game.user?.isGM && NetArchitectAdapter.isAuthority();
    Hooks.on('createItem', (item) => {
      if (!here() || !item?.parent || !item.flags?.[MODULE_ID]?.[FLAGS.EVIDENCE]?.live) return;
      BusinessService._queue.run(() => BusinessService.fillLiveShard(item)).catch((error) => console.error('night-city-investments | filling a data shard failed', error));
    });
    // On NET Architect (NCI Edition), its run hooks say when each runner starts and leaves, wherever the run began.
    // Every client hears them; the handlers act only on the authority GM's.
    if (NetArchitectAdapter.onFork()) {
      const follow = (hook, handler) => Hooks.on(hook, (payload) => BusinessService._queue.run(() => BusinessService[handler](payload)).catch((error) => console.error('night-city-investments | following a NET run failed', error)));
      follow(FORK_HOOKS.runStarted, 'onLiveRunStarted');
      follow(FORK_HOOKS.runnerLeft, 'onLiveRunnerLeft');
      follow(FORK_HOOKS.runEnded, 'onLiveRunEnded');
      return;
    }
    // NET Architect keeps its session as a flag on a journal entry in its own compendium; every save says how a run
    // stands, and its end saves null. A player's jack-out has no hook of its own.
    const watch = (session) => BusinessService._queue.run(() => BusinessService.watchLiveRuns(session)).catch((error) => console.error('night-city-investments | following a NET run failed', error));
    Hooks.on('updateJournalEntry', (doc, changes) => {
      if (!here() || doc.pack !== `world.${NET_ARCHITECT_ID}` || !foundry.utils.hasProperty(changes, `flags.${NET_ARCHITECT_ID}.session`)) return;
      watch(doc.getFlag(NET_ARCHITECT_ID, 'session') ?? null);
    });
    Hooks.on('cprNetArchitectJackOut', () => {
      if (here()) watch(null);
    });
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
