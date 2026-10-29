import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Medtech', 90000, true], ['Fixer', 90000, true]] });
const [med, fix] = env.actors;
globalThis.game.nightcity = {
  masterContactService: { filterByTag: () => [], getAll: () => [] },
  messageService: { sendMessage: async () => ({ success: true }) },
  networkService: { isOnNetwork: () => false },
};
globalThis.ChatMessage = { create: async () => {} };
game.users.filter = () => [];
env.store.set('syndicateApproval', false);
env.store.set('businessApproval', false);

let S;
before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    SyndicateService: (await load('../scripts/services/SyndicateService.js')).SyndicateService,
    SyndicateClient: (await load('../scripts/services/SyndicateClient.js')).SyndicateClient,
    SyndicateRepository: (await load('../scripts/data/SyndicateRepository.js')).SyndicateRepository,
    SyndicateCash: (await load('../scripts/services/SyndicateCash.js')).SyndicateCash,
    BusinessService: (await load('../scripts/services/BusinessService.js')).BusinessService,
    BusinessClient: (await load('../scripts/services/BusinessClient.js')).BusinessClient,
    BusinessRepository: (await load('../scripts/data/BusinessRepository.js')).BusinessRepository,
    receiptsOf: (await load('../scripts/services/BusinessClient.js')).receiptsOf,
    accounts: await load('../scripts/ui/accounts.js'),
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  await init.runPhase('init');
  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  for (const a of [med, fix]) await S.PortfolioClient.submit(a, 'deposit', { amount: 20000 });
  await settle();

  // A syndicate the Medtech runs as its officer, holding 9,000 eb.
  await S.SyndicateClient.submit(med, 'found', { name: 'Back Room Capital', invite: [fix.id] });
  await S.SyndicateService.processActor(med);
  const id = S.SyndicateRepository.all()[0].id;
  await S.SyndicateClient.submit(fix, 'join', { syndicateId: id });
  await S.SyndicateService.processActor(fix);
  for (const [a, amount] of [[med, 6000], [fix, 3000]]) {
    await S.SyndicateClient.submit(a, 'deposit', { syndicateId: id, amount });
    await S.SyndicateService.processActor(a);
  }
});

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 2));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue]) await q;
  }
};
const syndicate = () => S.SyndicateRepository.all()[0];
const cash = () => S.SyndicateRepository.portfolio(syndicate().id).cash;
/** The Medtech's or Fixer's syndicate account, as the Business window picks it. */
const as = (actor) => S.accounts.memberAccount(syndicate().id, actor.id);
const send = async (account, type, payload) => {
  const key = await S.BusinessClient.submit(account, type, payload);
  const officer = account.isSyndicate ? account.as : account;
  await S.BusinessService.processActor(officer);
  return S.receiptsOf(officer).results.find((r) => r.key === key);
};
const businessOf = (name) => S.BusinessRepository.all().find((b) => b.name === name);

test('an officer founds a business for the syndicate: the syndicate is the partner and pays from its account', async () => {
  const r = await send(as(med), 'found', { name: 'Chrome Fund Clinic', archetype: 'clinic', cash: 3000, invite: [] });
  assert.equal(r.ok, true, r.reason);
  const b = businessOf('Chrome Fund Clinic');
  assert.deepEqual(b.partners.map((p) => [p.actorId, p.name, p.cash]), [[syndicate().id, 'Back Room Capital', 3000]]);
  assert.equal(cash(), 9000 - 3000);
  assert.equal(med.system.wealth.value, 90000 - 20000, 'the officer\'s own eddies are untouched');
  assert.ok(syndicate().ledger.some((l) => l.kind === 'businessOut' && l.amount === 3000 && l.business === 'Chrome Fund Clinic'));
  assert.equal(S.SyndicateRepository.portfolio(syndicate().id).ledger.at(-1).kind, 'businessOut');
});

test('a member who is not an officer cannot act for it, gear is refused, and over the limit is refused', async () => {
  const fixAs = { ...as(fix), isSyndicate: true };
  assert.equal((await send(fixAs, 'found', { name: 'X', archetype: 'bar', cash: 100 })).reason, 'not-officer');
  assert.equal((await send(as(med), 'found', { name: 'Y', archetype: 'bar', cash: 100, gear: [{ uuid: 'Item.x' }] })).reason, 'syndicate-gear');
  assert.equal((await send(as(med), 'found', { name: 'Z', archetype: 'bar', cash: 5500 })).reason, 'over-limit');
  assert.equal(businessOf('Z'), undefined, 'nothing was saved by the dry run');
  assert.equal(cash(), 6000);
});

test('over the limit, the members vote; once it passes the business side makes it for the syndicate', async () => {
  await S.SyndicateClient.submit(med, 'propose', {
    syndicateId: syndicate().id, kind: 'business', business: { type: 'found', name: 'Big Bar', archetype: 'bar', cash: 5500 }, amount: 5500, label: 'Big Bar',
  });
  await S.SyndicateService.processActor(med);
  await settle();
  const b = businessOf('Big Bar');
  assert.ok(b, 'founded once the Medtech\'s majority passed it');
  assert.equal(b.partners[0].actorId, syndicate().id);
  assert.equal(cash(), 500);
});

test('money coming back from a business goes into the syndicate\'s account', async () => {
  const b = businessOf('Chrome Fund Clinic');
  const r = await send(as(med), 'withdraw', { businessId: b.id });
  assert.equal(r.ok, true, r.reason);
  assert.equal(cash(), 500 + 3000, 'the escrow is refunded to the syndicate');
  assert.ok(syndicate().ledger.some((l) => l.kind === 'businessIn' && l.amount === 3000));
});

test('its stake in an open business counts in its value, and it cannot dissolve while it holds one', async () => {
  const b = businessOf('Big Bar');
  await S.BusinessRepository.save({ ...b, status: 'open', escrow: 0, till: 1000, assets: 4500, partners: b.partners.map((p) => ({ ...p, units: 5500 })) });
  assert.equal(S.SyndicateCash.stakesOf(syndicate().id), 5500);
  const out = await (async () => {
    await S.SyndicateClient.submit(med, 'propose', { syndicateId: syndicate().id, kind: 'dissolve' });
    await S.SyndicateService.processActor(med);
    return (await import('../scripts/services/SyndicateClient.js')).syndicateReceipts(med).results.at(-1);
  })();
  assert.equal(out.reason, 'not-liquid');
});

test('the Business window offers the syndicate to its officers only', () => {
  const offered = (actor) => S.accounts.businessAccounts([actor]).map((a) => a.id);
  assert.deepEqual(offered(med), [med.id, `syn:${syndicate().id}:${med.id}`]);
  assert.deepEqual(offered(fix), [fix.id], 'the Fixer is a member, not an officer');
});
