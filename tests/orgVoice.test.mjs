import { test } from 'node:test';
import assert from 'node:assert/strict';
import { orgMail, factionStyle, outletStyle, isRepeat, eventTones, refNumber, stylesFor, GANG_STYLES, CORP_STYLES, OUTLET_STYLES } from '../scripts/engine/index.js';
import { STARTER_GANGS } from '../scripts/data/starter-factions.js';
import { GANG_VOICES } from '../scripts/data/org-voices/gangs.js';
import { CORP_VOICES } from '../scripts/data/org-voices/corps.js';
import { OUTLET_VOICES } from '../scripts/data/org-voices/outlets.js';
import { OFFICIALS } from '../scripts/data/org-voices/officials.js';

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
  city: { inspection: ['name'], raid: ['name'] },
  collections: { collectors: ['name'] },
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
    for (const kind of Object.keys(kinds)) assert.ok(OFFICIALS[sender][kind]?.lines?.length >= 3, `${sender}.${kind}`);
  }
});
