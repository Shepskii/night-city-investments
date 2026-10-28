import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Handlebars from 'handlebars';
import { registerPartials } from './helpers/partials.mjs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
registerPartials(Handlebars, root);
const lang = JSON.parse(readFileSync(join(root, 'lang', 'en.json'), 'utf8'));

const DAY_MS = 86_400_000;
const env = installFakeFoundry({ actors: [['Medtech', 4000, true], ['Fixer', 4000, true]] });
const [med, fix] = env.actors;
med.system.stats = { tech: { value: 7 }, luck: { value: 4, max: 4 } };
med.items = [{ type: 'skill', name: 'Cybertech', system: { level: 5, stat: 'tech' } }];
fix.system.stats = { cool: { value: 6 }, luck: { value: 3, max: 3 } };
fix.items = [{ type: 'role', name: 'Fixer', system: { rank: 4, mainRoleAbility: 'Operator' } }, { type: 'skill', name: 'Streetwise', system: { level: 4, stat: 'cool' } }];
const users = [{ id: 'u_med', isGM: false }, { id: 'u_fix', isGM: false }, { id: 'gm1', isGM: true }];
game.users = Object.assign(users, { activeGM: users[2], get: (id) => users.find((u) => u.id === id) });
for (const actor of env.actors) {
  const owner = actor === med ? 'u_med' : 'u_fix';
  actor.testUserPermission = (user) => user.isGM || user.id === 'gm1' || user.id === owner;
}
installFakeChat();

// Like ApplicationV2, some properties are read-only getters: assigning to one throws.
class StubApplication {
  constructor(options = {}) { this.options = options; }
  get title() { return this.options.window?.title ?? ''; }
  get element() { return null; }
  get id() { return this.options.id ?? ''; }
  get rendered() { return false; }
}
globalThis.foundry.applications = { api: { ApplicationV2: StubApplication, HandlebarsApplicationMixin: (Base) => Base } };

const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), lang);
game.i18n.localize = (key) => {
  const value = lookup(key);
  if (typeof value !== 'string') throw new Error(`Missing language key: ${key}`);
  return value;
};
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m));
Handlebars.registerHelper('localize', (key, options) => game.i18n.format(key, options?.hash ?? {}));

const render = (relativePath, context) => Handlebars.compile(readFileSync(join(root, relativePath), 'utf8'), { strict: false })(context);
const BAD = ['[object Object]', 'NaN', 'undefined', 'NCI.', '{n}', '{name}', '{amount}'];
const assertClean = (html, label) => {
  for (const bad of BAD) assert.equal(html.includes(bad), false, `${label} contains "${bad}"`);
  assert.ok(html.length > 200, `${label} rendered something`);
};
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

let Apps;
let S;
let dice = [];
before(async () => {
  S = {
    BusinessClient: (await import('../scripts/services/BusinessClient.js')).BusinessClient,
    BusinessService: (await import('../scripts/services/BusinessService.js')).BusinessService,
    BusinessRepository: (await import('../scripts/data/BusinessRepository.js')).BusinessRepository,
  };
  const { SkillAdapter } = await import('../scripts/services/SkillAdapter.js');
  SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 6, roll: null });
  Apps = {
    Business: (await import('../scripts/ui/Business/BusinessApp.js')).BusinessApp,
    Roll: (await import('../scripts/ui/Business/RollDialogApp.js')).RollDialogApp,
    GMConsole: (await import('../scripts/ui/GMConsole/GMConsoleApp.js')).GMConsoleApp,
  };
});

const send = async (actor, type, payload) => {
  await S.BusinessClient.submit(actor, type, payload);
  await S.BusinessService.processActor(actor);
};
const windowFor = (actor, tab = 'overview') => {
  const app = new Apps.Business();
  app.actorId = actor.id;
  app.tab = tab;
  return app;
};
const renderBusiness = async (app) => render('templates/business/business.hbs', await app._prepareContext());
const renderConsole = async () => {
  const app = new Apps.GMConsole();
  app.tab = 'businesses';
  return render('templates/gm/console.hbs', await app._prepareContext());
};

test('a character with no business sees the Start a business form', async () => {
  const html = await renderBusiness(windowFor(med));
  assertClean(html, 'start form');
  assert.match(text(html), /Start a business/);
  assert.match(text(html), /Ripperdoc clinic/);
  assert.match(html, /name="invite" value="a_Fixer"/);
});

test('an invited partner sees the invitation; the founder sees who they are waiting for', async () => {
  await send(med, 'found', { name: 'Back Room', archetype: 'clinic', location: 'Watson', cash: 1000, gear: [{ name: 'Surgical kit', value: 800 }], invite: [fix.id] });
  const invite = await renderBusiness(windowFor(fix));
  assertClean(invite, 'invitation');
  assert.match(text(invite), /You are invited/);

  const founder = await renderBusiness(windowFor(med));
  assertClean(founder, 'forming overview');
  assert.match(text(founder), /Waiting for: Fixer/);
  assert.doesNotMatch(founder, /data-action="setupRoll"/, 'no setup roll until every invitation is answered');
});

test('once everyone has answered, the setup roll is offered, with a preview', async () => {
  await send(fix, 'join', { businessId: S.BusinessRepository.all()[0].id, cash: 1500 });
  const html = await renderBusiness(windowFor(fix));
  assertClean(html, 'ready to roll');
  assert.match(html, /data-action="setupRoll"/);

  const b = S.BusinessRepository.all()[0];
  const dialog = new Apps.Roll({ actorId: fix.id, businessId: b.id, request: { type: 'setupRoll', businessId: b.id }, rollTitle: 'Setting up' });
  const roll = render('templates/dialogs/roll.hbs', await dialog._prepareContext());
  assertClean(roll, 'setup roll dialog');
  assert.match(text(roll), /Operator \(rank 4\)/, 'the role ability is offered at its rank');
  assert.match(text(roll), /A good hire/, 'a hired professional is offered');
  assert.match(text(roll), /Chance to succeed/);
});

test('waiting for the GM: the player is told, and the GM tab offers approval', async () => {
  const b = S.BusinessRepository.all()[0];
  dice = [9];
  await S.BusinessClient.roll(fix, b, { type: 'setupRoll', businessId: b.id, use: { kind: 'ability', ability: 'Operator' } }, { title: 'Setup' });
  await S.BusinessService.processActor(fix);
  assert.equal(S.BusinessRepository.all()[0].status, 'pending');

  const player = await renderBusiness(windowFor(med));
  assertClean(player, 'pending overview');
  assert.match(text(player), /The GM has to approve/);

  const gm = await renderConsole();
  assertClean(gm, 'GM businesses tab');
  assert.match(text(gm), /Businesses \(1\)/, 'the tab counts what is waiting');
  assert.match(gm, /data-action="businessApprove"/);
});

test('open: every tab renders, and the week offers its five actions', async () => {
  await S.BusinessService.approve(S.BusinessRepository.all()[0].id);
  for (const tab of ['overview', 'week', 'ledger', 'partners']) {
    const html = await renderBusiness(windowFor(med, tab));
    assertClean(html, `open ${tab}`);
  }
  const week = text(await renderBusiness(windowFor(med, 'week')));
  for (const name of ['Work the shop', 'Promote', 'Source supplies', 'Fix the place up', 'Keep it safe']) assert.match(week, new RegExp(name));
  const partners = text(await renderBusiness(windowFor(med, 'partners')));
  assert.match(partners, /Medtech/);
  assert.match(partners, /Book value per unit/);

  const b = S.BusinessRepository.all()[0];
  const dialog = new Apps.Roll({ actorId: fix.id, businessId: b.id, request: { type: 'assist', businessId: b.id, forAction: 'work' }, rollTitle: 'Helping' });
  const help = render('templates/dialogs/roll.hbs', await dialog._prepareContext());
  assertClean(help, 'complementary check dialog');
  assert.doesNotMatch(text(help), /hire/i, 'no hired professional for a complementary check');
});

test('after a week closes, the ledger shows the digest and the draw', async () => {
  const b = S.BusinessRepository.all()[0];
  env.clock.ms += (b.period.endDay - Math.floor(env.clock.ms / DAY_MS)) * DAY_MS;
  await S.BusinessService.onTick();
  const html = await renderBusiness(windowFor(fix, 'ledger'));
  assertClean(html, 'ledger with a week');
  assert.match(text(html), /Week 1/);
  assert.match(text(html), /You may draw up to/);

  const gm = await renderConsole();
  assertClean(gm, 'GM tab with an open business');
  assert.match(text(gm), /Exposure/);
});
