import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orgMail, factionStyle, outletStyle, isRepeat, eventTones, refNumber, stylesFor, exchangeTones, motionTones, voteTones, GANG_STYLES, CORP_STYLES, OUTLET_STYLES } from '../scripts/engine/index.js';
import { STARTER_GANGS } from '../scripts/data/starter-factions.js';
import { GANG_VOICES } from '../scripts/data/org-voices/gangs.js';
import { CORP_VOICES } from '../scripts/data/org-voices/corps.js';
import { OUTLET_VOICES } from '../scripts/data/org-voices/outlets.js';
import { OFFICIALS } from '../scripts/data/org-voices/officials.js';
import { TREASURY } from '../scripts/data/org-voices/treasury.js';
import { NEWSWIRE } from '../scripts/data/org-voices/newswire.js';

const first = () => 0;

test('a faction\'s style: the GM\'s pick, else a starter gang\'s default, else by sector', () => {
  assert.equal(factionStyle({ id: 'gang_tyger', kind: 'gang' }), 'formal');
  assert.equal(factionStyle({ id: 'gang_maelstrom', kind: 'gang' }), 'chrome');
  assert.equal(factionStyle({ id: 'gang_new', kind: 'gang' }), 'street', 'a gang of your own');
  assert.equal(factionStyle({ id: 'gang_tyger', kind: 'gang', voice: 'cryptic' }), 'cryptic');
  assert.equal(factionStyle({ id: 'gang_tyger', kind: 'gang', voice: 'wellness' }), 'formal', 'not a gang style');
  assert.equal(factionStyle({ id: 'corp_ara', kind: 'corp', ticker: 'ARA' }, 'security'), 'formal');
  assert.equal(factionStyle({ id: 'corp_mil', kind: 'corp', ticker: 'MIL' }, 'arms'), 'militarist');
  assert.equal(factionStyle({ id: 'corp_bio', kind: 'corp', ticker: 'BIO' }, 'biotech'), 'wellness');
  assert.equal(factionStyle({ id: 'corp_con', kind: 'corp', ticker: 'CON' }, 'consumer'), 'slick');
  assert.equal(factionStyle({ id: 'corp_zet', kind: 'corp', ticker: 'ZET' }, 'tech'), 'legal');
  assert.equal(outletStyle({ kind: 'corp', voice: 'tabloid' }), 'tabloid');
  assert.equal(outletStyle({ kind: 'corp', ticker: 'MIL' }, 'arms'), 'broadcast', 'a corporation printing its own story');
  for (const g of STARTER_GANGS) assert.ok(GANG_STYLES.includes(factionStyle(g)), g.id);
  assert.deepEqual(stylesFor('corp'), CORP_STYLES);
});

test('a repeat is the same move by the same faction within four weeks; tones go most specific first', () => {
  const b = { period: { index: 10 }, standings: { fac: 'hostile' }, digests: [{ index: 7, event: { kind: 'shakedown', faction: 'Claws' } }] };
  assert.equal(isRepeat(b, { kind: 'shakedown', factionName: 'Claws' }), true);
  assert.equal(isRepeat(b, { kind: 'sabotage', factionName: 'Claws' }), false);
  assert.equal(isRepeat(b, { kind: 'shakedown', factionName: 'Others' }), false);
  assert.equal(isRepeat({ ...b, period: { index: 12 } }, { kind: 'shakedown', factionName: 'Claws' }), false, 'too long ago');
  assert.deepEqual(eventTones(b, { kind: 'shakedown', factionName: 'Claws', factionId: 'fac', heavy: true }), ['heavy', 'repeat', 'hostile']);
  assert.deepEqual(eventTones({ ...b, standings: {} }, { kind: 'smear', factionName: 'Claws', factionId: 'fac' }), []);
});

test('the most specific tone with lines wins, framed by a greeting and a sign-off', () => {
  const voices = { s: { greetings: ['Hi.'], signoffs: ['Bye, {gang}.'], shakedown: { lines: ['Plain {name}.'], hostile: ['Angry {name}.'] }, more: { lines: ['And more.'] } } };
  const data = { name: 'Shack', gang: 'Claws' };
  assert.deepEqual(orgMail({ voices, style: 's', kind: 'shakedown', tones: ['heavy', 'hostile'], data, rng: first }).paragraphs, ['Hi.', 'Angry Shack.', 'Bye, Claws.']);
  assert.deepEqual(orgMail({ voices, style: 's', kind: 'shakedown', data, rng: first }).paragraphs, ['Hi.', 'Plain Shack.', 'Bye, Claws.']);
  assert.deepEqual(orgMail({ voices, style: 's', kind: 'shakedown', also: ['more'], data, rng: first }).paragraphs, ['Hi.', 'Plain Shack.', 'And more.', 'Bye, Claws.']);
  assert.equal(orgMail({ voices, style: 's', kind: 'nothing' }), null);
  assert.equal(orgMail({ voices, style: 'missing', fallback: 's', kind: 'shakedown', data, rng: first }).paragraphs[1], 'Plain Shack.');
});

test('an official sender\'s reference is the same for the same matter', () => {
  assert.equal(refNumber('regulator:bus_1'), refNumber('regulator:bus_1'));
  assert.match(refNumber('x'), /^\d{4}$/);
  const mail = orgMail({ voices: OFFICIALS, style: 'regulator', kind: 'fined', data: { name: 'Shack', fine: '500', ref: refNumber('regulator:bus_1') }, rng: first });
  assert.equal(mail.ref, `Case NC-REG-${refNumber('regulator:bus_1')}`);
  assert.match(mail.paragraphs.join(' '), /Shack.*500 eb/);
});

/** The tokens each kind of mail fills: a line naming anything else would show a gap. */
const TOKENS = {
  gang: ['name', 'gang'],
  outlet: ['name', 'outlet', 'days'],
  exchange: { review: ['name', 'ticker', 'value', 'floor', 'n'], delisted: ['name', 'ticker'], open: ['name', 'ticker', 'bidder', 'price', 'shares', 'premium', 'date'], approved: ['name', 'ticker', 'bidder', 'price', 'shares', 'premium', 'date', 'escrow'], unfunded: ['name', 'escrow'], rejected: ['name'], closed: ['name', 'ticker', 'bidder', 'shares', 'price', 'refund'], control: ['name', 'ticker', 'bidder', 'shares', 'price', 'refund'], bidderClosed: ['name', 'ticker', 'bidder', 'shares', 'price', 'refund'], bidderControl: ['name', 'ticker', 'bidder', 'shares', 'price', 'refund'] },
  regulator: { open: ['name', 'why', 'date'], won: ['name'], lost: ['name'], silent: ['name'], dropped: ['name'], fined: ['name', 'fine'] },
  court: { in: ['name', 'net'], out: ['name'], restructured: ['name', 'debts', 'paid', 'shares'], woundUp: ['name', 'wages', 'loans', 'perShare'], woundUpListed: ['name', 'wages', 'loans', 'perShare'] },
  vice: { bust: ['name'], won: ['name'], lost: ['name', 'seized', 'fine'], shut: ['name', 'seized', 'fine'] },
  financialCrimes: { unmasked: ['pct', 'name', 'ticker', 'fine'] },
  city: { inspection: ['name'], raid: ['name'], inspectionAnswer: ['name'], raidAnswer: ['name'] },
  collections: { collectors: ['name'], collectorsAnswer: ['name'] },
};
const tokensOf = (line) => [...String(line).matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
function checkPools(label, style, allowed) {
  const bad = [];
  for (const [kind, pools] of Object.entries(style)) {
    if (kind === 'ref') {
      if (tokensOf(pools).some((t) => t !== 'ref')) bad.push(`${label}.ref: ${pools}`);
      continue;
    }
    const lines = Array.isArray(pools) ? pools : Object.values(pools).flat();
    // Greetings and sign-offs go with every kind, so they may only use what every kind has.
    const ok = Array.isArray(allowed) ? allowed : Array.isArray(pools) ? ['name', 'gang', 'outlet'] : allowed[kind] ?? [];
    for (const line of lines) for (const t of tokensOf(line)) if (!ok.includes(t)) bad.push(`${label}.${kind}: {${t}} in "${line}"`);
    if (!Array.isArray(pools)) for (const [tone, pool] of Object.entries(pools)) if (!pool.length) bad.push(`${label}.${kind}.${tone} is empty`);
  }
  return bad;
}

test('every line names only facts its mail has, and no pool is empty', () => {
  const bad = [
    ...Object.entries(GANG_VOICES).flatMap(([s, v]) => checkPools(`gang.${s}`, v, TOKENS.gang)),
    ...Object.entries(CORP_VOICES).flatMap(([s, v]) => checkPools(`corp.${s}`, v, TOKENS.gang)),
    ...Object.entries(OUTLET_VOICES).flatMap(([s, v]) => checkPools(`outlet.${s}`, v, TOKENS.outlet)),
    ...Object.entries(OFFICIALS).flatMap(([s, v]) => checkPools(s, v, TOKENS[s])),
  ];
  assert.deepEqual(bad, []);
});

test('every style answers every move its kind of sender makes, three ways', () => {
  for (const style of GANG_STYLES) {
    for (const kind of ['shakedown', 'sabotage', 'roomFavour', 'roomBigOrder', 'dealEnded']) assert.ok(GANG_VOICES[style]?.[kind]?.lines?.length >= 3, `${style}.${kind}`);
    for (const tone of ['hostile', 'heavy', 'repeat']) assert.ok(GANG_VOICES[style].shakedown[tone]?.length >= 3, `${style}.shakedown.${tone}`);
  }
  for (const style of CORP_STYLES.filter((s) => !OUTLET_STYLES.includes(s))) {
    for (const kind of ['smear', 'roomFavour', 'roomBigOrder']) assert.ok(CORP_VOICES[style]?.[kind]?.lines?.length >= 3, `${style}.${kind}`);
  }
  const angles = ['money', 'crime', 'service', 'smear', 'dirty', 'hidden'];
  const outletKinds = ['pressAsk', 'charTold', ...['Ignored', 'Answered', 'Halved', 'Full'].flatMap((r) => [`result${r}`, `char${r}`]), ...angles.map((a) => `charAsk_${a}`)];
  for (const style of OUTLET_STYLES) for (const kind of outletKinds) assert.ok(OUTLET_VOICES[style]?.[kind]?.lines?.length, `${style}.${kind}`);
  for (const [sender, kinds] of Object.entries(TOKENS).filter(([s]) => OFFICIALS[s])) {
    for (const kind of Object.keys(kinds).filter((k) => !k.endsWith('Answer'))) assert.ok(OFFICIALS[sender][kind]?.lines?.length >= 3, `${sender}.${kind}`);
  }
  // Step 4: every sender answers each way an event can end.
  const ends = ['stopped', 'halved', 'full'];
  for (const style of GANG_STYLES) {
    for (const tone of [...ends, 'force']) assert.ok(GANG_VOICES[style].answer?.[tone]?.length >= 3, `${style}.answer.${tone}`);
    for (const tone of ends) assert.ok(GANG_VOICES[style].bigOrderAnswer?.[tone]?.length >= 3, `${style}.bigOrderAnswer.${tone}`);
  }
  for (const style of CORP_STYLES.filter((s) => !OUTLET_STYLES.includes(s))) {
    for (const kind of ['answer', 'bigOrderAnswer']) for (const tone of ends) assert.ok(CORP_VOICES[style][kind]?.[tone]?.length >= 3, `${style}.${kind}.${tone}`);
  }
  for (const [sender, kind] of [['city', 'inspectionAnswer'], ['city', 'raidAnswer'], ['collections', 'collectorsAnswer']]) {
    for (const tone of ends) assert.ok(OFFICIALS[sender][kind]?.[tone]?.length >= 3, `${sender}.${kind}.${tone}`);
  }
});

// ── Step 5: the Exchange by context, the syndicate treasury and the newswire ──

test('the Exchange reads a review, a delisting, an offer and its close by their context', () => {
  assert.deepEqual(exchangeTones('review', { again: true, deep: true }), ['again', 'deep']);
  assert.deepEqual(exchangeTones('review', {}), []);
  assert.deepEqual(exchangeTones('delisted', { borrowed: true }), ['borrowed']);
  const bars = { all: 0.2, half: 0.1 };
  assert.deepEqual(exchangeTones('open', { premium: 0.25, ...bars }), ['generous']);
  assert.deepEqual(exchangeTones('approved', { premium: 0.2, ...bars }), ['generous'], 'the float tenders all at the bar');
  assert.deepEqual(exchangeTones('open', { premium: 0.15, ...bars }), []);
  assert.deepEqual(exchangeTones('open', { premium: 0.05, ...bars }), ['thin']);
  assert.deepEqual(exchangeTones('closed', { acquired: 0, defended: true }), ['nothing', 'defended']);
  assert.deepEqual(exchangeTones('bidderClosed', { acquired: 10, defended: false }), []);
  assert.deepEqual(exchangeTones('control', { defended: true }), ['defended']);
  assert.deepEqual(exchangeTones('unfunded', { defended: true }), []);
  for (const [kind, tones] of [['review', ['again', 'deep']], ['delisted', ['borrowed']], ['open', ['generous', 'thin']], ['approved', ['generous', 'thin']], ['closed', ['nothing', 'defended']], ['bidderClosed', ['nothing', 'defended']], ['control', ['defended']], ['bidderControl', ['defended']]]) {
    for (const tone of tones) assert.ok(OFFICIALS.exchange[kind][tone]?.length >= 2, `exchange.${kind}.${tone}`);
  }
});

test('the treasury reads a motion by what it is about, and a vote by how it went', () => {
  assert.deepEqual(motionTones({ kind: 'trade' }), ['money']);
  assert.deepEqual(motionTones({ kind: 'admit' }), ['people']);
  assert.deepEqual(motionTones({ kind: 'dissolve' }), ['dissolve']);
  assert.deepEqual(motionTones({ kind: 'other' }), []);
  const member = (actorId, units) => ({ actorId, units, status: 'active' });
  const s = { members: [member('a', 50), member('b', 30), member('c', 20), { actorId: 'd', units: 0, status: 'left' }] };
  const passed = (votes, forced = false) => voteTones(s, { type: 'proposalPassed', forced, proposal: { votes } });
  assert.deepEqual(passed({ a: true, b: true, c: true }), ['unanimous']);
  assert.deepEqual(passed({ a: true, b: false, c: true }), [], '70% is a clear win');
  assert.deepEqual(passed({ a: true, b: false, c: false, d: true }), ['close'], 'only active members count: 50% is not a pass, but a bare majority is close');
  assert.deepEqual(passed({ a: true, c: false }, true), ['forced']);
  assert.deepEqual(voteTones(s, { type: 'proposalFailed', proposal: { votes: { b: false, c: false, a: true } } }), ['close'], 'half the units against');
  assert.deepEqual(voteTones(s, { type: 'proposalFailed', proposal: { votes: { a: false, b: false } } }), [], '80% against');
  const unitless = { members: [member('a', 0), member('b', 0)] };
  assert.deepEqual(voteTones(unitless, { type: 'proposalPassed', proposal: { votes: { a: true, b: true } } }), ['unanimous'], 'one vote each with no units');
  const mail = orgMail({ voices: TREASURY, style: 'treasury', kind: 'passed', tones: ['close'], data: { syndicate: 'Back Room Capital', what: 'Buy 10 ARA' }, rng: first });
  assert.equal(mail.paragraphs.length, 3, 'greeting, line, sign-off');
  assert.match(mail.paragraphs[1], /Buy 10 ARA/);
  assert.match(mail.paragraphs.join(' '), /Back Room Capital/);
});

/** The facts each treasury mail has. */
const TREASURY_TOKENS = {
  proposed: ['syndicate', 'what', 'by', 'date'], passed: ['syndicate', 'what'], failed: ['syndicate', 'what'], lapsed: ['syndicate', 'what'], vetoed: ['syndicate', 'what'],
  void: ['syndicate', 'what', 'reason'], agreedFailed: ['syndicate', 'what', 'reason'], redeemed: ['syndicate', 'units', 'amount'], dissolved: ['syndicate'],
};

test('every treasury and newswire line names only facts its mail has, and every kind has lines', () => {
  const bad = [];
  const t = TREASURY.treasury;
  for (const line of [...t.greetings, ...t.signoffs]) for (const k of tokensOf(line)) if (k !== 'syndicate') bad.push(`treasury frame: {${k}}`);
  for (const [kind, ok] of Object.entries(TREASURY_TOKENS)) {
    assert.ok(t[kind]?.lines?.length >= 3, `treasury.${kind}`);
    for (const [tone, pool] of Object.entries(t[kind])) {
      if (!pool.length) bad.push(`treasury.${kind}.${tone} is empty`);
      for (const line of pool) for (const k of tokensOf(line)) if (!ok.includes(k)) bad.push(`treasury.${kind}.${tone}: {${k}} in "${line}"`);
    }
  }
  for (const tone of ['money', 'people', 'dissolve']) assert.ok(t.proposed[tone]?.length >= 2, `proposed.${tone}`);
  for (const tone of ['forced', 'unanimous', 'close']) assert.ok(t.passed[tone]?.length >= 2, `passed.${tone}`);
  assert.ok(t.failed.close?.length >= 2);
  const w = NEWSWIRE.wire;
  for (const line of w.signoffs) if (tokensOf(line).length) bad.push(`wire sign-off: ${line}`);
  for (const kind of ['gig', 'story', 'filing', 'gm', 'market']) {
    for (const tone of ['up', 'down', 'lines']) assert.ok(w[kind]?.[tone]?.length >= 2, `wire.${kind}.${tone}`);
    // News about no one company has no company to name.
    const ok = kind === 'market' ? [] : ['name', 'ticker'];
    for (const line of Object.values(w[kind]).flat()) for (const k of tokensOf(line)) if (!ok.includes(k)) bad.push(`wire.${kind}: {${k}} in "${line}"`);
  }
  assert.deepEqual(bad, []);
});
