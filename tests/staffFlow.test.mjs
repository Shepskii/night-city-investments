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
const env = installFakeFoundry({ actors: [['Medtech', 6000, true], ['Fixer', 4000, true], ['Nova', 100, true], ['Rook', 50, true]] });
const [med, fix, nova, rook] = env.actors;
med.system.stats = { tech: { value: 7 }, int: { value: 6 }, luck: { value: 4, max: 4 } };
med.items = [{ type: 'skill', name: 'Cybertech', system: { level: 5, stat: 'tech' } }];
fix.system.stats = { cool: { value: 6 }, luck: { value: 3, max: 3 } };
// Nova: Paramedic 12 (TECH 7 + 5), a fair floor hand at a clinic.
nova.system.stats = { tech: { value: 7 }, luck: { value: 5, max: 5 } };
nova.items = [{ type: 'skill', name: 'Paramedic', system: { level: 5, stat: 'tech' } }];
const users = [{ id: 'u_med', isGM: false }, { id: 'u_fix', isGM: false }, { id: 'u_nova', isGM: false }, { id: 'gm1', isGM: true }];
game.users = Object.assign(users, { activeGM: users[3], get: (id) => users.find((u) => u.id === id) });
const owners = { [med.id]: 'u_med', [fix.id]: 'u_fix', [nova.id]: 'u_nova', [rook.id]: 'u_nova' };
for (const actor of env.actors) actor.testUserPermission = (user) => user.isGM || user.id === 'gm1' || user.id === owners[actor.id];
installFakeChat();
let nextId = 0;
globalThis.foundry.utils.randomID = () => `st${String(++nextId).padStart(14, '0')}`;

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
const BAD = ['[object Object]', 'NaN', 'undefined', 'NCI.', '{n}', '{name}', '{amount}', '{staff}'];
const assertClean = (html, label) => {
  for (const bad of BAD) assert.equal(html.includes(bad), false, `${label} contains "${bad}"`);
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
    WealthAdapter: (await import('../scripts/services/WealthAdapter.js')).WealthAdapter,
    jobsOf: (await import('../scripts/services/BusinessClient.js')).jobsOf,
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
const receipt = (actor) => actor.getFlag('night-city-investments', 'businessReceipts')?.[0]?.results.at(-1);
const windowFor = (actor, tab = 'overview') => {
  const app = new Apps.Business();
  app.actorId = actor.id;
  app.tab = tab;
  return app;
};
const renderBusiness = async (app) => render('templates/business/business.hbs', await app._prepareContext());
const business = () => S.BusinessRepository.all()[0];

test('an open clinic shows an empty Staff tab, with recruiting and hiring a character', async () => {
  await send(med, 'found', { name: 'Back Room', archetype: 'clinic', cash: 3000, invite: [fix.id] });
  await send(fix, 'join', { businessId: business().id, cash: 1500 });
  dice = [9];
  await S.BusinessClient.roll(med, business(), { type: 'setupRoll', businessId: business().id, use: { kind: 'skill', skill: 'Cybertech', stat: 'tech' } }, { title: 'Setup' });
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  await S.BusinessService.approve(business().id);
  assert.equal(business().status, 'open');
  // A registered business, so there is room for three.
  await S.BusinessRepository.save({ ...business(), stage: 1, state: { ...business().state, capacity: 2, compliance: 50 } });

  const html = await renderBusiness(windowFor(med, 'staff'));
  assertClean(html, 'empty staff tab');
  assert.match(text(html), /No staff yet/);
  assert.match(text(html), /0 of 3 places taken/);
  assert.match(html, /data-action="recruitRoll"/);
  assert.match(html, new RegExp(`name="staffActor"><option value="${nova.id}"`), 'Nova, a player character who is not a partner, can be hired');
});

test('the partners hire a player character, who accepts from their own window and sees the job there', async () => {
  await send(med, 'propose', { businessId: business().id, kind: 'hire', actorId: nova.id, post: 'floor', pct: 100 });
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  const offered = business().staff[0];
  assert.equal(offered.status, 'offered');
  assert.equal(offered.bases['skill:Paramedic'], 12, 'read from the sheet');
  assert.equal(S.jobsOf(nova)[0].status, 'offered', 'the job is mirrored onto the character');

  const job = await renderBusiness(windowFor(nova));
  assertClean(job, 'job offer');
  assert.match(text(job), /Your jobs/);
  assert.match(text(job), /Back Room/);
  assert.match(job, /data-action="acceptJob"/);

  await send(nova, 'acceptJob', { businessId: business().id });
  assert.equal(receipt(nova).ok, true, receipt(nova).reason);
  assert.equal(business().staff[0].status, 'active');
  assert.equal(S.jobsOf(nova)[0].status, 'active');
  const staff = text(await renderBusiness(windowFor(med, 'staff')));
  assert.match(staff, /Nova/);
  assert.match(staff, /Floor Skilled/);
  assert.match(staff, /108/, '12 × 9 eb at a registered business');
});

test('the roll dialog offers the employee for overtime; their roll counts, the overtime comes from the cash and goes to them', async () => {
  const b = business();
  const dialog = new Apps.Roll({ actorId: med.id, businessId: b.id, request: { type: 'action', businessId: b.id, action: 'work' }, rollTitle: 'Work' });
  const html = render('templates/dialogs/roll.hbs', await dialog._prepareContext());
  assertClean(html, 'roll dialog with staff');
  assert.match(text(html), /Nova, employee: Paramedic 12 \(overtime 54 eb\)/);

  const till = b.till;
  const wealth = S.WealthAdapter.get(nova);
  dice = [7];
  await S.BusinessClient.roll(med, b, { type: 'action', businessId: b.id, action: 'work', use: { kind: 'staff', staffId: b.staff[0].id } }, { title: 'Work', levers: { luck: 3 } });
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  const after = business();
  const slot = after.period.slots.find((s) => s.action === 'work');
  assert.equal(slot.by, b.staff[0].id);
  assert.equal(slot.total, 19, "Nova's 12 and the 7; no Luck for an employee");
  assert.equal(after.till, till - 54);
  assert.equal(S.WealthAdapter.get(nova), wealth + 54);
  assert.equal(SkillLuck(med), 4, "the Medtech's Luck is untouched");

  const week = text(await renderBusiness(windowFor(med, 'week')));
  assert.match(week, /Nova/);
});

const SkillLuck = (actor) => actor.system.stats.luck.value;

test('the week closes: the wage is paid to Nova, and the ledger and the GM tab show the staff', async () => {
  const b = business();
  const wealth = S.WealthAdapter.get(nova);
  env.clock.ms += (b.period.endDay - Math.floor(env.clock.ms / DAY_MS)) * DAY_MS;
  await S.BusinessService.onTick();
  const week = business().digests.at(-1);
  assert.ok(week.wages > 0);
  assert.equal(S.WealthAdapter.get(nova), wealth + week.wages);

  const ledger = await renderBusiness(windowFor(med, 'ledger'));
  assertClean(ledger, 'ledger with wages');
  assert.match(text(ledger), /Wages \d+ eb/);
  assert.match(text(ledger), /Overtime for Nova, called in by Medtech/);

  const app = new Apps.GMConsole();
  app.tab = 'businesses';
  const gm = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(gm, 'GM tab with staff');
  assert.match(text(gm), /Staff: Nova \(Floor, 108 eb\)/);
});

test('recruiting finds a candidate the partners can hire; Nova can quit, and the job leaves the Job view', async () => {
  dice = [9];
  await S.BusinessClient.roll(med, business(), { type: 'recruitRoll', businessId: business().id, post: 'manager', use: { kind: 'skill', skill: 'Business', stat: 'int' } }, { title: 'Recruit' });
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  const candidate = business().candidates[0];
  assert.ok(candidate, 'a candidate was found');
  const html = await renderBusiness(windowFor(med, 'staff'));
  assertClean(html, 'staff tab with a candidate');
  assert.match(html, new RegExp(`data-action="proposeHire" data-id="${candidate.id}"`));
  await send(med, 'propose', { businessId: business().id, kind: 'hire', candidateId: candidate.id, pct: 100 });
  assert.equal(business().staff.length, 2);
  assert.equal(business().staff[1].source, 'recruit');

  await send(nova, 'quitJob', { businessId: business().id });
  assert.equal(receipt(nova).ok, true, receipt(nova).reason);
  assert.equal(business().staff.length, 1);
  assert.deepEqual(S.jobsOf(nova), []);
});

test('a character dragged from the Actors directory onto an open post proposes hiring them for it', async () => {
  const html = await renderBusiness(windowFor(med, 'staff'));
  assertClean(html, 'staff tab with drop targets');
  assert.match(html, /class="nci-droppost" data-post="floor"/);
  assert.doesNotMatch(html, /class="nci-droppost" data-post="manager"/, 'the manager post is taken');
  assert.match(text(html), /Drag a character from the Actors directory/);

  // What Foundry gives a drop from the Actors directory, and a confirmation the GM clicks through.
  globalThis.TextEditor = { getDragEventData: (event) => event.data };
  globalThis.fromUuid = async (uuid) => env.actors.find((a) => `Actor.${a.id}` === uuid) ?? null;
  let asked = null;
  globalThis.foundry.applications.api.DialogV2 = { confirm: async ({ content }) => { asked = content; return true; } };
  const drop = (actor, post) => {
    const app = windowFor(med, 'staff');
    Object.defineProperty(app, 'element', { value: { querySelector: () => ({ value: '120' }) } });
    return app._onDropStaff({ preventDefault() {}, data: actor ? { type: 'Actor', uuid: `Actor.${actor.id}` } : { type: 'Item', uuid: 'Item.x' } }, post);
  };
  const notices = env.notices ?? [];
  const warned = () => notices.filter(([kind]) => kind === 'warn').at(-1)?.[1] ?? '';

  await drop(fix, 'floor');
  assert.match(warned(), /partner cannot also be an employee/);
  await drop(rook, 'manager');
  assert.match(warned(), /already has one/);
  await drop(null, 'floor');
  assert.match(warned(), /Only a character/);
  assert.equal(business().proposals.length, 0, 'nothing proposed for a refused drop');

  await drop(rook, 'floor');
  assert.match(asked, /Propose hiring Rook as Floor at 120%/);
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  const hired = business().staff.find((s) => s.actorId === rook.id);
  assert.equal(hired.post, 'floor');
  assert.equal(hired.pct, 1.2);
  assert.equal(hired.status, 'offered');
});

test('characters are listed as links to their actor, with their portrait; a name with no actor stays plain', async () => {
  const { actorLink } = await import('../scripts/ui/actorLink.js');
  rook.img = 'portraits/rook.webp';
  const link = actorLink(rook.id);
  assert.match(link, /^<a class="content-link nci-who" draggable="true" data-link data-uuid="[^"]*a_Rook" data-id="a_Rook" data-type="Actor"/);
  assert.match(link, /<img class="nci-avatar" src="portraits\/rook\.webp" alt="">Rook<\/a>$/);
  assert.equal(actorLink(null, 'Mira <Sato>'), '<span class="nci-who">Mira &lt;Sato&gt;</span>', 'escaped, and no link');

  const partners = await renderBusiness(windowFor(med, 'partners'));
  assertClean(partners, 'partners with links');
  assert.match(partners, /data-uuid="[^"]*a_Medtech"[^>]*><img class="nci-avatar" src="[^"]+" alt="">Medtech<\/a>/);
  const staff = await renderBusiness(windowFor(med, 'staff'));
  assert.match(staff, /data-id="a_Rook" data-type="Actor"/, 'an employee with a character links to it');

  const app = new Apps.GMConsole();
  app.tab = 'businesses';
  const gm = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(gm, 'GM tab with links');
  assert.match(gm, /data-id="a_Fixer" data-type="Actor"/);
});
