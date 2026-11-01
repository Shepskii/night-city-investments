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
    const first = await dig();
    assert.equal(first.ok, true, first.reason);
    assert.equal(first.investigation.success, true, `a 9 beats the shell's 6 (${first.investigation.band})`);
    assert.ok(sent.some((m) => m.actor === cass.id && m.lines.join(' ').includes('Vex')), 'told of the nominee behind it');
    assert.equal(sent.some((m) => m.actor === bob.id), false, 'bob is not told');
    const found = cass.getFlag('night-city-investments', 'discoveries')[0].ref_out;
    assert.ok(found.length === 1 && found[0].includes('Vex'), `kept on her character for her windows (${found})`);
    assert.equal(/DV \d/.test(chats.at(-1).content), false, 'the card shows no DV');

    dice.push(9);
    assert.equal((await dig()).reason, 'investigate-wait', 'once a week');
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
