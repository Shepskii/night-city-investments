import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Alice', 50000, false]] });
const [alice] = env.actors;

// A fake Night City Messenger whose network this client can join and leave.
const net = { on: true };
const listeners = new Map();
globalThis.game.nightcity = {
  masterContactService: { filterByTag: () => [], getAll: () => [] },
  networkService: {
    isOnNetwork: (id) => id === 'CORPNET' && net.on,
    getNetwork: () => ({ requiresAuth: false }),
    isAuthenticated: () => true,
  },
  eventBus: {
    on: (event, fn) => listeners.set(event, [...(listeners.get(event) ?? []), fn]),
    emit: (event, data) => (listeners.get(event) ?? []).forEach((fn) => fn(data)),
  },
};
for (const [k, v] of Object.entries({ directTradingMode: 'terminal', corpnetNetwork: 'CORPNET', sessionTicks: 3, lockoutTicks: 1 })) env.store.set(k, v);

let S;
before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    NetworkWatcher: (await load('../scripts/services/NetworkWatcher.js')).NetworkWatcher,
    engine: await load('../scripts/engine/index.js'),
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  await init.runPhase('init');
  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
});

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 2));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue]) await q;
  }
};
const session = () => S.PortfolioRepository.get(alice).session;
const open = (source) => S.PortfolioRepository.save(alice, {
  ...S.engine.emptyPortfolio(), cash: 1000, session: { source, grantedTick: S.MarketStore.time(), validThroughTick: S.MarketStore.time() + 3 },
});

test('switching networks while still on CorpNet keeps the session', async () => {
  await open('network');
  S.NetworkWatcher.start();
  game.nightcity.eventBus.emit('network:changed', { currentNetworkId: 'CORPNET' });
  await settle();
  assert.ok(session(), 'still connected');
});

test('leaving CorpNet ends the direct-trading session, and the player is told', async () => {
  net.on = false;
  game.nightcity.eventBus.emit('network:changed', { currentNetworkId: 'CITINET' });
  await settle();
  assert.equal(session(), null);
  const result = S.PortfolioRepository.get(alice).results.at(-1);
  assert.deepEqual([result.type, result.ended], ['disconnectTerminal', true]);
});

test('a session the GM granted is not ended by leaving CorpNet', async () => {
  await open('grant');
  game.nightcity.eventBus.emit('network:disconnected', { reason: 'dead_zone' });
  await settle();
  assert.equal(session()?.source, 'grant');
});
