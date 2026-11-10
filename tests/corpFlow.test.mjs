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
const env = installFakeFoundry({ actors: [['Nova', 100, true], ['Rook', 50, true]] });
const [nova, rook] = env.actors;
// Nova: Paramedic 12, a fair hand at a clinic.
nova.system.stats = { tech: { value: 7 }, luck: { value: 5, max: 5 } };
nova.items = [{ type: 'skill', name: 'Paramedic', system: { level: 5, stat: 'tech' } }];
const users = [{ id: 'u_nova', isGM: false }, { id: 'gm1', isGM: true }];
game.users = Object.assign(users, { activeGM: users[1], get: (id) => users.find((u) => u.id === id) });
for (const actor of env.actors) actor.testUserPermission = (user) => user.isGM || user.id === 'gm1' || user.id === 'u_nova';
installFakeChat();
let nextId = 0;
globalThis.foundry.utils.randomID = () => `cf${String(++nextId).padStart(14, '0')}`;
globalThis.foundry.applications = { api: { ApplicationV2: class {}, HandlebarsApplicationMixin: (Base) => Base } };

const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), lang);
game.i18n.localize = (key) => {
  const value = lookup(key);
  if (typeof value !== 'string') throw new Error(`Missing language key: ${key}`);
  return value;
};
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m));
game.i18n.has = (key) => typeof lookup(key) === 'string';
Handlebars.registerHelper('localize', (key, options) => game.i18n.format(key, options?.hash ?? {}));
const render = (relativePath, context) => Handlebars.compile(readFileSync(join(root, relativePath), 'utf8'), { strict: false })(context);
const text = (html) => html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ');

let S;
let dice = [];
before(async () => {
  const { CompanyRepository } = await import('../scripts/data/CompanyRepository.js');
  CompanyRepository.all = () => [{ id: 'BIO', ticker: 'BIO', name: 'Biotechnica', listed: true }];
  const { SkillAdapter } = await import('../scripts/services/SkillAdapter.js');
  SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 6, roll: null });
  S = {
    SkillAdapter,
    BusinessClient: (await import('../scripts/services/BusinessClient.js')).BusinessClient,
    BusinessService: (await import('../scripts/services/BusinessService.js')).BusinessService,
    EmployerService: (await import('../scripts/services/EmployerService.js')).EmployerService,
    EmployerRepository: (await import('../scripts/data/EmployerRepository.js')).EmployerRepository,
    JobService: (await import('../scripts/services/JobService.js')).JobService,
    WealthAdapter: (await import('../scripts/services/WealthAdapter.js')).WealthAdapter,
    jobsOf: (await import('../scripts/services/BusinessClient.js')).jobsOf,
    jobsContext: (await import('../scripts/ui/Business/context.js')).jobsContext,
    jobBoardRows: (await import('../scripts/ui/applyJob.js')).jobBoardRows,
    gmContext: (await import('../scripts/ui/GMConsole/tabs/jobMarket.js')).context,
  };
});

const send = async (actor, type, payload) => {
  await S.BusinessClient.submit(actor, type, payload);
  await S.BusinessService.processActor(actor);
};
const receipt = (actor) => actor.getFlag('night-city-investments', 'businessReceipts')?.[0]?.results.at(-1);
const employer = () => S.EmployerRepository.all()[0];
const paramedic = { kind: 'skill', skill: 'Paramedic', stat: 'tech' };
/** A roll on Nova's own client, then the request that carries it. */
const rolled = async (type, payload, roll) => {
  dice = [roll];
  const { messageId } = await S.SkillAdapter.leverCheck(nova, { dv: employer().dv, title: 'Test', use: paramedic, levers: {} });
  await send(nova, type, { ...payload, use: paramedic, rollId: messageId });
  return receipt(nova);
};

test('the GM sets up jobs at a market corporation, and they go on the board', async () => {
  const before = S.gmContext().jobMarket;
  assert.deepEqual(before.companies.map((c) => c.value), ['BIO']);
  const done = await S.EmployerService.create({ companyId: 'BIO', archetype: 'clinic', dv: 13, location: 'Watson', roles: { floor: { count: 1, wage: 350 }, manager: { count: 0, wage: 500 } } });
  assert.equal(done.ok, true, done.reason);
  assert.equal((await S.EmployerService.create({ companyId: 'BIO', archetype: 'clinic', roles: { floor: { count: 1, wage: 1 } } })).reason, 'employer-exists');
  const rows = S.jobBoardRows(nova);
  assert.deepEqual(rows.map((r) => [r.name, r.ticker, r.post, r.wage]), [['Biotechnica', 'BIO', 'floor', '350']]);
  const gm = render('templates/gm/console/jobMarket.hbs', S.gmContext());
  assert.match(text(gm), /Biotechnica \(BIO\)/);
  assert.match(gm, /data-action="businessCorpOffer"/);
  assert.equal(S.gmContext().jobMarket.companies.length, 0, 'one employer a company');
});

test('Nova applies with Paramedic, waits on Pending, and is hired', async () => {
  const r = await rolled('jobApply', { companyId: employer().id, post: 'floor' }, 6);
  assert.equal(r.ok, true, r.reason);
  const waiting = S.JobService.waiting();
  assert.equal(waiting.length, 1);
  assert.equal(waiting[0].business.id, employer().id);
  const pendingTabs = (await import('../scripts/ui/GMConsole/tabs/pending.js')).waiting();
  assert.equal(pendingTabs.jobMarket, 1, 'Pending opens the Job Market for it');
  assert.equal(pendingTabs.businesses ?? 0, 0);
  const done = await S.JobService.decide(employer().id, waiting[0].application.id, true);
  assert.equal(done.ok, true, done.reason);
  const [job] = S.jobsOf(nova);
  assert.equal(job.corp, true);
  assert.equal(job.wage, 350, 'a solid roll, the role\'s wage');
  const shown = S.jobsContext(nova)[0];
  assert.equal(shown.archetype, 'BIO', 'Your jobs shows the ticker');
  assert.equal(shown.boss.canWork, true);
  assert.deepEqual(S.jobBoardRows(nova), [], 'the role is filled');
  const gm = render('templates/gm/console/jobMarket.hbs', S.gmContext());
  assert.match(gm, /class="nci-labelled" data-action="businessCorpDismiss"/, 'Let go is labelled, so it is not squeezed to an icon width');
  assert.match(text(gm), /Let go/);
});

test('one shift a week, refused before any dice the second time', async () => {
  const r = await rolled('shiftRoll', { companyId: employer().id }, 8);
  assert.equal(r.ok, true, r.reason);
  assert.equal(S.jobsOf(nova)[0].boss.done, 'strong');
  const again = await rolled('shiftRoll', { companyId: employer().id }, 8);
  assert.equal(again.reason, 'shift-done');
});

test('the week closes: wage and bonus paid from outside, standing moves', async () => {
  const wealth = S.WealthAdapter.get(nova);
  env.clock.ms += 7 * DAY_MS;
  await S.BusinessService.onTick();
  const paid = S.WealthAdapter.get(nova) - wealth;
  assert.equal(paid, 350 + Math.round(350 * 0.4), 'the wage and a strong shift\'s bonus, with no mail to claim it from');
  const staff = employer().staff[0];
  assert.equal(staff.standing, 62);
  assert.equal(S.jobsOf(nova)[0].boss.done, null, 'a new week');
});

test('an employee counts as having run a gig on their company, for insider heat', async () => {
  const { HeatService } = await import('../scripts/services/HeatService.js');
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  env.store.set('heatEnabled', true);
  try {
    const window = await HeatService.openWindow({ sourceKey: 'gig:1', companyId: 'BIO', outcome: 'success', tick: 1, delayDays: 2 });
    assert.deepEqual(window.runners, [nova.id]);
    const other = await HeatService.openWindow({ sourceKey: 'gig:2', companyId: 'ARA', outcome: 'success', tick: 1, delayDays: 2 });
    assert.deepEqual(other.runners, [], 'not on another company');
    // One taken on while a window is open counts too.
    await HeatService.noteRunner('BIO', rook.id);
    assert.deepEqual(MarketStore.getHeat().windows.find((w) => w.sourceKey === 'gig:1').runners, [nova.id, rook.id]);
  } finally {
    env.store.set('heatEnabled', false);
  }
});

test('the GM offers Rook a job; Rook takes it, then quits', async () => {
  rook.system.stats = { tech: { value: 5 } };
  await S.EmployerService.update(employer().id, { roles: { floor: { count: 2, wage: 350 } } });
  assert.equal((await S.EmployerService.offer(employer().id, rook.id, 'floor')).ok, true);
  assert.equal(S.jobsContext(rook)[0].offered, true);
  await send(rook, 'acceptJob', { businessId: employer().id });
  assert.equal(receipt(rook).ok, true, receipt(rook).reason);
  assert.equal(S.jobsOf(rook)[0].status, 'active');
  await send(rook, 'quitJob', { businessId: employer().id });
  assert.equal(receipt(rook).ok, true, receipt(rook).reason);
  assert.deepEqual(S.jobsOf(rook), []);
});

test('removing the jobs lets Nova go with a week\'s pay', async () => {
  const wealth = S.WealthAdapter.get(nova);
  assert.equal((await S.EmployerService.remove(employer().id)).ok, true);
  assert.equal(S.WealthAdapter.get(nova) - wealth, 350);
  assert.deepEqual(S.jobsOf(nova), []);
  assert.deepEqual(S.jobBoardRows(nova), []);
});
