import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Handlebars from 'handlebars';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const lang = JSON.parse(readFileSync(join(root, 'lang', 'en.json'), 'utf8'));
const MOD = 'night-city-investments';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Bob', 50000, true], ['Fixer', 0, false]] });
const [alice, bob, fixer] = env.actors;
fixer.system.stats = { int: { value: 6 } };
fixer.items = [{ type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } }];

const contacts = [
  { id: 'c_fix', name: 'Fixer', tags: ['broker'], actorId: fixer.id },
  { id: 'c_old', name: 'Old Hand', tags: ['broker'], actorId: null },
  { id: 'c_new', name: 'Newcomer', tags: [], actorId: null },
];
const updates = [];
game.nightcity = {
  masterContactService: {
    filterByTag: (t) => contacts.filter((c) => c.tags.includes(t)),
    getContact: (id) => contacts.find((c) => c.id === id) ?? null,
    getByActorId: (id) => contacts.find((c) => c.actorId === id) ?? null,
    getAll: () => contacts,
    addContact: async (d) => ({ success: true, contact: { id: 'c_made', tags: [], ...d } }),
    updateContact: async (id, u) => { updates.push([id, u]); Object.assign(contacts.find((c) => c.id === id), u); return { success: true }; },
  },
  networkService: { isOnNetwork: () => false },
};
globalThis.ui.notifications.error = () => {};

class StubApplication { constructor(options = {}) { this.options = options; } render() {} }
let confirmAnswer = true;
globalThis.foundry.applications = { api: { ApplicationV2: StubApplication, HandlebarsApplicationMixin: (Base) => Base, DialogV2: { confirm: async () => confirmAnswer } } };
globalThis.TextEditor = { enrichHTML: async (html) => html };
const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), lang);
game.i18n.localize = (key) => { const v = lookup(key); if (typeof v !== 'string') throw new Error(`Missing language key: ${key}`); return v; };
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (m, n) => (n in data ? data[n] : m));
Handlebars.registerHelper('localize', (key, options) => game.i18n.format(key, options?.hash ?? {}));
Handlebars.registerHelper('checked', (v) => (v ? 'checked' : ''));
Handlebars.registerHelper('selectOptions', () => '');
const render = (path, ctx) => Handlebars.compile(readFileSync(join(root, path), 'utf8'), { strict: false })(ctx);

let Brokers;
let Repo;
let GMConsole;

before(async () => {
  ({ BrokerRepository: Brokers } = await import('../scripts/data/BrokerRepository.js'));
  ({ PortfolioRepository: Repo } = await import('../scripts/data/PortfolioRepository.js'));
  ({ GMConsoleApp: GMConsole } = await import('../scripts/ui/GMConsole/GMConsoleApp.js'));
});

const ids = () => Brokers.list().map((b) => b.id).sort();
const give = (actor, patch) => { actor.flags[MOD] = { portfolio: { ...Repo.get(actor), ...patch } }; };

test('both brokers are listed to begin with', () => {
  assert.deepEqual(ids(), ['c_fix', 'c_old']);
  assert.equal(Brokers.isBroker('c_old'), true);
});

test('a broker no character is using can be removed, and nothing changes on the contact or the character', async () => {
  const before = JSON.stringify([contacts, fixer.items, fixer.system]);
  assert.deepEqual(await Brokers.remove('c_old'), { ok: true });
  assert.deepEqual(ids(), ['c_fix']);
  assert.equal(Brokers.get('c_old'), null);
  assert.equal(Brokers.isBroker('c_old'), false, 'mail to them is no longer treated as a broker order');
  assert.equal(JSON.stringify([contacts, fixer.items, fixer.system]), before, 'the NCM contact and the actor are exactly as they were');
  assert.deepEqual(updates, [], 'NCM was never written to');
  assert.deepEqual(Brokers.candidateContacts().map((c) => c.id).sort(), ['c_new', 'c_old'], 'they can be picked again');
  assert.equal(Brokers.executorMap().c_old, undefined, 'and players cannot choose them');
});

test('a removed broker can be made a broker again', async () => {
  assert.equal(await Brokers.makeBrokerFromContact('c_old'), true);
  assert.deepEqual(ids(), ['c_fix', 'c_old']);
  assert.equal(Brokers.isBroker('c_old'), true);
  assert.equal(Brokers.defs().c_old.removed, false);

  assert.deepEqual(await Brokers.remove('c_fix'), { ok: true });
  assert.equal(Brokers.byActor(fixer.id), null);
  assert.equal(await Brokers.makeBrokerFromActor(fixer.id), true);
  assert.deepEqual(ids(), ['c_fix', 'c_old'], 'a broker made from a character also comes back');
});

test('a broker is not removed while a character uses them', async () => {
  give(alice, { brokerContactId: 'c_fix' });
  const out = await Brokers.remove('c_fix');
  assert.deepEqual([out.ok, out.reason, out.names], [false, 'assigned', ['Alice']]);
  assert.deepEqual(ids(), ['c_fix', 'c_old']);
  assert.deepEqual(Brokers.usage('c_fix'), { assigned: ['Alice'], busy: [] });

  give(alice, { brokerContactId: null });
  assert.equal((await Brokers.remove('c_fix')).ok, true, 'free to go once they have picked another broker');
  await Brokers.makeBrokerFromActor(fixer.id);
});

test('nor while a character still has an order or a withdrawal with them', async () => {
  give(bob, { brokerContactId: 'c_old', orders: [] });
  give(alice, { brokerContactId: null, orders: [{ id: 'o1', status: 'open', brokerId: 'c_fix' }] });
  const out = await Brokers.remove('c_fix');
  assert.deepEqual([out.ok, out.reason, out.names], [false, 'busy', ['Alice']]);

  give(alice, { orders: [{ id: 'o1', status: 'filled', brokerId: 'c_fix' }], withdrawals: [{ id: 'w1', status: 'pending', brokerId: 'c_fix', amount: 10 }] });
  assert.equal((await Brokers.remove('c_fix')).reason, 'busy');
  give(alice, { withdrawals: [{ id: 'w1', status: 'paid', brokerId: 'c_fix', amount: 10 }] });
  assert.equal((await Brokers.remove('c_fix')).ok, true);
  await Brokers.makeBrokerFromActor(fixer.id);
});

test('unknown brokers and non-GMs are refused', async () => {
  assert.equal((await Brokers.remove('nope')).reason, 'unknown');
  game.user.isGM = false;
  assert.equal((await Brokers.remove('c_fix')).reason, 'gm-only');
  game.user.isGM = true;
  assert.deepEqual(ids(), ['c_fix', 'c_old']);
});

test('the Brokers tab offers a remove button, disabled while a broker is in use', async () => {
  give(bob, { brokerContactId: 'c_old', orders: [] });
  give(alice, { brokerContactId: null, orders: [], withdrawals: [] });
  const app = new GMConsole();
  app.render = () => {};
  app.tab = 'brokers';
  let html = render('templates/gm/console.hbs', await app._prepareContext());
  for (const bad of ['[object Object]', 'NaN', 'undefined', 'NCI.']) assert.equal(html.includes(bad), false, `contains ${bad}`);
  const button = (id) => html.match(new RegExp(`<button[^>]*data-action="removeBroker" data-id="${id}"[^>]*>`))?.[0];
  assert.ok(button('c_fix') && !/disabled/.test(button('c_fix')), 'free broker: enabled');
  assert.ok(/disabled/.test(button('c_old')), 'broker in use: disabled');
  assert.ok(html.replace(/<[^>]*>/g, ' ').includes('In use: Bob'));
  assert.equal(typeof GMConsole.DEFAULT_OPTIONS.actions.removeBroker, 'function');

  env.notices.length = 0;
  await GMConsole._onRemoveBroker.call(app, null, { dataset: { id: 'c_old' } });
  assert.ok(env.notices.some(([k, m]) => k === 'warn' && m.includes('Bob')), 'told why');
  assert.deepEqual(ids(), ['c_fix', 'c_old']);

  confirmAnswer = false;
  await GMConsole._onRemoveBroker.call(app, null, { dataset: { id: 'c_fix' } });
  assert.deepEqual(ids(), ['c_fix', 'c_old'], 'declining the confirmation removes nothing');

  confirmAnswer = true;
  env.notices.length = 0;
  await GMConsole._onRemoveBroker.call(app, null, { dataset: { id: 'c_fix' } });
  assert.deepEqual(ids(), ['c_old']);
  assert.ok(env.notices.some(([k, m]) => k === 'info' && m === 'Fixer is no longer a broker.'));

  html = render('templates/gm/console.hbs', await app._prepareContext());
  assert.equal(html.includes('data-action="removeBroker" data-id="c_fix"'), false, 'gone from the table');
});
