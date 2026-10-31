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
