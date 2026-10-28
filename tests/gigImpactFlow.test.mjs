import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { fillLine } from '../scripts/engine/index.js';
import { BROKER_VOICES } from '../scripts/data/broker-voices.js';

const env = installFakeFoundry({ actors: [['Alice', 90000, true], ['Bob', 90000, true], ['Fixer', 0, false]] });
const [alice, bob] = env.actors;

const contacts = [];
const sent = [];
globalThis.game.nightcity = {
  masterContactService: {
    filterByTag: (t) => contacts.filter((c) => c.tags.includes(t)),
    getContact: (id) => contacts.find((c) => c.id === id) ?? null,
    getByActorId: (id) => contacts.find((c) => c.actorId === id) ?? null,
    getAll: () => contacts,
    addContact: async (d) => {
      const c = { id: `c_${contacts.length}`, email: `${contacts.length}@x`, tags: [], ...d };
      contacts.push(c);
      return { success: true, contact: c };
    },
    updateContact: async (id, u) => { Object.assign(contacts.find((c) => c.id === id), u); return { success: true }; },
  },
  messageService: {
    sendMessage: async (m) => {
      sent.push({ id: `m${sent.length}`, ...m });
      return { success: true, messageId: `m${sent.length}` };
    },
  },
  messageRepository: { getMessage: async () => null },
  networkService: { isOnNetwork: () => false },
};
globalThis.ChatMessage = { create: async () => {}, getSpeaker: () => ({}) };
game.users.filter = () => [];
env.store.set('directOrderExecution', 'instant');

let S;
let Gigs;
let api;

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    DividendService: (await load('../scripts/services/DividendService.js')).DividendService,
    CorporateActionService: (await load('../scripts/services/CorporateActionService.js')).CorporateActionService,
    NewsService: (await load('../scripts/services/NewsService.js')).NewsService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    MarketStore: (await load('../scripts/data/MarketStore.js')).MarketStore,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
    CompanyRepository: (await load('../scripts/data/CompanyRepository.js')).CompanyRepository,
    BrokerRepository: (await load('../scripts/data/BrokerRepository.js')).BrokerRepository,
  };
  Gigs = (await load('../scripts/services/GigImpactService.js')).GigImpactService;
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  (await load('../scripts/init/registerBrokerSystem.js')).registerBrokerSystem(init);
  await init.runPhase('init');

  // Register just the public API, as the ready phase would (the rest of that phase starts timers).
  const handlers = [];
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem({ register: (phase, prio, name, fn) => handlers.push({ name, fn }) });
  globalThis.game.modules = new Map([['night-city-investments', { api: {} }]]);
  handlers.find((h) => h.name === 'Market API').fn();
  api = globalThis.game.modules.get('night-city-investments').api;

  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  for (const a of [alice, bob]) {
    await S.PortfolioClient.submit(a, 'deposit', { amount: 30000 });
    await settle();
    await S.PortfolioClient.submit(a, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 10, orderType: 'market', expiry: 'day' });
    await settle();
  }
  await S.TickService.advance(1);
  await settle();
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, (await import('../scripts/init/registerTickSequence.js')).TickSequence._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue, Gigs._queue]) await q;
  }
};

const gigs = () => S.MarketStore.getGigs();
const impacts = () => S.MarketStore.getControls().impacts.filter((i) => i.source === 'gig');
const tick = () => S.MarketStore.getPublic().tickIndex;
const headlines = () => S.MarketStore.getNews().items.map((i) => i.headline);
const mails = (a, text) => sent.filter((m) => m.toActorId === a.id && m.subject.includes(text));
const report = async (p) => { const out = await Gigs.report(p); await settle(); return out; };

test('with approval on, a completed gig waits in the queue, and nothing moves until it is approved', async () => {
  const out = await report({ gigId: 'g1', outcome: 'done', client: 'Arasaka', reward: '2,000 eb', title: 'Escort the courier' });
  assert.equal(out.status, 'pending');
  assert.equal(out.companyId, 'ARA');
  assert.equal(impacts().length, 0, 'not applied yet');
  assert.equal(gigs().pending.length, 1);
  const rec = gigs().pending[0];
  assert.deepEqual([rec.kind, rec.reason, rec.how, rec.sourceKey, rec.reward], ['review', 'approval', 'exact', 'gig:g1:done', 2000]);
  assert.ok(rec.percent > 1 && rec.percent < 3 && rec.delayDays >= 1 && rec.delayDays <= 3);
  assert.ok(rec.headline.includes('Arasaka'), 'a generic headline that names the company');
  assert.ok(!rec.headline.includes('courier'), 'and does not give the gig away');
  assert.ok(env.notices.some(([, m]) => String(m).includes('Gig.Notice.Review')), 'the GM is told');
  assert.deepEqual(Gigs.counts(), { review: 1, mapping: 0 });

  assert.equal((await report({ gigId: 'g1', outcome: 'done', client: 'Arasaka' })).status, 'duplicate', 'the same gig cannot be queued twice');
  assert.equal(gigs().pending.length, 1);
  assert.equal(Gigs.known('gig:g1:done'), true);
  assert.equal(api.events.isReported('gig:g1:done'), true);
});

test('approving applies the GM\'s size and delay, and the headline appears when the price starts to move', async () => {
  const t0 = tick();
  const { id } = gigs().pending[0];
  const out = await Gigs.approve(id, { percent: 4, delayDays: 2, headline: 'ARA lands a big one' });
  await settle();
  assert.equal(out.status, 'applied');
  assert.equal(gigs().pending.length, 0);
  assert.equal(gigs().history.at(-1).status, 'applied');

  const [impact] = impacts();
  assert.equal(impact.sourceKey, 'gig:g1:done');
  assert.deepEqual(impact.target, { type: 'company', id: 'ARA' });
  assert.ok(Math.abs(impact.amount - Math.log(1.04)) < 1e-3);
  assert.equal(impact.onsetTick, t0 + 1, 'shows two ticks from now');
  assert.equal(S.MarketStore.getControls().log.at(-1).kind, 'gig');

  assert.equal(headlines().includes('ARA lands a big one'), false, 'not published yet');
  await S.TickService.advance(1);
  await settle();
  assert.equal(headlines().includes('ARA lands a big one'), false, 'still before the effect');
  await S.TickService.advance(1);
  await settle();
  assert.equal(headlines().filter((h) => h === 'ARA lands a big one').length, 1, 'published once the effect shows');
  assert.equal(impacts()[0].meta.headlinePosted, true);
  await S.TickService.advance(2);
  await settle();
  assert.equal(headlines().filter((h) => h === 'ARA lands a big one').length, 1, 'never twice');
});

test('an approved gig is remembered, so reporting it again changes nothing', async () => {
  assert.equal((await report({ gigId: 'g1', outcome: 'done', client: 'Arasaka' })).status, 'duplicate');
  assert.equal(impacts().length, 1);
});

test('with approval off, an exact client match is applied at once, and failures are negative', async () => {
  env.store.set('gigImpactApproval', false);
  const out = await report({ gigId: 'g2', outcome: 'failed', client: 'Militech International Armaments', reward: 5000, title: 'Raid' });
  assert.equal(out.status, 'applied');
  assert.equal(out.companyId, 'MIL');
  assert.ok(out.percent < -1.5);
  const hit = impacts().find((i) => i.sourceKey === 'gig:g2:failed');
  assert.ok(hit.amount < 0);
  assert.equal(gigs().pending.length, 0);
  assert.equal(gigs().history.at(-1).companyId, 'MIL');
  assert.equal(hit.meta.headlinePosted, false);
  assert.ok(hit.meta.headline.includes('Militech'));
});

test('a close spelling or a company only named in the gig text is held for review even with approval off', async () => {
  const typo = await report({ gigId: 'g3', outcome: 'done', client: 'Kendachii', reward: 1000 });
  assert.equal(typo.status, 'pending');
  const mention = await report({ gigId: 'g4', outcome: 'done', client: '', title: 'Steal a prototype from Biotechnica', reward: 1000 });
  assert.equal(mention.status, 'pending');
  const reasons = gigs().pending.map((p) => [p.companyId, p.reason]);
  assert.deepEqual(reasons, [['KEN', 'fuzzy'], ['BIO', 'mention']]);
  for (const p of gigs().pending) assert.equal((await Gigs.discard(p.id)).status, 'discarded');
  await settle();
  assert.equal(gigs().pending.length, 0);
  assert.equal(gigs().history.at(-1).status, 'discarded');
  assert.equal(impacts().some((i) => i.sourceKey === 'gig:g3:done'), false, 'a discarded impact never reaches the market');
});

test('an unknown client waits for a mapping; mapping it settles every waiting gig and later ones too', async () => {
  const a = await report({ gigId: 'g5', outcome: 'done', client: 'Mr. Johnson', reward: 1500, title: 'Job A' });
  const b = await report({ gigId: 'g6', outcome: 'failed', client: 'mr johnson', reward: 800, title: 'Job B' });
  const other = await report({ gigId: 'g7', outcome: 'done', client: 'Somebody Else', reward: 100 });
  assert.deepEqual([a.status, b.status, other.status], ['unmatched', 'unmatched', 'unmatched']);
  assert.deepEqual(Gigs.counts(), { review: 0, mapping: 3 });
  assert.ok(env.notices.some(([kind, m]) => kind === 'warn' && String(m).includes('Gig.Notice.Mapping')));
  assert.equal(impacts().some((i) => /g[567]/.test(i.sourceKey)), false, 'nothing applied while unmapped');

  const out = await Gigs.mapClient(a.id, 'KAN');
  await settle();
  assert.deepEqual([out.status, out.applied, out.queued], ['mapped', 2, 0], 'both Mr. Johnson gigs settled');
  assert.deepEqual(Gigs.counts(), { review: 0, mapping: 1 });
  assert.equal(gigs().mappings['mr johnson'].companyId, 'KAN');
  assert.deepEqual(impacts().filter((i) => /g[56]/.test(i.sourceKey)).map((i) => [i.target.id, Math.sign(i.amount)]).sort(), [['KAN', -1], ['KAN', 1]]);

  const later = await report({ gigId: 'g8', outcome: 'done', client: 'MR. JOHNSON', reward: 100 });
  assert.equal(later.status, 'applied', 'a saved mapping is trusted');
  assert.equal(later.companyId, 'KAN');

  const skip = await Gigs.mapClient(other.id, 'ignore');
  await settle();
  assert.equal(skip.status, 'mapped');
  assert.equal(gigs().history.at(-1).status, 'ignored');
  assert.equal((await report({ gigId: 'g9', outcome: 'done', client: 'Somebody Else' })).status, 'ignored');
  assert.equal(Gigs.counts().mapping, 0);
});

test('with approval on, mapping a client sends its gigs to the review list instead', async () => {
  env.store.set('gigImpactApproval', true);
  const a = await report({ gigId: 'g10', outcome: 'done', client: 'Unnamed Syndicate', reward: 3000 });
  assert.equal(a.status, 'unmatched');
  assert.equal((await Gigs.mapClient(a.id, 'NOPE')).ok, false, 'an unknown company is refused');
  const out = await Gigs.mapClient(a.id, 'ORB', { remember: false });
  await settle();
  assert.deepEqual([out.applied, out.queued], [0, 1]);
  assert.equal(gigs().pending[0].kind, 'review');
  assert.equal(gigs().pending[0].how, 'mapping');
  assert.equal(gigs().mappings['unnamed syndicate'], undefined, 'not remembered when unticked');
  assert.equal((await Gigs.approve(gigs().pending[0].id)).status, 'applied');
  await settle();
  assert.equal(impacts().some((i) => i.sourceKey === 'gig:g10:done' && i.target.id === 'ORB'), true);
});

test('a mapping can be saved in advance and removed again', async () => {
  const w = await report({ gigId: 'g11', outcome: 'done', client: 'Grey Market Fixers', reward: 100 });
  assert.equal(w.status, 'unmatched');
  const out = await Gigs.addMapping('Grey Market Fixers', 'HAM');
  await settle();
  assert.deepEqual([out.applied, out.queued], [0, 1], 'the waiting gig moved on (approval is on)');
  assert.equal((await Gigs.addMapping('', 'HAM')).ok, false);
  assert.equal((await Gigs.addMapping('Someone', 'NOPE')).ok, false);
  await Gigs.removeMapping('grey market fixers');
  assert.equal(gigs().mappings['grey market fixers'], undefined);
  for (const p of gigs().pending) await Gigs.discard(p.id);
});

test('a gig for a company that is not trading is ignored', async () => {
  env.store.set('gigImpactApproval', false);
  await S.CorporateActionService.delist('ZIG');
  await settle();
  const out = await report({ gigId: 'g12', outcome: 'done', client: 'Ziggurat', reward: 1000 });
  assert.equal(out.status, 'ignored');
  assert.equal(gigs().history.at(-1).reason, 'not-tradable');
});

test('repeated gigs on one company have diminishing effect', async () => {
  env.store.set('gigImpactApproval', false);
  const pcts = [];
  for (const n of [1, 2, 3, 4]) pcts.push((await report({ gigId: `s${n}`, outcome: 'done', client: 'Kiroshi', reward: 6000 })).percent);
  assert.ok(pcts[1] < pcts[0] && pcts[3] < pcts[1], `each one is smaller: ${pcts.join(', ')}`);
  assert.ok(pcts[3] > 0, 'but still positive');
});

test('the strength setting scales the effect, and the master switch turns gigs off', async () => {
  env.store.set('gigImpactApproval', false);
  const base = (await report({ gigId: 'sc1', outcome: 'done', client: 'Network 54', reward: 2000 })).percent;
  env.store.set('gigImpactScale', 2);
  const doubled = (await report({ gigId: 'sc2', outcome: 'done', client: 'Zetatech', reward: 2000 })).percent;
  assert.ok(doubled > base * 1.8, `${doubled} vs ${base}`);
  env.store.set('gigImpactScale', 1);

  env.store.set('gigImpacts', false);
  const before = impacts().length;
  assert.equal((await report({ gigId: 'off1', outcome: 'done', client: 'Arasaka' })).status, 'disabled');
  assert.equal(impacts().length, before);
  env.store.set('gigImpacts', true);
});

test('bad input is refused, and only the active GM can report', async () => {
  assert.equal((await Gigs.report({ gigId: 'x', outcome: 'maybe', client: 'Arasaka' })).status, 'invalid');
  assert.equal((await Gigs.report({ outcome: 'done', client: 'Arasaka' })).status, 'invalid', 'no gig id or key');
  assert.equal((await Gigs.report(null)).status, 'invalid');
  assert.equal((await Gigs.approve('nope')).status, 'unknown');
  assert.equal((await Gigs.discard('nope')).status, 'unknown');

  const gm = globalThis.game.users.activeGM;
  globalThis.game.users.activeGM = { id: 'someone-else' };
  assert.equal((await Gigs.report({ gigId: 'ng', outcome: 'done', client: 'Arasaka' })).status, 'not-gm');
  assert.equal((await Gigs.approve('x')).status, 'not-gm');
  globalThis.game.users.activeGM = gm;
});

test('an outcome can be reported by hand, naming the company or leaving it to be found', async () => {
  env.store.set('gigImpactApproval', false);
  const named = await Gigs.reportManual({ client: 'Anonymous', outcome: 'done', reward: 1200, companyId: 'SOV' });
  assert.deepEqual([named.status, named.companyId], ['applied', 'SOV']);
  const found = await Gigs.reportManual({ client: 'SovOil', outcome: 'failed', reward: 900 });
  assert.deepEqual([found.status, found.companyId], ['applied', 'SOV']);
  assert.equal(impacts().filter((i) => i.target.id === 'SOV').length, 2, 'each manual report is its own event');
});

test('the public API resolves a client without changing anything', async () => {
  assert.equal(api.events.resolveClient('Arasaka').companyId, 'ARA');
  assert.equal(api.events.resolveClient({ client: 'Nobody' }).status, 'unmatched');
  assert.equal(typeof api.events.reportImpact, 'function');
  assert.equal(api.gm.gigs, Gigs);
  const out = await api.events.reportImpact({ gigId: 'api1', outcome: 'done', client: 'Biotechnica', reward: 500 });
  await settle();
  assert.deepEqual([out.status, out.companyId], ['applied', 'BIO']);
});

test('optional rumour mail goes only to opted-in players who hold or watch the company', async () => {
  env.store.set('gigImpactApproval', false);
  env.store.set('gigTips', true);
  await report({ gigId: 'tip0', outcome: 'done', client: 'Arasaka', reward: 1000 });
  assert.equal(mails(alice, 'Tip.Subject').length, 0, 'nobody has opted in');

  await S.PortfolioClient.setNotify(alice, 'tips', 'mail');
  await settle();
  const out = await report({ gigId: 'tip1', outcome: 'failed', client: 'Arasaka', reward: 1000 });
  assert.equal(out.status, 'applied');
  assert.equal(mails(alice, 'Tip.Subject').length, 1, 'Alice opted in and holds ARA');
  assert.equal(mails(bob, 'Tip.Subject').length, 0, 'Bob did not opt in');
  assert.ok(mails(alice, 'Tip.Subject')[0].body.includes('Tip.Down'), 'the rumour is a bad one');

  await report({ gigId: 'tip2', outcome: 'done', client: 'Hammered', reward: 1000 });
  assert.equal(mails(alice, 'Tip.Subject').length, 1, 'no mail about a company she neither holds nor watches');
  await S.PortfolioClient.toggleWatch(alice, 'HAM');
  await settle();
  await report({ gigId: 'tip3', outcome: 'done', client: 'Hammered', reward: 1000 });
  assert.equal(mails(alice, 'Tip.Subject').length, 2, 'watching is enough');

  env.store.set('gigTips', false);
  await report({ gigId: 'tip4', outcome: 'done', client: 'Arasaka', reward: 1000 });
  assert.equal(mails(alice, 'Tip.Subject').length, 2, 'the GM switch is off');
});

test('a player with a broker gets the rumour from that broker, in the broker\'s voice', async () => {
  env.store.set('gigImpactApproval', false);
  env.store.set('gigTips', true);
  const fixer = env.actors[2];
  fixer.system.lifepath = { personality: 'Sneaky and deceptive' };
  fixer.system.stats = { int: { value: 6 } };
  fixer.items = [{ type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } }];
  assert.equal(await S.BrokerRepository.makeBrokerFromActor(fixer.id), true);
  const [broker] = S.BrokerRepository.list();
  assert.equal(broker.personality, 'sneaky');
  await S.PortfolioClient.setBroker(alice, broker.id);
  await settle();
  assert.equal(S.PortfolioRepository.get(alice).brokerContactId, broker.id);

  const before = sent.length;
  await report({ gigId: 'bt1', outcome: 'done', client: 'Arasaka', reward: 1000 });
  const tips = sent.slice(before).filter((m) => m.toActorId === alice.id && m.subject.includes('Tip.Subject'));
  assert.equal(tips.length, 1);
  assert.equal(tips[0].fromContactId, broker.id, 'from the broker, not the market wire');
  const wire = contacts.find((c) => c.tags.includes('market-wire'));
  assert.ok(!wire || tips[0].fromContactId !== wire.id);
  const p = [...tips[0].body.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1]);
  assert.ok(BROKER_VOICES.sneaky.greetings.includes(p[0]), `a sneaky greeting: ${p[0]}`);
  assert.ok(BROKER_VOICES.sneaky.tipUp.map((l) => fillLine(l, { ticker: 'ARA', name: 'Arasaka' })).includes(p[1]), `a good-news rumour line: ${p[1]}`);
  assert.ok(BROKER_VOICES.sneaky.signoffs.includes(p.at(-1)));

  await report({ gigId: 'bt2', outcome: 'failed', client: 'Arasaka', reward: 1000 });
  const bad = sent.filter((m) => m.toActorId === alice.id && m.subject.includes('Tip.Subject')).at(-1);
  const q = [...bad.body.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1]);
  assert.equal(bad.fromContactId, broker.id);
  assert.ok(BROKER_VOICES.sneaky.tipDown.map((l) => fillLine(l, { ticker: 'ARA', name: 'Arasaka' })).includes(q[1]), `a bad-news rumour line: ${q[1]}`);

  // Bob has no broker, so his comes from the wire.
  await S.PortfolioClient.setNotify(bob, 'tips', 'mail');
  await settle();
  const beforeBob = sent.length;
  await report({ gigId: 'bt3', outcome: 'done', client: 'Arasaka', reward: 1000 });
  const bobTip = sent.slice(beforeBob).find((m) => m.toActorId === bob.id && m.subject.includes('Tip.Subject'));
  assert.ok(bobTip, 'Bob gets a rumour too');
  assert.notEqual(bobTip.fromContactId, broker.id, 'but not from Alice\'s broker');
  env.store.set('gigTips', false);
});

test('a gig headline mailed to an opted-in player comes from their broker; ordinary news stays on the wire', async () => {
  env.store.set('gigImpactApproval', false);
  env.store.set('gigTips', false);
  for (const a of [alice, bob]) await S.PortfolioClient.setNotify(a, 'headlines', 'mail');
  await settle();
  const broker = S.BrokerRepository.list()[0];
  assert.equal(S.PortfolioRepository.get(alice).brokerContactId, broker.id);
  assert.equal(S.PortfolioRepository.get(bob).brokerContactId, null);

  const before = sent.length;
  const out = await report({ gigId: 'hl1', outcome: 'failed', client: 'Arasaka', reward: 4000 });
  assert.equal(out.status, 'applied');
  await S.TickService.advance(4);
  await settle();
  const headline = S.MarketStore.getNews().items.find((i) => i.headline.includes('Arasaka') && i.tone === 'down');
  assert.ok(headline, 'the gig headline was published');
  assert.equal(headline.source, undefined, 'the public feed does not say it came from a gig');

  const gigLines = new Set(S.MarketStore.getNews().items.filter((i) => i.tone !== 'neutral').map((i) => i.headline));
  const inPool = (pool, text) => pool.some((l) => new RegExp(`^${l.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(ticker|name)\}/g, '.+?')}$`).test(text));
  assert.ok(gigLines.has(headline.headline));
  const got = (a) => sent.slice(before).filter((m) => m.toActorId === a.id && gigLines.has(m.subject));
  assert.ok(got(alice).length >= 1);
  assert.ok(got(alice).every((m) => m.fromContactId === broker.id), 'Alice\'s broker sends them all');
  for (const mail of got(alice)) {
    const p = [...mail.body.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1]);
    assert.ok(BROKER_VOICES.sneaky.greetings.includes(p[0]), p[0]);
    assert.ok(inPool([...BROKER_VOICES.sneaky.tipUp, ...BROKER_VOICES.sneaky.tipDown], p[1]), p[1]);
    assert.equal(p.length, 4, 'greeting, rumour line, the headline, sign-off');
    assert.ok(BROKER_VOICES.sneaky.signoffs.includes(p.at(-1)));
  }
  const downMail = got(alice).find((m) => m.subject === headline.headline);
  const down = [...downMail.body.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1]);
  assert.ok(inPool(BROKER_VOICES.sneaky.tipDown, down[1]), 'a bad headline gets a bad-news lead-in');

  assert.ok(got(bob).length >= 1);
  assert.ok(got(bob).every((m) => m.fromContactId !== broker.id), 'Bob has no broker, so they come from the wire');
  assert.ok(got(bob).every((m) => /^<p>[^<]*<\/p>$/.test(m.body)), 'plain, unvoiced');

  const beforeNews = sent.length;
  await S.NewsService.post({ headline: 'Trading resumes across the market.', tone: 'neutral' });
  await settle();
  const plain = sent.slice(beforeNews).filter((m) => m.subject === 'Trading resumes across the market.');
  assert.equal(plain.length, 2);
  assert.ok(plain.every((m) => m.fromContactId !== broker.id), 'general news is always from the wire');
  for (const a of [alice, bob]) await S.PortfolioClient.setNotify(a, 'headlines', 'off');
  await settle();
});

test('a market reset clears the queue and history but keeps the client mappings', async () => {
  assert.ok(Object.keys(gigs().mappings).length > 0);
  assert.ok(gigs().history.length > 0);
  await S.MarketStore.clearAll();
  assert.equal(gigs().history.length, 0);
  assert.equal(gigs().pending.length, 0);
  assert.equal(gigs().mappings['mr johnson'].companyId, 'KAN');
});
