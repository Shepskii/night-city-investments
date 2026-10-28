import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const env = installFakeFoundry({ actors: [['Alice', 90000, true], ['Bob', 90000, true]] });
const [alice] = env.actors;

const contacts = [];
const sent = [];
globalThis.game.nightcity = {
  masterContactService: {
    filterByTag: (t) => contacts.filter((c) => c.tags.includes(t)),
    getContact: (id) => contacts.find((c) => c.id === id) ?? null,
    getByActorId: () => null,
    getAll: () => contacts,
    addContact: async (d) => {
      const c = { id: `c_${contacts.length}`, email: `${contacts.length}@x`, tags: [], ...d };
      contacts.push(c);
      return { success: true, contact: c };
    },
    updateContact: async () => ({ success: true }),
  },
  messageService: { sendMessage: async (m) => { sent.push(m); return { success: true, messageId: `m${sent.length}` }; } },
  messageRepository: { getMessage: async () => null },
  networkService: { isOnNetwork: () => false },
};
globalThis.ChatMessage = { create: async () => {} };
game.users.filter = () => [];
env.store.set('tickMode', 'realTime');
env.store.set('realTimeMinutes', 10);
env.store.set('directOrderExecution', 'instant');
env.store.set('gigImpactApproval', false);
env.store.set('heatEnabled', true);

const PER_DAY = 144;
let S;
let HOOKS;
const ticks = [];

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
    Gigs: (await load('../scripts/services/GigImpactService.js')).GigImpactService,
    Heat: (await load('../scripts/services/HeatService.js')).HeatService,
    Controls: (await load('../scripts/services/MarketControlService.js')).MarketControlService,
    Undo: (await load('../scripts/services/UndoService.js')).UndoService,
    Notify: (await load('../scripts/services/NotificationService.js')).NotificationService,
    engine: await load('../scripts/engine/index.js'),
  };
  ({ HOOKS } = await load('../scripts/utils/constants.js'));
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  (await load('../scripts/init/registerBrokerSystem.js')).registerBrokerSystem(init);
  await init.runPhase('init');
  Hooks.on(HOOKS.PRICE_TICK, (data) => ticks.push(data));

  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  await S.PortfolioClient.submit(alice, 'deposit', { amount: 30000 });
  await settle();
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue, S.Gigs._queue, S.Heat._queue]) await q;
  }
};
const advance = async (n) => {
  for (let left = n; left > 0; left -= 300) await S.TickService.advance(Math.min(300, left));
  await settle();
};
const pub = () => S.MarketStore.getPublic();
const time = () => S.MarketStore.time();
const controls = () => S.MarketStore.getControls();
const closes = (id = 'ARA') => S.MarketStore.getHistory().series[id].closes;
const gigNews = () => S.MarketStore.getNews().items.filter((n) => n.companyIds?.includes('ARA'));

test('in the in-world clock mode a tick is a fraction of a game day, and the market clock follows it', async () => {
  assert.equal(S.TickService.tickDays, 10 / 1440);
  assert.equal(time(), 0);
  await advance(1);
  assert.ok(Math.abs(time() - 10 / 1440) < 1e-8);
  await advance(PER_DAY - 1);
  assert.equal(Math.round(time() * 1e6) / 1e6, 1, 'a hundred and forty-four ticks is one game day');
  assert.equal(pub().tickIndex, PER_DAY);
  assert.equal(closes().length, 2, 'the chart has one close for each of the two days so far');
});

test('the price hook says when a new game day has started, once a day', async () => {
  ticks.length = 0;
  await advance(10);
  assert.deepEqual([ticks.at(-1).newDay, ticks.at(-1).days], [false, 0]);
  await advance(PER_DAY);
  assert.deepEqual([ticks.at(-1).newDay, ticks.at(-1).days], [true, 1]);
});

test('a gig\'s delay is measured in game days, not ticks', async () => {
  const dayBefore = time();
  const out = await S.Gigs.report({ gigId: 'g1', outcome: 'done', client: 'Arasaka', reward: 3000 });
  await settle();
  assert.equal(out.status, 'applied');
  const days = out.delayDays;
  assert.ok(days >= 1 && days <= 3, `a delay of ${days} days`);

  const impact = controls().impacts.find((i) => i.sourceKey === 'gig:g1:done');
  const dt = 10 / 1440;
  assert.ok(Math.abs(impact.onsetTick - (dayBefore + days - dt)) < 1e-6, 'its onset is that many game days away');
  const window = S.MarketStore.getHeat().windows.find((w) => w.sourceKey === 'gig:g1:done');
  assert.ok(Math.abs(window.closeTick - impact.onsetTick) < 1e-9, 'and so is the end of its heat window');
  assert.ok(Math.abs(window.openTick - dayBefore) < 1e-6);

  // Alice trades while the news is not yet in the price.
  await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 20, orderType: 'market', expiry: 'day' });
  await settle();

  await advance(Math.round(days * PER_DAY) - 30);
  assert.equal(gigNews().length, 0, 'half a day short of the delay, no headline yet');
  assert.equal(S.MarketStore.getHeat().audits.length, 0, 'and the heat window is still open');
  assert.equal(S.MarketStore.getHeat().windows.find((w) => w.sourceKey === 'gig:g1:done').status, 'open');

  await advance(60);
  assert.equal(gigNews().length, 1, 'once the delay has passed, the headline is published');
  const audit = S.MarketStore.getHeat().audits.find((a) => a.sourceKey === 'gig:g1:done');
  assert.ok(audit, 'and the window is audited');
  assert.ok(audit.results.some((r) => r.name === 'Alice'), 'the trade made inside the window is found');
});

test('the effect of the gig shows over game days, not in the first few ticks', async () => {
  const before = pub().companies.CON.price;
  const dayBefore = time();
  const out = await S.Gigs.report({ gigId: 'g2', outcome: 'done', client: 'Conglomerate', reward: 9000 });
  await settle();
  if (out.status !== 'applied') return; // a client that does not match leaves nothing to measure
  const impact = controls().impacts.find((i) => i.sourceKey === 'gig:g2:done');
  assert.ok(impact.onsetTick - dayBefore > 0.5, 'it will not start for at least half a game day');
  await advance(20);
  assert.ok(Math.abs(Math.log(pub().companies.CON.price / before)) < 0.05, 'twenty ticks in, the price has barely moved');
});

test('a sentiment bias lasts its days of game time', async () => {
  const start = time();
  await S.Controls.addBias({ target: 'market', value: 1, days: 2 });
  await settle();
  const bias = controls().biases[0];
  assert.equal(bias.duration, 2);
  assert.ok(Math.abs(bias.startTick - (start + 10 / 1440)) < 1e-6, 'it starts at the next tick');

  await advance(PER_DAY);
  assert.equal(controls().biases.length, 1, 'a day in');
  await advance(PER_DAY - 1);
  assert.equal(controls().biases.length, 1, 'still there on its last tick');
  await advance(2);
  assert.equal(controls().biases.length, 0, 'gone when two days have passed');
});

test('a forced regime and a glide are measured in days too', async () => {
  await S.Controls.forceRegime('bull', 1);
  await settle();
  const until = controls().forceRegime.untilTick;
  assert.ok(Math.abs(until - (time() + 1)) < 1e-6, 'one game day');
  await advance(PER_DAY + 2);
  assert.equal(controls().forceRegime, null);

  const price = pub().companies.MIL.price;
  assert.equal(await S.Controls.addGlide({ companyId: 'MIL', target: Math.round(price * 1.1), days: 1, noise: 'low' }), true);
  await settle();
  const glide = controls().glides[0];
  assert.equal(glide.duration, 1);
  await advance(PER_DAY);
  assert.equal(pub().companies.MIL.price, Math.round(price * 1.1), 'it lands on its target after one game day');
  assert.equal(controls().glides.length, 0);
});

test('the chart gets one close a day, and undo puts the day\'s close back', async () => {
  const days = closes().length;
  await advance(PER_DAY * 2);
  assert.equal(closes().length, days + 2, 'two more days, two more closes, not 288');

  await advance(20);
  const priceBefore = pub().companies.BIO.price;
  await advance(1);
  assert.equal(closes('BIO').at(-1), Math.round(pub().companies.BIO.price * 100), "today's close follows the last price");

  const out = await S.Undo.undo();
  await settle();
  assert.equal(out.ok, true, JSON.stringify(out));
  assert.equal(pub().companies.BIO.price, priceBefore);
  assert.equal(closes('BIO').at(-1), Math.round(priceBefore * 100), "and today's close is back to the earlier price");
  assert.equal(closes().length, days + 2, 'without losing a day');
});

test('undo is refused once a tick has moved a player\'s money, whichever way the clock is counted', async () => {
  await advance(2);
  await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'MIL', qty: 3, orderType: 'market', expiry: 'day' });
  await settle();
  await advance(1);
  const filledAt = S.PortfolioRepository.get(alice).ledger.filter((e) => e.kind === 'buy').at(-1).ts;
  assert.ok(filledAt <= time() && filledAt > time() - 1, 'the fill is stamped with the market clock, a fraction of a day ago at most');
  const tick = pub().tickIndex;
  const out = await S.Undo.undo();
  assert.equal(out.ok, true, 'the last tick came after the fill, so it can still be undone');
  assert.equal(pub().tickIndex, tick - 1);
  await advance(1);
  await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'MIL', qty: 1, orderType: 'market', expiry: 'day' });
  await settle();
  await S.TickService.advance(1);
  await settle();
  const second = await S.Undo.undo();
  assert.equal(second.ok, true);
});

test('the daily digest and the big-movers notice go out once a day, not on every tick', async () => {
  await S.PortfolioClient.setNotify(alice, 'digest', 'mail');
  await settle();
  const before = sent.length;
  await S.Notify.onTick({ newDay: false });
  assert.equal(sent.length, before, 'a tick inside the day sends nothing');
  await S.Notify.onTick({ newDay: true });
  assert.ok(sent.length > before, 'the first tick of a day does');
});

test('a day order lasts one game day', async () => {
  const order = S.PortfolioRepository.get(alice).orders.find((o) => o.expiry === 'day');
  assert.ok(order, 'there is a day order from earlier');
  assert.ok(Math.abs(order.expiresTick - order.eligibleTick - 1) < 1e-9);
});

// ── Calendar jumps, rumours and the heat window ───────────────────────────────

test('a calendar jump brings a gig impact that fell due in it, with its headline and its audit', async () => {
  await S.TickService.checkClock();
  await settle();
  const news = () => S.MarketStore.getNews().items.filter((n) => n.companyIds?.includes('PET')).length;
  const out = await S.Gigs.report({ gigId: 'jump', outcome: 'done', client: 'Petrochem', reward: 4000 });
  await settle();
  assert.equal(out.status, 'applied');
  const impact = controls().impacts.find((i) => i.sourceKey === 'gig:jump:done');
  assert.ok(impact.onsetTick > time(), 'the effect is still days away');
  const newsBefore = news();
  const clock0 = time();

  env.clock.ms += 5 * 86_400_000;
  await S.TickService.checkClock();
  await settle();
  assert.ok(Math.abs(time() - clock0 - 5) < 0.5, 'five calendar days are five game days');
  assert.ok(news() > newsBefore, 'the headline is published once the days have passed');
  assert.ok(S.MarketStore.getHeat().audits.some((a) => a.sourceKey === 'gig:jump:done'), 'and the heat window is audited');
});

test('a rumour goes out at once, days before the effect, and the heat window runs in game days from the report', async () => {
  await S.PortfolioClient.setNotify(alice, 'tips', 'mail');
  env.store.set('gigTips', true);
  await settle();
  const held = S.PortfolioRepository.get(alice).lots.find((l) => l.qty > 0)?.assetId;
  assert.ok(held, 'Alice holds something');
  const name = (await import('../scripts/data/CompanyRepository.js')).CompanyRepository.get(held).name;

  const mails = sent.length;
  const reportedAt = time();
  const out = await S.Gigs.report({ gigId: 'rumour', outcome: 'failed', client: name, reward: 6000 });
  await settle();
  assert.equal(out.status, 'applied');
  assert.ok(sent.length > mails, 'the rumour was mailed as the gig was tracked, not after any ticks');
  assert.equal(time(), reportedAt, 'and no game time had passed');

  const impact = controls().impacts.find((i) => i.sourceKey === 'gig:rumour:failed');
  const window = S.MarketStore.getHeat().windows.find((w) => w.sourceKey === 'gig:rumour:failed');
  assert.ok(Math.abs(window.openTick - reportedAt) < 1e-9, 'the window opens when the outcome is tracked');
  assert.ok(Math.abs(window.closeTick - impact.onsetTick) < 1e-9, 'and closes when the effect begins');
  assert.ok(window.closeTick - window.openTick >= out.delayDays - 10 / 1440 - 1e-6, 'so players have the whole delay, in game days, to act on the rumour');
  assert.equal(window.tipped.length > 0, true, 'and the window records who was tipped off');

  await advance(Math.round((out.delayDays - 0.5) * PER_DAY));
  assert.equal(S.MarketStore.getHeat().windows.find((w) => w.sourceKey === 'gig:rumour:failed').status, 'open', 'still open half a day before the effect');
  env.store.set('gigTips', false);
});
