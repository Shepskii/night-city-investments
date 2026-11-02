import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Bob', 50000, true], ['Cass', 50000, true]] });
const [alice, bob, cass] = env.actors;
env.store.set('directOrderExecution', 'instant');
const { chats } = installFakeChat();

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
  // Fair value carries the permanent move; the price follows it through the noise.
  const fair = S.MarketStore.getHidden().companies.PLAY.fair;
  assert.ok(fair > before * 1.35, `fair value moves toward the target (${before} to ${fair})`);
  // The price follows fair value through six days of noise: nearly always up, never far down.
  assert.ok(S.MarketStore.getPublic().companies.PLAY.price > before * 0.95, 'and the price follows');
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

test('with insider tracking on, a listed company\'s report opens a watch window: an officer who buys before the price moves gains heat', async () => {
  env.store.set('heatEnabled', true);
  const { HeatService } = await import('../scripts/services/HeatService.js');
  const b = business();
  const price = S.MarketStore.getPublic().companies.PLAY.price;
  const report = { index: 11, fromDay: 0, toDay: 0, weeks: 4, takings: 30000, upkeep: 10000, profit: 20000, reported: 20000, valuation: Math.round(price * 1.4 * b.listing.shares) };
  await S.BusinessService._afterReports({ business: b, events: [{ type: 'reportPublished', report }] });
  await settle();
  const window = S.MarketStore.getHeat().windows.find((w) => w.sourceKey === 'report:bus_play:11');
  assert.ok(window, 'opened');
  assert.deepEqual([window.companyId, window.direction, window.runners.includes(alice.id), window.tipped.includes(alice.id)], ['PLAY', 'up', true, false]);

  await S.PortfolioClient.submit(alice, 'deposit', { amount: 45000 });
  await settle();
  const buy = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'PLAY', qty: Math.floor(40000 / (price * 1.1)), orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(resultOf(alice, buy).ok, true);
  await S.TickService.advanceDays(3);
  await settle();
  await HeatService._queue;
  assert.equal(S.MarketStore.getHeat().windows.find((w) => w.sourceKey === 'report:bus_play:11').status !== 'open', true, 'audited');
  assert.ok(HeatService.heatOf(alice.id) > 0, 'the officer who bought ahead of the move');
  env.store.set('heatEnabled', false);
});

test('a listed company\'s secondary offering goes on the terminal; subscribers get their shares when it closes, the market the rest, and the company the money', async () => {
  const day = S.BusinessService.day();
  const b = E.normalizeBusiness(structuredClone(business()));
  b.capital = { issue: { kind: 'offering', status: 'roll', shares: 100, startDay: day }, buyback: null };
  const price = S.MarketStore.getPublic().companies.PLAY.price;
  E.applyOfferingRoll(b, alice.id, { band: 'solid' }, { day, price });
  await S.BusinessRepository.save(b);
  await S.BusinessService._capitalEvents({ business: business(), events: [{ type: 'offeringSet' }] });
  await settle();
  const offer = S.CompanyRepository.get('PLAY').offering;
  assert.ok(offer && offer.shares === 100, 'on the market company\'s record');
  assert.equal(S.PortfolioService.market().PLAY.ipo.open, true, 'open for subscription');

  await S.PortfolioClient.submit(cass, 'deposit', { amount: 10000 });
  await settle();
  const sub = await S.PortfolioClient.submit(cass, 'subscribeIpo', { assetId: 'PLAY', qty: 30 });
  await settle();
  assert.equal(resultOf(cass, sub).ok, true, resultOf(cass, sub).reason);

  const before = { shares: business().listing.shares, till: business().till, held: held(cass) };
  await S.TickService.advanceDays(E.BUSINESS_DEFAULTS.capital.offering.windowDays + 1);
  await settle();
  const after = business();
  assert.equal(after.capital.issue, null, 'settled');
  assert.equal(held(cass), before.held + 30, 'the subscriber got their shares');
  assert.equal(after.listing.shares, before.shares + 100);
  assert.equal(S.CompanyRepository.get('PLAY').sharesOutstanding, before.shares + 100);
  assert.equal(S.CompanyRepository.get('PLAY').offering, null);
  assert.ok(after.till >= before.till + Math.round(100 * offer.price) - 1, 'the whole offering paid the company');
  assert.equal(after.partners.find((x) => x.actorId === cass.id)?.units, held(cass), 'a shareholder by her portfolio');
});

test('a listed company\'s buyback buys from the float each market day and retires the shares', async () => {
  const b = E.normalizeBusiness(structuredClone(business()));
  b.capital = { issue: null, buyback: { kind: 'market', status: 'buying', budget: 3000, spent: 0, bought: 0, adj: 0, startDay: S.BusinessService.day() } };
  await S.BusinessRepository.save(b);
  const before = { shares: business().listing.shares, float: business().partners.find((x) => x.market).units };
  await S.TickService.advanceDays(1);
  await settle();
  const after = business();
  const bought = before.shares - after.listing.shares;
  assert.ok(bought > 0, 'bought some back');
  assert.ok(bought <= E.dailySellCap(after), 'within the daily cap');
  assert.equal(after.partners.find((x) => x.market).units, before.float - bought, 'from the float');
  assert.equal(S.CompanyRepository.get('PLAY').sharesOutstanding, after.listing.shares);
  // Done before the next tests.
  await S.BusinessRepository.save({ ...business(), capital: { issue: null, buyback: null } });
});

test('a takeover bid for a listed company, by ticker: approved with the offer held from the bidder\'s balance; holders tender free shares, the float tenders by the premium; at the close shares move between portfolios', async () => {
  const { BusinessClient } = await import('../scripts/services/BusinessClient.js');
  const price = S.MarketStore.getPublic().companies.PLAY.price;
  const offer = Math.round(price * 1.3 * 100) / 100;
  await S.PortfolioClient.submit(cass, 'deposit', { amount: 30000 });
  await settle();
  const want = Math.floor(20000 / offer);
  await BusinessClient.submit(cass, 'bid', { ticker: 'play', price: offer, shares: want });
  await S.BusinessService.processActor(cass);
  await settle();
  assert.equal(business().takeover?.status, 'awaiting', 'named by its ticker, waiting for the GM');

  const cashBefore = portfolio(cass).cash;
  assert.equal((await S.BusinessService.approveTakeover('bus_play')).ok, true);
  await settle();
  assert.equal(business().takeover.status, 'open');
  assert.equal(portfolio(cass).cash, cashBefore - Math.round(offer * want), 'the offer held');

  // Alice tenders some of her free shares (the ones she bought; her listing shares may still be locked).
  const tick = S.MarketStore.getPublic().time;
  const free = E.sellableQty(portfolio(alice).lots, 'PLAY', tick);
  assert.ok(free >= 20, `alice has free shares (${free})`);
  await BusinessClient.submit(alice, 'tender', { businessId: 'bus_play', qty: 20 });
  await S.BusinessService.processActor(alice);
  await settle();
  assert.equal(business().takeover.tenders[alice.id], 20);

  const before = { alice: held(alice), aliceCash: portfolio(alice).cash, cass: held(cass), shares: business().listing.shares };
  await S.TickService.advanceDays(E.BUSINESS_DEFAULTS.takeover.days + 1);
  await settle();
  const after = business();
  assert.equal(after.takeover, null, 'closed');
  const bought = after.lastTakeover.acquired;
  assert.ok(bought > 20 && bought <= want, `the float tendered at a 30% premium (${bought})`);
  assert.equal(held(cass), before.cass + bought, 'the bidder\'s portfolio has them');
  assert.ok(held(alice) <= before.alice - 1 && held(alice) >= before.alice - 20, 'alice sold (pro rata at most 20)');
  // Paid into her balance (other money, such as a dividend, may land in the same days).
  const tendered = portfolio(alice).ledger.find((e) => e.kind === 'tendered' && e.ref === 'bus_play');
  assert.deepEqual([tendered.qty, tendered.amount], [-(before.alice - held(alice)), Math.floor((before.alice - held(alice)) * offer)], 'paid into her balance');
  assert.ok(portfolio(alice).cash >= before.aliceCash + tendered.amount);
  assert.equal(after.listing.shares, before.shares, 'no shares made or lost');
  assert.equal(after.partners.find((x) => x.actorId === cass.id)?.units, held(cass), 'a shareholder by her portfolio');
  const settled = portfolio(cass).ledger.find((e) => e.kind === 'takeoverSettled' && e.ref === 'bus_play');
  assert.equal(settled.amount, Math.round(offer * want) - after.lastTakeover.spent, 'what was not spent came back');
});

test('a hidden holder shows on the public register as their outer layer; strengths stay in the GM\'s hidden state; monthly fees are charged, and a layer that cannot be paid lapses', async () => {
  const day = S.BusinessService.day();
  const b = E.normalizeBusiness(structuredClone(business()));
  S.BusinessService._syncHolders(b);
  b.masks = {
    [alice.id]: [{ kind: 'nominee', name: 'Vex', day: day - 30, lastFee: day - 30 }, { kind: 'shell', name: 'Kestrel Holdings', day: day - 30, lastFee: day - 30 }],
    [bob.id]: [{ kind: 'nominee', name: 'Vex', day: day - 30, lastFee: day - 30 }],
  };
  await S.BusinessRepository.save(b);
  await S.BusinessService._saveHidden({ business: business(), events: [], layerTotals: [{ holderId: alice.id, index: 0, total: 17 }, { holderId: alice.id, index: 1, total: 21 }, { holderId: bob.id, index: 0, total: 16 }] });
  await S.BusinessService._publishRegister(business());
  const register = S.CompanyRepository.get('PLAY').register;
  assert.ok(register.some((r) => r.label === 'Kestrel Holdings' && r.kind === 'shell'), 'the outer layer, not alice');
  assert.equal(register.some((r) => r.label === alice.name), false);
  assert.deepEqual(S.MarketStore.getBusinessesHidden().bus_play.layers[alice.id], [17, 21]);

  // Alice can pay; Bob cannot.
  await S.PortfolioRepository.save(bob, { ...portfolio(bob), cash: 0 });
  const aliceCash = portfolio(alice).cash;
  await S.BusinessService._layerFees();
  await settle();
  assert.ok(portfolio(alice).cash < aliceCash, 'alice paid her two layers');
  assert.equal(portfolio(alice).ledger.filter((e) => e.kind === 'layerFee').length, 2);
  assert.equal(business().masks[alice.id][0].lastFee, day);
  assert.equal(business().masks[bob.id], undefined, 'bob\'s nominee lapsed');
  assert.equal(S.MarketStore.getBusinessesHidden().bus_play.layers[bob.id], undefined, 'and its strength is gone');
  await S.BusinessRepository.save({ ...business(), masks: {} });
  await S.BusinessService._saveHidden({ business: business(), events: [] });
});

test('concealment: a hidden holder over 5% adds Exposure (and heat, when tracked) each week; NCPD\'s monthly look unmasks and fines when it sees through', async () => {
  env.store.set('heatEnabled', true);
  const { HeatService } = await import('../scripts/services/HeatService.js');
  const day = S.BusinessService.day();
  const b = E.normalizeBusiness(structuredClone(business()));
  S.BusinessService._syncHolders(b);
  b.masks = { [alice.id]: [{ kind: 'nominee', name: 'Vex', day, lastFee: day }] };
  await S.BusinessRepository.save(b);
  const hidden = S.MarketStore.getBusinessesHidden();
  // A thin layer (strength 5), a week and a month since it was last looked at.
  await S.MarketStore.setBusinessesHidden({ ...hidden, bus_play: { ...(hidden.bus_play ?? {}), exposure: 0, layers: { [alice.id]: [5] }, concealment: { [alice.id]: { week: day - 7, audit: day - 28 } } } });
  assert.ok(E.concealedHolders(business()).some((x) => x.holderId === alice.id), `alice holds over 5% (${E.concealedHolders(business()).map((x) => x.share)})`);
  const heatBefore = HeatService.heatOf(alice.id);
  const cashBefore = portfolio(alice).cash;

  // NCPD looks (0.01 < 10%) and rolls a 10: 24 against a layer of 5.
  const numbers = [0.01, 0.95];
  await S.BusinessService._concealment({ random: () => numbers.shift() ?? 0.5 });
  await settle();
  const after = S.MarketStore.getBusinessesHidden().bus_play;
  assert.equal(after.exposure, E.BUSINESS_DEFAULTS.ownership.exposure, 'a week of Exposure');
  assert.ok(HeatService.heatOf(alice.id) >= heatBefore + E.BUSINESS_DEFAULTS.ownership.heat - 0.5, 'and of heat');
  assert.equal(business().masks[alice.id], undefined, 'unmasked');
  assert.ok(portfolio(alice).cash < cashBefore, 'fined');
  assert.ok(portfolio(alice).ledger.some((e) => e.kind === 'concealmentFine'));
  assert.ok(S.MarketStore.getNews().items.some((n) => /unmask/i.test(n.headline)), 'in the news');
  const dip = S.MarketStore.getControls().impacts.find((i) => i.source === 'unmasked');
  assert.ok(dip && dip.amount < 0 && dip.permanent === 1, 'and a lasting dip in the price');
  assert.ok(!S.CompanyRepository.get('PLAY').register.some((r) => r.label === 'Vex'), 'the register shows her own name now');
  // Alice holds over a quarter of the company: her unmasking brings a case to it too (R1).
  assert.equal(business().regCase?.reason, 'unmasked');
  await S.BusinessRepository.save({ ...business(), regCase: null });
  env.store.set('heatEnabled', false);
  await S.BusinessRepository.save({ ...business(), masks: {} });
  await S.BusinessService._saveHidden({ business: business(), events: [] });
});

test('an investigation by ticker: a roll against a hidden total peels one layer at a time, once a week, telling only the investigator', async () => {
  const { SkillAdapter } = await import('../scripts/services/SkillAdapter.js');
  const { BusinessClient } = await import('../scripts/services/BusinessClient.js');
  const { MailService } = await import('../scripts/services/MailService.js');
  const rollOne = SkillAdapter.rollOne;
  const fromWire = MailService.fromWire;
  const sent = [];
  MailService.fromWire = async (actor, spec) => { sent.push({ actor: actor.id, subject: spec.subject, lines: spec.lines }); return { ok: true }; };
  const dice = [];
  SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 5, roll: null });
  try {
    const day = S.BusinessService.day();
    const b = E.normalizeBusiness(structuredClone(business()));
    S.BusinessService._syncHolders(b);
    b.masks = { [bob.id]: [{ kind: 'nominee', name: 'Vex', day, lastFee: day, ref: 'ref_in' }, { kind: 'shell', name: 'Kestrel Holdings', day, lastFee: day, ref: 'ref_out' }] };
    // Cass holds shares too: with her business days used up, she pays for the legwork.
    b.period.days = { ...(b.period.days ?? {}), [cass.id]: E.BUSINESS_DEFAULTS.businessDays };
    await S.BusinessRepository.save(b);
    await S.BusinessService._saveHidden({ business: business(), events: [], layerTotals: [{ holderId: bob.id, index: 0, total: 5 }, { holderId: bob.id, index: 1, total: 6 }] });
    const library = { kind: 'skill', skill: 'Library Search', stat: 'int' };
    const dig = async () => {
      const { messageId } = await SkillAdapter.leverCheck(cass, { dv: null, title: 'Investigating', use: library });
      const key = await BusinessClient.submit(cass, 'investigate', { ticker: 'PLAY', ref: 'ref_out', use: library, rollId: messageId });
      await S.BusinessService.processActor(cass);
      await settle();
      return (cass.getFlag('night-city-investments', 'businessReceipts') ?? []).flatMap((x) => x.results ?? []).find((r) => r.key === key);
    };

    dice.push(9);
    const wealthBefore = cass.system.wealth.value;
    const first = await dig();
    assert.equal(first.ok, true, first.reason);
    assert.equal(cass.system.wealth.value, wealthBefore - E.BUSINESS_DEFAULTS.ownership.investigate.legwork, 'no business day free: legwork money');
    assert.equal(first.investigation.success, true, `a 9 beats the shell's 6 (${first.investigation.band})`);
    assert.ok(sent.some((m) => m.actor === cass.id && m.lines.join(' ').includes('Vex')), 'told of the nominee behind it');
    assert.equal(sent.some((m) => m.actor === bob.id), false, 'bob is not told');
    const found = cass.getFlag('night-city-investments', 'discoveries')[0].ref_out;
    assert.ok(found.length === 1 && found[0].includes('Vex'), `kept on her character for her windows (${found})`);
    assert.equal(/DV \d/.test(chats.at(-1).content), false, 'the card shows no DV');

    dice.push(9);
    assert.equal((await dig()).reason, 'investigate-wait', 'once a week');
    assert.equal(cass.system.wealth.value, wealthBefore - E.BUSINESS_DEFAULTS.ownership.investigate.legwork, 'a refused try costs nothing');
    assert.equal(cass.getFlag('night-city-investments', 'investigated')[0].ref_out, day, 'the try noted on her character, for her window');

    // A week on: the nominee, at 5 + 2 for the shell above it.
    const hidden = S.MarketStore.getBusinessesHidden();
    const known = hidden.bus_play.known;
    known[cass.id][bob.id].tried = day - 7;
    await S.MarketStore.setBusinessesHidden({ ...hidden, bus_play: { ...hidden.bus_play, known } });
    dice.push(9);
    const second = await dig();
    assert.equal(second.investigation.success, true);
    assert.ok(sent.some((m) => m.actor === cass.id && m.lines.join(' ').includes(bob.name)), 'and then who it is');
    const found2 = cass.getFlag('night-city-investments', 'discoveries')[0].ref_out;
    assert.deepEqual([found2.length, found2.at(-1)], [2, bob.name]);
    assert.equal(business().masks[bob.id].length, 2, 'an investigation tells the investigator, not the register');

    // A partner spends a business day instead, and keeps their money.
    const aliceWealth = alice.system.wealth.value;
    const daysBefore = business().period.days?.[alice.id] ?? 0;
    dice.push(2);
    const { messageId } = await SkillAdapter.leverCheck(alice, { dv: null, title: 'Investigating', use: library });
    const key = await BusinessClient.submit(alice, 'investigate', { ticker: 'PLAY', ref: 'ref_out', use: library, rollId: messageId });
    await S.BusinessService.processActor(alice);
    await settle();
    const asPartner = (alice.getFlag('night-city-investments', 'businessReceipts') ?? []).flatMap((x) => x.results ?? []).find((r) => r.key === key);
    assert.equal(asPartner.ok, true, asPartner.reason);
    assert.equal(business().period.days[alice.id], daysBefore + 1);
    assert.equal(alice.system.wealth.value, aliceWealth);
  } finally {
    SkillAdapter.rollOne = rollOne;
    MailService.fromWire = fromWire;
    await S.BusinessRepository.save({ ...business(), masks: {} });
    await S.BusinessService._saveHidden({ business: business(), events: [] });
  }
});

test('a hidden holder on the cap table: others see the outer layer and what their own investigations found; the holder and the GM Console see the truth', async () => {
  const { holderWho } = await import('../scripts/ui/Business/context.js');
  const b = E.normalizeBusiness(structuredClone(business()));
  S.BusinessService._syncHolders(b);
  b.masks = { [bob.id]: [{ kind: 'nominee', name: 'Vex', day: 0, lastFee: 0, ref: 'ref_a' }, { kind: 'shell', name: 'Kestrel & Co', day: 0, lastFee: 0, ref: 'ref_b' }] };
  const row = b.partners.find((x) => x.actorId === bob.id);
  assert.equal(holderWho(b, row, alice.id), 'Kestrel &amp; Co', 'the outer layer only, escaped');
  await alice.setFlag('night-city-investments', 'discoveries', [{ ref_b: ['Vex (nominee)'] }]);
  assert.equal(holderWho(b, row, alice.id), 'Kestrel &amp; Co → Vex (nominee)', 'with what she has found');
  assert.ok(holderWho(b, row, bob.id).includes(bob.name), 'the holder sees themselves');
  assert.ok(holderWho(b, row, null, { truth: true }).includes(bob.name), 'and the GM Console the truth');
  await alice.setFlag('night-city-investments', 'discoveries', [{}]);
  // Running text (proposals, the ledger) gives the outer layer too, for everyone.
  const { nameOf } = await import('../scripts/ui/Business/context.js');
  assert.equal(nameOf(b, bob.id).includes(bob.name), false);
  assert.ok(nameOf(b, bob.id).includes('Kestrel'));
  assert.equal(nameOf(b, alice.id), alice.name, 'an unhidden holder by name');
});

test('a regulator\'s case: triggers open it; an officer answers against a hidden total; a win clears half the Exposure; a loss or silence waits on the GM', async () => {
  const { SkillAdapter } = await import('../scripts/services/SkillAdapter.js');
  const { BusinessClient } = await import('../scripts/services/BusinessClient.js');
  const { MailService } = await import('../scripts/services/MailService.js');
  const rollOne = SkillAdapter.rollOne;
  const fromWire = MailService.fromWire;
  const sent = [];
  MailService.fromWire = async (actor, spec) => { sent.push({ actor: actor.id, subject: spec.subject }); return { ok: true }; };
  const dice = [];
  SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 5, roll: null });
  const day = S.BusinessService.day();
  const setExposure = async (exposure) => {
    const hidden = S.MarketStore.getBusinessesHidden();
    await S.MarketStore.setBusinessesHidden({ ...hidden, bus_play: { ...(hidden.bus_play ?? {}), exposure } });
  };
  const accounting = { kind: 'skill', skill: 'Accounting', stat: 'int' };
  const answer = async (use = accounting) => {
    const { messageId } = await SkillAdapter.leverCheck(alice, { dv: null, title: 'Answering', use });
    const key = await BusinessClient.submit(alice, 'caseRoll', { businessId: 'bus_play', use, rollId: messageId });
    await S.BusinessService.processActor(alice);
    await settle();
    return (alice.getFlag('night-city-investments', 'businessReceipts') ?? []).flatMap((x) => x.results ?? []).find((r) => r.key === key);
  };
  try {
    await S.BusinessRepository.save({ ...business(), regCase: null, officers: [alice.id, bob.id] });
    await setExposure(0);

    // At clean Exposure a report never opens one; a fired corp plant does.
    await S.BusinessService._regulatorEvents({ business: business(), events: [{ type: 'reportPublished', report: { index: 50 } }] });
    assert.equal(business().regCase, null, 'clean: no case');
    await S.BusinessService._regulatorEvents({ business: business(), events: [{ type: 'fired', exposure: 5 }] });
    assert.deepEqual([business().regCase.status, business().regCase.reason, business().regCase.endDay], ['notice', 'plant', day + E.BUSINESS_DEFAULTS.regulator.notice]);
    assert.ok(sent.some((m) => m.actor === alice.id && /OpenSubject/.test(m.subject)), 'the holders are told');

    // A win: pick a case date whose seeded regulator total a crit of 20 beats.
    await setExposure(20);
    let openedDay = day;
    for (let d = day; d > day - 200; d--) {
      const rng = E.createRng(`${S.BusinessService.seed()}:caseRoll:bus_play:${d}`);
      if (E.regulatorTotal(20, () => rng.next()) <= 20) { openedDay = d; break; }
    }
    await S.BusinessRepository.save({ ...business(), regCase: { ...business().regCase, openedDay } });
    dice.push(10, 10);
    const won = await answer();
    assert.equal(won.ok, true, won.reason);
    assert.equal(won.caseResult.success, true);
    assert.equal(business().regCase, null);
    assert.equal(S.MarketStore.getBusinessesHidden().bus_play.exposure, 10, 'half the Exposure cleared');

    // A fumble with Bribery: the bribe is spent, and the loss waits on the GM as serious.
    await S.BusinessService.openCaseByHand('bus_play');
    await settle();
    const tillBefore = business().till;
    dice.push(1, 10);
    const lost = await answer({ kind: 'skill', skill: 'Bribery', stat: 'cool' });
    assert.equal(lost.caseResult.success, false);
    assert.equal(business().till, tillBefore - E.BUSINESS_DEFAULTS.regulator.bribe, 'the bribe is gone');
    assert.deepEqual([business().regCase.status, business().regCase.fumble, business().regCase.serious], ['lost', true, true]);
    assert.equal((await answer()).reason, 'no-case', 'answered once only');

    // The GM's approval: a changed fine, Compliance, and restated reports.
    const compliance = business().state.compliance;
    const tillNow = business().till;
    assert.equal((await S.BusinessService.approveCaseFine('bus_play', 1234)).ok, true);
    await settle();
    assert.equal(business().till, tillNow - 1234);
    assert.equal(business().state.compliance, Math.max(0, compliance + E.BUSINESS_DEFAULTS.regulator.compliance));
    assert.equal(business().regCase, null);
    assert.ok(S.MarketStore.getNews().items.some((n) => /CaseLost|fine/i.test(n.headline)), 'a listed company\'s news');

    // Silence counts as lost, with no fumble.
    await S.BusinessService.openCaseByHand('bus_play');
    await S.BusinessRepository.save({ ...business(), regCase: { ...business().regCase, endDay: day - 1 } });
    await S.BusinessService._lapseCases();
    assert.deepEqual([business().regCase.status, business().regCase.silent], ['lost', true]);
    assert.equal((await S.BusinessService.dropCaseByHand('bus_play')).ok, true, 'the GM may drop it');
    assert.equal(business().regCase, null);
  } finally {
    SkillAdapter.rollOne = rollOne;
    MailService.fromWire = fromWire;
    await setExposure(0);
    await S.BusinessRepository.save({ ...business(), regCase: null });
  }
});

test('standing: a gig tagged for the business moves its standing with the client; any other gig is the crew\'s and leaves it alone; the band goes on the record and the number stays hidden', async () => {
  const { GigImpactService } = await import('../scripts/services/GigImpactService.js');
  const { FactionRepository } = await import('../scripts/data/FactionRepository.js');
  await FactionRepository.importStarter();
  assert.ok(FactionRepository.get('corp_bio'), 'the starter list is in');
  const approval = env.store.get('gigImpactApproval');
  env.store.set('gigImpactApproval', false);
  const hiddenOf = () => S.MarketStore.getBusinessesHidden().bus_play?.standing ?? {};
  try {
    await S.BusinessRepository.save({ ...business(), standings: {} });
    const hidden = S.MarketStore.getBusinessesHidden();
    await S.MarketStore.setBusinessesHidden({ ...hidden, bus_play: { ...(hidden.bus_play ?? {}), standing: {} } });

    await GigImpactService.report({ gigId: 'crew1', sourceKey: 'gig:crew1', outcome: 'done', client: 'Biotechnica', reward: 2000, title: 'A crew job' });
    await settle();
    assert.deepEqual(hiddenOf(), {}, 'no tag: the crew\'s work, nothing for the business');

    await GigImpactService.report({ gigId: 'biz1', sourceKey: 'gig:biz1', outcome: 'done', client: 'Mr Johnson', reward: 2000, title: 'A contract', notes: '[NCI contract: Playco] [NCI client: Biotechnica]' });
    await settle();
    assert.equal(hiddenOf().corp_bio?.value, E.BUSINESS_DEFAULTS.standing.gig.done * 2, 'tagged: standing with the client');
    assert.equal(business().standings.corp_bio, 'neutral', 'the band on the record');
    assert.equal(JSON.stringify(business().standings).includes('12'), false, 'not the number');

    // A freelance gig with a tagged target: the client up, the target down by half; no business touched.
    const impactsOf = (key) => S.MarketStore.getControls().impacts.filter((i) => i.sourceKey?.startsWith(key));
    await GigImpactService.report({ gigId: 'free1', sourceKey: 'gig:free1', outcome: 'done', client: 'Biotechnica', reward: 2000, title: 'A job', notes: '[NCI target: Militech]' });
    await settle();
    const free = impactsOf('gig:free1');
    assert.deepEqual(free.map((i) => i.target.id).sort(), ['BIO', 'MIL']);
    const bioMove = free.find((i) => i.target.id === 'BIO').amount;
    const milMove = free.find((i) => i.target.id === 'MIL').amount;
    assert.ok(bioMove > 0 && milMove < 0, 'opposite ways');
    assert.ok(Math.abs(milMove) < bioMove, 'the target by less');
    assert.equal(hiddenOf().corp_mil, undefined, 'a freelance gig leaves standing alone');

    // A contract: the listed contractor's own stock, the client's and the target's, and standing with both.
    await GigImpactService.report({ gigId: 'biz2', sourceKey: 'gig:biz2', outcome: 'done', client: 'Kiroshi Optical', reward: 2000, title: 'Contract', notes: '[NCI contract: Playco] [NCI target: Zetatech]' });
    await settle();
    assert.deepEqual(impactsOf('gig:biz2').map((i) => i.target.id).sort(), ['KIR', 'PLAY', 'ZET']);
    assert.ok(hiddenOf().corp_kir.value > 0, 'standing with the client');
    assert.ok(hiddenOf().corp_zet.value < 0, 'and against the target');
    assert.ok(impactsOf('gig:biz2').find((i) => i.target.id === 'PLAY').amount > 0, 'the contractor rises on a success');

    // A gig whose client is the business: its own stock, no standing, and a named target still hit.
    const before = Object.keys(hiddenOf()).length;
    await GigImpactService.report({ gigId: 'own1', sourceKey: 'gig:own1', outcome: 'failed', client: 'Playco', reward: 1000, title: 'Own job', notes: '[NCI target: Network 54]' });
    await settle();
    assert.deepEqual(impactsOf('gig:own1').map((i) => i.target.id).sort(), ['N54', 'PLAY']);
    assert.ok(impactsOf('gig:own1').find((i) => i.target.id === 'N54').amount > 0, 'a failed gig helps its target');
    assert.equal(Object.keys(hiddenOf()).length, before + 1, 'standing only with the target');

    // A target found only in the text waits for the GM even with approval off, and needs their tick.
    await GigImpactService.report({ gigId: 'text1', sourceKey: 'gig:text1', outcome: 'done', client: 'Petrochem', reward: 1000, title: 'Job', desc: 'Sabotage the Orbital Air depot.' });
    await settle();
    const pending = S.MarketStore.getGigs().pending.find((x) => x.sourceKey === 'gig:text1');
    assert.equal(pending?.target?.how, 'text');
    await GigImpactService.approve(pending.id, {});
    await settle();
    assert.deepEqual(impactsOf('gig:text1').map((i) => i.target.id), ['PET'], 'unticked: the client only');

    // A contract tag with a typo: it waits for the GM, as freelance, whatever the approval setting.
    await GigImpactService.report({ gigId: 'typo1', sourceKey: 'gig:typo1', outcome: 'done', client: 'Petrochem', reward: 1000, title: 'Job', notes: '[NCI contract: Playcoo]' });
    await settle();
    assert.equal(S.MarketStore.getGigs().pending.find((x) => x.sourceKey === 'gig:typo1')?.contractUnknown, 'Playcoo');

    // A gang as the client: nothing to map; only its target's price moves, the other way.
    await GigImpactService.report({ gigId: 'gang1', sourceKey: 'gig:gang1', outcome: 'done', client: 'Mr Johnson', reward: 1000, title: 'Job', notes: '[NCI client: Maelstrom] [NCI target: Orbital Air]' });
    await settle();
    assert.equal(S.MarketStore.getGigs().pending.some((x) => x.sourceKey?.startsWith('gig:gang1')), false, 'nothing asks to be mapped');
    const gangMove = impactsOf('gig:gang1');
    assert.deepEqual(gangMove.map((i) => i.target.id), ['ORB']);
    assert.ok(gangMove[0].amount < 0);
    await GigImpactService.report({ gigId: 'gang2', sourceKey: 'gig:gang2', outcome: 'done', client: 'Mr Johnson', reward: 1000, title: 'Job', notes: '[NCI client: Maelstrom]' });
    await settle();
    assert.equal(S.MarketStore.getGigs().pending.some((x) => x.sourceKey === 'gig:gang2'), false);
    assert.deepEqual(impactsOf('gig:gang2'), [], 'a gang with no target: recorded, and nothing moves');

    // The GM's hand, past the weekly limit; a week's fade.
    assert.equal((await S.BusinessService.setStanding('bus_play', 'gang_maelstrom', -70)).ok, true);
    assert.equal(business().standings.gang_maelstrom, 'hostile');
    await S.BusinessService._standingWeek({ business: business(), events: [{ type: 'periodClosed', digest: {} }] });
    assert.equal(hiddenOf().gang_maelstrom.value, -70 + E.BUSINESS_DEFAULTS.standing.drift);
    assert.equal(business().standings.gang_maelstrom, 'hostile');
  } finally {
    env.store.set('gigImpactApproval', approval);
  }
});

test('a listed company in administration is restructured: its debts become creditors\' shares, added to the market and kept through the holders\' sync', async () => {
  const before = { shares: business().listing.shares, outstanding: S.CompanyRepository.get('PLAY').sharesOutstanding };
  await S.BusinessRepository.save({
    ...business(), administration: { since: S.BusinessService.day(), net: -500 }, till: 1000,
    loans: [...(business().loans ?? []), { id: 'loan_test', kind: 'bank', principal: 20000, balance: 20000, rate: 0.01, payment: 1000, startedDay: S.BusinessService.day(), missed: 0 }],
  });
  const out = await S.BusinessService.restructureBusiness('bus_play');
  await settle();
  assert.equal(out.ok, true, out.reason);
  const b = business();
  assert.equal(b.administration, null);
  assert.equal(b.loans.find((l) => l.id === 'loan_test').balance, 0);
  assert.equal(b.listing.shares, before.shares + out.shares);
  assert.equal(S.CompanyRepository.get('PLAY').sharesOutstanding, before.shares + out.shares, 'on the market too');
  // The creditors stay on the record after the holders are read from the portfolios again.
  const synced = E.normalizeBusiness(structuredClone(b));
  S.BusinessService._syncHolders(synced);
  assert.equal(synced.partners.find((x) => x.actorId === 'npc:creditors')?.units, out.shares);
  assert.ok(S.MarketStore.getControls().impacts.some((i) => i.source === 'restructure'), 'the price diluted');
});

test('a listed company worth too little for three reports goes under review; the GM delists it: the float bought back, shares out of portfolios and onto the record, the company private again', async () => {
  const { MailService } = await import('../scripts/services/MailService.js');
  const sent = [];
  const fromWire = MailService.fromWire;
  MailService.fromWire = async (actor, spec) => { sent.push({ actor: actor.id, subject: spec.subject }); return { ok: true }; };
  try {
    S.BusinessService.listingThreshold = () => 1e12;
    // The earlier reports were low at the default threshold too: start the count afresh.
    await S.BusinessRepository.save({ ...business(), listing: { ...business().listing, review: null, lowReports: 0 } });
    for (const index of [20, 21, 22]) {
      await S.BusinessService._afterReports({ business: business(), events: [{ type: 'reportPublished', report: { index, reported: 0, profit: 0, valuation: 0 } }] });
      await settle();
    }
    assert.ok(business().listing.review, 'under review after three low reports');
    assert.ok(sent.some((m) => m.actor === alice.id && /review/i.test(m.subject)), 'the shareholders told');
    assert.ok(S.MarketStore.getControls().impacts.some((i) => i.sourceKey === 'review:bus_play:22'), 'the price dips');
    // The same report again does not count twice.
    await S.BusinessService._afterReports({ business: business(), events: [{ type: 'reportPublished', report: { index: 22, reported: 0, profit: 0, valuation: 0 } }] });
    await settle();
    assert.equal(business().listing.lowReports, 3);

    const aliceHeld = held(alice);
    const bobHeld = held(bob);
    const out = await S.BusinessService.delist('bus_play');
    await settle();
    assert.equal(out.ok, true);
    const b = business();
    assert.equal(b.listing.status, 'delisted');
    assert.deepEqual([held(alice), held(bob)], [0, 0], 'shares out of the portfolios');
    const units = (id) => b.partners.find((x) => x.actorId === id)?.units;
    assert.deepEqual([units(alice.id), units(bob.id)], [aliceHeld, bobHeld], 'and onto the record');
    assert.equal(b.partners.some((x) => x.market), false);
    assert.equal(S.CompanyRepository.get('PLAY').status, 'delisted');
    assert.equal(S.BusinessRepository.stakesOf(alice.id) > 0, true, 'a private stake again');
    assert.ok(sent.some((m) => m.actor === alice.id && /delisted/i.test(m.subject)));
  } finally {
    MailService.fromWire = fromWire;
    delete S.BusinessService.listingThreshold;
  }
});

test('a private company in administration is wound up: the holders are paid what is left in eddies, and it closes', async () => {
  const b0 = business();
  assert.equal(b0.listing.status, 'delisted', 'private again after the delisting');
  await S.BusinessRepository.save({ ...b0, administration: { since: S.BusinessService.day(), net: -1 }, till: 5000, assets: 2000, loans: [] });
  const wealthBefore = alice.system.wealth.value;
  const out = await S.BusinessService.windUpBusiness('bus_play');
  await settle();
  assert.equal(out.ok, true, out.reason);
  assert.equal(business().status, 'closed');
  assert.equal(business().closeReason, 'woundUp');
  assert.ok(out.perShare > 0 && out.left === 5000 + 1000, 'cash plus half the assets, no debts');
  assert.ok(alice.system.wealth.value > wealthBefore, 'paid in eddies');
});

test('at the week\'s close, a faction\'s event lands: a smear on the price, a raid in the Exposure, force on the standing, and standing on the costs', async () => {
  const { FactionRepository } = await import('../scripts/data/FactionRepository.js');
  await FactionRepository.importStarter();
  const saved = structuredClone(business());
  const hiddenSaved = structuredClone(S.MarketStore.getBusinessesHidden());
  const gang = E.turfFactions(FactionRepository.list(), 'ocz')[0];
  // Close one week with this event and these slots.
  const close = async (event, slots = [], extra = {}) => {
    const now = business();
    await S.BusinessRepository.save({
      ...now, status: 'open', stage: 2, district: 'ocz', takeover: null, administration: null, regCase: null, listing: { ...now.listing, status: 'listed', review: null }, till: 500000,
      period: { ...now.period, startDay: S.BusinessService.day() - 7, endDay: S.BusinessService.day(), slots, bonuses: [], helpers: [], event }, ...extra,
    });
    await S.BusinessService.onTick();
    return business().digests.at(-1);
  };
  try {
    const smear = await close({ kind: 'smear', factionId: 'corp_bio', factionName: 'Biotechnica' });
    assert.equal(smear.event.faction, 'Biotechnica');
    const dips = S.MarketStore.getControls().impacts.filter((i) => i.source === 'smear');
    assert.equal(dips.length, 1, 'an unanswered smear dips the price');
    assert.equal(dips[0].amount, E.BUSINESS_DEFAULTS.standing.hostile.smear);

    const exposure = () => S.MarketStore.getBusinessesHidden().bus_play?.exposure ?? 0;
    const before = exposure();
    await close({ kind: 'raid', factionId: 'corp_bio', factionName: 'Biotechnica' });
    assert.equal(exposure(), before + E.BUSINESS_DEFAULTS.standing.hostile.raidExposure, 'a raid not stopped');

    const hidden = S.MarketStore.getBusinessesHidden();
    await S.MarketStore.setBusinessesHidden({ ...hidden, bus_play: { ...hidden.bus_play, standing: {} } });
    const force = { action: 'respond', event: 'shakedown', by: 'x', use: 'ability:Combat Awareness', band: 'solid', total: 20, dv: 15, approach: 'standard', luck: 0, bonus: 0 };
    await close({ kind: 'shakedown', factionId: gang.id, factionName: gang.name }, [force]);
    const standing = S.MarketStore.getBusinessesHidden().bus_play.standing[gang.id];
    assert.equal(standing.value, E.BUSINESS_DEFAULTS.standing.hostile.force, 'force costs standing');

    const allied = await close(null, [], { standings: { [gang.id]: 'allied' } });
    const hostile = await close(null, [], { standings: { [gang.id]: 'hostile' } });
    assert.ok(allied.costs.protection < hostile.costs.protection, `${allied.costs.protection} ${hostile.costs.protection}`);
  } finally {
    await S.BusinessRepository.save(saved);
    await S.MarketStore.setBusinessesHidden(hiddenSaved);
  }
});

test('a campaign waits for the GM on the Pending tab, then reaches the market: news, one impact, heat and standing; stopping it leaves the money spent', async () => {
  const { FactionRepository } = await import('../scripts/data/FactionRepository.js');
  await FactionRepository.importStarter();
  const { waiting } = await import('../scripts/ui/GMConsole/tabs/pending.js');
  const saved = structuredClone(business());
  const hiddenSaved = structuredClone(S.MarketStore.getBusinessesHidden());
  const day = S.BusinessService.day();
  const campaign = { status: 'awaiting', ticker: 'BIO', name: 'Biotechnica', kind: 'leak', percent: -2, actorId: alice.id, day };
  try {
    env.store.set('heatEnabled', true);
    await S.MarketStore.setBusinessesHidden({ ...hiddenSaved, bus_play: { ...hiddenSaved.bus_play, standing: {} } });
    await S.BusinessRepository.save({ ...business(), status: 'open', campaign });
    assert.ok(waiting().businesses >= 1, 'it shows as waiting');
    assert.equal((await S.BusinessService.rejectCampaign('bus_play')).ok, true);
    assert.equal(business().campaign, null);
    assert.equal((await S.BusinessService.approveCampaign('bus_play')).reason, 'no-campaign');

    await S.BusinessRepository.save({ ...business(), campaign });
    assert.equal((await S.BusinessService.approveCampaign('bus_play')).ok, true);
    assert.equal(business().campaign, null);
    const impacts = S.MarketStore.getControls().impacts.filter((i) => i.source === 'campaign');
    assert.equal(impacts.length, 1);
    assert.deepEqual([impacts[0].target.id, impacts[0].meta.percent], ['BIO', -2]);
    await settle();
    assert.ok(JSON.stringify(S.MarketStore.getNews()).includes('NCI.News.Leaked'), 'a generic headline');
    assert.ok(S.MarketStore.getHeat().windows.some((w) => w.sourceKey === impacts[0].sourceKey), 'a heat window');
    assert.equal(S.MarketStore.getBusinessesHidden().bus_play.standing.corp_bio.value, E.BUSINESS_DEFAULTS.campaign.standing, 'standing with a target that is a faction');
  } finally {
    env.store.set('heatEnabled', false);
    await S.BusinessRepository.save(saved);
    await S.MarketStore.setBusinessesHidden(hiddenSaved);
  }
});

test('a Media story: believed, it waits for the GM and reaches the market; refused too soon; evidence helps once', async () => {
  const { StoryService } = await import('../scripts/services/StoryService.js');
  const { SkillAdapter } = await import('../scripts/services/SkillAdapter.js');
  const { waiting } = await import('../scripts/ui/GMConsole/tabs/pending.js');
  const { installFakeItems } = await import('./helpers/fakeItems.mjs');
  installFakeItems().prepare(alice);
  const baseFor = SkillAdapter.baseFor;
  const rollOne = SkillAdapter.rollOne;
  const rolls = [];
  SkillAdapter.baseFor = (actor, use) => (use.ability === 'Credibility' && actor.id === alice.id ? { base: 5, name: 'Credibility', parts: 'Credibility 5' } : baseFor.call(SkillAdapter, actor, use));
  SkillAdapter.rollOne = async () => ({ value: rolls.shift() ?? 10, roll: null });
  const storiesSaved = S.MarketStore.getStories();
  env.store.set('heatEnabled', true);
  try {
    await S.MarketStore.setStories({ pending: [], recent: [] });
    assert.equal(StoryService.rankOf(alice), 5);
    assert.equal((await StoryService.publish(bob, { ticker: 'ORB', angle: 'expose' })).reason, 'not-media');

    rolls.push(1);
    const out = await StoryService.publish(alice, { ticker: 'ORB', angle: 'expose', headline: 'Orbital hides a crash' });
    assert.deepEqual(out, { ok: true, story: { believed: true, die: 1, target: 4, waiting: true } });
    const [story] = StoryService.pending();
    assert.equal(story.percent, -7, 'the whole of rank 5\'s limit at a margin of 3');
    assert.ok(waiting().events >= 1, 'it shows as waiting');
    assert.equal(S.MarketStore.getControls().impacts.filter((i) => i.source === 'story').length, 0, 'not yet');
    assert.equal((await StoryService.approve(story.id)).ok, true);
    assert.equal(StoryService.pending().length, 0);
    await settle();
    const impact = S.MarketStore.getControls().impacts.find((i) => i.source === 'story');
    assert.deepEqual([impact.target.id, impact.meta.percent], ['ORB', -7]);
    assert.ok(JSON.stringify(S.MarketStore.getNews()).includes('NCI.News.StoryBy'), 'a headline under the Media\'s name');
    assert.ok(S.MarketStore.getHeat().windows.some((w) => w.sourceKey === impact.sourceKey && w.runners.includes(alice.id)));
    assert.equal((await StoryService.approve(story.id)).reason, 'no-story');

    assert.equal((await StoryService.publish(alice, { ticker: 'BIO', angle: 'puff' })).reason, 'story-wait', 'once a week');

    const granted = await StoryService.grantEvidence(alice, { ticker: 'BIO', name: 'Biotechnica', note: 'Lab notes' });
    assert.equal(granted.ok, true);
    assert.equal(StoryService.evidenceOf(alice, 'BIO').length, 1);
    assert.equal(StoryService.evidenceOf(alice, 'ARA').length, 0, 'about that company only');
    await S.MarketStore.setStories({ pending: [], recent: [{ actorId: bob.id, ticker: 'BIO', day: S.BusinessService.day() }] });
    assert.equal((await StoryService.publish(alice, { ticker: 'BIO', angle: 'puff' })).reason, 'story-same-topic');
    rolls.push(5);
    const backed = await StoryService.publish(alice, { ticker: 'BIO', angle: 'puff', evidence: [granted.item.id] });
    assert.deepEqual([backed.story.target, backed.story.believed], [5, true], 'the evidence raised it to 5');
    assert.equal(StoryService.pending()[0].percent, 4.2);
    assert.equal(StoryService.evidenceOf(alice, 'BIO').length, 0, 'used, and still in the inventory');
    assert.ok([...alice.items].some((i) => i.id === granted.item.id));
    assert.equal((await StoryService.reject(StoryService.pending()[0].id)).ok, true);
    assert.equal(StoryService.pending().length, 0);

    await S.MarketStore.setStories({ pending: [], recent: [] });
    rolls.push(10);
    assert.equal((await StoryService.publish(alice, { ticker: 'ARA', angle: 'expose' })).story.believed, false);
    assert.equal(StoryService.pending().length, 0, 'not believed: nothing to approve');

    // Rumours: a queued move someone else caused, heard at a level by rank + die, once in each stretch of days.
    await S.MarketStore.setStories({ pending: [], recent: [] });
    await S.TickService.updateControls((controls, { tick }) => ({ ...controls, impacts: [...controls.impacts.filter((i) => i.source !== 'story'), E.makeImpact({ id: 'imp_r', target: { type: 'company', id: 'KEN' }, amount: -0.02, onsetTick: tick + 5, permanent: 1, sourceKey: 'gig:rumour', source: 'gig', meta: {} })] }));
    const { HeatService } = await import('../scripts/services/HeatService.js');
    await HeatService.openWindow({ sourceKey: 'gig:rumour', companyId: 'KEN', outcome: 'failed', date: '2045-01-01', delayDays: 5 }, {});
    assert.ok(StoryService.rumourSources('KEN').some((r) => r.sourceKey === 'gig:rumour' && !r.up && r.days >= 1));
    assert.deepEqual(StoryService.rumourSources('ZZZ'), []);
    rolls.push(10);
    await StoryService.onTick();
    await settle();
    const heardOn = S.MarketStore.getStories().rumours[alice.id];
    assert.ok(heardOn.heard != null);
    assert.equal(heardOn.told['gig:rumour'] ?? Object.values(heardOn.told)[0], 3, 'rank 5 + 10 is the most it says');
    if (heardOn.told['gig:rumour'] != null) assert.ok(S.MarketStore.getHeat().windows.find((w) => w.sourceKey === 'gig:rumour').tipped.includes(alice.id), 'they count as tipped');
    rolls.push(10);
    await StoryService.onTick();
    assert.deepEqual(S.MarketStore.getStories().rumours[alice.id], heardOn, 'not again so soon');
    assert.match(StoryService._rumourText({ kind: 'move', name: 'Kendachi', ticker: 'KEN', percent: 2, days: 3, up: false, why: 'gig' }, 3), /NCI\.Rumour\.move\.detailed/);
    assert.equal((await StoryService.digRumours(bob, { ticker: 'KEN', use: { kind: 'skill', skill: 'Streetwise', stat: 'cool' } })).reason, 'not-media');
    assert.equal((await StoryService.digRumours(alice, { ticker: 'KEN', use: { kind: 'skill', skill: 'Handgun', stat: 'ref' } })).reason, 'bad-use');
    rolls.push(10);
    await StoryService.publish(alice, { ticker: 'CON', angle: 'puff' });
    assert.deepEqual(S.MarketStore.getStories().rumours[alice.id], heardOn, 'publishing a story keeps what they have heard');
  } finally {
    SkillAdapter.baseFor = baseFor;
    SkillAdapter.rollOne = rollOne;
    env.store.set('heatEnabled', false);
    await S.MarketStore.setStories(storiesSaved);
  }
});

test('a big event as a scene: run, then lost, with what it leaves behind; run again, then won', async () => {
  const saved = structuredClone(business());
  const hiddenSaved = structuredClone(S.MarketStore.getBusinessesHidden());
  const raid = { kind: 'raid', factionId: 'corp_bio', factionName: 'Biotechnica' };
  try {
    const setUp = () => S.BusinessRepository.save({ ...business(), status: 'open', scene: null, digests: [{ index: 1, takings: 1000 }], state: { ...business().state, compliance: 50 }, period: { ...business().period, slots: [], event: raid } });
    await setUp();
    assert.equal((await S.BusinessService.runScene('bus_play')).ok, true);
    assert.equal(business().scene.event.kind, 'raid');
    assert.equal(business().period.event, null);
    assert.equal((await S.BusinessService.runScene('bus_play')).reason, 'no-scene');

    const exposure = S.MarketStore.getBusinessesHidden().bus_play?.exposure ?? 0;
    const till = business().till;
    assert.equal((await S.BusinessService.settleScene('bus_play', false)).ok, true);
    assert.equal(business().scene, null);
    assert.equal(business().till, till - 150);
    assert.equal(S.MarketStore.getBusinessesHidden().bus_play.exposure, exposure + E.BUSINESS_DEFAULTS.standing.hostile.raidExposure, 'the raid\'s Exposure reaches the hidden state');

    await setUp();
    assert.equal((await S.BusinessService.runScene('bus_play')).ok, true);
    const reputation = business().state.reputation;
    assert.equal((await S.BusinessService.settleScene('bus_play', true)).ok, true);
    assert.equal(business().state.reputation, reputation + E.BUSINESS_DEFAULTS.scene.wonReputation);

    await setUp();
    assert.equal((await S.BusinessService.runScene('bus_play')).ok, true);
    assert.equal((await S.BusinessService.sceneToRoll('bus_play')).ok, true);
    assert.equal(business().period.event.kind, 'raid');
  } finally {
    await S.BusinessRepository.save(saved);
    await S.MarketStore.setBusinessesHidden(hiddenSaved);
  }
});

test('a Lawman calls in a favour: heat down and penalties dropped; a miss still costs; a month between; a fumble adds heat', async () => {
  const { SkillAdapter } = await import('../scripts/services/SkillAdapter.js');
  const { HeatService } = await import('../scripts/services/HeatService.js');
  const baseFor = SkillAdapter.baseFor;
  const verifyLevers = SkillAdapter.verifyLevers;
  const { MODULE_ID, FLAGS } = await import('../scripts/utils/constants.js');
  const heatSaved = S.MarketStore.getHeat();
  const rolled = { band: 'solid' };
  SkillAdapter.baseFor = (actor, use) => (use.ability === 'Backup' && actor.id === cass.id ? { base: 4, name: 'Backup', parts: 'Backup 4' } : baseFor.call(SkillAdapter, actor, use));
  SkillAdapter.verifyLevers = async () => ({ ok: true, result: { ...rolled } });
  env.store.set('heatEnabled', true);
  const quash = (actor) => S.BusinessService._quash(actor, { key: `q${Math.random()}` });
  const heatOf = () => HeatService.heatOf(cass.id);
  try {
    await S.MarketStore.setHeat({ ...heatSaved, penalties: [{ id: 'hq', actorId: cass.id, name: 'Cass', kind: 'fine', params: { amount: 10 }, status: 'pending' }, { id: 'hq2', actorId: bob.id, name: 'Bob', kind: 'fine', params: { amount: 10 }, status: 'pending' }] });
    await HeatService.setHeat(cass.id, 60);
    await cass.unsetFlag?.(MODULE_ID, FLAGS.QUASHED);
    assert.equal((await quash(bob)).reason, 'not-lawman');
    const wealth = cass.system.wealth.value;
    assert.deepEqual(await quash(cass), { ok: true, quash: { outcome: 'success' } });
    await settle();
    const rules = E.BUSINESS_DEFAULTS.roles.quash;
    assert.equal(cass.system.wealth.value, wealth - rules.cost);
    assert.ok(heatOf() <= 60 - rules.reduce + 1, `heat ${heatOf()}`);
    const statusOf = (id) => S.MarketStore.getHeat().penalties.find((p) => p.id === id).status;
    assert.equal(statusOf('hq'), 'dismissed');
    assert.equal(statusOf('hq2'), 'pending', 'someone else\'s stays');
    assert.equal((await quash(cass)).reason, 'quash-wait');

    await cass.unsetFlag?.(MODULE_ID, FLAGS.QUASHED);
    rolled.band = 'fumble';
    const before = heatOf();
    assert.equal((await quash(cass)).quash.outcome, 'fumble');
    await settle();
    assert.ok(heatOf() > before, 'it makes things worse');
  } finally {
    SkillAdapter.baseFor = baseFor;
    SkillAdapter.verifyLevers = verifyLevers;
    env.store.set('heatEnabled', false);
    await cass.unsetFlag?.(MODULE_ID, FLAGS.QUASHED);
    await S.MarketStore.setHeat(heatSaved);
  }
});

test('a raid on a back room reaches the owners and their heat, and a tick passes the hidden Exposure on', async () => {
  const { HeatService } = await import('../scripts/services/HeatService.js');
  const saved = structuredClone(business());
  const hiddenSaved = structuredClone(S.MarketStore.getBusinessesHidden());
  env.store.set('heatEnabled', true);
  try {
    const day = S.BusinessService.day();
    const before = HeatService.heatOf(alice.id);
    await S.BusinessRepository.save({ ...business(), status: 'open', stage: 1, listing: null, company: null, officers: [], backRoom: { kind: 'ripping', status: 'open', dirty: 800 }, till: 500000, takeover: null, administration: null, regCase: null, period: { ...business().period, startDay: day - 7, endDay: day, slots: [], bonuses: [], helpers: [], event: { kind: 'bust' } } });
    await S.BusinessService.onTick();
    await settle();
    assert.equal(business().backRoom.status, 'shut');
    assert.equal(business().backRoom.dirty, 0);
    assert.ok(HeatService.heatOf(alice.id) > before, 'heat for the partners');
    assert.equal(business().status, 'open');
  } finally {
    env.store.set('heatEnabled', false);
    await S.BusinessRepository.save(saved);
    await S.MarketStore.setBusinessesHidden(hiddenSaved);
  }
});

test('crime at a listed company is a scandal; black ops traced back also open a case; a held gang does not fade', async () => {
  const saved = structuredClone(business());
  const hiddenSaved = structuredClone(S.MarketStore.getBusinessesHidden());
  const { FactionRepository } = await import('../scripts/data/FactionRepository.js');
  await FactionRepository.importStarter();
  const dips = () => S.MarketStore.getControls().impacts.filter((i) => i.source === 'scandal');
  const before = dips().length;
  try {
    const listed = { ...business(), status: 'open', stage: 2, listing: { ...business().listing, status: 'listed' }, regCase: null, takeover: null, administration: null };
    await S.BusinessRepository.save(listed);
    const b = E.normalizeBusiness(structuredClone(business()));
    await S.BusinessService._factionEvents({ business: b, events: [{ type: 'crimeScandal', percent: -3, key: 'test1' }] });
    await settle();
    assert.equal(dips().length, before + 1);
    assert.equal(dips().at(-1).meta.percent, -3);
    assert.ok(JSON.stringify(S.MarketStore.getNews()).includes('NCI.News.Scandal'));
    await S.BusinessService._factionEvents({ business: b, events: [{ type: 'campaignCaught', ticker: 'BIO', blackOps: true, exposure: 15 }] });
    await settle();
    assert.equal(dips().length, before + 2);
    assert.equal(dips().at(-1).meta.percent, E.BUSINESS_DEFAULTS.crime.scandal.caught);
    assert.equal(business().regCase?.reason, 'blackOps');

    const unlisted = E.normalizeBusiness({ ...structuredClone(business()), listing: null });
    await S.BusinessService._scandal(unlisted, -3, 'unlisted');
    assert.equal(dips().length, before + 2, 'an unlisted company has no price to dip');

    const hidden = S.MarketStore.getBusinessesHidden();
    await S.MarketStore.setBusinessesHidden({ ...hidden, bus_play: { ...hidden.bus_play, standing: { gang_maelstrom: { value: 30 }, corp_bio: { value: 30 } } } });
    await S.BusinessRepository.save({ ...business(), backRoom: { kind: 'ripping', status: 'open', dirty: 0, deal: { factionId: 'gang_maelstrom', name: 'Maelstrom', cut: 0.25, cash: 1 } } });
    await S.BusinessService._standingWeek({ business: business(), events: [{ type: 'periodClosed' }] });
    const standing = S.MarketStore.getBusinessesHidden().bus_play.standing;
    assert.equal(standing.gang_maelstrom.value, 30, 'the gang holds steady');
    assert.ok(standing.corp_bio.value < 30, 'others fade');
  } finally {
    await S.BusinessRepository.save(saved);
    await S.MarketStore.setBusinessesHidden(hiddenSaved);
  }
});
