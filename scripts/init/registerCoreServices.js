/**
 * Core services: settings, public API, world seed.
 * @file scripts/init/registerCoreServices.js
 */

import { MODULE_ID, SETTINGS, API_VERSION } from '../utils/constants.js';
import { log, isActiveGM } from '../utils/helpers.js';
import { registerSettings } from '../core/SettingsManager.js';
import * as engine from '../engine/index.js';

export function registerCoreServices(initializer) {
  initializer.register('init', 10, 'Settings', registerSettings);

  initializer.register('ready', 10, 'World seed', async () => {
    if (!isActiveGM()) return;
    if (game.settings.get(MODULE_ID, SETTINGS.WORLD_SEED)) return;
    await game.settings.set(MODULE_ID, SETTINGS.WORLD_SEED, foundry.utils.randomID(16));
    log.info('World seed generated');
  });

  // Published at the standard Foundry discovery point. UI launchers are attached by registerUIComponents.
  initializer.register('ready', 20, 'Public API', () => {
    const mod = game.modules.get(MODULE_ID);
    if (!mod) return;
    mod.api = { apiVersion: API_VERSION, engine };
    Hooks.callAll(`${MODULE_ID}.apiReady`, mod.api);
  });
}
