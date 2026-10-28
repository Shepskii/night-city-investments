/**
 * Night City Investments: entry point
 * @file scripts/main.js
 */

import { log } from './utils/helpers.js';
import { ModuleInitializer } from './core/ModuleInitializer.js';
import { registerCoreServices } from './init/registerCoreServices.js';
import { registerUIComponents } from './init/registerUIComponents.js';
import { registerMarketSystem } from './init/registerMarketSystem.js';
import { registerPortfolioSystem } from './init/registerPortfolioSystem.js';
import { registerBusinessSystem } from './init/registerBusinessSystem.js';
import { registerBrokerSystem } from './init/registerBrokerSystem.js';
import { registerToolsSystem } from './init/registerToolsSystem.js';
import { registerTickSequence } from './init/registerTickSequence.js';

const initializer = new ModuleInitializer();

registerCoreServices(initializer);
registerUIComponents(initializer);
registerMarketSystem(initializer);
registerPortfolioSystem(initializer);
registerBusinessSystem(initializer);
registerBrokerSystem(initializer);
registerToolsSystem(initializer);
registerTickSequence(initializer);

Hooks.once('init', async () => {
  log.info('Initializing Night City Investments');
  await initializer.runPhase('preInit');
  await initializer.runPhase('init');
});

Hooks.once('ready', async () => {
  await initializer.runPhase('ready');
  // Let Foundry settle before late tasks.
  setTimeout(() => initializer.runPhase('postReady'), 100);
});
