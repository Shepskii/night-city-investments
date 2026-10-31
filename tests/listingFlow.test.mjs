import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Bob', 50000, true], ['Cass', 50000, true]] });
const [alice, bob, cass] = env.actors;
env.store.set('directOrderExecution', 'instant');

let S;
let E;

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    IpoService: (await load('../scripts/services/IpoService.js')).IpoService,
    NewsService: (await load('../scripts/services/NewsService.js')).NewsService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    CompanyRepository: (await load('../scripts/data/CompanyRepository.js')).CompanyRepository,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    BusinessRepository: (await load('../scripts/data/BusinessRepository.js')).BusinessRepository,
    BusinessService: (await load('../scripts/services/BusinessService.js')).BusinessService,
  };
  E = await load('../scripts/engine/index.js');
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await load('../scripts/init/registerBusinessSystem.js')).registerBusinessSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  await init.runPhase('init');
  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
});

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, (await import('../scripts/init/registerTickSequence.js')).TickSequence._queue, S.PortfolioClient._chain, S.PortfolioService._queue,
      S.NewsService._queue, S.IpoService._queue, S.BusinessService._queue]) await q;
  }
};
const portfolio = (actor) => S.PortfolioRepository.get(actor);
const resultOf = (actor, key) => portfolio(actor).results.find((r) => r.key === key);
const business = () => S.BusinessRepository.get('bus_play');
const held = (actor) => portfolio(actor).lots.filter((l) => l.assetId === 'PLAY').reduce((s, l) => s + l.qty, 0);

test('a ready listing becomes a market company with an IPO; on listing the float pays the company, holdings go into portfolios locked up, and the shareholders follow the portfolios', async () => {
  const day = S.BusinessService.day();
  const partner = (actor, units) => ({ actorId: actor.id, name: actor.name, status: 'active', cash: 1000, gear: [], units, voting: true, heirId: null, leavingSince: null });
  await S.BusinessRepository.save(E.normalizeBusiness({
    id: 'bus_play', name: 'Playco', archetype: 'infoShop', status: 'open', stage: 2, createdDay: day - 200, openedDay: day - 200,
    partners: [partner(alice, 700), partner(bob, 300)], till: 10000, assets: 5000, officers: [alice.id, bob.id],
    company: { ticker: 'PLAY', sector: 'tech', charteredDay: day - 100 }, state: { capacity: 4, reputation: 55, costFactor: 1, compliance: 60 },
    period: { index: 1, startDay: day, endDay: day + 7, slots: [], bonuses: [], helpers: [], draws: {}, days: {}, overtime: {} },
    listing: { status: 'ready', agreedDay: day, float: 0.25, fee: 1000, valuation: 133300, rolls: {}, retryDay: null, offer: { price: 100, float: 0.25, shares: 333, factor: 0 } },
  }));
  await S.BusinessService._scheduleListing(business());
  // Foundry's journal hook adds a new company to the market; the fake does not fire it.
  await S.TickService.syncCompanies();
  await settle();

  // The market company, unlisted, its offering open.
  const company = S.CompanyRepository.get('PLAY');
  assert.ok(company, 'made under the ticker');
  assert.deepEqual([company.businessId, company.listed, company.ipo.price, company.ipo.allocation, company.sharesOutstanding], ['bus_play', false, 100, 333, 1333]);
  assert.equal(business().listing.status, 'scheduled');
  assert.equal(S.PortfolioService.market().PLAY.ipo.open, true);

  // An outsider subscribes in the window.
  await S.PortfolioClient.submit(cass, 'deposit', { amount: 20000 });
  await settle();
  const sub = await S.PortfolioClient.submit(cass, 'subscribeIpo', { assetId: 'PLAY', qty: 50 });
  await settle();
  assert.equal(resultOf(cass, sub).ok, true);

  // The listing day.
  await S.TickService.advanceDays(E.BUSINESS_DEFAULTS.listing.ipoWindowDays);
  await settle();
  assert.equal(S.CompanyRepository.get('PLAY').listed, true);
  const b = business();
  assert.equal(b.listing.status, 'listed');
  assert.equal(b.till, 10000 + 333 * 100, 'the whole float paid the company');
  assert.equal(held(alice), 700, "the Medtech's shares are in her portfolio");
  assert.equal(held(bob), 300);
  assert.equal(held(cass), 50, 'the subscriber got their allocation');
  assert.ok(portfolio(alice).lots.find((l) => l.assetId === 'PLAY').lockedUntil > S.MarketStore.getPublic().time, 'locked up');
  assert.equal(E.drawAllowance(b, alice.id), 0, 'no draws once listed');

  // Locked shares cannot be sold; the subscriber's can.
  await S.PortfolioClient.submit(bob, 'deposit', { amount: 1000 });
  await settle();
  const locked = await S.PortfolioClient.submit(bob, 'placeOrder', { route: 'direct', side: 'sell', assetId: 'PLAY', qty: 10, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(resultOf(bob, locked).reason, 'locked-up');
  const free = await S.PortfolioClient.submit(cass, 'placeOrder', { route: 'direct', side: 'sell', assetId: 'PLAY', qty: 10, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(resultOf(cass, free).ok, true);

  // The shareholders follow the portfolios: the subscriber is one now, with a vote; the market holds the rest.
  const synced = E.normalizeBusiness(structuredClone(business()));
  S.BusinessService._syncHolders(synced);
  const units = (id) => synced.partners.find((x) => x.actorId === id)?.units;
  assert.deepEqual([units(alice.id), units(bob.id), units(cass.id)], [700, 300, 40]);
  assert.equal(synced.partners.find((x) => x.actorId === cass.id).voting, true);
  assert.equal(synced.partners.find((x) => x.market).units, 1333 - 1040);
  // A listed company is not a private stake any more.
  assert.equal(S.BusinessRepository.stakesOf(alice.id), 0);
});

test('after listing, a monthly report moves the stock toward its valuation per share, and makes the news', async () => {
  const b = business();
  const before = S.MarketStore.getPublic().companies.PLAY.price;
  const target = before * 1.5;
  await S.BusinessService._afterReports({ business: b, events: [{ type: 'reportPublished', report: { index: 9, reported: 5000, profit: 5000, valuation: Math.round(target * b.listing.shares) } }] });
  await settle();
  const impact = S.MarketStore.getControls().impacts.find((i) => i.sourceKey === 'report:bus_play:9');
  assert.ok(impact, 'queued');
  assert.equal(impact.permanent, 1, 'fair value settles at the target');
  assert.ok(Math.abs(impact.amount - Math.log(1.5)) < 0.01);
  // The same report again changes nothing.
  await S.BusinessService._afterReports({ business: b, events: [{ type: 'reportPublished', report: { index: 9, reported: 5000, profit: 5000, valuation: Math.round(target * b.listing.shares) } }] });
  await settle();
  assert.equal(S.MarketStore.getControls().impacts.filter((i) => i.sourceKey === 'report:bus_play:9').length, 1);
  assert.ok(S.MarketStore.getNews().items.some((n) => n.headline.includes('PlayerReport') || n.headline.includes('reports a month')));
  await S.TickService.advanceDays(6);
  await settle();
  assert.ok(S.MarketStore.getPublic().companies.PLAY.price > before * 1.25, `the price rises toward the target (${before} to ${S.MarketStore.getPublic().companies.PLAY.price})`);
});

test("a listed company's report pays the dividend into the holders' brokerage balances, by shares held", async () => {
  const b = business();
  const report = { index: 10, fromDay: 0, toDay: 0, weeks: 4, takings: 30000, upkeep: 10000, profit: 20000, reported: 20000, valuation: 2000000 };
  await S.BusinessRepository.save({ ...b, reports: [...(b.reports ?? []), report] });
  const cashOf = (actor) => portfolio(actor).cash;
  const before = { alice: cashOf(alice), bob: cashOf(bob), cass: cashOf(cass), till: business().till, divs: portfolio(alice).stats.dividends ?? 0 };
  await S.BusinessService._afterReports({ business: business(), events: [{ type: 'reportPublished', report }] });
  await settle();
  // 30% of 20,000 = 6,000 over 1,333 shares: 4.50 a share.
  const perShare = Math.floor((6000 / 1333) * 100) / 100;
  assert.equal(cashOf(alice), before.alice + Math.floor(700 * perShare));
  assert.equal(cashOf(bob), before.bob + Math.floor(300 * perShare));
  assert.equal(cashOf(cass), before.cass + Math.floor(40 * perShare), 'the outside buyer too');
  assert.equal(portfolio(alice).stats.dividends, before.divs + Math.floor(700 * perShare), 'counted as dividends received');
  assert.ok(business().till < before.till, 'paid from the company');
  assert.equal(business().reports.at(-1).dividend.perShare, perShare);
  // Paid once only.
  await S.BusinessService._afterReports({ business: business(), events: [{ type: 'reportPublished', report }] });
  await settle();
  assert.equal(cashOf(alice), before.alice + Math.floor(700 * perShare));
});

test('the market buys only so many of a listed player company\'s shares a day; the rest of a sale waits for the next day', async () => {
  const cap = E.dailySellCap(business());
  await S.TickService.advanceDays(1);
  await settle();
  const have = held(cass);
  assert.ok(have > 0, 'cass still holds some');
  // Bob's lock-up has not ended, so only Cass sells; give her more than a day's cap to sell.
  const extra = cap + 5 - have;
  if (extra > 0) {
    await S.PortfolioRepository.save(cass, { ...portfolio(cass), lots: [...portfolio(cass).lots, { id: 'lot_extra', assetType: 'stock', assetId: 'PLAY', qty: extra, unitCost: 100, acquiredTick: 0, drip: false }] });
  }
  const qty = held(cass);
  const key = await S.PortfolioClient.submit(cass, 'placeOrder', { route: 'direct', side: 'sell', assetId: 'PLAY', qty, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(resultOf(cass, key).ok, true);
  assert.equal(held(cass), qty - cap, 'a day\'s cap sold');
  assert.equal(portfolio(cass).orders.find((o) => o.id === `o_${key}`).waiting, 'liquidity');
  await S.TickService.advanceDays(1);
  await settle();
  assert.equal(held(cass), 0, 'the rest sold the next day');
});
