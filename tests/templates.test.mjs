import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Handlebars from 'handlebars';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lang = JSON.parse(readFileSync(join(root, 'lang', 'en.json'), 'utf8'));

const env = installFakeFoundry({ actors: [['Alice', 50000, true]] });
const [alice] = env.actors;

// ── Stubs for the parts of Foundry's UI layer that the windows extend ─────────
class StubApplication {
  constructor(options = {}) { this.options = options; }
}
globalThis.foundry.applications = { api: { ApplicationV2: StubApplication, HandlebarsApplicationMixin: (Base) => Base } };
globalThis.TextEditor = { enrichHTML: async (html) => html };

// ── Handlebars with the Foundry helpers the templates use ────────────────────
const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), lang);

// game.i18n resolves the real language file, so the windows' own L() calls are checked too.
game.i18n.localize = (key) => {
  const value = lookup(key);
  if (typeof value !== 'string') throw new Error(`Missing language key: ${key}`);
  return value;
};
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m));

Handlebars.registerHelper('localize', (key) => game.i18n.localize(key));
Handlebars.registerHelper('selectOptions', (choices, { hash }) => new Handlebars.SafeString(
  Object.entries(choices).map(([v, label]) => `<option value="${v}"${String(v) === String(hash.selected) ? ' selected' : ''}>${label}</option>`).join(''),
));
Handlebars.registerHelper('checked', (value) => (value ? 'checked' : ''));

const render = (relativePath, context) => {
  const source = readFileSync(join(root, relativePath), 'utf8');
  return Handlebars.compile(source, { strict: false })(context);
};

const BAD = ['[object Object]', 'NaN', 'undefined', 'NCI.'];
const assertClean = (html, label) => {
  for (const bad of BAD) assert.equal(html.includes(bad), false, `${label} contains "${bad}"`);
  assert.ok(html.length > 200, `${label} rendered something`);
};
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

let S;
let Terminal;
let GMConsole;
let Editor;
let Trade;

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    DividendService: (await load('../scripts/services/DividendService.js')).DividendService,
    CorporateActionService: (await load('../scripts/services/CorporateActionService.js')).CorporateActionService,
    MarketControlService: (await load('../scripts/services/MarketControlService.js')).MarketControlService,
    NewsService: (await load('../scripts/services/NewsService.js')).NewsService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    CompanyRepository: (await load('../scripts/data/CompanyRepository.js')).CompanyRepository,
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  await init.runPhase('init');

  ({ MarketTerminalApp: Terminal } = await load('../scripts/ui/MarketTerminal/MarketTerminalApp.js'));
  ({ GMConsoleApp: GMConsole } = await load('../scripts/ui/GMConsole/GMConsoleApp.js'));
  ({ CompanyEditorApp: Editor } = await load('../scripts/ui/CompanyEditor/CompanyEditorApp.js'));
  ({ TradeDialogApp: Trade } = await load('../scripts/ui/TradeDialog/TradeDialogApp.js'));
});

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue, S.CorporateActionService._queue, S.NewsService._queue]) await q;
  }
};

test('terminal renders before the market exists, for a GM with no companies', async () => {
  const app = new Terminal();
  const html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'empty terminal');
  assert.ok(text(html).includes('No companies yet'));
});

test('terminal renders every tab with real data', async () => {
  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  await S.PortfolioClient.submit(alice, 'deposit', { amount: 20000 });
  await settle();
  env.store.set('directOrderExecution', 'instant');
  await S.PortfolioClient.submit(alice, 'placeOrder', { side: 'buy', assetId: 'ARA', qty: 10, orderType: 'market', expiry: 'day' });
  await S.PortfolioClient.submit(alice, 'placeOrder', { side: 'buy', assetId: 'MIL', qty: 5, orderType: 'limit', limit: 1, expiry: 'gtc' });
  await settle();
  env.store.set('directOrderExecution', 'nextTick');
  await S.PortfolioClient.submit(alice, 'setDrip', { assetId: 'ARA', enabled: true });
  await S.TickService.advance(3);
  await S.DividendService.declareSpecial('ARA', 1.25);
  await S.NewsService.post({ headline: 'Quiet day in the Corpo Plaza', tone: 'neutral' });
  await S.PortfolioClient.toggleWatch(alice, 'ARA');
  await settle();

  const app = new Terminal();

  app.tab = 'market';
  let html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'market tab');
  assert.ok(text(html).includes('Arasaka'));
  assert.ok(html.includes('<svg'), 'sparklines render');

  app.selectedId = 'ARA';
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'company page');
  assert.ok(text(html).includes('last 1.25 eb'), 'last dividend shown');
  assert.ok(text(html).includes('Special dividend') || text(html).includes('special dividend'), 'company news shown');
  assert.ok(html.includes('data-action="trade"'));

  app.tab = 'portfolio';
  app.selectedId = null;
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'portfolio tab');
  assert.ok(html.includes('data-action="drip"'), 'reinvest toggle shown for dividend payers');
  assert.ok(text(html).includes('Reinvest dividends'));
  assert.ok(text(html).includes('Open orders'));
  assert.ok(html.includes('data-action="cancelOrder"'), 'the limit order is open and cancellable');

  app.tab = 'news';
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'news tab');
  assert.ok(text(html).includes('Quiet day in the Corpo Plaza'));
  assert.ok(text(html).includes('special dividend'));
});

test('GM console renders all four tabs, with controls, queued events and the log filled in', async () => {
  await S.MarketControlService.addBias({ target: 'sector:arms', value: 1.5, days: 12, decay: 'linear' });
  await S.MarketControlService.forceRegime('bear', 4);
  await S.MarketControlService.addShock({ target: 'company:ARA', percent: -6, delayDays: 2, persistence: 'lasting', headline: 'Arasaka audit' });
  await S.MarketControlService.setHalt(true);
  await S.CorporateActionService.setPrice('CON', 61.5);
  await settle();

  const app = new GMConsole();
  const labels = {};
  for (const tab of ['market', 'events', 'actions', 'companies']) {
    app.tab = tab;
    const html = render('templates/gm/console.hbs', await app._prepareContext());
    assertClean(html, `GM ${tab} tab`);
    labels[tab] = text(html);
  }
  assert.ok(labels.market.includes('Arms'), 'sector bias listed');
  assert.ok(labels.market.includes('+1.5σ'));
  assert.ok(labels.market.includes('Bear forced for'));
  assert.ok(labels.market.includes('Resume market'), 'halt button reflects state');
  assert.ok(labels.events.includes('-6%'), 'queued shock listed');
  assert.ok(labels.events.includes('Recent GM actions'));
  assert.ok(labels.events.includes('price set from'));
  assert.ok(labels.actions.includes('Stock split'));
  assert.ok(labels.companies.includes('Arasaka'));
});

test('every data-action in a template is a real action of its window, and none is reserved by ApplicationV2', () => {
  // ApplicationV2 handles these itself, before any action a window defines (a "tab" button throws).
  const RESERVED = ['close', 'tab', 'toggleControls'];
  const pairs = [
    ['templates/terminal/market.hbs', Terminal],
    ['templates/gm/console.hbs', GMConsole],
    ['templates/gm/company-editor.hbs', Editor],
    ['templates/dialogs/trade.hbs', Trade],
  ];
  for (const [file, App] of pairs) {
    const used = [...readFileSync(join(root, file), 'utf8').matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
    assert.ok(used.length > 0, `${file} has actions`);
    const defined = Object.keys(App.DEFAULT_OPTIONS.actions ?? {});
    for (const action of used) {
      assert.equal(RESERVED.includes(action), false, `${file}: "${action}" is reserved by ApplicationV2`);
      assert.ok(defined.includes(action), `${file}: no handler for data-action="${action}"`);
    }
    for (const action of defined) assert.equal(RESERVED.includes(action), false, `${App.name} defines reserved action "${action}"`);
  }
});

test('company editor and trade dialog render', async () => {
  const editor = new Editor({ companyId: 'ARA' });
  let html = render('templates/gm/company-editor.hbs', await editor._prepareContext());
  assertClean(html, 'company editor');
  assert.ok(html.includes('value="ARA"'));
  assert.ok(html.includes('name="split.auto"'));

  html = render('templates/gm/company-editor.hbs', await new Editor({ companyId: null })._prepareContext());
  assertClean(html, 'new company editor');

  const trade = new Trade({ actorId: alice.id, assetId: 'ARA', side: 'sell' });
  html = render('templates/dialogs/trade.hbs', await trade._prepareContext());
  assertClean(html, 'trade dialog');
  assert.ok(html.includes('<option value="sell" selected>'));
});
