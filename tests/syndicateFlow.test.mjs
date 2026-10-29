import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Medtech', 90000, true], ['Fixer', 90000, true], ['Solo', 90000, true]] });
const [med, fix, solo] = env.actors;
const sent = [];
globalThis.game.nightcity = {
  masterContactService: { filterByTag: () => [], getContact: () => null, getByActorId: () => null, getAll: () => [], addContact: async (d) => ({ success: true, contact: { id: 'c_wire', ...d } }) },
  messageService: { sendMessage: async (m) => { sent.push(m); return { success: true, messageId: `m${sent.length}` }; } },
  messageRepository: { getMessage: async () => null },
  networkService: { isOnNetwork: () => false },
};
globalThis.ChatMessage = { create: async () => {} };
game.users.filter = () => [];
env.store.set('directOrderExecution', 'instant');
env.store.set('settlementDays', 2);

let S;
before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    SyndicateService: (await load('../scripts/services/SyndicateService.js')).SyndicateService,
    SyndicateClient: (await load('../scripts/services/SyndicateClient.js')).SyndicateClient,
    SyndicateRepository: (await load('../scripts/data/SyndicateRepository.js')).SyndicateRepository,
    receipts: (await load('../scripts/services/SyndicateClient.js')).syndicateReceipts,
    TickSequence: (await load('../scripts/init/registerTickSequence.js')).TickSequence,
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await load('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  (await load('../scripts/init/registerSyndicateSystem.js')).registerSyndicateSystem(init);
  await init.runPhase('init');

  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  for (const a of [med, fix, solo]) {
    await S.PortfolioClient.submit(a, 'deposit', { amount: 20000 });
    await settle();
  }
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.TickSequence._queue, S.PortfolioClient._chain, S.SyndicateClient._chain, S.PortfolioService._queue]) await q;
  }
};
const advance = async (n) => { await S.TickService.advance(n); await settle(); };

/** Send a syndicate request and let the GM's hooks handle it; the receipt comes back. */
const send = async (actor, type, payload = {}) => {
  const key = await S.SyndicateClient.submit(actor, type, payload);
  await settle();
  return S.receipts(actor).results.find((r) => r.key === key);
};
const syndicate = () => S.SyndicateRepository.all()[0];
const account = () => S.SyndicateRepository.portfolio(syndicate().id);
const cash = (actor) => S.PortfolioRepository.get(actor).cash;
const member = (actor) => syndicate().members.find((m) => m.actorId === actor.id);

/** A starter company whose shares the officers can buy a few of within the limit. */
const stock = () => {
  const [id, s] = Object.entries(S.MarketStore.getPublic().companies).find(([, c]) => c.price > 20 && c.price < 500);
  return { id, price: s.price };
};

test('a player founds a syndicate; it waits for the GM, then the invited Fixer joins', async () => {
  const r = await send(med, 'found', { name: 'Back Room Capital', invite: [fix.id] });
  assert.equal(r.ok, true, r.reason);
  assert.equal(syndicate().status, 'pending');
  assert.equal((await send(med, 'deposit', { syndicateId: syndicate().id, amount: 100 })).reason, 'not-active');

  assert.deepEqual(await S.SyndicateService.approve(syndicate().id), { ok: true });
  assert.equal(syndicate().status, 'active');
  assert.equal((await send(fix, 'join', { syndicateId: syndicate().id })).ok, true);
  assert.equal(member(fix).status, 'active');
  assert.equal((await send(solo, 'join', { syndicateId: syndicate().id })).reason, 'not-invited');
});

test('members pay in from their brokerage balances and get units at NAV', async () => {
  const id = syndicate().id;
  assert.equal((await send(med, 'deposit', { syndicateId: id, amount: 10000 })).ok, true);
  assert.equal((await send(fix, 'deposit', { syndicateId: id, amount: 5000 })).ok, true);
  assert.equal(cash(med), 10000);
  assert.equal(cash(fix), 15000);
  assert.equal(account().cash, 15000);
  assert.deepEqual([member(med).units, member(fix).units], [10000, 5000]);
  assert.equal((await send(fix, 'deposit', { syndicateId: id, amount: 50000 })).reason, 'insufficient-cash');
});

test('an officer trades the syndicate\'s account through the market\'s own executor; a member cannot', async () => {
  const id = syndicate().id;
  const { id: assetId, price } = stock();
  const qty = Math.floor(3000 / price);
  const r = await send(med, 'trade', { syndicateId: id, request: { type: 'placeOrder', route: 'direct', side: 'buy', assetId, qty, orderType: 'market', expiry: 'day' } });
  assert.equal(r.ok, true, r.reason);
  assert.equal(r.inner.type, 'placeOrder', 'the receipt carries the executor\'s result, for the usual notice');
  await advance(1);
  assert.equal(account().lots.reduce((a, l) => a + (l.assetId === assetId ? l.qty : 0), 0), qty, 'the shares are the syndicate\'s');
  assert.equal(S.PortfolioRepository.get(med).lots.length, 0, 'not the officer\'s');

  assert.equal((await send(fix, 'trade', { syndicateId: id, request: { type: 'placeOrder', side: 'buy', assetId, qty: 1, orderType: 'market' } })).reason, 'not-officer');
  assert.equal((await send(med, 'trade', { syndicateId: id, request: { type: 'placeOrder', side: 'buy', assetId, qty: Math.ceil(9000 / price), orderType: 'market' } })).reason, 'over-limit');
});

test('a proposal from the minority waits for the majority\'s vote', async () => {
  const id = syndicate().id;
  assert.equal((await send(fix, 'propose', { syndicateId: id, kind: 'limit', amount: 12000 })).ok, true);
  assert.equal(syndicate().proposals.length, 1);
  assert.equal((await send(med, 'vote', { syndicateId: id, proposalId: syndicate().proposals[0].id, yes: true })).ok, true);
  assert.equal(syndicate().rules.tradeLimit, 12000);
  assert.equal(syndicate().proposals.length, 0);
});

test('a redemption is paid at NAV into the member\'s brokerage balance once the settlement delay has passed', async () => {
  const id = syndicate().id;
  const before = cash(fix);
  assert.equal((await send(fix, 'redeem', { syndicateId: id, units: 1000 })).ok, true);
  assert.equal(cash(fix), before, 'not yet');
  await advance(3);
  const paid = syndicate().ledger.find((l) => l.kind === 'redeem');
  assert.ok(paid, 'paid after the delay');
  assert.ok(paid.amount > 900 && paid.amount < 1100, `about 1,000 eb at NAV: ${paid.amount}`);
  assert.equal(cash(fix), before + paid.amount);
  assert.equal(member(fix).units, 4000);
});

test('to wind up, the officers sell, then the members vote to dissolve and the cash is paid out by units', async () => {
  const id = syndicate().id;
  assert.equal((await send(med, 'propose', { syndicateId: id, kind: 'dissolve' })).reason, 'not-liquid');
  for (const lot of account().lots) {
    const r = await send(med, 'trade', { syndicateId: id, request: { type: 'placeOrder', route: 'direct', side: 'sell', assetId: lot.assetId, qty: lot.qty, orderType: 'market', expiry: 'day' } });
    assert.equal(r.ok, true, r.reason);
  }
  await advance(4);
  assert.equal(account().lots.length, 0);
  const medBefore = cash(med);
  const fixBefore = cash(fix);
  const total = account().cash;
  assert.equal((await send(med, 'propose', { syndicateId: id, kind: 'dissolve' })).ok, true);
  const s = S.SyndicateRepository.all().find((x) => x.id === id);
  assert.equal(s.status, 'closed');
  assert.equal(Math.round(cash(med) - medBefore + cash(fix) - fixBefore), Math.floor(total), 'every eddie goes back to the members');
  assert.ok(cash(med) - medBefore > 2 * (cash(fix) - fixBefore), 'by units: 10,000 against 4,000');
});
