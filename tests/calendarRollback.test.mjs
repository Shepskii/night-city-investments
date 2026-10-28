import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const DAY = 86_400_000;
const env = installFakeFoundry({ actors: [['Alice', 90000, true]] });
const [alice] = env.actors;
game.users.filter = () => [];
game.nightcity = { messageService: { sendMessage: async () => ({ success: true }) } };
env.store.set('directOrderExecution', 'instant');

let S;

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    DividendService: (await load('../scripts/services/DividendService.js')).DividendService,
    CorporateActionService: (await load('../scripts/services/CorporateActionService.js')).CorporateActionService,
    NewsService: (await load('../scripts/services/NewsService.js')).NewsService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
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
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue]) await q;
  }
};
const pub = () => S.MarketStore.getPublic();
const day = () => S.engine.dayIndex(env.clock.ms);
const move = async (days) => { env.clock.ms += days * DAY; await S.TickService.checkClock(); await settle(); };
const closes = (id = 'ARA') => S.MarketStore.getHistory().series[id].closes;
const info = () => env.notices.filter(([k]) => k === 'info').map(([, m]) => m);

test('the market follows the calendar forward, one tick a day', async () => {
  await move(0);
  assert.deepEqual([pub().tickIndex, pub().lastDay], [0, day()]);
  await move(6);
  assert.deepEqual([pub().tickIndex, pub().lastDay], [6, day()]);
});

test('rolling the date back rolls the market back by as many ticks, and the prices with it', async () => {
  const history = [...closes()];
  env.notices.length = 0;
  await move(-2);
  assert.deepEqual([pub().tickIndex, pub().lastDay], [4, day()]);
  assert.deepEqual(closes(), history.slice(0, 5), 'the last two closes are gone');
  assert.equal(info().length, 1);
  assert.match(info()[0], /RolledBack$|NCI\.Clock\.RolledBack/);

  await S.TickService.checkClock();
  await settle();
  assert.equal(pub().tickIndex, 4, 'polling again changes nothing');
  assert.equal(info().length, 1, 'and does not repeat the notice');

  await move(1);
  assert.deepEqual([pub().tickIndex, pub().lastDay], [5, day()], 'moving forward re-runs the days');
  await move(1);
  assert.equal(pub().tickIndex, 6);
  assert.deepEqual(closes(), history, 'the same seed gives back the same prices');
});

test('a rollback beyond the stored ticks leaves the market ahead, and it waits for the calendar to catch up', async () => {
  await move(4);
  assert.equal(pub().tickIndex, 10);
  const marketDay = pub().lastDay;
  env.notices.length = 0;

  await move(-8);
  const undone = 5;
  assert.equal(pub().tickIndex, 10 - undone, 'only as many ticks as were remembered are undone');
  assert.equal(pub().lastDay, marketDay - undone);
  assert.equal(pub().lastDay - day(), 3, 'the market is three days ahead of the calendar');
  assert.equal(info().length, 1);
  assert.ok(info()[0].includes('RolledBackAhead'));

  await S.TickService.checkClock();
  await settle();
  assert.equal(info().length, 1, 'the notice is not repeated while nothing changes');

  await move(2);
  assert.equal(pub().tickIndex, 5, 'two days later the market is still ahead, so nothing ticks');
  await move(1);
  assert.equal(pub().tickIndex, 5, 'aligned: the calendar has met the market, still no tick');
  assert.equal(day(), pub().lastDay);
  await move(1);
  assert.equal(pub().tickIndex, 6, 'one day past it, ticking resumes');
  assert.equal(pub().lastDay, day());
});

test('a tick that has moved a player\'s money is not rolled back', async () => {
  await move(3);
  const before = pub().tickIndex;
  const k = await S.PortfolioClient.submit(alice, 'deposit', { amount: 20000 });
  await settle();
  await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 5, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(S.PortfolioRepository.get(alice).orders.at(-1).status, 'filled');
  assert.ok(k);
  await move(1);
  assert.equal(pub().tickIndex, before + 1);
  const fillTick = S.PortfolioRepository.get(alice).ledger.find((e) => e.kind === 'buy').ts;
  assert.equal(fillTick, before, 'the fill happened on the tick before the last one');

  env.notices.length = 0;
  await move(-2);
  assert.equal(pub().tickIndex, before, 'the tick after the fill was undone, the tick of the fill was not');
  assert.equal(pub().lastDay - day(), 1, 'so the market is one day ahead');
  assert.ok(info()[0].includes('RolledBackAhead'));

  await move(1);
  assert.equal(pub().tickIndex, before, 'it waits');
  await move(1);
  assert.equal(pub().tickIndex, before + 1);
});

test('when nothing can be rolled back at all, the market just waits and says so once', async () => {
  S.TickService.setSettledCheck(() => true);
  await move(2);
  const tick = pub().tickIndex;
  env.notices.length = 0;
  await move(-2);
  assert.equal(pub().tickIndex, tick);
  assert.equal(info().length, 1);
  assert.ok(info()[0].includes('NCI.Clock.Ahead'));
  await S.TickService.checkClock();
  assert.equal(info().length, 1);
  await move(2);
  assert.equal(pub().tickIndex, tick, 'back level with the market');
  await move(1);
  assert.equal(pub().tickIndex, tick + 1);
  S.TickService.setSettledCheck(() => false);
});

test('a manual or real-time market ignores the calendar', async () => {
  env.store.set('tickMode', 'manual');
  const tick = pub().tickIndex;
  await move(-3);
  assert.equal(pub().tickIndex, tick);
  await move(3);
  assert.equal(pub().tickIndex, tick);
  env.store.set('tickMode', 'worldTime');
});

test('only the active GM rolls the market back', async () => {
  const tick = pub().tickIndex;
  game.users.activeGM = { id: 'someone-else' };
  await move(-1);
  assert.equal(pub().tickIndex, tick);
  game.users.activeGM = { id: 'gm1' };
  await move(1);
});
