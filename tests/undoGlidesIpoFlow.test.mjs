import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const DAY = 86_400_000;
const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Bob', 50000, true]] });
const [alice, bob] = env.actors;
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
    MarketControlService: (await load('../scripts/services/MarketControlService.js')).MarketControlService,
    UndoService: (await load('../scripts/services/UndoService.js')).UndoService,
    PreviewService: (await load('../scripts/services/PreviewService.js')).PreviewService,
    IpoService: (await load('../scripts/services/IpoService.js')).IpoService,
    MarketClock: (await load('../scripts/services/MarketClockService.js')).MarketClock,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    CompanyRepository: (await load('../scripts/data/CompanyRepository.js')).CompanyRepository,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    getSeries: (await load('../scripts/engine/index.js')).getSeries,
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  await init.runPhase('init');

  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue, S.IpoService._queue]) await q;
  }
};

const price = (id = 'ARA') => S.MarketStore.getPublic().companies[id].price;
const tickNow = () => S.MarketStore.getPublic().tickIndex;
const portfolio = (actor) => S.PortfolioRepository.get(actor);
const resultOf = (actor, key) => portfolio(actor).results.find((r) => r.key === key);

// ── Undo ─────────────────────────────────────────────────────────────────────

test('undo steps the market back one tick, and advancing again repeats the tick exactly', async () => {
  await S.TickService.advance(3);
  await settle();
  const p3 = price();
  const hidden3 = S.MarketStore.getHidden();
  const len3 = S.getSeries(S.MarketStore.getHistory(), 'ARA').length;
  assert.equal(tickNow(), 3);

  await S.TickService.advance(1);
  await settle();
  const p4 = price();
  assert.equal(tickNow(), 4);
  assert.equal(S.UndoService.available(), true);

  const out = await S.UndoService.undo();
  assert.deepEqual([out.ok, out.tickIndex], [true, 3]);
  assert.equal(tickNow(), 3);
  assert.equal(price(), p3, 'prices are back');
  assert.deepEqual(S.MarketStore.getHidden(), hidden3, 'the hidden state is back too');
  assert.equal(S.getSeries(S.MarketStore.getHistory(), 'ARA').length, len3, 'and so is the history');
  assert.ok(S.MarketStore.getControls().log.some((e) => e.kind === 'undo'), 'the GM log records it');
  assert.equal(S.UndoService.available(), true, 'the tick before is still in the buffer');

  await S.TickService.advance(1);
  await settle();
  assert.equal(price(), p4, 'the same random numbers give the same tick');
});

test('undo is refused once a player\'s money has moved because of the tick', async () => {
  await S.PortfolioClient.submit(alice, 'deposit', { amount: 20000 });
  await settle();
  const t = tickNow();
  const key = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 2, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(resultOf(alice, key).ok, true);
  assert.ok(portfolio(alice).lots.some((l) => l.assetId === 'ARA'), 'filled at once');

  const before = price();
  const out = await S.UndoService.undo();
  assert.deepEqual([out.ok, out.reason], [false, 'settled']);
  assert.equal(tickNow(), t);
  assert.equal(price(), before, 'nothing changed');

  await S.TickService.advance(1);
  await settle();
  assert.equal((await S.UndoService.undo()).ok, true, 'a later tick that moved no money can be undone');
  assert.equal(tickNow(), t);
});

test('a price change, split or new company makes the buffer unusable', async () => {
  await S.TickService.advance(1);
  await settle();
  assert.equal(S.UndoService.available(), true);
  await S.CorporateActionService.setPrice('ARA', 150);
  await settle();
  assert.equal(S.UndoService.available(), false);
  assert.equal((await S.UndoService.undo()).reason, 'nothing-to-undo');
});

// ── Glides ───────────────────────────────────────────────────────────────────

test('a scripted glide steers a company to its target and then stops', async () => {
  const start = price('CON');
  const target = Math.round(start * 1.15 * 100) / 100;
  assert.equal(await S.MarketControlService.addGlide({ companyId: 'CON', target: start * 20, days: 3 }), false, 'too steep');
  assert.equal(await S.MarketControlService.addGlide({ companyId: 'NOPE', target, days: 5 }), false);
  assert.equal(await S.MarketControlService.addGlide({ companyId: 'CON', target, days: 5, noise: 'low' }), true);
  await settle();
  assert.equal(S.MarketStore.getControls().glides.length, 1);
  assert.ok(S.MarketStore.getControls().log.some((e) => e.kind === 'glide'));

  await S.TickService.advance(5);
  await settle();
  assert.equal(price('CON'), target, 'lands exactly');
  assert.equal(S.MarketStore.getControls().glides.length, 0, 'and is finished');

  assert.equal(await S.MarketControlService.addGlide({ companyId: 'CON', target: target * 1.1, days: 5 }), true);
  await settle();
  const id = S.MarketStore.getControls().glides[0].id;
  await S.MarketControlService.removeGlide(id);
  await settle();
  assert.equal(S.MarketStore.getControls().glides.length, 0, 'a glide can be cancelled');
});

// ── Preview ──────────────────────────────────────────────────────────────────

test('the preview service runs against the live market without changing it', async () => {
  const before = JSON.stringify([S.MarketStore.getPublic(), S.MarketStore.getControls()]);
  const out = S.PreviewService.run({ kind: 'bias', target: 'company:ARA', value: 2, days: 10, decay: 'flat' }, 20);
  assert.equal(out.ok, true);
  assert.ok(out.summary.scenarioMedianChange > out.summary.baselineMedianChange);
  assert.equal(JSON.stringify([S.MarketStore.getPublic(), S.MarketStore.getControls()]), before, 'nothing was applied');
  assert.equal(S.PreviewService.run({ kind: 'bias', target: 'sector:none', value: 1, days: 5 }).reason, 'no-targets');
});

// ── IPO ──────────────────────────────────────────────────────────────────────

test('an IPO: subscriptions open in the window, then the listing fills them pro rata', async () => {
  const date = S.MarketClock.dateString(env.clock.ms + 4 * DAY);
  const saved = await S.CompanyRepository.save({
    name: 'Newco', ticker: 'NEWC', sector: 'tech', initialPrice: 40, listed: false,
    ipo: { date, price: 50, windowDays: 5, allocation: 100 },
  });
  assert.equal(saved.ok, true);
  await S.TickService.syncCompanies();
  await settle();

  assert.equal(S.CompanyRepository.all({ includeUnlisted: false }).some((c) => c.id === 'NEWC'), false, 'players cannot trade it yet');
  assert.equal(S.CompanyRepository.upcomingIpos()[0].ticker, 'NEWC', 'but they can see the announcement');
  const market = S.PortfolioService.market();
  assert.deepEqual(market.NEWC.ipo, { open: true, price: 50 });

  await S.PortfolioClient.submit(alice, 'deposit', { amount: 10000 });
  await S.PortfolioClient.submit(bob, 'deposit', { amount: 10000 });
  await settle();
  const cashA = portfolio(alice).cash;
  const cashB = portfolio(bob).cash;
  const ka = await S.PortfolioClient.submit(alice, 'subscribeIpo', { assetId: 'NEWC', qty: 80 });
  const kb = await S.PortfolioClient.submit(bob, 'subscribeIpo', { assetId: 'NEWC', qty: 60 });
  await settle();
  assert.equal(resultOf(alice, ka).ok, true);
  assert.equal(resultOf(bob, kb).ok, true);
  assert.equal(portfolio(alice).cash, cashA, 'cash is held, not spent');

  // The date arrives.
  env.clock.ms += 4 * DAY;
  await S.TickService.advance(1);
  await settle();

  const company = S.CompanyRepository.get('NEWC');
  assert.equal(company.listed, true);
  assert.equal(company.ipo.date, '', 'the schedule is cleared once listed');
  assert.equal(price('NEWC'), 50, 'it opens at the offer price');
  assert.deepEqual(S.getSeries(S.MarketStore.getHistory(), 'NEWC'), [50], 'with a fresh chart');
  assert.equal(S.CompanyRepository.all({ includeUnlisted: false }).some((c) => c.id === 'NEWC'), true, 'and is now public');

  const held = (actor) => portfolio(actor).lots.filter((l) => l.assetId === 'NEWC').reduce((s, l) => s + l.qty, 0);
  assert.equal(held(alice), 57);
  assert.equal(held(bob), 42);
  assert.equal(portfolio(alice).cash, cashA - 57 * 50);
  assert.equal(portfolio(alice).orders.find((o) => o.type === 'ipo').status, 'filled');
  assert.equal(S.PortfolioRepository.get(alice).orders.filter((o) => o.status === 'open' && o.type === 'ipo').length, 0);

  const news = S.MarketStore.getNews().items.map((n) => n.headline).join(' | ');
  assert.ok(news.includes('NCI.News.Ipo'), 'announced');
  assert.ok(news.includes('IpoOversubscribed') || news.includes('NCI.News.IpoOversubscribed'), 'oversubscription noted');
  assert.equal(S.UndoService.available(), false, 'a listing is not undoable');

  const buy = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'NEWC', qty: 1, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(resultOf(alice, buy).ok, true, 'it trades like any other company');
});

test('subscriptions outside the window are refused, and the GM can list a company early', async () => {
  const date = S.MarketClock.dateString(env.clock.ms + 40 * DAY);
  await S.CompanyRepository.save({ name: 'Laterco', ticker: 'LATE', sector: 'media', initialPrice: 25, listed: false, ipo: { date, price: null, windowDays: 3, allocation: 0 } });
  await S.TickService.syncCompanies();
  await settle();
  const key = await S.PortfolioClient.submit(alice, 'subscribeIpo', { assetId: 'LATE', qty: 5 });
  await settle();
  assert.equal(resultOf(alice, key).reason, 'ipo-closed');

  const out = await S.IpoService.listNow('LATE');
  assert.equal(out.ok, true);
  assert.equal(out.price, 25, 'the initial price is the offer when none is set');
  assert.equal(S.CompanyRepository.get('LATE').listed, true);
  assert.equal(price('LATE'), 25);
  assert.equal((await S.IpoService.listNow('LATE')).ok, false, 'already listed');
});
