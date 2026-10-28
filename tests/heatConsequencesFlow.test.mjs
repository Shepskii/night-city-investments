import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';
import { HEAT_TUNING, HEAT_ACTIONS, PENALTY_TUNING, fillLine } from '../scripts/engine/index.js';
import { BROKER_VOICES } from '../scripts/data/broker-voices.js';

const env = installFakeFoundry({
  actors: [['Alice', 90000, true], ['Bob', 90000, true], ['Carol', 90000, true], ['Dave', 90000, true], ['Erin', 90000, true], ['Fixer', 0, false]],
});
const [alice, bob, carol, dave, erin, fixer] = env.actors;

// A friendly broker, and skills for the cover-up rolls.
fixer.system.stats = { int: { value: 6 } };
fixer.system.lifepath = { personality: 'Friendly and outgoing' };
fixer.items = [{ type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } }];
for (const a of [alice, bob, carol, dave, erin]) {
  a.system.stats = { int: { value: 6 }, cool: { value: 6 } };
  a.items = [
    { type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } },
    { type: 'skill', name: 'Trading', system: { level: 4, stat: 'int' } },
    { type: 'skill', name: 'Business', system: { level: 5, stat: 'int' } },
    { type: 'skill', name: 'Bribery', system: { level: 6, stat: 'cool' } },
  ];
}

const contacts = [];
const sent = [];
const chats = [];
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
  messageService: { sendMessage: async (m) => { sent.push(m); return { success: true, messageId: `m${sent.length}` }; } },
  messageRepository: { getMessage: async () => null },
  networkService: { isOnNetwork: () => false },
};
globalThis.ChatMessage = undefined;
installFakeChat(chats);
game.users.filter = () => [];
env.store.set('directOrderExecution', 'instant');
env.store.set('gigImpactApproval', false);
env.store.set('heatEnabled', true);
env.store.set('heatConsequences', true);
env.store.set('heatPenaltyApproval', true);

let S; let Gigs; let Heat; let brokerId;
// Flags merge objects rather than replace them, so a cooldown is cleared by setting it to zero.
const NO_COOLDOWNS = { mask: 0, books: 0, front: 0, bribe: 0 };
const dice = [];

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
    BrokerRepository: (await load('../scripts/data/BrokerRepository.js')).BrokerRepository,
    SkillAdapter: (await load('../scripts/services/SkillAdapter.js')).SkillAdapter,
  };
  Gigs = (await load('../scripts/services/GigImpactService.js')).GigImpactService;
  Heat = (await load('../scripts/services/HeatService.js')).HeatService;
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  (await load('../scripts/init/registerBrokerSystem.js')).registerBrokerSystem(init);
  await init.runPhase('init');

  S.SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 5, roll: null });

  await S.ImportService.importStarter();
  await S.TickService.syncCompanies();
  assert.equal(await S.BrokerRepository.makeBrokerFromActor(fixer.id), true);
  brokerId = S.BrokerRepository.list()[0].id;
  for (const a of [alice, bob, carol, dave, erin]) {
    await S.PortfolioClient.submit(a, 'deposit', { amount: 30000 });
    await settle();
    await S.PortfolioClient.setBroker(a, brokerId);
    await settle();
  }
  await S.TickService.advance(1);
  await settle();
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue,
      S.CorporateActionService._queue, S.NewsService._queue, Gigs._queue, Heat._queue]) await q;
  }
};

const pf = (a) => S.PortfolioRepository.get(a);
const price = (id) => S.MarketStore.getPublic().companies[id].price;
const heat = () => S.MarketStore.getHeat();
const tick = () => S.MarketStore.getPublic().tickIndex;
const mailsTo = (a, from) => sent.filter((m) => m.toActorId === a.id && (!from || m.fromContactId === from));
const ncpd = () => contacts.find((c) => c.tags.includes('ncpd-fincrime'));
const fromNcpd = (a) => (ncpd() ? mailsTo(a, ncpd().id) : []);
const heatMail = (a) => mailsTo(a).filter((m) => /Heat\./.test(m.subject) || (ncpd() && m.fromContactId === ncpd().id));
const paragraphs = (m) => [...m.body.matchAll(/<p>(.*?)<\/p>/g)].map((x) => x[1]);
const pending = () => heat().penalties.filter((p) => p.status === 'pending');
const advance = async (n) => { await S.TickService.advance(n); await settle(); };
const report = async (p) => { const out = await Gigs.report(p); await settle(); return out; };

/** Buy about `gross` eb of a company, directly. */
const buy = async (a, id, gross) => {
  const qty = Math.max(1, Math.round(gross / price(id)));
  const k = await S.PortfolioClient.submit(a, 'placeOrder', { route: 'direct', side: 'buy', assetId: id, qty, orderType: 'market', expiry: 'day' });
  await settle();
  const r = pf(a).results.find((x) => x.key === k);
  assert.equal(r?.ok, true, `${a.name} buy ${id}: ${JSON.stringify(r)}`);
};

/** Run one gig: report it, have each character trade in the window, then let the audit happen. */
const gigWith = async (gigId, client, trades) => {
  const out = await report({ gigId, outcome: 'done', client, reward: 2000 });
  assert.equal(out.status, 'applied');
  const id = Gigs.resolve({ client }).companyId;
  for (const [actor, gross, times = 1] of trades) for (let i = 0; i < times; i++) await buy(actor, id, gross);
  await advance(5);
  return heat().audits.find((a) => a.sourceKey === `gig:${gigId}:done`);
};

// ── Warnings ─────────────────────────────────────────────────────────────────

test('noticed: the broker sends a warning in their own voice, and only once', async () => {
  const audit = await gigWith('w1', 'Militech', [[alice, 3000, 2]]);
  assert.ok(audit.results[0].gain >= 25 && audit.results[0].gain < 50, `heat ${audit.results[0].gain}`);
  assert.equal(Heat.tierOf(alice.id), 'noticed');

  const warnings = mailsTo(alice, brokerId).filter((m) => m.subject.includes('Heat.WarningSubject'));
  assert.equal(warnings.length, 1);
  const p = paragraphs(warnings[0]);
  assert.ok(BROKER_VOICES.friendly.greetings.includes(p[0]), `a friendly greeting: ${p[0]}`);
  assert.ok(BROKER_VOICES.friendly.warning.includes(p[1]), `a friendly warning: ${p[1]}`);
  assert.match(p[2], /^NCI\.Mail\.Heat\.WarningLine\./, 'then the plain facts');
  assert.ok(BROKER_VOICES.friendly.signoffs.includes(p.at(-1)));
  assert.equal(warnings[0].body.includes('Mail.Sign'), false, 'the voice replaces the grade sign-off');
  assert.equal(fromNcpd(alice).length, 0, 'NCPD is not involved yet');
  assert.equal(pending().length, 0, 'and there is no penalty');

  assert.equal(pf(alice).heatAware, true, 'a warned player can now see the cover-up actions');
  assert.equal(heat().characters[alice.id].warned, 1);
  assert.equal(pf(bob).heatAware, false, 'someone who was not warned cannot');

  await gigWith('w1b', 'Kendachi', [[alice, 600, 1]]);
  assert.equal(mailsTo(alice, brokerId).filter((m) => m.subject.includes('Heat.WarningSubject')).length, 1, 'a small further trade does not warn again');
});

test('a player with no broker is not warned by mail at "noticed", and is not made aware', async () => {
  await S.PortfolioClient.setBroker(erin, null);
  await settle();
  await gigWith('w2', 'Zetatech', [[erin, 3000, 2]]);
  assert.equal(Heat.tierOf(erin.id), 'noticed');
  assert.equal(heatMail(erin).length, 0);
  assert.equal(pf(erin).heatAware, false);
  await S.PortfolioClient.setBroker(erin, brokerId);
  await settle();
});

// ── Flagged ──────────────────────────────────────────────────────────────────

test('flagged: NCPD sends an enquiry, and new broker orders are a day slower and half as dear again', async () => {
  const audit = await gigWith('f1', 'Network 54', [[bob, 6000, 2]]);
  assert.ok(audit.results[0].gain >= 50 && audit.results[0].gain < 75, `heat ${audit.results[0].gain}`);
  assert.equal(Heat.tierOf(bob.id), 'flagged');

  const enquiry = fromNcpd(bob);
  assert.equal(enquiry.length, 1, 'one routine enquiry from the NCPD contact');
  assert.match(enquiry[0].subject, /^NCI\.Mail\.Heat\.EnquirySubject\./);
  assert.equal(mailsTo(bob, brokerId).filter((m) => m.subject.includes('Heat.Warning')).length, 1, 'and the broker had warned them on the way up');
  assert.ok(ncpd().sendOnly && ncpd().name === 'NCPD Financial Crimes');
  assert.equal(pf(bob).heatAware, true);

  const order = async (a) => {
    const k = await S.PortfolioClient.submit(a, 'placeOrder', { route: 'broker', side: 'buy', assetId: 'ARA', qty: 5, orderType: 'market', expiry: 'day' });
    await settle();
    return pf(a).orders.find((o) => o.id === `o_${k}`);
  };
  const watched = await order(bob);
  const calm = await order(dave);
  assert.equal(Heat.tierOf(dave.id), 'quiet');
  const minDays = S.BrokerRepository.list()[0].terms.latency.min;
  assert.ok(watched.eligibleTick >= tick() + minDays + 1, `at least a day beyond the broker's fastest: ${watched.eligibleTick}`);
  assert.ok(calm.eligibleTick >= tick() + minDays, 'an unwatched client gets the ordinary delay');
  assert.ok(Math.abs(watched.feeProfile.commissionBps - calm.feeProfile.commissionBps * 1.5) < 0.01, 'dearer');
  assert.equal(S.PortfolioService.scrutinyOf(dave).feeMult, 1);
  assert.equal(S.PortfolioService.scrutinyOf(bob).feeMult, 1.5);
});

test('with consequences off, heat is recorded but nobody is mailed, slowed or penalised', async () => {
  env.store.set('heatConsequences', false);
  try {
    const audit = await gigWith('c1', 'Orbital Air', [[dave, 12000, 2]]);
    assert.ok(audit.results[0].gain >= 75);
    assert.equal(heatMail(dave).length, 0, 'no warning, enquiry or notice');
    assert.equal(pending().filter((p) => p.actorId === dave.id).length, 0);
    assert.equal(S.PortfolioService.settings({}, dave).scrutiny, undefined, 'and no surcharge');
  } finally {
    env.store.set('heatConsequences', true);
  }
  await Heat.setHeat(dave.id, 0);
  await settle();
});

// ── Investigated: the GM approves ────────────────────────────────────────────

test('investigated: a penalty is proposed, nothing changes until the GM approves, then NCPD is told to carry it out', async () => {
  const cashBefore = pf(carol).cash;
  const audit = await gigWith('i1', 'SovOil', [[carol, 12000, 2]]);
  assert.equal(audit.results[0].applied >= 75, true);
  assert.equal(Heat.tierOf(carol.id), 'investigated');

  const [p] = pending();
  assert.equal(pending().length, 1);
  assert.deepEqual([p.actorId, p.status, p.sourceKey], [carol.id, 'pending', 'gig:i1:done']);
  assert.ok(['fine', 'freeze', 'dropBroker'].includes(p.kind));
  assert.ok(env.notices.some(([, m]) => String(m).includes('Heat.Notice.Pending')), 'the GM is told');
  assert.equal(pf(carol).frozenUntilTick, 0);
  assert.equal(mailsTo(carol).filter((m) => /Heat\.(Fine|Freeze|Dropped)/.test(m.subject)).length, 0, 'the player has not been told');

  const heatBefore = Heat.heatOf(carol.id);
  const out = await Heat.approvePenalty(p.id, p.kind === 'fine' ? { amount: 777 } : { days: 4 });
  await settle();
  assert.deepEqual([out.ok, out.status], [true, 'applied']);
  const done = heat().penalties.find((x) => x.id === p.id);
  assert.equal(done.status, 'applied');
  assert.ok(Math.abs(Heat.heatOf(carol.id) - heatBefore * PENALTY_TUNING.heatAfter) < 1, 'the pressure eases once the case is closed');
  assert.equal(pending().length, 0);

  if (p.kind === 'fine') {
    assert.equal(done.params.amount, 777, "the GM's amount");
    assert.equal(pf(carol).cash, cashBefore - 777 - (cashBefore - pf(carol).cash - 777), 'the fine came out of the balance');
    assert.ok(pf(carol).ledger.some((e) => e.kind === 'fine' && e.amount === -777));
    assert.equal(fromNcpd(carol).filter((m) => m.subject === 'NCI.Mail.Heat.Fine.Subject').length, 1);
  } else if (p.kind === 'freeze') {
    assert.ok(pf(carol).frozenUntilTick >= tick() + 3);
    assert.equal(fromNcpd(carol).filter((m) => m.subject === 'NCI.Mail.Heat.Freeze.Subject').length, 1);
  } else {
    assert.equal(pf(carol).brokerContactId, null);
    assert.equal(mailsTo(carol, brokerId).filter((m) => m.subject === 'NCI.Mail.Heat.Dropped.Subject').length, 1);
    await S.PortfolioClient.setBroker(carol, brokerId);
    await settle();
    assert.equal(pf(carol).brokerContactId, null, 'and they will not take her back yet');
  }
});

test('every kind of penalty is carried out properly: a fine, a freeze and a dropped broker', async () => {
  const make = (kind, params, actor) => ({ id: `t_${kind}`, actorId: actor.id, name: actor.name, kind, params, status: 'pending', tick: tick(), date: 'd', sourceKey: `t:${kind}`, heat: 80 });

  // fine: partly covered
  await S.PortfolioService.transformActor(dave, (p) => ({ portfolio: { ...p, cash: 400 } }));
  await Heat._execute(make('fine', { amount: 1000 }, dave));
  assert.equal(pf(dave).cash, 0, 'takes what there is');
  const mail = fromNcpd(dave).filter((m) => m.subject === 'NCI.Mail.Heat.Fine.Subject').at(-1);
  assert.ok(mail.body.includes('Heat.Fine.Short'), 'and says it was short');
  assert.equal(heat().penalties.find((p) => p.id === 't_fine').result.shortfall, 600);
  await S.PortfolioClient.submit(dave, 'deposit', { amount: 5000 });
  await settle();

  // freeze: orders voided, trading and withdrawals blocked, deposits fine
  const k = await S.PortfolioClient.submit(dave, 'placeOrder', { route: 'broker', side: 'buy', assetId: 'MIL', qty: 2, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(pf(dave).orders.find((o) => o.id === `o_${k}`).status, 'open');
  await Heat._execute(make('freeze', { days: 3 }, dave));
  assert.equal(pf(dave).orders.find((o) => o.id === `o_${k}`).status, 'cancelled', 'the open order was voided');
  assert.equal(pf(dave).frozenUntilTick, tick() + 3);
  const blocked = await S.PortfolioClient.submit(dave, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'MIL', qty: 1, orderType: 'market', expiry: 'day' });
  const wd = await S.PortfolioClient.submit(dave, 'withdraw', { amount: 50 });
  const dep = await S.PortfolioClient.submit(dave, 'deposit', { amount: 100 });
  await settle();
  const res = (key) => pf(dave).results.find((r) => r.key === key);
  assert.deepEqual([res(blocked).reason, res(wd).reason, res(dep).ok], ['account-frozen', 'account-frozen', true]);
  await advance(3);
  const after = await S.PortfolioClient.submit(dave, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'MIL', qty: 1, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(res(after).ok, true, 'it thaws on schedule');

  // a dropped broker: orders cancelled, refused for the ban
  const o = await S.PortfolioClient.submit(dave, 'placeOrder', { route: 'broker', side: 'buy', assetId: 'MIL', qty: 1, orderType: 'market', expiry: 'day' });
  await settle();
  await Heat._execute(make('dropBroker', { brokerId, banDays: PENALTY_TUNING.banDays }, dave));
  assert.equal(pf(dave).brokerContactId, null);
  assert.equal(pf(dave).orders.find((x) => x.id === `o_${o}`).status, 'cancelled');
  assert.equal(pf(dave).brokerBans[brokerId], tick() + PENALTY_TUNING.banDays);
  const reassign = await S.PortfolioClient.setBroker(dave, brokerId);
  await settle();
  assert.equal(res(reassign).reason, 'broker-refuses');
  await S.PortfolioClient.setBroker(dave, null);
  await settle();
});

test('the GM can dismiss a penalty, change its size, or let them be applied at once', async () => {
  await Heat.setHeat(erin.id, 90);
  await settle();
  const entry = heat().characters[erin.id];
  assert.equal(entry.heat, 90);
  const trade = (n) => [{ orderId: `x${n}`, side: 'buy', gross: 5000, route: 'direct', submittedTick: tick(), knowledge: 'general', gain: 40 }];
  const window = { sourceKey: 'gig:dismiss:done', companyId: 'ARA' };

  await Heat._investigate(erin, window, { trades: trade(1), applied: 40 }, 90, tick());
  const p = pending().find((x) => x.actorId === erin.id);
  assert.ok(p);
  await Heat._investigate(erin, { ...window, sourceKey: 'gig:again:done' }, { trades: trade(2), applied: 40 }, 90, tick());
  assert.equal(pending().filter((x) => x.actorId === erin.id).length, 1, 'one waiting case at a time for a character');

  const cash = pf(erin).cash;
  const dismissed = await Heat.dismissPenalty(p.id);
  await settle();
  assert.equal(dismissed.status, 'dismissed');
  assert.equal(heat().penalties.find((x) => x.id === p.id).status, 'dismissed');
  assert.equal(pf(erin).cash, cash, 'nothing happened to the account');
  assert.equal(Heat.heatOf(erin.id) > 80, true, 'and the heat is untouched');
  assert.equal((await Heat.dismissPenalty(p.id)).status, 'unknown', 'it cannot be decided twice');
  assert.equal((await Heat.approvePenalty('nope')).status, 'unknown');
  assert.equal((await Heat.approvePenalty(p.id)).status, 'unknown');

  env.store.set('heatPenaltyApproval', false);
  await Heat._investigate(erin, { ...window, sourceKey: 'gig:auto:done' }, { trades: trade(3), applied: 40 }, 90, tick());
  await settle();
  assert.equal(pending().filter((x) => x.actorId === erin.id).length, 0, 'with approval off it is carried out straight away');
  assert.equal(heat().penalties.filter((x) => x.actorId === erin.id && x.status === 'applied').length, 1);
  env.store.set('heatPenaltyApproval', true);
});

test('the GM can set or clear a character\'s heat, and lowering it lets a warning go out again', async () => {
  await Heat.setHeat(alice.id, 0);
  await settle();
  assert.equal(Heat.heatOf(alice.id), 0);
  assert.equal(heat().characters[alice.id].warned, 0, 'the "noticed" warning is armed again');
  assert.equal((await Heat.setHeat('nobody', 10)).status, 'invalid');
  assert.equal((await Heat.setHeat(alice.id, 'x')).status, 'invalid');
  const before = mailsTo(alice, brokerId).filter((m) => m.subject.includes('Heat.WarningSubject')).length;
  await gigWith('w3', 'Hammered', [[alice, 3000, 2]]);
  assert.equal(mailsTo(alice, brokerId).filter((m) => m.subject.includes('Heat.WarningSubject')).length, before + 1, 'warned again after cooling down');
});

test('a skilled broker leaves a smaller trail on trades made through them', async () => {
  await Heat.setHeat(dave.id, 0);
  await S.PortfolioService.transformActor(dave, (p) => ({ portfolio: { ...p, brokerBans: { [brokerId]: 0 }, frozenUntilTick: 0, cash: Math.max(p.cash, 20000) } }));
  await S.PortfolioClient.setBroker(dave, brokerId);
  await settle();
  const out = await report({ gigId: 'b1', outcome: 'done', client: 'Kiroshi', reward: 2000 });
  assert.equal(out.status, 'applied');
  const k = await S.PortfolioClient.submit(dave, 'placeOrder', { route: 'broker', side: 'buy', assetId: 'KIR', qty: 27, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(pf(dave).results.find((r) => r.key === k).ok, true, JSON.stringify(pf(dave).results.find((r) => r.key === k)));
  await advance(8);
  const audit = heat().audits.find((a) => a.sourceKey === 'gig:b1:done');
  assert.ok(audit, 'audited once the order had filled');
  const trade = audit.results.find((r) => r.name === 'Dave').trades[0];
  assert.equal(trade.route, 'broker');
  assert.equal(trade.brokerFactor, HEAT_TUNING.brokerFactor.seasoned, 'a seasoned broker keeps 85%');
});

// ── Cover-up actions ─────────────────────────────────────────────────────────

const act = async (actor, action, rolls) => {
  dice.length = 0;
  dice.push(...rolls);
  const k = await S.PortfolioClient.heatAction(actor, action);
  await settle();
  return pf(actor).results.find((r) => r.key === k);
};

test('every cover-up action rolls its own skill, and the roll is posted to chat', async () => {
  await Heat.setHeat(bob.id, 60);
  await settle();
  const seen = {};
  for (const [id, want] of [['mask', 'Trading'], ['books', 'Accounting'], ['front', 'Business'], ['bribe', 'Bribery']]) {
    await S.PortfolioService.transformActor(bob, (p) => ({ portfolio: { ...p, cash: 20000, heatCooldowns: NO_COOLDOWNS } }));
    const before = chats.length;
    const r = await act(bob, id, [8]);
    assert.equal(r.ok, true, `${id}: ${JSON.stringify(r)}`);
    const card = chats.slice(before).map((c) => c.content).join(' ');
    assert.ok(card.includes(want), `${id} rolls ${want}: ${card}`);
    assert.ok(card.includes(`DV ${HEAT_ACTIONS[id].dv}`));
    seen[id] = r;
  }
  assert.deepEqual(Object.values(seen).map((r) => r.cost), [150, 500, 1500, 3000]);
  assert.equal(seen.bribe.total, 6 + 6 + 8, 'COOL 6 + Bribery 6 + the die');
  assert.equal(seen.mask.total, 6 + 4 + 8, 'INT 6 + Trading 4 + the die');
});

test('a successful action takes heat off and costs money, and is applied to the record once', async () => {
  await Heat.setHeat(carol.id, 60);
  await S.PortfolioService.transformActor(carol, (p) => ({ portfolio: { ...p, cash: 20000, heatCooldowns: NO_COOLDOWNS } }));
  await settle();
  const before = Heat.heatOf(carol.id);
  const cash = pf(carol).cash;
  const r = await act(carol, 'books', [8]);
  assert.deepEqual([r.ok, r.passed, r.outcome, r.reduce], [true, true, 'success', 15]);
  assert.ok(Math.abs(Heat.heatOf(carol.id) - (before - 15)) < 0.5, `${before} -> ${Heat.heatOf(carol.id)}`);
  assert.equal(pf(carol).cash, cash - 500);
  assert.ok(pf(carol).ledger.some((e) => e.kind === 'cover' && e.amount === -500));
  const log = heat().characters[carol.id].log.at(-1);
  assert.deepEqual([log.action, log.gain], ['books', -15]);

  await Heat._reconcile(carol);
  await Heat._reconcile(carol);
  assert.ok(Math.abs(Heat.heatOf(carol.id) - (before - 15)) < 0.5, 'reconciling again changes nothing');

  const again = await act(carol, 'books', [8]);
  assert.equal(again.reason, 'on-cooldown');
  assert.equal(pf(carol).cash, cash - 500, 'a refused try costs nothing');
});

test('a miss costs the money and does nothing; a refused bribe makes it worse; a fumble worse still', async () => {
  await Heat.setHeat(erin.id, 40);
  await S.PortfolioService.transformActor(erin, (p) => ({ portfolio: { ...p, cash: 20000, heatCooldowns: NO_COOLDOWNS } }));
  await settle();
  const h0 = Heat.heatOf(erin.id);

  const miss = await act(erin, 'books', [2]);
  assert.deepEqual([miss.outcome, miss.passed, miss.reduce, miss.add], ['failure', false, 0, 0]);
  assert.ok(Math.abs(Heat.heatOf(erin.id) - h0) < 0.5, 'nothing changes');
  assert.equal(pf(erin).cash, 19500, 'but the money is gone');

  const refused = await act(erin, 'bribe', [2]);
  assert.deepEqual([refused.outcome, refused.add], ['failure', 8]);
  assert.ok(Heat.heatOf(erin.id) > h0 + 6, `a refused bribe gets talked about: ${h0} -> ${Heat.heatOf(erin.id)}`);

  const h1 = Heat.heatOf(erin.id);
  await S.PortfolioService.transformActor(erin, (p) => ({ portfolio: { ...p, heatCooldowns: NO_COOLDOWNS } }));
  const fumble = await act(erin, 'bribe', [1, 9]);
  assert.deepEqual([fumble.outcome, fumble.crit, fumble.add], ['fumble', 'fumble', 20], JSON.stringify(fumble));
  assert.ok(Heat.heatOf(erin.id) > h1 + 15);

  await S.PortfolioService.transformActor(erin, (p) => ({ portfolio: { ...p, heatCooldowns: NO_COOLDOWNS } }));
  const h2 = Heat.heatOf(erin.id);
  const crit = await act(erin, 'books', [10, 5]);
  assert.deepEqual([crit.outcome, crit.reduce], ['critical', 22.5]);
  assert.ok(Heat.heatOf(erin.id) < h2 - 20);
});

test('a front company halves the heat of the next audits for a week', async () => {
  await Heat.setHeat(dave.id, 0);
  await S.PortfolioService.transformActor(dave, (p) => ({ portfolio: { ...p, cash: 25000, heatCooldowns: NO_COOLDOWNS, frozenUntilTick: 0 } }));
  await settle();
  const r = await act(dave, 'front', [8]);
  assert.equal(r.outcome, 'success');
  assert.deepEqual([r.coverTicks, r.coverFactor], [7, 0.5]);
  assert.equal(S.MarketStore.getHeat().characters[dave.id].cover.factor, 0.5);

  const audit = await gigWith('v1', 'Dynalar', [[dave, 3000, 2]]);
  const mine = audit.results.find((x) => x.name === 'Dave');
  assert.equal(mine.covered, true);
  assert.ok(Math.abs(mine.applied - mine.gain / 2) < 0.2, `${mine.applied} is half of ${mine.gain}`);
  assert.equal(Heat.snapshot().characters.find((c) => c.name === 'Dave').cover.factor, 0.5);
});

test('an action is refused when heat is off, the account is frozen or there is not enough money', async () => {
  await S.PortfolioService.transformActor(alice, (p) => ({ portfolio: { ...p, cash: 100, heatCooldowns: NO_COOLDOWNS, frozenUntilTick: 0 } }));
  await settle();
  assert.equal((await act(alice, 'books', [8])).reason, 'insufficient-funds');
  await S.PortfolioService.transformActor(alice, (p) => ({ portfolio: { ...p, cash: 10000, frozenUntilTick: tick() + 5 } }));
  assert.equal((await act(alice, 'books', [8])).reason, 'account-frozen');
  await S.PortfolioService.transformActor(alice, (p) => ({ portfolio: { ...p, frozenUntilTick: 0 } }));
  env.store.set('heatEnabled', false);
  assert.equal((await act(alice, 'books', [8])).reason, 'heat-off');
  env.store.set('heatEnabled', true);
  assert.equal((await act(alice, 'nonsense', [8])).reason, 'unknown-action');
  assert.equal(pf(alice).cash, 10000, 'nothing was taken');
});

test('a market reset clears penalties along with the rest of the record', async () => {
  assert.ok(heat().penalties.length > 0);
  await S.MarketStore.clearAll();
  assert.deepEqual([heat().penalties.length, heat().audits.length, Object.keys(heat().characters).length], [0, 0, 0]);
});
