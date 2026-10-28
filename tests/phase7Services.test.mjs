import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Handlebars from 'handlebars';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lang = JSON.parse(readFileSync(join(root, 'lang', 'en.json'), 'utf8'));

const env = installFakeFoundry({ actors: [['Alice', 90000, true], ['Bob', 90000, true]] });
const [alice, bob] = env.actors;
const MOD = 'night-city-investments';

// Stable module object, so the api that the init tasks attach to it can be read back.
const mod = { api: { time: { getCurrentTimeMs: () => env.clock.ms } } };
game.modules.get = () => mod;
game.users.filter = () => [];
globalThis.ui.notifications.error = (m) => env.notices.push(['error', m]);
game.macros = [];
globalThis.Macro = { create: async (d) => { const m = { ...d, id: `m${game.macros.length + 1}`, getFlag: (s, k) => d.flags?.[s]?.[k] }; game.macros.push(m); return m; } };
globalThis.ChatMessage = { create: async () => {} };

const keybindings = [];
game.keybindings = { register: (m, key, def) => keybindings.push({ m, key, def }) };

const contacts = [
  { id: 'c_wire', name: 'Market Wire', tags: ['market-wire'], sendOnly: true, organization: 'Night City Market' },
  { id: 'c_1', name: 'Rex', tags: [], organization: 'Hexagon Logistics' },
  { id: 'c_2', name: 'Mia', tags: [], organization: 'hexagon logistics' },
  { id: 'c_3', name: 'Sol', tags: [], organization: 'Arasaka' },
  { id: 'c_4', name: 'Dee', tags: [], organization: 'Cobalt Freight' },
  { id: 'c_5', name: 'Broker Bob', tags: ['broker'], organization: 'Brokerage House' },
];
game.nightcity = {
  masterContactService: {
    filterByTag: (t) => contacts.filter((c) => c.tags.includes(t)),
    getContact: (id) => contacts.find((c) => c.id === id) ?? null,
    getByActorId: () => null,
    getAll: () => contacts,
    addContact: async (d) => { const c = { id: `c_${contacts.length + 1}`, tags: [], ...d }; contacts.push(c); return { success: true, contact: c }; },
    updateContact: async () => ({ success: true }),
  },
  messageService: { sendMessage: async () => ({ success: true, messageId: 'm1' }) },
  messageRepository: { getMessage: async () => null },
  networkService: { isOnNetwork: () => false },
};
env.store.set('directOrderExecution', 'instant');
env.store.set('gigImpactApproval', false);

class StubApplication {
  constructor(options = {}) { this.options = options; }
  render() {}
}
globalThis.foundry.applications = { api: { ApplicationV2: StubApplication, HandlebarsApplicationMixin: (Base) => Base } };
globalThis.TextEditor = { enrichHTML: async (html) => html };

const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), lang);
game.i18n.localize = (key) => {
  const value = lookup(key);
  if (typeof value !== 'string') throw new Error(`Missing language key: ${key}`);
  return value;
};
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m));
Handlebars.registerHelper('localize', (key, options) => game.i18n.format(key, options?.hash ?? {}));
Handlebars.registerHelper('checked', (value) => (value ? 'checked' : ''));
Handlebars.registerHelper('selectOptions', (choices, { hash }) => new Handlebars.SafeString(
  Object.entries(choices).map(([v, label]) => `<option value="${v}"${String(v) === String(hash.selected) ? ' selected' : ''}>${label}</option>`).join(''),
));
const render = (path, context) => Handlebars.compile(readFileSync(join(root, path), 'utf8'), { strict: false })(context);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');
const BAD = ['[object Object]', 'NaN', 'undefined', 'NCI.', '{count}', '{from}', '{version}'];

let S;
let Apps;
let initTools;

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
    Migration: (await load('../scripts/services/MigrationService.js')).MigrationService,
    Diagnostics: (await load('../scripts/services/DiagnosticsService.js')).DiagnosticsService,
    Macros: (await load('../scripts/services/MacroService.js')).MacroService,
    Gigs: (await load('../scripts/services/GigImpactService.js')).GigImpactService,
    engine: await load('../scripts/engine/index.js'),
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  await init.runPhase('init');

  initTools = new ModuleInitializer();
  (await load('../scripts/init/registerToolsSystem.js')).registerToolsSystem(initTools);

  Apps = {
    GMConsole: (await load('../scripts/ui/GMConsole/GMConsoleApp.js')).GMConsoleApp,
    CompanyEditor: (await load('../scripts/ui/CompanyEditor/CompanyEditorApp.js')).CompanyEditorApp,
  };
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue, S.Gigs._queue]) await q;
  }
};

// ── Migrations in the world ──────────────────────────────────────────────────

test('on load the active GM brings old stored data up to date, once', async () => {
  const stale = { schema: 1, cash: 700, lots: [], orders: [], ledger: [] };
  alice.flags[MOD] = { portfolio: stale };
  const journal = await S.MarketStore.ensureControlJournal();
  journal.flags[MOD].heat = { schema: 1, characters: {} };
  journal.flags[MOD].controls = { schema: 1, biases: [] };

  assert.equal(S.Migration.version(), 1, 'a world that has never been migrated counts as v1');
  await initTools.runPhase('ready');

  assert.equal(S.Migration.version(), S.engine.latestSchemaVersion());
  const saved = alice.flags[MOD].portfolio;
  assert.equal(saved.cash, 700);
  assert.deepEqual([saved.unsettled, saved.heatAware, saved.brokerBans], [[], false, {}], 'new fields are written back');
  assert.equal(bob.flags[MOD]?.portfolio, undefined, 'a character with no portfolio is not given one');
  assert.deepEqual(journal.flags[MOD].heat.windows, []);
  assert.ok(Array.isArray(journal.flags[MOD].controls.glides));

  alice.flags[MOD].portfolio.cash = 701;
  const again = await S.Migration.run();
  assert.deepEqual([again.ok, again.applied.length, alice.flags[MOD].portfolio.cash], [true, 0, 701], 'a second run does nothing');
});

test('only the active GM migrates, and a failure leaves the version alone', async () => {
  await env.store.set('schemaVersion', 1);
  game.users.activeGM = { id: 'someone-else' };
  assert.equal(await S.Migration.run(), null);
  assert.equal(S.Migration.version(), 1);
  game.users.activeGM = { id: 'gm1' };

  const original = S.MarketStore.setHeat;
  const journal = S.MarketStore.controlJournal();
  journal.flags[MOD].heat = { schema: 1 };
  S.MarketStore.setHeat = async () => { throw new Error('disk full'); };
  const out = await S.Migration.run();
  S.MarketStore.setHeat = original;
  assert.equal(out.ok, false);
  assert.equal(out.failed.error, 'disk full');
  assert.equal(S.Migration.version(), 1);
  assert.ok(env.notices.some(([kind]) => kind === 'error'), 'the GM is told the migration failed');
  assert.equal((await S.Migration.run()).ok, true, 'and it succeeds when tried again');
  assert.equal(S.Migration.version(), S.engine.latestSchemaVersion());
});

// ── Keybindings and API ──────────────────────────────────────────────────────

test('keybindings are registered unbound, and the GM one is restricted', async () => {
  await initTools.runPhase('init');
  assert.deepEqual(keybindings.map((k) => k.key), ['openTerminal', 'openConsole']);
  for (const k of keybindings) {
    assert.equal(k.m, MOD);
    assert.deepEqual(k.def.editable, [], 'no default key');
    assert.equal(typeof k.def.onDown, 'function');
    assert.ok(lookup(k.def.name) && lookup(k.def.hint), 'name and hint exist in the language file');
  }
  assert.equal(keybindings[0].def.restricted, undefined);
  assert.equal(keybindings[1].def.restricted, true);
});

test('the tools API is published for macros and other modules', () => {
  assert.equal(typeof mod.api.verify, 'function');
  assert.equal(mod.api.schemaVersion, S.engine.latestSchemaVersion());
  assert.deepEqual(Object.keys(mod.api.gm.tools).sort(), ['createMacros', 'migrate', 'suggestions', 'tradeLog', 'verify']);
  assert.ok(env.hooksFired.some((h) => h.name === 'night-city-investments.ready' && h.args[0] === mod.api), 'the ready hook fires once the API is complete');
});

// ── Macros ───────────────────────────────────────────────────────────────────

test('starter macros are created once, with the right permissions', async () => {
  const first = await S.Macros.createDefaults();
  assert.deepEqual(first, { created: 4, skipped: 0 });
  assert.equal(game.macros.length, 4);
  const byKey = Object.fromEntries(game.macros.map((m) => [m.flags[MOD].macro, m]));
  assert.equal(byKey.terminal.ownership.default, 2, 'players can see the terminal macro');
  for (const k of ['console', 'advance', 'check']) assert.equal(byKey[k].ownership.default, 0, `${k} is GM only`);
  assert.ok(game.macros.every((m) => m.type === 'script' && m.command.includes('game.nightcity.investments')));
  assert.ok(byKey.advance.command.includes('isGM'), 'the advance macro checks for a GM itself');
  assert.equal(byKey.terminal.name, 'NCI: Open Market Terminal');

  game.macros.splice(game.macros.indexOf(byKey.check), 1);
  assert.deepEqual(await S.Macros.createDefaults(), { created: 1, skipped: 3 }, 'only the deleted one is made again');

  game.user.isGM = false;
  assert.deepEqual(await S.Macros.createDefaults(), { created: 0, skipped: 0 });
  game.user.isGM = true;
});

// ── Self-check, trade log and suggestions on a live-ish world ────────────────

test('the self-check, trade log and company suggestions read the real world', async () => {
  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  await S.PortfolioClient.submit(alice, 'deposit', { amount: 20000 });
  await settle();
  const k = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 10, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(S.PortfolioRepository.get(alice).results.find((r) => r.key === k)?.ok, true);

  const report = S.Diagnostics.verify({ silent: true });
  assert.equal(report.ok, true, JSON.stringify(report.checks.filter((c) => c.level === 'fail' || c.level === 'warn')));
  assert.equal(report.checks.find((c) => c.id === 'portfolios').level, 'ok');
  assert.equal(report.checks.find((c) => c.id === 'wire').level, 'ok');
  assert.equal(report.checks.find((c) => c.id === 'brokers').level, 'ok', 'the broker-tagged contact counts');
  assert.equal(report.checks.find((c) => c.id === 'schema').detail, `v${S.engine.latestSchemaVersion()}`);

  env.notices.length = 0;
  S.Diagnostics.verify();
  assert.ok(env.notices.some(([kind, m]) => kind === 'info' && m.includes('passed')), 'a loud run tells the GM');
  assert.equal(mod.api.verify({ silent: true }).ok, true);

  const rows = S.Diagnostics.tradeLog();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].name, rows[0].side, rows[0].assetId, rows[0].qty], ['Alice', 'buy', 'ARA', 10]);
  assert.ok(rows[0].gross > 0 && rows[0].price > 0);

  const picks = S.Diagnostics.suggestions();
  assert.deepEqual(picks.map((s) => s.name), ['Hexagon Logistics', 'Cobalt Freight'], 'Arasaka is a company, the wire and the broker are not suggested');
  assert.equal(picks[0].count, 2);
  assert.equal(picks[0].from.join(), 'contact');

  game.user.isGM = false;
  assert.equal(S.Diagnostics.verify({ silent: true }), null);
  assert.deepEqual([S.Diagnostics.tradeLog(), S.Diagnostics.suggestions()], [[], []]);
  game.user.isGM = true;
});

test('the self-check reports what a GM would want to fix', async () => {
  const p = S.PortfolioRepository.get(alice);
  alice.flags[MOD].portfolio = { ...p, lots: [...p.lots, { id: 'bad', assetId: 'DELETED', qty: 3, unitCost: 10 }] };
  let report = S.Diagnostics.verify({ silent: true });
  assert.equal(report.checks.find((c) => c.id === 'holdings').level, 'warn');
  assert.equal(report.ok, true);

  alice.flags[MOD].portfolio = { ...S.PortfolioRepository.get(alice), cash: -50, lots: p.lots };
  report = S.Diagnostics.verify({ silent: true });
  assert.equal(report.ok, false);
  env.notices.length = 0;
  S.Diagnostics.verify();
  assert.ok(env.notices.some(([kind]) => kind === 'error'), 'a failure is shown as an error');
  alice.flags[MOD].portfolio = { ...S.PortfolioRepository.get(alice), cash: 100 };
});

// ── GM Console Tools tab ─────────────────────────────────────────────────────

test('the Tools tab shows the self-check, macros, suggestions and the trade log', async () => {
  const app = new Apps.GMConsole();
  app.tab = 'tools';
  let html = render('templates/gm/console.hbs', await app._prepareContext());
  let t = text(html);
  for (const bad of BAD) assert.equal(html.includes(bad), false, `tools tab contains "${bad}"`);
  assert.ok(t.includes('Self-check') && t.includes('Not run yet'), 'the check has not been run');
  assert.ok(t.includes(`schema v${S.engine.latestSchemaVersion()}`));
  assert.ok(t.includes('Hexagon Logistics') && t.includes('Cobalt Freight') && t.includes('2 mention(s) from contacts'));
  assert.equal(t.includes('Arasaka (') , false, 'a known company is not suggested');
  assert.ok(t.includes('Alice') && t.includes('Buy') && t.includes('ARA'), 'the trade log shows the fill');
  for (const action of ['runCheck', 'createMacros', 'createSuggested', 'ignoreSuggested']) {
    assert.ok(html.includes(`data-action="${action}"`), `${action} button`);
    assert.equal(typeof Apps.GMConsole.DEFAULT_OPTIONS.actions[action], 'function', `${action} has a handler`);
  }
  assert.equal((await app._prepareContext()).tabs.find((x) => x.id === 'tools').label, 'Tools');

  app.render = () => {};
  Apps.GMConsole._onRunCheck.call(app);
  html = render('templates/gm/console.hbs', await app._prepareContext());
  t = text(html);
  for (const bad of BAD) assert.equal(html.includes(bad), false, `report contains "${bad}"`);
  assert.ok(t.includes('Stored data version') && t.includes('Portfolios') && t.includes('Insider-trading heat'), 'each check is listed');
  assert.ok(t.includes('Self-check passed') || t.includes('warning'), 'with a summary');
  assert.equal(t.includes('Not run yet'), false);
});

test('creating from a suggestion opens a filled-in editor, and ignoring one removes it', async () => {
  const app = new Apps.GMConsole();
  app.render = () => {};
  const opened = [];
  const original = Apps.CompanyEditor.edit;
  Apps.CompanyEditor.edit = (id, prefill) => { opened.push([id, prefill]); };
  Apps.GMConsole._onCreateSuggested.call(app, null, { dataset: { name: 'Hexagon Logistics', ticker: 'HEX' } });
  Apps.CompanyEditor.edit = original;
  assert.deepEqual(opened, [[null, { name: 'Hexagon Logistics', ticker: 'HEX' }]]);

  const editor = new Apps.CompanyEditor({ id: 'x', companyId: null, prefill: { name: 'Hexagon Logistics', ticker: 'HEX' } });
  const ctx = await editor._prepareContext();
  assert.deepEqual([ctx.isNew, ctx.company.name, ctx.company.ticker, ctx.company.sector], [true, 'Hexagon Logistics', 'HEX', 'other']);
  const blank = await new Apps.CompanyEditor({ id: 'y' })._prepareContext();
  assert.equal(blank.company.name, '');

  await Apps.GMConsole._onIgnoreSuggested.call(app, null, { dataset: { name: 'Hexagon Logistics' } });
  assert.deepEqual(S.Diagnostics.suggestions().map((s) => s.name), ['Cobalt Freight']);
  assert.equal(S.MarketStore.getGigs().mappings['hexagon logistics'].companyId, 'ignore');
});

test('the create-macros button reports what it did', async () => {
  const app = new Apps.GMConsole();
  env.notices.length = 0;
  await Apps.GMConsole._onCreateMacros.call(app);
  assert.ok(env.notices.some(([, m]) => m === 'Macros: 0 created, 4 already there.'), JSON.stringify(env.notices));
});

// ── Portfolio holdings open their market page ────────────────────────────────

test('a holding on the portfolio opens its market page, and Back returns to the portfolio', async () => {
  const { MarketTerminalApp } = await import('../scripts/ui/MarketTerminal/MarketTerminalApp.js');
  const p = S.PortfolioRepository.get(alice);
  alice.flags[MOD].portfolio = { ...p, lots: [...p.lots, { id: 'gone', assetId: 'GONE', qty: 2, unitCost: 5, acquiredTick: 0 }] };

  const app = new MarketTerminalApp();
  app.render = () => {};
  app.actorId = alice.id;
  app.tab = 'portfolio';
  let html = render('templates/terminal/market.hbs', await app._prepareContext());
  for (const bad of BAD) assert.equal(html.includes(bad), false, `portfolio contains "${bad}"`);
  assert.ok(html.includes('<tr data-action="openAsset" data-id="ARA"'), 'a listed holding opens its page');
  assert.equal(html.includes('data-id="GONE"'), true, 'a holding whose company is gone still shows');
  assert.equal(html.includes('data-action="openAsset" data-id="GONE"'), false, 'but is not a link');
  assert.ok(html.includes('data-action="trade" data-side="buy" data-id="ARA"'), 'the buy and sell buttons are still there');

  const actions = MarketTerminalApp.DEFAULT_OPTIONS.actions;
  assert.equal(typeof actions.openAsset, 'function');
  actions.openAsset.call(app, null, { dataset: { id: 'ARA' } });
  assert.deepEqual([app.tab, app.selectedId], ['market', 'ARA']);
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assert.ok(text(html).includes('Arasaka') && html.includes('data-action="back"'), 'the company page');
  assert.ok(text(html).includes('Back to portfolio'));

  actions.back.call(app);
  assert.deepEqual([app.tab, app.selectedId], ['portfolio', null], 'Back goes to the portfolio');

  actions.openAsset.call(app, null, { dataset: { id: 'ARA' } });
  actions.switchTab.call(app, null, { dataset: { tab: 'market' } });
  actions.select.call(app, null, { dataset: { id: 'ARA' } });
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assert.ok(text(html).includes('Back to market'), 'a page opened from the market list goes back to the market');
  actions.back.call(app);
  assert.equal(app.tab, 'market');

  alice.flags[MOD].portfolio = { ...S.PortfolioRepository.get(alice), lots: p.lots };
});
