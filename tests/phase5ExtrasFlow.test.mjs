import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const DAY = 86_400_000;
const env = installFakeFoundry({ actors: [['Alice', 90000, true], ['Bob', 90000, true], ['Fixer', 0, false]] });
const [alice, bob, fixer] = env.actors;
env.store.set('directOrderExecution', 'instant');

fixer.system.stats = { int: { value: 6 } };
fixer.items = [{ type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } }];

const contacts = [];
const sent = [];
globalThis.game.nightcity = {
  masterContactService: {
    filterByTag: (t) => contacts.filter((c) => c.tags.includes(t)),
    getContact: (id) => contacts.find((c) => c.id === id) ?? null,
    getByActorId: (id) => contacts.find((c) => c.actorId === id) ?? null,
    getAll: () => contacts,
    addContact: async (d) => {
      const c = { id: `c_${contacts.length}`, email: `${contacts.length}@x`, tags: [], ...d };
      contacts.push(c);
      return { success: true, contact: c };
    },
    updateContact: async (id, u) => { Object.assign(contacts.find((c) => c.id === id), u); return { success: true }; },
  },
  messageService: {
    sendMessage: async (m) => {
      sent.push({ id: `m${sent.length}`, ...m });
      return { success: true, messageId: `m${sent.length}` };
    },
  },
  messageRepository: { getMessage: async () => null },
  networkService: { isOnNetwork: () => false },
};
globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
game.users.filter = () => [];

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
    FundService: (await load('../scripts/services/FundService.js')).FundService,
    MarketControlService: (await load('../scripts/services/MarketControlService.js')).MarketControlService,
    NotificationService: (await load('../scripts/services/NotificationService.js')).NotificationService,
    BrokerRepository: (await load('../scripts/data/BrokerRepository.js')).BrokerRepository,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  (await load('../scripts/init/registerBrokerSystem.js')).registerBrokerSystem(init);
  await init.runPhase('init');

  await S.ImportService.importStarter();
  await S.FundService.importStarter();
  await S.TickService.syncCompanies();
});

const settle = async () => {
  for (let i = 0; i < 8; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue]) await q;
  }
};

const pf = (a) => S.PortfolioRepository.get(a);
const res = (a, key) => pf(a).results.find((r) => r.key === key);
const pub = () => S.MarketStore.getPublic();
const mails = (a, text) => sent.filter((m) => m.toActorId === a.id && m.subject.includes(text));
const held = (a, id) => pf(a).lots.filter((l) => l.assetId === id).reduce((s, l) => s + l.qty, 0);

test('setup: both investors hold ARA, and the funds have noted their periods', async () => {
  for (const a of [alice, bob]) {
    await S.PortfolioClient.submit(a, 'deposit', { amount: 30000 });
    await settle();
    const k = await S.PortfolioClient.submit(a, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 20, orderType: 'market', expiry: 'day' });
    await settle();
    assert.equal(res(a, k).ok, true);
  }
  await S.TickService.advance(1);
  await settle();
  assert.equal(pub().funds.SAFE.distKey, '2045-Q1');
  assert.equal(pub().funds.CHRM.rebalanceKey, '2045-03');
  assert.equal(pub().funds.NC12.distKey ?? null, null, 'accumulating funds record no distribution period');
});

test('with a settlement delay, sale proceeds arrive later and cannot be spent meanwhile', async () => {
  env.store.set('settlementDays', 2);
  const cash0 = pf(alice).cash;
  const k = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'sell', assetId: 'ARA', qty: 5, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(res(alice, k).ok, true);
  assert.equal(held(alice, 'ARA'), 15);
  assert.equal(pf(alice).cash, cash0, 'cash has not moved');
  assert.equal(pf(alice).unsettled.length, 1);
  const owed = pf(alice).unsettled[0].amount;
  assert.ok(owed > 1000);

  const kb = await S.PortfolioClient.submit(alice, 'withdraw', { amount: cash0 + 10 });
  await settle();
  assert.equal(res(alice, kb).reason, 'insufficient-balance', 'cannot withdraw money that is still settling');
  assert.equal(pf(alice).cash, cash0);

  await S.TickService.advance(1);
  await settle();
  assert.equal(pf(alice).unsettled.length, 1, 'one day is not enough');
  await S.TickService.advance(1);
  await settle();
  assert.equal(pf(alice).unsettled.length, 0);
  assert.equal(pf(alice).cash, cash0 + owed, 'released');
  env.store.set('settlementDays', 0);
});

test('a fund\'s redemption delay holds the seller\'s money even with no market-wide delay', async () => {
  await S.BrokerRepository.makeBrokerFromActor(fixer.id);
  await S.PortfolioClient.setBroker(alice, S.BrokerRepository.list()[0].id);
  await settle();

  const kb = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'broker', side: 'buy', assetId: 'CHRM', qty: 6, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(res(alice, kb).ok, true);
  await S.TickService.advance(4);
  await settle();
  assert.equal(held(alice, 'CHRM'), 6);

  const ks = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'broker', side: 'sell', assetId: 'CHRM', qty: 4, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(res(alice, ks).ok, true);
  const cash0 = pf(alice).cash;
  let order = pf(alice).orders.find((o) => o.id === `o_${ks}`);
  for (let i = 0; i < 6 && order.status === 'open'; i++) {
    await S.TickService.advance(1);
    await settle();
    order = pf(alice).orders.find((o) => o.id === `o_${ks}`);
  }
  assert.equal(order.status, 'filled');

  const slot = pf(alice).unsettled.find((u) => u.assetId === 'CHRM');
  assert.ok(slot, 'the proceeds are settling, not in cash');
  assert.equal(slot.releaseTick - order.filledTick, 2, 'two days after the sale');
  assert.equal(pf(alice).cash, cash0, 'not spendable yet');
  assert.ok(mails(alice, 'Filled.Subject').some((m) => m.body.includes('Filled.Settles')), 'the broker says when the money arrives');
  await S.TickService.advance(2);
  await settle();
  assert.equal(pf(alice).unsettled.some((u) => u.assetId === 'CHRM'), false);
  assert.ok(pf(alice).cash > cash0, 'and it arrives');
  assert.equal(held(alice, 'CHRM'), 2);
});

test('big movers in your holdings are mailed to those who opted in', async () => {
  await S.PortfolioClient.setNotify(alice, 'movers', 'mail');
  await S.PortfolioClient.setMoverPct(alice, 5);
  await settle();
  assert.equal(S.NotificationService.moverPct(alice), 5);
  assert.equal(S.NotificationService.moverPct(bob), 5, 'the default');

  const price = pub().companies.ARA.price;
  assert.equal(await S.MarketControlService.addGlide({ companyId: 'ARA', target: Math.round(price * 1.18 * 100) / 100, days: 1, noise: 'low' }), true);
  await settle();
  await S.TickService.advance(1);
  await settle();

  const m = mails(alice, 'Movers.Subject');
  assert.equal(m.length, 1);
  assert.ok(m[0].body.includes('Movers.Mover'));
  assert.equal(mails(bob, 'Movers.Subject').length, 0, 'Bob has not opted in');

  // Daily noise is random, so a high threshold stands in for a quiet day.
  await S.PortfolioClient.setMoverPct(alice, 25);
  await settle();
  await S.TickService.advance(1);
  await settle();
  assert.equal(mails(alice, 'Movers.Subject').length, 1, 'a quiet day sends nothing');
});

test('a distributing fund pays its income out as cash once a quarter', async () => {
  const kb = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'broker', side: 'buy', assetId: 'SAFE', qty: 10, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(res(alice, kb).ok, true);
  await S.TickService.advance(4);
  await settle();
  assert.equal(held(alice, 'SAFE'), 10);
  const navBefore = pub().funds.SAFE.nav;

  await S.TickService.advance(60);
  await settle();
  assert.ok(pub().funds.SAFE.owed > 0.2, `income has been set aside: ${pub().funds.SAFE.owed}`);
  assert.equal(pub().funds.SAFE.lastDist ?? null, null, 'but nothing is paid mid-quarter');
  assert.ok(navBefore > 0);

  const cash0 = pf(alice).cash;
  const ledgerBefore = pf(alice).ledger.length;
  const mailsBefore = mails(alice, 'Dividend.Subject').length;
  env.clock.ms += 120 * DAY;
  await S.TickService.advance(1);
  await settle();

  const dist = pub().funds.SAFE.lastDist;
  assert.ok(dist && dist.perUnit > 0.2, `a distribution was fixed: ${JSON.stringify(dist)}`);
  assert.equal(dist.key, '2045-Q3');
  const paid = pf(alice).ledger.filter((e) => e.kind === 'dividend' && e.assetId === 'SAFE');
  assert.equal(paid.length, 1);
  assert.equal(paid[0].amount, Math.round(10 * dist.perUnit));
  // The date jump also paid ARA's scheduled dividend, so add up everything that came in.
  const income = pf(alice).ledger.slice(ledgerBefore).filter((e) => e.kind === 'dividend').reduce((s, e) => s + e.amount, 0);
  assert.equal(pf(alice).cash, cash0 + income, 'paid as cash');
  assert.equal(pf(bob).ledger.some((e) => e.assetId === 'SAFE'), false, 'only holders are paid');
  assert.ok(S.MarketStore.getNews().items.some((n) => n.headline.includes('FundDistribution')), 'announced');
  assert.ok(mails(alice, 'Dividend.Subject').length > mailsBefore, 'and mailed like any dividend');

  await S.TickService.advance(2);
  await settle();
  assert.equal(pf(alice).ledger.filter((e) => e.kind === 'dividend' && e.assetId === 'SAFE').length, 1, 'never paid twice');
  assert.equal(pub().funds.SAFE.lastDist.key, '2045-Q3');
});

test('a fund distribution and a stock dividend on the same tick both keep their records', async () => {
  // The quarter jump above paid ARA's dividend and SAFE's distribution on one tick. Both services
  // write the dividend records, so neither may write back a copy it read before the other wrote.
  const records = S.MarketStore.getDividendRecords();
  assert.equal(records.SAFE?.lastKey, 'dist-2045-Q3', 'the distribution is recorded');
  assert.ok(records.ARA?.lastKey, 'and so is the dividend');
  const headlines = S.MarketStore.getNews().items.filter((n) => n.headline.includes('FundDistribution'));
  assert.equal(headlines.length, 1, 'the distribution is announced once');
});
