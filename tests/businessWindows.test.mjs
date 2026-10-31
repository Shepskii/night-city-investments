import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import Handlebars from 'handlebars';
import { registerPartials } from './helpers/partials.mjs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';
import { installFakeItems } from './helpers/fakeItems.mjs';

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
const fakeItems = installFakeItems();
const kit = fakeItems.give(med, { name: 'Surgical kit', type: 'gear', system: { price: { market: 800 } } });
// Weekly events are drawn from the business's id, so ids are fixed to keep the weeks the same each run.
let nextId = 0;
globalThis.foundry.utils.randomID = () => `id${String(++nextId).padStart(14, '0')}`;

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
  await send(med, 'found', { name: 'Back Room', archetype: 'clinic', location: 'Watson', cash: 1000, gear: [{ uuid: kit.uuid }], invite: [fix.id] });
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
  for (const tab of ['overview', 'week', 'projects', 'ledger', 'partners', 'growth']) {
    const html = await renderBusiness(windowFor(med, tab));
    assertClean(html, `open ${tab}`);
  }
  const week = text(await renderBusiness(windowFor(med, 'week')));
  for (const name of ['Work the shop', 'Promote', 'Source supplies', 'Fix the place up', 'Keep it safe']) assert.match(week, new RegExp(name));
  const growth = text(await renderBusiness(windowFor(med, 'growth')));
  assert.match(growth, /To become a Registered business/);
  assert.match(growth, /4 full weeks open/);
  const projects = text(await renderBusiness(windowFor(med, 'projects')));
  assert.match(projects, /Business days left 3\/3/);
  assert.match(projects, /Expansion .* Refit .* Security upgrade .* Storefront .* Staff room/);
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

test('a registered business shows its loans, the bank, investors and an angel', async () => {
  const b = S.BusinessRepository.all()[0];
  await S.BusinessRepository.save({
    ...b, stage: 1, state: { ...b.state, compliance: 55 },
    loans: [{ id: 'l1', kind: 'fixer', principal: 1000, balance: 800, rate: 0.05, payment: 100, startedDay: b.period.startDay, missed: 1 }],
    approved: { angel: { total: 17, name: 'Mira Sato' } },
  });
  const ledger = text(await renderBusiness(windowFor(med, 'ledger')));
  assertClean(await renderBusiness(windowFor(med, 'ledger')), 'registered ledger');
  assert.match(ledger, /A fixer(&#x27;|')s loan: 800 eb owed at 5\.0% a week/);
  assert.match(ledger, /1 payment\(s\) missed/);
  assert.match(ledger, /Propose going to a bank/);
  assert.match(ledger, /Put more in/);
  assert.match(await renderBusiness(windowFor(med, 'ledger')), /data-gear="contribute"/, 'a running business takes top-ups, with gear dragged in');
  const partners = text(await renderBusiness(windowFor(med, 'partners')));
  assertClean(await renderBusiness(windowFor(med, 'partners')), 'registered partners');
  assert.match(partners, /Mira Sato will hear your pitch \(their skill: 17\)/);
  assert.match(partners, /Pitch to the angel/);
  const overview = text(await renderBusiness(windowFor(med, 'overview')));
  assert.match(overview, /Compliance/);
});

test('the overview charts the weeks the business keeps: bars, cash and each standing by band', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const week = (i, profit, till, reputation) => ({
    index: i + 1, startDay: b.openedDay + 7 * i, endDay: b.openedDay + 7 * (i + 1), takings: 300 + profit, upkeep: 300, profit, till,
    bands: { reputation, capacity: 'room', costs: 'fair', compliance: 'sound' }, actions: [],
  });
  // Week 3 paid 50 eb of wages (40 counted in its profit, 10 back pay) and 30 eb went out besides (a draw).
  const third = { ...week(2, 220, 1160, 'good'), takings: 560, wages: 40, paid: 50, opening: 980 };
  await S.BusinessRepository.save({ ...b, digests: [week(0, -120, 900, 'poor'), week(1, 80, 980, 'modest'), third] });
  try {
    const html = await renderBusiness(windowFor(med, 'overview'));
    assertClean(html, 'overview with charts');
    assert.equal((html.match(/class="nci-chart"/g) ?? []).length, 2, 'the weekly bars and the cash line');
    assert.match(html, /<title>Week 1 \(to [^)]+\): takings 180 eb, costs 300 eb, profit -120 eb<\/title>/);
    assert.match(html, /<title>Week 3 \(to [^)]+\): takings 560 eb, costs 340 eb, profit \+220 eb<\/title>/, 'the costs bar holds everything the profit takes off');
    assert.match(html, /Week 3 \(to [^)]+\): cash 1,160 eb \(from 980 eb: takings 560, upkeep −300, wages −50, other -30\)/, 'the cash line accounts for every eddie');
    const ledger = await renderBusiness(windowFor(med, 'ledger'));
    assertClean(ledger, 'ledger with weeks');
    assert.match(text(ledger), /Takings\s+Upkeep\s+Wages\s+Other\s+Profit\s+Cash/);
    assert.match(text(ledger), /\+560\s+-300\s+-50\s+-30\s+\+220\s+1,160/, 'cash at the start + takings - upkeep - wages + other = cash at the close');
    const reputation = html.match(/Reputation<\/span>\s*<span class="nci-cells">(.*?)<\/span>\s*<strong/s)[1];
    assert.deepEqual([...reputation.matchAll(/nci-lvl(-?\d)/g)].map((m) => m[1]), ['0', '1', '2', ...Array(9).fill('-1')], 'poor, modest, good from the left, then empty slots for the weeks to come');
    assert.match(text(html), /The last 3 week\(s\)/);
  } finally {
    await S.BusinessRepository.save(saved);
  }
  const empty = await renderBusiness(windowFor(med, 'overview'));
  assert.match(text(empty), new RegExp(S.BusinessRepository.all()[0].digests.length ? 'The last' : 'The charts fill in'));
});

test('the investor list offers player characters and characters linked to NCM brokers and investors, nobody else', async () => {
  const npc = (name) => ({ id: `a_${name}`, name, type: 'character', hasPlayerOwner: false });
  const extra = [npc('Banker'), npc('Shark'), npc('Bystander'), { ...npc('Goon'), type: 'mook' }];
  game.actors.push(...extra);
  const contacts = [{ actorId: 'a_Banker', tags: ['Investor'] }, { actorId: 'a_Shark', tags: ['broker'] }, { actorId: null, tags: ['investor'] }, { actorId: 'a_Goon', tags: ['investor'] }];
  game.nightcity = { masterContactService: { filterByTag: (tag) => contacts.filter((c) => c.tags.some((t) => t.toLowerCase() === tag)) } };
  try {
    const html = await renderBusiness(windowFor(med, 'partners'));
    const options = [...html.matchAll(/<select name="investor">(.*?)<\/select>/gs)][0][1];
    const names = [...options.matchAll(/>([^<]+)<\/option>/g)].map((m) => m[1]);
    assert.deepEqual(names, ['Banker', 'Shark'], 'the partners are already in; the bystander and the mook are not offered');
  } finally {
    for (const a of extra) game.actors.splice(game.actors.indexOf(a), 1);
    delete game.nightcity;
  }
});

test('a character\'s stakes in open businesses show in the terminal\'s Portfolio tab, at book value', async () => {
  const { MarketTerminalApp } = await import('../scripts/ui/MarketTerminal/MarketTerminalApp.js');
  const { shareOf, bookValue } = await import('../scripts/engine/index.js');
  const b = S.BusinessRepository.all()[0];
  const stakes = new MarketTerminalApp()._privateStakes(med);
  assert.equal(stakes.length, 1);
  assert.equal(stakes[0].value, Math.round(shareOf(b, med.id) * bookValue(b)));
  assert.equal(stakes[0].stage, 'Registered business');
  assert.deepEqual([stakes[0].till, stakes[0].book], [b.till.toLocaleString(), bookValue(b).toLocaleString()], 'the cash and book value of the business too');
});

test('the Gigs tab shows a gig for the players\' business in its own section', async () => {
  const { GigImpactService } = await import('../scripts/services/GigImpactService.js');
  const b = S.BusinessRepository.all()[0];
  const out = await GigImpactService.report({ gigId: 'w1', outcome: 'done', client: b.name, reward: 1500 });
  assert.equal(out.status, 'pending');
  const app = new Apps.GMConsole();
  app.tab = 'gigs';
  const html = render('templates/gm/console.hbs', await app._prepareContext());
  assertClean(html, 'gigs tab with a business gig');
  assert.match(text(html), /For players(&#x27;|')? businesses/);
  assert.match(html, /data-action="gigApproveBusiness"/);
});

test('items dragged into the Start a business form are listed with their book value', async () => {
  const app = windowFor(fix);
  app.starting = true;
  app.gearDrafts.start.push({ uuid: 'Item.x', name: 'Toolkit', value: 1200, img: '', fromActor: true });
  const html = await renderBusiness(app);
  assertClean(html, 'start form with dragged gear');
  assert.match(text(html), /Toolkit 1,200 eb leaves your sheet/);
  assert.match(html, /data-action="removeGear" data-form="start" data-index="0"/);
});

test('the roll dialog offers only the hires the business can pay for', async () => {
  const b = S.BusinessRepository.all()[0];
  await S.BusinessRepository.save({ ...b, till: 200, period: { ...b.period, slots: [] } });
  const dialog = new Apps.Roll({ actorId: med.id, businessId: b.id, request: { type: 'action', businessId: b.id, action: 'work' }, rollTitle: 'Work' });
  const html = text(render('templates/dialogs/roll.hbs', await dialog._prepareContext()));
  assert.match(html, /A good hire/);
  assert.doesNotMatch(html, /The best money can buy/, '400 eb is more than the till holds');
});

test('a registered business shows the charter: milestones, the ticker, the rolls, and the GM tab shows it waiting', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  try {
    await S.BusinessRepository.save({
      ...b, stage: 1, till: 6000, assets: 3000, registeredDay: b.period.startDay - 91, state: { ...b.state, compliance: 50 },
      projects: [{ id: 'x1', kind: 'expansion', status: 'done', stage: 1 }],
      digests: [0, 1, 2, 3].map((i) => ({ index: i + 1, startDay: b.period.startDay - 28 + 7 * i, endDay: b.period.startDay - 21 + 7 * i, profit: 450, takings: 900, upkeep: 450, till: 6000, actions: [] })),
      loans: [], approved: {}, proposals: [], charter: null,
    });
    let html = await renderBusiness(windowFor(med, 'growth'));
    assertClean(html, 'charter milestones');
    assert.match(text(html), /12 weeks registered/);
    assert.match(text(html), /As a company it would be in the Healthcare sector/);
    assert.match(html, /name="ticker"/);
    assert.match(html, /data-action="proposeCharter"/);

    const cur = S.BusinessRepository.all()[0];
    await S.BusinessRepository.save({ ...cur, charter: { status: 'rolling', ticker: 'BRC', agreedDay: cur.period.startDay, rolls: { plan: { band: 'solid', success: true, margin: 3, by: med.id, day: cur.period.startDay } }, escrow: {} } });
    html = await renderBusiness(windowFor(med, 'growth'));
    assertClean(html, 'charter rolls');
    assert.match(text(html), /agreed to charter as BRC/);
    assert.match(text(html), /Business plan passed \(Solid success\)/);
    assert.match(html, /data-action="charterRoll" data-part="registration"/);
    assert.doesNotMatch(html, /data-part="plan"/, 'the plan has been rolled');

    const now = S.BusinessRepository.all()[0];
    await S.BusinessRepository.save({ ...now, charter: { ...now.charter, status: 'awaiting', quote: 8000, netAssets: 6000, shortfall: 2000, rolls: { ...now.charter.rolls, registration: { band: 'narrow', success: true }, capital: { band: 'solid', success: true, margin: 3 } } } });
    const gm = await renderConsole();
    assertClean(gm, 'charter waiting');
    assert.match(text(gm), /Charter as BRC waiting for you/);
    assert.match(gm, /data-action="businessCharterApprove"/);
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test('a company shows its officers, the information rolls and the report; a shareholder who is not an officer cannot take its actions', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  try {
    await S.BusinessRepository.save({
      ...b, stage: 2, till: 5000, company: { ticker: 'BRC', sector: 'health', charteredDay: b.period.startDay }, officers: [med.id],
      state: { ...b.state, compliance: 50 }, charter: null, proposals: [], reportWeeks: 1,
      lastAudit: { day: b.period.startDay - 7, band: 'exceptional', by: med.id, exposure: 'clean', found: 'low' },
      reports: [
        { index: 1, fromDay: b.period.startDay - 56, toDay: b.period.startDay - 28, weeks: 4, takings: 2781, upkeep: 1848, profit: 933, reported: 933 },
        { index: 2, fromDay: b.period.startDay - 28, toDay: b.period.startDay, weeks: 4, takings: 2693, upkeep: 2013, profit: 680, reported: 762, prep: { band: 'strong', bold: true, total: 24, by: med.id } },
      ],
    });
    const officer = await renderBusiness(windowFor(med, 'week'));
    assertClean(officer, 'company week');
    assert.match(text(officer), /Chase contracts/);
    assert.match(officer, /data-action="actionRoll" data-id="contracts"/);
    assert.match(officer, /data-action="auditRoll"/);
    assert.match(text(officer), /found Exposure low; the auditors cleaned some of it up, leaving it clean/);
    assert.match(officer, /name="targetName"/);
    assert.doesNotMatch(text(officer), /toward this month/, 'the monthly report is on the Ledger tab');
    const ledger = await renderBusiness(windowFor(med, 'ledger'));
    assertClean(ledger, 'company ledger');
    assert.match(text(ledger), /Week 2 of 4 toward this month/);
    assert.doesNotMatch(ledger, /data-action="reportRoll"/, 'only in the last week');
    // A share grant (E3), at a company only: half-percent steps up to 5%, from the Employee window.
    const { EmployeeDialogApp } = await import('../scripts/ui/Business/EmployeeDialogApp.js');
    const withHand = { ...S.BusinessRepository.all()[0], staff: [{ id: 'stf_h', actorId: null, name: 'Hand', source: 'recruit', post: 'floor', bases: { 'skill:Paramedic': 12 }, pct: 1, wage: 168, hiredDay: b.openedDay, status: 'active', owed: 0, loyalty: 50 }] };
    await S.BusinessRepository.save(withHand);
    const emp = render('templates/dialogs/employee.hbs', await new EmployeeDialogApp({ actorId: med.id, businessId: b.id, staffId: 'stf_h' })._prepareContext());
    assertClean(emp, 'employee window at a company');
    assert.match(text(emp), /Share grant/);
    assert.match(text(emp), /Left for grants: 5% of the company/);
    assert.match(emp, /<option value="0.5">0.5%<\/option>/);
    assert.match(emp, /<option value="5">5%<\/option>/);
    assert.match(emp, /data-action="proposeGrant"/);
    // Going public (B5a): the Growth tab's listing checklist, V, and (once agreed and approved) the prospectus rolls.
    const growth = text(await renderBusiness(windowFor(med, 'growth')));
    assert.match(growth, /To become a Listed company/);
    assert.match(growth, /Market valuation of at least 500,000 eb/);
    assert.match(growth, /No unresolved compliance concerns/);
    assert.match(growth, /Market valuation now: [\d,]+ eb \(sector multiple 12\)/);
    assert.doesNotMatch(growth, /Propose listing/, 'not yet worth enough');
    game.settings.set('night-city-investments', 'listingThreshold', 1000);
    const cur = S.BusinessRepository.all()[0];
    await S.BusinessRepository.save({ ...cur, company: { ...cur.company, charteredDay: cur.period.startDay - 90 }, reports: [3, 4, 5].map((index) => ({ index, fromDay: 0, toDay: 0, weeks: 4, takings: 100, upkeep: 50, profit: 50, reported: 50, valuation: 5000 })) });
    const ready = await renderBusiness(windowFor(med, 'growth'));
    assertClean(ready, 'listing checklist met');
    assert.match(ready, /data-action="proposeListing"/);
    assert.match(ready, /<option value="0.2">20%<\/option>/);
    assert.doesNotMatch(ready, /data-action="proposeStepUp"/, 'no registering at a company');
    assert.match(ready, /class="nci-hirerow nci-form">\s*<label>Float/, 'the float and its button on one row');
    const listing = S.BusinessRepository.all()[0];
    await S.BusinessRepository.save({ ...listing, listing: { status: 'awaiting', agreedDay: listing.period.startDay, float: 0.25, fee: 100, valuation: 5000, rolls: {}, retryDay: null } });
    const gmView = await renderConsole();
    assertClean(gmView, 'listing waiting for the GM');
    assert.match(text(gmView), /Listing as BRC waiting for you: valuation 5,000 eb, float 25%/);
    assert.match(gmView, /data-action="businessListingApprove"/);
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], listing: { ...S.BusinessRepository.all()[0].listing, status: 'prospectus' } });
    const rolls = await renderBusiness(windowFor(med, 'growth'));
    assert.match(rolls, /data-action="prospectusRoll" data-part="filing"/);
    assert.match(rolls, /data-action="prospectusRoll" data-part="offering"/);
    game.settings.set('night-city-investments', 'listingThreshold', 500000);
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], reports: cur.reports, listing: null });
    // Each report opens a window of its own: the real figures beside the reported ones.
    assert.match(ledger, /class="nci-row" data-action="openReport" data-index="2"/);
    assert.ok('openReport' in Apps.Business.DEFAULT_OPTIONS.actions);
    const { ReportDialogApp } = await import('../scripts/ui/Business/ReportDialogApp.js');
    const bold = await new ReportDialogApp({ businessId: b.id, index: 2 })._prepareContext();
    const report = text(render('templates/dialogs/report.hbs', bold));
    assertClean(render('templates/dialogs/report.hbs', bold), 'report window');
    assert.match(report, /Prepared aggressively by Medtech \(Strong success, 24\): it reports \+12% on the real profit/);
    assert.match(report, /Takings \+2,693 \+2,693 –/, 'takings reported as they were');
    assert.match(report, /Wages, interest and bills 0 0 –/, "a zero cost shows as 0, never -0");
    assert.match(report, /Profit \+680 \+762 \+82/, 'the profit real, reported, and the difference');
    assert.match(report, /an internal audit may find/);
    const plain = text(render('templates/dialogs/report.hbs', await new ReportDialogApp({ businessId: b.id, index: 1 })._prepareContext()));
    assert.match(plain, /Not prepared: the report shows the profit as earned/);
    assert.match(plain, /Profit \+933 \+933 –/);
    assert.match(text(render('templates/dialogs/report.hbs', await new ReportDialogApp({ businessId: b.id, index: 9 })._prepareContext())), /no longer kept/);

    const holder = await renderBusiness(windowFor(fix, 'week'));
    assertClean(holder, 'shareholder week');
    assert.match(text(holder), /not an officer/);
    assert.doesNotMatch(holder, /data-action="actionRoll"/);
    assert.doesNotMatch(holder, /data-action="auditRoll"/);

    const partners = await renderBusiness(windowFor(med, 'partners'));
    assertClean(partners, 'company partners');
    assert.match(text(partners), /officer/);
    // From chartering on, the owners are shareholders holding shares.
    assert.match(partners, /data-tab="partners"[^>]*>Shareholders</);
    assert.match(text(partners), /Shareholder\s+Shares\s+Share/);
    assert.match(text(partners), /shareholder · officer|shareholder &middot; officer/);
    assert.match(text(partners), /Book value per share/);
    assert.match(text(partners), /Day-to-day decisions by a majority of the shares/);
    assert.doesNotMatch(text(partners), /\bunits?\b/i, 'no units left in a company\'s wording');
    assert.match(text(await renderBusiness(windowFor(med, 'projects'))), /The shareholders agree on one/);
    assert.match(partners, new RegExp(`data-action="proposeElect" data-id="${fix.id}"`));
  } finally {
    await S.BusinessRepository.save(saved);
  }
});
