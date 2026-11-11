import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { VOICE_KINDS, resetVoiceMemory, fillLine } from '../scripts/engine/index.js';
import { BROKER_VOICES } from '../scripts/data/broker-voices.js';

const env = installFakeFoundry({ actors: [['Alice', 50000, true], ['Friendly Fran', 0, false], ['Sneaky Sam', 0, false], ['Plain Pat', 0, false], ['Odd Olly', 0, false]] });
const [alice, fran, sam, pat, olly] = env.actors;
fran.system.lifepath = { personality: 'Friendly and outgoing' };
sam.system.lifepath = { personality: 'Sneaky and deceptive' };
pat.system.lifepath = { personality: '' };
olly.system.lifepath = { personality: 'Brooding and poetic' };
for (const a of [fran, sam, pat, olly]) {
  a.system.stats = { int: { value: 6 } };
  a.items = [{ type: 'skill', name: 'Accounting', system: { level: 6, stat: 'int' } }];
}

const contacts = [
  { id: 'c_fran', name: 'Fran', actorId: fran.id, tags: ['broker'] },
  { id: 'c_sam', name: 'Sam', actorId: sam.id, tags: ['broker'] },
  { id: 'c_pat', name: 'Pat', actorId: pat.id, tags: ['broker'] },
  { id: 'c_olly', name: 'Olly', actorId: olly.id, tags: ['broker'] },
  { id: 'c_nosheet', name: 'No Sheet', actorId: null, tags: ['broker'] },
];
const sent = [];
globalThis.game.nightcity = {
  masterContactService: {
    filterByTag: (t) => contacts.filter((c) => c.tags.includes(t)),
    getContact: (id) => contacts.find((c) => c.id === id) ?? null,
    getByActorId: (id) => contacts.find((c) => c.actorId === id) ?? null,
    getAll: () => contacts,
  },
  messageService: { sendMessage: async (m) => { sent.push(m); return { success: true, messageId: `m${sent.length}` }; } },
};
globalThis.ChatMessage = { create: async () => {} };

let Mail; let Brokers; let Notify;
before(async () => {
  Mail = (await import('../scripts/services/MailService.js')).MailService;
  Brokers = (await import('../scripts/data/BrokerRepository.js')).BrokerRepository;
  Notify = (await import('../scripts/services/NotificationService.js')).NotificationService;
  await (await import('../scripts/services/TickService.js')).TickService.syncCompanies?.();
});

const paragraphs = (body) => [...body.matchAll(/<p>(.*?)<\/p>/g)].map((m) => m[1]);
const lastMail = () => sent.at(-1);
const filled = (extra = {}) => ({ orderId: 'o_abcdef', assetId: 'ARA', side: 'buy', qty: 5, price: 240, fees: 3, gross: 1200, assetType: 'stock', ...extra });

test('a broker\'s voice comes from the Personality on their sheet, and only when it is one we know', () => {
  const by = Object.fromEntries(Brokers.list().map((b) => [b.id, b.personality]));
  assert.deepEqual(by, { c_fran: 'friendly', c_sam: 'sneaky', c_pat: null, c_olly: null, c_nosheet: null });
});

test('a broker with a recognised personality writes in that voice, with the facts intact', async () => {
  resetVoiceMemory();
  const spec = Mail.orderFilled(filled());
  assert.equal(spec.voice.kind, 'filledBuy');
  await Mail.fromBroker('c_fran', alice, spec);
  const mail = lastMail();
  assert.equal(mail.subject, spec.subject, 'the subject is unchanged');
  const p = paragraphs(mail.body);
  assert.equal(p.length, spec.lines.length + 3);
  assert.ok(BROKER_VOICES.friendly.greetings.includes(p[0]));
  const intro = BROKER_VOICES.friendly.filledBuy.map((l) => fillLine(l, { ticker: 'ARA', name: 'ARA' }));
  assert.ok(intro.includes(p[1]), `a situation line: ${p[1]}`);
  assert.ok(!p[1].includes('{') && p[1].includes('ARA'), 'the company is named');
  assert.deepEqual(p.slice(2, 2 + spec.lines.length).map((x) => x.replace(/&quot;/g, '"')), spec.lines);
  assert.ok(BROKER_VOICES.friendly.signoffs.includes(p.at(-1)));
  assert.equal(mail.body.includes('NCI.Mail.Sign.'), false, 'the voice replaces the grade sign-off');
});

test('different personalities sound different for the same mail', async () => {
  const friendly = []; const sneaky = [];
  for (let i = 0; i < 12; i++) {
    await Mail.fromBroker('c_fran', alice, Mail.orderRejected({ orderId: 'o_1', assetId: 'ARA', side: 'buy', qty: 1, reason: 'insufficient-cash' }));
    friendly.push(paragraphs(lastMail().body)[1]);
    await Mail.fromBroker('c_sam', alice, Mail.orderRejected({ orderId: 'o_1', assetId: 'ARA', side: 'buy', qty: 1, reason: 'insufficient-cash' }));
    sneaky.push(paragraphs(lastMail().body)[1]);
  }
  assert.ok(friendly.every((l) => BROKER_VOICES.friendly.rejected.includes(l)));
  assert.ok(sneaky.every((l) => BROKER_VOICES.sneaky.rejected.includes(l)));
  assert.ok(new Set(friendly).size > 1, 'and it varies from one mail to the next');
});

test('the situation line follows what happened: a gain, a loss and a flat sale', async () => {
  const kinds = {};
  for (const [name, extra] of [['gain', { side: 'sell', realized: 500 }], ['loss', { side: 'sell', realized: -500 }], ['flat', { side: 'sell' }], ['flat0', { side: 'sell', realized: 0 }]]) {
    kinds[name] = Mail.orderFilled(filled(extra)).voice.kind;
  }
  assert.deepEqual(kinds, { gain: 'filledGain', loss: 'filledLoss', flat: 'filledSell', flat0: 'filledSell' });
  await Mail.fromBroker('c_sam', alice, Mail.orderFilled(filled({ side: 'sell', realized: -500 })));
  const intro = paragraphs(lastMail().body)[1];
  assert.ok(BROKER_VOICES.sneaky.filledLoss.map((l) => fillLine(l, { ticker: 'ARA', name: 'ARA' })).includes(intro), intro);
});

test('a broker with no sheet, a blank Personality or one we do not recognise keeps the standard wording', async () => {
  for (const id of ['c_nosheet', 'c_pat', 'c_olly']) {
    const spec = Mail.orderFilled(filled());
    await Mail.fromBroker(id, alice, spec);
    const p = paragraphs(lastMail().body);
    assert.equal(p.length, spec.lines.length + 1, id);
    assert.deepEqual(p.slice(0, -1).map((x) => x.replace(/&quot;/g, '"')), spec.lines, `${id}: just the facts`);
    assert.match(p.at(-1), /^NCI\.Mail\.Sign\.(rookie|competent|seasoned|expert|elite)$/, `${id}: the grade sign-off`);
  }
});

test('every broker mail says what it is about, in a kind the voices know', () => {
  const specs = {
    accepted: Mail.orderAccepted({ id: 'o_1', assetId: 'ARA', side: 'buy', qty: 1, eligibleTick: 3 }, { tick: 1 }),
    filled: Mail.orderFilled(filled()),
    rejected: Mail.orderRejected({ orderId: 'o_1', assetId: 'ARA', side: 'buy', qty: 1, reason: 'x' }),
    expired: Mail.orderExpired({ orderId: 'o_1', assetId: 'ARA', side: 'buy', qty: 1 }),
    queued: Mail.withdrawalQueued({ withdrawalId: 'w_1', amount: 100, fee: 1, releaseTick: 3, tick: 1 }),
    paid: Mail.withdrawalPaid({ amount: 100, fee: 1 }),
    failed: Mail.withdrawalFailed({ amount: 100, fee: 1 }),
    cancelled: Mail.cancelled('order', 'o_1'),
    rejectedRequest: Mail.rejectedRequest('unknown-asset', 'XXX'),
    unrecognised: Mail.unrecognised(),
    help: Mail.help(),
    notClient: Mail.notClient(),
    status: Mail.status({ cash: 1, holdings: 2, openOrders: 0, positions: [] }),
    tipUp: Mail.tip({ name: 'Arasaka', ticker: 'ARA', outcome: 'done' }),
    tipDown: Mail.tip({ name: 'Arasaka', ticker: 'ARA', outcome: 'failed' }),
  };
  for (const [name, spec] of Object.entries(specs)) assert.ok(VOICE_KINDS.includes(spec.voice?.kind), `${name} has a voice kind`);
  assert.equal(specs.tipUp.voice.kind, 'tipUp');
  assert.equal(specs.tipDown.voice.kind, 'tipDown');
  const used = new Set(Object.values(specs).map((s) => s.voice.kind));
  for (const gone of ['filledGain', 'filledLoss', 'filledSell', 'report']) used.add(gone);
  const heatMail = { warning: Mail.heatWarning(), dropped: Mail.brokerDropped() };
  for (const [name, spec] of Object.entries(heatMail)) assert.equal(spec.voice.kind, name);
  for (const spec of Object.values(heatMail)) used.add(spec.voice.kind);
  assert.deepEqual([...used].sort(), [...VOICE_KINDS].sort(), 'no pool is left unused');
});

test('the standard rumour varies in subject, wording and hedge, and never repeats back to back', () => {
  const subjects = []; const bodies = []; const hedges = [];
  for (let i = 0; i < 60; i++) {
    const spec = Mail.tip({ name: 'Arasaka', ticker: 'ARA', outcome: i % 2 ? 'failed' : 'done' });
    subjects.push(spec.subject);
    bodies.push(spec.lines[0]);
    hedges.push(spec.lines[1]);
    assert.match(spec.lines[0], i % 2 ? /^NCI\.Mail\.Tip\.Down\.[1-8]/ : /^NCI\.Mail\.Tip\.Up\.[1-8]/);
    assert.match(spec.lines[1], /^NCI\.Mail\.Tip\.Hedge\.[1-6]/);
  }
  for (const list of [subjects, hedges]) assert.ok(new Set(list).size >= 4, 'plenty of variety');
  assert.ok(new Set(bodies).size >= 8, `${new Set(bodies).size} different rumours`);
  for (let i = 2; i < 60; i += 2) assert.notEqual(bodies[i], bodies[i - 2], 'not the same good-news line twice running');
  for (let i = 3; i < 60; i += 2) assert.notEqual(bodies[i], bodies[i - 2], 'nor the same bad-news line');
});

test('a voiced rumour is greeting, rumour, hedge and sign-off, with no standard wording', async () => {
  const seen = new Set();
  for (let i = 0; i < 20; i++) {
    await Mail.fromBroker('c_sam', alice, Mail.tip({ name: 'Arasaka', ticker: 'ARA', outcome: 'done' }));
    const mail = lastMail();
    const p = paragraphs(mail.body);
    assert.equal(p.length, 4);
    assert.ok(BROKER_VOICES.sneaky.greetings.includes(p[0]));
    assert.ok(BROKER_VOICES.sneaky.tipUp.map((l) => fillLine(l, { ticker: 'ARA', name: 'ARA' })).concat(BROKER_VOICES.sneaky.tipUp.map((l) => fillLine(l, { ticker: 'ARA', name: 'Arasaka' }))).includes(p[1]), p[1]);
    assert.ok(BROKER_VOICES.sneaky.tipHedge.includes(p[2]));
    assert.ok(BROKER_VOICES.sneaky.signoffs.includes(p[3]));
    assert.equal(mail.body.includes('NCI.Mail.Tip'), false, 'none of the standard wording');
    seen.add(p.join('|'));
  }
  assert.ok(seen.size > 10, `varied: ${seen.size}`);
});

test('a broker with no voice still gets the standard rumour, hedge included', async () => {
  await Mail.fromBroker('c_nosheet', alice, Mail.tip({ name: 'Arasaka', ticker: 'ARA', outcome: 'failed' }));
  const p = paragraphs(lastMail().body);
  assert.equal(p.length, 3, 'rumour, hedge, grade sign-off');
  assert.match(p[0], /^NCI\.Mail\.Tip\.Down\./);
  assert.match(p[1], /^NCI\.Mail\.Tip\.Hedge\./);
  assert.match(p[2], /^NCI\.Mail\.Sign\./);
});

test('market wire mail carries no voice', () => {
  for (const spec of [Mail.dividend({ name: 'Arasaka', perShare: 2, payout: 20 }), Mail.headline({ headline: 'X' }), Mail.movers([], 5), Mail.digest({ holdings: 1, change: 0, changePct: 0, movers: [] })]) {
    assert.equal(spec.voice, undefined);
  }
});

test('notifications sent through a broker are voiced too', async () => {
  alice.flags = { 'night-city-investments': { prefs: { notify: { fills: 'mail' } } } };
  await Notify.notify(alice, 'fills', Mail.orderExpired({ orderId: 'o_9', assetId: 'ARA', side: 'buy', qty: 2 }), 'c_sam');
  const p = paragraphs(lastMail().body);
  assert.ok(BROKER_VOICES.sneaky.greetings.includes(p[0]), p[0]);
  assert.ok(BROKER_VOICES.sneaky.signoffs.includes(p.at(-1)));
});

test('a headline is filed in the newswire style: dateline, copy by its source and tone, sign-off (M3 step 5)', async () => {
  const { NEWSWIRE } = await import('../scripts/data/org-voices/newswire.js');
  const { CompanyRepository } = await import('../scripts/data/CompanyRepository.js');
  const company = { name: 'Test Corp', ticker: 'TST' };
  const get = CompanyRepository.get;
  CompanyRepository.get = (id) => (id === 'TST' ? company : get.call(CompanyRepository, id));
  const w = NEWSWIRE.wire;
  const filled = (kind, tone) => w[kind][tone].map((l) => fillLine(l, { name: company.name, ticker: company.ticker }));
  const filing = Mail.headline({ headline: 'Big news', tone: 'up', date: '3 May 2045', companyIds: [company.ticker] });
  assert.equal(filing.subject, 'Big news');
  assert.equal(filing.lines[0], 'NIGHT CITY, 3 May 2045. Big news');
  assert.ok(filled('filing', 'up').includes(filing.lines[1]), filing.lines[1]);
  assert.ok(w.signoffs.includes(filing.lines.at(-1)));
  const story = Mail.headline({ headline: 'Exposed', tone: 'down', date: 'today', companyIds: [company.ticker], source: 'story' });
  assert.ok(filled('story', 'down').includes(story.lines[1]), story.lines[1]);
  const market = Mail.headline({ headline: 'Trading halted', tone: 'neutral' });
  assert.equal(market.lines[0], 'NIGHT CITY. Trading halted', 'no date, no date in the dateline');
  assert.ok(w.market.lines.includes(market.lines[1]), 'news about no one company is the market\'s');
  assert.equal(market.voice, undefined, 'still no broker voice');
  CompanyRepository.get = get;
});
