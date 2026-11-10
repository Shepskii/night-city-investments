import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Handlebars from 'handlebars';
import { registerPartials } from './helpers/partials.mjs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';
import { normalizeBusiness } from '../scripts/engine/index.js';

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

test('an open clinic shows an empty Staff tab: each open post has a Hire button that opens the Hire window', async () => {
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
  assert.match(text(html), /Wage a week \(eb\) Open roles 3\/3 No staff yet/, 'the open roles in the staff table header');
  assert.match(html, /data-action="openHire" data-post="floor"/);
  assert.doesNotMatch(html, /data-action="recruitRoll"|name="staffActor"/, 'recruiting and hiring a character are in the Hire window now');
  assert.match(text(html), /advertise the job/);

  const Hire = (await import('../scripts/ui/Business/HireDialogApp.js')).HireDialogApp;
  const hire = new Hire({ actorId: med.id, businessId: business().id, post: 'floor' });
  const dialog = render('templates/dialogs/hire.hbs', await hire._prepareContext());
  assertClean(dialog, 'hire window');
  assert.match(text(dialog), /Floor/);
  assert.match(dialog, new RegExp(`name="staffActor"><option value="${nova.id}"`), 'Nova, a player character who is not a partner, can be hired');
  assert.match(dialog, /data-action="advertise"/);
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
  assert.match(text(job), /partners may call you in for overtime/, 'the hint for a job at a player business');
  assert.doesNotMatch(text(job), /raises your performance/, 'and not the shift hint');
  assert.match(job, /data-action="acceptJob"/);
  // The offer also waits on the Pending tab, and its button answers it.
  const { pendingRows } = await import('../scripts/ui/Business/pending.js');
  const offer = pendingRows(nova).find((r) => r.buttons.some((x) => x.do === 'acceptJob'));
  assert.match(offer.needed, /A job offer as/);
  const offerSubmit = S.BusinessClient.submit;
  let answered = null;
  S.BusinessClient.submit = async (actor, type, payload) => { answered = [actor.id, type, payload]; };
  await Apps.Business.DEFAULT_OPTIONS.actions.pendingAct.call(new Apps.Business(), null, { dataset: offer.buttons[0] });
  S.BusinessClient.submit = offerSubmit;
  assert.deepEqual(answered, [nova.id, 'acceptJob', { businessId: business().id }]);

  await send(nova, 'acceptJob', { businessId: business().id });
  assert.equal(receipt(nova).ok, true, receipt(nova).reason);
  assert.equal(business().staff[0].status, 'active');
  assert.equal(S.jobsOf(nova)[0].status, 'active');
  const staff = text(await renderBusiness(windowFor(med, 'staff')));
  assert.match(staff, /Nova/);
  assert.match(staff, /Floor Skilled/);
  assert.match(staff, /Skill/);
  assert.match(staff, /Paramedic 12/, 'the skill that counts for the post, and its base');
  assert.doesNotMatch(staff.split('Posts')[1] ?? '', /Nova/, 'the posts no longer list who holds them');
  assert.match(staff, /108/, '12 × 9 eb at a registered business');
});

test('the roll dialog offers the employee for overtime; their roll counts, the overtime comes from the cash, for their payslip', async () => {
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
  assert.equal(S.WealthAdapter.get(nova), wealth, "a player character's overtime goes on the week's payslip, not straight to the sheet");
  assert.equal(after.period.pcOvertime[nova.id], 54);
  assert.equal(SkillLuck(med), 4, "the Medtech's Luck is untouched");

  const week = text(await renderBusiness(windowFor(med, 'week')));
  assert.match(week, /Action Actions available 1\/2 /, 'one of the two slots taken, shown in the actions table header');
  assert.match(week, /Nova/);
});

const SkillLuck = (actor) => actor.system.stats.luck.value;

test('the week closes: the wage is paid to Nova, and the ledger and the GM tab show the staff', async () => {
  const b = business();
  const wealth = S.WealthAdapter.get(nova);
  env.clock.ms += (b.period.endDay - Math.floor(env.clock.ms / DAY_MS)) * DAY_MS;
  // The payslip goes by Messenger mail (E2).
  const { MailService } = await import('../scripts/services/MailService.js');
  const sent = [];
  const fromWire = MailService.fromWire;
  MailService.fromWire = async (actor, mail) => { sent.push({ to: actor.id, ...mail }); return { ok: true }; };
  try {
    await S.BusinessService.onTick();
  } finally {
    MailService.fromWire = fromWire;
  }
  const week = business().digests.at(-1);
  assert.ok(week.wages > 0);
  // The wage rides on the payslip for Nova to claim, not straight onto the sheet.
  assert.equal(S.WealthAdapter.get(nova), wealth);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].to, nova.id);
  assert.equal(sent[0].subject, 'Payslip: Back Room (wage and overtime)', 'a week with overtime says so');
  // Nova's overtime earlier this week (54 eb) comes on the payslip with the wage (E3).
  assert.equal(sent[0].eddies, week.wages + 54);
  assert.equal(sent[0].lines[1], 'Overtime: 54 eb for 1 shift(s) worked this week, on top of the wage.');
  assert.match(sent[0].lines[0], new RegExp(`Floor: this week's wage ${week.wages} eb, ${week.wages} eb of it paid`));
  // Claiming it is the rules' part, set apart after the payslip (M3).
  assert.equal(sent[0].footer, `Attached: ${week.wages + 54} eb to claim from this message (${week.wages} eb wage and 54 eb overtime).`);
  // A payslip that cannot be sent (no Messenger) pays the sheet instead, so the wage is never lost.
  MailService.fromWire = async () => ({ ok: false, error: 'no-wire' });
  try {
    await S.BusinessService._payslips({ business: business(), events: [{ type: 'payslip', actorId: nova.id, post: 'floor', wage: 100, paid: 100, owed: 0 }] });
  } finally {
    MailService.fromWire = fromWire;
  }
  assert.equal(S.WealthAdapter.get(nova), wealth + 100);

  const ledger = await renderBusiness(windowFor(med, 'reports')) + await renderBusiness(windowFor(med, 'ledger'));
  assertClean(ledger, 'ledger with wages');
  // The week's wages in their own column, and the overtime paid during the week under Other.
  assert.match(text(ledger), /Solid success \+\d+ -\d+ -\d+ -54 [+-]\d+ [\d,]+/);
  assert.match(text(ledger), /Overtime for Nova, called in by Medtech/);
  assert.match(await renderBusiness(windowFor(med, 'week')), /data-tab="week" class="active">Work</, 'the week tab is called Work');

  // Each weekly digest opens the week's cashbook.
  assert.match(ledger, new RegExp(`class="nci-row" data-action="openCashbook" data-index="${week.index}"`));
  const { CashbookDialogApp } = await import('../scripts/ui/Business/CashbookDialogApp.js');
  assert.ok('openCashbook' in Apps.Business.DEFAULT_OPTIONS.actions);
  const book = new CashbookDialogApp({ businessId: business().id, index: week.index });
  const ctx = await book._prepareContext();
  const cashbook = render('templates/dialogs/cashbook.hbs', ctx);
  assertClean(cashbook, 'cashbook');
  const words = text(cashbook);
  for (const line of ['Income', 'Takings', 'Expenses', 'Running costs', 'Rent', 'Licence fees', 'Protection money', 'Wages', 'Total income', 'Total expenses', 'Profit', 'Cash at the close']) {
    assert.match(words, new RegExp(line), line);
  }
  assert.equal(Object.values(week.costs).reduce((a, v) => a + v, 0), week.upkeep, "the upkeep's parts add up to it");
  const eb = (s) => Number(String(s).replace(/[^\d-]/g, ''));
  assert.equal(eb(ctx.totalIn) + eb(ctx.totalOut), week.profit, 'income less expenses is the profit');
  assert.match(words, /Other money in and out .* Overtime for Nova, called in by Medtech -54/, "the week's overtime, outside the profit");
  assert.doesNotMatch(words, /Founded by|put money in/, "money put in while setting up was not the business's cash");

  const app = new Apps.GMConsole();
  app.tab = 'businesses';
  const gm = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(gm, 'GM tab with staff');
  assert.match(text(gm), /Nova Floor 108/);
  // Owners in a compact table, and the standing in one strip; no week-by-week detail.
  assert.match(gm, /<table class="nci-market nci-owners nci-peoplecols">/);
  assert.match(text(gm), /Owner Status Units Share/);
  assert.match(text(gm), /Medtech partner 3,000 66\.7% Fixer partner 1,500 33\.3%/);
  assert.match(text(gm), /Cash \S+ eb Book value \S+ eb Reputation \d+ Capacity \d\.\d\d Exposure \d+/);
  assert.doesNotMatch(text(gm), /takings|slots used|Cost base|Setup roll/);
});

test('on call (E3): a partner asks Nova for a slot; Nova rolls it from the Job view with their own Luck; the overtime goes on the payslip', async () => {
  const { EmployeeDialogApp } = await import('../scripts/ui/Business/EmployeeDialogApp.js');
  const staffId = business().staff.find((s) => s.actorId === nova.id).id;
  // The Medtech's Employee window offers the week's rolls.
  const manage = new EmployeeDialogApp({ actorId: med.id, businessId: business().id, staffId });
  const managed = render('templates/dialogs/employee.hbs', await manage._prepareContext());
  assertClean(managed, 'employee window on call');
  assert.match(text(managed), /On call/);
  assert.match(managed, /<option value="action:promote">Take the slot: Promote<\/option>/);
  await send(med, 'askStaff', { businessId: business().id, staffId, roll: { type: 'action', action: 'promote' } });
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  assert.equal(business().period.asks.length, 1);
  assert.equal((await send(med, 'askStaff', { businessId: business().id, staffId, roll: { type: 'respond' } }), receipt(med).reason), 'already-asked');

  // It is on Nova's job, with what the dialog needs (Nova cannot read the business).
  const job = nova.getFlag('night-city-investments', 'jobs')[0].find((j) => j.businessId === business().id);
  assert.equal(job.asks.length, 1);
  assert.equal(job.asks[0].what, 'Promote');
  assert.ok(job.asks[0].uses.length > 0 && job.asks[0].dv > 0);
  const jobView = render('templates/business/business.hbs', await windowFor(nova)._prepareContext());
  assert.match(text(jobView), /Medtech asks you to roll: Promote \(overtime \d+ eb, on your payslip\)/);
  assert.match(jobView, /data-action="rollAsked"/);

  // Nova rolls it with their own skills and Luck; the slot is Nova's, the overtime from the cash, for the payslip.
  const ask = job.asks[0];
  const dialog = new Apps.Roll({ actorId: nova.id, businessId: business().id, request: { type: 'staffRoll', businessId: business().id, askId: ask.id }, rollTitle: 'Promote', asked: { ...ask, businessName: 'Back Room' } });
  const dialogHtml = render('templates/dialogs/roll.hbs', await dialog._prepareContext());
  assertClean(dialogHtml, 'asked roll dialog');
  assert.match(text(dialogHtml), /Asked of you as an employee/);
  const till = business().till;
  const before = business().period.pcOvertime?.[nova.id] ?? 0;
  dice = [8];
  await S.BusinessClient.rollAsked(nova, { businessId: business().id, ask, use: ask.uses[0], levers: { luck: 1 }, title: 'Promote' });
  await S.BusinessService.processActor(nova);
  assert.equal(receipt(nova).ok, true, receipt(nova).reason);
  const slot = business().period.slots.find((s) => s.action === 'promote');
  assert.equal(slot.by, staffId);
  assert.equal(slot.luck, 1, "Nova's own Luck");
  assert.equal(business().till, till - ask.pay);
  assert.equal(business().period.pcOvertime[nova.id], before + ask.pay);
  assert.equal(business().period.asks.length, 0, 'done, so no longer asked');
  // Nova's Job view says what overtime is waiting for the next payslip.
  const owedView = text(render('templates/business/business.hbs', await windowFor(nova)._prepareContext()));
  assert.match(owedView, new RegExp(`Overtime this week: ${before + ask.pay} eb, paid with your next payslip`));

  // A roll asked can be declined.
  await send(med, 'askStaff', { businessId: business().id, staffId, roll: { type: 'assist', forAction: 'work' } });
  const id = business().period.asks[0]?.id;
  if (id) {
    await send(nova, 'cancelAsk', { businessId: business().id, askId: id });
    assert.equal(receipt(nova).ok, true, receipt(nova).reason);
    assert.equal(business().period.asks.length, 0);
  } else {
    assert.equal(receipt(med).reason, 'no-shifts', 'Nova has worked both shifts this week');
  }
});

test('advertising brings applicants the partners can hire on what they ask; Nova can quit, and the job leaves the Job view', async () => {
  dice = [9];
  // Advertising from the Hire window: its roll dialog, and the Hire window closes once the roll is made.
  const Hiring = (await import('../scripts/ui/Business/HireDialogApp.js')).HireDialogApp;
  const hiring = new Hiring({ actorId: med.id, businessId: business().id, post: 'manager' });
  let hireClosed = false;
  hiring.close = async () => { hireClosed = true; };
  let rollDialog = null;
  const ask = Apps.Roll.ask;
  Apps.Roll.ask = (o) => { rollDialog = new Apps.Roll(o); return rollDialog; };
  try {
    Hiring.DEFAULT_OPTIONS.actions.advertise.call(hiring);
  } finally {
    Apps.Roll.ask = ask;
  }
  rollDialog.close = async () => {};
  assert.equal(hireClosed, false, 'still open while the roll dialog is up');
  await Apps.Roll.DEFAULT_OPTIONS.form.handler.call(rollDialog);
  assert.equal(hireClosed, true, 'the Hire window closes once the advert is rolled');
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  const candidate = business().candidates[0];
  assert.ok(candidate, 'an applicant answered');
  const html = await renderBusiness(windowFor(med, 'staff'));
  assertClean(html, 'staff tab with applicants');
  assert.match(text(html), /Applicants/);
  assert.match(text(html), /Asks \d+% of the going rate for their skill/, 'unvetted, only their level and their ask as a share');
  assert.match(text(html), /Not vetted/);
  assert.match(html, /data-action="vetApplicants" data-post="manager"/);
  assert.match(html, new RegExp(`data-action="proposeHire" data-id="${candidate.id}"`));

  // Vetting the post's applicants: one roll for them all; afterwards they cannot be vetted again.
  dice = [10, 1];
  await S.BusinessClient.roll(med, business(), { type: 'vetRoll', businessId: business().id, post: 'manager', use: { kind: 'skill', skill: 'Human Perception', stat: 'emp' } }, { title: 'Vet' });
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  assert.ok(business().candidates.every((c) => c.vetted), 'every applicant for the post was checked');
  const vetted = await renderBusiness(windowFor(med, 'staff'));
  assertClean(vetted, 'staff tab after vetting');
  assert.match(text(vetted), /Vetted:/);
  assert.doesNotMatch(vetted, /data-action="vetApplicants"/);
  const tail = html.split('data-action="openHire"').at(-1);
  assert.match(tail, /Applicants/, 'the applicants sit at the foot of the Staff tab, after the posts');
  const Hire = (await import('../scripts/ui/Business/HireDialogApp.js')).HireDialogApp;
  const dialog = render('templates/dialogs/hire.hbs', await new Hire({ actorId: med.id, businessId: business().id, post: 'manager' })._prepareContext());
  assertClean(dialog, 'hire window after an advert');
  assert.doesNotMatch(dialog, new RegExp(candidate.id), 'applicants are not shown in the Hire window');
  assert.doesNotMatch(dialog, /data-action="advertise"/, 'advertised this week already');
  await send(med, 'propose', { businessId: business().id, kind: 'hire', candidateId: candidate.id, pct: 100 });
  assert.equal(business().staff.length, 2);
  assert.equal(business().staff[1].source, 'recruit');

  await send(nova, 'quitJob', { businessId: business().id });
  assert.equal(receipt(nova).ok, true, receipt(nova).reason);
  assert.equal(business().staff.length, 1);
  assert.deepEqual(S.jobsOf(nova), []);
});

test("a character dragged from the Actors directory onto the Hire window's Hire a character block proposes hiring them for its role", async () => {
  const html = await renderBusiness(windowFor(med, 'staff'));
  assertClean(html, 'staff tab');
  assert.match(text(html), /Roles/);
  assert.doesNotMatch(html, /nci-droppost|name="dropPct"/, 'the roles table takes no drops, and has no pay field');
  assert.doesNotMatch(text(html), /Drag a character/);
  const Hire = (await import('../scripts/ui/Business/HireDialogApp.js')).HireDialogApp;
  const dialog = render('templates/dialogs/hire.hbs', await new Hire({ actorId: med.id, businessId: business().id, post: 'floor' })._prepareContext());
  assertClean(dialog, 'hire window with its drop zone');
  assert.match(dialog, /class="nci-block nci-form nci-drop nci-hiredrop"/);
  assert.match(text(dialog), /drag a character from the Actors directory here/);

  // What Foundry gives a drop from the Actors directory, and a confirmation the GM clicks through.
  globalThis.TextEditor = { getDragEventData: (event) => event.data };
  globalThis.fromUuid = async (uuid) => env.actors.find((a) => `Actor.${a.id}` === uuid) ?? null;
  let asked = null;
  globalThis.foundry.applications.api.DialogV2 = { confirm: async ({ content }) => { asked = content; return true; } };
  const drop = (actor, post) => {
    const app = new Hire({ actorId: med.id, businessId: business().id, post });
    Object.defineProperty(app, 'element', { value: { querySelector: () => ({ value: '120' }) } });
    return app._onDropStaff({ preventDefault() {}, data: actor ? { type: 'Actor', uuid: `Actor.${actor.id}` } : { type: 'Item', uuid: 'Item.x' } });
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

test('actors that are not characters (a player-owned container of upgrade projects) are left out of every list', async () => {
  const box = { id: 'a_Box', name: 'Upgrade Projects — Nova', type: 'container', hasPlayerOwner: true, isOwner: true, testUserPermission: () => true, getFlag: () => undefined, items: [] };
  game.actors.push(box);
  try {
    const { staffActors } = await import('../scripts/services/BusinessClient.js');
    assert.equal(staffActors().some((a) => a.id === 'a_Box'), false, 'not offered as an employee');
    const brokers = await import('../scripts/ui/GMConsole/tabs/brokers.js');
    const ctx = brokers.context().broker;
    assert.equal(ctx.grants.some((g) => g.id === 'a_Box'), false, 'not offered terminal access');
    assert.equal(ctx.actorOptions.some((o) => o.value === 'a_Box'), false, 'not offered as a broker');
    assert.ok(ctx.grants.some((g) => g.id === nova.id), 'a player character still is');
    const staff = await renderBusiness(windowFor(med, 'staff'));
    assert.doesNotMatch(staff, /Upgrade Projects/);
  } finally {
    game.actors.splice(game.actors.indexOf(box), 1);
  }
});

test('the Employee window: a recruit\'s loyalty band, a bonus paid, a raise asked for and agreed; the GM sees loyalty and the hidden trait', async () => {
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  const { EmployeeDialogApp } = await import('../scripts/ui/Business/EmployeeDialogApp.js');
  const b = structuredClone(business());
  const room = b.staff.length;
  b.staff.push({
    id: 'stf_ad-1', actorId: null, name: 'Vera Voss', source: 'recruit', post: 'security', bases: { 'skill:Tactics': 11 }, pct: 1, wage: 99,
    hiredDay: b.openedDay, status: 'active', owed: 0, loyalty: 40, candidateId: 'ad-1', ask: { pct: 1.1, day: b.openedDay },
  });
  await S.BusinessRepository.save(b);
  await MarketStore.setBusinessesHidden({ ...MarketStore.getBusinessesHidden(), [b.id]: { exposure: 0, traits: { 'ad-1': 'lightFingers' } } });

  const html = await renderBusiness(windowFor(med, 'staff'));
  assertClean(html, 'staff tab with a recruit');
  assert.match(text(html), /Vera Voss recruit .* Steady/);
  assert.match(text(html), /Asks for a raise to 110% of the going rate/);
  assert.match(html, /data-action="openEmployee" data-id="stf_ad-1"/);
  assert.doesNotMatch(text(html), /Light fingers/, 'the trait is hidden from the partners');

  const app = new EmployeeDialogApp({ actorId: med.id, businessId: b.id, staffId: 'stf_ad-1' });
  const dialog = render('templates/dialogs/employee.hbs', await app._prepareContext());
  assertClean(dialog, 'employee window');
  assert.match(text(dialog), /Paid 99 eb a week: 100% of the going rate \(99 eb\)/);
  assert.doesNotMatch(text(dialog), /Share grant/, 'grants are for a company');
  assert.match(text(dialog), /They ask for 110% of the going rate \(109 eb a week\)/);
  for (const action of ['agreeRaise', 'refuseRaise', 'payBonus', 'movePost', 'fireStaff', 'proposePay']) assert.match(dialog, new RegExp(`data-action="${action}"`), action);
  assert.match(text(dialog), /A quarter of a week(&#x27;|')s wage \(25 eb\)/);
  // Training (E3): her best skill for security, and a course at twice the eb (the Medtech has no Tactics to mentor with).
  assert.match(text(dialog), /Tactics 11 \(trained \+0 of 4\)/);
  assert.match(text(dialog), /You cannot mentor them/);
  assert.match(dialog, /data-action="trainStaff" data-mentor="false"/);
  assert.doesNotMatch(dialog, /data-mentor="true"/);
  assert.match(text(dialog), /Send them on a course \(1,100 eb\)/);
  // A mentor's lesson is a roll of their own: Education (or Persuasion), never a hired professional or an employee.
  const lessonDialog = new Apps.Roll({ actorId: med.id, businessId: b.id, request: { type: 'trainRoll', businessId: b.id, staffId: 'stf_ad-1' }, rollTitle: 'Mentoring Vera Voss' });
  const lessonHtml = render('templates/dialogs/roll.hbs', await lessonDialog._prepareContext());
  assertClean(lessonHtml, 'mentor roll dialog');
  assert.match(text(lessonHtml), /Education/);
  assert.match(text(lessonHtml), /They pick it up: \+1/);
  assert.match(text(lessonHtml), /A breakthrough: \+1, and they can train again in 2 weeks/);
  assert.doesNotMatch(text(lessonHtml), /A good hire|overtime/);

  const till = business().till;
  await EmployeeDialogApp.DEFAULT_OPTIONS.actions.payBonus.call(app);
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  const vera = () => business().staff.find((s) => s.id === 'stf_ad-1');
  assert.equal(business().till, till - 25);
  assert.equal(vera().loyalty, 45);
  const after = render('templates/dialogs/employee.hbs', await app._prepareContext());
  assert.match(text(after), /A bonus of 25 eb was paid this week/);
  assert.doesNotMatch(after, /data-action="payBonus"/);

  await EmployeeDialogApp.DEFAULT_OPTIONS.actions.agreeRaise.call(app, null, { dataset: { pct: '110' } });
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  assert.equal(vera().pct, 1.1, "the Medtech's majority carries it");
  assert.equal(vera().ask, undefined);
  assert.equal(vera().loyalty, 50);

  const gm = new Apps.GMConsole();
  gm.tab = 'businesses';
  const console = render('templates/gm/console.hbs', await gm._prepareContext());
  assertClean(console, 'GM tab with loyalty and traits');
  assert.match(text(console), /Vera Voss Light fingers Security 109 50/);
  assert.equal(business().staff.length, room + 1);

  // Training through the GM's service: a course, from the cash; Tactics 12, and the next training in 4 weeks.
  const cash = business().till;
  await EmployeeDialogApp.DEFAULT_OPTIONS.actions.trainStaff.call(app, null, { dataset: { mentor: 'false' } });
  await S.BusinessService.processActor(med);
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  assert.equal(business().till, cash - 1100);
  assert.deepEqual(vera().training, { 'skill:Tactics': 1 });
  const trained = text(render('templates/dialogs/employee.hbs', await app._prepareContext()));
  assert.match(trained, /Tactics 12 \(trained \+1 of 4\)/);
  assert.match(trained, /Trained recently: next training from/);
});

test('two jobs (E3): something let slip reaches the other business as a report and a digest note; the Staff tab and GM tab name the other job', async () => {
  const here = business();
  const other = normalizeBusiness({ ...structuredClone(here), id: 'bus_other00000001', name: 'Rival Clinic', intel: [], pendingNotes: [], staff: [] });
  await S.BusinessRepository.save(other);
  try {
    await S.BusinessService._twoJobs({ events: [{ type: 'twoJobs', businessId: here.id, kind: 'leak', to: other.id, staffName: 'Vik' }] });
    const told = S.BusinessRepository.get(other.id);
    assert.equal(told.intel.at(-1).targetId, here.id, 'a report on the business it was let slip about');
    assert.ok(told.intel.at(-1).range[1] > told.intel.at(-1).range[0]);
    assert.deepEqual(told.pendingNotes, [{ kind: 'heardTalk', name: 'Vik', rival: here.name }]);
    // The Staff tab names the other job once it is known; the GM always sees it.
    const b = structuredClone(business());
    b.staff.push({
      id: 'stf_vik', actorId: rook.id, name: 'Vik', source: 'npc', post: 'security', bases: { 'skill:Tactics': 12 }, pct: 1, wage: 108,
      hiredDay: b.openedDay, status: 'active', owed: 0, loyalty: 60, elsewhere: { businessId: other.id, name: 'Rival Clinic', shifts: 0 },
    });
    await S.BusinessRepository.save(b);
    assert.doesNotMatch(text(await renderBusiness(windowFor(med, 'staff'))), /Also works for Rival Clinic/, 'not known yet');
    const gm = new Apps.GMConsole();
    gm.tab = 'businesses';
    assert.match(text(render('templates/gm/console.hbs', await gm._prepareContext())), /also works for Rival Clinic/);
    await S.BusinessRepository.save({ ...business(), staff: business().staff.map((s) => (s.id === 'stf_vik' ? { ...s, knownElsewhere: true } : s)) });
    assert.match(text(await renderBusiness(windowFor(med, 'staff'))), /Also works for Rival Clinic/);
    // The event on the Work tab names them, in what it is and in what happens if nobody answers.
    await S.BusinessRepository.save({ ...business(), period: { ...business().period, event: { kind: 'doubleBooked', staffId: 'stf_vik', rival: { businessId: other.id, name: 'Rival Clinic' } } } });
    const work = await renderBusiness(windowFor(med, 'week'));
    assertClean(work, 'two-jobs event');
    assert.match(text(work), /Vik is wanted at their other job this week as well/);
    assert.match(text(work), /If nobody persuades Vik to work your shifts/);
  } finally {
    await S.BusinessRepository.remove(other.id);
    const { event, ...period } = business().period;
    await S.BusinessRepository.save({ ...business(), period: event?.kind === 'doubleBooked' ? period : business().period, staff: business().staff.filter((s) => s.id !== 'stf_vik') });
  }
});

test('an NPC holding granted shares is listed on the Shareholders tab as a link to their character, as a player character is', async () => {
  const saved = structuredClone(business());
  try {
    await S.BusinessRepository.save({ ...business(), partners: [...business().partners, {
      actorId: 'npc:stf_vik', actorRef: rook.id, name: 'Vik', status: 'active', cash: 0, gear: [], units: 20, voting: false, heirId: null, leavingSince: null, npc: true, grant: true, grantUnits: 20,
    }] });
    const html = await renderBusiness(windowFor(med, 'partners'));
    assertClean(html, 'partners with an NPC holder');
    assert.match(html, new RegExp(`data-id="${rook.id}"[^>]*>.*Vik</a>`));
    assert.match(html, new RegExp(`data-id="${med.id}"`), 'a player character, linked as before');
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test("an Exec's team (E3): the Hire window offers the Exec their team; a member joins through the GM's service, unpaid", async () => {
  const { HireDialogApp } = await import('../scripts/ui/Business/HireDialogApp.js');
  const role = { type: 'role', name: 'Exec', system: { rank: 5, mainRoleAbility: 'Teamwork' } };
  med.items.push(role);
  const saved = structuredClone(business());
  try {
    // Room on the staff for one more.
    await S.BusinessRepository.save({ ...business(), staff: business().staff.slice(0, 1), candidates: [] });
    const hire = new HireDialogApp({ actorId: med.id, businessId: business().id, post: 'security' });
    const html = render('templates/dialogs/hire.hbs', await hire._prepareContext());
    assertClean(html, 'hire window with a team');
    assert.match(text(html), /Your team/);
    assert.match(text(html), /Teamwork 5 gives you up to 2/);
    assert.match(text(html), /A team member in this role would be Skilled \(11\)/);
    assert.match(html, /name="teamName" maxlength="40" value="[^"]+"/);
    await send(med, 'addTeam', { businessId: business().id, post: 'security', name: 'Ruth Kane' });
    assert.equal(receipt(med).ok, true, receipt(med).reason);
    const ruth = business().staff.find((s) => s.name === 'Ruth Kane');
    assert.deepEqual([ruth.source, ruth.leader, ruth.wage], ['team', med.id, 0]);
    const staffTab = text(await renderBusiness(windowFor(med, 'staff')));
    assert.match(staffTab, /Ruth Kane Exec(&#x27;|')s team .* unpaid Manage/);
    // A team member already made: an NPC actor dragged onto the team block, named after it, their skill by the rank.
    const kade = { id: 'a_Kade', name: 'Kade', type: 'character', hasPlayerOwner: false, img: '', getFlag: () => undefined, testUserPermission: () => true };
    game.actors.push(kade);
    globalThis.TextEditor = { getDragEventData: (event) => event.data };
    globalThis.fromUuid = async (uuid) => [...env.actors, kade].find((a) => `Actor.${a.id}` === uuid) ?? null;
    let confirmed = null;
    globalThis.foundry.applications.api.DialogV2 = { confirm: async ({ content }) => { confirmed = content; return true; } };
    const teamHire = new HireDialogApp({ actorId: med.id, businessId: business().id, post: 'bookkeeper' });
    assert.match(render('templates/dialogs/hire.hbs', await teamHire._prepareContext()), /nci-drop nci-teamdrop/);
    const warns = () => (env.notices ?? []).filter(([kind]) => kind === 'warn').at(-1)?.[1] ?? '';
    await teamHire._onDropTeam({ preventDefault() {}, data: { type: 'Actor', uuid: `Actor.${rook.id}` } });
    assert.match(warns(), /a team member is an NPC, not a player's character/);
    await teamHire._onDropTeam({ preventDefault() {}, data: { type: 'Actor', uuid: 'Actor.a_Kade' } });
    assert.match(confirmed, /Add Kade to your team, as Bookkeeper/);
    await S.BusinessService.processActor(med);
    assert.equal(receipt(med).ok, true, receipt(med).reason);
    const kadeStaff = business().staff.find((s) => s.actorId === 'a_Kade');
    assert.deepEqual([kadeStaff.source, kadeStaff.name, kadeStaff.post, kadeStaff.teamBase], ['team', 'Kade', 'bookkeeper', 11]);
    game.actors.splice(game.actors.indexOf(kade), 1);
    // Without Teamwork there is no team to bring.
    med.items.splice(med.items.indexOf(role), 1);
    assert.doesNotMatch(text(render('templates/dialogs/hire.hbs', await hire._prepareContext())), /Your team/);
  } finally {
    if (med.items.includes(role)) med.items.splice(med.items.indexOf(role), 1);
    await S.BusinessRepository.save(saved);
  }
});

test('every data-action in the Business window and the staff windows has a handler', async () => {
  const { EmployeeDialogApp } = await import('../scripts/ui/Business/EmployeeDialogApp.js');
  const { HireDialogApp } = await import('../scripts/ui/Business/HireDialogApp.js');
  for (const [file, App] of [['templates/business/business.hbs', Apps.Business], ['templates/dialogs/employee.hbs', EmployeeDialogApp], ['templates/dialogs/hire.hbs', HireDialogApp]]) {
    const used = [...readFileSync(join(root, file), 'utf8').matchAll(/data-action="([^"]+)"/g)].map((m) => m[1]);
    for (const action of new Set(used)) assert.ok(action in App.DEFAULT_OPTIONS.actions, `${file}: no handler for "${action}"`);
  }
});

test('an applicant can be turned away: they leave the list, with their hidden trait', async () => {
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  const b = structuredClone(business());
  b.candidates = [...(b.candidates ?? []), { id: 'ad9-1', name: 'Oz Petrov', post: 'floor', level: 'skilled', base: 11, pct: 1.1, expires: b.period.endDay + 7 }];
  await S.BusinessRepository.save(b);
  await MarketStore.setBusinessesHidden({ ...MarketStore.getBusinessesHidden(), [b.id]: { ...(MarketStore.getBusinessesHidden()[b.id] ?? {}), traits: { 'ad-1': 'lightFingers', 'ad9-1': 'moonlighter' } } });
  const html = await renderBusiness(windowFor(med, 'staff'));
  assertClean(html, 'staff tab with an applicant to turn away');
  assert.match(html, /data-action="rejectApplicant" data-id="ad9-1"/);
  assert.ok('rejectApplicant' in Apps.Business.DEFAULT_OPTIONS.actions);
  await send(med, 'rejectApplicant', { businessId: b.id, candidateId: 'ad9-1' });
  assert.equal(receipt(med).ok, true, receipt(med).reason);
  assert.equal(business().candidates.some((c) => c.id === 'ad9-1'), false);
  assert.equal(MarketStore.getBusinessesHidden()[b.id].traits['ad9-1'], undefined, 'the trait goes too');
  assert.match(text(await renderBusiness(windowFor(med, 'ledger'))), /Oz Petrov turned away by Medtech/);
});

test('the Projects tab: days left in the header, Capacity against the ceiling, the project under way with its crew, every kind, and a history table', async () => {
  const b = structuredClone(business());
  b.till = 1300;
  b.projects = [
    { id: 'p1', kind: 'expansion', stage: 1, cost: 2500, gain: 0.8, daysNeeded: 6, days: 6, startedDay: b.openedDay, doneDay: b.openedDay + 3, status: 'done', crew: { [med.id]: 3, [fix.id]: 3 } },
    { id: 'p2', kind: 'refit', stage: 1, cost: 1500, daysNeeded: 4, days: 1, startedDay: b.openedDay + 5, status: 'active', crew: { [fix.id]: 1 } },
  ];
  await S.BusinessRepository.save(b);
  const html = await renderBusiness(windowFor(med, 'projects'));
  assertClean(html, 'projects tab');
  const words = text(html);
  assert.match(words, /Capacity [\d.]+ of 4\.50/);
  assert.match(html, /class="nci-capbar"/);
  assert.match(words, /Under way Refit started .*, 1,500 eb 1 of 4 business days done\./);
  assert.match(words, /Worked on by: Fixer 1/);
  assert.match(html, /data-action="addDays" data-id="p2"/);
  assert.match(words, /Project What it does Cost \(eb\) Business days Business days left 3\/3/);
  assert.match(words, /One project at a time/);
  assert.doesNotMatch(html, /data-action="proposeProject"/, 'nothing can be proposed while a project runs');
  assert.match(words, /Finished Project Result .* Expansion Capacity \+0\.8 2,500 6 Medtech 3, Fixer 3/);

  // Finished, the kinds can be proposed; one the cash cannot cover says so in figures.
  b.projects[1].status = 'done';
  await S.BusinessRepository.save(b);
  const free = await renderBusiness(windowFor(med, 'projects'));
  assert.match(free, /data-action="proposeProject" data-kind="staffRoom"/);
  assert.match(text(free), /Needs 2,000 eb; the cash holds 1,300 eb/);
});

test('Crew Tools downtime (B7b): project days and extra time come from a character\'s downtime, checked in their log', async () => {
  const { CrewToolsAdapter } = await import('../scripts/integrations/CrewToolsAdapter.js');
  const { rollSpec, investigationCost, BUSINESS_DEFAULTS, daysLeft } = await import('../scripts/engine/index.js');
  const { MODULE_ID, SETTINGS } = await import('../scripts/utils/constants.js');
  // A stand-in for Crew Tools' API, with its balance rule and its refusal when a GM has not prepared the character.
  const log = { period: 1, accounts: [{ actorId: med.id }], events: [] };
  const crew = {
    active: true,
    api: { downtime: {
      getState: (id) => ({ ...log, accounts: log.accounts.filter((a) => a.actorId === id), events: log.events.filter((e) => e.actorId === id) }),
      use: async (days, kind, reason, actorId, extra) => {
        if (!log.accounts.some((a) => a.actorId === actorId)) throw new Error('A GM must open Downtime once.');
        log.events.push({ id: `ev${log.events.length}`, actorId, kind, days, reason, period: log.period, projectId: extra.projectId });
      },
    } },
  };
  const modules = game.modules;
  game.modules = { get: (id) => (id === 'pneuma-crewtools' ? crew : modules.get(id)) };
  const saved = structuredClone(business());
  const warnings = [];
  const warn = ui.notifications.warn;
  ui.notifications.warn = (text) => warnings.push(text);
  const pid = 'prj_downtime';
  const project = () => business().projects.find((x) => x.id === pid);
  try {
    await S.BusinessRepository.save({ ...saved, proposals: [], projects: [...saved.projects.filter((x) => x.status !== 'active'), { id: pid, kind: 'refit', status: 'active', days: 0, daysNeeded: 4, cost: 0, crew: {}, startedDay: saved.period.startDay }], period: { ...saved.period, days: {} } });
    const app = windowFor(med, 'projects');
    app.render = () => {};
    const addDays = Apps.Business.DEFAULT_OPTIONS.actions.addDays;
    const clickAdd = (days) => addDays.call(app, null, { dataset: { id: pid }, closest: () => ({ querySelector: () => ({ value: String(days) }) }) });
    const processed = () => S.BusinessService.processActor(med);

    // None awarded: nothing to spend, and the weekly allowance has gone.
    assert.equal(CrewToolsAdapter.active(), true);
    assert.equal(daysLeft(business(), med.id, CrewToolsAdapter.params(med, business())), 0);
    assert.match(text(await renderBusiness(windowFor(med, 'week'))), /You have 0 downtime day\(s\) left/);
    await clickAdd(1);
    assert.equal(log.events.length, 0, 'nothing is spent');
    assert.match(warnings.at(-1), /downtime day/);

    // Awarded: what is spent goes to the project, once.
    log.events.push({ id: 'award', actorId: med.id, kind: 'award', days: 5, period: 1 });
    assert.equal(CrewToolsAdapter.balance(med.id), 5);
    const tab = text(await renderBusiness(windowFor(med, 'projects')));
    assert.match(tab, /Downtime days left 5/);
    assert.match(tab, /Your Crew Tools downtime goes into it/);
    await clickAdd(2);
    await processed();
    assert.equal(project().days, 2);
    assert.equal(CrewToolsAdapter.balance(med.id), 3);
    assert.equal(log.events.at(-1).kind, 'spend');
    assert.match(log.events.at(-1).reason, /Refit/);
    assert.equal(daysLeft(business(), med.id, CrewToolsAdapter.params(med, business())), 3, 'what is left is their balance, whatever this week has used');

    // Only what the project still needs is spent.
    await clickAdd(5);
    await processed();
    assert.equal(CrewToolsAdapter.balance(med.id), 1, 'two of the five');

    // Refused: no claim, a claim not in the log, the wrong days, and a key used again.
    await S.BusinessRepository.save({ ...business(), projects: business().projects.map((x) => (x.id === pid ? { ...x, status: 'active', days: 0 } : x)) });
    const claim = async (payload) => {
      await S.BusinessClient.submit(med, 'addDays', { businessId: business().id, projectId: pid, days: 1, ...payload });
      await processed();
      return receipt(med);
    };
    assert.equal((await claim({})).reason, 'no-days', 'no weekly days to fall back on');
    assert.equal((await claim({ downtime: { key: 'forged', days: 1 } })).reason, 'no-downtime');
    const paid = log.events.findLast((e) => e.kind === 'spend');
    assert.equal((await claim({ downtime: { key: paid.projectId, days: paid.days + 1 } })).reason, 'no-downtime', 'more than was spent');
    assert.equal((await claim({ downtime: { key: paid.projectId, days: paid.days } })).reason, 'no-downtime', 'already counted');
    log.events.push({ id: 'old', actorId: med.id, kind: 'spend', days: 1, period: 0, projectId: 'lastSession' });
    assert.equal((await claim({ downtime: { key: 'lastSession', days: 1 } })).reason, 'no-downtime', 'from a session gone by');
    assert.equal(project().days, 0, 'none of them added anything');

    // Extra time on a roll: offered only with a day to spend; the GM's side needs that day's spend credited.
    const spec = (params) => rollSpec(business(), { type: 'action', action: 'work', use: null }, med.id, { day: business().period.startDay, params });
    log.events.push({ id: 'more', actorId: med.id, kind: 'award', days: 1, period: 1 });
    assert.equal(spec(CrewToolsAdapter.params(med, business())).extraAvailable, true);
    assert.equal(spec(CrewToolsAdapter.gmParams()).extraAvailable, false);
    const dialog = new Apps.Roll({ actorId: med.id, businessId: business().id, request: { type: 'action', businessId: business().id, action: 'work' }, rollTitle: 'Work' });
    assert.match(text(render('templates/dialogs/roll.hbs', await dialog._prepareContext())), /Extra time spends a downtime day/);
    log.events.push({ id: 'all', actorId: med.id, kind: 'spend', days: CrewToolsAdapter.balance(med.id), period: 1, projectId: 'elsewhere' });
    assert.equal(spec(CrewToolsAdapter.params(med, business())).extraAvailable, false, 'none left');

    // An investigation's legwork is money: there are no business days to take it from.
    assert.equal(investigationCost([business()], med.id, null, CrewToolsAdapter.gmParams()).businessId, null);
    assert.equal(investigationCost([business()], med.id, null, CrewToolsAdapter.gmParams()).fee, BUSINESS_DEFAULTS.ownership.investigate.legwork);

    // A character with no account is told why.
    const stranger = { id: 'nobody' };
    assert.equal(CrewToolsAdapter.prepared(stranger.id), false);
    log.accounts = [];
    assert.match(text(await renderBusiness(windowFor(med, 'week'))), /a GM has to open Crew Tools/);
    log.accounts = [{ actorId: med.id }];

    // Switched off, the weekly allowance is back, Crew Tools or no.
    await game.settings.set(MODULE_ID, SETTINGS.CREW_DOWNTIME, false);
    assert.equal(CrewToolsAdapter.active(), false);
    assert.equal(CrewToolsAdapter.params(med, business()), BUSINESS_DEFAULTS);
    assert.match(text(await renderBusiness(windowFor(med, 'week'))), /business day\(s\) left this week/);
    await game.settings.set(MODULE_ID, SETTINGS.CREW_DOWNTIME, true);
  } finally {
    game.modules = modules;
    ui.notifications.warn = warn;
    await S.BusinessRepository.save(saved);
  }
});
