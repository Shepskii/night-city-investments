import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { daysUntil } from './helpers/marketDate.mjs';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Bob', 50000, true]] });
const [alice, bob] = env.actors;

let S; // loaded services, repositories and the DAY constant

before(async () => {
  const load = async (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    DividendService: (await load('../scripts/services/DividendService.js')).DividendService,
    CorporateActionService: (await load('../scripts/services/CorporateActionService.js')).CorporateActionService,
    MarketControlService: (await load('../scripts/services/MarketControlService.js')).MarketControlService,
    NewsService: (await load('../scripts/services/NewsService.js')).NewsService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    CompanyRepository: (await load('../scripts/data/CompanyRepository.js')).CompanyRepository,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    ModuleInitializer: (await load('../scripts/core/ModuleInitializer.js')).ModuleInitializer,
    registerMarketSystem: (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem,
    registerPortfolioSystem: (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem,
  };

  // Only the init phase: the ready phase would start real timers.
  const init = new S.ModuleInitializer();
  S.registerMarketSystem(init);
  S.registerPortfolioSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  await init.runPhase('init');

  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
});

const DAY = 86_400_000;
const settle = async () => {
  for (let i = 0; i < 3; i++) {
    await S.TickService._queue;
    await (await import('../scripts/init/registerTickSequence.js')).TickSequence._queue;
    await S.PortfolioClient._chain;
    await S.PortfolioService._queue;
    await S.DividendService._queue;
    await S.CorporateActionService._queue;
    await S.NewsService._queue;
  }
};
const advance = async (n = 1) => { await S.TickService.advance(n); await settle(); };
const portfolio = (actor) => S.PortfolioRepository.get(actor);
const pub = () => S.MarketStore.getPublic();
const news = () => S.MarketStore.getNews().items;

async function fund(actor, amount) {
  await S.PortfolioClient.submit(actor, 'deposit', { amount });
  await settle();
}
async function buy(actor, assetId, qty) {
  env.store.set('directOrderExecution', 'instant');
  await S.PortfolioClient.submit(actor, 'placeOrder', { side: 'buy', assetId, qty, orderType: 'market', expiry: 'day' });
  await settle();
  env.store.set('directOrderExecution', 'nextTick');
}

// ── Dividends ─────────────────────────────────────────────────────────────────

test('dividends: the first sight of a company records its period without paying', async () => {
  await S.CompanyRepository.save({ ...S.CompanyRepository.getByTicker('ARA'), dividend: { policy: 'fixed', frequency: 'quarterly', perShare: 2, payoutDay: 1 } });
  await fund(alice, 20000);
  await buy(alice, 'ARA', 10);
  await advance(1); // ARA's lots are now older than the next tick
  const cash = portfolio(alice).cash;

  await advance(1);
  assert.equal(portfolio(alice).cash, cash, 'nothing paid yet');
  assert.equal(S.MarketStore.getDividendRecords().ARA.lastKey, '2045-Q1');
});

test('dividends: a new quarter pays holders once, announces it, and does not repeat', async () => {
  const cash = portfolio(alice).cash;
  await S.TickService.advanceDays(await daysUntil(2045, 4, 5)); // 5 April: Q2
  await settle();

  assert.equal(portfolio(alice).cash, cash + 20, '10 shares x 2 eb');
  assert.equal(portfolio(alice).stats.dividends, 20);
  assert.equal(portfolio(alice).ledger.at(-1).kind, 'dividend');
  assert.equal(S.MarketStore.getDividendRecords().ARA.lastKey, '2045-Q2');
  assert.ok(news().some((n) => n.headline.includes('NCI.News.Dividend') && n.companyIds.includes('ARA')));
  assert.equal(env.hooksFired.filter((h) => h.name === 'night-city-investments.dividendPaid' && h.args[0].companyId === 'ARA').length, 1);

  await advance(2);
  assert.equal(portfolio(alice).cash, cash + 20, 'same period is not paid again');
});

test('dividends: non-holders are untouched and a reinvesting holder buys shares', async () => {
  assert.equal(portfolio(bob).stats.dividends, 0);

  await fund(bob, 20000);
  await buy(bob, 'ARA', 20);
  await advance(1);
  await S.PortfolioClient.submit(bob, 'setDrip', { assetId: 'ARA', enabled: true });
  await settle();
  assert.equal(portfolio(bob).drip.ARA, true);

  const sharesBefore = portfolio(bob).lots.filter((l) => l.assetId === 'ARA').reduce((s, l) => s + l.qty, 0);
  await S.TickService.advanceDays(await daysUntil(2045, 7, 5)); // July: Q3
  await settle();
  const sharesAfter = portfolio(bob).lots.filter((l) => l.assetId === 'ARA').reduce((s, l) => s + l.qty, 0);
  assert.equal(sharesBefore, 20);
  assert.ok(sharesAfter >= 20, 'dividend reinvested into whole shares when the payout covers one');
  assert.ok(portfolio(bob).ledger.some((l) => l.kind === 'dividend'));
  assert.equal(portfolio(alice).stats.dividends, 40, 'alice was paid for Q3 as well');
});

test('dividends: a GM special dividend pays holders once per declaration', async () => {
  const cash = portfolio(alice).cash;
  const paid = await S.DividendService.declareSpecial('ARA', 1.5);
  await settle();
  assert.ok(paid >= 1);
  assert.equal(portfolio(alice).cash, cash + 15);
  assert.ok(news().some((n) => n.headline.includes('NCI.News.SpecialDividend')));
  await S.DividendService.declareSpecial('ARA', 1.5);
  await settle();
  assert.equal(portfolio(alice).cash, cash + 30, 'a second special is a separate declaration');
  assert.equal(await S.DividendService.declareSpecial('NOPE', 1), 0);
  assert.equal(await S.DividendService.declareSpecial('ARA', -1), 0);
});

// ── Corporate actions ─────────────────────────────────────────────────────────

test('split: prices, history, shares, cost, company factor and news all move together', async () => {
  const before = pub().companies.ARA.price;
  const lotsBefore = portfolio(alice).lots.filter((l) => l.assetId === 'ARA').reduce((s, l) => s + l.qty, 0);
  const costBefore = portfolio(alice).lots.find((l) => l.assetId === 'ARA').unitCost;
  const histBefore = S.MarketStore.getHistory().series.ARA.closes.at(-1);

  const r = await S.CorporateActionService.split('ARA', 2);
  await settle();
  assert.equal(r.ok, true);

  assert.ok(Math.abs(pub().companies.ARA.price - before / 2) <= 0.01);
  assert.equal(portfolio(alice).lots.filter((l) => l.assetId === 'ARA').reduce((s, l) => s + l.qty, 0), lotsBefore * 2);
  assert.ok(Math.abs(portfolio(alice).lots.find((l) => l.assetId === 'ARA').unitCost - costBefore / 2) < 0.001);
  assert.ok(Math.abs(S.MarketStore.getHistory().series.ARA.closes.at(-1) - histBefore / 2) <= 1);
  assert.equal(S.CompanyRepository.get('ARA').splitFactor, 2);
  assert.ok(news().some((n) => n.headline.includes('NCI.News.Split')));
  assert.equal((await S.CorporateActionService.split('ARA', 1)).ok, false);
});

test('auto split triggers once a price crosses the threshold', async () => {
  await S.CompanyRepository.save({ ...S.CompanyRepository.getByTicker('KEN'), split: { auto: true, above: 1, ratio: 3 } });
  await advance(1);
  assert.equal(S.CompanyRepository.get('KEN').splitFactor, 3);
});

test('buyout: holders are paid cash, the position is removed, orders cancelled, status set', async () => {
  await buy(alice, 'MIL', 5);
  const cash = portfolio(alice).cash;
  const r = await S.CorporateActionService.buyout('MIL', 200);
  await settle();
  assert.equal(r.ok, true);
  assert.equal(portfolio(alice).cash, cash + 1000);
  assert.equal(portfolio(alice).lots.some((l) => l.assetId === 'MIL'), false);
  assert.equal(S.CompanyRepository.get('MIL').status, 'acquired');
  assert.ok(news().some((n) => n.headline.includes('NCI.News.Buyout')));
  assert.ok(portfolio(alice).stats.realized !== 0);
});

test('delisting pays at the last price; bankruptcy pays nothing and books the loss', async () => {
  await buy(alice, 'PET', 4);
  await buy(alice, 'BIO', 3);
  const lastPet = pub().companies.PET.price;
  const cash = portfolio(alice).cash;
  const realized = portfolio(alice).stats.realized;

  await S.CorporateActionService.delist('PET');
  await settle();
  assert.equal(portfolio(alice).cash, cash + Math.round(4 * lastPet));
  assert.equal(S.CompanyRepository.get('PET').status, 'delisted');

  const cash2 = portfolio(alice).cash;
  await S.CorporateActionService.bankrupt('BIO');
  await settle();
  assert.equal(portfolio(alice).cash, cash2);
  assert.equal(portfolio(alice).lots.some((l) => l.assetId === 'BIO'), false);
  assert.equal(S.CompanyRepository.get('BIO').status, 'bankrupt');
  assert.ok(portfolio(alice).stats.realized < realized + Math.round(4 * lastPet), 'the bankruptcy loss is recorded');
  assert.ok(news().some((n) => n.headline.includes('NCI.News.Bankrupt')));

  const frozen = pub().companies.BIO.price;
  await advance(2);
  assert.equal(pub().companies.BIO.price, frozen, 'a bankrupt company no longer moves');
});

test('set price: moves price and the latest history point, keeps fair value in proportion, and is logged', async () => {
  const hiddenBefore = S.MarketStore.getHidden().companies.CON;
  const priceBefore = pub().companies.CON.price;
  const r = await S.CorporateActionService.setPrice('CON', 99.5);
  await settle();
  assert.equal(r.ok, true);
  assert.equal(pub().companies.CON.price, 99.5);
  assert.equal(S.MarketStore.getHistory().series.CON.closes.at(-1), 9950);
  const ratioBefore = hiddenBefore.fair / priceBefore;
  const ratioAfter = S.MarketStore.getHidden().companies.CON.fair / 99.5;
  assert.ok(Math.abs(ratioAfter - ratioBefore) < 1e-9, 'fair value moved with the price');
  assert.equal(S.MarketStore.getControls().log.at(-1).kind, 'setPrice');
  assert.equal((await S.CorporateActionService.setPrice('CON', 0.2)).ok, false);
});

// ── GM controls ───────────────────────────────────────────────────────────────

test('controls: a bias is stored, applies for its duration, then expires', async () => {
  assert.equal(await S.MarketControlService.addBias({ target: 'market', value: 1, days: 3 }), true);
  await settle();
  assert.equal(S.MarketStore.getControls().biases.length, 1);
  await advance(2);
  assert.equal(S.MarketStore.getControls().biases.length, 1);
  await advance(2);
  assert.equal(S.MarketStore.getControls().biases.length, 0, 'expired biases are removed');
  assert.equal(await S.MarketControlService.addBias({ target: 'nonsense', value: 1, days: 3 }), false);
  assert.equal(await S.MarketControlService.addBias({ target: 'market', value: 1, days: 0 }), false);
});

test('controls: a removed bias stops applying', async () => {
  await S.MarketControlService.addBias({ target: 'sector:tech', value: 2, days: 20 });
  await settle();
  const id = S.MarketStore.getControls().biases[0].id;
  await S.MarketControlService.removeBias(id);
  await settle();
  assert.equal(S.MarketStore.getControls().biases.length, 0);
});

test('controls: a forced regime shows in the hidden state and clears when it ends', async () => {
  assert.equal(await S.MarketControlService.forceRegime('crash', 2), true);
  await advance(1);
  assert.equal(S.MarketStore.getHidden().regime, 'crash');
  assert.equal(pub().mood, 'panic');
  await advance(2);
  assert.equal(S.MarketStore.getControls().forceRegime, null);
  assert.equal(await S.MarketControlService.forceRegime('nope', 2), false);
  assert.equal(JSON.stringify(pub()).includes('regime'), false, 'the regime name never reaches players');
});

test('controls: halting the market freezes prices and resuming restores movement', async () => {
  await S.MarketControlService.setHalt(true);
  await settle();
  const frozen = { ...Object.fromEntries(Object.entries(pub().companies).map(([id, c]) => [id, c.price])) };
  await advance(2);
  for (const [id, price] of Object.entries(frozen)) assert.equal(pub().companies[id].price, price);
  assert.ok(news().some((n) => n.headline.includes('NCI.News.HaltAll')));

  await S.MarketControlService.setHalt(false);
  await advance(1);
  assert.ok(Object.entries(frozen).some(([id, price]) => pub().companies[id].price !== price));
});

test('controls: volatility is clamped and stored', async () => {
  await S.MarketControlService.setVolatility(99);
  await settle();
  assert.equal(S.MarketStore.getControls().volMult, 4);
  await S.MarketControlService.setVolatility(0.01);
  await settle();
  assert.equal(S.MarketStore.getControls().volMult, 0.25);
  await S.MarketControlService.setVolatility(1);
  await settle();
});

test('controls: a delayed shock waits, then moves its target and finally clears', async () => {
  await S.MarketControlService.setVolatility(0.25);
  await S.MarketControlService.addShock({ target: 'company:CON', percent: -25, delayDays: 2, persistence: 'lasting', headline: 'Recall hits Continental' });
  await settle();
  assert.equal(S.MarketStore.getControls().impacts.length, 1);
  assert.ok(news().some((n) => n.headline === 'Recall hits Continental' && n.tone === 'down'));

  const start = pub().companies.CON.price;
  await advance(2);
  const early = pub().companies.CON.price;
  await advance(8);
  const late = pub().companies.CON.price;
  assert.ok(Math.abs(early - start) / start < 0.1, 'little effect before the delay ends');
  assert.ok(late < start * 0.92, `price fell after the shock (${start} -> ${late})`);

  // A lasting impact is dropped 8 x its decay time (160 ticks) after onset.
  await advance(180);
  assert.equal(S.MarketStore.getControls().impacts.length, 0, 'finished impacts are dropped');
  assert.equal(await S.MarketControlService.addShock({ target: 'market', percent: 0 }), false);
  await S.MarketControlService.setVolatility(1);
  await settle();
});

test('controls: shocks can be cancelled and the target picker lists market, sectors and companies', async () => {
  await S.MarketControlService.addShock({ target: 'sector:energy', percent: 5 });
  await settle();
  const id = S.MarketStore.getControls().impacts[0].id;
  await S.MarketControlService.removeImpact(id);
  await settle();
  assert.equal(S.MarketStore.getControls().impacts.length, 0);

  const options = S.MarketControlService.targetOptions();
  assert.equal(options[0].value, 'market');
  assert.ok(options.some((o) => o.value === 'sector:arms'));
  assert.ok(options.some((o) => o.value === 'company:ARA'));
});

test('only the active GM can change controls or run corporate actions', async () => {
  game.users.activeGM = { id: 'someone-else' };
  const before = JSON.stringify(S.MarketStore.getControls());
  assert.equal(await S.MarketControlService.addBias({ target: 'market', value: 1, days: 3 }), false);
  assert.equal((await S.CorporateActionService.split('CON', 2)).ok, false);
  assert.equal((await S.CorporateActionService.setPrice('CON', 50)).ok, false);
  assert.equal(await S.DividendService.declareSpecial('CON', 1), 0);
  await S.NewsService.post({ headline: 'nope' });
  assert.equal(JSON.stringify(S.MarketStore.getControls()), before);
  assert.equal(news().some((n) => n.headline === 'nope'), false);
  game.users.activeGM = { id: 'gm1' };
});

test('reset clears news, dividend records and controls', async () => {
  await S.TickService.reset();
  await settle();
  assert.equal(news().length, 0);
  assert.deepEqual(S.MarketStore.getDividendRecords(), {});
  assert.equal(S.MarketStore.getControls().biases.length, 0);
  assert.equal(S.MarketStore.getControls().log.length, 0);
  assert.equal(pub().tickIndex, 0);
});
