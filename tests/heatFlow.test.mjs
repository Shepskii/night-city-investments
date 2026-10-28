import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Alice', 90000, true], ['Bob', 90000, true], ['Carol', 90000, true], ['Fixer', 0, false]] });
const [alice, bob, carol, fixer] = env.actors;
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
  messageService: { sendMessage: async (m) => { sent.push(m); return { success: true, messageId: `m${sent.length}` }; } },
  messageRepository: { getMessage: async () => null },
  networkService: { isOnNetwork: () => false },
};
globalThis.ChatMessage = { create: async () => {} };
game.users.filter = () => [];
env.store.set('directOrderExecution', 'instant');
env.store.set('gigImpactApproval', false);
env.store.set('heatEnabled', true);

let S; let Gigs; let Heat; let HOOKS;
const audits = [];

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
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    BrokerRepository: (await load('../scripts/data/BrokerRepository.js')).BrokerRepository,
  };
  Gigs = (await load('../scripts/services/GigImpactService.js')).GigImpactService;
  Heat = (await load('../scripts/services/HeatService.js')).HeatService;
  ({ HOOKS } = await load('../scripts/utils/constants.js'));
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await load('../scripts/init/registerBrokerSystem.js')).registerBrokerSystem(init);
  await init.runPhase('init');
  Hooks.on(HOOKS.HEAT_AUDIT, (data) => audits.push(data));

  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  for (const a of [alice, bob, carol]) {
    await S.PortfolioClient.submit(a, 'deposit', { amount: 30000 });
    await settle();
  }
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue, Gigs._queue, Heat._queue]) await q;
  }
};

const tick = () => S.MarketStore.getPublic().tickIndex;
const heat = () => S.MarketStore.getHeat();
const windowFor = (key) => heat().windows.find((w) => w.sourceKey === key);
const trade = async (a, side, assetId, qty, route = 'direct') => {
  const k = await S.PortfolioClient.submit(a, 'placeOrder', { route, side, assetId, qty, orderType: 'market', expiry: 'day' });
  await settle();
  const r = S.PortfolioRepository.get(a).results.find((x) => x.key === k);
  assert.equal(r?.ok, true, `${a.name} ${side} ${assetId}: ${JSON.stringify(r)}`);
};
const report = async (p) => { const out = await Gigs.report(p); await settle(); return out; };
const advance = async (n) => { await S.TickService.advance(n); await settle(); };
const auditOf = (key) => heat().audits.find((a) => a.sourceKey === key);
const heatOf = (a) => Heat.heatOf(a.id);

test('a reported gig opens a watch window, and nothing is audited until it closes', async () => {
  await trade(carol, 'buy', 'ARA', 20);
  await trade(bob, 'buy', 'ARA', 10);
  await advance(1);

  const out = await report({ gigId: 'h1', outcome: 'done', client: 'Arasaka', reward: 2000, title: 'Courier' });
  assert.equal(out.status, 'applied');
  const w = windowFor('gig:h1:done');
  assert.ok(w, 'a window is open');
  assert.deepEqual([w.companyId, w.direction, w.status, w.openTick], ['ARA', 'up', 'open', tick()]);
  assert.ok(w.closeTick >= w.openTick && w.closeTick <= w.openTick + 2);
  const impact = S.MarketStore.getControls().impacts.find((i) => i.sourceKey === 'gig:h1:done');
  assert.equal(w.closeTick, impact.onsetTick, 'it closes when the effect starts to show');

  await trade(alice, 'buy', 'ARA', 20);
  await trade(bob, 'sell', 'ARA', 5);
  assert.equal(heat().audits.length, 0, 'not audited while open');
  assert.equal(heatOf(alice), 0);
});

test('once it closes, only the trade made in the window in the news\'s direction draws heat', async () => {
  await advance(4);
  const w = windowFor('gig:h1:done');
  assert.equal(w.status, 'audited');
  const audit = auditOf('gig:h1:done');
  assert.deepEqual(audit.results.map((r) => r.name), ['Alice'], 'Bob sold, Carol bought the day before');
  const [t] = audit.results[0].trades;
  assert.deepEqual([t.side, t.route, t.knowledge, t.gross > 3000], ['buy', 'direct', 'general', true]);
  const first = heatOf(alice);
  assert.ok(first > 10 && first <= 40, `heat ${first}`);
  assert.equal(heatOf(bob), 0);
  assert.equal(heatOf(carol), 0);
  assert.equal(Heat.tierOf(alice.id), 'quiet');
  assert.equal(audits.length, 1, 'the audit hook fired');
  assert.equal(audits[0].window.sourceKey, 'gig:h1:done');
  assert.equal(audits[0].results[0].actorId, alice.id);
});

test('heat is hidden: no score is on any actor, only in the GM control journal', () => {
  for (const a of [alice, bob, carol]) {
    const flags = JSON.stringify(a.flags ?? {});
    assert.equal(flags.includes('"heat":'), false, `${a.name} carries no heat score`);
    assert.equal(flags.includes('characters'), false);
  }
  assert.ok(S.MarketStore.controlJournal().getFlag('night-city-investments', 'heat'));
});

test('heat stacks across gigs, then fades with time', async () => {
  await report({ gigId: 'h2', outcome: 'done', client: 'Militech', reward: 3000 });
  await trade(alice, 'buy', 'MIL', 30);
  await advance(5);
  assert.equal(windowFor('gig:h2:done').status, 'audited');
  const stacked = heatOf(alice);
  assert.ok(stacked > 20, `two gigs add up: ${stacked}`);
  assert.equal(heat().characters[alice.id].log.length, 2);

  await advance(7);
  const later = heatOf(alice);
  assert.ok(Math.abs(later - stacked / 2) < stacked * 0.08, `about half a week later: ${stacked} -> ${later}`);
  assert.equal(Heat.snapshot().characters.find((c) => c.name === 'Alice').heat, later);
});

test('a rumour follower draws far less heat than a stranger who makes the same trade', async () => {
  env.store.set('gigTips', true);
  await S.PortfolioClient.setNotify(bob, 'tips', 'mail');
  await S.PortfolioClient.toggleWatch(bob, 'BIO');
  await settle();
  await advance(1);

  const out = await report({ gigId: 'h3', outcome: 'done', client: 'Biotechnica', reward: 3000 });
  assert.equal(out.status, 'applied');
  assert.deepEqual(windowFor('gig:h3:done').tipped, [bob.id], 'only Bob was sent the rumour');
  await trade(alice, 'buy', 'BIO', 30);
  await trade(bob, 'buy', 'BIO', 30);
  await advance(5);
  const results = Object.fromEntries(auditOf('gig:h3:done').results.map((r) => [r.name, r]));
  assert.equal(results.Alice.trades[0].knowledge, 'general');
  assert.equal(results.Bob.trades[0].knowledge, 'tipped');
  assert.ok(results.Bob.gain > 0 && results.Bob.gain < results.Alice.gain * 0.6, `Bob ${results.Bob.gain} vs Alice ${results.Alice.gain}`);
  env.store.set('gigTips', false);
});

test('before bad news a sale counts and a purchase does not', async () => {
  await trade(alice, 'buy', 'ORB', 40);
  await trade(carol, 'buy', 'ORB', 40);
  await advance(1);
  const before = heatOf(carol);

  const out = await report({ gigId: 'h4', outcome: 'failed', client: 'Orbital Air', reward: 3000 });
  assert.equal(out.status, 'applied');
  assert.equal(windowFor('gig:h4:failed').direction, 'down');
  await trade(alice, 'sell', 'ORB', 40);
  await trade(bob, 'buy', 'ORB', 40);
  await advance(5);
  const audit = auditOf('gig:h4:failed');
  assert.deepEqual(audit.results.map((r) => [r.name, r.trades[0].side]), [['Alice', 'sell']]);
  assert.equal(heatOf(carol), before, 'Carol held through it and did nothing');
});

test('a slow broker order placed in the window holds the audit until it fills, and counts as a broker trade', async () => {
  assert.equal(await S.BrokerRepository.makeBrokerFromActor(fixer.id), true);
  const [broker] = S.BrokerRepository.list();
  await S.PortfolioClient.setBroker(bob, broker.id);
  await settle();

  await report({ gigId: 'h5', outcome: 'done', client: 'SovOil', reward: 3000 });
  await trade(bob, 'buy', 'SOV', 40, 'broker');
  const w0 = windowFor('gig:h5:done');
  let sawWaiting = false;
  for (let i = 0; i < 14 && windowFor('gig:h5:done').status === 'open'; i++) {
    await advance(1);
    const stillOpen = S.PortfolioRepository.get(bob).orders.some((o) => o.status === 'open' && o.assetId === 'SOV');
    if (stillOpen) {
      assert.equal(windowFor('gig:h5:done').status, 'open', 'the audit waits for the order');
      if (tick() > w0.closeTick) sawWaiting = true;
    }
  }
  assert.equal(windowFor('gig:h5:done').status, 'audited');
  const bobOrder = S.PortfolioRepository.get(bob).orders.find((o) => o.assetId === 'SOV');
  assert.ok(bobOrder.submittedTick <= w0.closeTick && bobOrder.filledTick > w0.closeTick, 'placed inside the window, filled after it closed');
  const bobResult = auditOf('gig:h5:done').results.find((r) => r.name === 'Bob');
  assert.ok(bobResult, 'the broker trade was counted');
  assert.equal(bobResult.trades[0].route, 'broker');
  assert.ok(sawWaiting || bobOrder.filledTick > w0.closeTick);
});

test('with heat tracking off no window opens and nothing is recorded', async () => {
  env.store.set('heatEnabled', false);
  const windowsBefore = heat().windows.length;
  const out = await report({ gigId: 'h6', outcome: 'done', client: 'Kendachi', reward: 3000 });
  assert.equal(out.status, 'applied', 'the gig itself still works');
  assert.equal(heat().windows.length, windowsBefore);
  await trade(alice, 'buy', 'KEN', 30);
  const aliceBefore = heatOf(alice);
  await advance(5);
  assert.equal(heat().windows.length, windowsBefore);
  assert.equal(heat().audits.some((a) => a.sourceKey === 'gig:h6:done'), false);
  assert.ok(heatOf(alice) <= aliceBefore, 'only fading');
  env.store.set('heatEnabled', true);
});

test('a discarded gig opens no window', async () => {
  env.store.set('gigImpactApproval', true);
  const before = heat().windows.length;
  const out = await report({ gigId: 'h7', outcome: 'done', client: 'Zetatech', reward: 3000 });
  assert.equal(out.status, 'pending');
  assert.equal(heat().windows.length, before, 'nothing to watch while it waits for approval');
  await Gigs.discard(out.id);
  await settle();
  assert.equal(heat().windows.length, before);
  env.store.set('gigImpactApproval', false);
});

test('approving a pending gig opens its window from the day it was reported', async () => {
  env.store.set('gigImpactApproval', true);
  const reportedAt = tick();
  const out = await report({ gigId: 'h8', outcome: 'done', client: 'Kang Tao', reward: 3000 });
  await trade(alice, 'buy', 'KAN', 40);
  await advance(1);
  assert.equal(windowFor('gig:h8:done'), undefined);
  await Gigs.approve(out.id);
  await settle();
  const w = windowFor('gig:h8:done');
  assert.equal(w.openTick, reportedAt, 'the window runs from the report, so a trade made while it waited is caught');
  await advance(6);
  assert.ok(auditOf('gig:h8:done').results.some((r) => r.name === 'Alice'));
  env.store.set('gigImpactApproval', false);
});

test('the GM\'s strength setting scales the heat a trade adds', async () => {
  env.store.set('heatStrength', 2);
  await report({ gigId: 'h9', outcome: 'done', client: 'Zetatech', reward: 3000 });
  await trade(carol, 'buy', 'ZET', 30);
  await advance(5);
  const doubled = auditOf('gig:h9:done').results[0].gain;
  env.store.set('heatStrength', 1);
  await report({ gigId: 'h10', outcome: 'done', client: 'Network 54', reward: 3000 });
  await trade(carol, 'buy', 'N54', 30);
  await advance(5);
  const normal = auditOf('gig:h10:done').results[0].gain;
  assert.ok(doubled > normal * 1.4, `${doubled} vs ${normal}`);
});

test('two medium trades in one window are enough for the first warning bracket; a large trade draws more than a medium one', async () => {
  // Prices move between runs, so size trades in eb rather than shares.
  const shares = (id, eb) => Math.max(1, Math.round(eb / S.MarketStore.getPublic().companies[id].price));
  await report({ gigId: 'h11', outcome: 'done', client: 'Dynalar', reward: 3000 });
  await trade(carol, 'buy', 'DYN', shares('DYN', 3200));
  await trade(carol, 'buy', 'DYN', shares('DYN', 3200));
  await trade(bob, 'buy', 'DYN', shares('DYN', 3200));
  await advance(5);
  const results = Object.fromEntries(auditOf('gig:h11:done').results.map((r) => [r.name, r]));
  assert.ok(results.Carol.gain >= 25, `two medium trades: ${results.Carol.gain}`);
  assert.ok(results.Bob.gain < 25 && results.Bob.gain > 5, `one medium trade: ${results.Bob.gain}`);
  assert.ok(Math.abs(results.Carol.gain / results.Bob.gain - 2) < 0.2, 'twice the trading, about twice the heat');
  assert.ok(Heat.heatOf(carol.id) >= 25, 'her heat is in the first bracket');
  assert.notEqual(Heat.tierOf(carol.id), 'quiet');

  await report({ gigId: 'h12', outcome: 'done', client: 'Kiroshi', reward: 3000 });
  await trade(alice, 'buy', 'KIR', shares('KIR', 1500));
  await trade(bob, 'buy', 'KIR', shares('KIR', 4500));
  await advance(5);
  const kir = Object.fromEntries(auditOf('gig:h12:done').results.map((r) => [r.name, r]));
  assert.ok(kir.Bob.gain > kir.Alice.gain * 2, `a trade three times the size draws far more: ${kir.Bob.gain} vs ${kir.Alice.gain}`);
});

test('a market reset clears heat, windows and audits', async () => {
  assert.ok(heat().audits.length > 0);
  await S.MarketStore.clearAll();
  assert.deepEqual([heat().audits.length, heat().windows.length, Object.keys(heat().characters).length], [0, 0, 0]);
});
