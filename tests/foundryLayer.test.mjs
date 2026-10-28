import { test, before } from 'node:test';
import assert from 'node:assert/strict';

// ── Minimal fake Foundry runtime ───────────────────────────────────────────────
const MODULE = 'night-city-investments';
const DAY = 86_400_000;

const store = new Map();
const hooksFired = [];
let nowMs = Date.UTC(2045, 2, 1, 12);

function merge(target, source) {
  for (const [k, v] of Object.entries(source)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[k] = merge(target[k] && typeof target[k] === 'object' ? target[k] : {}, v);
    } else {
      target[k] = v;
    }
  }
  return target;
}

class FakeJournal {
  constructor(data) {
    this.id = `j${FakeJournal.n++}`;
    this.name = data.name;
    this.folder = data.folder;
    this.ownership = data.ownership ?? { default: 0 };
    this.flags = structuredClone(data.flags ?? {});
    this.pages = { contents: (data.pages ?? []).map((p) => ({ ...structuredClone(p), update: async function (d) { this.text.content = d['text.content']; } })) };
  }
  getFlag(scope, key) { return this.flags[scope]?.[key]; }
  async setFlag(scope, key, value) {
    this.flags[scope] ??= {};
    this.flags[scope][key] = value && typeof value === 'object' && !Array.isArray(value)
      ? merge(this.flags[scope][key] ?? {}, structuredClone(value))
      : value;
  }
  async unsetFlag(scope, key) { delete this.flags[scope]?.[key]; }
  async update(d) { Object.assign(this, d); }
  async delete() { game.journal.splice(game.journal.indexOf(this), 1); }
  testUserPermission() { return true; }
  get isOwner() { return true; }
}
FakeJournal.n = 1;

globalThis.CONST = { DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, OBSERVER: 2 } };
globalThis.Hooks = { callAll: (name, data) => hooksFired.push({ name, data }), on() {} };
globalThis.ui = { notifications: { warn() {}, info() {} } };
globalThis.Folder = { create: async (d) => { const f = { id: `f${game.folders.length + 1}`, ...d }; game.folders.push(f); return f; } };
globalThis.JournalEntry = { create: async (d) => { const j = new FakeJournal(d); game.journal.push(j); return j; } };
globalThis.foundry = { utils: { deepClone: (v) => structuredClone(v), randomID: () => Math.random().toString(36).slice(2, 18) } };
globalThis.game = {
  user: { id: 'gm1', isGM: true },
  users: { activeGM: { id: 'gm1' } },
  journal: [],
  folders: [],
  time: { worldTime: 0 },
  i18n: { localize: (k) => k, format: (k) => k },
  modules: { get: () => ({ api: { time: { getCurrentTimeMs: () => nowMs } } }) },
  settings: {
    get: (mod, key) => (store.has(key) ? store.get(key) : { tickMode: 'worldTime', realTimeMinutes: 10, worldSeed: '' }[key]),
    set: async (mod, key, value) => { store.set(key, structuredClone(value)); },
  },
};

let TickService, MarketStore, CompanyRepository, ImportService, engine;

before(async () => {
  ({ TickService } = await import('../scripts/services/TickService.js'));
  ({ MarketStore } = await import('../scripts/data/MarketStore.js'));
  ({ CompanyRepository } = await import('../scripts/data/CompanyRepository.js'));
  ({ ImportService } = await import('../scripts/services/ImportService.js'));
  engine = await import('../scripts/engine/index.js');
});

test('importing the starter corporations creates flagged journals, once', async () => {
  const first = await ImportService.importStarter();
  assert.ok(first.created >= 10);
  assert.equal(first.skipped, 0);
  const again = await ImportService.importStarter();
  assert.equal(again.created, 0);
  assert.equal(again.skipped, first.created);

  const ara = CompanyRepository.getByTicker('ara');
  assert.equal(ara.name, 'Arasaka');
  assert.equal(ara.id, 'ARA');
  assert.ok(ara.lore.startsWith('<p>'));
  assert.equal(game.journal.find((j) => j.name.startsWith('Arasaka')).ownership.default, 2);
});

test('save rejects duplicate tickers and non-GMs', async () => {
  const dup = await CompanyRepository.save({ name: 'Imposter', ticker: 'ARA', initialPrice: 10 });
  assert.deepEqual(dup.errors, ['ticker-taken']);
  game.user.isGM = false;
  assert.deepEqual((await CompanyRepository.save({ name: 'X', ticker: 'XX', initialPrice: 10 })).errors, ['gm-only']);
  game.user.isGM = true;
});

test('first sync creates the market, with fair value kept out of public state', async () => {
  await TickService.syncCompanies();
  const pub = MarketStore.getPublic();
  assert.ok(pub.schema);
  assert.equal(pub.tickIndex, 0);
  assert.equal(Object.keys(pub.companies).length, CompanyRepository.all().length);
  assert.equal(JSON.stringify(pub).includes('fair'), false);
  assert.ok(MarketStore.getHidden().companies.ARA.fair > 0);
  assert.ok(MarketStore.controlJournal(), 'GM-only control journal exists');
  assert.equal(MarketStore.controlJournal().ownership.default, 0);
  assert.equal(MarketStore.getHistory().series.ARA.closes.length, 1);
});

test('world-time mode: first check re-baselines, then ticks once per day passed', async () => {
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, 0);
  assert.equal(MarketStore.getPublic().lastDay, engine.dayIndex(nowMs));

  nowMs += 3 * DAY;
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, 3);
  assert.equal(MarketStore.getHistory().series.ARA.closes.length, 4);

  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, 3, 'no extra tick without time passing');

  nowMs -= 2 * DAY;
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, 1, 'rolling the date back two days rolls the market back two ticks');
  assert.equal(MarketStore.getPublic().lastDay, engine.dayIndex(nowMs));
  assert.equal(MarketStore.getHistory().series.ARA.closes.length, 2);
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, 1, 'and it stays there until the date moves forward');

  nowMs += 2 * DAY;
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, 3, 'moving forward again re-runs those days');
  assert.ok(hooksFired.some((h) => h.name === `${MODULE}.priceTick`));
});

test('manual advance works regardless of mode and keeps prices sane', async () => {
  await TickService.advance(5);
  const pub = MarketStore.getPublic();
  assert.equal(pub.tickIndex, 8);
  for (const c of Object.values(pub.companies)) assert.ok(c.price >= 1 && Number.isFinite(c.price));
  assert.equal(MarketStore.getHistory().series.MIL.closes.length, 9);
});

test('the same seed and journals reproduce the same prices', async () => {
  const companies = CompanyRepository.all({ includeUnlisted: true });
  const seed = game.settings.get(MODULE, 'worldSeed');
  let state = engine.createInitialState({ companies });
  for (let i = 0; i < 8; i++) state = engine.stepMarket({ state, companies, seed }).state;
  const pub = MarketStore.getPublic();
  assert.equal(pub.companies.ARA.price, state.companies.ARA.price);
});

test('adding and deleting companies updates the market and history', async () => {
  const added = await CompanyRepository.save({ name: 'Newco', ticker: 'NEW', initialPrice: 33 });
  assert.equal(added.ok, true);
  await TickService.syncCompanies();
  assert.equal(MarketStore.getPublic().companies.NEW.price, 33);
  assert.deepEqual(MarketStore.getHistory().series.NEW.closes, [3300]);

  await CompanyRepository.remove('NEW');
  await TickService.syncCompanies();
  assert.equal(MarketStore.getPublic().companies.NEW, undefined);
  assert.equal(MarketStore.getHistory().series.NEW, undefined);
});

test('a halted company is frozen while others move', async () => {
  const before = MarketStore.getPublic().companies;
  const kan = CompanyRepository.getByTicker('KAN');
  await CompanyRepository.save({ ...kan, status: 'halted' });
  await TickService.advance(2);
  const after = MarketStore.getPublic().companies;
  assert.equal(after.KAN.price, before.KAN.price);
  assert.notEqual(after.ARA.price, before.ARA.price);
});

test('only the active GM runs the market', async () => {
  game.users.activeGM = { id: 'someone-else' };
  const tick = MarketStore.getPublic().tickIndex;
  await TickService.advance(3);
  await TickService.checkClock();
  assert.equal(MarketStore.getPublic().tickIndex, tick);
  game.users.activeGM = { id: 'gm1' };
});

test('reset restarts every company from its initial price with a new seed', async () => {
  const oldSeed = game.settings.get(MODULE, 'worldSeed');
  await TickService.reset();
  const pub = MarketStore.getPublic();
  assert.equal(pub.tickIndex, 0);
  assert.equal(pub.companies.ARA.price, 240);
  assert.notEqual(game.settings.get(MODULE, 'worldSeed'), oldSeed);
  assert.equal(MarketStore.getHistory().series.ARA.closes.length, 1);
});
