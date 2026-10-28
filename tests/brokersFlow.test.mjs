import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { installFakeChat } from './helpers/fakeChat.mjs';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Fixer', 0, false], ['Bob', 5000, true]] });
const [alice, fixer, bob] = env.actors;

// Alice: INT 5 + Accounting 4 = 9. The Fixer: INT 6 + Accounting 6 = 12.
alice.system.stats = { int: { value: 5 } };
alice.items = [{ type: 'skill', name: 'Accounting', system: { level: 4, stat: 'int' } }];
fixer.system.stats = { int: { value: 6 } };
fixer.items = [{ type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } }];

// ── A fake Night City Messenger ───────────────────────────────────────────────
const contacts = [];
const sent = [];
const mailbox = new Map();
let failMail = false;
let onNetwork = false;

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
      if (failMail) return { success: false, error: 'down' };
      const message = { id: `m${sent.length}`, ...m };
      sent.push(message);
      mailbox.set(message.id, message);
      return { success: true, messageId: message.id };
    },
  },
  messageRepository: { getMessage: async (inbox, id) => mailbox.get(id) ?? null },
  networkService: { isOnNetwork: () => onNetwork, getNetwork: () => ({ requiresAuth: false }) },
};

const chat = [];
const fakeChat = installFakeChat(chat);
game.users.filter = () => [];
game.i18n.localize = (key) => key;
game.i18n.format = (key, data) => (data ? `${key} ${JSON.stringify(data)}` : key);

for (const [k, v] of Object.entries({
  directTradingMode: 'terminal', directCommissionBps: 200, directFlatFee: 5, corpnetDV: 13,
  corpnetNetwork: 'CORPNET', sessionTicks: 1, lockoutTicks: 1,
})) env.store.set(k, v);

let S;
let dice = [];

before(async () => {
  const load = (p) => import(p);
  S = {
    TickService: (await load('../scripts/services/TickService.js')).TickService,
    PortfolioService: (await load('../scripts/services/PortfolioService.js')).PortfolioService,
    PortfolioClient: (await load('../scripts/services/PortfolioClient.js')).PortfolioClient,
    NewsService: (await load('../scripts/services/NewsService.js')).NewsService,
    DividendService: (await load('../scripts/services/DividendService.js')).DividendService,
    ImportService: (await load('../scripts/services/ImportService.js')).ImportService,
    FundService: (await load('../scripts/services/FundService.js')).FundService,
    SkillAdapter: (await load('../scripts/services/SkillAdapter.js')).SkillAdapter,
    BrokerRepository: (await load('../scripts/data/BrokerRepository.js')).BrokerRepository,
    FundRepository: (await load('../scripts/data/FundRepository.js')).FundRepository,
    PortfolioRepository: (await load('../scripts/data/PortfolioRepository.js')).PortfolioRepository,
  };
  const { ModuleInitializer } = await load('../scripts/core/ModuleInitializer.js');
  const init = new ModuleInitializer();
  (await load('../scripts/init/registerMarketSystem.js')).registerMarketSystem(init);
  (await load('../scripts/init/registerPortfolioSystem.js')).registerPortfolioSystem(init);
  (await import('../scripts/init/registerTickSequence.js')).registerTickSequence(init);
  (await load('../scripts/init/registerBrokerSystem.js')).registerBrokerSystem(init);
  await init.runPhase('init');

  S.SkillAdapter.rollOne = async () => ({ value: dice.shift() ?? 5, roll: null });

  await S.ImportService.importStarter();
  await S.FundService.importStarter();
  await S.TickService.syncCompanies();
});

const settle = async () => {
  for (let i = 0; i < 6; i++) {
    await new Promise((r) => setTimeout(r, 3));
    for (const q of [S.TickService._queue, (await import('../scripts/init/registerTickSequence.js')).TickSequence._queue, S.PortfolioClient._chain, S.PortfolioService._queue, S.DividendService._queue, S.NewsService._queue]) await q;
  }
};

const portfolio = (actor = alice) => S.PortfolioRepository.get(actor);
const resultOf = (key, actor = alice) => portfolio(actor).results.find((r) => r.key === key);
const held = (assetId, actor = alice) => portfolio(actor).lots.filter((l) => l.assetId === assetId).reduce((s, l) => s + l.qty, 0);
const mailTo = (actor) => sent.filter((m) => m.toActorId === actor.id);
const lastMail = (actor) => mailTo(actor).at(-1);

let nextMail = 1;
async function mailBroker(actor, brokerContactId, text) {
  const id = `player_${nextMail++}`;
  mailbox.set(id, { id, subject: text, body: '' });
  env.callAll('night-city-messenger.message:sent', {
    messageId: id, toContactId: brokerContactId, toActorId: null, fromActorId: actor.id, subject: text,
  });
  await settle();
}

test('setup: a broker with a sheet, a client with a balance and the broker chosen', async () => {
  await S.BrokerRepository.makeBrokerFromActor(fixer.id);
  const broker = S.BrokerRepository.list()[0];
  assert.equal(broker.grade, 'seasoned');
  assert.equal(S.BrokerRepository.get(broker.id).terms.latency.min >= 1, true);

  await S.PortfolioClient.submit(alice, 'deposit', { amount: 30000 });
  await S.PortfolioClient.setBroker(alice, broker.id);
  await settle();
  assert.equal(portfolio().cash, 30000);
  assert.equal(portfolio().brokerContactId, broker.id);

  const unknown = await S.PortfolioClient.setBroker(alice, 'nobody');
  await settle();
  assert.equal(resultOf(unknown).ok, false, 'an unknown broker is refused');
  assert.equal(portfolio().brokerContactId, broker.id, 'and the choice is kept');
});

test('a mailed order is acknowledged, delayed, filled, and confirmed by mail', async () => {
  const brokerId = S.BrokerRepository.list()[0].id;
  const before = mailTo(alice).length;
  await mailBroker(alice, brokerId, 'BUY 5 ARA');

  assert.equal(mailTo(alice).length, before + 1, 'the broker replied once');
  assert.equal(lastMail(alice).fromContactId, brokerId);
  assert.ok(lastMail(alice).subject.includes('NCI.Mail.Accepted.Subject'));
  const order = portfolio().orders.find((o) => o.status === 'open');
  assert.equal(order.route, 'broker');
  assert.ok(order.eligibleTick > S.PortfolioService.tick(), 'broker orders are never instant');
  assert.equal(held('ARA'), 0);

  await mailBroker(alice, brokerId, 'BUY 5 ARA');
  assert.equal(portfolio().orders.filter((o) => o.status === 'open').length, 2, 'a different mail is a different order');

  await S.TickService.advance(4);
  await settle();
  assert.equal(held('ARA'), 10, 'both orders filled once their delay passed');
  const fills = mailTo(alice).filter((m) => m.subject.includes('Filled.Subject'));
  assert.equal(fills.length, 2, 'one confirmation per fill');
  assert.ok(fills[0].body.includes('<p>'), 'mail bodies are HTML paragraphs');
});

test('the same mail is never acted on twice, and a stranger gets a polite refusal', async () => {
  const brokerId = S.BrokerRepository.list()[0].id;
  const id = 'dup_1';
  mailbox.set(id, { id, subject: 'STATUS', body: '' });
  const data = { messageId: id, toContactId: brokerId, toActorId: null, fromActorId: alice.id, subject: 'STATUS' };
  const before = mailTo(alice).length;
  env.callAll('night-city-messenger.message:sent', data);
  env.callAll('night-city-messenger.message:sent', data);
  await settle();
  assert.equal(mailTo(alice).length, before + 1, 'a repeated hook gets one reply');
  assert.ok(lastMail(alice).subject.includes('Status.Subject'));

  const beforeBob = mailTo(bob).length;
  await mailBroker(bob, brokerId, 'BUY 1 ARA');
  assert.equal(mailTo(bob).length, beforeBob + 1);
  assert.ok(lastMail(bob).subject.includes('NotClient.Subject'), 'only a client can instruct the broker');
  assert.equal(S.PortfolioRepository.get(bob).orders.length, 0);

  await mailBroker(alice, brokerId, 'sell me a unicorn');
  assert.ok(lastMail(alice).subject.includes('Unrecognised.Subject'));
  await mailBroker(alice, brokerId, 'HELP');
  assert.ok(lastMail(alice).subject.includes('Help.Subject'));
});

test('a mailed order can be cancelled by its reference', async () => {
  const brokerId = S.BrokerRepository.list()[0].id;
  await mailBroker(alice, brokerId, 'BUY 1 ARA @ 1');
  const order = portfolio().orders.find((o) => o.status === 'open');
  assert.ok(order);
  const ref = order.id.slice(-6).toUpperCase();
  await mailBroker(alice, brokerId, `CANCEL ${ref}`);
  assert.equal(portfolio().orders.find((o) => o.id === order.id).status, 'cancelled');
  assert.ok(lastMail(alice).subject.includes('Cancelled.Subject'));
});

test('a fund can be bought through the broker, and never directly', async () => {
  const brokerId = S.BrokerRepository.list()[0].id;
  const fund = S.FundRepository.getByTicker('NC12');
  await S.PortfolioClient.submit(alice, 'deposit', { amount: 10000 });
  await settle();
  await mailBroker(alice, brokerId, `BUY 5 ${fund.ticker}`);
  const order = portfolio().orders.find((o) => o.status === 'open' && o.assetId === fund.id);
  assert.ok(order, `accepted: ${JSON.stringify(portfolio().results.at(-1))}`);
  assert.equal(order.assetType, 'fund');

  await S.TickService.advance(4);
  await settle();
  assert.equal(held(fund.id), 5, JSON.stringify({ orders: portfolio().orders.filter((o) => o.assetId === fund.id), tick: S.PortfolioService.tick() }));

  const key = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: fund.id, qty: 1, orderType: 'market', expiry: 'day' });
  await settle();
  assert.equal(resultOf(key).reason, 'fund-needs-broker');
});

test('direct trading: needs the network, then an Accounting check; failing locks you out', async () => {
  const buy = async () => {
    const key = await S.PortfolioClient.submit(alice, 'placeOrder', { route: 'direct', side: 'buy', assetId: 'ARA', qty: 1, orderType: 'market', expiry: 'day' });
    await settle();
    return resultOf(key);
  };
  assert.equal((await buy()).reason, 'no-terminal-session', 'no session, no direct trade');

  onNetwork = false;
  let key = await S.PortfolioClient.connectTerminal(alice);
  await settle();
  assert.equal(resultOf(key).ok, false);
  assert.equal(resultOf(key).reason, 'no-network', 'not on CorpNet, no check is rolled');

  onNetwork = true;
  dice = [2];
  key = await S.PortfolioClient.connectTerminal(alice);
  await settle();
  let r = resultOf(key);
  assert.equal(r.ok, true);
  assert.equal(r.passed, false, 'INT 5 + Accounting 4 + 2 = 11 against DV 13 fails');
  assert.equal(r.total, 11);
  assert.ok(chat.some((m) => m.content.includes('nci-chat')), 'the check is posted to chat');

  key = await S.PortfolioClient.connectTerminal(alice);
  await settle();
  assert.equal(resultOf(key).reason, 'locked-out', 'locked out after a failure');
  assert.equal((await buy()).reason, 'no-terminal-session');

  await S.TickService.advance(1);
  await settle();
  dice = [5];
  key = await S.PortfolioClient.connectTerminal(alice);
  await settle();
  r = resultOf(key);
  assert.equal(r.passed, true, '9 + 5 = 14 beats DV 13');
  assert.ok(portfolio().session, 'a session is open');

  const sharesBefore = held('ARA');
  const result = await buy();
  assert.equal(result.ok, true);
  assert.equal(held('ARA'), sharesBefore + 1, 'direct trades fill at once');
});

test('direct trades cost more than the same trade through the broker', async () => {
  const orders = portfolio().orders.filter((o) => o.status === 'filled' && o.assetType === 'stock');
  const direct = orders.find((o) => o.route === 'direct');
  const brokered = orders.find((o) => o.route === 'broker');
  assert.ok(direct && brokered, 'both kinds of order exist');
  assert.equal(direct.feeProfile.commissionBps, 200);
  assert.ok(brokered.feeProfile.commissionBps < direct.feeProfile.commissionBps, 'broker commission is lower');
  assert.ok(brokered.feeProfile.flatFee <= direct.feeProfile.flatFee, 'broker flat fee is no higher');
  assert.ok(direct.eligibleTick === direct.submittedTick, 'direct is same-tick');
  assert.ok(brokered.eligibleTick > brokered.submittedTick, 'broker is delayed');
});

test('withdrawals go through the broker and arrive as claimable eddies', async () => {
  const cashBefore = portfolio().cash;
  const key = await S.PortfolioClient.submit(alice, 'withdraw', { amount: 4000 });
  await settle();
  const r = resultOf(key);
  assert.equal(r.ok, true);
  assert.equal(r.pending, true, 'queued with the broker');
  assert.ok(portfolio().cash <= cashBefore - 4000, 'the money is held at once');
  const walletBefore = alice.system.wealth.value;
  assert.equal(walletBefore, 50000 - 30000 - 10000, 'nothing reaches the wallet directly');

  await S.TickService.advance(5);
  await settle();
  const paid = sent.filter((m) => m.eddies === 4000 && m.toActorId === alice.id);
  assert.equal(paid.length, 1, 'one mail carries the money');
  assert.equal(alice.system.wealth.value, walletBefore, 'wealth is credited when the player claims it');
  assert.equal(portfolio().withdrawals.find((w) => w.status === 'paid').amount, 4000);
});

test('a withdrawal whose mail cannot be sent is refunded, never lost', async () => {
  const key = await S.PortfolioClient.submit(alice, 'withdraw', { amount: 1000 });
  await settle();
  assert.equal(resultOf(key).pending, true);
  const cashHeld = portfolio().cash;

  failMail = true;
  await S.TickService.advance(5);
  await settle();
  failMail = false;
  assert.ok(portfolio().cash >= cashHeld + 1000, 'the held money is returned to the balance');
  assert.equal(portfolio().withdrawals.filter((w) => w.status === 'pending').length, 0);
  assert.ok(portfolio().ledger.some((e) => e.kind === 'withdraw-refund'));
});

test('a withdrawal can be cancelled before it is paid', async () => {
  const before = portfolio().cash;
  const key = await S.PortfolioClient.submit(alice, 'withdraw', { amount: 500 });
  await settle();
  const w = portfolio().withdrawals.find((x) => x.status === 'pending');
  assert.ok(w);
  assert.equal(portfolio().cash < before, true);
  await S.PortfolioClient.cancelWithdrawal(alice, w.id);
  await settle();
  assert.equal(portfolio().cash, before, 'cancelled, and the money is back');
  assert.ok(key);
});

test('notifications are opt-in and follow the chosen channel', async () => {
  const wireBefore = sent.filter((m) => m.subject?.includes('Quiet')).length;
  await S.NewsService.post({ headline: 'Quiet day on the exchange', tone: 'neutral' });
  await settle();
  assert.equal(sent.filter((m) => m.subject?.includes('Quiet')).length, wireBefore, 'headlines are off by default');

  await S.PortfolioClient.setNotify(alice, 'headlines', 'mail');
  await settle();
  await S.NewsService.post({ headline: 'Noisy day on the exchange', tone: 'neutral' });
  await settle();
  assert.equal(sent.filter((m) => m.subject?.includes('Noisy') && m.toActorId === alice.id).length, 1, 'mailed to the opted-in player');

  await S.PortfolioClient.setNotify(alice, 'headlines', 'chat');
  await settle();
  const chatBefore = chat.length;
  await S.NewsService.post({ headline: 'Loud day on the exchange', tone: 'neutral' });
  await settle();
  assert.equal(chat.length, chatBefore + 1, 'chat delivery posts a message');
  assert.equal(sent.filter((m) => m.subject?.includes('Loud')).length, 0, 'and sends no mail');

  await S.PortfolioClient.setNotify(alice, 'dividends', 'mail');
  await settle();
  const divBefore = mailTo(alice).length;
  await S.DividendService.declareSpecial('ARA', 1);
  await settle();
  assert.ok(mailTo(alice).length > divBefore, 'a dividend mail arrives');
  assert.ok(mailTo(alice).some((m) => m.subject.includes('Dividend.Subject')));
});

test('a connect request needs the player to have rolled: no card, a used card and a forged card all fail', async () => {
  await S.TickService.advance(3);
  await settle();
  assert.equal(portfolio().session === null || portfolio().session === undefined || portfolio().session.validThroughTick < S.PortfolioService.tick(), true, 'no session is open');

  const bare = await S.PortfolioClient.submit(alice, 'connectTerminal', { claim: { ok: true, network: 'CORPNET' } });
  await settle();
  assert.equal(resultOf(bare).reason, 'no-roll', 'a request with no roll');

  dice = [2];
  const card = (await S.SkillAdapter.check(alice, { dv: 13 })).messageId;
  const used = await S.PortfolioClient.submit(alice, 'connectTerminal', { claim: { ok: true, network: 'CORPNET' }, rollId: card });
  await settle();
  assert.equal(resultOf(used).passed, false, 'the card is accepted once: 11 against DV 13');

  await S.TickService.advance(2);
  await settle();
  const replay = await S.PortfolioClient.submit(alice, 'connectTerminal', { claim: { ok: true, network: 'CORPNET' }, rollId: card });
  await settle();
  assert.equal(resultOf(replay).reason, 'roll-used', 'the same card cannot open the session later');

  const forged = await S.PortfolioClient.submit(alice, 'connectTerminal', { claim: { ok: true, network: 'CORPNET' }, rollId: 'made-up' });
  await settle();
  assert.equal(resultOf(forged).reason, 'roll-missing');
  assert.ok(!portfolio().session || portfolio().session.validThroughTick < S.PortfolioService.tick(), 'still no session');
});

test('pressing Connect rolls on the player side and posts one card', async () => {
  await S.TickService.advance(2);
  await settle();
  const cards = chat.length;
  dice = [9];
  const key = await S.PortfolioClient.connectTerminal(alice);
  await settle();
  assert.equal(chat.length, cards + 1, 'one roll, made when the button was pressed');
  assert.equal(resultOf(key).passed, true, '9 + 9 beats DV 13');
  assert.equal(fakeChat.messages.size > 0, true);

  const before = chat.length;
  await S.PortfolioClient.connectTerminal(alice);
  await settle();
  assert.equal(chat.length, before, 'no second roll while a session is open');
});
