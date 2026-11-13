import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installFakeFoundry } from './helpers/fakeFoundry.mjs';
import {
  advanceBusiness, drawPress, gangTruths, gangPressChance, pressChance, placePress, pressFallout, keepAwayCut, roomBust, eventUses, rollSpec,
  drawCharacterPress, settleCharacterPress, normalizeBusiness, normalizeFaction, GANG_STYLES, BUSINESS_DEFAULTS, createRng,
} from '../scripts/engine/index.js';
import { OUTLET_VOICES } from '../scripts/data/org-voices/outlets.js';

const env = installFakeFoundry({ actors: [['Nova', 100, true], ['Rook', 50, true]] });
const [nova] = env.actors;
const lang = JSON.parse(readFileSync(new URL('../lang/en.json', import.meta.url), 'utf8'));
const lookup = (key) => key.split('.').reduce((o, k) => (o ? o[k] : undefined), lang);
game.i18n.localize = (key) => {
  const value = lookup(key);
  if (typeof value !== 'string') throw new Error(`Missing language key: ${key}`);
  return value;
};
game.i18n.format = (key, data = {}) => game.i18n.localize(key).replace(/\{(\w+)\}/g, (m, name) => (name in data ? data[name] : m));

// A Messenger with a directory and mail, for the event's sender.
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
    getByActorId: () => null,
    getAll: () => contacts,
    filterByTag: (tag) => contacts.filter((c) => (c.tags ?? []).includes(tag)),
  },
  messageService: { sendMessage: async (m) => { sent.push(m); return { success: true, messageId: `m${sent.length}` }; } },
};
const realGet = game.modules.get;
game.modules.get = (id) => (id === 'night-city-messenger' ? { active: true, api: { v2: { directory: { pushToPlayer: async () => ({ ok: true, data: {} }) } } } } : realGet(id));

let BusinessService;
let OrgMail;
let takeEventMail;
before(async () => {
  ({ BusinessService } = await import('../scripts/services/BusinessService.js'));
  ({ OrgMail } = await import('../scripts/services/OrgMail.js'));
  ({ takeEventMail } = await import('../scripts/engine/index.js'));
});

const p = BUSINESS_DEFAULTS;
const shop = (over = {}) => normalizeBusiness({
  id: 'bus_g', name: 'Glitch Bar', status: 'open', stage: 0, archetype: 'bar', district: 'watson', till: 500, officers: [],
  partners: [{ actorId: nova.id, status: 'active', units: 10, voting: true }],
  state: { capacity: 1, reputation: 60, costFactor: 1 },
  digests: [{ index: 1, profit: 100 }, { index: 2, profit: 50 }],
  period: { index: 3, startDay: 700, endDay: 707, slots: [], event: null },
  ...over,
});
const claws = (value, over = {}) => ({ id: 'fac_claws', name: 'Tyger Claws', value, turf: true, outlet: 'Tyger Claws Street Sheet', media: null, ...over });
const relations = (gangs, over = {}) => ({ exposure: 20, press: { frequency: 1, approval: true, underworld: true, corps: [], media: [], gangs, ...over } });

/** Draw over many weeks, for what a gang can print. */
const drawMany = (b, rel, weeks = 400) => {
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const copy = structuredClone(b);
    copy.period.index = i;
    const e = drawPress(copy, `seed${i}`, p, rel);
    if (e) out.push(e);
  }
  return out;
};

test('what a gang can put about: a turf warning when hostile, and a tip to Vice about a back room', () => {
  const b = shop();
  assert.deepEqual(gangTruths(b, claws(-30), ['money']), ['money'], 'wary: only what is true');
  assert.deepEqual(gangTruths(b, claws(-80), []), ['keepAway']);
  const room = shop({ backRoom: { status: 'open', kind: 'gambling', dirty: 0 } });
  assert.deepEqual(gangTruths(room, claws(-80), [], { exposure: 10 }), ['keepAway', 'snitch']);
  assert.deepEqual(gangTruths(room, claws(-80), [], { exposure: 2 }), ['keepAway'], 'clean Exposure: nothing to tip off');
  assert.deepEqual(gangTruths(room, claws(-80), [], { exposure: 10, underworld: false }), ['keepAway'], 'no underworld in this world');
});

test('a wary gang draws at half a corporation\'s chance; a hostile one as a hostile corporation', () => {
  assert.equal(gangPressChance(-30, true), pressChance(-30, true) * p.press.gang.share);
  assert.equal(gangPressChance(-90, true), pressChance(-90, true));
});

test('a hostile gang on the turf prints through its street paper, or a media company it uses', () => {
  const b = shop({ backRoom: { status: 'open', kind: 'gambling', dirty: 0 } });
  const drawn = drawMany(b, relations([claws(-90, { media: 'Network 54' })]));
  assert.ok(drawn.length > 20, `drawn ${drawn.length}`);
  for (const e of drawn) {
    assert.equal(e.gang, true);
    assert.equal(e.grudge, 'Tyger Claws');
    if (e.street) {
      assert.equal(e.rank, 3);
      assert.equal(e.factionName, 'Tyger Claws Street Sheet');
    } else {
      assert.equal(e.factionName, 'Network 54');
      assert.equal(e.rank, p.press.rank.media);
      assert.ok(!['keepAway', 'snitch'].includes(e.story), 'a turf warning and a tip stay on the street');
    }
  }
  const kinds = new Set(drawn.map((e) => e.story));
  for (const k of ['keepAway', 'snitch', 'smear']) assert.ok(kinds.has(k), k);
  assert.deepEqual(drawMany(b, relations([claws(-90, { turf: false })])), [], 'off its turf, nothing');
});

test('the worse of a corporation and a gang draws; with no gangs, corporations draw as before', () => {
  const b = shop();
  const corps = [{ id: 'fac_ara', name: 'Arasaka', value: -90 }];
  const before = drawMany(b, relations([], { corps }));
  const withFriendly = drawMany(shop({ state: { capacity: 1, reputation: 20, costFactor: 1 } }), relations([claws(30)], { corps }));
  assert.ok(before.length > 0);
  assert.ok(before.every((e) => !e.gang));
  assert.ok(withFriendly.every((e) => !e.gang), 'a friendly gang is not the worse');
  const gangWorse = drawMany(b, relations([claws(-95)], { corps }));
  assert.ok(gangWorse.every((e) => e.gang));
});

test('good word: an allied gang for a business doing well, never held for the GM, and never for one doing badly', () => {
  const drawn = drawMany(shop(), relations([claws(80)]), 600);
  assert.ok(drawn.length > 5 && drawn.length < 60, `drawn ${drawn.length}`);
  assert.ok(drawn.every((e) => e.story === 'friendly' && e.allied && e.force && e.street));
  assert.deepEqual(drawMany(shop({ state: { capacity: 1, reputation: 40, costFactor: 1 } }), relations([claws(80)]), 300), [], 'Reputation too low');
  assert.deepEqual(drawMany(shop({ digests: [{ index: 1, profit: -100 }] }), relations([claws(80)]), 300), [], 'losing money');
  const b = shop();
  placePress(b, drawn[0], true);
  assert.equal(b.period.event.story, 'friendly', 'straight to the week, approval or not');
  assert.equal(b.press.held, null);
});

test('what lands: smaller hits from the street, a turf warning on the takings, a tip on the raid, good word on Reputation', () => {
  const settle = (story, outcome = 'unanswered', over = {}) => {
    const b = shop({ backRoom: { status: 'open', kind: 'gambling', dirty: 0 }, listing: null });
    b.period.event = { kind: 'press', story, gang: true, street: true, believed: true, percent: -4, factionName: 'Tyger Claws Street Sheet', rank: 3, ...over };
    const [r] = pressFallout(b, { outcome }, p);
    return { b, r };
  };
  const smear = settle('smear');
  assert.equal(smear.b.state.reputation, 58);
  assert.equal(smear.r.percent, -1, 'a street paper moves a price by 1% at most');
  assert.equal(settle('crime').r.percent, -1);
  assert.equal(settle('crime').r.regCase, false, 'rank 3 opens no case');
  const away = settle('keepAway');
  assert.deepEqual(away.b.keepAway, { cut: 0.1, from: 4, until: 5 });
  assert.equal(settle('keepAway', 'failed').b.keepAway.cut, 0.05);
  assert.equal(settle('keepAway', 'answered').b.keepAway, null);
  assert.equal(settle('snitch').b.backRoom.tipped, 4);
  assert.equal(settle('snitch', 'answered').b.backRoom.tipped, undefined);
  assert.equal(settle('friendly').b.state.reputation, 62);
  assert.equal(settle('friendly', 'unanswered', { allied: true }).b.state.reputation, 63);
});

test('a turf warning cuts the takings for its weeks only', () => {
  const b = shop({ keepAway: { cut: 0.1, from: 4, until: 5 } });
  assert.equal(normalizeBusiness(b).keepAway.cut, 0.1, 'kept on the record');
  for (const [index, cut] of [[3, 0], [4, 0.1], [5, 0.1], [6, 0]]) {
    b.period.index = index;
    assert.equal(keepAwayCut(b), cut, `week ${index}`);
  }
});

test('a closing week under a turf warning takes 10% less', () => {
  const close = (keepAway) => {
    const b = shop({ keepAway, period: { index: 4, startDay: 700, endDay: 707, slots: [], event: null } });
    return advanceBusiness(b, 707, { weekday: () => false, seed: 'same' }).business.digests.at(-1);
  };
  const plain = close(null);
  const warned = close({ cut: 0.1, from: 4, until: 5 });
  assert.equal(warned.gross, Math.round(plain.gross * 0.9));
});

test('a tip doubles next week\'s raid chance, and the raid says it came from one', () => {
  const count = (tipped) => {
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const b = shop({ backRoom: { status: 'open', kind: 'gambling', dirty: 0, ...(tipped ? { tipped: i } : {}) } });
      b.period.index = i;
      const e = roomBust(b, `s${i}`, p, { exposure: 20 });
      if (e) {
        n++;
        assert.equal(!!e.tipped, tipped);
      }
    }
    return n;
  };
  const plain = count(false);
  const tipped = count(true);
  assert.ok(tipped > plain * 1.5, `${plain} then ${tipped}`);
});

test('answering: a turf warning can be faced down, a tip is answered on the street, good word needs nothing', () => {
  const names = (b) => eventUses(b, 'press').map((u) => u.skill ?? u.ability);
  const away = shop({ period: { index: 3, startDay: 700, endDay: 707, slots: [], event: { kind: 'press', story: 'keepAway' } } });
  for (const n of ['Persuasion', 'Brawling', 'Tactics', 'Backup']) assert.ok(names(away).includes(n), n);
  const tip = shop({ period: { index: 3, startDay: 700, endDay: 707, slots: [], event: { kind: 'press', story: 'snitch' } } });
  assert.deepEqual(names(tip).sort(), ['Backup', 'Bribery', 'Persuasion', 'Streetwise']);
  const good = shop({ period: { index: 3, startDay: 700, endDay: 707, slots: [], event: { kind: 'press', story: 'friendly' } } });
  assert.equal(rollSpec(good, { type: 'respond', use: { kind: 'skill', skill: 'Persuasion' } }, nova.id, { day: 701 }).reason, 'nothing-to-answer');
});

test('a gang\'s story about a character: its street paper, at half the heat', () => {
  const rng = createRng('x');
  const story = drawCharacterPress({ id: 's1', actorId: nova.id, name: 'Nova', day: 1, truths: ['dirty'], worst: { id: 'fac_claws', name: 'Tyger Claws', value: -90, gang: true, outlet: 'Tyger Claws Street Sheet' }, media: [{ name: 'Network 54' }], rng });
  assert.equal(story.outlet, 'Tyger Claws Street Sheet');
  assert.equal(story.rank, 3);
  assert.equal(story.gang, true);
  const corp = { ...story, gang: false, believed: true, story: 'dirty' };
  assert.equal(settleCharacterPress({ ...story, believed: true, story: 'dirty' }).heat, settleCharacterPress(corp).heat / 2);
});

test('a gang keeps its street paper\'s name and media company; each voice names a paper', () => {
  const f = normalizeFaction({ id: 'g', name: 'Maelstrom', kind: 'gang', paper: 'Chrome Dispatch', media: 'n54' });
  assert.equal(f.paper, 'Chrome Dispatch');
  assert.equal(f.media, 'N54');
  assert.equal(normalizeFaction({ id: 'g', name: 'Maelstrom', kind: 'gang' }).paper, undefined);
  for (const style of GANG_STYLES) assert.match(lookup(`NCI.Press.Street.${style}`), /\{gang\}/, style);
  assert.equal(OrgMail.paperOf({ id: 'g', name: 'Maelstrom', kind: 'gang', voice: 'chrome' }), 'Maelstrom Pirate Feed');
  assert.equal(OrgMail.paperOf(f), 'Chrome Dispatch');
});

test('every gang kind has its words, and the street paper its own voice', () => {
  for (const kind of ['keepAway', 'snitch', 'friendly']) {
    for (const part of ['Story', 'Angle', 'Headline', 'Why', 'Name', 'IfNot']) assert.equal(typeof lookup(`NCI.Press.${part}.${kind}`), 'string', `${part}.${kind}`);
  }
  for (const kind of ['pressAsk', 'keepAwayAsk', 'friendlyNote', 'resultIgnored', 'resultAnswered', 'resultHalved', 'resultFull', 'charTold']) {
    assert.ok(OUTLET_VOICES.street[kind]?.lines?.length >= 3, kind);
  }
});

test('the mail: a tip comes from a masked source, a turf warning from the street paper itself', async () => {
  sent.length = 0;
  const tip = shop({ period: { index: 3, startDay: 700, endDay: 707, slots: [], event: { kind: 'press', story: 'snitch', gang: true, street: true, grudge: 'Tyger Claws', factionName: 'Tyger Claws Street Sheet' } } });
  await BusinessService._mailEvent(tip, takeEventMail(tip));
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].anonymous, { enabled: true, traceable: false, alias: 'A friend' });
  assert.match(sent[0].body, /Tyger Claws has been talking to NCPD Vice about Glitch Bar/);

  sent.length = 0;
  const away = shop({ period: { index: 3, startDay: 700, endDay: 707, slots: [], event: { kind: 'press', story: 'keepAway', gang: true, street: true, grudge: 'Tyger Claws', factionId: 'fac_claws', factionName: 'Tyger Claws Street Sheet' } } });
  await BusinessService._mailEvent(away, takeEventMail(away));
  const paper = contacts.find((c) => c.name === 'Tyger Claws Street Sheet');
  assert.ok(paper, 'the street paper is a contact of its own');
  assert.equal(sent[0].fromContactId, paper.id);
  assert.match(sent[0].body, /stay away|off-limits|go to Glitch Bar/i);
});
