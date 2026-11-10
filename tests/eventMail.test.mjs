import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import { eventSender, takeEventMail, eventIsRoom, normalizeBusiness } from '../scripts/engine/index.js';

const env = installFakeFoundry({ actors: [['Nova', 100, true], ['Rook', 50, true]] });
const [nova, rook] = env.actors;
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), lang);
game.i18n.localize = (key) => {
  const value = lookup(key);
  if (typeof value !== 'string') throw new Error(`Missing language key: ${key}`);
  return value;
};
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m));

// A Messenger with a directory, mail and the public API's push.
const contacts = [];
const sent = [];
const pushed = [];
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
const api = { v2: { directory: { pushToPlayer: async (c, a) => { pushed.push([c, a]); return { ok: true, data: {} }; } } } };
const realGet = game.modules.get;
game.modules.get = (id) => (id === 'night-city-messenger' ? { active: true, api } : realGet(id));

const { MODULE_ID, SETTINGS } = await import('../scripts/utils/constants.js');
let BusinessService;
let ContactService;
before(async () => {
  ({ BusinessService } = await import('../scripts/services/BusinessService.js'));
  ({ ContactService } = await import('../scripts/services/ContactService.js'));
  await game.settings.set(MODULE_ID, SETTINGS.FACTION_DEFS, {
    fac_claws: { id: 'fac_claws', name: 'Tyger Claws', kind: 'gang' },
    fac_ara: { id: 'fac_ara', name: 'Arasaka', kind: 'corp', ticker: 'ARA' },
  });
});

const shop = (over = {}) => ({
  id: 'bus_shack', name: 'Ripper Shack', stage: 0, officers: [],
  partners: [{ actorId: nova.id, status: 'active', units: 10 }, { actorId: rook.id, status: 'invited', units: 0 }],
  staff: [{ id: 'stf_r1', name: 'Dex', source: 'recruit', post: 'floor', status: 'active' }],
  ...over,
});
const reset = () => { sent.length = 0; pushed.length = 0; };

test('who an event comes from: a faction, the paper, the city, NCPD, the collectors, the staff, or nobody', () => {
  const b = shop({ backRoom: { factionId: 'fac_claws' } });
  assert.deepEqual(eventSender(b, { kind: 'shakedown', factionId: 'fac_claws' }), { kind: 'faction', factionId: 'fac_claws' });
  assert.equal(eventSender(b, { kind: 'shakedown' }), null, 'a shakedown with no gang named has nobody to write');
  assert.deepEqual(eventSender(b, { kind: 'press', factionId: 'fac_ara', factionName: 'Network 54' }), { kind: 'outlet', name: 'Network 54', factionId: 'fac_ara' });
  assert.deepEqual(eventSender(b, { kind: 'raid', factionId: 'fac_ara' }), { kind: 'city' }, 'a faction\'s raid is the inspectors it tipped off');
  assert.deepEqual(eventSender(b, { kind: 'inspection' }), { kind: 'city' });
  assert.deepEqual(eventSender(b, { kind: 'bust' }), { kind: 'ncpd' });
  assert.deepEqual(eventSender(b, { kind: 'collectors' }), { kind: 'collectors' });
  assert.deepEqual(eventSender(b, { kind: 'grudge', formerStaffId: 'stf_r1' }), { kind: 'formerStaff', staffId: 'stf_r1' });
  assert.equal(eventSender(b, { kind: 'grudge' }), null);
  assert.deepEqual(eventSender(b, { kind: 'roomFavour' }), { kind: 'faction', factionId: 'fac_claws' });
  assert.deepEqual(eventSender(b, { kind: 'poaching', staffId: 'stf_r1', factionId: 'fac_ara' }), { kind: 'staff', staffId: 'stf_r1' }, 'the employee tells you of the offer');
  for (const kind of ['breakdown', 'shortage', 'windfall', 'theft', 'lightFingers', 'talkingShop', 'starTurn', 'roomNoise']) assert.equal(eventSender(b, { kind, staffId: 'stf_r1' }), null, kind);
  assert.equal(eventIsRoom({ kind: 'bust' }), true);
  assert.equal(eventIsRoom({ kind: 'roomFavour' }), true);
  assert.equal(eventIsRoom({ kind: 'shakedown' }), false);
});

test('the week\'s event is taken to mail once, and never at an NPC\'s company', () => {
  const b = shop({ period: { event: { kind: 'inspection' } } });
  assert.equal(takeEventMail(b).sender.kind, 'city');
  assert.equal(takeEventMail(b), null, 'once only');
  const quiet = shop({ period: { event: { kind: 'breakdown' } } });
  assert.equal(takeEventMail(quiet), null);
  assert.equal(quiet.period.event.mailed, true, 'and not looked at again');
  assert.equal(takeEventMail(shop({ npcRun: { ownerId: rook.id }, period: { event: { kind: 'inspection' } } })), null);
  assert.equal(takeEventMail(shop({ period: { event: null } })), null);
});

test('a gang\'s shakedown comes from its own contact, made once, to the partners, who are given it once', async () => {
  reset();
  const b = shop({ period: { event: { kind: 'shakedown', factionId: 'fac_claws', factionName: 'Tyger Claws' } } });
  await BusinessService._mailEvent(b, takeEventMail(b));
  const claws = contacts.find((c) => c.name === 'Tyger Claws');
  assert.ok(claws, 'a contact made for the gang');
  assert.ok(claws.tags.includes('nci-sender'));
  assert.equal(claws.folder, 'Night City Investments');
  assert.equal(sent.length, 1, 'only the active partner');
  assert.equal(sent[0].fromContactId, claws.id);
  assert.equal(sent[0].toActorId, nova.id);
  assert.equal(sent[0].subject, 'Ripper Shack: A shakedown'.replace('A shakedown', lookup('NCI.Event.shakedown.Name')));
  assert.match(sent[0].body, /our cut this week/);
  assert.match(sent[0].body, /Work tab/);
  assert.deepEqual(pushed, [[claws.id, nova.id]]);

  reset();
  const again = shop({ period: { event: { kind: 'smear', factionId: 'fac_claws' } } });
  await BusinessService._mailEvent(again, takeEventMail(again));
  assert.equal(contacts.filter((c) => c.name === 'Tyger Claws').length, 1, 'the same contact next time');
  assert.equal(sent.length, 1);
  assert.deepEqual(pushed, [], 'already given');
});

test('at a company the officers hear of it, and a staff event comes from the employee', async () => {
  reset();
  const b = shop({ stage: 2, partners: [{ actorId: nova.id, status: 'active', units: 60 }, { actorId: rook.id, status: 'active', units: 40 }], officers: [rook.id], period: { event: { kind: 'sickDay', staffId: 'stf_r1' } } });
  await BusinessService._mailEvent(b, takeEventMail(b));
  const dex = contacts.find((c) => c.name === 'Dex');
  assert.ok(dex, 'a recruit gets a contact');
  assert.deepEqual(sent.map((m) => [m.fromContactId, m.toActorId]), [[dex.id, rook.id]], 'the officer, not the shareholder');
  assert.match(sent[0].body, /not well enough/);
});

test('a grudge comes from the employee who was let go, if they had a contact', async () => {
  const kept = normalizeBusiness({ ...shop(), grudge: true, grudgeFrom: 'stf_r1' });
  assert.equal(kept.grudgeFrom, 'stf_r1');
  assert.equal(normalizeBusiness({ ...shop(), grudge: false, grudgeFrom: 'stf_r1' }).grudgeFrom, undefined);
  reset();
  const b = shop({ staff: [], period: { event: { kind: 'grudge', formerStaffId: 'stf_r1' } } });
  await BusinessService._mailEvent(b, takeEventMail(b));
  assert.equal(sent[0].fromContactId, contacts.find((c) => c.name === 'Dex').id);
  reset();
  const stranger = shop({ staff: [], period: { event: { kind: 'grudge', formerStaffId: 'stf_nobody' } } });
  await BusinessService._mailEvent(stranger, takeEventMail(stranger));
  assert.equal(sent.length, 0);
});

test('a story comes from the paper\'s news desk, or the faction when the faction prints it', async () => {
  const desk = await ContactService.outlet('Network 54', 'fac_ara');
  assert.equal(contacts.find((c) => c.id === desk).name, 'Network 54 News Desk');
  const own = await ContactService.outlet('Arasaka', 'fac_ara');
  assert.equal(contacts.find((c) => c.id === own).name, 'Arasaka');
});

test('a faction the GM linked to a contact sends from it', async () => {
  const mine = (await game.nightcity.masterContactService.addContact({ name: 'Jotaro' })).contact;
  await ContactService.link('faction:fac_claws', mine.id);
  assert.equal(await ContactService.faction('fac_claws'), mine.id);
  await ContactService.link('faction:fac_claws', null);
  assert.notEqual(await ContactService.faction('fac_claws'), mine.id, 'cleared, the next mail makes one');
});

test('the staff go into the contacts of those running the business', async () => {
  reset();
  const b = shop({ staff: [
    { id: 'stf_r2', name: 'Mox', source: 'recruit', post: 'security', status: 'active' },
    { id: 'stf_pc', name: 'Rook', actorId: rook.id, source: 'pc', post: 'floor', status: 'active' },
  ] });
  await BusinessService._shareStaff(b);
  const mox = contacts.find((c) => c.name === 'Mox');
  assert.deepEqual(pushed, [[mox.id, nova.id]], 'a player character on the staff is not a contact');
  reset();
  await BusinessService._shareStaff(b);
  assert.deepEqual(pushed, [], 'once');
});

test('job mail comes from the employer: a corporation\'s HR, an NPC company\'s owner, or the wire at a player\'s business', async () => {
  reset();
  await BusinessService._mailJob({ id: 'emp_bio', name: 'Biotechnica', ticker: 'BIO' }, nova.id, 'Your job', ['Hello']);
  const hr = contacts.find((c) => c.name === 'Biotechnica Human Resources');
  assert.ok(hr);
  assert.equal(hr.email, 'hr@bio.corp');
  assert.equal(sent[0].fromContactId, hr.id);
  await BusinessService._mailJob({ id: 'bus_clinic', name: 'Clinic', npcRun: { ownerId: rook.id } }, nova.id, 'Your job', ['Hello']);
  const owner = contacts.find((c) => c.actorId === rook.id);
  assert.equal(owner.name, 'Rook');
  assert.equal(sent[1].fromContactId, owner.id);
  await BusinessService._mailJob(shop(), nova.id, 'Your job', ['Hello']);
  assert.equal(contacts.find((c) => c.id === sent[2].fromContactId).name, 'Night City Market Wire');

  reset();
  await BusinessService._shareEmployer({ id: 'bus_clinic', name: 'Clinic', npcRun: { ownerId: rook.id }, staff: [{ id: 'stf_n', actorId: nova.id, source: 'pc', status: 'offered' }] });
  assert.deepEqual(pushed, [[owner.id, nova.id]], 'an offer brings the employer too');
});

test('with sharing off nobody is given a contact, but the mail still comes', async () => {
  await game.settings.set(MODULE_ID, SETTINGS.SHARE_CONTACTS, false);
  try {
    reset();
    const b = shop({ period: { event: { kind: 'collectors' } } });
    await BusinessService._mailEvent(b, takeEventMail(b));
    assert.equal(sent.length, 1);
    assert.equal(contacts.find((c) => c.id === sent[0].fromContactId).name, 'Collections');
    assert.deepEqual(pushed, []);
  } finally {
    await game.settings.set(MODULE_ID, SETTINGS.SHARE_CONTACTS, true);
  }
});

test('without Messenger nothing is made or sent, and nothing breaks', async () => {
  const saved = game.nightcity;
  game.nightcity = undefined;
  try {
    reset();
    const b = shop({ period: { event: { kind: 'shakedown', factionId: 'fac_ara' } } });
    await BusinessService._mailEvent(b, takeEventMail(b));
    assert.equal(sent.length, 0);
  } finally {
    game.nightcity = saved;
  }
});

// ── M3 step 1: the right sender, and the rules' part apart ──────────────────────

test('the rules\' part of a mail comes after the sender\'s words, in italics', async () => {
  const { html } = await import('../scripts/services/MailService.js');
  assert.equal(html(['Hello', '', 'There'], 'Do this'), '<p>Hello</p><p>There</p><p><em>▸ Do this</em></p>');
  assert.equal(html(['Hello']), '<p>Hello</p>');
});

test('a regulator\'s case comes from the Business Regulation Office, with what to do apart', async () => {
  reset();
  await BusinessService._mailCaseOpened(shop({ regCase: { endDay: 20000, reason: 'report' } }));
  const office = contacts.find((c) => c.name === 'Business Regulation Office');
  assert.ok(office);
  assert.equal(sent[0].fromContactId, office.id);
  assert.match(sent[0].body, /^<p>We have opened a case against Ripper Shack/);
  assert.match(sent[0].body, /<em>▸ An officer answers from the Business window/);
});

test('a source is masked, and the GM keeps the contact to answer as', async () => {
  reset();
  await BusinessService._mailFrom(nova, { subject: 'Rumour', lines: ['Word is'], ...(await BusinessService._fromSource()) });
  const source = contacts.find((c) => c.name === 'A source');
  assert.equal(sent[0].fromContactId, source.id);
  assert.deepEqual(sent[0].anonymous, { enabled: true, traceable: false, alias: 'A friend' });
});

test('a mail its sender can\'t send goes by the market wire instead', async () => {
  reset();
  const send = game.nightcity.messageService.sendMessage;
  game.nightcity.messageService.sendMessage = async (m) => (m.fromContactId === 'c_gone' ? { success: false, error: 'no' } : send(m));
  try {
    await BusinessService._mailAccount(nova.id, 'Notice', ['Line'], { from: 'c_gone', footer: 'Rule' });
  } finally {
    game.nightcity.messageService.sendMessage = send;
  }
  assert.equal(sent.length, 1);
  assert.equal(contacts.find((c) => c.id === sent[0].fromContactId).name, 'Night City Market Wire');
  assert.match(sent[0].body, /▸ Rule/);
});

test('the new senders are made once each, and a raid on a back room comes from Vice', async () => {
  const ids = [await ContactService.exchange(), await ContactService.court(), await ContactService.vice(), await ContactService.editor()];
  assert.deepEqual(ids.map((id) => contacts.find((c) => c.id === id).name), ['Night City Exchange', 'Night City Insolvency Court', 'NCPD Vice', 'The News Desk']);
  assert.equal(await ContactService.exchange(), ids[0]);
  assert.equal(await ContactService.forSender(shop(), { kind: 'ncpd' }), ids[2]);
  const shack = await ContactService.business(shop());
  assert.equal(contacts.find((c) => c.id === shack).name, 'Ripper Shack');
  const treasury = await ContactService.syndicate({ id: 'syn_1', name: 'The Crew' });
  assert.equal(contacts.find((c) => c.id === treasury).name, 'The Crew Treasury');
});

test('every wording a service asks for by name is in the language file', async () => {
  const { readdirSync } = await import('node:fs');
  const dir = new URL('../scripts/services/', import.meta.url);
  const missing = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.js'))) {
    const src = readFileSync(new URL(file, dir), 'utf8');
    for (const [, key] of src.matchAll(/L\('(NCI\.[A-Za-z0-9.]+)'/g)) if (typeof lookup(key) !== 'string') missing.push(`${file}: ${key}`);
  }
  assert.deepEqual(missing, []);
});
