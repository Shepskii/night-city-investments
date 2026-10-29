import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Handlebars from 'handlebars';
import { registerPartials } from './helpers/partials.mjs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerPartials(Handlebars, root);
const lang = JSON.parse(readFileSync(join(root, 'lang', 'en.json'), 'utf8'));

const env = installFakeFoundry({ actors: [['Medtech', 50000, true], ['Fixer', 50000, true]] });
const [med, fix] = env.actors;
globalThis.game.nightcity = { masterContactService: { filterByTag: () => [], getAll: () => [] }, networkService: { isOnNetwork: () => false } };
env.store.set('syndicateApproval', false);
env.store.set('directOrderExecution', 'instant');

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
const BAD = ['[object Object]', 'NaN', 'undefined', 'NCI.', '{n}', '{name}', '{amount}', '{units}'];
const assertClean = (html, label) => {
  for (const bad of BAD) assert.equal(html.includes(bad), false, `${label} contains "${bad}"`);
};
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/\s+/g, ' ');

let S;
let Apps;
before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    SyndicateClient: (await load('../scripts/services/SyndicateClient.js')).SyndicateClient,
    SyndicateService: (await load('../scripts/services/SyndicateService.js')).SyndicateService,
    SyndicateRepository: (await load('../scripts/data/SyndicateRepository.js')).SyndicateRepository,
    TickSequence: (await load('../scripts/init/registerTickSequence.js')).TickSequence,
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await load('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  await init.runPhase('init');
  Apps = {
    Terminal: (await load('../scripts/ui/MarketTerminal/MarketTerminalApp.js')).MarketTerminalApp,
    Trade: (await load('../scripts/ui/TradeDialog/TradeDialogApp.js')).TradeDialogApp,
    GMConsole: (await load('../scripts/ui/GMConsole/GMConsoleApp.js')).GMConsoleApp,
  };
  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  for (const a of [med, fix]) await S.PortfolioClient.submit(a, 'deposit', { amount: 20000 });
  await settle();
});

const settle = async () => {
  for (let i = 0; i < 4; i++) {
    await new Promise((r) => setTimeout(r, 2));
    for (const q of [S.TickService._queue, S.TickSequence._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.SyndicateClient._chain]) await q;
  }
};
const send = async (actor, type, payload = {}) => {
  await S.SyndicateClient.submit(actor, type, payload);
  await S.SyndicateService.processActor(actor);
};
const portfolioTab = async (actorId) => {
  const app = new Apps.Terminal();
  app.actorId = actorId;
  app.tab = 'portfolio';
  return render('templates/terminal/market.hbs', await app._prepareContext());
};
const syndicate = () => S.SyndicateRepository.all()[0];
const key = (actor) => `syn:${syndicate().id}:${actor.id}`;

test('a character\'s Portfolio tab offers to start a syndicate and invite the others', async () => {
  const html = await portfolioTab(med.id);
  assertClean(html, 'character portfolio');
  assert.match(text(html), /Start a syndicate/);
  assert.match(html, /name="synInvite" value="a_Fixer"/);
  assert.match(html, /data-action="synFound"/);
  assert.match(html, /data-action="deposit"/, 'a character still has the wallet box');
  const at = (needle) => html.indexOf(needle);
  const order = [at('data-action="deposit"'), at('Trading access'), at('>Syndicates<'), at('>Start a syndicate<'), at('>Positions<'), at('>Open orders<')];
  assert.ok(order.every((x) => x >= 0), `every section is there: ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'money in and out first, then trading access, syndicates, positions and orders');
});

test('the invited character sees the invitation; once a member, the syndicate joins the account picker', async () => {
  await send(med, 'found', { name: 'Back Room Capital', invite: [fix.id] });
  const invited = await portfolioTab(fix.id);
  assertClean(invited, 'invitation');
  assert.match(text(invited), /Medtech invites you to join Back Room Capital/);
  assert.match(invited, /data-action="synJoin"/);

  await send(fix, 'join', { syndicateId: syndicate().id });
  await send(med, 'deposit', { syndicateId: syndicate().id, amount: 6000 });
  await send(fix, 'deposit', { syndicateId: syndicate().id, amount: 3000 });
  const mine = await portfolioTab(med.id);
  assert.match(text(mine), /Back Room Capital \(syndicate, as Medtech\)/);
  assert.match(mine, new RegExp(`data-action="synOpen" data-key="${key(med)}"`));
});

test('picked as a member, the Portfolio tab is the syndicate\'s account with its panel, and no wallet box', async () => {
  const html = await portfolioTab(key(med));
  assertClean(html, 'syndicate portfolio');
  const t = text(html);
  assert.match(t, /Syndicate: Back Room Capital/);
  assert.match(t, /Value per unit \(NAV\) 1\.00 eb/);
  assert.match(t, /Your units 6,000 \(66\.7%\)/);
  assert.match(t, /Officers trade up to 5,000 eb an order/);
  assert.match(t, /Fixer member 3,000 33\.3% 3,000 eb/);
  assert.match(html, /data-action="synDeposit"/);
  assert.match(html, /data-action="synPropose"/);
  assert.doesNotMatch(html, /data-action="deposit"/, 'no wallet deposit for a syndicate');
  assert.doesNotMatch(html, /data-action="coverTracks"/);
});

test('a member votes on an open proposal from the panel', async () => {
  await send(fix, 'propose', { syndicateId: syndicate().id, kind: 'limit', amount: 8000 });
  const html = await portfolioTab(key(med));
  assertClean(html, 'proposal');
  const t = text(html);
  assert.match(t, /Set the officers' limit to 8,000 eb an order/);
  assert.match(t, /Yes 33%/);
  assert.match(html, /data-action="synVote" data-id="[^"]+" data-yes="true"/);
});

test('the trade dialog tells an officer the limit, and a member that only officers trade', async () => {
  const [assetId] = Object.keys(S.MarketStore.getPublic().companies);
  const dialog = async (actor) => {
    const app = new Apps.Trade({ actorId: key(actor), assetId, side: 'buy' });
    return text(render('templates/dialogs/trade.hbs', await app._prepareContext()));
  };
  assert.match(await dialog(med), /Officers trade up to 5,000 eb an order; a bigger one is sent to the members/);
  assert.match(await dialog(fix), /Only the syndicate's officers can trade its account/);
});

test('the GM Console Syndicates tab shows each syndicate, its account and its open proposals', async () => {
  const app = new Apps.GMConsole();
  app.tab = 'syndicates';
  const html = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(html, 'syndicates tab');
  const t = text(html);
  assert.match(t, /Back Room Capital trading/);
  assert.match(t, /Medtech \(officer, 67%\), Fixer \(member, 33%\)/);
  assert.match(t, /Cash 9,000 eb · value 9,000 eb · 1\.00 eb a unit · officers' limit 5,000 eb/);
  assert.match(t, /Set the officers' limit to 8,000 eb an order/);
  assert.match(html, /data-action="syndicatePass"/);
  assert.match(html, /data-action="syndicateVeto"/);
  assert.match(html, /data-action="syndicateClose"/, 'an account of nothing but cash can be closed');
  assert.match(t, /Syndicates/);
});
