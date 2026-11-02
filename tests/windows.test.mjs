import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Handlebars from 'handlebars';
import { registerPartials, withPartials } from './helpers/partials.mjs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { marketDateIn } from './helpers/marketDate.mjs';
import { accountPages } from './helpers/terminalPages.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerPartials(Handlebars, root);
const lang = JSON.parse(readFileSync(join(root, 'lang', 'en.json'), 'utf8'));

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Fixer', 0, false]] });
const [alice, fixer] = env.actors;

// The Fixer's sheet: INT 6 + Accounting 6 = 12 ("seasoned").
fixer.system.stats = { int: { value: 6 } };
fixer.items = [{ type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } }];

// A fake Night City Messenger: contacts and a network that this client is not on.
const contacts = [{ id: 'c_plain', name: 'Old Contact', email: 'old@x', tags: [], actorId: null }];
globalThis.game.nightcity = {
  masterContactService: {
    filterByTag: (t) => contacts.filter((c) => c.tags.includes(t)),
    getContact: (id) => contacts.find((c) => c.id === id) ?? null,
    getByActorId: (id) => contacts.find((c) => c.actorId === id) ?? null,
    getAll: () => contacts,
    addContact: async (d) => {
      const c = { id: `c_${contacts.length}`, email: 'x@y', tags: [], ...d };
      contacts.push(c);
      return { success: true, contact: c };
    },
    updateContact: async (id, u) => {
      Object.assign(contacts.find((c) => c.id === id), u);
      return { success: true };
    },
  },
  networkService: { isOnNetwork: () => false },
};

for (const [k, v] of Object.entries({
  directTradingMode: 'terminal', directCommissionBps: 200, directFlatFee: 5, corpnetDV: 13,
  corpnetNetwork: 'CORPNET', sessionTicks: 1, lockoutTicks: 1,
})) env.store.set(k, v);

class StubApplication {
  constructor(options = {}) { this.options = options; }
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

const render = (relativePath, context) => Handlebars.compile(readFileSync(join(root, relativePath), 'utf8'), { strict: false })(context);
const BAD = ['[object Object]', 'NaN', 'undefined', 'NCI.', '{n}', '{name}'];
const assertClean = (html, label) => {
  for (const bad of BAD) assert.equal(html.includes(bad), false, `${label} contains "${bad}"`);
  assert.ok(html.length > 200, `${label} rendered something`);
};
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

let S;
let Apps;
let FundRepository;

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    DividendService: (await load('../scripts/services/DividendService.js')).DividendService,
    CorporateActionService: (await load('../scripts/services/CorporateActionService.js')).CorporateActionService,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    NewsService: (await load('../scripts/services/NewsService.js')).NewsService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    FundService: (await load('../scripts/services/FundService.js')).FundService,
    BrokerRepository: (await load('../scripts/data/BrokerRepository.js')).BrokerRepository,
    TerminalAccess: (await load('../scripts/services/TerminalAccess.js')).TerminalAccess,
    CompanyRepository: (await load('../scripts/data/CompanyRepository.js')).CompanyRepository,
    MarketClock: (await load('../scripts/services/MarketClockService.js')).MarketClock,
  };
  ({ FundRepository } = await load('../scripts/data/FundRepository.js'));
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  await init.runPhase('init');
  Apps = {
    Terminal: (await load('../scripts/ui/MarketTerminal/MarketTerminalApp.js')).MarketTerminalApp,
    GMConsole: (await load('../scripts/ui/GMConsole/GMConsoleApp.js')).GMConsoleApp,
    FundEditor: (await load('../scripts/ui/FundEditor/FundEditorApp.js')).FundEditorApp,
    Trade: (await load('../scripts/ui/TradeDialog/TradeDialogApp.js')).TradeDialogApp,
    CompanyEditor: (await load('../scripts/ui/CompanyEditor/CompanyEditorApp.js')).CompanyEditorApp,
  };
});

const settle = async () => {
  for (let i = 0; i < 3; i++) {
    for (const q of [S.TickService._queue, (await import('../scripts/init/registerTickSequence.js')).TickSequence._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue, S.CorporateActionService._queue, S.NewsService._queue]) await q;
  }
};

test('the GM makes a character with an Accounting skill a broker; their terms come from the sheet', async () => {
  assert.equal(await S.BrokerRepository.makeBrokerFromActor(fixer.id), true);
  const [broker] = S.BrokerRepository.list();
  assert.equal(broker.skill.total, 12);
  assert.equal(broker.skill.source, 'sheet');
  assert.equal(broker.grade, 'seasoned');
  assert.ok(broker.terms.commissionBps < 200, 'cheaper than direct');
  assert.ok(broker.terms.latency.min >= 1, 'never as fast as direct');

  assert.equal(S.BrokerRepository.candidateContacts().length, 1, 'only non-broker contacts are offered');
  assert.equal(await S.BrokerRepository.makeBrokerFromContact('c_plain'), true);
  assert.equal(S.BrokerRepository.list().length, 2);
  assert.equal(S.BrokerRepository.list().find((b) => b.id === 'c_plain').skill.source, 'manual');
});

test('funds and brokers show in the terminal, and the portfolio has the access panel', async () => {
  await S.ImportService.importStarter();
  const { created } = await S.FundService.importStarter();
  assert.ok(created > 0, 'starter funds import');
  await S.TickService.syncCompanies();
  await S.PortfolioClient.submit(alice, 'deposit', { amount: 20000 });
  await S.PortfolioClient.setBroker(alice, 'c_1');
  await settle();

  const fund = FundRepository.all()[0];
  await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'broker', side: 'buy', assetId: fund.id, qty: 2, orderType: 'market', expiry: 'day' });
  await settle();

  const app = new Apps.Terminal();
  app.actorId = alice.id;
  app.tab = 'market';
  let html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'market tab with funds');
  const lists = [...html.matchAll(/<table class="nci-market nci-listcols">[\s\S]*?<\/thead>/g)];
  assert.equal(lists.length, 2, 'companies and funds');
  for (const list of lists) assert.equal(list[0].match(/<th[ >]/g).length, 8, 'sharing their columns');
  assert.ok(html.indexOf('nci-tabs') < html.indexOf('nci-header'), 'the tabs come first, then the index and mood');
  assert.ok(text(html).includes(fund.name), 'fund listed');

  app.selectedId = fund.id;
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'fund page');
  assert.ok(text(html).includes('only be bought and sold through a broker'));
  assert.ok(text(html).includes('What it holds'));
  assert.ok(html.includes('data-action="trade"'));

  app.selectedId = null;
  app.tab = 'portfolio';
  html = await accountPages(app, render);
  assertClean(html, 'portfolio tab');
  assert.ok(!html.includes('nci-header'), 'the index and mood are on the Market tab only');
  const t = text(html);
  assert.ok(t.includes('Your broker') && t.includes('Fixer'), 'the broker is shown');
  assert.ok(t.includes('Seasoned (12)'), 'skill read from the sheet');
  assert.ok(t.includes('Direct trading') && t.includes('DV 13'), 'terminal rule shown');
  assert.ok(html.includes('data-action="connectTerminal"'));
  assert.ok(t.includes('connected to the CorpNet network'), 'explains the CorpNet requirement');
  assert.ok(html.includes('name="brokerId"') && html.includes('data-notify="fills"'));
});

test('the trade dialog offers the right routes', async () => {
  const stock = new Apps.Trade({ actorId: alice.id, assetId: 'ARA', side: 'buy' });
  let ctx = await stock._prepareContext();
  assert.equal(ctx.route, 'broker', 'defaults to the broker when one is assigned');
  assert.equal(stock._ctx.routes.direct.enabled, false, 'direct needs a terminal session');
  assert.equal(stock._ctx.routes.broker.enabled, true);
  let html = render('templates/dialogs/trade.hbs', ctx);
  assertClean(html, 'stock trade');
  assert.ok(html.includes('name="route"'));
  assert.ok(text(html).includes('needs a CorpNet terminal session'));

  const fund = FundRepository.all()[0];
  const fundDialog = new Apps.Trade({ actorId: alice.id, assetId: fund.id, side: 'buy' });
  ctx = await fundDialog._prepareContext();
  assert.deepEqual(Object.keys(ctx.orderTypes), ['market'], 'funds take market orders only');
  assert.equal(fundDialog._ctx.routes.direct.enabled, false, 'funds are never direct');
  assert.ok(fundDialog._ctx.routes.broker.fundBps.buy !== undefined);
  html = render('templates/dialogs/trade.hbs', ctx);
  assertClean(html, 'fund trade');

  env.store.set('directTradingMode', 'open');
  const open = new Apps.Trade({ actorId: alice.id, assetId: 'ARA', side: 'buy' });
  await open._prepareContext();
  assert.equal(open._ctx.routes.direct.enabled, true, 'open mode needs no session');
  env.store.set('directTradingMode', 'terminal');
});

test('GM console funds and brokers tabs, and the fund editor, render', async () => {
  const app = new Apps.GMConsole();
  const labels = {};
  for (const tab of ['funds', 'brokers']) {
    app.tab = tab;
    const html = render('templates/gm/console.hbs', await app._prepareContext());
    assertClean(html, `GM ${tab} tab`);
    labels[tab] = text(html);
  }
  assert.ok(labels.funds.includes('New fund'));
  assert.ok(labels.brokers.includes('Fixer') && labels.brokers.includes('Seasoned (12)'));
  assert.ok(labels.brokers.includes('from sheet') && labels.brokers.includes('set by GM'));
  assert.ok(labels.brokers.includes('Alice'), 'terminal grants list the player characters');

  app.tab = 'brokers';
  app.render = () => {};
  assert.equal(S.TerminalAccess.granted(alice), false);
  await Apps.GMConsole.DEFAULT_OPTIONS.actions.toggleGrant.call(app, null, { dataset: { id: alice.id } });
  assert.equal(S.TerminalAccess.granted(alice), true, 'the GM can grant terminal access');
  await Apps.GMConsole.DEFAULT_OPTIONS.actions.toggleGrant.call(app, null, { dataset: { id: alice.id } });
  assert.equal(S.TerminalAccess.granted(alice), false);

  const fund = FundRepository.all()[0];
  let html = render('templates/gm/fund-editor.hbs', await new Apps.FundEditor({ fundId: fund.id })._prepareContext());
  assertClean(html, 'fund editor');
  assert.ok(html.includes(`value="${fund.ticker}"`));
  assert.ok(html.includes('name="components"'));
  html = render('templates/gm/fund-editor.hbs', await new Apps.FundEditor({ fundId: null })._prepareContext());
  assertClean(html, 'new fund editor');
  assert.ok(html.includes('name="initialNav"'), 'a new fund can set its starting value');
});

test('the fund service stores a new fund and rejects unknown holdings', async () => {
  const before = FundRepository.all().length;
  const bad = await S.FundService.save({ name: 'Ghost Fund', ticker: 'GHOST', components: 'NOPE 10' });
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.includes('components-unknown'));

  const ok = await S.FundService.save({ name: 'Arms Mix', ticker: 'ARMX', kind: 'themed', components: 'ARA 60\nMIL 40' });
  assert.equal(ok.ok, true);
  assert.equal(FundRepository.all().length, before + 1);
  assert.equal(FundRepository.componentsText(FundRepository.get('ARMX')), 'ARA 60\nMIL 40');
});

test('the GM console shows previews, glides and undo, and the terminal lists upcoming IPOs', async () => {
  await S.TickService.advance(2);
  await settle();

  const app = new Apps.GMConsole();
  app.render = () => {};
  app._showPreview({ kind: 'bias', target: 'company:ARA', value: 1.5, days: 10, decay: 'flat' }, 20, 'Sentiment');
  assert.ok(app.preview, 'the preview was built');

  app.tab = 'market';
  let html = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(html, 'market tab with a preview');
  assert.ok(html.includes('<polygon'), 'the cone is drawn');
  assert.ok(text(html).includes('Close preview') && text(html).includes('Undo last tick'));
  assert.ok(text(html).includes('Typical result'), 'the summary is shown');
  assert.ok(html.includes('data-action="previewBias"'));
  assert.ok(html.includes('data-action="advanceDay"') && text(html).includes('Advance 1 day') && text(html).includes('Advance 30 ticks'), 'ticks and a whole day can both be advanced');
  const at = (s) => html.indexOf(s);
  assert.ok(at('class="nci-preview"') > at('data-action="previewBias"'), 'the preview sits below the Preview button');
  assert.ok(at('class="nci-preview"') > at('<h3>Market sentiment') || at('class="nci-preview"') > at('data-action="addBias"'), 'and inside the sentiment block, not at the top of the window');
  assert.equal((html.match(/class="nci-preview"/g) ?? []).length, 1);
  assert.ok(at('class="nci-preview"') < at('data-action="forceRegime"'), 'before the next section');

  app.tab = 'events';
  html = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(html, 'events tab');
  assert.equal(html.includes('class="nci-preview"'), false, 'a sentiment preview does not show on the events tab');
  assert.ok(text(html).includes('Scripted glide') && html.includes('data-action="addGlide"') && html.includes('data-action="previewShock"'));

  app._showPreview({ kind: 'shock', target: 'company:ARA', percent: -8, delayDays: 1, persistence: 'standard' }, 20, 'Shock');
  html = render('templates/gm/console.hbs', await app._prepareContext());
  assert.equal((html.match(/class="nci-preview"/g) ?? []).length, 1);
  assert.ok(html.indexOf('class="nci-preview"') > html.indexOf('data-action="previewShock"'), 'a shock preview sits below its button');
  assert.ok(html.indexOf('class="nci-preview"') < html.indexOf('data-action="previewGlide"'), 'above the glide section');

  app._showPreview({ kind: 'glide', companyId: 'ARA', target: 130, days: 10, noise: 0.25 }, 20, 'Glide');
  html = render('templates/gm/console.hbs', await app._prepareContext());
  assert.equal((html.match(/class="nci-preview"/g) ?? []).length, 1);
  assert.ok(html.indexOf('class="nci-preview"') > html.indexOf('data-action="previewGlide"'), 'a glide preview sits below its button');

  // The Preview button is the toggle: it reads "Close preview" while its preview is open, and there is no second button.
  const button = (name) => (html.match(new RegExp(`<button[^>]*data-action="${name}"[^>]*>[\\s\\S]*?</button>`)) ?? [''])[0];
  assert.ok(text(button('previewGlide')).includes('Close preview'), 'the open preview\'s button offers to close it');
  assert.ok(text(button('previewShock')).includes('Preview') && !text(button('previewShock')).includes('Close'), 'the others still say Preview');
  assert.equal(html.includes('dismissPreview'), false, 'no separate close button');
  assert.equal(text(html).split('Close preview').length - 1, 1, 'only one Close preview on the page');

  const target = { closest: () => ({ querySelector: () => null }) };
  Apps.GMConsole.DEFAULT_OPTIONS.actions.previewGlide.call(app, null, target);
  assert.equal(app.preview, null, 'pressing it again closes the preview');
  html = render('templates/gm/console.hbs', await app._prepareContext());
  assert.equal(html.includes('class="nci-preview"'), false);
  assert.ok(!text(button('previewGlide')).includes('Close'), 'and the button reads Preview again');
});

test('IPO fields in the company editor, the GM list and the player terminal', async () => {
  const date = await marketDateIn(3);
  await S.CompanyRepository.save({
    name: 'Newco', ticker: 'NEWC', sector: 'tech', initialPrice: 40, listed: false, ipo: { date, price: 50, windowDays: 5, allocation: 200 },
  });
  await S.TickService.syncCompanies();
  await settle();

  const editor = render('templates/gm/company-editor.hbs', await new Apps.CompanyEditor({ companyId: 'NEWC' })._prepareContext());
  assertClean(editor, 'company editor');
  assert.ok(editor.includes('name="ipo.date"') && editor.includes(`value="${date}"`) && editor.includes('name="ipo.allocation"'));

  const gm = new Apps.GMConsole();
  gm.tab = 'companies';
  const list = render('templates/gm/console.hbs', await gm._prepareContext());
  assertClean(list, 'GM companies tab');
  assert.ok(text(list).includes('Subscriptions open, lists in 3 day(s)'), 'the IPO status is shown');
  assert.ok(list.includes('data-action="listNow"'));

  const terminal = new Apps.Terminal();
  terminal.actorId = alice.id;
  terminal.tab = 'market';
  const html = render('templates/terminal/market.hbs', await terminal._prepareContext());
  assertClean(html, 'terminal with an IPO');
  const t = text(html);
  assert.ok(t.includes('Upcoming IPOs') && t.includes('NEWC') && t.includes('50.00'));
  assert.ok(t.includes('200 shares on offer'));
  assert.ok(html.includes('data-action="subscribeIpo"'), 'the subscribe button is offered inside the window');

  await S.PortfolioClient.submit(alice, 'deposit', { amount: 5000 });
  await settle();
  const key = await S.PortfolioClient.submit(alice, 'subscribeIpo', { assetId: 'NEWC', qty: 10 });
  await settle();
  assert.equal(S.PortfolioRepository.get(alice).results.find((r) => r.key === key).ok, true);
  terminal.tab = 'portfolio';
  const pf = text(await accountPages(terminal, render));
  assert.ok(pf.includes('Subscribe 10 NEWC at 50.00 eb (IPO)') && pf.includes('Waiting for the listing'), 'the subscription shows in open orders');
  terminal.tab = 'market';
  assert.ok(!render('templates/terminal/market.hbs', await terminal._prepareContext()).includes('data-action="subscribeIpo"'), 'one subscription each');
});

test('alerts, statements and fund rebalancing show in the terminal and the fund editor', async () => {
  const app = new Apps.Terminal();
  app.actorId = alice.id;
  app.tab = 'portfolio';
  const ara = (await import('../scripts/data/MarketStore.js')).MarketStore.getPublic().companies.ARA.price;
  const k = await S.PortfolioClient.setAlert(alice, { assetId: 'ARA', kind: 'above', value: Math.round(ara * 1.2), once: false });
  const k2 = await S.PortfolioClient.setAlert(alice, { assetId: 'N54', kind: 'move', value: 7 });
  await settle();
  assert.ok(k && k2);

  let html = await accountPages(app, render);
  assertClean(html, 'portfolio with alerts');
  let t = text(html);
  assert.ok(t.includes('Price alerts') && t.includes('Add alert'));
  assert.ok(html.includes('name="alertAsset"') && html.includes('name="alertKind"') && html.includes('data-action="addAlert"'));
  assert.ok(t.includes(`ARA rises above ${Number(Math.round(ara * 1.2)).toFixed(2)} eb`), 'the alert is described');
  assert.ok(t.includes('N54 moves 7% or more in a day'));
  assert.ok(t.includes('repeating') && t.includes('once'));
  assert.ok(html.includes('data-action="removeAlert"') && html.includes('data-action="requestStatement"'));
  assert.ok(t.includes('Monthly statement') && t.includes('Price alerts'), 'both are notification choices');
  assert.ok(html.includes('data-notify="alerts"') && html.includes('data-notify="statements"'));
  assert.ok(t.includes('Dividends received'));

  app.tab = 'market';
  app.selectedId = 'NC12';
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'fund page');
  assert.ok(text(html).includes('Rebalancing') && text(html).includes('Quarterly'));
  app.selectedId = 'CHRM';
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assert.ok(text(html).includes('Manager') && text(html).includes('+1.50% a year'));

  const FundRepository = (await import('../scripts/data/FundRepository.js')).FundRepository;
  const editor = render('templates/gm/fund-editor.hbs', await new Apps.FundEditor({ fundId: 'CHRM' })._prepareContext());
  assertClean(editor, 'fund editor');
  assert.ok(editor.includes('name="rebalance"') && editor.includes('<option value="monthly" selected>'));
  assert.ok(editor.includes('name="alphaPct"') && editor.includes('value="1.5"'));
  assert.equal(FundRepository.get('CHRM').managerAlpha, 0.015);
});

test('settling sales, fund income and redemption, the editor fields and the movers setting render', async () => {
  env.store.set('directTradingMode', 'open');
  env.store.set('directOrderExecution', 'instant');
  env.store.set('settlementDays', 2);
  const held = S.PortfolioRepository.get(alice).lots.filter((l) => l.assetId === 'ARA').reduce((s, l) => s + l.qty, 0);
  if (held < 3) {
    await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 5, orderType: 'market', expiry: 'day' });
    await settle();
  }
  const k = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'sell', assetId: 'ARA', qty: 2, orderType: 'market', expiry: 'day' });
  await settle();
  assert.ok(k);
  assert.equal(S.PortfolioRepository.get(alice).unsettled.length, 1, 'the sale is settling');

  const app = new Apps.Terminal();
  app.actorId = alice.id;
  app.tab = 'portfolio';
  let html = await accountPages(app, render);
  assertClean(html, 'portfolio with a settling sale');
  let t = text(html);
  assert.ok(t.includes('Settling'), 'summary row');
  assert.ok(/Sale of ARA: [\d,]+ eb\s+&mdash;\s+spendable in 2 day\(s\)/.test(t), `the line is listed: ${t.slice(t.indexOf('Sale of'), t.indexOf('Sale of') + 80)}`);
  assert.ok(html.includes('name="moverPct"') && html.includes('data-notify="movers"'));
  assert.ok(t.includes('Big movers in your holdings'));

  const trade = new Apps.Trade({ actorId: alice.id, assetId: 'ARA', side: 'sell' });
  html = render('templates/dialogs/trade.hbs', await trade._prepareContext());
  assert.ok(text(html).includes('Sale proceeds take 2 day(s)'), 'the trade dialog warns about settlement');
  env.store.set('settlementDays', 0);
  const quick = new Apps.Trade({ actorId: alice.id, assetId: 'ARA', side: 'sell' });
  html = render('templates/dialogs/trade.hbs', await quick._prepareContext());
  assert.equal(text(html).includes('Sale proceeds take'), false, 'no note when sales settle at once');
  env.store.set('directTradingMode', 'terminal');

  app.tab = 'market';
  app.selectedId = 'SAFE';
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  assertClean(html, 'SAFE fund page');
  t = text(html);
  assert.ok(t.includes('Income') && t.includes('Paid out quarterly'));
  assert.ok(t.includes('Redemption') && t.includes('Paid at once'));
  app.selectedId = 'CHRM';
  html = render('templates/terminal/market.hbs', await app._prepareContext());
  t = text(html);
  assert.ok(t.includes('Reinvested in the fund') && t.includes('2 day(s) after a sale'));

  const editor = render('templates/gm/fund-editor.hbs', await new Apps.FundEditor({ fundId: 'SAFE' })._prepareContext());
  assertClean(editor, 'fund editor');
  assert.ok(editor.includes('name="distribution"') && editor.includes('<option value="distributing" selected>'));
  assert.ok(editor.includes('name="distributionFrequency"') && editor.includes('<option value="quarterly" selected>'));
  assert.ok(editor.includes('name="redeemDelay"') && editor.includes('value="0"'));
  const managed = render('templates/gm/fund-editor.hbs', await new Apps.FundEditor({ fundId: 'CHRM' })._prepareContext());
  assert.ok(managed.includes('name="redeemDelay"') && managed.includes('value="2"'));
});

test('the GM console Gigs tab shows what needs mapping, what awaits approval, mappings and history', async () => {
  const { GigImpactService } = await import('../scripts/services/GigImpactService.js');
  env.store.set('gigImpactApproval', true);
  await GigImpactService.report({ gigId: 'u1', outcome: 'done', client: 'Arasaka', reward: '2,500 eb', title: 'Courier run' });
  await GigImpactService.report({ gigId: 'u2', outcome: 'failed', client: 'Shady Fixer', reward: 700, title: 'Warehouse job' });
  await GigImpactService.addMapping('Old Friend', 'ignore');
  await GigImpactService.report({ gigId: 'u3', outcome: 'done', client: 'Old Friend' });
  await settle();

  const app = new Apps.GMConsole();
  app.tab = 'gigs';
  let ctx = await app._prepareContext();
  assert.equal(ctx.tabs.find((t) => t.id === 'gigs').count, 2, 'the tab shows how many need attention');
  let html = render('templates/gm/console.hbs', ctx);
  assertClean(html, 'gigs tab');
  let t = text(html);
  assert.ok(t.includes('Gig outcomes') && t.includes('Needs a company') && t.includes('Waiting for approval'));
  assert.ok(t.includes('Shady Fixer') && t.includes('Failed') && t.includes('700 eb') && t.includes('Warehouse job'));
  assert.ok(t.includes('ARA Arasaka') && t.includes('Completed') && t.includes('2,500 eb'));
  assert.ok(t.includes('Approval is switched on'));
  assert.ok(t.includes('Old Friend') && t.includes('Ignore this client'), 'the saved mapping is listed');
  assert.ok(t.includes('Ignored') && t.includes('Recent gig outcomes'));
  assert.ok(t.includes('Impacts wait for your approval'));
  for (const name of ['gigCompany', 'gigRemember', 'gigPercent', 'gigDelay', 'gigHeadline', 'mapClientName', 'mapCompany', 'reportClient', 'reportCompany', 'reportOutcome', 'reportReward']) {
    assert.ok(html.includes(`name="${name}"`), `${name} field`);
  }
  for (const action of ['gigMap', 'gigApprove', 'gigDiscard', 'gigAddMapping', 'gigRemoveMapping', 'gigReport', 'gigClearHistory']) {
    assert.ok(html.includes(`data-action="${action}"`), `${action} button`);
  }
  assert.ok(t.includes('Night City Map bridge module is not active'), 'warns when the bridge is not installed');
  const review = ctx.gig.review[0];
  assert.ok(html.includes(`value="${review.percent}"`) && html.includes(`value="${review.delayDays}"`), 'editable size and delay');
  assert.ok(html.includes(review.headline.replace(/'/g, '&#x27;')) || html.includes(review.headline), 'editable headline');

  globalThis.game.modules = new Map([['night-city-map-night-city-investments-bridge', { active: true }]]);
  ctx = await app._prepareContext();
  assert.equal(text(render('templates/gm/console.hbs', ctx)).includes('bridge module is not active'), false);
  globalThis.game.modules = new Map();

  const [first] = ctx.gig.review;
  assert.equal((await GigImpactService.approve(first.id, { percent: 3, delayDays: 1 })).status, 'applied');
  await settle();
  app.tab = 'events';
  ctx = await app._prepareContext();
  assert.ok(ctx.impacts.some((i) => i.persistence === 'Gig' && i.label.includes('+3%')), 'the events queue labels it as a gig impact');
  app.tab = 'tools';
  ctx = await app._prepareContext();
  assert.ok(ctx.log.some((l) => l.text.includes('Gig outcome on ARA')), 'and the log on the Audit tab records it');

  for (const p of (await import('../scripts/data/MarketStore.js')).MarketStore.getGigs().pending) await GigImpactService.discard(p.id);
  await settle();
  assert.equal((await app._prepareContext()).tabs.find((x) => x.id === 'gigs').label, 'Gigs');
});

test('the Brokers tab shows each broker\'s voice', async () => {
  fixer.system.lifepath = { personality: 'Sneaky and deceptive' };
  const app = new Apps.GMConsole();
  app.tab = 'brokers';
  let t = text(render('templates/gm/console.hbs', await app._prepareContext()));
  assert.ok(t.includes('Voice: Sneaky and deceptive'), 'a sheet with a Personality');
  assert.ok(t.includes('Voice: Standard'), 'a contact with no sheet');
  fixer.system.lifepath = { personality: 'Brooding' };
  t = text(render('templates/gm/console.hbs', await app._prepareContext()));
  assert.equal(t.includes('Sneaky and deceptive'), false);
  assert.equal(t.includes('Voice: Sneaky'), false, 'an unknown Personality falls back to the standard wording');
});

test('the GM console Heat tab lists heat, open windows and audits, read-only', async () => {
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  const { emptyHeat, makeWindow, addWindow, applyAudit } = await import('../scripts/engine/index.js');
  env.store.set('heatEnabled', false);
  const app = new Apps.GMConsole();
  app.tab = 'heat';
  let html = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(html, 'heat tab, empty');
  let t = text(html);
  assert.ok(t.includes('Insider-trading heat') && t.includes('switched off'), 'warns when tracking is off');
  assert.ok(t.includes('Nobody has any heat') && t.includes('No open windows') && t.includes('No audits yet'));
  for (const tier of ['Quiet', 'Noticed', 'Flagged', 'Investigated']) assert.ok(t.includes(tier));

  env.store.set('heatEnabled', true);
  const tick = MarketStore.getPublic().tickIndex ?? 0;
  const closed = makeWindow({ id: 'wa', sourceKey: 'gig:a:done', companyId: 'ARA', outcome: 'done', openTick: tick, closeTick: tick, openDate: '2045-03-15' });
  const open = makeWindow({ id: 'wb', sourceKey: 'gig:b:failed', companyId: 'MIL', outcome: 'failed', openTick: tick, closeTick: tick + 2, openDate: '2045-03-16', tipped: ['x'] });
  const waiting = makeWindow({ id: 'wc', sourceKey: 'gig:c:done', companyId: 'BIO', outcome: 'done', openTick: Math.max(0, tick - 3), closeTick: Math.max(0, tick - 2) });
  let heat = addWindow(addWindow(addWindow(emptyHeat(), closed), open), waiting);
  heat = applyAudit(heat, {
    window: closed, tick, date: '2045-03-15',
    results: [{ actorId: alice.id, name: 'Alice', gain: 62.5, trades: [{ orderId: 'o1', side: 'buy', gross: 4800, route: 'direct', submittedTick: tick, knowledge: 'general', gain: 62.5 }] }],
  });
  await MarketStore.setHeat(heat);

  html = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(html, 'heat tab');
  t = text(html);
  assert.equal(t.includes('switched off'), false);
  assert.ok(t.includes('Alice') && t.includes('62.5') && t.includes('Flagged'), 'the character, heat and tier');
  assert.ok(html.includes('width: 62%') || html.includes('width: 63%'), 'a bar');
  assert.ok(t.includes('+62.5 on ARA Arasaka'), 'the latest gain');
  assert.ok(t.includes('MIL Militech') && t.includes('Bad news coming') && t.includes('closes in 3 day(s)') && t.includes('Sent a rumour: 1'), 'an open window');
  assert.ok(t.includes('BIO Biotechnica') && t.includes('closed, waiting for orders to fill'), 'a closed window still waiting');
  assert.ok(t.includes('Buy, 4,800 eb, Direct (terminal), no inside knowledge: +62.5'), `the audit shows the trade: ${t.slice(t.indexOf('Recent audits'))}`);
  assert.equal(/data-action="heatApprove|heatDismiss/.test(html), false, 'no penalty waiting, so nothing to approve');
  assert.ok(html.includes('data-action="heatSet"') && html.includes('data-action="heatClear"') && html.includes('name="heatValue"'), 'the GM can set or clear heat');
  assert.equal((await app._prepareContext()).tabs.find((x) => x.id === 'heat').label, 'Heat');

  await MarketStore.setHeat(emptyHeat());
  env.store.set('heatEnabled', false);
});

test('the terminal shows the cover-your-tracks panel only to a warned player, with cooldown, poverty and freeze states', async () => {
  const { PortfolioRepository } = await import('../scripts/data/PortfolioRepository.js');
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  env.store.set('heatEnabled', true);
  env.store.set('heatConsequences', true);
  const tick = MarketStore.getPublic().tickIndex ?? 0;
  const base = PortfolioRepository.get(alice);
  const app = new Apps.Terminal();
  app.actorId = alice.id;
  app.tab = 'portfolio';
  const view = async () => {
    const html = await accountPages(app, render);
    assertClean(html, 'terminal portfolio');
    return html;
  };
  const buttons = (html) => [...html.matchAll(/<button[^>]*data-action="coverTracks"[^>]*data-id="(\w+)"([^>]*)>/g)].map((m) => ({ id: m[1], disabled: /disabled/.test(m[0]) }));

  await PortfolioRepository.save(alice, { ...base, heatAware: false });
  let html = await view();
  assert.equal(html.includes('Cover your tracks'), false, 'hidden until the player has been warned');
  assert.equal(buttons(html).length, 0);

  await PortfolioRepository.save(alice, { ...base, cash: 10000, heatAware: true, frozenUntilTick: 0, heatCooldowns: { mask: 0, books: 0, front: 0, bribe: 0 } });
  html = await view();
  let t = text(html);
  assert.ok(t.includes('Cover your tracks') && t.includes('Mask the pattern') && t.includes('Cook the books') && t.includes('Front company') && t.includes('Pay someone off'));
  assert.ok(t.includes('Trading') && t.includes('Accounting') && t.includes('Business') && t.includes('Bribery'), 'each action names its skill');
  assert.ok(t.includes('against DV 13') && t.includes('against DV 17'));
  assert.equal(buttons(html).length, 4);
  assert.ok(buttons(html).every((b) => !b.disabled), 'all four are available');

  await PortfolioRepository.save(alice, { ...base, cash: 200, heatAware: true, heatCooldowns: { mask: tick + 3, books: 0, front: 0, bribe: 0 } });
  html = await view();
  t = text(html);
  const byId = Object.fromEntries(buttons(html).map((b) => [b.id, b.disabled]));
  assert.equal(byId.mask, true, 'cooling down');
  assert.equal(byId.books, true, 'too poor');
  assert.ok(t.includes('Ready in') && t.includes('Not enough in your account'));

  await PortfolioRepository.save(alice, { ...base, cash: 10000, heatAware: true, frozenUntilTick: tick + 4, brokerBans: { c_1: tick + 5 } });
  html = await view();
  t = text(html);
  assert.ok(t.includes(`frozen until day ${tick + 4}`), 'a frozen banner');
  assert.ok(t.includes(`will not take you back until day ${tick + 5}`), 'a broker ban banner');

  env.store.set('heatConsequences', false);
  assert.equal((await view()).includes('Cover your tracks'), false, 'hidden when consequences are off');

  await PortfolioRepository.save(alice, { ...base, heatAware: false, frozenUntilTick: 0, brokerBans: { c_1: 0 } });
  env.store.set('heatConsequences', true);
  env.store.set('heatEnabled', false);
});

test('the GM Heat tab shows waiting penalties with editable amounts, history, and wired buttons', async () => {
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  const { emptyHeat, makePenalty } = await import('../scripts/engine/index.js');
  env.store.set('heatEnabled', true);
  const tick = MarketStore.getPublic().tickIndex ?? 0;
  const fine = makePenalty({ id: 'p1', actorId: alice.id, name: 'Alice', plan: { kind: 'fine', amount: 750 }, tick, date: '2045-03-20', sourceKey: 'gig:a:done', heat: 88 });
  const freeze = makePenalty({ id: 'p2', actorId: alice.id, name: 'Alice', plan: { kind: 'freeze', days: 3 }, tick, date: '2045-03-21', sourceKey: 'gig:b:done', heat: 80 });
  const done = { ...makePenalty({ id: 'p3', actorId: alice.id, name: 'Alice', plan: { kind: 'dropBroker', brokerId: 'c_1', banDays: 14 }, tick, date: '2045-03-10', sourceKey: 'gig:c:done', heat: 78 }), status: 'applied', result: { dropped: true } };
  await MarketStore.setHeat({ ...emptyHeat(), penalties: [fine, freeze, done] });

  const app = new Apps.GMConsole();
  app.tab = 'heat';
  const html = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(html, 'heat tab with penalties');
  const t = text(html);
  assert.ok(t.includes('Fine of 750 eb') && t.includes('Account frozen for 3 day(s)'), 'both waiting penalties');
  assert.ok(html.includes('name="penaltyAmount"') && html.includes('value="750"'), 'the fine amount is editable');
  assert.ok(html.includes('name="penaltyDays"') && html.includes('value="3"'), 'the freeze length is editable');
  assert.equal((html.match(/data-action="heatApprove"/g) ?? []).length, 2);
  assert.equal((html.match(/data-action="heatDismiss"/g) ?? []).length, 2);
  assert.ok(html.includes('data-id="p1"') && html.includes('data-id="p2"') && !html.includes('data-id="p3"'), 'only waiting cases have buttons');
  assert.ok(t.includes('Applied') === false && t.includes('Carried out'), 'the finished case is in the history');
  assert.equal(t.includes('Nothing has been proposed'), false);

  const actions = Apps.GMConsole.DEFAULT_OPTIONS.actions;
  for (const name of ['heatApprove', 'heatDismiss', 'heatSet', 'heatClear']) assert.equal(typeof actions[name], 'function', `${name} has a handler`);
  assert.equal(typeof Apps.Terminal.DEFAULT_OPTIONS.actions.coverTracks, 'function', 'coverTracks has a handler');

  await MarketStore.setHeat(emptyHeat());
  env.store.set('heatEnabled', false);
});

test('every data-action in the new templates has a handler and none is reserved', () => {
  const RESERVED = ['close', 'tab', 'toggleControls'];
  const pairs = [
    ['templates/gm/fund-editor.hbs', Apps.FundEditor],
    ['templates/gm/console.hbs', Apps.GMConsole],
    ['templates/terminal/market.hbs', Apps.Terminal],
    ['templates/dialogs/trade.hbs', Apps.Trade],
  ];
  for (const [file, App] of pairs) {
    // A Pending row's actions are filled in when it is drawn: the Pending tab's test checks those it draws.
    const used = [...withPartials(root, file).matchAll(/data-action="([^"{]+)"/g)].map((m) => m[1]);
    const defined = Object.keys(App.DEFAULT_OPTIONS.actions ?? {});
    for (const action of used) {
      assert.equal(RESERVED.includes(action), false, `${file}: "${action}" is reserved`);
      assert.ok(defined.includes(action), `${file}: no handler for "${action}"`);
    }
  }
});
