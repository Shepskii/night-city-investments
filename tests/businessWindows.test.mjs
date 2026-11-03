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
const renderConsole = async (tab = 'businesses') => {
  const app = new Apps.GMConsole();
  app.tab = tab;
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
  assert.match(text(roll), /Operator \(rank 4: \+13\)/, 'the role ability is offered at its rank and what it adds');
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
  assert.match(text(gm), /Businesses 1/, 'the tab counts what is waiting');
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
  assert.match(text(html), /You may draw up to/);
  const reports = await renderBusiness(windowFor(fix, 'reports'));
  assertClean(reports, 'reports with a week');
  assert.match(text(reports), /Week 1/);

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
    const ledger = await renderBusiness(windowFor(med, 'reports'));
    assertClean(ledger, 'reports with weeks');
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
  assert.equal(stakes[0].ticker, '', 'no ticker before a charter');
  // A chartered company's ticker shows beside its name, listed or not.
  await S.BusinessRepository.save({ ...b, company: { ticker: 'BRC', sector: 'health', charteredDay: b.period.startDay } });
  try {
    const chartered = new MarketTerminalApp()._privateStakes(med);
    assert.equal(chartered[0].ticker, 'BRC');
    const row = Handlebars.compile('{{#each stakes}}<td><strong>{{name}}</strong>{{#if ticker}} ({{ticker}}){{/if}} <span class="nci-muted">{{stage}}</span></td>{{/each}}')({ stakes: chartered });
    assert.match(row, /Back Room<\/strong> \(BRC\)/);
  } finally {
    await S.BusinessRepository.save(b);
  }
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
    // The ticker in the header, on every tab, once chartered (listed or not).
    assert.match(officer, /Chartered company \(BRC\) &middot;/);
    assertClean(officer, 'company week');
    assert.match(text(officer), /Chase contracts/);
    assert.match(officer, /data-action="actionRoll" data-id="contracts"/);
    assert.match(officer, /data-action="auditRoll"/);
    assert.match(text(officer), /found Exposure low; the auditors cleaned some of it up, leaving it clean/);
    assert.match(officer, /name="targetName"/);
    assert.doesNotMatch(text(officer), /toward this month/, 'the monthly report is on the Reports tab');
    const ledger = await renderBusiness(windowFor(med, 'reports'));
    assertClean(ledger, 'company reports');
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
    assert.match(growth, /Listing puts the company on the market as BRC/);
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
    // A listing waiting for votes reads as an IPO, not as registering.
    const voting = S.BusinessRepository.all()[0];
    await S.BusinessRepository.save({ ...voting, proposals: [{ id: 'p_list', kind: 'stepUp', by: med.id, day: voting.period.startDay, expires: voting.period.startDay + 7, votes: { [med.id]: true }, terms: { float: 0.25 } }] });
    assert.match(text(await renderBusiness(windowFor(med, 'partners'))), /Medtech proposes listing the company on the market as BRC in an IPO, floating 25% of its shares/);
    assert.match(text(await renderBusiness(windowFor(med, 'growth'))), /The listing is waiting for every shareholder's vote|The listing is waiting for every shareholder&#x27;s vote/);
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], proposals: [] });
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
    // Scheduled, then listed (B5b): the Growth tab says so; the header calls it a Listed company; the market's shares are the public float.
    const sch = S.BusinessRepository.all()[0];
    await S.BusinessRepository.save({ ...sch, listing: { status: 'scheduled', float: 0.25, offer: { price: 12.5, float: 0.25, shares: 300 }, listDay: sch.period.startDay + 5, rolls: {} } });
    assert.match(text(await renderBusiness(windowFor(med, 'growth'))), /The offering is open: 300 new shares of BRC at 12.5 eb a share/);
    await S.BusinessRepository.save({ ...sch, listing: { status: 'listed', float: 0.25, offer: { price: 12.5, float: 0.25, shares: 300 }, listedDay: sch.period.startDay, shares: 1300, rolls: {} },
      partners: [...sch.partners, { actorId: 'npc:market', name: '', status: 'active', cash: 0, gear: [], units: 300, voting: false, heirId: null, leavingSince: null, npc: true, market: true }] });
    const listedGrowth = await renderBusiness(windowFor(med, 'growth'));
    assert.match(text(listedGrowth), /Listed on the market as BRC since/);
    assert.match(listedGrowth, /Listed company \(BRC\) &middot;/);
    assert.match(text(await renderBusiness(windowFor(med, 'partners'))), /Public float \(the market\)/);
    await S.BusinessRepository.save({ ...sch, listing: null });
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

test('a company\'s later states render cleanly: a regulator\'s case, administration, a takeover offer, and a hidden holder shown as their layer', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const day = b.period.startDay;
  const rendered = async (state) => {
    await S.BusinessRepository.save({ ...b, stage: 2, till: 5000, company: { ticker: 'BRC', sector: 'health', charteredDay: day }, officers: [med.id, fix.id], state: { ...b.state, compliance: 50 }, charter: null, proposals: [], ...state });
    const out = { partners: await renderBusiness(windowFor(med, 'partners')), other: await renderBusiness(windowFor(fix, 'partners')), console: await renderConsole() };
    for (const [label, html] of Object.entries(out)) assertClean(html, `${label}: ${JSON.stringify(Object.keys(state))}`);
    return out;
  };
  try {
    const notice = await rendered({ regCase: { status: 'notice', reason: 'plant', openedDay: day, endDay: day + 14 } });
    assert.match(text(notice.partners), /Regulator\S+s case: a former employee went to the regulators/);
    assert.match(notice.partners, /data-action="answerCase"/, 'an officer can answer it');
    assert.match(text(notice.console), /Regulator\S+s case: .* Exposure \d+/, 'the GM sees the Exposure');
    assert.doesNotMatch(text(notice.partners), /Exposure \d/, 'a player does not');
    assert.match(notice.console, /data-action="businessCaseDrop"/);

    const lost = await rendered({ regCase: { status: 'lost', reason: 'report', openedDay: day, endDay: day + 14, fine: 250, serious: true, fumble: true } });
    assert.match(text(lost.partners), /The market is deciding the penalty/);
    assert.doesNotMatch(lost.partners, /data-action="answerCase"/);
    assert.match(lost.console, /name="caseFine"[^>]*value="250"/);
    assert.match(text(lost.console), /Serious:/);

    const clear = await rendered({});
    assert.match(clear.console, /data-action="businessCaseOpen"/, 'the GM can open one by hand');

    const admin = await rendered({ administration: { since: day, net: -500 } });
    assert.match(text(admin.partners), /In administration since/);
    assert.match(admin.console, /data-action="businessRestructure"/);

    const offer = await rendered({ takeover: { status: 'open', bidderId: 'x', bidderName: 'Raider', price: 12, shares: 100, reference: 10, openDay: day, endDay: day + 7, escrow: 1200, tenders: {}, defence: null } });
    assert.match(text(offer.partners), /Raider offers 12 eb a share/);

    // Factions (F1a): the GM's tab and the owners' bands, with the turf's gangs shown even before any dealing.
    const { FactionRepository } = await import('../scripts/data/FactionRepository.js');
    await FactionRepository.importStarter();
    assert.equal((await S.BusinessService.setStanding(b.id, 'corp_bio', 35)).ok, true);
    await rendered({ district: 'watson', standings: { corp_bio: 'friendly' } });
    const overview = text(await renderBusiness(windowFor(med, 'overview')));
    assert.match(overview, /Standing with factions/);
    assert.match(overview, /Biotechnica \(friendly\)/);
    assert.match(overview, /Tyger Claws \(your turf\)/);
    const standingsAt = overview.indexOf('Standing, week by week');
    assert.ok(standingsAt >= 0 && standingsAt < overview.indexOf('Standing with factions'), 'the factions come last');
    assert.doesNotMatch(overview, /Maelstrom/, 'a faction it has not met, off its turf');
    const tab = await renderConsole('factions');
    assertClean(tab, 'factions tab');
    assert.match(tab, /data-action="factionImport"/);
    assert.ok(tab.indexOf('data-action="factionAdd"') < tab.indexOf('<table'), 'adding comes first, as on Companies and Funds');
    assert.doesNotMatch(tab, /SetStanding/, 'standing is on the Businesses tab');
    const running = await renderConsole('businesses');
    assert.match(running, /data-action="businessSetStanding"/);
    assert.match(text(running), /Biotechnica friendly 35/, 'the GM sees the number');
    assert.match(text(running), /Tyger Claws \(your turf\) neutral 0/, 'and a gang on the turf, with no dealings yet');

    // A contract on the Gigs tab: every party it moves, and a tick for a target only found in the text.
    const extras = ['client', 'contractor', 'target'].map((role) => ({ role, name: `Co ${role}`, percent: role === 'target' ? -1.5 : 3, companyId: 'X', amount: 0.03 }));
    const { MarketStore } = await import('../scripts/data/MarketStore.js');
    const gigsBefore = MarketStore.getGigs();
    await MarketStore.setGigs({ ...gigsBefore, pending: [{
      id: 'p1', kind: 'business', sourceKey: 'gig:p1', businessId: b.id, client: 'Kiroshi', title: 'Contract', outcome: 'done', reward: 2000, date: '2045-01-01', how: 'tag',
      reputation: 2, takings: 0.05, factionName: 'Kiroshi Optical', extras, target: { name: 'Co target', how: 'text', factionId: 'f', ticker: 'X' },
    }] });
    const gigTab = await renderConsole('gigs');
    assertClean(gigTab, 'gigs tab');
    assert.match(text(gigTab), /The client, Co client: \+3% on its share price/);
    assert.match(text(gigTab), /The contractor, Co contractor/);
    assert.match(text(gigTab), /The target, Co target: -1\.5%/);
    assert.match(text(gigTab), /standing with Kiroshi Optical/);
    assert.match(gigTab, /name="gigUseTarget"/);
    await MarketStore.setGigs(gigsBefore);

    // The Exec's own row against another shareholder's view of it, and the running text.
    const hidden = await rendered({
      masks: { [med.id]: [{ kind: 'nominee', name: 'Vex', day, lastFee: day, ref: 'r1' }, { kind: 'shell', name: 'Kestrel Holdings', day, lastFee: day, ref: 'r2' }] },
      proposals: [{ id: 'p1', kind: 'payout', by: med.id, day, expires: day + 7, votes: {}, terms: { ratio: 0.5 } }],
    });
    assert.match(text(hidden.partners), /Hidden ownership/);
    assert.match(text(hidden.other), /Kestrel Holdings proposes/, 'a proposal under the layer');
    // (The account picker lists this test user's own characters, and the heir list every character: look past both.)
    const body = text(hidden.other).slice(text(hidden.other).indexOf('Chartered company')).replace(/My heir .*? Save /, '');
    assert.doesNotMatch(body, /Medtech/, 'the other shareholder never sees the name');
    assert.match(text(hidden.console), /Medtech/, 'the GM Console does');
    assert.match(text(hidden.console), /hidden as Kestrel Holdings/);
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test('the Pending tab has a row for each decision waiting, and the tab buttons count the same rows', async () => {
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const gigsBefore = MarketStore.getGigs();
  const heatBefore = MarketStore.getHeat();
  const day = b.period.startDay;
  const button = (html, attr, id) => text(html.match(new RegExp(`<nav[\\s\\S]*?data-${attr}="${id}"[^>]*>([\\s\\S]*?)</button>`))[1]).trim();
  const group = (html, id) => button(html, 'group', id);
  const tabButton = (html, id) => button(html, 'tab', id);
  try {
    await S.BusinessRepository.save({
      ...b, status: 'open', stage: 2, company: { ticker: 'BRC', sector: 'health', charteredDay: day }, proposals: [],
      charter: { status: 'awaiting', ticker: 'BRC', agreedDay: day, quote: 1, netAssets: 1, shortfall: 0, rolls: {} },
      listing: { status: 'awaiting', agreedDay: day, float: 0.25, fee: 1, valuation: 1, rolls: {}, review: { marketCap: 1, since: day } },
      takeover: { status: 'awaiting', bidderId: 'x', bidderName: 'Rival', price: 5, shares: 10, tenders: {} },
      administration: { since: day },
      regCase: { status: 'lost', reason: 'report', openedDay: day, endDay: day + 14, fine: 250 },
      campaign: { status: 'awaiting', ticker: 'ARA', name: 'Arasaka', kind: 'smear', percent: -1.5, actorId: med.id, day },
      staff: [{ id: 's_t', actorId: fix.id, name: 'Nix', post: 'floor', wage: 100, status: 'offered', source: 'npc' }],
    });
    await MarketStore.setGigs({ ...gigsBefore, pending: ['mapping', 'review', 'business'].map((kind, i) => ({ id: `p${i}`, kind, sourceKey: `gig:p${i}`, client: 'Kiroshi', title: `Job ${kind}`, outcome: 'done', reward: 100, date: '2045-01-01', how: 'tag' })) });
    await MarketStore.setHeat({ ...heatBefore, penalties: [{ id: 'h1', actorId: med.id, name: 'Medtech', kind: 'fine', params: { amount: 500 }, status: 'pending' }, { id: 'h2', actorId: med.id, name: 'Done', kind: 'fine', params: { amount: 1 }, status: 'applied' }] });

    const html = await renderConsole('pending');
    assertClean(html, 'pending tab');
    assert.equal(group(html, 'pending'), 'Pending 12');
    assert.equal(group(html, 'players'), 'Players 9', 'each group shows its tabs\' total');
    assert.equal(group(html, 'tools'), 'Tools 3', 'business gigs count as well');
    assert.match(html, /<span class="nci-count">12<\/span>/, 'as a count of its own');
    assert.equal(group(html, 'market'), 'Market');
    assert.doesNotMatch(html.match(/<\/nav>[\s\S]*/)[0], /<nav/, 'the Pending group has no second row');
    const players = await renderConsole('businesses');
    assertClean(players, 'every decision on the Businesses tab');
    assert.equal(tabButton(players, 'businesses'), 'Businesses 8');
    assert.equal(tabButton(players, 'heat'), 'Heat 1');
    assert.equal(tabButton(await renderConsole('gigs'), 'gigs'), 'Gigs 3');
    // Every GM button on an entry but Open, at the top, comes after its tables, and an offer's words are with its buttons.
    const entry = players.split('<div class="nci-gig nci-bizentry">').find((x) => x.includes('businessRestructure'));
    assert.ok(entry.indexOf('data-action="businessOpen"') < entry.indexOf('<table'), 'Open is at the top');
    assert.ok(entry.lastIndexOf('</table>') < entry.replace('data-action="businessOpen"', '').indexOf('data-action='), 'the other buttons are at the foot');
    assert.ok(entry.indexOf('Nix') > entry.indexOf('nci-gmbuttons'));
    assert.match(entry, /A smear against Arasaka \(ARA\)/);
    assert.match(entry, /data-action="businessCampaignApprove"/);
    assert.equal(html.match(/<tr class="nci-row" data-action="switchTab"/g).length, 12);

    // Each decision can be made on the row, with its home tab's own actions and fields.
    const consoleActions = Apps.GMConsole.DEFAULT_OPTIONS.actions;
    for (const [, action] of html.matchAll(/data-action="([^"]+)"/g)) assert.ok(action in consoleActions, `no handler for ${action}`);
    for (const action of ['gigMap', 'gigApprove', 'gigApproveBusiness', 'gigDiscard', 'heatApprove', 'heatDismiss', 'businessCharterApprove', 'businessCharterReject',
      'businessListingApprove', 'businessDelist', 'businessGiveTime', 'businessTakeoverApprove', 'businessRestructure', 'businessWindUp', 'businessCaseFine', 'businessCaseDrop',
      'businessCampaignApprove', 'businessCampaignReject', 'businessStaffAnswer']) assert.match(html, new RegExp(`data-action="${action}"`), action);
    for (const name of ['gigCompany', 'gigRemember', 'gigPercent', 'gigDelay', 'gigHeadline', 'caseFine']) assert.match(html, new RegExp(`name="${name}"`), name);
    assert.match(html, /name="penaltyAmount" value="500" min="0"/, 'starting from what is proposed, and a minimum of 0 is kept');
    assert.match(html, /data-action="businessStaffAnswer" data-id="[^"]+" data-staff="[^"]+" data-yes="true"/);
    // A click on the row opens its tab; a click among its fields does not.
    const pendingApp = new Apps.GMConsole();
    pendingApp.tab = 'pending';
    pendingApp.render = () => {};
    const rowClick = (inFields) => consoleActions.switchTab.call(pendingApp, { target: { closest: () => inFields } }, { dataset: { tab: 'businesses' } });
    rowClick(true);
    assert.equal(pendingApp.tab, 'pending', 'clicking a field stays here');
    rowClick(null);
    assert.equal(pendingApp.tab, 'businesses', 'clicking the row goes there');
    // A handler finds its field in the row as it does in a home tab's card.
    const approveFine = S.BusinessService.approveCaseFine;
    let fined = null;
    S.BusinessService.approveCaseFine = async (id, fine) => { fined = fine; return { ok: true }; };
    await consoleActions.businessCaseFine.call(pendingApp, null, { dataset: { id: b.id }, closest: (sel) => (sel.split(', ').includes('tr') ? { querySelector: () => ({ value: '750' }) } : null) });
    S.BusinessService.approveCaseFine = approveFine;
    assert.equal(fined, 750);

    for (const words of [/Job mapping Choose which company/, /Medtech Approve or dismiss the penalty: Fine of 500 eb/, /Approve or reject the charter/, /Approve or turn down the listing/,
      /Delisting review/, /takeover offer from Rival/, /In administration/, /Regulator\S+s case lost/, /A campaign against Arasaka/, /Answer for Nix/]) assert.match(text(html), words);
    assert.match(html, /<tr class="nci-row" data-action="switchTab" data-tab="businesses">/);

    await S.BusinessRepository.save({ ...b, status: 'open', charter: null, listing: null, takeover: null, administration: null, regCase: null, campaign: null, staff: [] });
    await MarketStore.setGigs({ ...gigsBefore, pending: [] });
    await MarketStore.setHeat({ ...heatBefore, penalties: [] });
    const quiet = await renderConsole('pending');
    assertClean(quiet, 'nothing pending');
    assert.match(text(quiet), /No items waiting/);
    assert.equal(group(quiet, 'pending'), 'Pending');
    assert.equal(group(quiet, 'players'), 'Players');
  } finally {
    await S.BusinessRepository.save(saved);
    await MarketStore.setGigs(gigsBefore);
    await MarketStore.setHeat(heatBefore);
  }
});

test('aiming at a faction: the Work tab offers the pick and the gift, the action moves standing, and hostile acts show whose they are', async () => {
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  const { FactionRepository } = await import('../scripts/data/FactionRepository.js');
  await FactionRepository.importStarter();
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const hiddenBefore = MarketStore.getBusinessesHidden();
  try {
    await S.BusinessRepository.save({ ...b, status: 'open', stage: 0, company: null, charter: null, listing: null, takeover: null, administration: null, regCase: null, officers: [], district: 'ocz', till: 5000, standings: {}, proposals: [], period: { ...b.period, slots: [], bonuses: [], helpers: [], event: null } });
    const shop = await renderBusiness(windowFor(med, 'week'));
    assertClean(shop, 'shop week');
    assert.match(text(shop), /Court a client/);
    assert.match(text(shop), /Pay respects/);
    assert.match(text(shop), /100 eb gift/);
    assert.match(shop, /name="aimFaction"[\s\S]*Maelstrom/);

    dice = [10];
    const current = S.BusinessRepository.all()[0];
    const aimed = { type: 'action', businessId: current.id, action: 'respects', factionId: 'gang_maelstrom' };
    const dialog = new Apps.Roll({ actorId: med.id, businessId: current.id, request: aimed, rollTitle: 'Pay respects' });
    const roll = render('templates/dialogs/roll.hbs', await dialog._prepareContext());
    assertClean(roll, 'aimed roll dialog');
    assert.match(text(roll), /standing up/);
    await S.BusinessClient.roll(med, current, { ...aimed, use: { kind: 'skill', skill: 'Persuasion', stat: 'cool' } }, { title: 'Pay respects' });
    await S.BusinessService.processActor(med);
    const after = S.BusinessRepository.all()[0];
    assert.equal(after.period.slots.at(-1)?.factionId, 'gang_maelstrom', JSON.stringify(after.period.slots));
    assert.equal(after.till, 4900, 'the gift');
    assert.ok(MarketStore.getBusinessesHidden()[after.id].standing.gang_maelstrom.value > 0, 'standing rose');
    assert.equal(after.standings.gang_maelstrom !== undefined, true, 'the band is on the record');
    const done = await renderBusiness(windowFor(med, 'week'));
    assertClean(done, 'aimed and taken');
    assert.match(text(done), /Aimed at Maelstrom/);

    // Good terms on the Overview tab, and the week's event saying whose it is.
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], standings: { gang_maelstrom: 'allied', corp_bio: 'hostile', corp_mil: 'wary' }, period: { ...S.BusinessRepository.all()[0].period, event: { kind: 'smear', factionId: 'corp_bio', factionName: 'Biotechnica' } } });
    const over = await renderBusiness(windowFor(med, 'overview'));
    assertClean(over, 'overview terms');
    assert.match(text(over), /Protection money from gangs on your turf: -50%/);
    assert.match(text(over), /Negative Neutral Friendly/);
    const [, negative, neutral, friendly] = over.match(/<table class="nci-market nci-factions">[\s\S]*?<\/table>/)[0].split('<td');
    assert.match(text(`<td${negative}`), /Biotechnica \(hostile\) Militech \(wary\)/, 'the strongest feeling first');
    assert.match(text(`<td${neutral}`), /Inquisitors \(your turf\)/, 'a gang on the turf, even with no dealings');
    assert.match(text(`<td${friendly}`), /Maelstrom \(allied\) \(your turf\)/);
    const hit = await renderBusiness(windowFor(med, 'week'));
    assertClean(hit, 'a hostile act');
    assert.match(text(hit), /A smear campaign/);
    assert.match(text(hit), /This is Biotechnica/);
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], period: { ...S.BusinessRepository.all()[0].period, event: { kind: 'shakedown', factionId: 'gang_maelstrom', factionName: 'Maelstrom' } } });
    assert.match(text(await renderBusiness(windowFor(med, 'week'))), /It\S+s Maelstrom\. Beating them with force/);

    // A company aims its own actions, and has no shop actions to take.
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], stage: 2, company: { ticker: 'BRC', sector: 'health', charteredDay: b.period.startDay }, officers: [med.id], period: { ...S.BusinessRepository.all()[0].period, slots: [], event: null } });
    const company = await renderBusiness(windowFor(med, 'week'));
    assertClean(company, 'company week');
    assert.doesNotMatch(text(company), /Court a client/);
    assert.match(company, /<option value="">No faction<\/option>/);
    assert.match(text(company), /1,000 eb gift/);
  } finally {
    await S.BusinessRepository.save(saved);
    await MarketStore.setBusinessesHidden(hiddenBefore);
  }
});

test('the console\'s tabs are in groups: a group goes to its last open tab, and every tab renders under one', async () => {
  const app = new Apps.GMConsole();
  app.render = () => {};
  const { switchTab } = Apps.GMConsole.DEFAULT_OPTIONS.actions;
  const go = (dataset) => switchTab.call(app, null, { dataset });
  go({ group: 'players' });
  assert.equal(app.tab, 'businesses', 'a group\'s first tab');
  go({ tab: 'heat' });
  go({ group: 'tools' });
  assert.equal(app.tab, 'gigs');
  go({ group: 'players' });
  assert.equal(app.tab, 'heat', 'back to the last one open in that group');
  go({ tab: 'nonsense' });
  assert.equal(app.tab, 'heat');

  const seen = new Set();
  for (const { id } of (await app._prepareContext()).tabs) {
    const html = await renderConsole(id);
    assertClean(html, `the ${id} tab`);
    const context = (() => { const a = new Apps.GMConsole(); a.tab = id; return a._prepareContext(); })();
    const { groups, subTabs } = await context;
    assert.equal(groups.filter((g) => g.active).length, 1, id);
    assert.ok(id === 'pending' ? subTabs.length === 0 : subTabs.some((t) => t.id === id && t.active), `${id} is in its group's row`);
    seen.add(id);
  }
  assert.equal(seen.size, 14);
  assert.match(await renderConsole('actions'), />\s*Corp actions\s*</);
});

test('a story waiting for the GM shows on Market > Events and the Pending tab; Events can make evidence', async () => {
  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  const saved = MarketStore.getStories();
  try {
    await MarketStore.setStories({ pending: [{ id: 's1', actorId: med.id, media: 'Medtech', ticker: 'ARA', name: 'Arasaka', angle: 'expose', percent: -4.2, day: 1, rank: 5, headline: 'Arasaka hides a crash' }], recent: [] });
    const events = await renderConsole('events');
    assertClean(events, 'events tab with a story');
    assert.match(text(events), /Medtech: Exposé \(price down\) on Arasaka \(ARA\), -4\.2% on its share price/);
    assert.match(text(events), /Arasaka hides a crash/);
    assert.match(events, /data-action="storyApprove"/);
    assert.match(events, /data-action="storyReject"/);
    const pending = await renderConsole('pending');
    assertClean(pending, 'pending tab with a story');
    assert.match(text(pending), /A story about Arasaka: let it run or spike it/);
    assert.match(pending, /<tr class="nci-row" data-action="switchTab" data-tab="events">/);
  } finally {
    await MarketStore.setStories(saved);
  }
  assertClean(await renderConsole('tools'), 'audit tab');
  assert.doesNotMatch(await renderConsole('tools'), /data-action="createEvidence"/, 'it moved to Events');
  const market = await renderConsole('events');
  assert.match(market, /data-action="createEvidence"/);
  assert.match(market, /name="evidenceActor"/);
  // Evidence follows Set a price, and the event queue comes last.
  const at = (key) => market.indexOf(key);
  assert.ok(at('data-action="setPrice"') < at('data-action="createEvidence"'));
  assert.ok(at('data-action="createEvidence"') < market.lastIndexOf('class="nci-block"'));
  assert.ok(at('data-action="addShock"') < at('data-action="setPrice"'));
});

test('every rumour reads as words, saying more at each level', async () => {
  const { StoryService } = await import('../scripts/services/StoryService.js');
  const move = { kind: 'move', name: 'Kendachi', ticker: 'KEN', percent: 2, days: 3, up: false, why: 'gig' };
  const hidden = { kind: 'hidden', name: 'Back Room', ticker: 'BRC', percent: 12, layer: 'Kestrel Holdings' };
  const said = [0, 1, 2, 3].flatMap((level) => [StoryService._rumourText(move, level), StoryService._rumourText(hidden, level)]);
  for (const line of said) assert.doesNotMatch(line, /NCI\.|\{\w+\}/, line);
  assert.doesNotMatch(said[0], /down/, 'a vague one does not say which way');
  assert.match(said[2], /heading down/);
  assert.match(said[4], /a job someone just pulled/);
  assert.match(said[6], /about 2% within 3 day/);
  assert.match(said[7], /about 12% in Back Room \(BRC\), held through Kestrel Holdings/);
  for (const why of ['report', 'campaign', 'story']) assert.doesNotMatch(StoryService._rumourText({ ...move, why }, 2), /NCI\./);
});

test('a big event: the GM can run it as a scene, the player is told, and every hook reads as words', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const { sceneHook } = await import('../scripts/services/BusinessService.js');
  try {
    const raid = { kind: 'raid', factionId: 'corp_bio', factionName: 'Biotechnica' };
    await S.BusinessRepository.save({ ...b, status: 'open', period: { ...b.period, slots: [], event: raid } });
    const asked = await renderConsole('businesses');
    assertClean(asked, 'a big event on the Businesses tab');
    assert.match(asked, /data-action="businessSceneRun"/);
    assert.match(text(await renderConsole('pending')), /A tipped-off raid: run it as a scene, or leave it as a roll/);
    const week = await renderBusiness(windowFor(med, 'week'));
    assertClean(week, 'the player sees a maybe');
    assert.match(text(week), /Your GM may choose to play this one out/);

    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], scene: { event: raid, day: b.period.startDay }, period: { ...b.period, slots: [], event: null } });
    const open = await renderConsole('businesses');
    assertClean(open, 'a scene on the Businesses tab');
    for (const action of ['businessSceneWon', 'businessSceneLost', 'businessSceneRoll']) assert.match(open, new RegExp(`data-action="${action}"`));
    assert.doesNotMatch(open, /businessSceneRun/);
    assert.match(text(await renderConsole('pending')), /A tipped-off raid: say how the scene went/);
    const playing = await renderBusiness(windowFor(med, 'week'));
    assertClean(playing, 'the player sees the scene');
    assert.match(text(playing), /your GM is playing this one out/);

    const hookOf = (kind) => sceneHook({ name: 'Back Room', location: 'upstairs', staff: [{ id: 's', name: 'Nix' }] }, { kind, factionName: 'Maelstrom', staffId: 's' });
    for (const kind of ['sabotage', 'smear', 'raid', 'poaching', 'shakedown', 'collectors', 'grudge']) assert.doesNotMatch(hookOf(kind), /NCI\.|\{\w+\}/, kind);
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test('a back room: pending for the GM, then on the Back Room tab with its dirty cash, actions and band', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  try {
    const plain = { ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, campaign: null, proposals: [], period: { ...b.period, slots: [], event: null } };
    await S.BusinessRepository.save({ ...plain, backRoom: null });
    const projects = await renderBusiness(windowFor(med, 'projects'));
    assertClean(projects, 'projects tab');
    assert.match(text(projects), /Back room/);

    await S.BusinessRepository.save({ ...plain, backRoom: { kind: 'ripping', status: 'pending', dirty: 0, day: 1 } });
    const asked = await renderConsole('businesses');
    assertClean(asked, 'pending back room for the GM');
    assert.match(asked, /data-action="businessRoomApprove"/);
    assert.match(text(await renderConsole('pending')), /A back room, Black-market chrome: let it open or turn it down/);
    const waiting = await renderBusiness(windowFor(med, 'backRoom'));
    assertClean(waiting, 'waiting for the GM');
    assert.match(text(waiting), /waiting for the GM before it opens/);
    assert.doesNotMatch(text(waiting), /Work the back room/);

    assert.equal((await S.BusinessService.approveBackRoom(b.id)).ok, true);
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], backRoom: { ...S.BusinessRepository.all()[0].backRoom, dirty: 1200, band: 'low' } });
    const open = await renderBusiness(windowFor(med, 'backRoom'));
    assertClean(open, 'an open back room');
    for (const words of [/Dirty cash 1,200 eb/, /Exposure low/i, /Work the back room/, /Launder/, /Pay someone off/, /Costs 150 eb of dirty cash/]) assert.match(text(open), words);
    assert.match(open, /data-action="takeDirty"/);
    // The button reads the amount from its own row: the card is not a form block.
    assert.match(open, /<div class="nci-actions">\s*<input type="number" name="dirtyAmount"[^>]*><button type="button" data-action="takeDirty"/);
    const taking = windowFor(med, 'week');
    const sent = [];
    taking._send = (type, payload) => sent.push([type, payload]);
    Apps.Business.DEFAULT_OPTIONS.actions.takeDirty.call(taking, null, { closest: (sel) => (sel === '.nci-actions' ? { querySelector: () => ({ value: '29' }) } : null) });
    assert.deepEqual(sent, [['takeDirty', { amount: 29 }]]);
    assert.match(open, /data-action="lieLow"/);
    const gm = await renderConsole('businesses');
    assertClean(gm, 'an open back room for the GM');
    assert.match(text(gm), /Back room: Black-market chrome, 1,200 eb of dirty cash/);
    const dialog = new Apps.Roll({ actorId: med.id, businessId: b.id, request: { type: 'action', businessId: b.id, action: 'roomWork' }, rollTitle: 'Work' });
    const roll = render('templates/dialogs/roll.hbs', await dialog._prepareContext());
    assertClean(roll, 'the roll dialog');
    assert.match(text(roll), /Cybertech/);
    assert.match(text(roll), /A good week\S+s dirty cash/);
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test('a raid and a shut back room read as words, and the hand\'s post is offered only with a room', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const { sceneHook } = await import('../scripts/services/BusinessService.js');
  try {
    const plain = { ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, campaign: null, scene: null, proposals: [] };
    await S.BusinessRepository.save({ ...plain, backRoom: { kind: 'ripping', status: 'open', dirty: 100, band: 'moderate' }, period: { ...b.period, slots: [], event: { kind: 'bust' } } });
    const raided = await renderBusiness(windowFor(med, 'week'));
    assertClean(raided, 'a raid on the Work tab');
    assert.match(text(raided), /A raid on the back room/);
    assert.match(text(raided), /Unanswered, they seize all the dirty cash/);
    assert.match(text(raided), /Your GM may choose to play this one out/);
    assert.match(text(await renderBusiness(windowFor(med, 'backRoom'))), /A raid on the back room/, 'and where the room is worked');
    assert.match(await renderBusiness(windowFor(med, 'staff')), /Back-room hand/);
    assert.doesNotMatch(sceneHook({ name: 'Back Room', location: 'upstairs', backRoom: { kind: 'ripping' } }, { kind: 'bust' }), /NCI\.|\{\w+\}/);
    assert.match(text(await renderConsole('businesses')), /A raid on the back room/);

    await S.BusinessRepository.save({ ...plain, backRoom: { kind: 'ripping', status: 'shut', dirty: 0 }, period: { ...b.period, slots: [], event: null } });
    const shut = await renderBusiness(windowFor(med, 'backRoom'));
    assertClean(shut, 'a shut back room');
    assert.match(text(shut), /Shut by a raid/);
    assert.doesNotMatch(shut, /data-action="takeDirty"/);
    assert.doesNotMatch(text(shut), /Work the back room/);
    assert.doesNotMatch(await renderBusiness(windowFor(med, 'staff')), /Back-room hand/);
    assertClean(await renderConsole('businesses'), 'a shut back room for the GM');
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test('a gang\'s offer and deal on the Back Room tab, and a company\'s crime on its own, read as words', async () => {
  const { FactionRepository } = await import('../scripts/data/FactionRepository.js');
  await FactionRepository.importStarter();
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  try {
    const plain = { ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, campaign: null, scene: null, proposals: [], district: 'ocz', standings: {}, period: { ...b.period, slots: [], event: null } };
    await S.BusinessRepository.save({ ...plain, backRoom: { kind: 'ripping', status: 'open', dirty: 500, band: 'low', offer: { factionId: 'gang_maelstrom', name: 'Maelstrom', cash: 2000, cut: 0.25, day: 1 } } });
    const offered = await renderBusiness(windowFor(med, 'backRoom'));
    assertClean(offered, 'a gang\'s offer');
    assert.match(text(offered), /Maelstrom offers 2,000 eb for 25%/);
    assert.match(offered, /data-action="gangDeal"/);
    assert.match(text(offered), /Deal with a gang/);
    assert.match(offered, /name="aimFaction"[\s\S]*Maelstrom/);

    await S.BusinessRepository.save({ ...plain, backRoom: { kind: 'ripping', status: 'open', dirty: 500, band: 'low', deal: { factionId: 'gang_maelstrom', name: 'Maelstrom', cash: 2000, cut: 0.25, since: 1 } } });
    const dealt = await renderBusiness(windowFor(med, 'backRoom'));
    assertClean(dealt, 'a deal');
    assert.match(text(dealt), /Maelstrom has a deal: 25% of the takings/);
    assert.match(dealt, /data-action="endGangDeal"/);
    assert.doesNotMatch(text(dealt), /Deal with a gang/, 'one is enough');
    assertClean(await renderConsole('businesses'), 'a deal for the GM');
    assert.match(text(await renderConsole('businesses')), /A deal with Maelstrom: 25%/);
    const roll = new Apps.Roll({ actorId: med.id, businessId: b.id, request: { type: 'action', businessId: b.id, action: 'payOff' }, rollTitle: 'Pay' });
    assertClean(render('templates/dialogs/roll.hbs', await roll._prepareContext()), 'a room roll with a deal');

    await S.BusinessRepository.save({ ...plain, stage: 2, company: { ticker: 'BRC', sector: 'health', charteredDay: b.period.startDay }, officers: [med.id], backRoom: null, till: 20000 });
    const { CompanyRepository } = await import('../scripts/data/CompanyRepository.js');
    const listAll = CompanyRepository.all;
    CompanyRepository.all = () => [{ id: 'ARA', ticker: 'ARA', name: 'Arasaka' }];
    const company = await renderBusiness(windowFor(med, 'backRoom'));
    CompanyRepository.all = listAll;
    assertClean(company, 'a company\'s crime');
    for (const name of [/Dump the waste/, /Bribe a regulator/, /Black ops/, /Costs 1,000 eb from the cash/, /A campaign costs 2,500 eb/]) assert.match(text(company), name);
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], campaign: { status: 'awaiting', ticker: 'ARA', name: 'Arasaka', kind: 'blackOps', percent: -3, actorId: med.id, day: 1 } });
    assert.match(text(await renderConsole('businesses')), /A black op against Arasaka \(ARA\)/);
    for (const action of ['dumping', 'bribeRegulator']) {
      const dialog = new Apps.Roll({ actorId: med.id, businessId: b.id, request: { type: 'action', businessId: b.id, action }, rollTitle: action });
      assertClean(render('templates/dialogs/roll.hbs', await dialog._prepareContext()), action);
    }
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test('a back room at a company is hidden from a shareholder who is not an officer, and the books still add up', async () => {
  const { CompanyRepository } = await import('../scripts/data/CompanyRepository.js');
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const listAll = CompanyRepository.all;
  CompanyRepository.all = () => [{ id: 'ARA', ticker: 'ARA', name: 'Arasaka' }];
  try {
    const day = b.period.startDay;
    await S.BusinessRepository.save({
      ...b, status: 'open', stage: 2, company: { ticker: 'BRC', sector: 'health', charteredDay: day }, officers: [med.id], listing: null, charter: null, takeover: null, administration: null, regCase: null, campaign: null, scene: null, proposals: [],
      backRoom: { kind: 'ripping', status: 'open', dirty: 900, band: 'low', offer: { factionId: 'gang_maelstrom', name: 'Maelstrom', cash: 2000, cut: 0.25, day } },
      ledger: [...b.ledger, { day, kind: 'laundered', amount: 300 }, { day, kind: 'raidFine', amount: -500 }, { day, kind: 'dirtyTaken', amount: 0, actorId: med.id }],
      staff: [{ id: 'stf_rex', actorId: null, name: 'Quiet Rex', source: 'recruit', post: 'fixer', bases: { 'skill:Bribery': 12 }, pct: 1, wage: 100, hiredDay: day, status: 'active', loyalty: 50 }],
      candidates: [{ id: 'c_lau', name: 'Soft Sal', post: 'launderer', base: 10, pct: 1, level: 'skilled', expires: day + 7 }],
      digests: [...b.digests, { index: 99, startDay: day - 7, endDay: day, takings: 500, upkeep: 100, till: 5000, profit: 400, opening: 4600, actions: [{ action: 'roomWork', by: med.id, band: 'solid' }, { action: 'contracts', by: med.id, band: 'solid' }], event: { kind: 'bust', outcome: 'failed', band: null, change: -50 }, bands: b.digests.at(-1)?.bands ?? {} }],
      period: { ...b.period, slots: [], event: { kind: 'bust' } },
    });
    const secret = /Back room:|the back room|Black-market|dirty cash|Launder|Dump the waste|Bribe a regulator|Black ops|A raid on/i;
    const other = await renderBusiness(windowFor(fix, 'week'));
    assertClean(other, 'a shareholder\'s Work tab');
    assert.doesNotMatch(text(other), secret);
    assert.doesNotMatch(other, /data-tab="backRoom"/, 'a shareholder has no Back Room tab');
    const sneaking = windowFor(fix, 'backRoom');
    assert.doesNotMatch(text(await renderBusiness(sneaking)), secret);
    assert.equal(sneaking.tab, 'week', 'nor can one be left open on it');
    const otherLedger = await renderBusiness(windowFor(fix, 'ledger')) + await renderBusiness(windowFor(fix, 'reports'));
    assertClean(otherLedger, 'a shareholder\'s ledger');
    assert.doesNotMatch(text(otherLedger), /Laundered|fine from a raid|took some of the dirty|Work the back room|A raid on/);
    assert.match(text(otherLedger), /Other income/);
    assert.match(text(otherLedger), /Other costs/);
    assert.match(text(otherLedger), /An inspection|inspection/i);
    const { cashbookContext } = await import('../scripts/ui/Business/context.js');
    const book = JSON.stringify(cashbookContext(S.BusinessRepository.all()[0], 99, false));
    assert.doesNotMatch(book, /Laundered|from a raid|took some of the dirty|A raid on/, 'nor the cash book');
    assert.match(JSON.stringify(cashbookContext(S.BusinessRepository.all()[0], 99, true)), /A raid on the back room/);
    assert.doesNotMatch(text(await renderBusiness(windowFor(fix, 'projects'))), /Back room<|A back room, behind/);

    const otherStaff = await renderBusiness(windowFor(fix, 'staff'));
    assertClean(otherStaff, 'a shareholder\'s Staff tab');
    assert.match(text(otherStaff), /Quiet Rex/);
    assert.match(text(otherStaff), /General staff/, 'on the payroll, under a plain name');
    // A character here is called Fixer, in the picker, so the post is looked for where a post would show.
    assert.doesNotMatch(text(otherStaff), /Launderer|Back-room hand|Bribery|Soft Sal/);
    assert.doesNotMatch(otherStaff, /data-post="(fixer|launderer|hand)"/);
    assert.doesNotMatch(text(otherStaff), /Quiet Rex[\s\S]{0,120}Fixer/);
    assert.doesNotMatch(otherStaff, /data-action="openEmployee" data-id="stf_rex"/);
    assert.doesNotMatch(await renderBusiness(windowFor(fix, 'overview')), /nci-exposure/, 'nor their Exposure');
    assert.match(await renderBusiness(windowFor(med, 'overview')), /nci-exposure-low/, 'an officer sees it in the standings');
    const officerStaff = await renderBusiness(windowFor(med, 'staff'));
    assertClean(officerStaff, 'an officer\'s Staff tab');
    assert.match(text(officerStaff), /Quiet Rex[\s\S]{0,120}Fixer/);
    assert.match(text(officerStaff), /Soft Sal/);
    assert.match(officerStaff, /data-post="launderer"/);

    const officer = await renderBusiness(windowFor(med, 'backRoom'));
    assertClean(officer, 'an officer\'s Back Room tab');
    for (const words of [/Back room: Black-market chrome/, /A raid on the back room/, /Dump the waste/, /Work the back room/, /Maelstrom offers 2,000 eb/]) assert.match(text(officer), words);
    assert.match(officer, /data-action="takeDirty"/);
    const officerLedger = await renderBusiness(windowFor(med, 'ledger')) + await renderBusiness(windowFor(med, 'reports'));
    assert.match(text(officerLedger), /Laundered through the takings/);
    assert.doesNotMatch(await renderBusiness(windowFor(med, 'projects')), /<strong>Back room<\/strong>/, 'a company cannot build one');

    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], backRoom: { kind: 'ripping', status: 'shut', dirty: 0 }, period: { ...b.period, slots: [], event: null } });
    assert.match(text(await renderBusiness(windowFor(med, 'backRoom'))), /Shut by a raid, for good/);
  } finally {
    CompanyRepository.all = listAll;
    await S.BusinessRepository.save(saved);
  }
});

test('the Business window has four folders, each with its tabs, and each tab holds its own', async () => {
  const { CompanyRepository } = await import('../scripts/data/CompanyRepository.js');
  const listAll = CompanyRepository.all;
  CompanyRepository.all = () => [{ id: 'ARA', ticker: 'ARA', name: 'Arasaka' }];
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  try {
    await S.BusinessRepository.save({ ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, backRoom: { kind: 'ripping', status: 'open', dirty: 100, band: 'low' } });
    const tabsOn = (html) => [...html.matchAll(/data-tab="(\w+)"/g)].map((m) => m[1]);
    const foldersOn = (html) => [...html.matchAll(/data-group="(\w+)"/g)].map((m) => m[1]);
    const overview = await renderBusiness(windowFor(med, 'overview'));
    assert.deepEqual(foldersOn(overview), ['pending', 'overview', 'financial', 'operations', 'ownership']);
    assert.deepEqual(tabsOn(overview), [], 'Overview has no tabs under it');
    assert.match(overview, /<div class="nci-bizname">Back Room<\/div>/, 'the name stands out');
    const pages = {};
    for (const tab of ['ledger', 'reports', 'week', 'staff', 'projects', 'backRoom', 'partners', 'growth']) {
      pages[tab] = await renderBusiness(windowFor(med, tab));
      assertClean(pages[tab], tab);
    }
    assert.deepEqual(tabsOn(pages.reports), ['ledger', 'reports']);
    assert.deepEqual(tabsOn(pages.staff), ['week', 'production', 'staff', 'projects', 'backRoom']);
    assert.deepEqual(tabsOn(pages.growth), ['partners', 'growth']);
    assert.match(text(pages.ledger), /You may draw up to|Draw/);
    assert.match(pages.ledger, /nci-block[^>]*>\s*<h3>Loans/);
    assert.doesNotMatch(text(pages.ledger), /Weekly|Week \d/, 'digests are on Reports');
    assert.doesNotMatch(text(pages.reports), /Loans/, 'loans are on the Ledger');
    assert.match(pages.backRoom, /data-id="roomWork"/);
    assert.match(pages.backRoom, /data-id="campaign"/);
    assert.doesNotMatch(pages.week, /data-action="takeDirty"|id="roomWork"|data-id="campaign"/, 'Work is the honest work');
    assert.match(pages.week, /data-id="work"/);

    // A folder opens on the tab last open in it.
    const app = windowFor(med, 'overview');
    app.render = () => {};
    const { switchTab } = Apps.Business.DEFAULT_OPTIONS.actions;
    switchTab.call(app, null, { dataset: { group: 'operations' } });
    assert.equal(app.tab, 'week');
    switchTab.call(app, null, { dataset: { tab: 'projects' } });
    switchTab.call(app, null, { dataset: { group: 'financial' } });
    assert.equal(app.tab, 'ledger');
    switchTab.call(app, null, { dataset: { group: 'operations' } });
    assert.equal(app.tab, 'projects');

    // Exposure as a bar: top of the Back Room tab, and in the Overview's standings, in bands with no number.
    const bar = /<div class="nci-standing nci-capacity nci-exposure">([\s\S]*?)<\/div>/;
    const fill = (html) => html.match(bar)?.[1] ?? '';
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], backRoom: { kind: 'ripping', status: 'open', dirty: 100, band: 'moderate' } });
    const room = await renderBusiness(windowFor(med, 'backRoom'));
    assert.match(fill(room), /nci-exposure-moderate" style="width: 65%"/);
    assert.match(text(fill(room)), /^\s*Exposure\s+moderate\s*$/, 'the band, and no figure');
    assert.ok(room.indexOf('nci-exposure') > room.indexOf('operating week'), 'below the note on the week');
    assert.ok(room.indexOf('nci-exposure') < room.indexOf('Dirty cash'), 'above the panel');
    assert.equal((room.match(/Exposure<\/span>/g) ?? []).length, 1, 'shown once');
    const standings = await renderBusiness(windowFor(med, 'overview'));
    assert.ok(standings.indexOf('nci-exposure') > standings.indexOf('nci-standings'), 'in the standings');
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], backRoom: { kind: 'ripping', status: 'open', dirty: 100 } });
    assert.match(fill(await renderBusiness(windowFor(med, 'backRoom'))), /nci-exposure-clean/, 'clean until a close says otherwise');
    for (const shut of [{ kind: 'ripping', status: 'shut', dirty: 0, band: 'high' }, { kind: 'ripping', status: 'pending', dirty: 0 }, null]) {
      await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], backRoom: shut });
      assert.doesNotMatch(await renderBusiness(windowFor(med, 'overview')), /nci-exposure/, 'only for a room running');
      assert.doesNotMatch(await renderBusiness(windowFor(med, 'backRoom')), /nci-exposure/);
    }
  } finally {
    CompanyRepository.all = listAll;
    await S.BusinessRepository.save(saved);
  }
});

test('the Pending tab lists what waits for a character, across their businesses, and acts as the right account', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const submit = S.BusinessClient.submit;
  const sent = [];
  S.BusinessClient.submit = async (account, type, payload) => {
    sent.push({ account: account.id, type, ...payload });
    return 'key';
  };
  try {
    await S.BusinessRepository.save({ ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, backRoom: null,
      proposals: [{ id: 'pr1', kind: 'close', by: fix.id, day: b.period.startDay, expires: b.period.startDay + 7, votes: { [fix.id]: true } }] });
    const app = windowFor(med, 'pending');
    app.render = () => {};
    const html = await renderBusiness(app);
    assertClean(html, 'the player\'s Pending tab');
    assert.match(html, /data-group="pending"[^>]*>Pending <span class="nci-count">\d+<\/span>/, 'a count on the folder');
    assert.match(text(html), /Back Room/);
    assert.match(text(html), /proposes/);
    assert.doesNotMatch(html, /nci-bizname/, 'the list, not one business');
    const actions = Apps.Business.DEFAULT_OPTIONS.actions;
    for (const [, action] of html.matchAll(/data-do="([^"]+)"/g)) assert.ok(action in actions, `no handler for ${action}`);
    assert.match(html, /data-do="vote" data-account="[^"]+" data-business="[^"]+" data-id="pr1" data-yes="true"/);

    // Whichever account and business are picked, the row's are used, and the picks are put back after.
    app.businessId = 'another';
    await actions.pendingAct.call(app, null, { dataset: { do: 'vote', account: med.id, business: b.id, id: 'pr1', yes: 'true' } });
    assert.deepEqual(sent.at(-1), { account: med.id, type: 'vote', businessId: b.id, proposalId: 'pr1', yes: true });
    assert.equal(app.businessId, 'another');

    // A click on the row opens it; a click among its fields does not.
    const rowClick = (inFields) => actions.pendingOpen.call(app, { target: { closest: () => inFields } }, { dataset: { account: med.id, business: b.id, tab: 'partners' } });
    await rowClick(true);
    assert.equal(app.tab, 'pending');
    await rowClick(null);
    assert.deepEqual([app.tab, app.businessId], ['partners', b.id]);

    // Someone who has voted has nothing left to do here.
    await S.BusinessRepository.save({ ...S.BusinessRepository.all()[0], proposals: [{ id: 'pr1', kind: 'close', by: fix.id, day: b.period.startDay, expires: b.period.startDay + 7, votes: { [fix.id]: true, [med.id]: true } }] });
    const voted = await renderBusiness(windowFor(med, 'pending'));
    assert.doesNotMatch(voted, /data-id="pr1"/);
  } finally {
    S.BusinessClient.submit = submit;
    await S.BusinessRepository.save(saved);
  }
});

test('with no business, the window has only the Pending and Overview folders', async () => {
  const businesses = S.BusinessRepository.all;
  S.BusinessRepository.all = () => [];
  try {
    const app = windowFor(med, 'pending');
    const html = await renderBusiness(app);
    assertClean(html, 'nothing to show but the list');
    assert.deepEqual([...html.matchAll(/data-group="(\w+)"/g)].map((m) => m[1]), ['pending', 'overview']);
    assert.doesNotMatch(html, /data-action="found"/, 'the start form is on Overview');
    assert.match(await renderBusiness(windowFor(med, 'overview')), /data-action="found"/);
  } finally {
    S.BusinessRepository.all = businesses;
  }
});

test('REP and IP (B7c): a milestone suggests them to the GM, for those running it; nothing reaches a sheet until applied', async () => {
  const { rewardChange, rewardMatters, rewardRunners, REWARDS } = await import('../scripts/engine/businessRewards.js');
  // The rulebook's rule: REP only if higher, a bad deed included; IP on top.
  assert.deepEqual(rewardChange({ rep: 4, ip: 20 }, { rep: 2, ip: 5 }), { rep: 4, ip: 25, gained: 20 });
  assert.equal(rewardChange({ rep: 4 }, { rep: 4 }).rep, null, 'not higher');
  assert.equal(rewardChange({ rep: 4 }, { rep: 9 }).rep, null, 'and never lower');
  assert.equal(rewardChange({ rep: 99 }, { rep: 0 }).rep, 10, 'the scale stops at 10');
  assert.equal(rewardMatters('caseLost', 4), false, 'a bad deed that changes nothing is not raised');
  assert.equal(rewardMatters('caseLost', 3), true);
  assert.equal(rewardMatters('sceneWon', 9), true, 'IP still counts');

  const { MarketStore } = await import('../scripts/data/MarketStore.js');
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const hiddenBefore = structuredClone(MarketStore.getBusinessesHidden());
  const sheets = { med: structuredClone(med.system), fix: structuredClone(fix.system) };
  const rewards = () => MarketStore.getBusinessesHidden()[b.id]?.rewards ?? [];
  const rowsFor = (actor) => rewards().filter((r) => r.actorId === actor.id);
  try {
    const open = { ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, proposals: [] };
    await S.BusinessRepository.save(open);
    // Those running it: active voting partners below a company, officers at one.
    assert.ok(rewardRunners(open).includes(med.id) && rewardRunners(open).includes(fix.id));
    const company = { ...open, stage: 2, company: { ticker: 'BRC', sector: 'health', charteredDay: 1 }, officers: [med.id] };
    assert.deepEqual(rewardRunners(company), [med.id], 'not a shareholder with no office');

    // Events at a commit bring them: registering, a charter, a lost raid, a scene.
    await S.BusinessService._rewardEvents({ business: open, events: [{ type: 'steppedUp', stage: 1 }] });
    assert.deepEqual(rowsFor(med).map((r) => [r.kind, r.rep, r.ip]), [['registered', REWARDS.registered.rep, REWARDS.registered.ip]]);
    assert.equal(rowsFor(fix).length, 1, 'each their own row');
    await S.BusinessService._rewardEvents({ business: open, events: [{ type: 'steppedUp', stage: 2 }, { type: 'roll' }] });
    assert.equal(rowsFor(med).length, 1, 'only registering counts as that');
    assert.equal(med.system.reputation?.value ?? 0, sheets.med.reputation?.value ?? 0, 'nothing on the sheet yet');

    // On the GM's Pending tab and the business's entry, with its numbers to change.
    const pending = await renderConsole('pending');
    assertClean(pending, 'pending with a suggestion');
    assert.match(text(pending), /was registered: apply, change or dismiss/);
    assert.match(pending, /data-action="businessRewardApply" data-id="[^"]+"[^>]*data-reward="/);
    assert.match(pending, /name="rewardRep" value="3"/);
    assert.match(pending, /name="rewardIp" value="10"/);
    const entry = await renderConsole('businesses');
    assertClean(entry, 'an entry with a suggestion');
    assert.match(text(entry), /REP and IP suggested/);
    assert.match(entry, /data-action="businessRewardDismiss"/);

    // Applied as the GM set it, with the sheet's own log saying what for.
    const actions = Apps.GMConsole.DEFAULT_OPTIONS.actions;
    const row = (values) => ({ querySelector: (sel) => { const name = sel.match(/name="(\w+)"/)[1]; return name in values ? { value: values[name] } : null; } });
    const click = (action, reward, values = {}) => actions[action].call(new Apps.GMConsole(), null, { dataset: { id: b.id, reward: reward.id }, closest: () => row(values) });
    const repBefore = med.system.reputation?.value ?? 0;
    const ipBefore = med.system.improvementPoints?.value ?? 0;
    await click('businessRewardApply', rowsFor(med)[0], { rewardRep: String(repBefore + 2), rewardIp: '15' });
    assert.equal(med.system.reputation.value, repBefore + 2);
    assert.equal(med.system.improvementPoints.value, ipBefore + 15);
    assert.match(med.system.reputation.transactions.at(-1)[1], /was registered/);
    assert.equal(rowsFor(med).length, 0, 'done with');

    // Dismissed: nothing happens to the sheet.
    const fixRep = fix.system.reputation?.value ?? 0;
    await click('businessRewardDismiss', rowsFor(fix)[0]);
    assert.equal(rowsFor(fix).length, 0);
    assert.equal(fix.system.reputation?.value ?? 0, fixRep);

    // A bad deed below their REP is not raised; above it, it applies, and never lowers.
    await S.BusinessService._suggestReward(open, 'raidLost', [med.id]);
    const high = med.system.reputation.value;
    if (high >= REWARDS.raidLost.rep) assert.equal(rowsFor(med).length, 0);
    await S.BusinessService.dismissReward(b.id, rowsFor(med)[0]?.id);
    await S.BusinessService._suggestReward(open, 'sceneWon', [med.id]);
    const scene = rowsFor(med).at(-1);
    assert.deepEqual([scene.kind, scene.rep, scene.ip], ['sceneWon', 0, REWARDS.sceneWon.ip]);
    assert.doesNotMatch(await renderConsole('pending'), /name="rewardRep" value="0"/, 'no REP to set for a scene');
    await click('businessRewardApply', scene, { rewardIp: '20' });
    assert.equal(med.system.reputation.value, high, 'REP unmoved');

    // A wound-up business is closed, but what it suggested still waits on Pending.
    await S.BusinessRepository.save({ ...open, status: 'closed' });
    await S.BusinessService._suggestReward(open, 'woundUp', [fix.id]);
    assert.match(text(await renderConsole('pending')), /was wound up/);
    assert.equal((await S.BusinessService.applyReward(b.id, 'nothing', {})).reason, 'no-reward');
  } finally {
    await MarketStore.setBusinessesHidden(hiddenBefore);
    await S.BusinessRepository.save(saved);
    await med.update({ 'system.reputation': sheets.med.reputation ?? { value: 0, transactions: [] }, 'system.improvementPoints': sheets.med.improvementPoints ?? { value: 0, transactions: [] } });
  }
});

test('living costs (B7d): offered on the Partners tab with what the sheet shows, and paid straight to the sheet with staff mail off', async () => {
  const { MODULE_ID, SETTINGS } = await import('../scripts/utils/constants.js');
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const lifestyle = med.system.lifestyle;
  const mail = game.settings.get(MODULE_ID, SETTINGS.STAFF_MAIL);
  try {
    await S.BusinessRepository.save({ ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, proposals: [], covered: [] });
    assert.doesNotMatch(await renderBusiness(windowFor(med, 'partners')), new RegExp(`data-action="proposeCover" data-id="${med.id}"`), 'nothing on the sheet to pay');
    med.system.lifestyle = { housing: { cost: 1000 }, lifeStyle: { cost: 100 }, extras: { cost: 500 } };
    assert.equal(S.BusinessService.livingCostOf(med.id), 1100, 'Housing and Lifestyle, not the extras');
    const asked = await renderBusiness(windowFor(med, 'partners'));
    assertClean(asked, 'partners with living costs');
    assert.match(asked, new RegExp(`data-action="proposeCover" data-id="${med.id}"`));

    const covered = { ...S.BusinessRepository.all()[0], covered: [med.id] };
    await S.BusinessRepository.save(covered);
    const row = await renderBusiness(windowFor(med, 'partners'));
    assertClean(row, 'a partner covered');
    assert.match(text(row), /The business pays their Housing and Lifestyle: 1,100 eb a month/);
    assert.match(row, new RegExp(`data-action="proposeStopCover" data-id="${med.id}"`));

    await game.settings.set(MODULE_ID, SETTINGS.STAFF_MAIL, false);
    const wealth = med.system.wealth.value;
    await S.BusinessService._livingCosts({ business: covered, events: [{ type: 'livingCosts', actorId: med.id, amount: 1100 }] });
    assert.equal(med.system.wealth.value, wealth + 1100);
    med.system.wealth.value = wealth;
  } finally {
    med.system.lifestyle = lifestyle;
    await game.settings.set(MODULE_ID, SETTINGS.STAFF_MAIL, mail);
    await S.BusinessRepository.save(saved);
  }
});

test('the directory (B7e) tells a map what the street can see, and nothing behind it', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  try {
    await S.BusinessRepository.save({ ...b, district: 'watson', location: 'Above the noodle bar', backRoom: { kind: 'ripping', status: 'open', dirty: 900, band: 'high' } });
    const row = S.BusinessService.directory().find((x) => x.id === b.id);
    assert.deepEqual(Object.keys(row).sort(), ['district', 'id', 'kind', 'location', 'name', 'stage', 'status', 'ticker']);
    assert.equal(row.district, 'watson');
    assert.doesNotMatch(JSON.stringify(row), /ripping|dirty|Black-market|till/);
    assert.doesNotMatch(row.kind + row.stage, /NCI\./);
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test('production (P1a): a Production tab for those running the shop, a line to set, and a storeroom sheet of real items', async () => {
  const { ProductionCatalog } = await import('../scripts/data/ProductionCatalog.js');
  const { MODULE_ID, SETTINGS } = await import('../scripts/utils/constants.js');
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const savedCatalog = game.settings.get(MODULE_ID, SETTINGS.PRODUCTION_CATALOG);
  const source = { documentName: 'Item', uuid: 'Item.scanner', name: 'Medscanner', type: 'gear', img: '', system: { price: { market: 100 }, amount: 1 }, toObject() { return { name: this.name, type: this.type, system: { ...this.system } }; } };
  const fromUuidBefore = globalThis.fromUuid;
  const actorBefore = globalThis.Actor;
  const made = [];
  const room = { ownership: {}, getFlag: (scope, key) => (key === 'stockFor' ? b.id : undefined), createEmbeddedDocuments: async (_, docs) => made.push(...docs) };
  let created = null;
  try {
    await S.BusinessRepository.save({ ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, proposals: [], upgrades: { workshop: [] }, production: { line: null, run: null }, stock: [] });
    const none = await renderBusiness(windowFor(med, 'production'));
    assertClean(none, 'production with no workshop');
    assert.match(text(none), /No workshop yet/);

    globalThis.fromUuid = async (uuid) => (uuid === source.uuid ? source : null);
    assert.ok((await ProductionCatalog.add('clinic', source.uuid)).ok);
    const built = { ...S.BusinessRepository.all()[0], upgrades: { workshop: [0] } };
    await S.BusinessRepository.save(built);
    const open = await renderBusiness(windowFor(med, 'production'));
    assertClean(open, 'production with a workshop');
    assert.match(open, /data-action="setLine"/);
    assert.match(text(open), /Medscanner: Premium, DV 17, 1 bench day\(s\) each, materials 50 eb/);

    await send(med, 'setLine', { businessId: b.id, uuid: source.uuid, qty: 4 });
    assert.equal(S.BusinessRepository.all()[0].production.line.name, 'Medscanner');
    assert.equal(S.BusinessRepository.all()[0].production.line.price, 100, 'the price on the list');
    await send(med, 'setLine', { businessId: b.id, uuid: 'Item.nothing' });
    assert.equal(S.BusinessRepository.all()[0].production.line.name, 'Medscanner', 'nothing off the list');
    const lined = await renderBusiness(windowFor(med, 'production'));
    assert.match(text(lined), /up to 4 a run/);
    assert.match(lined, /data-action="actionRoll" data-id="produce"/);
    assert.doesNotMatch(await renderBusiness(windowFor(med, 'week')), /data-id="produce"/, 'on its own tab, not on Work');

    globalThis.Actor = { create: async (data) => { created = data; game.actors.push(room); return room; } };
    game.folders ??= [];
    await S.BusinessService._syncStock({ business: S.BusinessRepository.all()[0], events: [{ type: 'stockMade', item: { uuid: source.uuid, type: 'gear' }, count: 3 }] });
    assert.equal(created.type, 'container');
    assert.equal(created.flags[MODULE_ID].stockFor, b.id);
    assert.equal(created.name, `Stock — ${b.name}`);
    assert.equal(made.length, 1, 'gear stacks');
    assert.equal(made[0].system.amount, 3);
    made.length = 0;
    await S.BusinessService._syncStock({ business: S.BusinessRepository.all()[0], events: [{ type: 'stockMade', item: { uuid: source.uuid, type: 'weapon' }, count: 2 }] });
    assert.equal(made.length, 2, 'what does not stack is an item each');
  } finally {
    globalThis.fromUuid = fromUuidBefore;
    globalThis.Actor = actorBefore;
    const i = game.actors.indexOf(room);
    if (i >= 0) game.actors.splice(i, 1);
    await game.settings.set(MODULE_ID, SETTINGS.PRODUCTION_CATALOG, savedCatalog);
    await S.BusinessRepository.save(saved);
  }
});

test('the Production tab for the GM: lists by business type, removes and restores, marks illegal', async () => {
  const { ProductionCatalog } = await import('../scripts/data/ProductionCatalog.js');
  const { MODULE_ID, SETTINGS } = await import('../scripts/utils/constants.js');
  const savedCatalog = game.settings.get(MODULE_ID, SETTINGS.PRODUCTION_CATALOG);
  const fromUuidBefore = globalThis.fromUuid;
  globalThis.fromUuid = async () => ({ documentName: 'Item', uuid: 'Item.a', name: 'Black Lace', type: 'drug', img: '', system: { price: { market: 50 } } });
  try {
    assert.ok((await ProductionCatalog.add('clinic', 'Item.a')).ok);
    const html = await renderConsole('production');
    assertClean(html, 'the production tab');
    assert.match(text(html), /Black Lace/);
    assert.match(text(html), /Costly/);
    const b = S.BusinessRepository.all()[0];
    const savedBusiness = structuredClone(b);
    await S.BusinessRepository.save({ ...b, production: { line: { uuid: 'Item.a', name: 'Black Lace', type: 'drug', price: 50, qty: 1 }, run: null } });
    assert.ok((await ProductionCatalog.setIllegal('Item.a', true)).ok);
    assert.equal(ProductionCatalog.find('clinic', 'Item.a').illegal, true);
    assert.equal(S.BusinessRepository.all()[0].production.line.illegal, true, 'a line already set follows it');
    await S.BusinessRepository.save(savedBusiness);
    assert.match(await renderConsole('production'), /Mark legal/);
    assert.ok((await ProductionCatalog.remove('clinic', 'Item.a')).ok);
    assert.equal(ProductionCatalog.find('clinic', 'Item.a'), null);
    globalThis.fromUuid = async () => ({ documentName: 'Item', uuid: 'Item.b', name: 'Free', type: 'gear', system: { price: { market: 0 } } });
    assert.equal((await ProductionCatalog.add('clinic', 'Item.b')).reason, 'no-price');
    assert.equal((await ProductionCatalog.add('nonsense', 'Item.b')).reason, 'bad-archetype');
  } finally {
    globalThis.fromUuid = fromUuidBefore;
    await game.settings.set(MODULE_ID, SETTINGS.PRODUCTION_CATALOG, savedCatalog);
  }
});

test('stock on the Production tab (P1b): buying, handing over, consigning and the GM\'s question', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const wealth = med.system.wealth.value;
  const given = [];
  const room = {
    id: 'room', ownership: {}, items: Object.assign([], { filter: Array.prototype.filter }),
    getFlag: (scope, key) => (key === 'stockFor' ? b.id : undefined),
    createEmbeddedDocuments: async (_, docs) => docs,
    deleteEmbeddedDocuments: async (_, ids) => ids.forEach((id) => { const i = room.items.findIndex((x) => x.id === id); if (i >= 0) room.items.splice(i, 1); }),
    delete: async () => { room.deleted = true; },
    update: async () => {},
  };
  const sheetItem = (id, stockUuid) => ({ id, name: 'Medscanner', type: 'weapon', system: {}, getFlag: (scope, key) => (key === 'stockUuid' ? stockUuid : null), toObject: () => ({ _id: id, name: 'Medscanner', type: 'weapon', system: {}, flags: {} }) });
  const createBefore = med.createEmbeddedDocuments;
  med.createEmbeddedDocuments = async (_, docs) => given.push(...docs);
  game.actors.push(room);
  try {
    room.items.push(sheetItem('i1', 'Item.scanner'), sheetItem('i2', 'Item.scanner'));
    const stock = [{ uuid: 'Item.scanner', name: 'Medscanner', type: 'weapon', img: '', price: 100, cost: 50, count: 2, illegal: false }];
    await S.BusinessRepository.save({ ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, proposals: [], upgrades: { workshop: [0] }, stock, assets: 100, till: 1000 });
    const html = await renderBusiness(windowFor(med, 'production'));
    assertClean(html, 'production with stock');
    assert.match(text(html), /The shop sells it at 70 eb/);
    assert.match(text(html), /Buy, 50 eb each/);
    assert.match(html, /data-action="handStock"/);
    assert.match(html, /data-gear="consign"/);

    await send(med, 'buyStock', { businessId: b.id, uuid: 'Item.scanner', count: 1 });
    const after = S.BusinessRepository.all()[0];
    assert.equal(after.stock[0].count, 1);
    assert.equal(after.till, 1050);
    assert.equal(med.system.wealth.value, wealth - 50);
    assert.equal(given.length, 1, 'on their sheet');
    assert.equal(given[0].flags['night-city-investments'], undefined, 'and no longer stock');
    assert.equal(room.items.length, 1, 'off the storeroom');

    room.items.length = 0;
    await S.BusinessService.reconcileStock(b.id);
    const queried = S.BusinessRepository.all()[0];
    assert.equal(queried.stockQueries.length, 1);
    assert.equal(queried.stock.length, 0);
    assert.match(text(await renderConsole('pending')), /1 × Medscanner left the storeroom by hand/);
    assert.ok((await S.BusinessService.settleStock(b.id, queried.stockQueries[0].id, 'sold')).ok);
    const settled = S.BusinessRepository.all()[0];
    assert.deepEqual(settled.stockQueries, []);
    assert.equal(settled.till, 1120);
    await S.BusinessRepository.save({
      ...S.BusinessRepository.all()[0],
      ledger: [
        ...S.BusinessRepository.all()[0].ledger,
        { day: 1, kind: 'materials', amount: -100, itemName: 'Medscanner', count: 2 },
        { day: 1, kind: 'stockSales', amount: 40, sold: 140 },
        { day: 1, kind: 'stockHanded', amount: 0, name: 'Fixer', itemName: 'Medscanner', count: 1 },
      ],
    });
    const ledger = text(await renderBusiness(windowFor(med, 'ledger')));
    assert.match(ledger, /1 × Medscanner sold by hand/);
    assert.match(ledger, /Medtech bought 1 × Medscanner from stock/);
    assert.match(ledger, /Materials for 2 × Medscanner/);
    assert.match(ledger, /Stock sold for 140 eb/);
    assert.match(ledger, /1 × Medscanner given to Fixer/);
    assert.doesNotMatch(ledger, /undefined|\{count\}|\{itemName\}/);
  } finally {
    med.createEmbeddedDocuments = createBefore;
    game.actors.splice(game.actors.indexOf(room), 1);
    med.system.wealth.value = wealth;
    await S.BusinessRepository.save(saved);
  }
});

test('the GM\'s business entry: Open under the location, the regulator\'s case below the partner row', async () => {
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  try {
    await S.BusinessRepository.save({ ...b, status: 'open', stage: 2, company: { ticker: 'TST' }, regCase: null });
    const html = await renderConsole('businesses');
    const at = (needle) => html.indexOf(needle);
    assert.ok(at('data-action="businessOpen"') > -1);
    assert.ok(at('nci-bizhead') < at('data-action="businessOpen"'));
    assert.ok(at('data-action="businessOpen"') < at('nci-gmstats') || at('nci-gmstats') < 0, 'at the top, before the figures');
    const leaves = at('data-action="businessPartnerLeaves"');
    const opens = at('data-action="businessCaseOpen"');
    if (leaves > -1 && opens > -1) assert.ok(leaves < opens, 'the case is below the row that lets a partner leave');
  } finally {
    await S.BusinessRepository.save(saved);
  }
});

test('the storeroom\'s access (P1b): the GM who made it stays its owner, and a player losing access is put right', async () => {
  const b = S.BusinessRepository.all()[0];
  const updates = [];
  const usersBefore = game.users;
  const gm = { id: 'gmUser', isGM: true };
  const player = { id: 'playerUser', isGM: false };
  const list = [gm, player];
  game.users = Object.assign(list, { get: (id) => list.find((u) => u.id === id), activeGM: usersBefore.activeGM });
  const room = { ownership: {}, getFlag: (scope, key) => (key === 'stockFor' ? b.id : undefined), update: async (data, options) => { updates.push({ data, options }); } };
  const ownershipBefore = S.BusinessService._storeroomOwnership;
  S.BusinessService._storeroomOwnership = () => ({ default: 0, playerUser: 2 });
  game.actors.push(room);
  try {
    room.ownership = { gmUser: 3, default: 0, playerUser: 2 };
    await S.BusinessService._syncStock({ business: b, events: [] });
    assert.equal(updates.length, 0, 'the creating GM is not a difference');

    room.ownership = { gmUser: 3, default: 0, playerUser: 0, goneUser: 2 };
    await S.BusinessService._syncStock({ business: b, events: [] });
    assert.equal(updates.length, 1);
    assert.deepEqual(updates[0].data.ownership, { gmUser: 3, default: 0, playerUser: 2 });
    assert.ok(Object.keys(updates[0].data.ownership).every((k) => !k.startsWith('-=')), 'Foundry takes only user ids here');
    assert.equal(updates[0].options.recursive, false, 'so a user who has gone is dropped');

    room.update = async () => { throw new Error('validation errors'); };
    const out = { business: b, wealth: {}, events: [], items: {}, taken: {}, traits: {} };
    await S.BusinessService._commit(out);
    assert.ok(true, 'and the rest of a commit still runs when the sheet cannot be updated');
  } finally {
    game.users = usersBefore;
    S.BusinessService._storeroomOwnership = ownershipBefore;
    game.actors.splice(game.actors.indexOf(room), 1);
  }
});

test('a week\'s cashbook adds up with stock sold: its margin is profit, its cost is other money, and nothing is left over', async () => {
  const { cashbookContext } = await import('../scripts/ui/Business/context.js');
  const b = structuredClone(S.BusinessRepository.all()[0]);
  const digest = (index, till, extra = {}) => ({ index, startDay: index * 7, endDay: index * 7 + 7, takings: 900, gross: 900, upkeep: 500, costs: { running: 500 }, wages: 300, paid: 300, profit: 100, till, actions: [], ...extra });
  b.digests = [digest(1, 1000), digest(2, 1000 + 100 + 18 + 40, { profit: 118, stock: { sold: 63, kept: 58, margin: 18, owners: 5 } })];
  b.ledger = [{ day: 21, kind: 'stockSales', amount: 18, sold: 63, week: 2 }, { day: 21, kind: 'stockCostBack', amount: 40, week: 2 }];
  const page = cashbookContext(b, 2);
  assert.equal(page.profit, '+118');
  assert.ok(page.income.some((x) => x.amount === '+18' && /over its cost/.test(x.label)));
  assert.ok(page.other.some((x) => x.amount === '+40'), 'what it cost comes back as other money');
  assert.ok(!page.unlisted, `nothing unaccounted for: ${page.unlisted}`);
});

test('illegal goods in the windows (P1c): tagged on the line list, fenced from the Back Room tab, secret at a company, refused on consignment', async () => {
  const { ProductionCatalog } = await import('../scripts/data/ProductionCatalog.js');
  const { MODULE_ID, SETTINGS } = await import('../scripts/utils/constants.js');
  const b = S.BusinessRepository.all()[0];
  const saved = structuredClone(b);
  const savedCatalog = game.settings.get(MODULE_ID, SETTINGS.PRODUCTION_CATALOG);
  const fromUuidBefore = globalThis.fromUuid;
  const lace = { documentName: 'Item', uuid: 'Item.lace', name: 'Black Lace', type: 'drug', img: '', system: { price: { market: 50 } } };
  globalThis.fromUuid = async () => lace;
  const open = { ...b, status: 'open', stage: 0, company: null, officers: [], listing: null, charter: null, takeover: null, administration: null, regCase: null, proposals: [], upgrades: { workshop: [0] }, production: { line: null, run: null, allowance: 0 }, stock: [] };
  try {
    await ProductionCatalog.add('clinic', lace.uuid);
    await ProductionCatalog.setIllegal(lace.uuid, true);
    await S.BusinessRepository.save({ ...open, backRoom: null });
    assert.doesNotMatch(text(await renderBusiness(windowFor(med, 'production'))), /Black Lace/, 'no room, not on the list');

    const stock = [{ uuid: 'Item.lace', name: 'Black Lace', type: 'drug', img: '', price: 50, cost: 20, count: 3, illegal: true }];
    await S.BusinessRepository.save({ ...open, backRoom: { kind: 'ripping', status: 'open', dirty: 0, day: 0 }, stock });
    const production = text(await renderBusiness(windowFor(med, 'production')));
    assert.match(production, /\[Illegal\] Black Lace: Costly/);
    assert.match(production, /Illegal: only a fence takes it, at 45 eb/);
    const room = await renderBusiness(windowFor(med, 'backRoom'));
    assertClean(room, 'the back room with stock to fence');
    assert.match(room, /data-action="actionRoll" data-id="fence"/);
    assert.match(text(room), /Pays 90% of market price, off the books/);
    assert.doesNotMatch(await renderBusiness(windowFor(med, 'week')), /data-id="fence"/);

    assert.ok(ProductionCatalog.isIllegal({ name: 'Black Lace', type: 'drug' }), 'by name and type');
    assert.ok(ProductionCatalog.isIllegal({ name: 'Other', type: 'drug', _stats: { compendiumSource: 'Item.lace' } }), 'or by where it came from');
    assert.ok(!ProductionCatalog.isIllegal({ name: 'Black Lace', type: 'gear' }));

    await S.BusinessRepository.save({ ...open, stage: 2, company: { ticker: 'TST' }, officers: [], backRoom: null, stock, production: { line: { uuid: 'Item.lace', name: 'Black Lace', type: 'drug', img: '', price: 50, illegal: true, qty: 1 }, run: null, allowance: 0 } });
    const outsider = await renderBusiness(windowFor(med, 'production'));
    assertClean(outsider, 'production for a holder who is no officer');
    assert.doesNotMatch(text(outsider), /Black Lace/, 'the officers\' secret');
    assert.doesNotMatch(outsider, /data-id="fence"/);
    assert.doesNotMatch(outsider, /Run the line/, 'nor that a run is being made');
    const company = S.BusinessRepository.all()[0];
    const week = { index: 9, startDay: 7, endDay: 14, takings: 100, gross: 100, upkeep: 50, costs: { running: 50 }, profit: 50, till: 1000 };
    await S.BusinessRepository.save({ ...company, digests: [{ ...week, actions: [{ action: 'produce', by: med.id, band: 'solid', illegal: true }] }] });
    assert.doesNotMatch(text(await renderBusiness(windowFor(med, 'reports'))), /Run the line/, 'or in the week\'s digest');
    const sheet = { getFlag: (scope, key) => (key === 'stockFor' ? b.id : undefined), testUserPermission: () => false };
    game.actors.push(sheet);
    const userBefore = game.user;
    game.user = { ...userBefore, isGM: false };
    const hidden = await renderBusiness(windowFor(med, 'production'));
    game.user = userBefore;
    game.actors.splice(game.actors.indexOf(sheet), 1);
    assert.doesNotMatch(hidden, /data-action="openStoreroom"/, 'and no button for a sheet they may not see');
  } finally {
    globalThis.fromUuid = fromUuidBefore;
    await game.settings.set(MODULE_ID, SETTINGS.PRODUCTION_CATALOG, savedCatalog);
    await S.BusinessRepository.save(saved);
  }
});
