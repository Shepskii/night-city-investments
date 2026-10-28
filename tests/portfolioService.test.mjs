import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal fake Foundry runtime (journals, actors, hooks, settings) ───────────
const MODULE = 'night-city-investments';
const store = new Map();
const handlers = new Map();
const notices = [];

function merge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) target[k] = merge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
    else target[k] = v;
  }
  return target;
}

class FakeDoc {
  constructor(data) {
    this.name = data.name;
    this.ownership = data.ownership ?? { default: 0 };
    this.flags = structuredClone(data.flags ?? {});
    this.pages = { contents: (data.pages ?? []).map((p) => ({ ...structuredClone(p), update: async function (d) { this.text.content = d['text.content']; } })) };
  }
  getFlag(scope, key) { return this.flags[scope]?.[key]; }
  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = value && typeof value === 'object' && !Array.isArray(value) ? merge(this.flags[scope][key] ?? {}, structuredClone(value)) : structuredClone(value);
    return this._changed({ flags: { [scope]: { [key]: value } } });
  }
  async unsetFlag(scope, key) { delete this.flags[scope]?.[key]; }
  async update(d) { Object.assign(this, d); }
  testUserPermission() { return true; }
  get isOwner() { return true; }
  _changed() {}
}

class FakeJournal extends FakeDoc {
  constructor(data) { super(data); this.id = `j${FakeJournal.n++}`; }
  async delete() { game.journal.splice(game.journal.indexOf(this), 1); }
}
FakeJournal.n = 1;

class FakeActor extends FakeDoc {
  constructor(name, wealth, hasPlayerOwner = false) {
    super({ name });
    this.id = `a_${name}`;
    this.type = 'character';
    this.system = { wealth: { value: wealth, transactions: [] } };
    this.hasPlayerOwner = hasPlayerOwner;
  }
  async update(d) { if (d['system.wealth']) this.system.wealth = structuredClone(d['system.wealth']); }
  _changed(changes) { callAll('updateActor', this, changes); }
}

function callAll(name, ...args) {
  for (const fn of handlers.get(name) ?? []) fn(...args);
}

globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 } };
globalThis.Hooks = { callAll, on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
globalThis.ui = { notifications: { warn: (m) => notices.push(['warn', m]), info: (m) => notices.push(['info', m]) } };
globalThis.Folder = { create: async (d) => ({ id: 'f1', ...d }) };
globalThis.JournalEntry = { create: async (d) => { const j = new FakeJournal(d); game.journal.push(j); return j; } };
globalThis.foundry = {
  utils: {
    deepClone: (v) => structuredClone(v),
    randomID: () => Math.random().toString(36).slice(2, 18),
    hasProperty: (obj, path) => path.split('.').reduce((o, k) => (o && k in o ? o[k] : undefined), obj) !== undefined,
  },
};
const alice = new FakeActor('Alice', 10000, true);
const npc = new FakeActor('Bob', 500, false);
globalThis.game = {
  user: { id: 'gm1', isGM: true, character: null },
  users: { activeGM: { id: 'gm1' } },
  journal: [],
  folders: [],
  actors: Object.assign([alice, npc], { get: (id) => [alice, npc].find((a) => a.id === id) }),
  time: { worldTime: 0 },
  i18n: { localize: (k) => k, format: (k) => k },
  modules: { get: () => ({ api: { time: { getCurrentTimeMs: () => Date.UTC(2045, 2, 1) } } }) },
  settings: {
    get: (mod, key) => (store.has(key) ? store.get(key) : { tickMode: 'worldTime', worldSeed: '', depositFee: 0, directOrderExecution: 'nextTick', directCommissionBps: 0, directTradingMode: 'open' }[key]),
    set: async (mod, key, value) => { store.set(key, structuredClone(value)); },
  },
};

let TickService, PortfolioService, PortfolioClient, PortfolioRepository, MarketStore, ImportService, ModuleInitializer, registerPortfolioSystem;

before(async () => {
  ({ TickService } = await import('../scripts/services/TickService.js'));
  ({ PortfolioService } = await import('../scripts/services/PortfolioService.js'));
  ({ PortfolioClient } = await import('../scripts/services/PortfolioClient.js'));
  ({ PortfolioRepository } = await import('../scripts/data/PortfolioRepository.js'));
  ({ MarketStore } = await import('../scripts/data/MarketStore.js'));
  ({ ImportService } = await import('../scripts/services/ImportService.js'));
  ({ ModuleInitializer } = await import('../scripts/core/ModuleInitializer.js'));
  ({ registerPortfolioSystem } = await import('../scripts/init/registerPortfolioSystem.js'));

  const init = new ModuleInitializer();
  registerPortfolioSystem(init);
  await init.runPhase('init');
  await init.runPhase('ready');

  await ImportService.importStarter();
  await TickService.syncCompanies();
});

const settle = async () => {
  await PortfolioClient._chain;
  await PortfolioService._queue;
  await PortfolioClient._chain;
  await PortfolioService._queue;
};

const lastResult = (actor) => PortfolioRepository.get(actor).results.at(-1);

test('a deposit request in the outbox is processed by the GM executor', async () => {
  const key = await PortfolioClient.submit(alice, 'deposit', { amount: 3000 });
  await settle();
  const p = PortfolioRepository.get(alice);
  assert.equal(p.cash, 3000);
  assert.equal(alice.system.wealth.value, 7000);
  assert.deepEqual(alice.system.wealth.transactions.at(-1), ['Decreased by 3000 to 7000', 'Night City Investments: brokerage transfer']);
  assert.ok(p.processed.includes(key));
  assert.equal(lastResult(alice).ok, true);
  assert.equal(PortfolioRepository.pending(alice).length, 0);
});

test('the handled request is pruned from the outbox for actors no player owns', async () => {
  await PortfolioClient.submit(npc, 'deposit', { amount: 100 });
  await settle();
  assert.equal(PortfolioRepository.get(npc).cash, 100);
  assert.equal(PortfolioRepository.outbox(npc).length, 0, 'GM prunes unowned actors');
  assert.equal(PortfolioRepository.outbox(alice).length > 0, true, 'GM leaves player-owned outboxes to the player');
});

test('the same request is never applied twice, even if the sweep runs again', async () => {
  const before = PortfolioRepository.get(alice);
  await PortfolioService.sweepAll();
  await PortfolioService.processActor(alice);
  assert.equal(PortfolioRepository.get(alice).cash, before.cash);
  assert.equal(alice.system.wealth.value, 7000);
});

test('failed requests are reported and change nothing', async () => {
  await PortfolioClient.submit(alice, 'withdraw', { amount: 999999 });
  await settle();
  assert.equal(lastResult(alice).ok, false);
  assert.equal(lastResult(alice).reason, 'insufficient-balance');
  assert.equal(alice.system.wealth.value, 7000);
});

test('a buy waits for the next tick and then fills from the executor', async () => {
  await PortfolioClient.submit(alice, 'placeOrder', { side: 'buy', assetId: 'ARA', qty: 5, orderType: 'market', expiry: 'day' });
  await settle();
  let p = PortfolioRepository.get(alice);
  assert.equal(p.orders.at(-1).status, 'open');
  assert.equal(p.lots.length, 0);

  const fills = [];
  Hooks.on(`${MODULE}.orderFilled`, (e) => fills.push(e));
  await TickService.advance(1);
  await settle();

  p = PortfolioRepository.get(alice);
  assert.equal(p.orders.at(-1).status, 'filled');
  assert.equal(p.lots[0].qty, 5);
  assert.ok(p.cash < 3000);
  assert.equal(fills.length, 1);
  assert.equal(fills[0].actorId, alice.id);
});

test('sell realises profit and returns cash, and the cash can be withdrawn to the wallet', async () => {
  await PortfolioClient.submit(alice, 'placeOrder', { side: 'sell', assetId: 'ARA', qty: 5, orderType: 'market', expiry: 'day' });
  await settle();
  await TickService.advance(1);
  await settle();

  let p = PortfolioRepository.get(alice);
  assert.equal(p.lots.length, 0);
  assert.equal(typeof p.stats.realized, 'number');

  const cash = p.cash;
  await PortfolioClient.submit(alice, 'withdraw', { amount: cash });
  await settle();
  p = PortfolioRepository.get(alice);
  assert.equal(p.cash, 0);
  assert.equal(alice.system.wealth.value, 7000 + cash);
});

test('instant execution fills without waiting for a tick', async () => {
  store.set('directOrderExecution', 'instant');
  await PortfolioClient.submit(alice, 'deposit', { amount: 2000 });
  await PortfolioClient.submit(alice, 'placeOrder', { side: 'buy', assetId: 'MIL', qty: 2, orderType: 'market', expiry: 'day' });
  await settle();
  const p = PortfolioRepository.get(alice);
  assert.equal(p.orders.at(-1).status, 'filled');
  assert.equal(p.lots.at(-1).assetId, 'MIL');
  store.set('directOrderExecution', 'nextTick');
});

test('halting a company rejects its open orders at the next tick', async () => {
  const { CompanyRepository } = await import('../scripts/data/CompanyRepository.js');
  await PortfolioClient.submit(alice, 'placeOrder', { side: 'buy', assetId: 'BIO', qty: 1, orderType: 'market', expiry: 'day' });
  await settle();
  await CompanyRepository.save({ ...CompanyRepository.getByTicker('BIO'), status: 'halted' });
  await TickService.advance(1);
  await settle();
  const order = PortfolioRepository.get(alice).orders.at(-1);
  assert.equal(order.status, 'rejected');
  assert.equal(order.reason, 'halted');
});

test('the client refuses to queue past the outbox limit', async () => {
  game.users.activeGM = null; // no executor, so requests pile up
  for (let i = 0; i < 40; i++) await PortfolioClient.submit(npc, 'deposit', { amount: 1 });
  assert.equal(PortfolioRepository.pending(npc).length, 30);
  assert.ok(notices.some(([, m]) => m === 'NCI.Errors.OutboxFull'));
  game.users.activeGM = { id: 'gm1' };
});

test('the actor list: a GM sees player-owned characters, falling back to all when none are owned', async () => {
  assert.deepEqual(PortfolioRepository.actors().map((a) => a.name), ['Alice']);
  const owned = alice.hasPlayerOwner;
  alice.hasPlayerOwner = false;
  assert.deepEqual(PortfolioRepository.actors().map((a) => a.name), ['Alice', 'Bob']);
  alice.hasPlayerOwner = owned;
});

test('watchlist toggles are stored in player prefs', async () => {
  await PortfolioClient.toggleWatch(alice, 'ARA');
  await PortfolioClient.toggleWatch(alice, 'MIL');
  assert.deepEqual(PortfolioRepository.watchlist(alice), ['ARA', 'MIL']);
  await PortfolioClient.toggleWatch(alice, 'ARA');
  assert.deepEqual(PortfolioRepository.watchlist(alice), ['MIL']);
});

test('player-owned outboxes are pruned once their requests are processed', async () => {
  game.user.isGM = false; // act as the owning player
  await PortfolioClient.prune(alice);
  await settle();
  game.user.isGM = true;
  assert.equal(PortfolioRepository.pending(alice).length, 0);
  assert.equal(PortfolioRepository.outbox(alice).length, 0);
});
