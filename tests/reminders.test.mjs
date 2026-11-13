import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import {
  businessReminders, syndicateReminders, storyReminders, pruneSent, waitingFor, adReason, dueAtClose, dueSoon,
  normalizeNotify, NOTIFY_CATEGORIES, AD_GAP_DAYS, normalizeBusiness,
} from '../scripts/engine/index.js';

const env = installFakeFoundry({ actors: [['Nova', 100, true], ['Rook', 50, true], ['Vex', 50, true]] });
const [nova, rook, vex] = env.actors;
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), lang);
game.i18n.localize = (key) => {
  const value = lookup(key);
  if (typeof value !== 'string') throw new Error(`Missing language key: ${key}`);
  return value;
};
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m));

// A Messenger with a directory and mail.
const contacts = [];
const sent = [];
game.nightcity = {
  masterContactService: {
    addContact: async (d) => {
      const contact = { id: `c${contacts.length + 1}`, ...d };
      contacts.push(contact);
      return { success: true, contact };
    },
    getContact: (id) => contacts.find((c) => c.id === id) ?? null,
    getByActorId: (id) => contacts.find((c) => c.actorId === id) ?? null,
    getAll: () => contacts,
    filterByTag: (tag) => contacts.filter((c) => (c.tags ?? []).includes(tag)),
  },
  messageService: { sendMessage: async (m) => { sent.push(m); return { success: true, messageId: `m${sent.length}` }; } },
};
const api = { v2: { directory: { pushToPlayer: async () => ({ ok: true, data: {} }) } } };
const realGet = game.modules.get;
game.modules.get = (id) => (id === 'night-city-messenger' ? { active: true, api } : realGet(id));

const { MODULE_ID, FLAGS } = await import('../scripts/utils/constants.js');
let ReminderService;
let BusinessRepository;
before(async () => {
  ({ ReminderService } = await import('../scripts/services/ReminderService.js'));
  ({ BusinessRepository } = await import('../scripts/data/BusinessRepository.js'));
});

const DAY = 100;
const shop = (over = {}) => normalizeBusiness({
  id: 'bus_shack', name: 'Ripper Shack', status: 'open', stage: 0, archetype: 'clinic', location: 'Watson', officers: [], till: 500,
  partners: [{ actorId: nova.id, status: 'active', units: 60, voting: true }, { actorId: rook.id, status: 'active', units: 40, voting: true }],
  staff: [], proposals: [],
  period: { index: 3, startDay: DAY - 6, endDay: DAY + 1, slots: [{ action: 'work', by: nova.id }], event: null },
  ...over,
});
const kinds = (list) => list.map((r) => r.kind).sort();

test('a deadline is due the day before and on the day, never after', () => {
  assert.equal(dueSoon(DAY + 1, DAY), true);
  assert.equal(dueSoon(DAY, DAY), true);
  assert.equal(dueSoon(DAY + 2, DAY), false, 'two days out is too soon');
  assert.equal(dueSoon(DAY - 1, DAY), false, 'past');
  assert.equal(dueSoon(null, DAY), false);
});

test('a vote closing tomorrow reminds only the partners who have not cast it', () => {
  const b = shop({ proposals: [{ id: 'p1', kind: 'pay', by: nova.id, day: DAY - 6, expires: DAY + 1, votes: { [nova.id]: true } }], period: null });
  const [r] = businessReminders(b, DAY);
  assert.equal(r.kind, 'vote');
  assert.deepEqual(r.to, [rook.id]);
  assert.equal(r.key, 'vote:bus_shack:p1');
  assert.deepEqual(businessReminders(b, DAY - 1), [], 'not yet');
  b.proposals[0].votes[rook.id] = false;
  assert.deepEqual(businessReminders(b, DAY), [], 'everyone has voted');
});

test('the week closing tomorrow: unused slots, an unanswered story, a raise running out, and cash short of what is due', () => {
  const quiet = shop({ stage: 1, period: { index: 3, startDay: DAY - 6, endDay: DAY + 1, slots: [{ action: 'work' }, { action: 'promote' }], event: null } });
  assert.deepEqual(businessReminders(quiet, DAY), [], 'both slots used, nothing due');

  const b = shop({
    stage: 1, till: 100,
    period: { index: 4, startDay: DAY - 6, endDay: DAY + 1, slots: [], event: { kind: 'press', factionName: 'Network 54', factionId: 'fac_ara' } },
    staff: [{ id: 's1', name: 'Dex', source: 'recruit', post: 'floor', status: 'active', wage: 60, ask: { pct: 1.1, day: DAY - 20 } }],
    loans: [{ id: 'l1', kind: 'bank', principal: 1000, balance: 500, rate: 0.01, payment: 100, startedDay: 0, missed: 0 }],
  });
  const list = businessReminders(b, DAY);
  assert.deepEqual(kinds(list), ['cash', 'press', 'raise', 'slots']);
  const by = Object.fromEntries(list.map((r) => [r.kind, r]));
  assert.deepEqual(by.slots.data, { name: 'Ripper Shack', left: 2, slots: 2 });
  assert.deepEqual(by.press.from, { kind: 'outlet', name: 'Network 54', factionId: 'fac_ara' });
  assert.deepEqual(by.raise.from, { kind: 'staff', staffId: 's1' });
  assert.deepEqual(dueAtClose(b), { loans: 105, wages: 60, total: 165 });
  assert.equal(by.cash.data.total, 165);

  // Answered, not a month's end, and cash enough: none of those three.
  b.period.slots = [{ action: 'respond' }];
  b.period.index = 5;
  b.till = 1000;
  assert.deepEqual(kinds(businessReminders(b, DAY)), ['slots']);
});

test('a regulator\'s case, a charter\'s funding and a tender offer, each a day ahead', () => {
  const b = shop({
    period: null,
    regCase: { status: 'notice', reason: 'plant', openedDay: DAY - 13, endDay: DAY + 1 },
    charter: { status: 'funding', ticker: 'RIP', fundingEnds: DAY + 1, shortfall: 2000, escrow: {} },
    takeover: { status: 'open', bidderId: vex.id, bidderName: 'Vex', price: 12, shares: 50, openDay: DAY - 6, endDay: DAY + 1, tenders: { [nova.id]: 10 } },
  });
  const by = Object.fromEntries(businessReminders(b, DAY).map((r) => [r.kind, r]));
  assert.deepEqual(Object.keys(by).sort(), ['case', 'charter', 'takeover']);
  assert.deepEqual(by.case.from, { kind: 'regulator' });
  assert.deepEqual(by.takeover.to, [rook.id], 'not the holder who has tendered');
  assert.deepEqual(by.takeover.from, { kind: 'exchange' });
});

test('an NPC\'s company and a closed business remind nobody', () => {
  assert.deepEqual(businessReminders(shop({ npcRun: { ownerId: vex.id } }), DAY), []);
  assert.deepEqual(businessReminders(shop({ status: 'closed' }), DAY), []);
});

test('a syndicate\'s motion and a story about a character', () => {
  const s = { id: 'syn_1', name: 'Test', status: 'active', members: [{ actorId: nova.id, status: 'active', units: 10, role: 'officer' }, { actorId: rook.id, status: 'active', units: 5, role: 'member' }, { actorId: vex.id, status: 'active', units: 0, role: 'member' }], proposals: [{ id: 'p_x', kind: 'limit', ends: DAY + 1, votes: { [nova.id]: true } }] };
  const [r] = syndicateReminders(s, DAY);
  assert.equal(r.kind, 'syndicateVote');
  assert.deepEqual(r.to, [rook.id], 'a member with no units has no say');
  const stories = [
    { id: 'st1', actorId: nova.id, name: 'Nova', status: 'open', deadline: DAY + 1, outlet: 'Network 54' },
    { id: 'st2', actorId: rook.id, name: 'Rook', status: 'open', deadline: DAY + 1, outlet: 'Network 54', answer: 'solid' },
    { id: 'st3', actorId: vex.id, name: 'Vex', status: 'held', deadline: DAY + 1, outlet: 'Network 54' },
  ];
  assert.deepEqual(storyReminders(stories, DAY).map((x) => x.to), [[nova.id]]);
});

test('what was sent is forgotten only long after', () => {
  assert.deepEqual(pruneSent({ a: DAY - 10, b: DAY - 61 }, DAY), { a: DAY - 10 });
});

test('the weekly mail\'s waiting list is the character\'s own', () => {
  const b = shop({
    proposals: [{ id: 'p1', kind: 'pay', votes: { [nova.id]: true } }],
    staff: [{ id: 's1', name: 'Dex', status: 'active', ask: { pct: 1.1, day: 1 } }],
    candidates: [{ id: 'c1' }, { id: 'c2' }],
  });
  assert.deepEqual(waitingFor(b, [nova.id]), { votes: 0, raises: ['Dex'], applicants: 2, regCase: false });
  assert.equal(waitingFor(b, [rook.id]).votes, 1);
});

test('an advert: a new storefront, or a strong Promote, at most once in four weeks', () => {
  const strong = [{ actions: [{ action: 'promote', band: 'strong' }] }];
  const narrow = [{ actions: [{ action: 'promote', band: 'narrow' }] }];
  assert.equal(adReason(shop(), strong, {}, DAY), 'promote');
  assert.equal(adReason(shop(), narrow, {}, DAY), null);
  assert.equal(adReason(shop(), strong, { lastDay: DAY - AD_GAP_DAYS + 1 }, DAY), null, 'too soon');
  assert.equal(adReason(shop(), strong, { lastDay: DAY - AD_GAP_DAYS }, DAY), 'promote');
  const front = shop({ upgrades: { storefront: [0] } });
  assert.equal(adReason(front, [], {}, DAY), 'storefront');
  assert.equal(adReason(front, [], { storefronts: [0] }, DAY), null, 'announced once a stage');
  assert.equal(adReason(shop({ npcRun: { ownerId: vex.id } }), strong, {}, DAY), null);
});

test('the Notifications choices: the weekly mail is opt-in, reminders and adverts are on', () => {
  const prefs = normalizeNotify({});
  assert.equal(prefs.business, 'off');
  assert.equal(prefs.reminders, 'mail');
  assert.equal(prefs.junk, 'mail');
  for (const key of NOTIFY_CATEGORIES) assert.equal(typeof lookup(`NCI.Notify.Category.${key}`), 'string', key);
});

test('every reminder kind has its words', () => {
  for (const kind of ['vote', 'syndicateVote', 'press', 'characterPress', 'case', 'slots', 'raise', 'charter', 'takeover', 'cash']) {
    for (const part of ['Subject', 'Line', 'Footer']) assert.equal(typeof lookup(`NCI.Remind.${part}.${kind}`), 'string', `${part}.${kind}`);
  }
  for (let n = 1; n <= 4; n++) for (const part of ['Subject', 'Line']) assert.equal(typeof lookup(`NCI.Ads.${part}.${n}`), 'string');
});

test('the service: a reminder goes once, from the business, by each character\'s choice', async () => {
  sent.length = 0;
  ReminderService.day = () => DAY;
  await BusinessRepository.save(shop({ stage: 1, period: { index: 3, startDay: DAY - 6, endDay: DAY + 1, slots: [], event: null } }));
  await rook.setFlag(MODULE_ID, FLAGS.PREFS, { notify: { reminders: 'off' } });
  assert.equal(await ReminderService.onTick(), 1, 'Rook turned them off');
  assert.equal(sent.length, 1);
  assert.equal(sent[0].toActorId, nova.id);
  assert.equal(sent[0].fromContactId, contacts.find((c) => c.name === 'Ripper Shack').id);
  assert.match(sent[0].subject, /Ripper Shack: the week closes tomorrow/);
  assert.match(sent[0].body, /2 of 2 action slots/);
  assert.equal(await ReminderService.onTick(), 0, 'not twice');
  assert.equal(sent.length, 1);
});

test('the service: the week by mail for those who asked, and an advert to everyone else', async () => {
  sent.length = 0;
  ReminderService.day = () => DAY;
  await nova.setFlag(MODULE_ID, FLAGS.PREFS, { notify: { business: 'mail' } });
  const b = shop({ id: 'bus_ad', name: 'Ad Shack' });
  const digest = { index: 3, startDay: DAY - 7, endDay: DAY, takings: 900, upkeep: 300, profit: 600, till: 1500, actions: [{ action: 'promote', band: 'exceptional' }], event: { kind: 'inspection' } };
  await ReminderService.afterCommit(b, [{ type: 'periodClosed', digest }]);
  const week = sent.filter((m) => /the week to/.test(m.subject));
  assert.deepEqual(week.map((m) => m.toActorId), [nova.id], 'only the runner who asked');
  assert.match(week[0].body, /Takings 900 eb, upkeep 300 eb: a profit of 600 eb\. Cash now 1,500 eb\./);
  assert.match(week[0].body, /Nothing is waiting on you/);
  const ads = sent.filter((m) => !/the week to/.test(m.subject));
  assert.deepEqual(ads.map((m) => m.toActorId), [vex.id], 'not those who run it');
  assert.match(ads[0].body, /Watson/);
  sent.length = 0;
  await ReminderService.afterCommit(b, [{ type: 'periodClosed', digest }]);
  assert.equal(sent.filter((m) => !/the week to/.test(m.subject)).length, 0, 'one advert in four weeks');
});
