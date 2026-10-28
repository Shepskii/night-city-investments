import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  VOICE_PERSONALITIES, VOICE_KINDS, VOICE_FRAME, VOICE_EXTRAS, resolvePersonality, pickLine, fillLine, composeVoiced, resetVoiceMemory,
} from '../scripts/engine/index.js';
import { BROKER_VOICES } from '../scripts/data/broker-voices.js';

beforeEach(() => resetVoiceMemory());

/** Kinds whose mail always has a company to name. */
const WITH_COMPANY = new Set(['accepted', 'filledBuy', 'filledSell', 'filledGain', 'filledLoss', 'expired', 'tipUp', 'tipDown']);

test('a sheet\'s Personality text is matched to the table by keyword', () => {
  const cases = {
    'Shy and secretive': 'shy',
    'Rebellious, antisocial, violent': 'rebellious',
    'Arrogant, proud and aloof': 'arrogant',
    'Moody, rash and headstrong': 'moody',
    'Picky, fussy and nervous': 'picky',
    'Stable and serious': 'stable',
    'Silly and fluff-headed': 'silly',
    'Sneaky and deceptive': 'sneaky',
    'Intellectual and detached': 'intellectual',
    'Friendly and outgoing': 'friendly',
    'FRIENDLY': 'friendly',
    'quite shy really': 'shy',
  };
  for (const [text, want] of Object.entries(cases)) assert.equal(resolvePersonality(text), want, text);
  for (const text of ['', null, undefined, 'Brooding', 'Whatever']) assert.equal(resolvePersonality(text), null, String(text));
  assert.deepEqual(Object.keys(BROKER_VOICES).sort(), [...VOICE_PERSONALITIES].sort());
});

test('every personality has a full set of lines for every kind of mail', () => {
  for (const personality of VOICE_PERSONALITIES) {
    const voice = BROKER_VOICES[personality];
    for (const key of [...VOICE_FRAME, ...VOICE_KINDS, ...VOICE_EXTRAS]) {
      const pool = voice[key];
      assert.ok(Array.isArray(pool), `${personality}.${key} is a pool`);
      const min = VOICE_FRAME.includes(key) || VOICE_EXTRAS.includes(key) ? 5 : key.startsWith('tip') ? 8 : 4;
      assert.ok(pool.length >= min, `${personality}.${key} has enough lines to vary (${pool.length})`);
      assert.equal(new Set(pool).size, pool.length, `${personality}.${key} has no repeats`);
      for (const line of pool) {
        assert.equal(typeof line, 'string');
        assert.ok(line.trim() === line && line.length >= 8, `${personality}.${key}: "${line}"`);
        assert.ok(!/[<>&]/.test(line), `${personality}.${key} has no markup: ${line}`);
      }
    }
    assert.deepEqual(Object.keys(voice).sort(), [...VOICE_FRAME, ...VOICE_KINDS, ...VOICE_EXTRAS].sort(), `${personality} has no stray pools`);
  }
});

test('tokens in lines are only the ones a mail can fill, and only where there is a company', () => {
  for (const personality of VOICE_PERSONALITIES) {
    for (const [key, pool] of Object.entries(BROKER_VOICES[personality])) {
      for (const line of pool) {
        const tokens = [...line.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
        for (const t of tokens) assert.ok(['ticker', 'name'].includes(t), `${personality}.${key}: {${t}}`);
        if (tokens.length) assert.ok(WITH_COMPANY.has(key), `${personality}.${key} uses a token but has no company: ${line}`);
      }
      if (WITH_COMPANY.has(key)) assert.ok(pool.some((l) => l.includes('{')), `${personality}.${key} mentions the company at least once`);
    }
  }
});

test('the voices really are different from each other', () => {
  const seen = new Map();
  for (const personality of VOICE_PERSONALITIES) {
    for (const [key, pool] of Object.entries(BROKER_VOICES[personality])) {
      for (const line of pool) {
        const owner = seen.get(line);
        assert.ok(!owner || owner === `${personality}.${key}` || owner.split('.')[0] === personality, `"${line}" is used by ${owner} and ${personality}.${key}`);
        seen.set(line, `${personality}.${key}`);
      }
    }
  }
});

test('a line is picked at random, but never the same one twice running', () => {
  const pool = ['a', 'b', 'c', 'd'];
  const seen = new Set();
  let last = null;
  for (let i = 0; i < 300; i++) {
    const line = pickLine(pool, 'k');
    assert.notEqual(line, last);
    seen.add(line);
    last = line;
  }
  assert.equal(seen.size, 4, 'every line gets used');
  assert.equal(pickLine(['only'], 'solo'), 'only');
  assert.equal(pickLine(['only'], 'solo'), 'only', 'a single line can repeat');
  assert.equal(pickLine([], 'x'), null);
  assert.equal(pickLine(undefined, 'x'), null);
  const fixed = () => 0;
  resetVoiceMemory();
  assert.equal(pickLine(pool, 'fixed', fixed), 'a');
  assert.notEqual(pickLine(pool, 'fixed', fixed), 'a', 'forced off the repeat even with a stuck generator');
});

test('pools do not share a memory', () => {
  assert.equal(pickLine(['a', 'b'], 'one', () => 0), 'a');
  assert.equal(pickLine(['a', 'b'], 'two', () => 0), 'a');
});

test('tokens are filled, and a missing value leaves no gap', () => {
  assert.equal(fillLine('Your {ticker} is in.', { ticker: 'ARA' }), 'Your ARA is in.');
  assert.equal(fillLine('Buy {name} ({ticker}).', { name: 'Arasaka', ticker: 'ARA' }), 'Buy Arasaka (ARA).');
  assert.equal(fillLine('Your {ticker} order is in.', {}), 'Your order is in.');
  assert.equal(fillLine('No tokens.'), 'No tokens.');
});

test('a voiced mail is greeting, situation line, the facts untouched, then a sign-off', () => {
  const lines = ['FACT ONE', 'FACT TWO'];
  const out = composeVoiced({ voices: BROKER_VOICES, personality: 'friendly', kind: 'filledGain', data: { ticker: 'ARA', name: 'Arasaka' }, lines });
  assert.equal(out.signed, true);
  assert.equal(out.paragraphs.length, 5);
  assert.ok(BROKER_VOICES.friendly.greetings.includes(out.paragraphs[0]));
  assert.ok(BROKER_VOICES.friendly.filledGain.map((l) => fillLine(l, { ticker: 'ARA', name: 'Arasaka' })).includes(out.paragraphs[1]));
  assert.deepEqual(out.paragraphs.slice(2, 4), lines);
  assert.ok(BROKER_VOICES.friendly.signoffs.includes(out.paragraphs[4]));
  assert.ok(!out.paragraphs.join(' ').includes('{'), 'no token left behind');
});

test('with no voice the standard mail is left alone', () => {
  for (const personality of [null, undefined, '', 'brooding']) {
    assert.equal(composeVoiced({ voices: BROKER_VOICES, personality, kind: 'accepted', lines: ['x'] }), null, String(personality));
  }
});

test('a voice missing a pool just leaves that part out, and says it is unsigned when it has no sign-off', () => {
  const voices = { shy: { greetings: ['Hi.'], accepted: ['Got it.'] } };
  const out = composeVoiced({ voices, personality: 'shy', kind: 'accepted', lines: ['FACT'] });
  assert.deepEqual(out, { paragraphs: ['Hi.', 'Got it.', 'FACT'], signed: false });
  assert.deepEqual(composeVoiced({ voices, personality: 'shy', kind: 'rejected', lines: ['FACT'] }).paragraphs, ['Hi.', 'FACT']);
});

test('a rumour is a standalone voiced line plus a hedge, without the standard facts', () => {
  const lines = ['STANDARD RUMOUR', 'STANDARD HEDGE'];
  const out = composeVoiced({ voices: BROKER_VOICES, personality: 'silly', kind: 'tipUp', data: { ticker: 'ARA', name: 'Arasaka' }, lines, standalone: true, after: 'tipHedge' });
  assert.equal(out.paragraphs.length, 4);
  assert.ok(!out.paragraphs.some((p) => p.includes('STANDARD')));
  assert.ok(BROKER_VOICES.silly.tipHedge.includes(out.paragraphs[2]));
  assert.ok(BROKER_VOICES.silly.signoffs.includes(out.paragraphs[3]));
  const plain = composeVoiced({ voices: BROKER_VOICES, personality: 'silly', kind: 'tipUp', data: {}, lines });
  assert.deepEqual(plain.paragraphs.slice(2, 4), lines, 'without the flags the facts stay');
});

test('a rumour from one voice has hundreds of combinations', () => {
  const seen = new Set();
  for (let i = 0; i < 400; i++) {
    seen.add(composeVoiced({ voices: BROKER_VOICES, personality: 'sneaky', kind: 'tipDown', data: { ticker: 'ARA', name: 'Arasaka' }, lines: [], standalone: true, after: 'tipHedge' }).paragraphs.join('|'));
  }
  assert.ok(seen.size > 150, `plenty of variety: ${seen.size}`);
});

test('the same facts get different wrapping on different calls', () => {
  const seen = new Set();
  for (let i = 0; i < 40; i++) {
    seen.add(composeVoiced({ voices: BROKER_VOICES, personality: 'sneaky', kind: 'rejected', lines: ['F'] }).paragraphs.join('|'));
  }
  assert.ok(seen.size > 10, `plenty of variety: ${seen.size}`);
});
