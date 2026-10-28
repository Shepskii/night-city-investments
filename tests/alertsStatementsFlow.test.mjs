import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { daysUntil } from './helpers/marketDate.mjs';

const DAY = 86_400_000;
const env = installFakeFoundry({ actors: [['Alice', 90000, true], ['Bob', 90000, true], ['Fixer', 0, false]] });
const [alice, bob, fixer] = env.actors;
env.store.set('directOrderExecution', 'instant');

fixer.system.stats = { int: { value: 6 } };
fixer.items = [{ type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } }];

// A fake Night City Messenger.
const contacts = [];
const sent = [];
const mailbox = new Map();
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
      const message = { id: `m${sent.length}`, ...m };
      sent.push(message);
      mailbox.set(message.id, message);
      return { success: true, messageId: message.id };
    },
  },
  messageRepository: { getMessage: async (inbox, id) => mailbox.get(id) ?? null },
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
    UndoService: (await load('../scripts/services/UndoService.js')).UndoService,
    BrokerRepository: (await load('../scripts/data/BrokerRepository.js')).BrokerRepository,
    FundRepository: (await load('../scripts/data/FundRepository.js')).FundRepository,
    CompanyRepository: (await load('../scripts/data/CompanyRepository.js')).CompanyRepository,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    engine: await load('../scripts/engine/index.js'),
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
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, (await import('../scripts/init/registerTickSequence.js')).TickSequence._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue]) await q;
  }
};

const pf = (actor) => S.PortfolioRepository.get(actor);
const res = (actor, key) => pf(actor).results.find((r) => r.key === key);
const price = (id) => S.MarketStore.getPublic().companies[id].price;
const mailsTo = (actor, text) => sent.filter((m) => m.toActorId === actor.id && m.subject.includes(text));

test('setup: both investors hold some stock', async () => {
  for (const a of [alice, bob]) {
    await S.PortfolioClient.submit(a, 'deposit', { amount: 30000 });
    await settle();
    const k = await S.PortfolioClient.submit(a, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 10, orderType: 'market', expiry: 'day' });
    await settle();
    assert.equal(res(a, k).ok, true);
  }
  await S.TickService.advance(1);
  await settle();
  assert.equal(pf(alice).statement.monthKey, '2045-03', 'the first tick records a statement baseline');
  assert.equal(mailsTo(alice, 'Statement.Subject').length, 0, 'and sends nothing');
});

test('price alerts fire after a tick, are mailed unless switched off, and are logged either way', async () => {
  await S.PortfolioClient.setNotify(bob, 'alerts', 'off');
  await settle();
  const p0 = price('ARA');
  const ka = await S.PortfolioClient.setAlert(alice, { assetId: 'ARA', kind: 'above', value: Math.round(p0 * 1.15), once: true });
  const kb = await S.PortfolioClient.setAlert(bob, { assetId: 'ARA', kind: 'above', value: Math.round(p0 * 1.15), once: false });
  const kc = await S.PortfolioClient.setAlert(alice, { assetId: 'ARA', kind: 'below', value: Math.round(p0 * 0.5) });
  const kd = await S.PortfolioClient.setAlert(alice, { assetId: 'ARA', kind: 'above', value: 10 });
  await settle();
  assert.equal(res(alice, ka).ok && res(bob, kb).ok && res(alice, kc).ok, true);
  assert.equal(res(alice, kd).reason, 'alert-already-met');
  assert.equal(pf(alice).alerts.length, 2);

  await S.TickService.advance(1);
  await settle();
  assert.equal(pf(alice).alerts.length, 2, 'nothing has crossed yet');
  assert.equal(mailsTo(alice, 'Alert.Subject').length, 0);

  await S.CorporateActionService.setPrice('ARA', Math.round(p0 * 1.3));
  await settle();
  await S.TickService.advance(1);
  await settle();

  assert.equal(pf(alice).alerts.length, 1, 'the once alert is spent, the other remains');
  assert.equal(pf(alice).alertLog.length, 1);
  assert.equal(pf(alice).alertLog[0].assetId, 'ARA');
  assert.equal(mailsTo(alice, 'Alert.Subject').length, 1, 'mailed');
  assert.equal(sent.find((m) => m.subject.includes('Alert.Subject')).fromContactId, contacts.find((c) => c.tags.includes('market-wire')).id, 'from the market wire');

  assert.equal(pf(bob).alertLog.length, 1, 'Bob switched the channel off but still has the record');
  assert.equal(mailsTo(bob, 'Alert.Subject').length, 0);
  assert.equal(pf(bob).alerts[0].armed, false, 'his repeating alert waits to reset');

  const before = mailsTo(bob, 'Alert.Subject').length + mailsTo(alice, 'Alert.Subject').length;
  await S.TickService.advance(2);
  await settle();
  assert.equal(mailsTo(bob, 'Alert.Subject').length + mailsTo(alice, 'Alert.Subject').length, before, 'no repeat while it stays above');

  await S.PortfolioClient.removeAlert(alice, pf(alice).alerts[0].id);
  await settle();
  assert.equal(pf(alice).alerts.length, 0);
});

test('a statement can be requested, from the wire or from a broker, or mailed to the broker', async () => {
  let before = mailsTo(alice, 'Statement.Subject').length;
  const k = await S.PortfolioClient.requestStatement(alice);
  await settle();
  assert.equal(res(alice, k).ok, true);
  const first = mailsTo(alice, 'Statement.Subject');
  assert.equal(first.length, before + 1);
  assert.equal(first.at(-1).fromContactId, contacts.find((c) => c.tags.includes('market-wire')).id, 'no broker: from the wire');
  assert.ok(first.at(-1).body.includes('Statement.Position'), 'it lists the holdings');
  assert.equal(pf(alice).statement.monthKey, '2045-03', 'asking does not move the monthly baseline');

  await S.BrokerRepository.makeBrokerFromActor(fixer.id);
  const brokerId = S.BrokerRepository.list()[0].id;
  await S.PortfolioClient.setBroker(alice, brokerId);
  await settle();
  before = mailsTo(alice, 'Statement.Subject').length;
  await S.PortfolioClient.requestStatement(alice);
  await settle();
  assert.equal(mailsTo(alice, 'Statement.Subject').at(-1).fromContactId, brokerId, 'with a broker: from the broker');

  mailbox.set('player_1', { id: 'player_1', subject: 'STATEMENT', body: '' });
  env.callAll('night-city-messenger.message:sent', { messageId: 'player_1', toContactId: brokerId, toActorId: null, fromActorId: alice.id, subject: 'STATEMENT' });
  await settle();
  assert.equal(mailsTo(alice, 'Statement.Subject').length, before + 2, 'mailing STATEMENT to the broker gets one too');
});

test('a new month sends monthly statements to those who opted in, and rebalances funds', async () => {
  await S.PortfolioClient.setNotify(alice, 'statements', 'mail');
  await settle();

  const fund = S.FundRepository.get('NC12');
  assert.equal(fund.rebalance, 'quarterly');
  assert.ok(fund.targets && Math.abs(Object.values(fund.targets).reduce((s, v) => s + v, 0) - 1) < 1e-3, 'targets were recorded when it was created');
  assert.equal(S.MarketStore.getPublic().funds.NC12.rebalanceKey, '2045-Q1', 'its period was noted on the first tick');
  const drift = S.engine.fundComposition(fund, Object.fromEntries(Object.entries(S.MarketStore.getPublic().companies).map(([id, c]) => [id, c.price])));
  const worst = Math.max(...drift.map((c) => Math.abs(c.share - fund.targets[c.companyId])));
  assert.ok(worst > 0.005, `ARA's jump has pushed the fund off its mix (${worst})`);

  const alicePrev = mailsTo(alice, 'Statement.Subject').length;
  const prevState = S.MarketStore.getPublic().funds.NC12;
  // Run the market to the first of April: a new month and a new quarter.
  await S.TickService.advanceDays(await daysUntil(2045, 4, 1));
  await settle();
  const undoAfterRebalance = S.UndoService.available();
  assert.equal(mailsTo(alice, 'Statement.Subject').length, alicePrev + 1, 'Alice opted in and gets last month\'s statement');
  assert.equal(mailsTo(bob, 'Statement.Subject').length, 0, 'Bob did not');
  assert.equal(pf(alice).statement.monthKey, '2045-04');
  assert.equal(pf(bob).statement.monthKey, '2045-04', 'the baseline moves for everyone');
  const monthly = mailsTo(alice, 'Statement.Subject').at(-1);
  assert.equal(monthly.fromContactId, S.BrokerRepository.list()[0].id, 'from her broker');

  await S.TickService.advance(1);
  await settle();
  assert.equal(mailsTo(alice, 'Statement.Subject').length, alicePrev + 1, 'only one a month');

  // Fund rebalance.
  const after = S.FundRepository.get('NC12');
  const pub = S.MarketStore.getPublic();
  const prices = Object.fromEntries(Object.entries(pub.companies).map(([id, c]) => [id, c.price]));
  assert.equal(pub.funds.NC12.rebalanceKey, '2045-Q2');
  for (const c of S.engine.fundComposition(after, prices)) {
    assert.ok(Math.abs(c.share - after.targets[c.companyId]) < 0.02, `${c.companyId} is back near its target`);
  }
  assert.notDeepEqual(after.components, fund.components, 'the holdings were re-weighted');
  assert.equal(S.FundRepository.get('ARMS').rebalance, 'none');
  assert.equal(S.MarketStore.getPublic().funds.ARMS.rebalanceKey ?? null, null, 'funds that never rebalance record nothing');
  assert.equal(undoAfterRebalance, false, 'a rebalance changes a definition, so that tick cannot be undone');
  assert.ok(prevState.nav > 0);
});

test('a rebalance does not move the NAV: it equals what the old holdings would have given', async () => {
  // Run to the eve of the next quarter, then compare its first tick with the same tick run on the old holdings.
  await S.TickService.advanceDays(await daysUntil(2045, 6, 30));
  await settle();
  const before = S.FundRepository.get('NC12');
  const prevState = S.MarketStore.getPublic().funds.NC12;
  await S.CorporateActionService.setPrice('MIL', Math.round(price('MIL') * 1.4));
  await settle();
  const state = S.MarketStore.getPublic().funds.NC12;
  await S.TickService.advanceDays(1);
  await settle();

  const pub = S.MarketStore.getPublic();
  const byId = Object.fromEntries(S.CompanyRepository.all({ includeUnlisted: true }).map((c) => [c.id, c]));
  const prices = S.engine.fundPrices(Object.fromEntries(Object.entries(pub.companies).map(([id, c]) => [id, c.price])), byId);
  const expected = S.engine.stepFundState(state, before, prices, byId).nav;
  assert.ok(Math.abs(pub.funds.NC12.nav - expected) <= 0.02, `NAV ${pub.funds.NC12.nav} vs ${expected}`);
  assert.notEqual(pub.funds.NC12.rebalanceKey, state.rebalanceKey);
  assert.ok(prevState);
});
